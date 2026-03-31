import type { OperationalContextEnvelope, ToolResult } from "../domain/operationalContext";

export interface ViewEntry {
  label: string;
  value: string;
}

export interface ViewSection {
  title: string;
  entries: ViewEntry[];
}

export interface OperationalContextViewModel {
  title: string;
  sections: ViewSection[];
}

function safeString(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function summarizeTool(result: ToolResult | null): string {
  if (!result) {
    return "unavailable";
  }
  if (result.kind === "ok" && result.status === "ok") {
    return "ok";
  }
  if (result.kind === "remote_error" && result.status) {
    return result.status;
  }
  return result.kind;
}

export class ViewModelMapper {
  public map(envelope: OperationalContextEnvelope): OperationalContextViewModel {
    return {
      title: "Operational Context Envelope",
      sections: [
        {
          title: "Session",
          entries: [
            { label: "consumer", value: envelope.meta.consumer },
            { label: "session_key", value: envelope.meta.session_key },
            { label: "endpoint", value: envelope.meta.endpoint },
            { label: "runtime_mode", value: envelope.meta.runtime_mode },
            { label: "fetched_at", value: envelope.meta.fetched_at },
          ],
        },
        {
          title: "Local Environment",
          entries: [
            { label: "workspace_root", value: safeString(envelope.local_environment.workspace_root) },
            { label: "repo_root", value: safeString(envelope.local_environment.repo_root) },
            { label: "branch", value: safeString(envelope.local_environment.branch) },
            { label: "active_file", value: safeString(envelope.local_environment.active_file) },
            { label: "inspector_status", value: envelope.local_environment.inspector_status },
            { label: "inspector_error", value: safeString(envelope.local_environment.inspector_error) },
          ],
        },
        {
          title: "Active Task",
          entries: [
            { label: "tool_status", value: summarizeTool(envelope.wis_context.active_task) },
            {
              label: "task",
              value: safeString(envelope.wis_context.active_task?.payload?.task ?? null),
            },
          ],
        },
        {
          title: "Validation",
          entries: [
            { label: "tool_status", value: summarizeTool(envelope.wis_context.validation_status) },
            {
              label: "current_status",
              value: safeString(envelope.wis_context.validation_status?.payload?.current_status ?? null),
            },
          ],
        },
        {
          title: "Approved Decisions",
          entries: [
            { label: "tool_status", value: summarizeTool(envelope.wis_context.approved_decisions) },
            {
              label: "total",
              value: safeString(envelope.wis_context.approved_decisions?.payload?.total ?? null),
            },
          ],
        },
        {
          title: "Recent Errors",
          entries: [
            { label: "tool_status", value: summarizeTool(envelope.wis_context.recent_errors) },
            {
              label: "total",
              value: safeString(envelope.wis_context.recent_errors?.payload?.total ?? null),
            },
          ],
        },
        {
          title: "Load State",
          entries: [
            { label: "transport_status", value: envelope.meta.transport_status },
            { label: "load_state", value: envelope.meta.load_state },
          ],
        },
        {
          title: "Issues",
          entries: envelope.issues.length
            ? envelope.issues.map((issue, index) => ({
                label: `issue_${index + 1}`,
                value: `${issue.severity}/${issue.kind} ${issue.source}: ${issue.message}`,
              }))
            : [{ label: "issues", value: "none" }],
        },
      ],
    };
  }
}
