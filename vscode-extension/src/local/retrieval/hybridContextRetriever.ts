import type {
  ContextRetrieverPort,
  PersistencePort,
  RetrievedContext,
  RetrievedIndexedChunk,
  RetrievalRankingEvidence,
  RetrievalRequest,
} from "../ports";
import { toComparablePathKey, toProjectRelativePath } from "../pathNormalization";
import { applyRetrievalBudget, DEFAULT_RETRIEVAL_BUDGET } from "./retrievalBudget";
import { buildFallbackContext, buildRetrievalSummary, trimRankedFilesForEvidence } from "./retrievalEvidenceFormatter";
import { parseRetrievalQueryWithRoots } from "./retrievalQueryParser";
import { rankRetrievalCandidates, toRankingEvidence } from "./retrievalScorer";

export interface HybridContextRetrieverOptions {
  persistence: PersistencePort;
}

function dedupeChunks(chunks: RetrievedIndexedChunk[]): RetrievedIndexedChunk[] {
  const seen = new Set<string>();
  const result: RetrievedIndexedChunk[] = [];
  for (const chunk of chunks) {
    const key = `${chunk.file_id}:${chunk.chunk_index}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(chunk);
  }
  return result;
}

export class HybridContextRetriever implements ContextRetrieverPort {
  constructor(private readonly options: HybridContextRetrieverOptions) {}

  private toCoarseTrace(fileMatches: Array<{
    path: string;
    coarse_score: number;
    coarse_reasons: string[];
  }>, chunkMatches: Array<{
    file_path: string;
    chunk_index: number;
    coarse_score: number;
    coarse_reasons: string[];
  }>): RetrievalRankingEvidence[] {
    const entries: RetrievalRankingEvidence[] = [];
    for (const file of fileMatches) {
      entries.push({
        stage: "coarse",
        file_path: file.path,
        score: file.coarse_score,
        reasons: file.coarse_reasons,
      });
    }
    for (const chunk of chunkMatches) {
      entries.push({
        stage: "coarse",
        file_path: chunk.file_path,
        chunk_index: chunk.chunk_index,
        score: chunk.coarse_score,
        reasons: chunk.coarse_reasons,
      });
    }
    entries.sort(
      (left, right) =>
        right.score - left.score ||
        toComparablePathKey(left.file_path).localeCompare(toComparablePathKey(right.file_path)) ||
        (left.chunk_index ?? Number.MAX_SAFE_INTEGER) - (right.chunk_index ?? Number.MAX_SAFE_INTEGER),
    );
    return entries.slice(0, 24);
  }

  public async retrieve(request: RetrievalRequest): Promise<RetrievedContext> {
    const parsedQuery = parseRetrievalQueryWithRoots(request.intent, {
      repo_root: request.snapshot.repo_root,
      workspace_root: request.snapshot.workspace_root,
    });
    const normalizedActiveFile = request.snapshot.active_file
      ? toProjectRelativePath(request.snapshot.active_file, {
          repo_root: request.snapshot.repo_root,
          workspace_root: request.snapshot.workspace_root,
        })
      : null;

    if (parsedQuery.tokens.length === 0) {
      return buildFallbackContext({
        activeFile: normalizedActiveFile,
        reason: "empty_query_tokens",
        queryTrace: {
          raw_intent: parsedQuery.raw_intent,
          normalized_intent: parsedQuery.normalized_intent,
          tokens: parsedQuery.tokens,
          path_hints: parsedQuery.path_hints,
          filename_hints: parsedQuery.filename_hints,
        },
      });
    }

    const [fileMatches, chunkMatches] = await Promise.all([
      this.options.persistence.searchIndexedFiles({
        projectId: request.projectId,
        tokens: parsedQuery.tokens,
        pathHints: parsedQuery.path_hints,
        filenameHints: parsedQuery.filename_hints,
        limit: 24,
      }),
      this.options.persistence.searchFileChunks({
        projectId: request.projectId,
        tokens: parsedQuery.tokens,
        pathHints: parsedQuery.path_hints,
        filenameHints: parsedQuery.filename_hints,
        limit: 48,
      }),
    ]);

    const candidateFileIds = [...new Set([...fileMatches.map((file) => file.file_id), ...chunkMatches.map((chunk) => chunk.file_id)])];
    if (candidateFileIds.length === 0) {
      return buildFallbackContext({
        activeFile: normalizedActiveFile,
        reason: "no_coarse_candidates",
        queryTrace: {
          raw_intent: parsedQuery.raw_intent,
          normalized_intent: parsedQuery.normalized_intent,
          tokens: parsedQuery.tokens,
          path_hints: parsedQuery.path_hints,
          filename_hints: parsedQuery.filename_hints,
        },
      });
    }

    const supplementalChunks = await this.options.persistence.getFileChunksByFileIds({
      projectId: request.projectId,
      fileIds: candidateFileIds,
      limitPerFile: DEFAULT_RETRIEVAL_BUDGET.max_chunks_per_file,
    });

    const rankedFiles = rankRetrievalCandidates({
      files: fileMatches,
      chunks: dedupeChunks([...chunkMatches, ...supplementalChunks]),
      query: parsedQuery,
    });

    if (rankedFiles.length === 0) {
      return buildFallbackContext({
        activeFile: normalizedActiveFile,
        reason: "no_ranked_candidates",
        queryTrace: {
          raw_intent: parsedQuery.raw_intent,
          normalized_intent: parsedQuery.normalized_intent,
          tokens: parsedQuery.tokens,
          path_hints: parsedQuery.path_hints,
          filename_hints: parsedQuery.filename_hints,
        },
      });
    }

    const budgeted = applyRetrievalBudget(rankedFiles);
    const context: RetrievedContext = {
      summary: "",
      candidate_files: budgeted.candidate_files,
      query_trace: {
        raw_intent: parsedQuery.raw_intent,
        normalized_intent: parsedQuery.normalized_intent,
        tokens: parsedQuery.tokens,
        path_hints: parsedQuery.path_hints,
        filename_hints: parsedQuery.filename_hints,
      },
      coarse_trace: this.toCoarseTrace(fileMatches, chunkMatches),
      selected_chunks: budgeted.selected_chunks,
      ranking_evidence: toRankingEvidence(trimRankedFilesForEvidence(rankedFiles, DEFAULT_RETRIEVAL_BUDGET.max_files), 12),
      budget_stats: budgeted.budget_stats,
      fallback_trace: null,
    };

    context.summary = buildRetrievalSummary(context);
    return context;
  }
}
