import test from "node:test";
import assert from "node:assert/strict";
import type { OperationalContextEnvelope } from "../../domain/operationalContext";

const SHAPE_SNAPSHOT = `{
  "authority_map": {
    "canonical_fields": "array",
    "conflict_flags": "array",
    "local_hint_fields": "array"
  },
  "issues": "array",
  "local_environment": {
    "active_file": "string",
    "branch": "string",
    "inspector_error": "null",
    "inspector_status": "string",
    "repo_root": "string",
    "timestamp": "string",
    "workspace_root": "string"
  },
  "meta": {
    "consumer": "string",
    "endpoint": "string",
    "fetched_at": "string",
    "load_state": "string",
    "runtime_mode": "string",
    "session_key": "string",
    "transport_status": "string"
  },
  "transport_diagnostics": {
    "endpoint": "string",
    "fetched_at": "string",
    "runtime_mode": "string",
    "timeout_ms": "number"
  },
  "wis_context": {
    "active_task": "null",
    "approved_decisions": "null",
    "context_snapshot": "null",
    "recent_errors": "null",
    "validation_status": "null"
  }
}`;

function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value !== "object") {
    return typeof value;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = shapeOf(record[key]);
  }
  return result;
}

test("snapshot de shape de OperationalContextEnvelope se mantiene estable", () => {
  const envelope: OperationalContextEnvelope = {
    meta: {
      consumer: "vscode_extension",
      session_key: "shape-session",
      endpoint: "http://localhost:8002/mcp",
      runtime_mode: "offline_fixture",
      fetched_at: "2026-03-31T10:00:00.000Z",
      transport_status: "ok",
      load_state: "loaded",
    },
    local_environment: {
      workspace_root: "/workspace",
      repo_root: "/workspace/repo",
      branch: "main",
      active_file: "/workspace/repo/src/file.ts",
      inspector_status: "ok",
      inspector_error: null,
      timestamp: "2026-03-31T10:00:00.000Z",
    },
    wis_context: {
      active_task: null,
      context_snapshot: null,
      validation_status: null,
      approved_decisions: null,
      recent_errors: null,
    },
    issues: [],
    authority_map: {
      canonical_fields: ["active_task"],
      local_hint_fields: ["active_file"],
      conflict_flags: [],
    },
    transport_diagnostics: {
      endpoint: "http://localhost:8002/mcp",
      runtime_mode: "offline_fixture",
      timeout_ms: 5000,
      fetched_at: "2026-03-31T10:00:00.000Z",
    },
  };

  const shape = shapeOf(envelope);
  assert.equal(JSON.stringify(shape, null, 2), SHAPE_SNAPSHOT);
});
