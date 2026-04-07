import type { RuntimeMode } from "../../domain/operationalContext";
import { RuntimeAuthPolicy, type RuntimeAuthContext } from "../../auth/runtimeAuthPolicy";
import { WorkspaceBoundaryGuard } from "../security/workspaceBoundaryGuard";

export type DoctorLevel = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  level: DoctorLevel;
  message: string;
  details?: Record<string, unknown>;
}

export interface DoctorEnvironmentSnapshot {
  workspace_root: string | null;
  repo_root: string | null;
  active_file: string | null;
  inspector_status: string;
  inspector_error: string | null;
}

export interface DoctorPersistenceSnapshot {
  dbStatus: string;
  reason?: string | null;
}

export interface LocalDoctorDeps {
  inspectEnvironment(): Promise<DoctorEnvironmentSnapshot>;
  resolveAuth(): Promise<RuntimeAuthContext>;
  getPersistenceSnapshot(): DoctorPersistenceSnapshot;
  getRuntimeMode(): RuntimeMode;
  getOperationProfile(): string;
}

export interface LocalDoctorReport {
  overall: DoctorLevel;
  checks: DoctorCheck[];
  generated_at: string;
}

export class LocalDoctorService {
  constructor(
    private readonly deps: LocalDoctorDeps,
    private readonly boundaryGuard: WorkspaceBoundaryGuard,
    private readonly authPolicy: RuntimeAuthPolicy,
  ) {}

  public async run(): Promise<LocalDoctorReport> {
    const checks: DoctorCheck[] = [];
    const environment = await this.deps.inspectEnvironment();
    const auth = await this.deps.resolveAuth();
    const persistence = this.deps.getPersistenceSnapshot();

    if (environment.inspector_status === "error") {
      checks.push({
        id: "environment.inspect",
        level: "fail",
        message: "EnvironmentInspector devolvió error.",
        details: { inspector_error: environment.inspector_error },
      });
    } else if (environment.inspector_status === "no_workspace" || environment.inspector_status === "no_repo") {
      checks.push({
        id: "environment.inspect",
        level: "warn",
        message: `EnvironmentInspector en estado ${environment.inspector_status}.`,
        details: {
          workspace_root: environment.workspace_root,
          repo_root: environment.repo_root,
          active_file: environment.active_file,
        },
      });
    } else {
      checks.push({
        id: "environment.inspect",
        level: "pass",
        message: "EnvironmentInspector operativo.",
      });
    }

    try {
      this.boundaryGuard.assertSnapshot({
        workspaceRoot: environment.workspace_root,
        repoRoot: environment.repo_root,
        activeFile: environment.active_file,
      });

      checks.push({
        id: "workspace.boundary",
        level: "pass",
        message: "workspace/repo/active_file respetan límites.",
      });
    } catch (error) {
      checks.push({
        id: "workspace.boundary",
        level: "fail",
        message: error instanceof Error ? error.message : "Boundary guard failure.",
      });
    }

    const authDecision = this.authPolicy.evaluate(auth);
    checks.push({
      id: "auth.policy",
      level: authDecision.allowed ? "pass" : "fail",
      message: authDecision.message,
      details: {
        code: authDecision.code,
        mode: auth.mode,
        required: auth.required,
      },
    });

    if (this.deps.getOperationProfile() === "local_private") {
      checks.push({
        id: "local.db",
        level: persistence.dbStatus === "connected" ? "pass" : "warn",
        message:
          persistence.dbStatus === "connected"
            ? "Persistencia local conectada."
            : "Persistencia local no conectada.",
        details: {
          dbStatus: persistence.dbStatus,
          reason: persistence.reason ?? null,
        },
      });
    }

    const runtimeMode = this.deps.getRuntimeMode();
    checks.push({
      id: "runtime.mode",
      level: runtimeMode === "mcp" || runtimeMode === "offline_fixture" ? "pass" : "warn",
      message: `runtimeMode=${runtimeMode}`,
    });

    const overall: DoctorLevel = checks.some((check) => check.level === "fail")
      ? "fail"
      : checks.some((check) => check.level === "warn")
        ? "warn"
        : "pass";

    return {
      overall,
      checks,
      generated_at: new Date().toISOString(),
    };
  }
}
