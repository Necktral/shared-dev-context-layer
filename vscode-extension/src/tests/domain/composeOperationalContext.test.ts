import test from "node:test";
import assert from "node:assert/strict";
import { composeOperationalContext } from "../../application/composeOperationalContext";
import type { ToolResult, WISBundleResult, WISToolName } from "../../domain/operationalContext";

const session = {
  consumer: "vscode_extension",
  session_key: "session-1",
  session_created_at: new Date().toISOString(),
  session_state: "reused" as const,
};

const baseLocalEnvironment = {
  workspace_root: "/workspace",
  repo_root: "/workspace/repo",
  branch: "main",
  active_file: "/workspace/repo/src/extension.ts",
  inspector_status: "ok" as const,
  inspector_error: null,
  timestamp: new Date().toISOString(),
};

function makeToolResult(tool: WISToolName, kind: ToolResult["kind"], status: ToolResult["status"], payload: Record<string, unknown>): ToolResult {
  return {
    tool,
    kind,
    status,
    payload,
    issues: [],
    raw: payload,
  };
}

function fullOkBundle(): WISBundleResult {
  const resolution = {
    source: "fixture",
    fallback_level: "none",
    conflict_flags: [],
    requested: {},
    resolved_scope: {
      workspace_id: "ws",
      project_id: "prj",
      task_id: "task",
    },
  };

  const activePayload = {
    status: "ok",
    scope: resolution.resolved_scope,
    resolution_metadata: resolution,
    task: {
      id: "task",
      branch: "main",
      title: "Task",
    },
  };

  return {
    status: "success",
    tool_results: {
      get_active_task: makeToolResult("get_active_task", "ok", "ok", activePayload),
      get_context_snapshot: makeToolResult("get_context_snapshot", "ok", "ok", {
        status: "ok",
        scope: resolution.resolved_scope,
        resolution_metadata: resolution,
        snapshot: {},
        metadata: {},
        consumer_context: {},
      }),
      get_validation_status: makeToolResult("get_validation_status", "ok", "ok", {
        status: "ok",
        scope: resolution.resolved_scope,
        resolution_metadata: resolution,
        current_status: "passed",
      }),
      get_approved_decisions: makeToolResult("get_approved_decisions", "ok", "ok", {
        status: "ok",
        scope: resolution.resolved_scope,
        resolution_metadata: resolution,
        total: 0,
        decisions: [],
      }),
      get_recent_errors: makeToolResult("get_recent_errors", "ok", "ok", {
        status: "ok",
        scope: resolution.resolved_scope,
        resolution_metadata: resolution,
        total: 0,
        errors: [],
      }),
    },
    transport_diagnostics: {
      endpoint: "http://localhost:8002/mcp",
      runtime_mode: "offline_fixture",
      timeout_ms: 5000,
      fetched_at: new Date().toISOString(),
    },
    issues: [],
  };
}

test("composeOperationalContext clasifica loaded cuando todo está ok", () => {
  const envelope = composeOperationalContext({
    session,
    endpoint: "http://localhost:8002/mcp",
    runtime_mode: "offline_fixture",
    local_environment: baseLocalEnvironment,
    bundle: fullOkBundle(),
  });

  assert.equal(envelope.meta.load_state, "loaded");
  assert.equal(envelope.meta.transport_status, "ok");
  assert.equal(envelope.issues.length, 0);
});

test("composeOperationalContext clasifica partially_loaded con remote_error parcial", () => {
  const bundle = fullOkBundle();
  bundle.status = "partial";
  bundle.tool_results.get_recent_errors = {
    ...bundle.tool_results.get_recent_errors,
    kind: "remote_error",
    status: "no_active_task",
  };

  const envelope = composeOperationalContext({
    session,
    endpoint: "http://localhost:8002/mcp",
    runtime_mode: "offline_fixture",
    local_environment: baseLocalEnvironment,
    bundle,
  });

  assert.equal(envelope.meta.load_state, "partially_loaded");
});

test("composeOperationalContext clasifica degraded cuando no hay remoto útil pero sí señales locales", () => {
  const bundle = fullOkBundle();
  bundle.status = "failure";
  for (const tool of Object.keys(bundle.tool_results) as WISToolName[]) {
    bundle.tool_results[tool] = {
      ...bundle.tool_results[tool],
      kind: "unavailable",
      status: null,
      payload: null,
    };
  }

  const envelope = composeOperationalContext({
    session,
    endpoint: "http://localhost:8002/mcp",
    runtime_mode: "mcp",
    local_environment: baseLocalEnvironment,
    bundle,
  });

  assert.equal(envelope.meta.load_state, "degraded");
  assert.equal(envelope.meta.transport_status, "unavailable");
});

test("composeOperationalContext clasifica failed sin remoto útil y sin señales locales", () => {
  const bundle = fullOkBundle();
  bundle.status = "failure";
  for (const tool of Object.keys(bundle.tool_results) as WISToolName[]) {
    bundle.tool_results[tool] = {
      ...bundle.tool_results[tool],
      kind: "transport_error",
      status: null,
      payload: null,
    };
  }

  const envelope = composeOperationalContext({
    session,
    endpoint: "http://localhost:8002/mcp",
    runtime_mode: "mcp",
    local_environment: {
      ...baseLocalEnvironment,
      workspace_root: null,
      repo_root: null,
      active_file: null,
      branch: null,
      inspector_status: "no_workspace",
    },
    bundle,
  });

  assert.equal(envelope.meta.load_state, "failed");
});

test("composeOperationalContext registra conflict_flag cuando branch local difiere de WIS", () => {
  const bundle = fullOkBundle();
  bundle.tool_results.get_active_task.payload = {
    ...(bundle.tool_results.get_active_task.payload ?? {}),
    task: {
      id: "task",
      branch: "release",
      title: "Task",
    },
  };

  const envelope = composeOperationalContext({
    session,
    endpoint: "http://localhost:8002/mcp",
    runtime_mode: "offline_fixture",
    local_environment: {
      ...baseLocalEnvironment,
      branch: "main",
    },
    bundle,
  });

  assert.ok(envelope.authority_map.conflict_flags.includes("local_branch_vs_wis_branch_mismatch"));
});
