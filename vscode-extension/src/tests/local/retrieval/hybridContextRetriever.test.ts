import test from "node:test";
import assert from "node:assert/strict";
import { NoopPersistence } from "../../../local/noopServices";
import { HybridContextRetriever } from "../../../local/retrieval/hybridContextRetriever";
import { applyRetrievalBudget } from "../../../local/retrieval/retrievalBudget";
import { parseRetrievalQuery, parseRetrievalQueryWithRoots } from "../../../local/retrieval/retrievalQueryParser";
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
    const tokenSet = new Set(input.tokens.map((token) => token.toLowerCase()));
    const pathHints = new Set(input.pathHints.map((hint) => hint.toLowerCase()));
    const filenameHints = new Set(input.filenameHints.map((hint) => hint.toLowerCase()));
    return this.files
      .filter((file) => {
        const filePath = file.path.toLowerCase();
        const fileName = filePath.split("/").pop() ?? filePath;
        if (pathHints.has(filePath) || filenameHints.has(fileName)) {
          return true;
        }
        return [...tokenSet].some((token) => filePath.includes(token));
      })
      .sort((left, right) => right.coarse_score - left.coarse_score || left.path.localeCompare(right.path))
      .slice(0, input.limit);
  }

  public override async searchFileChunks(input: SearchFileChunksInput): Promise<RetrievedIndexedChunk[]> {
    const tokenSet = new Set(input.tokens.map((token) => token.toLowerCase()));
    const fileIdFilter = input.fileIds ? new Set(input.fileIds) : null;
    return this.chunks
      .filter((chunk) => {
        if (fileIdFilter && !fileIdFilter.has(chunk.file_id)) {
          return false;
        }
        const pathKey = chunk.file_path.toLowerCase();
        if (input.pathHints.some((hint) => pathKey === hint.toLowerCase())) {
          return true;
        }
        if (input.filenameHints.some((hint) => pathKey.endsWith(hint.toLowerCase()))) {
          return true;
        }
        const content = chunk.content.toLowerCase();
        return [...tokenSet].some((token) => content.includes(token) || pathKey.includes(token));
      })
      .sort(
        (left, right) =>
          right.coarse_score - left.coarse_score ||
          left.file_path.localeCompare(right.file_path) ||
          left.chunk_index - right.chunk_index,
      )
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

function fileCandidate(input: {
  fileId: string;
  path: string;
  coarseScore: number;
  reasons?: string[];
  pathTokenHits?: number;
  filenameTokenHits?: number;
}): RetrievedIndexedFileCandidate {
  return {
    file_id: input.fileId,
    path: input.path,
    content_hash: "",
    coarse_score: input.coarseScore,
    coarse_reasons: input.reasons ?? [],
    path_token_hits: input.pathTokenHits ?? 0,
    filename_token_hits: input.filenameTokenHits ?? 0,
  };
}

function chunkCandidate(input: {
  fileId: string;
  filePath: string;
  chunkIndex: number;
  content: string;
  coarseScore: number;
  reasons?: string[];
  pathTokenHits?: number;
  filenameTokenHits?: number;
  contentTokenHits?: number;
}): RetrievedIndexedChunk {
  return {
    file_id: input.fileId,
    file_path: input.filePath,
    chunk_index: input.chunkIndex,
    content: input.content,
    content_hash: `hash-${input.fileId}-${input.chunkIndex}`,
    coarse_score: input.coarseScore,
    coarse_reasons: input.reasons ?? [],
    path_token_hits: input.pathTokenHits ?? 0,
    filename_token_hits: input.filenameTokenHits ?? 0,
    content_token_hits: input.contentTokenHits ?? 0,
  };
}

test("parseRetrievalQueryWithRoots canonicaliza hints absolutos y separadores mixed", () => {
  const parsed = parseRetrievalQueryWithRoots("revisar C:\\workspace\\repo\\src\\auth\\AuthService.ts token", {
    repo_root: "/workspace/repo",
    workspace_root: "/workspace",
  });

  assert.ok(parsed.tokens.includes("src/auth/authservice.ts"));
  assert.ok(parsed.path_hints.includes("src/auth/authservice.ts"));
  assert.ok(parsed.filename_hints.includes("authservice.ts"));
});

test("parseRetrievalQuery mantiene señales útiles en modo standalone", () => {
  const parsed = parseRetrievalQuery("Revisar src/auth/authService.ts por token inválido");
  assert.ok(parsed.tokens.includes("src/auth/authservice.ts"));
  assert.ok(parsed.tokens.includes("authservice"));
  assert.ok(parsed.tokens.includes("token"));
  assert.deepEqual(parsed.path_hints, ["src/auth/authservice.ts"]);
  assert.ok(parsed.filename_hints.includes("authservice.ts"));
});

test("rankRetrievalCandidates combina coarse_score SQL + señales semánticas", () => {
  const ranked = rankRetrievalCandidates({
    query: parseRetrievalQuery("Actualizar authService.ts token"),
    files: [
      fileCandidate({
        fileId: "f-auth",
        path: "src/authService.ts",
        coarseScore: 430,
        reasons: ["filename_exact_match"],
        filenameTokenHits: 1,
      }),
      fileCandidate({
        fileId: "f-other",
        path: "src/tokenizer.ts",
        coarseScore: 220,
        reasons: ["path_token_match"],
        pathTokenHits: 1,
      }),
    ],
    chunks: [
      chunkCandidate({
        fileId: "f-auth",
        filePath: "src/authService.ts",
        chunkIndex: 0,
        content: "refresh token guard token",
        coarseScore: 460,
        reasons: ["filename_exact_match", "content_token_match"],
        contentTokenHits: 2,
      }),
      chunkCandidate({
        fileId: "f-other",
        filePath: "src/tokenizer.ts",
        chunkIndex: 0,
        content: "token parsing helper",
        coarseScore: 240,
        reasons: ["content_token_match"],
        contentTokenHits: 1,
      }),
    ],
  });

  assert.equal(ranked[0]?.file_path, "src/authService.ts");
  assert.ok(ranked[0]?.score !== undefined && ranked[0].score > ranked[1].score);
  assert.ok(ranked[0]?.chunks[0].evidence.includes("filename_exact_match"));
});

test("applyRetrievalBudget reporta truncation_reasons con límite múltiple", () => {
  const chunkA = "A".repeat(1000);
  const chunkB = "B".repeat(1000);
  const budgeted = applyRetrievalBudget([
    {
      file_id: "f1",
      file_path: "src/a.ts",
      score: 100,
      reasons: ["filename_exact_match"],
      chunks: [
        { file_path: "src/a.ts", chunk_index: 0, content: chunkA, score: 100, coarse_score: 90, content_hash: "h1", evidence: ["content_match"] },
        { file_path: "src/a.ts", chunk_index: 1, content: chunkA, score: 99, coarse_score: 90, content_hash: "h2", evidence: ["content_match"] },
        { file_path: "src/a.ts", chunk_index: 2, content: chunkA, score: 98, coarse_score: 90, content_hash: "h3", evidence: ["content_match"] },
        { file_path: "src/a.ts", chunk_index: 3, content: chunkA, score: 97, coarse_score: 90, content_hash: "h4", evidence: ["content_match"] },
      ],
    },
    {
      file_id: "f2",
      file_path: "src/b.ts",
      score: 90,
      reasons: ["path_partial_match"],
      chunks: [
        { file_path: "src/b.ts", chunk_index: 0, content: chunkB, score: 90, coarse_score: 80, content_hash: "h5", evidence: ["content_match"] },
        { file_path: "src/b.ts", chunk_index: 1, content: chunkB, score: 89, coarse_score: 80, content_hash: "h6", evidence: ["content_match"] },
        { file_path: "src/b.ts", chunk_index: 2, content: chunkB, score: 88, coarse_score: 80, content_hash: "h7", evidence: ["content_match"] },
        { file_path: "src/b.ts", chunk_index: 3, content: chunkB, score: 87, coarse_score: 80, content_hash: "h8", evidence: ["content_match"] },
      ],
    },
  ]);

  assert.equal(budgeted.selected_chunks.length, 6);
  assert.equal(budgeted.selected_chunks.filter((chunk) => chunk.file_path === "src/a.ts").length, 3);
  assert.equal(budgeted.selected_chunks.filter((chunk) => chunk.file_path === "src/b.ts").length, 3);
  assert.equal(budgeted.budget_stats.selected_chars, 6000);
  assert.equal(budgeted.budget_stats.truncated, true);
  assert.ok(budgeted.budget_stats.truncation_reasons.includes("max_chunks_per_file"));
});

test("HybridContextRetriever usa fallback con active_file normalizado", async () => {
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

  assert.deepEqual(context.candidate_files, ["src/active.ts"]);
  assert.equal(context.selected_chunks.length, 0);
  assert.equal(context.fallback_trace?.used, true);
  assert.equal(context.fallback_trace?.reason, "no_coarse_candidates");
  assert.ok(context.summary.includes("fallback"));
});

test("HybridContextRetriever determinista y robusto con corpus grande", async () => {
  const persistence = new RetrievalPersistence({ dbStatus: "connected" });
  for (let index = 0; index < 70; index += 1) {
    const fileId = `f-${index}`;
    const filePath = index === 11 ? "src/payments/paymentService.ts" : `src/mod${index}/service${index}.ts`;
    const filenameReason = index === 11 ? ["filename_exact_match"] : ["path_token_match"];
    persistence.files.push(
      fileCandidate({
        fileId,
        path: filePath,
        coarseScore: index === 11 ? 520 : 180 + (index % 30),
        reasons: filenameReason,
        pathTokenHits: index === 11 ? 2 : 1,
        filenameTokenHits: index === 11 ? 2 : 0,
      }),
    );
    for (let chunkIndex = 0; chunkIndex < 5; chunkIndex += 1) {
      persistence.chunks.push(
        chunkCandidate({
          fileId,
          filePath,
          chunkIndex,
          coarseScore: index === 11 ? 500 - chunkIndex * 10 : 120 + (index % 15),
          reasons: index === 11 ? ["filename_exact_match", "content_token_match"] : ["content_token_match"],
          pathTokenHits: index === 11 ? 2 : 1,
          filenameTokenHits: index === 11 ? 2 : 0,
          contentTokenHits: index === 11 ? 3 : 1,
          content:
            index === 11
              ? `payment retry token authorization chunk ${chunkIndex}`
              : `generic token content ${index}-${chunkIndex}`,
        }),
      );
    }
  }

  const retriever = new HybridContextRetriever({ persistence });
  const request = {
    intent: "Revisar paymentService.ts retry token",
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

  assert.equal(first.candidate_files[0], "src/payments/paymentService.ts");
  assert.equal(first.selected_chunks[0]?.file_path, "src/payments/paymentService.ts");
  assert.equal(first.coarse_trace[0]?.stage, "coarse");
  assert.equal(first.ranking_evidence[0]?.stage, "final");
  assert.deepEqual(first, second);
});
