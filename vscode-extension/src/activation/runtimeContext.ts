import type * as vscode from "vscode";
import type { LoadContextConfig } from "../application/loadOperationalContextService";
import type { ConfiguredHandoffTarget } from "../config";
import { ContextCommandService } from "../application/contextCommandService";
import { AuthManager } from "../auth/authManager";
import { RuntimeAuthPolicy } from "../auth/runtimeAuthPolicy";
import type { DiagnosticsSnapshot } from "../diagnostics";
import { DiagnosticsReporter } from "../diagnostics";
import { EnvironmentInspector } from "../environment/environmentInspector";
import type { EnvironmentSnapshot } from "../environment/environmentInspector";
import { InMemoryLocalRuntimeStore } from "../local/localRuntimeStore";
import { LocalCommandService } from "../local/localCommandService";
import { SessionManager } from "../sessionManager";
import type { SessionSnapshot } from "../sessionManager";
import { LoadOperationalContextService } from "../application/loadOperationalContextService";
import { InMemoryOperationalContextStore } from "../application/operationalContextStore";
import { HandoffBuilder } from "../application/handoffBuilder";
import { ContextCommandOutputRenderer } from "../presentation/renderers/contextCommandOutputRenderer";
import { LocalRuntimeOutputRenderer } from "../presentation/renderers/localRuntimeOutputRenderer";
import { LocalDoctorService } from "../platform/doctor/localDoctorService";
import { LocalRuntimePanelProvider } from "../presentation/local/localRuntimePanelProvider";

export interface ExtensionRuntimeContext {
  outputChannel: vscode.OutputChannel;
  sessionManager: SessionManager;
  environmentInspector: EnvironmentInspector;
  diagnostics: DiagnosticsReporter;
  contextStore: InMemoryOperationalContextStore;
  loadService: LoadOperationalContextService;
  handoffBuilder: HandoffBuilder;
  authManager: AuthManager;
  authPolicy: RuntimeAuthPolicy;
  contextCommandService: ContextCommandService;
  contextCommandRenderer: ContextCommandOutputRenderer;
  localStore: InMemoryLocalRuntimeStore;
  localOutputRenderer: LocalRuntimeOutputRenderer;
  localCommandService: LocalCommandService;
  doctorService: LocalDoctorService;
  getConfiguredHandoffTarget: () => ConfiguredHandoffTarget;
  getCurrentConfig: () => LoadContextConfig;
  isDiagnosticMode: () => boolean;
  buildDiagnosticsSnapshot: (
    event: string,
    session: SessionSnapshot,
    endpoint: string,
    initialized: boolean,
    environment?: EnvironmentSnapshot,
  ) => DiagnosticsSnapshot;
}

export interface ExtensionBootstrapResult extends ExtensionRuntimeContext {
  localPanelProvider: LocalRuntimePanelProvider;
  disposables: vscode.Disposable[];
}
