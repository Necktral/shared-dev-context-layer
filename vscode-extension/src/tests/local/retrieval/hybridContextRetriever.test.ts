import test from "node:test";
import assert from "node:assert/strict";
import { NoopPersistence } from "../../../local/noopServices";
import { HybridContextRetriever } from "../../../local/retrieval/hybridContextRetriever";
import { applyRetrievalBudget } from "../../../local/retrieval/retrievalBudget";
import { parseRetrievalQuery } from "../../../local/retrieval/retrievalQueryParser";
import { rankRetrievalCandidates } from "../../../local/retrieval/retrievalScorer";
import type {
  GetFileChunksByFileIdsInput,
  RetrievedIndexedChunk,
  RetrievedIndexedFileCandidate,
  SearchFileChunksInput,
  SearchIndexedFilesInput,
} from "../../../local/ports";

class RetrievalPersistence extends NoopPersistence {
  public files: RetrievedIndexedFileCandidate[] = [];

  public chunks: RetrievedIndexedChunk[] = [];

  public override async searchIndexedFiles(input: SearchIndexedFilesInput): Promise<RetrievedIndexedFileCandidate[]> {
    const tokens = input.tokens.map((token) => token.toLowerCase());
    return this.files
      .filter((file) => tokens.some((token) => file.path.toLowerCase().includes(token)))
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(0, input.limit);
  }

  public override async searchFileChunks(input: SearchFileChunksInput): Promise<RetrievedIndexedChunk[]> {
    const tokens = input.tokens.map((token) => token.toLowerCase());
    const fileIdFilter = input.fileIds ? new Set(input.fileIds) : null;
    return this.chunks
      .filter((chunk) => (!fileIdFilter || fileIdFilter.has(chunk.file_id)) && tokens.some((token) => chunk.content.toLowerCase().includes(token)))
      .sort((left, right) => left.file_path.localeCompare(right.file_path) || left.chunk_index - right.chunk_index)
      .slice(0, input.limit);
  }

  public override async getFileChunksByFileIds(input: GetFileChunksByFileIdsInput): Promise<RetrievedIndexedChunk[]> {
    const perFileCounter = new Map<string, number>();
    return this.chunks.filter((chunk) => {
      if (!input.fileIds.includes(chunk.file_id)) {
        return false;
      }
      const current = perFileCounter.get(chunk.file_id) ?? 0;
      if (current >= input.limitPerFile) {
        return false;
      }
      perFileCounter.set(chunk.file_id, current + 1);
      return true;
    });
  }
}

test("parseRetrievalQuery extrae tokens, path hints y filename hints", () => {
  const parsed = parseRetrievalQuery("Revisar src/auth/authService.ts por token inválido");
  assert.ok(parsed.tokens.includes("src/auth/authservice.ts"));
  assert.ok(parsed.tokens.includes("authservice"));
  assert.ok(parsed.tokens.includes("token"));
  assert.deepEqual(parsed.path_hints, ["src/auth/authservice.ts"]);
  assert.ok(parsed.filename_hints.includes("authservice.ts"));
});

test("rankRetrievalCandidates prioriza filename/path por encima del ruido", () => {
  const ranked = rankRetrievalCandidates({
    query: parseRetrievalQuery("Actualizar authService.ts token"),
    files: [
      { file_id: "f-auth", path: "src/authService.ts", content_hash: "1" },
      { file_id: "f-other", path: "src/tokenizer.ts", content_hash: "2" },
    ],
    chunks: [
      { file_id: "f-auth", file_path: "src/authService.ts", chunk_index: 0, content: "refresh token guard", content_hash: "c1" },
      { file_id: "f-other", file_path: "src/tokenizer.ts", chunk_index: 0, content: "token parsing helper", content_hash: "c2" },
    ],
  });

  assert.equal(ranked[0]?.file_path, "src/authService.ts");
  assert.ok(ranked[0]?.score !== undefined && ranked[0].score > ranked[1].score);
  assert.ok(ranked[0]?.chunks[0].evidence.includes("filename_exact_match"));
});

test("applyRetrievalBudget respeta max_chunks, max_chunks_per_file y max_total_chars", () => {
  const chunkA = "A".repeat(1000);
  const chunkB = "B".repeat(1000);
  const budgeted = applyRetrievalBudget([
    {
      file_id: "f1",
      file_path: "src/a.ts",
      score: 100,
      reasons: ["filename_exact_match"],
      chunks: [
        { file_path: "src/a.ts", chunk_index: 0, content: chunkA, score: 100, evidence: ["content_match"] },
        { file_path: "src/a.ts", chunk_index: 1, content: chunkA, score: 99, evidence: ["content_match"] },
        { file_path: "src/a.ts", chunk_index: 2, content: chunkA, score: 98, evidence: ["content_match"] },
        { file_path: "src/a.ts", chunk_index: 3, content: chunkA, score: 97, evidence: ["content_match"] },
      ],
    },
    {
      file_id: "f2",
      file_path: "src/b.ts",
      score: 90,
      reasons: ["path_partial_match"],
      chunks: [
        { file_path: "src/b.ts", chunk_index: 0, content: chunkB, score: 90, evidence: ["content_match"] },
        { file_path: "src/b.ts", chunk_index: 1, content: chunkB, score: 89, evidence: ["content_match"] },
        { file_path: "src/b.ts", chunk_index: 2, content: chunkB, score: 88, evidence: ["content_match"] },
        { file_path: "src/b.ts", chunk_index: 3, content: chunkB, score: 87, evidence: ["content_match"] },
      ],
    },
  ]);

  assert.equal(budgeted.selected_chunks.length, 6);
  assert.equal(budgeted.selected_chunks.filter((chunk) => chunk.file_path === "src/a.ts").length, 3);
  assert.equal(budgeted.selected_chunks.filter((chunk) => chunk.file_path === "src/b.ts").length, 3);
  assert.equal(budgeted.budget_stats.selected_chars, 6000);
  assert.equal(budgeted.budget_stats.truncated, true);
});

test("HybridContextRetriever usa fallback cuando no hay hits indexados", async () => {
  const persistence = new RetrievalPersistence({ dbStatus: "connected" });
  const retriever = new HybridContextRetriever({ persistence });

  const context = await retriever.retrieve({
    intent: "buscar archivo inexistente",
    projectId: "project-1",
    snapshot: {
      operation_profile: "local_private",
      workspace_root: "/workspace",
      repo_root: "/workspace/repo",
      branch: "main",
      active_file: "/workspace/repo/src/active.ts",
      db_status: "connected",
      db_error: null,
      runtime_state: "ready",
      last_action: null,
      task_draft: null,
      last_result: null,
      errors: [],
      updated_at: new Date().toISOString(),
    },
  });

  assert.deepEqual(context.candidate_files, ["/workspace/repo/src/active.ts"]);
  assert.equal(context.selected_chunks.length, 0);
  assert.ok(context.summary.includes("fallback"));
});

test("HybridContextRetriever devuelve resultados deterministas por filename y content", async () => {
  const persistence = new RetrievalPersistence({ dbStatus: "connected" });
  persistence.files = [
    { file_id: "f1", path: "src/authService.ts", content_hash: "1" },
    { file_id: "f2", path: "src/zAuthServiceDocs.md", content_hash: "2" },
  ];
  persistence.chunks = [
    { file_id: "f1", file_path: "src/authService.ts", chunk_index: 0, content: "token refresh token validation", content_hash: "c1" },
    { file_id: "f1", file_path: "src/authService.ts", chunk_index: 1, content: "secondary chunk", content_hash: "c2" },
    { file_id: "f2", file_path: "src/zAuthServiceDocs.md", chunk_index: 0, content: "token docs", content_hash: "c3" },
  ];

  const retriever = new HybridContextRetriever({ persistence });
  const request = {
    intent: "Revisar authService.ts token",
    projectId: "project-1",
    snapshot: {
      operation_profile: "local_private" as const,
      workspace_root: "/workspace",
      repo_root: "/workspace/repo",
      branch: "main",
      active_file: null,
      db_status: "connected" as const,
      db_error: null,
      runtime_state: "ready" as const,
      last_action: null,
      task_draft: null,
      last_result: null,
      errors: [],
      updated_at: new Date().toISOString(),
    },
  };

  const first = await retriever.retrieve(request);
  const second = await retriever.retrieve(request);

  assert.deepEqual(first.candidate_files, ["src/authService.ts", "src/zAuthServiceDocs.md"]);
  assert.equal(first.selected_chunks[0]?.file_path, "src/authService.ts");
  assert.deepEqual(first, second);
});
