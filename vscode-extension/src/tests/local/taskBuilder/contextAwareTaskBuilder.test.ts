import test from "node:test";
import assert from "node:assert/strict";
import { ContextAwareTaskBuilder } from "../../../local/taskBuilder/contextAwareTaskBuilder";

test("ContextAwareTaskBuilder compone summary con evidencia de chunks", async () => {
  const builder = new ContextAwareTaskBuilder();
  const draft = await builder.buildTask(
    "Ajustar auth service",
    {
      summary: "Retrieval local listo.",
      candidate_files: ["src/authService.ts"],
      query_trace: {
        raw_intent: "Ajustar auth service",
        normalized_intent: "ajustar auth service",
        tokens: ["auth", "service"],
        path_hints: [],
        filename_hints: ["authservice.ts"],
      },
      coarse_trace: [
        {
          stage: "coarse",
          file_path: "src/authService.ts",
          chunk_index: 0,
          score: 92,
          reasons: ["filename_exact_match", "content_token_match"],
        },
      ],
      selected_chunks: [
        {
          file_path: "src/authService.ts",
          chunk_index: 0,
          content: "export async function refreshToken() { return validateToken(); }",
          content_hash: "hash-1",
          score: 120,
          coarse_score: 92,
          evidence: ["filename_exact_match", "content_match"],
        },
      ],
      ranking_evidence: [
        {
          stage: "final",
          file_path: "src/authService.ts",
          chunk_index: 0,
          score: 120,
          reasons: ["filename_exact_match", "content_match"],
        },
      ],
      budget_stats: {
        max_files: 5,
        max_chunks: 8,
        max_chunks_per_file: 3,
        max_total_chars: 6000,
        selected_files: 1,
        selected_chunks: 1,
        selected_chars: 63,
        truncated: false,
        truncation_reasons: [],
      },
      fallback_trace: null,
    },
    {
      operation_profile: "local_private",
      workspace_root: "/workspace",
      repo_root: "/workspace/repo",
      branch: "main",
      active_file: null,
      db_status: "connected",
      db_error: null,
      runtime_state: "ready",
      last_action: null,
      task_draft: null,
      last_result: null,
      errors: [],
      updated_at: new Date().toISOString(),
    },
  );

  assert.ok(draft.context_summary.includes("Retrieval local listo."));
  assert.ok(draft.context_summary.includes("src/authService.ts#0"));
  assert.ok(draft.acceptance_criteria.includes("La tarea usa evidencia recuperada del índice local en PostgreSQL."));
  assert.deepEqual(draft.candidate_files, ["src/authService.ts"]);
});
