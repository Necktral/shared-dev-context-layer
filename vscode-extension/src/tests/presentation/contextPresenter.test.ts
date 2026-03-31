import test from "node:test";
import assert from "node:assert/strict";
import { ContextPresenter } from "../../presentation/contextPresenter";
import { OutputChannelRenderer } from "../../presentation/renderers/outputChannelRenderer";
import { ViewModelMapper } from "../../presentation/viewModels";
import type { OperationalContextEnvelope } from "../../domain/operationalContext";

const envelope: OperationalContextEnvelope = {
  meta: {
    consumer: "vscode_extension",
    session_key: "session-1",
    endpoint: "http://localhost:8002/mcp",
    runtime_mode: "offline_fixture",
    fetched_at: new Date().toISOString(),
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
    timestamp: new Date().toISOString(),
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
    fetched_at: new Date().toISOString(),
  },
};

test("ContextPresenter renderiza secciones obligatorias en output channel", () => {
  const lines: string[] = [];
  const fakeOutput = {
    appendLine(value: string) {
      lines.push(value);
    },
    show() {
      return undefined;
    },
  };

  const presenter = new ContextPresenter(
    new ViewModelMapper(),
    new OutputChannelRenderer(fakeOutput as never),
  );

  presenter.present(envelope);

  assert.ok(lines.some((line) => line.includes("== Session ==")));
  assert.ok(lines.some((line) => line.includes("== Local Environment ==")));
  assert.ok(lines.some((line) => line.includes("== Active Task ==")));
  assert.ok(lines.some((line) => line.includes("== Validation ==")));
  assert.ok(lines.some((line) => line.includes("== Approved Decisions ==")));
  assert.ok(lines.some((line) => line.includes("== Recent Errors ==")));
  assert.ok(lines.some((line) => line.includes("== Load State ==")));
  assert.ok(lines.some((line) => line.includes("== Issues ==")));
  assert.ok(lines.some((line) => line.includes("transport_status: transport_error")));
  assert.ok(lines.some((line) => line.includes("load_state: degraded")));
});
