import { CANONICAL_WIS_FIELDS, collectAuthorityConflictFlags, LOCAL_HINT_FIELDS } from "../domain/authorityRules";
import type { OperationalIssue } from "../domain/errorModel";
import type {
  LocalEnvironmentContext,
  OperationalContextEnvelope,
  RuntimeMode,
  SessionInfo,
  ToolResult,
  WISBundleResult,
  WISContext,
} from "../domain/operationalContext";
import type { LoadState, TransportStatus } from "../domain/loadState";

export interface ComposeOperationalContextInput {
  session: SessionInfo;
  endpoint: string;
  runtime_mode: RuntimeMode;
  local_environment: LocalEnvironmentContext;
  bundle: WISBundleResult;
}

function isLocalEnvironmentUsable(localEnvironment: LocalEnvironmentContext): boolean {
  return Boolean(localEnvironment.workspace_root || localEnvironment.repo_root || localEnvironment.active_file);
}

function classifyTransportStatus(bundle: WISBundleResult): TransportStatus {
  const allResults = Object.values(bundle.tool_results);

  if (bundle.status === "success") {
    return "ok";
  }
  if (allResults.some((result) => result.kind === "schema_error")) {
    return "schema_error";
  }
  if (allResults.some((result) => result.kind === "transport_error")) {
    return "transport_error";
  }
  if (bundle.status === "partial") {
    return "partial";
  }
  if (allResults.some((result) => result.kind === "unavailable")) {
    return "unavailable";
  }
  return "degraded";
}

function classifyLoadState(bundle: WISBundleResult, localEnvironment: LocalEnvironmentContext): LoadState {
  const allResults = Object.values(bundle.tool_results);
  const okAndConsistent = allResults.filter((result) => result.kind === "ok" && result.status === "ok").length;
  const remotelyUsable = allResults.filter((result) => result.kind === "ok" || result.kind === "remote_error").length;

  if (okAndConsistent === allResults.length) {
    return "loaded";
  }
  if (remotelyUsable > 0) {
    return "partially_loaded";
  }
  if (isLocalEnvironmentUsable(localEnvironment)) {
    return "degraded";
  }
  return "failed";
}

function localIssues(localEnvironment: LocalEnvironmentContext): OperationalIssue[] {
  if (localEnvironment.inspector_status === "ok") {
    return [];
  }

  const messageByStatus: Record<LocalEnvironmentContext["inspector_status"], string> = {
    ok: "Inspector local operativo.",
    no_workspace: "No hay workspace abierto para inspección local.",
    no_repo: "No se encontró repositorio Git desde el contexto activo.",
    error: localEnvironment.inspector_error ?? "Fallo de inspector local no clasificado.",
  };

  const severity: "warning" | "error" = localEnvironment.inspector_status === "error" ? "error" : "warning";

  return [
    {
      kind: "local",
      source: "environment_inspector",
      severity,
      message: messageByStatus[localEnvironment.inspector_status],
      recoverable: true,
      evidence_hint: "Validar workspace abierto, repo Git y archivo activo en VS Code.",
    },
  ];
}

function validationStaleIssue(validationStatus: ToolResult | null): OperationalIssue[] {
  if (!validationStatus || !validationStatus.payload) {
    return [];
  }

  const currentStatus = (validationStatus.payload as { current_status?: unknown }).current_status;
  if (currentStatus !== "stale") {
    return [];
  }

  return [
    {
      kind: "domain",
      source: "get_validation_status",
      severity: "warning",
      message: "Validation status reportado como stale.",
      recoverable: true,
      evidence_hint: "Ejecutar una nueva validación en WIS/backend para refrescar estado.",
      conflict_flag: "validation_stale",
    },
  ];
}

function mapWisContext(bundle: WISBundleResult): WISContext {
  return {
    active_task: bundle.tool_results.get_active_task,
    context_snapshot: bundle.tool_results.get_context_snapshot,
    validation_status: bundle.tool_results.get_validation_status,
    approved_decisions: bundle.tool_results.get_approved_decisions,
    recent_errors: bundle.tool_results.get_recent_errors,
  };
}

export function composeOperationalContext(input: ComposeOperationalContextInput): OperationalContextEnvelope {
  const wisContext = mapWisContext(input.bundle);
  const loadState = classifyLoadState(input.bundle, input.local_environment);
  const transportStatus = classifyTransportStatus(input.bundle);

  const authorityConflictFlags = collectAuthorityConflictFlags(input.local_environment, wisContext);
  const authorityIssues: OperationalIssue[] = authorityConflictFlags
    .filter((flag) => flag === "local_branch_vs_wis_branch_mismatch")
    .map((flag) => ({
      kind: "domain",
      source: "authority_map",
      severity: "warning",
      message: "Branch local difiere de la branch reportada por WIS active_task.",
      recoverable: true,
      evidence_hint: "Revisar checkout local vs contexto canónico remoto.",
      conflict_flag: flag,
    }));

  const issues = [
    ...input.bundle.issues,
    ...localIssues(input.local_environment),
    ...validationStaleIssue(wisContext.validation_status),
    ...authorityIssues,
  ];

  return {
    meta: {
      consumer: input.session.consumer,
      session_key: input.session.session_key,
      endpoint: input.endpoint,
      runtime_mode: input.runtime_mode,
      fetched_at: input.bundle.transport_diagnostics.fetched_at,
      transport_status: transportStatus,
      load_state: loadState,
    },
    local_environment: input.local_environment,
    wis_context: wisContext,
    issues,
    authority_map: {
      canonical_fields: [...CANONICAL_WIS_FIELDS],
      local_hint_fields: [...LOCAL_HINT_FIELDS],
      conflict_flags: authorityConflictFlags,
    },
    transport_diagnostics: input.bundle.transport_diagnostics,
  };
}
