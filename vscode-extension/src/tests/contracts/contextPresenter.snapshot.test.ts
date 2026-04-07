import test from "node:test";
import assert from "node:assert/strict";
import { ContextPresenter } from "../../presentation/contextPresenter";
import { OutputChannelRenderer } from "../../presentation/renderers/outputChannelRenderer";
import { ViewModelMapper } from "../../presentation/viewModels";
import type { OperationalContextEnvelope } from "../../domain/operationalContext";

const RENDER_SNAPSHOT = `[WIS] load_operational_context
Operational Context Envelope

== Session ==
consumer: vscode_extension
session_key: snapshot-session
endpoint: http://localhost:8002/mcp
runtime_mode: offline_fixture
fetched_at: 2026-03-31T10:00:00.000Z

== Local Environment ==
workspace_root: /workspace
repo_root: /workspace/repo
branch: main
active_file: /workspace/repo/src/extension.ts
inspector_status: ok
inspector_error: null

== Active Task ==
tool_status: unavailable
task: null

== Validation ==
tool_status: unavailable
current_status: null

== Approved Decisions ==
tool_status: unavailable
total: null

== Recent Errors ==
tool_status: unavailable
total: null

== Load State ==
transport_status: transport_error
load_state: degraded

== Diagnostics ==
runtime_mode: offline_fixture
transport_status: transport_error
load_state: degraded
issue_count: 1
issue_origin_summary: local:0, transport:1, protocol:0, domain:0, presentation:0

== Issues ==
issue_1: error/transport get_active_task: Timeout MCP

`;

const envelope: OperationalContextEnvelope = {
  meta: {
    consumer: "vscode_extension",
    session_key: "snapshot-session",
    endpoint: "http://localhost:8002/mcp",
    runtime_mode: "offline_fixture",
    fetched_at: "2026-03-31T10:00:00.000Z",
    transport_status: "transport_error",
    load_state: "degraded",
  },
  local_environment: {
    workspace_root: "/workspace",
    repo_root: "/workspace/repo",
    branch: "main",
    active_file: "/workspace/repo/src/extension.ts",
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
  issues: [
    {
      kind: "transport",
      source: "get_active_task",
      severity: "error",
      message: "Timeout MCP",
      recoverable: true,
      evidence_hint: "retry",
    },
  ],
  authority_map: {
    canonical_fields: [],
    local_hint_fields: [],
    conflict_flags: [],
  },
  transport_diagnostics: {
    endpoint: "http://localhost:8002/mcp",
    runtime_mode: "offline_fixture",
    timeout_ms: 5000,
    fetched_at: "2026-03-31T10:00:00.000Z",
  },
};

test("snapshot del renderer de contexto se mantiene estable", () => {
  const lines: string[] = [];
  const output = {
    appendLine(line: string) {
      lines.push(line);
    },
    show() {
      return undefined;
    },
  };

  const presenter = new ContextPresenter(
    new ViewModelMapper(),
    new OutputChannelRenderer(output as never),
  );

  presenter.present(envelope);
  assert.equal(`${lines.join("\n")}\n`, RENDER_SNAPSHOT);
});
