import { composeOperationalContext } from "./composeOperationalContext";
import type { LocalEnvironmentContext, OperationalContextEnvelope, RuntimeMode, SessionInfo, WISBundleResult } from "../domain/operationalContext";
import { failureToolResult } from "../infrastructure/wis/normalizers";
import { WIS_TOOLS } from "../infrastructure/wis/toolContracts";
import type { WISGateway } from "../infrastructure/wis/wisGateway";
import type { FixtureScenario } from "../infrastructure/wis/fixtureWISGateway";
import type { EnvironmentSnapshot } from "../environment/environmentInspector";
import type { SessionSnapshot } from "../sessionManager";
import type { LoadEvent } from "../diagnostics/loadEvents";
import type { OperationalContextStorePort } from "./operationalContextStore";

export interface SessionManagerPort {
  consumer: string;
  getOrCreateSession(): Promise<SessionSnapshot>;
}

export interface EnvironmentInspectorPort {
  inspect(): Promise<EnvironmentSnapshot>;
}

export interface LoadContextConfig {
  endpoint: string;
  runtimeMode: RuntimeMode;
  timeoutMs: number;
  fixtureScenario: FixtureScenario;
  diagnosticMode: boolean;
}

export interface LoadOperationalContextDependencies {
  sessionManager: SessionManagerPort;
  environmentInspector: EnvironmentInspectorPort;
  diagnostics: DiagnosticsPort;
  presenter: PresenterPort;
  contextStore?: OperationalContextStorePort;
  getConfig: () => LoadContextConfig;
  createGateway: (config: LoadContextConfig) => WISGateway;
}

export interface DiagnosticsPort {
  reportLoadEvent(event: LoadEvent): void;
  reportOperationalEnvelope(envelope: OperationalContextEnvelope, detailed: boolean): void;
}

export interface PresenterPort {
  present(envelope: OperationalContextEnvelope): void;
}

function mapSession(session: SessionSnapshot, consumer: string): SessionInfo {
  return {
    consumer,
    session_key: session.sessionKey,
    session_created_at: session.sessionCreatedAt,
    session_state: session.sessionState,
  };
}

function mapEnvironment(snapshot: EnvironmentSnapshot): LocalEnvironmentContext {
  return {
    workspace_root: snapshot.workspace_root,
    repo_root: snapshot.repo_root,
    branch: snapshot.branch,
    active_file: snapshot.active_file,
    inspector_status: snapshot.inspector_status,
    inspector_error: snapshot.inspector_error,
    timestamp: snapshot.timestamp,
  };
}

function failedBundle(config: LoadContextConfig, message: string): WISBundleResult {
  const toolResults = {
    get_active_task: failureToolResult("get_active_task", "transport_error", message, "Fallo inesperado en orquestación.", null),
    get_context_snapshot: failureToolResult("get_context_snapshot", "transport_error", message, "Fallo inesperado en orquestación.", null),
    get_validation_status: failureToolResult("get_validation_status", "transport_error", message, "Fallo inesperado en orquestación.", null),
    get_approved_decisions: failureToolResult("get_approved_decisions", "transport_error", message, "Fallo inesperado en orquestación.", null),
    get_recent_errors: failureToolResult("get_recent_errors", "transport_error", message, "Fallo inesperado en orquestación.", null),
  };

  return {
    status: "failure",
    tool_results: toolResults,
    transport_diagnostics: {
      endpoint: config.endpoint,
      runtime_mode: config.runtimeMode,
      timeout_ms: config.timeoutMs,
      fetched_at: new Date().toISOString(),
      available_tools: [],
      missing_tools: [...WIS_TOOLS],
    },
    issues: WIS_TOOLS.flatMap((tool) => toolResults[tool].issues),
  };
}

export class LoadOperationalContextService {
  constructor(private readonly deps: LoadOperationalContextDependencies) {}

  public async load(): Promise<OperationalContextEnvelope> {
    const config = this.deps.getConfig();
    this.deps.diagnostics.reportLoadEvent({
      event: "load_started",
      state: "preparing",
      timestamp: new Date().toISOString(),
      details: {
        endpoint: config.endpoint,
        runtime_mode: config.runtimeMode,
        timeout_ms: config.timeoutMs,
      },
    });

    const sessionSnapshot = await this.deps.sessionManager.getOrCreateSession();
    const session = mapSession(sessionSnapshot, this.deps.sessionManager.consumer);

    const environmentSnapshot = await this.deps.environmentInspector.inspect();
    const localEnvironment = mapEnvironment(environmentSnapshot);

    this.deps.diagnostics.reportLoadEvent({
      event: "local_inspection_completed",
      state: "inspecting_local",
      timestamp: new Date().toISOString(),
      details: {
        inspector_status: localEnvironment.inspector_status,
        workspace_root: localEnvironment.workspace_root,
        repo_root: localEnvironment.repo_root,
      },
    });

    const gateway = this.deps.createGateway(config);
    let bundle: WISBundleResult;

    try {
      bundle = await gateway.loadOperationalBundle({
        endpoint: config.endpoint,
        runtime_mode: config.runtimeMode,
        timeout_ms: config.timeoutMs,
        consumer: session.consumer,
        session_key: session.session_key,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      bundle = failedBundle(config, message);
    }

    this.deps.diagnostics.reportLoadEvent({
      event: "wis_bundle_loaded",
      state: "loading_remote",
      timestamp: new Date().toISOString(),
      details: {
        bundle_status: bundle.status,
        transport_endpoint: bundle.transport_diagnostics.endpoint,
      },
    });

    const envelope = composeOperationalContext({
      session,
      endpoint: config.endpoint,
      runtime_mode: config.runtimeMode,
      local_environment: localEnvironment,
      bundle,
    });

    this.deps.diagnostics.reportOperationalEnvelope(envelope, config.diagnosticMode);

    this.deps.contextStore?.setLast(envelope);

    this.deps.presenter.present(envelope);

    this.deps.diagnostics.reportLoadEvent({
      event: "load_completed",
      state: envelope.meta.load_state,
      timestamp: new Date().toISOString(),
      details: {
        transport_status: envelope.meta.transport_status,
        issue_count: envelope.issues.length,
      },
    });

    return envelope;
  }
}
