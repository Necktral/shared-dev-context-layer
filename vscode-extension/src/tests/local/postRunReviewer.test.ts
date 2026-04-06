import test from "node:test";
import assert from "node:assert/strict";
import { PostRunReviewer } from "../../local/postRunReviewer";
import type { PostRunReviewInput } from "../../local/ports";

function baseInput(): PostRunReviewInput {
  return {
    source_execution_id: "execution-1",
    source_task_id: "task-1",
    execution_result: {
      mode: "run",
      ok: true,
      cancelled: false,
      command: "codex",
      command_line: "codex exec ...",
      exit_code: 0,
      stdout: "",
      stderr: "",
      final_message: "ok",
      thread_id: "thread-1",
      events_count: 3,
      warnings_count: 0,
      usage_tokens: null,
      started_at: "2026-04-06T03:00:00.000Z",
      finished_at: "2026-04-06T03:00:01.000Z",
      duration_ms: 1000,
      error: null,
      request_preview: null,
    },
    workspace_diff: {
      created_files: [],
      modified_files: ["src/z.ts", "src/a.ts"],
      deleted_files: [],
      unchanged_files: [],
      changed_files_count: 2,
      changed_files_preview: ["src/a.ts", "src/z.ts"],
      unchanged_count: 0,
    },
    classified_outcome: "applied_changes",
    outcome_classification: {
      classified_outcome: "applied_changes",
      reasons: ["execution_ok_with_changes"],
      anomaly_flags: [],
      severity: "info",
    },
    review_payload: {
      objective: "Cambiar archivos",
      final_message: "done",
      outcome: "applied_changes",
      classified_outcome: "applied_changes",
      changed_files: {
        created_files: [],
        modified_files: ["src/a.ts", "src/z.ts"],
        deleted_files: [],
        changed_files_count: 2,
        changed_files_preview: ["src/a.ts", "src/z.ts"],
      },
      warnings: [],
      pending_risks: [],
      next_action: "Revisar cambios",
    },
    reindex_result: {
      mode: "scoped",
      status: "ok",
      ok: true,
      message: "ok",
      trigger_reason: "changed_scope",
      changed_paths: ["src/a.ts", "src/z.ts"],
      metrics: {},
      error: null,
    },
  };
}

test("PostRunReviewer decide accept en applied_changes sin warnings ni deletes", async () => {
  const reviewer = new PostRunReviewer();
  const reviewed = await reviewer.review(baseInput());
  assert.equal(reviewed.review_decision, "accept");
  assert.deepEqual(reviewed.changed_files_focus, ["src/a.ts", "src/z.ts"]);
  assert.ok(reviewed.reason_codes.includes("outcome:applied_changes"));
});

test("PostRunReviewer decide accept_with_warnings cuando applied_changes tiene warnings", async () => {
  const reviewer = new PostRunReviewer();
  const input = baseInput();
  input.execution_result.warnings_count = 2;
  const reviewed = await reviewer.review(input);
  assert.equal(reviewed.review_decision, "accept_with_warnings");
  assert.ok(reviewed.reason_codes.includes("warnings_present"));
});

test("PostRunReviewer decide needs_manual_review cuando applied_changes tiene deleted files", async () => {
  const reviewer = new PostRunReviewer();
  const input = baseInput();
  input.workspace_diff.deleted_files = ["src/legacy.ts"];
  input.workspace_diff.changed_files_count = 3;
  input.review_payload.changed_files.deleted_files = ["src/legacy.ts"];
  input.review_payload.changed_files.changed_files_count = 3;
  const reviewed = await reviewer.review(input);
  assert.equal(reviewed.review_decision, "needs_manual_review");
  assert.ok(reviewed.reason_codes.includes("deleted_files_present"));
});

test("PostRunReviewer escala a needs_manual_review cuando reindex no es ok", async () => {
  const reviewer = new PostRunReviewer();
  const input = baseInput();
  input.reindex_result.ok = false;
  input.reindex_result.status = "error";
  input.reindex_result.error = "index error";
  input.reindex_result.message = "error";
  const reviewed = await reviewer.review(input);
  assert.equal(reviewed.review_decision, "needs_manual_review");
  assert.ok(reviewed.reason_codes.includes("reindex_not_ok"));
  assert.ok(reviewed.reason_codes.includes("decision_escalated_reindex_risk"));
  assert.ok(reviewed.review_risks.includes("Reindex post-run no exitoso."));
});

test("PostRunReviewer escala a needs_manual_review cuando reindex usa fallback_full", async () => {
  const reviewer = new PostRunReviewer();
  const input = baseInput();
  input.reindex_result.mode = "fallback_full";
  input.reindex_result.trigger_reason = "fallback";
  const reviewed = await reviewer.review(input);
  assert.equal(reviewed.review_decision, "needs_manual_review");
  assert.ok(reviewed.reason_codes.includes("reindex_fallback_full"));
  assert.ok(reviewed.reason_codes.includes("decision_escalated_reindex_risk"));
  assert.ok(
    reviewed.review_risks.includes("Reindex post-run ejecutado en modo fallback_full; validar cobertura del cambio."),
  );
});

test("PostRunReviewer cubre matriz base de outcomes", async () => {
  const reviewer = new PostRunReviewer();
  const blocked = await reviewer.review({
    ...baseInput(),
    classified_outcome: "blocked",
    outcome_classification: {
      classified_outcome: "blocked",
      reasons: ["blocked"],
      anomaly_flags: [],
      severity: "error",
    },
  });
  const failed = await reviewer.review({
    ...baseInput(),
    classified_outcome: "failed",
    outcome_classification: {
      classified_outcome: "failed",
      reasons: ["failed"],
      anomaly_flags: [],
      severity: "error",
    },
  });
  const partial = await reviewer.review({
    ...baseInput(),
    classified_outcome: "partial_changes",
    outcome_classification: {
      classified_outcome: "partial_changes",
      reasons: ["partial"],
      anomaly_flags: ["severe_warning"],
      severity: "warning",
    },
  });
  const noOp = await reviewer.review({
    ...baseInput(),
    classified_outcome: "no_op",
    workspace_diff: {
      ...baseInput().workspace_diff,
      modified_files: [],
      changed_files_count: 0,
      changed_files_preview: [],
    },
    outcome_classification: {
      classified_outcome: "no_op",
      reasons: ["no_changes"],
      anomaly_flags: [],
      severity: "info",
    },
  });
  assert.equal(blocked.review_decision, "blocked");
  assert.equal(failed.review_decision, "reject");
  assert.equal(partial.review_decision, "needs_manual_review");
  assert.equal(noOp.review_decision, "retry_recommended");
});
