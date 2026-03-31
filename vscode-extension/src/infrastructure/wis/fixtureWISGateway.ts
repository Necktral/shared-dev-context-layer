import type { ToolResult, WISBundleResult, WISToolName } from "../../domain/operationalContext";
import { aggregateBundleStatus, failureToolResult, normalizeToolPayload } from "./normalizers";
import { WIS_TOOLS } from "./toolContracts";
import type { WISGateway, WISLoadInput } from "./wisGateway";

export type FixtureScenario =
  | "success_full"
  | "partial_missing_recent_errors"
  | "degraded_no_remote_bundle"
  | "transport_error"
  | "no_active_task"
  | "validation_stale";

const DEFAULT_SCOPE = {
  workspace_id: "ws-fixture-001",
  project_id: "prj-fixture-001",
  task_id: "task-fixture-001",
};

const DEFAULT_METADATA = {
  source: "fixture",
  fallback_level: "none",
  conflict_flags: [],
  requested: {},
  resolved_scope: DEFAULT_SCOPE,
};

function successPayload(tool: WISToolName): Record<string, unknown> {
  switch (tool) {
    case "get_active_task":
      return {
        status: "ok",
        task: {
          id: DEFAULT_SCOPE.task_id,
          title: "Fixture task",
          status: "in_progress",
          branch: "main",
        },
        scope: DEFAULT_SCOPE,
        resolution_metadata: DEFAULT_METADATA,
      };
    case "get_context_snapshot":
      return {
        status: "ok",
        task_id: DEFAULT_SCOPE.task_id,
        source: "fixture",
        scope: DEFAULT_SCOPE,
        consumer_context: {
          consumer_type: "vscode_extension",
          session_key: "fixture-session",
          session_status: "active",
        },
        resolution_metadata: DEFAULT_METADATA,
        snapshot: {
          identity: {
            task_id: DEFAULT_SCOPE.task_id,
            title: "Fixture task",
          },
          validation: {
            status: "passed",
          },
        },
        metadata: {
          policy: "delegated_limited",
          origin: "fixture",
          created_at: new Date().toISOString(),
        },
      };
    case "get_validation_status":
      return {
        status: "ok",
        task_id: DEFAULT_SCOPE.task_id,
        scope: DEFAULT_SCOPE,
        resolution_metadata: DEFAULT_METADATA,
        current_status: "passed",
        last_validation_type: "ci",
        last_validation_source: "fixture",
        last_validation_at: new Date().toISOString(),
        summary: "All checks passing.",
        details: {},
      };
    case "get_approved_decisions":
      return {
        status: "ok",
        task_id: DEFAULT_SCOPE.task_id,
        scope: DEFAULT_SCOPE,
        resolution_metadata: DEFAULT_METADATA,
        total: 2,
        decisions: [
          {
            id: "decision-1",
            decision_key: "read_only",
            title: "Read-only enforcement",
            decision: "No writes in extension",
          },
          {
            id: "decision-2",
            decision_key: "authoritative_wis",
            title: "WIS authority",
            decision: "WIS canonical context wins",
          },
        ],
      };
    case "get_recent_errors":
      return {
        status: "ok",
        task_id: DEFAULT_SCOPE.task_id,
        scope: DEFAULT_SCOPE,
        resolution_metadata: DEFAULT_METADATA,
        window_hours: 24,
        limit: 20,
        total: 0,
        errors: [],
      };
  }
}

function noActiveTaskPayload(): Record<string, unknown> {
  return {
    status: "no_active_task",
    scope: {
      ...DEFAULT_SCOPE,
      task_id: null,
    },
    resolution_metadata: {
      ...DEFAULT_METADATA,
      fallback_level: "project_only",
      resolved_scope: {
        ...DEFAULT_SCOPE,
        task_id: null,
      },
    },
  };
}

export class FixtureWISGateway implements WISGateway {
  constructor(private readonly scenario: FixtureScenario = "success_full") {}

  public async getActiveTask(input: WISLoadInput): Promise<ToolResult> {
    return this.runTool("get_active_task", input);
  }

  public async getContextSnapshot(input: WISLoadInput): Promise<ToolResult> {
    return this.runTool("get_context_snapshot", input);
  }

  public async getValidationStatus(input: WISLoadInput): Promise<ToolResult> {
    return this.runTool("get_validation_status", input);
  }

  public async getApprovedDecisions(input: WISLoadInput): Promise<ToolResult> {
    return this.runTool("get_approved_decisions", input);
  }

  public async getRecentErrors(input: WISLoadInput): Promise<ToolResult> {
    return this.runTool("get_recent_errors", input);
  }

  public async loadOperationalBundle(input: WISLoadInput): Promise<WISBundleResult> {
    const toolResults = {
      get_active_task: await this.getActiveTask(input),
      get_validation_status: await this.getValidationStatus(input),
      get_approved_decisions: await this.getApprovedDecisions(input),
      get_recent_errors: await this.getRecentErrors(input),
      get_context_snapshot: await this.getContextSnapshot(input),
    };

    const issues = WIS_TOOLS.flatMap((tool) => toolResults[tool].issues);

    return {
      status: aggregateBundleStatus(toolResults),
      tool_results: toolResults,
      transport_diagnostics: {
        endpoint: input.endpoint,
        runtime_mode: input.runtime_mode,
        timeout_ms: input.timeout_ms,
        fetched_at: new Date().toISOString(),
      },
      issues,
    };
  }

  private async runTool(tool: WISToolName, _input: WISLoadInput): Promise<ToolResult> {
    switch (this.scenario) {
      case "success_full":
        return normalizeToolPayload(tool, successPayload(tool));
      case "validation_stale": {
        if (tool === "get_validation_status") {
          return normalizeToolPayload(tool, {
            ...successPayload(tool),
            current_status: "stale",
            summary: "Validation result is stale.",
          });
        }
        return normalizeToolPayload(tool, successPayload(tool));
      }
      case "no_active_task":
        return normalizeToolPayload(tool, noActiveTaskPayload());
      case "partial_missing_recent_errors":
        if (tool === "get_recent_errors") {
          return failureToolResult(
            tool,
            "transport_error",
            "Fixture simula fallo de transporte en get_recent_errors.",
            "Escenario partial_missing_recent_errors.",
            null,
          );
        }
        return normalizeToolPayload(tool, successPayload(tool));
      case "transport_error":
        return failureToolResult(
          tool,
          "transport_error",
          "Fixture simula timeout de transporte.",
          "Escenario transport_error.",
          null,
        );
      case "degraded_no_remote_bundle":
        return failureToolResult(
          tool,
          "unavailable",
          "Fixture simula endpoint no disponible.",
          "Escenario degraded_no_remote_bundle.",
          null,
        );
      default:
        return failureToolResult(tool, "schema_error", "Escenario fixture desconocido.", "Verificar fixtureScenario.", null);
    }
  }
}
