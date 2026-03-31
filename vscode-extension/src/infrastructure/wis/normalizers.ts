import type { OperationalIssue } from "../../domain/errorModel";
import type { ToolResult, ToolResultKind, WISBundleResult, WISToolName, WISToolStatus } from "../../domain/operationalContext";
import { hasRequiredFields, isKnownRemoteStatus, isObjectRecord, requiredFieldsForStatus, WIS_TOOLS } from "./toolContracts";

function schemaIssue(source: string, message: string, evidenceHint: string): OperationalIssue {
  return {
    kind: "protocol",
    source,
    severity: "error",
    message,
    recoverable: false,
    evidence_hint: evidenceHint,
  };
}

function transportIssue(kind: "transport" | "protocol", source: string, message: string, evidenceHint: string): OperationalIssue {
  return {
    kind,
    source,
    severity: "error",
    message,
    recoverable: true,
    evidence_hint: evidenceHint,
  };
}

function remoteDomainIssue(tool: WISToolName, status: WISToolStatus, payload: Record<string, unknown>): OperationalIssue {
  const metadata = payload.resolution_metadata;
  const conflictFlags = isObjectRecord(metadata) && Array.isArray(metadata.conflict_flags)
    ? metadata.conflict_flags.filter((value): value is string => typeof value === "string")
    : [];

  return {
    kind: "domain",
    source: tool,
    severity: status === "scope_conflict" ? "error" : "warning",
    message: `WIS respondió estado no-ok: ${status}`,
    recoverable: status !== "scope_invalid",
    evidence_hint: "Revisar status/scope/resolution_metadata del payload canónico.",
    conflict_flag: conflictFlags[0],
  };
}

export function normalizeToolPayload(tool: WISToolName, rawPayload: unknown): ToolResult {
  if (!isObjectRecord(rawPayload)) {
    return {
      tool,
      kind: "schema_error",
      status: null,
      payload: null,
      issues: [schemaIssue(tool, "Payload MCP no es objeto.", "El structuredContent esperado no llegó como objeto JSON.")],
      raw: rawPayload,
    };
  }

  const statusValue = rawPayload.status;
  if (!isKnownRemoteStatus(statusValue)) {
    return {
      tool,
      kind: "schema_error",
      status: null,
      payload: null,
      issues: [schemaIssue(tool, "Campo status ausente o desconocido.", "Verificar contrato MCP de la tool y normalizador cliente.")],
      raw: rawPayload,
    };
  }

  const requiredFields = requiredFieldsForStatus(tool, statusValue);
  if (!hasRequiredFields(rawPayload, requiredFields)) {
    return {
      tool,
      kind: "schema_error",
      status: statusValue,
      payload: null,
      issues: [
        schemaIssue(
          tool,
          `Payload incompleto para status=${statusValue}.`,
          `Campos requeridos: ${requiredFields.join(", ")}`,
        ),
      ],
      raw: rawPayload,
    };
  }

  if (statusValue === "ok") {
    return {
      tool,
      kind: "ok",
      status: statusValue,
      payload: rawPayload,
      issues: [],
      raw: rawPayload,
    };
  }

  return {
    tool,
    kind: "remote_error",
    status: statusValue,
    payload: rawPayload,
    issues: [remoteDomainIssue(tool, statusValue, rawPayload)],
    raw: rawPayload,
  };
}

export function failureToolResult(
  tool: WISToolName,
  kind: Extract<ToolResultKind, "transport_error" | "schema_error" | "unavailable">,
  message: string,
  evidenceHint: string,
  raw: unknown,
): ToolResult {
  return {
    tool,
    kind,
    status: null,
    payload: null,
    issues: [transportIssue(kind === "schema_error" ? "protocol" : "transport", tool, message, evidenceHint)],
    raw,
  };
}

export function extractStructuredPayload(response: unknown): unknown {
  if (!isObjectRecord(response)) {
    return response;
  }

  if (isObjectRecord(response.structuredContent)) {
    return response.structuredContent;
  }

  if (isObjectRecord(response.toolResult)) {
    return response.toolResult;
  }

  if (Array.isArray(response.content)) {
    const textChunk = response.content.find(
      (item) => isObjectRecord(item) && item.type === "text" && typeof item.text === "string",
    ) as { text?: string } | undefined;

    if (textChunk?.text) {
      try {
        return JSON.parse(textChunk.text) as unknown;
      } catch {
        return response;
      }
    }
  }

  return response;
}

export function aggregateBundleStatus(toolResults: Record<WISToolName, ToolResult>): WISBundleResult["status"] {
  const values = WIS_TOOLS.map((tool) => toolResults[tool]);
  const okResponses = values.filter((result) => result.kind === "ok" && result.status === "ok").length;
  const remotelyUnderstandable = values.filter((result) => result.kind === "ok" || result.kind === "remote_error").length;

  if (okResponses === WIS_TOOLS.length) {
    return "success";
  }
  if (remotelyUnderstandable > 0) {
    return "partial";
  }
  return "failure";
}
