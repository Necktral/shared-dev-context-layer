import * as vscode from "vscode";
import {
  getFixtureScenario,
  getMcpEndpoint,
  getRequestTimeoutMs,
  getRuntimeMode,
  isDiagnosticModeEnabled,
} from "./config";
import {
  COMMAND_CLEAR_AUTH,
  COMMAND_CONFIGURE_AUTH,
  COMMAND_LOAD_CONTEXT,
  COMMAND_PREPARE_HANDOFF,
  COMMAND_RESET_SESSION,
  EXTENSION_OUTPUT_CHANNEL,
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

  context.subscriptions.push(
    loadDisposable,
    resetDisposable,
    prepareHandoffDisposable,
    configureAuthDisposable,
    clearAuthDisposable,
  );
}

export function deactivate(): void {
  outputChannel?.dispose();
}
