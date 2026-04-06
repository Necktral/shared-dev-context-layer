import test from "node:test";
import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { LocalRuntimePanelProvider } from "../../presentation/local/localRuntimePanelProvider";
import {
  createInitialProjectRuntimeSnapshot,
  type LocalCommandResult,
  type ProjectRuntimeSnapshot,
} from "../../local/types";

function makeResult(details: Record<string, unknown> | null): LocalCommandResult {
  return {
    command: "local_run_codex",
    status: "ok",
    ok: true,
    message: "ok",
    timestamp: "2026-04-06T04:15:00.000Z",
    details,
  };
}

function makeSnapshot(details: Record<string, unknown> | null): ProjectRuntimeSnapshot {
  return {
    ...createInitialProjectRuntimeSnapshot("local_private"),
    operation_profile: "local_private",
    workspace_root: "/workspace",
    repo_root: "/workspace/repo",
    branch: "main",
    active_file: "/workspace/repo/src/index.ts",
    db_status: "connected",
    runtime_state: "ready",
    last_action: "local_run_codex",
    last_result: makeResult(details),
    errors: [],
    updated_at: "2026-04-06T04:15:00.000Z",
  };
}

function createFakeView(): { view: vscode.WebviewView; html: () => string } {
  const webview = {
    options: {},
    html: "",
  };
  const view = { webview } as unknown as vscode.WebviewView;
  return {
    view,
    html: () => webview.html,
  };
}

test("LocalRuntimePanelProvider renderiza Post-Run Review con datos de operator review", () => {
  const provider = new LocalRuntimePanelProvider(createInitialProjectRuntimeSnapshot("local_private"));
  const fakeView = createFakeView();
  provider.resolveWebviewView(fakeView.view);

  provider.update(
    makeSnapshot({
      review_decision: "needs_manual_review",
      review_summary: "<summary>",
      changed_files_focus: ["src/a.ts", "src/b.ts"],
      next_action_plan: "Revisar manualmente",
      review_risks: ["<risk-1>", "risk-2"],
    }),
  );

  const html = fakeView.html();
  assert.ok(html.includes("<h2>Post-Run Review</h2>"));
  assert.ok(html.includes("Decision: <strong>needs_manual_review</strong>"));
  assert.ok(html.includes("Summary: &lt;summary&gt;"));
  assert.ok(html.includes("Changed Focus: src/a.ts, src/b.ts"));
  assert.ok(html.includes("Next Action: Revisar manualmente"));
  assert.ok(html.includes("&lt;risk-1&gt;\nrisk-2"));
});

test("LocalRuntimePanelProvider usa defaults cuando no hay detalles de review", () => {
  const provider = new LocalRuntimePanelProvider(createInitialProjectRuntimeSnapshot("local_private"));
  const fakeView = createFakeView();
  provider.resolveWebviewView(fakeView.view);

  provider.update(makeSnapshot(null));

  const html = fakeView.html();
  assert.ok(html.includes("Decision: <strong>Sin review</strong>"));
  assert.ok(html.includes("Summary: Sin resumen."));
  assert.ok(html.includes("Changed Focus: Sin foco de archivos."));
  assert.ok(html.includes("Next Action: Sin acción sugerida."));
  assert.ok(html.includes("Sin riesgos reportados."));
});