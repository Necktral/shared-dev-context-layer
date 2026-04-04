import type {
  ContextRetrieverPort,
  PersistencePort,
  RetrievedContext,
  RetrievedIndexedChunk,
  RetrievalRequest,
} from "../ports";
import { applyRetrievalBudget, DEFAULT_RETRIEVAL_BUDGET } from "./retrievalBudget";
import { buildFallbackContext, buildRetrievalSummary, trimRankedFilesForEvidence } from "./retrievalEvidenceFormatter";
import { parseRetrievalQuery } from "./retrievalQueryParser";
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

  public async retrieve(request: RetrievalRequest): Promise<RetrievedContext> {
    const parsedQuery = parseRetrievalQuery(request.intent);
    if (parsedQuery.tokens.length === 0) {
      return buildFallbackContext(request.snapshot.active_file);
    }

    const [fileMatches, chunkMatches] = await Promise.all([
      this.options.persistence.searchIndexedFiles({
        projectId: request.projectId,
        tokens: parsedQuery.tokens,
        limit: 24,
      }),
      this.options.persistence.searchFileChunks({
        projectId: request.projectId,
        tokens: parsedQuery.tokens,
        limit: 48,
      }),
    ]);

    const candidateFileIds = [...new Set([...fileMatches.map((file) => file.file_id), ...chunkMatches.map((chunk) => chunk.file_id)])];
    if (candidateFileIds.length === 0) {
      return buildFallbackContext(request.snapshot.active_file);
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
      return buildFallbackContext(request.snapshot.active_file);
    }

    const budgeted = applyRetrievalBudget(rankedFiles);
    const context: RetrievedContext = {
      summary: "",
      candidate_files: budgeted.candidate_files,
      selected_chunks: budgeted.selected_chunks,
      ranking_evidence: toRankingEvidence(trimRankedFilesForEvidence(rankedFiles, DEFAULT_RETRIEVAL_BUDGET.max_files), 12),
      budget_stats: budgeted.budget_stats,
    };

    context.summary = buildRetrievalSummary(context);
    return context;
  }
}
