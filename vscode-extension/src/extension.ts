import * as vscode from "vscode";
import {
  getCodexCliCommand,
  getFixtureScenario,
  getMcpEndpoint,
  getLocalIndexConfig,
  getOperationProfile,
  getRequestTimeoutMs,
  getRuntimeMode,
  resolveLocalDbConfig,
  isDiagnosticModeEnabled,
} from "./config";
import {
  COMMAND_APPEND_CONTEXT_EVENT,
  COMMAND_APPLY_SYNC_BATCH,
  COMMAND_ARCHIVE_CONTEXT_ITEM,
  COMMAND_CLEAR_AUTH,
  COMMAND_CONFIGURE_AUTH,
  COMMAND_LOCAL_CONFIGURE_DB_PASSWORD,
  COMMAND_LOCAL_INDEX,
  COMMAND_LOCAL_PREPARE_TASK,
  COMMAND_LOCAL_REFRESH,
  COMMAND_LOCAL_RUN_CODEX,
  COMMAND_LINK_CONTEXT_ENTITIES,
  COMMAND_LOAD_CONTEXT,
  COMMAND_PREPARE_HANDOFF,
  COMMAND_RESET_SESSION,
  COMMAND_SEARCH_CONTEXT,
  COMMAND_SET_CONTEXT_LABELS,
  COMMAND_UPSERT_CONTEXT_ITEM,
  EXTENSION_OUTPUT_CHANNEL,
  LOCAL_DB_PASSWORD_STORAGE_KEY,
  LOCAL_RUNTIME_VIEW_ID,
} from "./constants";
import { DiagnosticsReporter, type DiagnosticsSnapshot } from "./diagnostics";
import { EnvironmentInspector, EnvironmentSnapshot } from "./environment/environmentInspector";
import { SessionManager, SessionSnapshot } from "./sessionManager";
import { LoadOperationalContextService, type LoadContextConfig } from "./application/loadOperationalContextService";
import { ContextPresenter } from "./presentation/contextPresenter";
import { ViewModelMapper } from "./presentation/viewModels";
import { OutputChannelRenderer } from "./presentation/renderers/outputChannelRenderer";
import { FixtureWISGateway } from "./infrastructure/wis/fixtureWISGateway";
import { McpWISGateway } from "./infrastructure/wis/mcpWISGateway";
import { InMemoryOperationalContextStore } from "./application/operationalContextStore";
import { HandoffBuilder } from "./application/handoffBuilder";
import { InMemoryHandoffArtifactStore } from "./application/handoffArtifactStore";
import { HandoffOutputChannelRenderer } from "./presentation/renderers/handoffOutputChannelRenderer";
import { AuthManager } from "./auth/authManager";
import { ContextCommandService, type ContextCommandExecutionInput } from "./application/contextCommandService";
import { ContextCommandOutputRenderer } from "./presentation/renderers/contextCommandOutputRenderer";
import { InMemoryLocalRuntimeStore } from "./local/localRuntimeStore";
import { createInitialProjectRuntimeSnapshot } from "./local/types";
import { LocalRuntimePanelProvider } from "./presentation/local/localRuntimePanelProvider";
import { LocalRuntimeOutputRenderer } from "./presentation/renderers/localRuntimeOutputRenderer";
import { CodexCliRunner } from "./local/codexCliRunner";
import { NoopPersistence } from "./local/noopServices";
import { LocalCommandService } from "./local/localCommandService";
import { PostgresPersistenceAdapter } from "./local/persistence/postgresPersistenceAdapter";
import type { PersistencePort } from "./local/ports";
import type { LocalCommandResult } from "./local/types";
import { IncrementalWorkspaceIndexer } from "./local/indexing/incrementalWorkspaceIndexer";
import { HybridContextRetriever } from "./local/retrieval/hybridContextRetriever";
import { ContextAwareTaskBuilder } from "./local/taskBuilder/contextAwareTaskBuilder";

let outputChannel: vscode.OutputChannel | undefined;

function createSnapshot(
  event: string,
  consumer: string,
  session: SessionSnapshot,
  endpoint: string,
  initialized: boolean,
  environment?: EnvironmentSnapshot,
): DiagnosticsSnapshot {
  return {
    event,
    consumer,
    session_key: session.sessionKey,
    session_created_at: session.sessionCreatedAt,
    session_state: session.sessionState,
    endpoint,
    workspace_root: environment?.workspace_root ?? null,
    repo_root: environment?.repo_root ?? null,
    branch: environment?.branch ?? null,
    active_file: environment?.active_file ?? null,
    inspector_status: environment?.inspector_status ?? "not_checked",
    inspector_error: environment?.inspector_error ?? null,
    initialized,
    timestamp: new Date().toISOString(),
  };
}

function currentConfig(): LoadContextConfig {
  return {
    endpoint: getMcpEndpoint(),
    runtimeMode: getRuntimeMode(),
    timeoutMs: getRequestTimeoutMs(),
    fixtureScenario: getFixtureScenario(),
    diagnosticMode: isDiagnosticModeEnabled(),
  };
}

async function promptRequired(placeHolder: string, prompt: string, value?: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    placeHolder,
    prompt,
    value,
    ignoreFocusOut: true,
    validateInput: (raw) => (!raw.trim() ? "Campo obligatorio." : null),
  });
}

async function promptDryRunMode(): Promise<boolean | undefined> {
  const selected = await vscode.window.showQuickPick(
    [
      { label: "dry_run", detail: "Preview sin mutación", value: true },
      { label: "commit", detail: "Ejecutar mutación", value: false },
    ],
    {
      placeHolder: "Selecciona modo de ejecución",
      ignoreFocusOut: true,
    },
  );
  return selected?.value;
}

function labelsFromInput(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function createLocalPersistence(context: vscode.ExtensionContext): Promise<PersistencePort> {
  const profile = getOperationProfile();
  const dbConfig = await resolveLocalDbConfig(context.secrets, profile);

  if (profile !== "local_private") {
    return new NoopPersistence({
      dbStatus: "disconnected",
      reason: "Persistencia local solo aplica en operationProfile=local_private.",
    });
  }

  if (!dbConfig.enabled) {
    return new NoopPersistence({
      dbStatus: "disconnected",
      reason: "Persistencia local deshabilitada (wisContextSync.localDb.enabled=false).",
    });
  }

  try {
    return new PostgresPersistenceAdapter({
      config: dbConfig,
      extensionPath: context.extensionPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel?.appendLine(`[WIS][LOCAL][DB] adapter_init_error: ${message}`);
    return new NoopPersistence({
      dbStatus: "disconnected",
      reason: message,
    });
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel(EXTENSION_OUTPUT_CHANNEL);
  context.subscriptions.push(outputChannel);

  const sessionManager = new SessionManager(context);
  const environmentInspector = new EnvironmentInspector();
  const diagnostics = new DiagnosticsReporter(outputChannel);
  const contextStore = new InMemoryOperationalContextStore();
  const handoffArtifactStore = new InMemoryHandoffArtifactStore();
  const authManager = new AuthManager(context);

  const endpoint = getMcpEndpoint();
  const activeSession = await sessionManager.getOrCreateSession();
  const activationEnvironment = await environmentInspector.inspect();
  diagnostics.report(
    createSnapshot(
      "extension_activated",
      sessionManager.consumer,
      activeSession,
      endpoint,
      true,
      activationEnvironment,
    ),
    isDiagnosticModeEnabled(),
  );

  const presenter = new ContextPresenter(new ViewModelMapper(), new OutputChannelRenderer(outputChannel));
  const loadService = new LoadOperationalContextService({
    sessionManager,
    environmentInspector,
    diagnostics,
    presenter,
    contextStore,
    getConfig: currentConfig,
    createGateway: (config) => {
      if (config.runtimeMode === "offline_fixture") {
        return new FixtureWISGateway(config.fixtureScenario);
      }
      return new McpWISGateway();
    },
  });
  const handoffBuilder = new HandoffBuilder({
    contextStore,
    artifactStore: handoffArtifactStore,
    renderer: new HandoffOutputChannelRenderer(outputChannel),
  });
  const contextCommandService = new ContextCommandService();
  const contextCommandRenderer = new ContextCommandOutputRenderer(outputChannel);
  const localStore = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(getOperationProfile()));
  const localPanelProvider = new LocalRuntimePanelProvider(localStore.getSnapshot());
  const localOutputRenderer = new LocalRuntimeOutputRenderer(outputChannel);
  const localPersistence = await createLocalPersistence(context);
  const localIndexer = new IncrementalWorkspaceIndexer({
    persistence: localPersistence,
    getIndexConfig: getLocalIndexConfig,
  });
  const localCommandService = new LocalCommandService({
    inspector: environmentInspector,
    store: localStore,
    indexer: localIndexer,
    retriever: new HybridContextRetriever({ persistence: localPersistence }),
    taskBuilder: new ContextAwareTaskBuilder(),
    codexRunner: new CodexCliRunner(),
    persistence: localPersistence,
    getOperationProfile,
    getCodexCliCommand,
  });

  if (localPersistence instanceof PostgresPersistenceAdapter) {
    context.subscriptions.push({
      dispose: () => {
        void localPersistence.dispose();
      },
    });
  }

  localStore.update((current) => ({
    ...current,
    operation_profile: getOperationProfile(),
    workspace_root: activationEnvironment.workspace_root,
    repo_root: activationEnvironment.repo_root,
    branch: activationEnvironment.branch,
    active_file: activationEnvironment.active_file,
    runtime_state:
      activationEnvironment.inspector_status === "error"
        ? "error"
        : activationEnvironment.inspector_status === "no_workspace"
          ? "idle"
          : "ready",
    updated_at: new Date().toISOString(),
  }));

  const localStoreUnsubscribe = localStore.subscribe((snapshot) => {
    localPanelProvider.update(snapshot);
  });
  context.subscriptions.push({ dispose: localStoreUnsubscribe });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(LOCAL_RUNTIME_VIEW_ID, localPanelProvider));

  const executeContextTool = async (
    toolLabel: string,
    runner: (input: ContextCommandExecutionInput) => Promise<{
      ok: boolean;
      status: string | null;
      message: string;
      requiredScopes: string[];
      tool: string;
      payload: Record<string, unknown> | null;
      httpStatus: number | null;
    }>,
  ): Promise<void> => {
    const auth = await authManager.resolveAuthContext();
    const session = await sessionManager.getOrCreateSession();
    const config = currentConfig();
    const result = await runner({
      endpoint: config.endpoint,
      timeoutMs: config.timeoutMs,
      auth,
      consumer: sessionManager.consumer,
      sessionKey: session.sessionKey,
    });
    contextCommandRenderer.render(result.tool, result);
    outputChannel?.show(true);
    if (!result.ok) {
      const scopeHint = result.requiredScopes.length > 0 ? ` scopes=${result.requiredScopes.join(",")}` : "";
      if (result.status === "forbidden") {
        await vscode.window.showErrorMessage(`${toolLabel} -> 403 insufficient_scope.${scopeHint}`);
        return;
      }
      if (result.status === "unauthorized") {
        await vscode.window.showErrorMessage(`${toolLabel} -> 401 unauthorized. Configura token/authMode.`);
        return;
      }
      await vscode.window.showErrorMessage(`${toolLabel} falló: ${result.message}`);
      return;
    }
    await vscode.window.showInformationMessage(`${toolLabel} completado. status=${result.status ?? "ok"}`);
  };

  const executeLocalCommand = async (
    label: string,
    runner: () => Promise<LocalCommandResult>,
  ): Promise<void> => {
    const result = await runner();
    localOutputRenderer.render(result, localStore.getSnapshot());
    outputChannel?.show(true);

    if (!result.ok) {
      if (result.status === "blocked") {
        await vscode.window.showWarningMessage(result.message);
      } else {
        await vscode.window.showErrorMessage(`${label} falló: ${result.message}`);
      }
      return;
    }

    await vscode.window.showInformationMessage(`${label} completado.`);
  };

  const loadDisposable = vscode.commands.registerCommand(COMMAND_LOAD_CONTEXT, async () => {
    const auth = await authManager.resolveAuthContext();
    const envelope = await loadService.load(auth);
    const authSummary = auth.mode === "none" ? "none" : `${auth.mode}/${auth.token ? "configured" : "missing"}`;
    outputChannel?.show(true);
    await vscode.window.showInformationMessage(
      `WIS context ${envelope.meta.load_state}. mode=${envelope.meta.runtime_mode}, transport=${envelope.meta.transport_status}, auth=${authSummary}, session=${envelope.meta.session_key}`,
    );
  });

  const resetDisposable = vscode.commands.registerCommand(COMMAND_RESET_SESSION, async () => {
    const currentEndpoint = getMcpEndpoint();
    const session = await sessionManager.resetSession();
    const snapshot = createSnapshot("session_reset", sessionManager.consumer, session, currentEndpoint, true);
    diagnostics.report(
      snapshot,
      isDiagnosticModeEnabled(),
    );
    outputChannel?.show(true);
    await vscode.window.showInformationMessage(
      `WIS session reset. new session_key=${snapshot.session_key}`,
    );
  });

  const prepareHandoffDisposable = vscode.commands.registerCommand(COMMAND_PREPARE_HANDOFF, async () => {
    const lastEnvelope = contextStore.getLast();
    const intent = {
      user_intent: "Preparar handoff estructurado para siguiente ejecución Codex.",
      local_focus: lastEnvelope?.local_environment.active_file ? [lastEnvelope.local_environment.active_file] : [],
      detail_level: "standard" as const,
    };

    const result = handoffBuilder.build({
      intent,
      target: "codex",
    });

    outputChannel?.show(true);
    if (result.status === "blocked") {
      await vscode.window.showWarningMessage(
        "Handoff blocked: ejecuta 'WIS: Load Operational Context' y reintenta.",
      );
      return;
    }

    await vscode.window.showInformationMessage(
      `Handoff ${result.status} generado para ${result.artifact?.meta.target ?? "codex"}.`,
    );
  });

  const configureAuthDisposable = vscode.commands.registerCommand(COMMAND_CONFIGURE_AUTH, async () => {
    const status = await authManager.configureInteractive();
    outputChannel?.show(true);
    if (status.mode === "none") {
      await vscode.window.showWarningMessage(
        "authMode está en 'none'. Cambia wisContextSync.authMode a 'bearer' o 'api_key' antes de configurar token.",
      );
      return;
    }
    if (!status.has_token) {
      await vscode.window.showWarningMessage("No se guardó token de autenticación.");
      return;
    }
    await vscode.window.showInformationMessage(
      `Autenticación configurada. mode=${status.mode}, required=${status.required ? "true" : "false"}.`,
    );
  });

  const clearAuthDisposable = vscode.commands.registerCommand(COMMAND_CLEAR_AUTH, async () => {
    await authManager.clearToken();
    outputChannel?.show(true);
    await vscode.window.showInformationMessage("Token de autenticación eliminado de SecretStorage.");
  });

  const searchContextDisposable = vscode.commands.registerCommand(COMMAND_SEARCH_CONTEXT, async () => {
    const query = await vscode.window.showInputBox({
      placeHolder: "Texto de búsqueda",
      prompt: "Buscar en contexto",
      value: "",
      ignoreFocusOut: true,
    });
    if (query === undefined) {
      return;
    }
    await executeContextTool("WIS: Search Context", (input) =>
      contextCommandService.searchContext(input, query),
    );
  });

  const upsertContextItemDisposable = vscode.commands.registerCommand(COMMAND_UPSERT_CONTEXT_ITEM, async () => {
    const itemKey = await promptRequired("context.item.key", "Identificador lógico del item");
    if (!itemKey) {
      return;
    }
    const title = await promptRequired("Título", "Título del item");
    if (!title) {
      return;
    }
    const itemType = await promptRequired("note|decision|risk", "Tipo del item", "note");
    if (!itemType) {
      return;
    }
    const labelsRaw = await vscode.window.showInputBox({
      placeHolder: "labels separadas por coma (opcional)",
      prompt: "Etiquetas del item",
      value: "",
      ignoreFocusOut: true,
    });
    if (labelsRaw === undefined) {
      return;
    }
    const dryRun = await promptDryRunMode();
    if (dryRun === undefined) {
      return;
    }
    await executeContextTool("WIS: Upsert Context Item", (input) =>
      contextCommandService.upsertContextItem(input, {
        itemKey: itemKey.trim(),
        itemType: itemType.trim(),
        title: title.trim(),
        labels: labelsFromInput(labelsRaw),
        dryRun,
      }),
    );
  });

  const appendContextEventDisposable = vscode.commands.registerCommand(COMMAND_APPEND_CONTEXT_EVENT, async () => {
    const summary = await promptRequired("Resumen del evento", "Describe el evento");
    if (!summary) {
      return;
    }
    const eventType = await promptRequired("event_type", "Tipo de evento", "info");
    if (!eventType) {
      return;
    }
    const dryRun = await promptDryRunMode();
    if (dryRun === undefined) {
      return;
    }
    await executeContextTool("WIS: Append Context Event", (input) =>
      contextCommandService.appendContextEvent(input, {
        summary: summary.trim(),
        eventType: eventType.trim(),
        dryRun,
      }),
    );
  });

  const linkContextEntitiesDisposable = vscode.commands.registerCommand(COMMAND_LINK_CONTEXT_ENTITIES, async () => {
    const sourceItemId = await promptRequired("source UUID", "ID del item origen");
    if (!sourceItemId) {
      return;
    }
    const targetItemId = await promptRequired("target UUID", "ID del item destino");
    if (!targetItemId) {
      return;
    }
    const relation = await promptRequired("depends_on|blocks|relates_to", "Relación", "depends_on");
    if (!relation) {
      return;
    }
    const dryRun = await promptDryRunMode();
    if (dryRun === undefined) {
      return;
    }
    await executeContextTool("WIS: Link Context Entities", (input) =>
      contextCommandService.linkContextEntities(input, {
        sourceItemId: sourceItemId.trim(),
        targetItemId: targetItemId.trim(),
        relation: relation.trim(),
        dryRun,
      }),
    );
  });

  const setContextLabelsDisposable = vscode.commands.registerCommand(COMMAND_SET_CONTEXT_LABELS, async () => {
    const contextItemId = await promptRequired("context_item_id UUID", "ID del item");
    if (!contextItemId) {
      return;
    }
    const labelsRaw = await promptRequired("label1,label2", "Labels separadas por coma");
    if (!labelsRaw) {
      return;
    }
    const dryRun = await promptDryRunMode();
    if (dryRun === undefined) {
      return;
    }
    await executeContextTool("WIS: Set Context Labels", (input) =>
      contextCommandService.setContextLabels(input, {
        contextItemId: contextItemId.trim(),
        labels: labelsFromInput(labelsRaw),
        dryRun,
      }),
    );
  });

  const archiveContextItemDisposable = vscode.commands.registerCommand(COMMAND_ARCHIVE_CONTEXT_ITEM, async () => {
    const contextItemId = await promptRequired("context_item_id UUID", "ID del item a archivar");
    if (!contextItemId) {
      return;
    }
    const dryRun = await promptDryRunMode();
    if (dryRun === undefined) {
      return;
    }
    await executeContextTool("WIS: Archive Context Item", (input) =>
      contextCommandService.archiveContextItem(input, {
        contextItemId: contextItemId.trim(),
        dryRun,
      }),
    );
  });

  const applySyncBatchDisposable = vscode.commands.registerCommand(COMMAND_APPLY_SYNC_BATCH, async () => {
    const operationsRaw = await promptRequired(
      'JSON ops, ej: [{"operation":"upsert_context_item"}]',
      "Operaciones batch en JSON",
      '[{"operation":"upsert_context_item"}]',
    );
    if (!operationsRaw) {
      return;
    }
    let operations: Array<Record<string, unknown>>;
    try {
      const parsed = JSON.parse(operationsRaw);
      if (!Array.isArray(parsed)) {
        throw new Error("operations debe ser array");
      }
      operations = parsed as Array<Record<string, unknown>>;
    } catch (error) {
      await vscode.window.showErrorMessage(`JSON inválido para operations: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const dryRun = await promptDryRunMode();
    if (dryRun === undefined) {
      return;
    }
    await executeContextTool("WIS: Apply Sync Batch", (input) =>
      contextCommandService.applySyncBatch(input, {
        operations,
        dryRun,
      }),
    );
  });

  const localIndexDisposable = vscode.commands.registerCommand(COMMAND_LOCAL_INDEX, async () => {
    await executeLocalCommand("WIS: Local Index", async () => localCommandService.localIndex());
  });

  const localPrepareTaskDisposable = vscode.commands.registerCommand(COMMAND_LOCAL_PREPARE_TASK, async () => {
    const intent = await promptRequired(
      "Objetivo técnico",
      "Describe la tarea que quieres preparar para Codex",
    );
    if (!intent) {
      return;
    }
    await executeLocalCommand("WIS: Local Prepare Task", async () => localCommandService.localPrepareTask(intent));
  });

  const localRunCodexDisposable = vscode.commands.registerCommand(COMMAND_LOCAL_RUN_CODEX, async () => {
    await executeLocalCommand("WIS: Local Run Codex", async () => localCommandService.localRunCodex());
  });

  const localRefreshDisposable = vscode.commands.registerCommand(COMMAND_LOCAL_REFRESH, async () => {
    await executeLocalCommand("WIS: Local Refresh", async () => localCommandService.localRefresh());
  });

  const localConfigureDbPasswordDisposable = vscode.commands.registerCommand(
    COMMAND_LOCAL_CONFIGURE_DB_PASSWORD,
    async () => {
      const password = await vscode.window.showInputBox({
        placeHolder: "Password PostgreSQL",
        prompt: "Guardar password de wisContextSync.localDb en SecretStorage.",
        password: true,
        ignoreFocusOut: true,
      });

      if (password === undefined) {
        return;
      }

      if (!password.trim()) {
        await context.secrets.delete(LOCAL_DB_PASSWORD_STORAGE_KEY);
        outputChannel?.appendLine("[WIS][LOCAL][DB] SecretStorage password cleared.");
        await vscode.window.showInformationMessage("Password de localDb eliminado de SecretStorage.");
        return;
      }

      await context.secrets.store(LOCAL_DB_PASSWORD_STORAGE_KEY, password);
      outputChannel?.appendLine("[WIS][LOCAL][DB] SecretStorage password updated.");
      await vscode.window.showInformationMessage("Password de localDb guardado en SecretStorage.");
    },
  );

  context.subscriptions.push(
    loadDisposable,
    resetDisposable,
    prepareHandoffDisposable,
    configureAuthDisposable,
    clearAuthDisposable,
    searchContextDisposable,
    upsertContextItemDisposable,
    appendContextEventDisposable,
    linkContextEntitiesDisposable,
    setContextLabelsDisposable,
    archiveContextItemDisposable,
    applySyncBatchDisposable,
    localIndexDisposable,
    localPrepareTaskDisposable,
    localRunCodexDisposable,
    localRefreshDisposable,
    localConfigureDbPasswordDisposable,
  );
}

export function deactivate(): void {
  outputChannel?.dispose();
}
