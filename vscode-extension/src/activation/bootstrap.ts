import * as path from "node:path";
import type * as vscode from "vscode";
import {
  getCodexCliCommand,
  getCouncilConfig,
  getFixtureScenario,
  getLocalIndexConfig,
  getMcpEndpoint,
  getOperationProfile,
  getRequestTimeoutMs,
  getRuntimeMode,
  isDiagnosticModeEnabled,
  resolveLocalDbConfig,
} from "../config";
import { ContextCommandService } from "../application/contextCommandService";
import { HandoffBuilder } from "../application/handoffBuilder";
import { InMemoryHandoffArtifactStore } from "../application/handoffArtifactStore";
import { LoadOperationalContextService, type LoadContextConfig } from "../application/loadOperationalContextService";
import { InMemoryOperationalContextStore } from "../application/operationalContextStore";
import { AuthManager } from "../auth/authManager";
import { RuntimeAuthPolicy } from "../auth/runtimeAuthPolicy";
import { CouncilRoomService } from "../council/councilRoomService";
import type { DiagnosticsSnapshot } from "../diagnostics";
import { DiagnosticsReporter } from "../diagnostics";
import { EnvironmentInspector, type EnvironmentSnapshot } from "../environment/environmentInspector";
import { FixtureWISGateway } from "../infrastructure/wis/fixtureWISGateway";
import { McpWISGateway } from "../infrastructure/wis/mcpWISGateway";
import { CodexCliRunner } from "../local/codexCliRunner";
import { IncrementalWorkspaceIndexer } from "../local/indexing/incrementalWorkspaceIndexer";
import { LocalCommandService } from "../local/localCommandService";
import { InMemoryLocalRuntimeStore } from "../local/localRuntimeStore";
import { NoopPersistence } from "../local/noopServices";
import type { PersistencePort } from "../local/ports";
import { PostRunReconciler } from "../local/postRunReconciler";
import { PostRunReviewer } from "../local/postRunReviewer";
import { PostgresPersistenceAdapter } from "../local/persistence/postgresPersistenceAdapter";
import { HybridContextRetriever } from "../local/retrieval/hybridContextRetriever";
import { ContextAwareTaskBuilder } from "../local/taskBuilder/contextAwareTaskBuilder";
import { createInitialProjectRuntimeSnapshot, type LocalCommandResult } from "../local/types";
import { WorkspaceSnapshotter } from "../local/workspaceSnapshotter";
import { PlaybookRegistry } from "../platform/playbooks/playbookRegistry";
import { WorkspaceBoundaryGuard } from "../platform/security/workspaceBoundaryGuard";
import { LocalDoctorService } from "../platform/doctor/localDoctorService";
import { ContextPresenter } from "../presentation/contextPresenter";
import { LocalRuntimePanelProvider } from "../presentation/local/localRuntimePanelProvider";
import { ContextCommandOutputRenderer } from "../presentation/renderers/contextCommandOutputRenderer";
import { HandoffOutputChannelRenderer } from "../presentation/renderers/handoffOutputChannelRenderer";
import { LocalRuntimeOutputRenderer } from "../presentation/renderers/localRuntimeOutputRenderer";
import { OutputChannelRenderer } from "../presentation/renderers/outputChannelRenderer";
import { ViewModelMapper } from "../presentation/viewModels";
import type { SessionSnapshot } from "../sessionManager";
import { SessionManager } from "../sessionManager";
import type { ExtensionBootstrapResult } from "./runtimeContext";

function buildDiagnosticsSnapshot(
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

function getCurrentConfig(): LoadContextConfig {
  return {
    endpoint: getMcpEndpoint(),
    runtimeMode: getRuntimeMode(),
    timeoutMs: getRequestTimeoutMs(),
    fixtureScenario: getFixtureScenario(),
    diagnosticMode: isDiagnosticModeEnabled(),
  };
}

async function createLocalPersistence(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): Promise<PersistencePort> {
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
    outputChannel.appendLine(`[WIS][LOCAL][DB] adapter_init_error: ${message}`);
    return new NoopPersistence({
      dbStatus: "disconnected",
      reason: message,
    });
  }
}

export async function bootstrapExtension(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): Promise<ExtensionBootstrapResult> {
  const sessionManager = new SessionManager(context);
  const environmentInspector = new EnvironmentInspector();
  const diagnostics = new DiagnosticsReporter(outputChannel);
  const contextStore = new InMemoryOperationalContextStore();
  const handoffArtifactStore = new InMemoryHandoffArtifactStore();
  const authManager = new AuthManager(context);
  const authPolicy = new RuntimeAuthPolicy();
  const boundaryGuard = new WorkspaceBoundaryGuard();

  const endpoint = getMcpEndpoint();
  const activeSession = await sessionManager.getOrCreateSession();
  const activationEnvironment = await environmentInspector.inspect();
  diagnostics.report(
    buildDiagnosticsSnapshot(
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
    getConfig: getCurrentConfig,
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
  const playbookRegistry = new PlaybookRegistry({
    systemRoot: path.join(context.extensionPath, "playbooks"),
    workspaceRoot: activationEnvironment.workspace_root
      ? path.join(activationEnvironment.workspace_root, ".wis", "playbooks")
      : null,
    projectRoot: activationEnvironment.repo_root
      ? path.join(activationEnvironment.repo_root, ".wis", "playbooks")
      : null,
  });
  const localStore = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(getOperationProfile()));
  const localOutputRenderer = new LocalRuntimeOutputRenderer(outputChannel);
  const localPersistence = await createLocalPersistence(context, outputChannel);
  const councilRoomService = new CouncilRoomService({
    store: localStore,
    inspector: environmentInspector,
    persistence: localPersistence,
    secretStorage: context.secrets,
    outputChannel,
    getOperationProfile,
    getCouncilConfig,
  });
  const renderCouncilResult = async (runner: () => Promise<LocalCommandResult>) => {
    const result = await runner();
    localOutputRenderer.render(result, localStore.getSnapshot());
    outputChannel.show(true);
  };
  const localPanelProvider = new LocalRuntimePanelProvider(localStore.getSnapshot(), {
    openCouncil: async (input) => renderCouncilResult(() => councilRoomService.openSession(input)),
    runCouncilRound: async () => renderCouncilResult(() => councilRoomService.runRound()),
    synthesizeCouncilPacket: async () => renderCouncilResult(() => councilRoomService.synthesizePacket()),
    switchTab: (tab) => councilRoomService.switchTab(tab),
  });
  const localIndexer = new IncrementalWorkspaceIndexer({
    persistence: localPersistence,
    getIndexConfig: getLocalIndexConfig,
  });
  const postRunReconciler = new PostRunReconciler({
    snapshotter: new WorkspaceSnapshotter({
      getIndexConfig: getLocalIndexConfig,
    }),
    indexer: localIndexer,
  });
  const localCommandService = new LocalCommandService({
    inspector: environmentInspector,
    store: localStore,
    indexer: localIndexer,
    retriever: new HybridContextRetriever({ persistence: localPersistence }),
    taskBuilder: new ContextAwareTaskBuilder(),
    postRunReconciler,
    postRunReviewer: new PostRunReviewer(),
    codexRunner: new CodexCliRunner(),
    persistence: localPersistence,
    getOperationProfile,
    getCodexCliCommand,
    boundaryGuard,
    playbookRegistry,
  });
  const doctorService = new LocalDoctorService(
    {
      inspectEnvironment: () => environmentInspector.inspect(),
      resolveAuth: () => authManager.resolveAuthContext(),
      getPersistenceSnapshot: () => {
        const snapshot = localStore.getSnapshot();
        return {
          dbStatus: snapshot.db_status,
          reason: snapshot.db_error,
        };
      },
      getRuntimeMode,
      getOperationProfile,
    },
    boundaryGuard,
    authPolicy,
  );

  const disposables: vscode.Disposable[] = [];
  if (localPersistence instanceof PostgresPersistenceAdapter) {
    disposables.push({
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
  disposables.push({ dispose: localStoreUnsubscribe });

  return {
    outputChannel,
    sessionManager,
    environmentInspector,
    diagnostics,
    contextStore,
    loadService,
    handoffBuilder,
    authManager,
    authPolicy,
    contextCommandService,
    contextCommandRenderer,
    localStore,
    localOutputRenderer,
    localCommandService,
    councilRoomService,
    doctorService,
    getCurrentConfig,
    isDiagnosticMode: isDiagnosticModeEnabled,
    buildDiagnosticsSnapshot: (event, session, currentEndpoint, initialized, environment) =>
      buildDiagnosticsSnapshot(event, sessionManager.consumer, session, currentEndpoint, initialized, environment),
    localPanelProvider,
    disposables,
  };
}
