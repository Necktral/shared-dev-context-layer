import test from "node:test";
import assert from "node:assert/strict";
import { LocalRuntimeOutputRenderer } from "../../presentation/renderers/localRuntimeOutputRenderer";
import { createInitialProjectRuntimeSnapshot, type LocalCommandResult } from "../../local/types";

class FakeOutputChannel {
  public readonly lines: string[] = [];

  public appendLine(value: string): void {
    this.lines.push(value);
  }
}

function makeResult(details: Record<string, unknown> | null): LocalCommandResult {
  return {
    command: "local_run_codex",
    status: "ok",
    ok: true,
    message: "run done",
    timestamp: "2026-04-06T04:10:00.000Z",
    details,
  };
}

test("LocalRuntimeOutputRenderer imprime operator_review cuando hay campos de review", () => {
  const output = new FakeOutputChannel();
  const renderer = new LocalRuntimeOutputRenderer(output as never);
  const snapshot = {
    ...createInitialProjectRuntimeSnapshot("local_private"),
    operation_profile: "local_private" as const,
    workspace_root: "/workspace",
    repo_root: "/workspace/repo",
    runtime_state: "ready" as const,
    db_status: "connected" as const,
    updated_at: "2026-04-06T04:10:00.000Z",
  };
  const result = makeResult({
    review_decision: "needs_manual_review",
    review_summary: "Decision escalada por riesgo de reindex.",
    review_risks: ["Reindex post-run no exitoso."],
    next_action_plan: "Realizar revisión manual.",
  });

  renderer.render(result, snapshot);

  assert.ok(output.lines.some((line) => line === "operator_review:"));
  assert.ok(output.lines.some((line) => line === "decision: needs_manual_review"));
  assert.ok(output.lines.some((line) => line.includes("summary: Decision escalada por riesgo de reindex.")));
  assert.ok(output.lines.some((line) => line.includes("risks: Reindex post-run no exitoso.")));
  assert.ok(output.lines.some((line) => line.includes("next_action: Realizar revisión manual.")));
});

test("LocalRuntimeOutputRenderer no imprime operator_review cuando falta review_decision", () => {
  const output = new FakeOutputChannel();
  const renderer = new LocalRuntimeOutputRenderer(output as never);
  const snapshot = {
    ...createInitialProjectRuntimeSnapshot("local_private"),
    operation_profile: "local_private" as const,
    workspace_root: "/workspace",
    repo_root: "/workspace/repo",
    runtime_state: "ready" as const,
    db_status: "connected" as const,
    updated_at: "2026-04-06T04:11:00.000Z",
  };
  const result = makeResult({
    changed_files_count: 1,
  });

  renderer.render(result, snapshot);

  assert.equal(output.lines.some((line) => line === "operator_review:"), false);
});

test("LocalRuntimeOutputRenderer imprime operator_playbooks cuando están disponibles", () => {
  const output = new FakeOutputChannel();
  const renderer = new LocalRuntimeOutputRenderer(output as never);
  const snapshot = {
    ...createInitialProjectRuntimeSnapshot("local_private"),
    operation_profile: "local_private" as const,
    workspace_root: "/workspace",
    repo_root: "/workspace/repo",
    runtime_state: "ready" as const,
    db_status: "connected" as const,
    updated_at: "2026-04-06T04:12:00.000Z",
  };
  const result = makeResult({
    review_decision: "accept",
    operator_playbooks: [
      { id: "pb-1", title: "Validar diff", source_tier: "project", kind: "validation" },
      { id: "pb-2", title: "Recuperar lock", source_tier: "system", kind: "recovery" },
    ],
  });

  renderer.render(result, snapshot);

  assert.ok(output.lines.some((line) => line === "operator_playbooks:"));
  assert.ok(output.lines.some((line) => line === "- pb-1 (project) -> Validar diff"));
  assert.ok(output.lines.some((line) => line === "- pb-2 (system) -> Recuperar lock"));
});
