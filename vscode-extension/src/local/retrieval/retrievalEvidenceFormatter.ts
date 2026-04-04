import type { RetrievalQueryTrace, RetrievedContext } from "../ports";
import type { RankedFileCandidate } from "./retrievalScorer";

function compactSnippet(content: string, limit: number): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function buildRetrievalSummary(context: RetrievedContext): string {
  if (context.selected_chunks.length === 0) {
    if (context.candidate_files.length > 0) {
      return `No se encontró contexto indexado útil; se mantiene fallback sobre ${context.candidate_files[0]} (${context.fallback_trace?.reason ?? "fallback"}).`;
    }
    return `No se encontró contexto indexado útil para la intención dada (${context.fallback_trace?.reason ?? "no_hits"}).`;
  }

  const topChunk = context.selected_chunks[0];
  const evidence = topChunk.evidence.slice(0, 2).join(", ");
  const truncation = context.budget_stats.truncation_reasons.length > 0
    ? ` truncation=${context.budget_stats.truncation_reasons.join(",")}.`
    : "";
  return `Retrieval local listo: ${context.candidate_files.length} archivos candidatos, ${context.selected_chunks.length} chunks seleccionados. Primer fragmento: ${topChunk.file_path}#${topChunk.chunk_index} (${evidence}) -> ${compactSnippet(topChunk.content, 160)}.${truncation}`;
}

export function buildFallbackContext(input: {
  activeFile: string | null;
  reason: string;
  queryTrace: RetrievalQueryTrace;
}): RetrievedContext {
  const { activeFile, reason, queryTrace } = input;
  const candidateFiles = activeFile ? [activeFile] : [];
  const rankingEvidence = activeFile
    ? [
        {
          stage: "final" as const,
          file_path: activeFile,
          score: 1,
          reasons: [reason],
        },
      ]
    : [
        {
          stage: "final" as const,
          file_path: "-",
          score: 0,
          reasons: [reason],
        },
      ];

  return {
    summary: activeFile
      ? `No se encontró contexto indexado útil; se usa active_file como fallback (${activeFile}). reason=${reason}`
      : `No se encontró contexto indexado útil y no existe active_file disponible. reason=${reason}`,
    candidate_files: candidateFiles,
    query_trace: queryTrace,
    coarse_trace: [],
    selected_chunks: [],
    ranking_evidence: rankingEvidence,
    budget_stats: {
      max_files: 5,
      max_chunks: 8,
      max_chunks_per_file: 3,
      max_total_chars: 6000,
      selected_files: candidateFiles.length,
      selected_chunks: 0,
      selected_chars: 0,
      truncated: false,
      truncation_reasons: [],
    },
    fallback_trace: {
      used: true,
      reason,
      source_file: activeFile,
    },
  };
}

export function trimRankedFilesForEvidence(files: RankedFileCandidate[], maxFiles: number): RankedFileCandidate[] {
  return files.slice(0, maxFiles).map((file) => ({
    ...file,
    chunks: file.chunks.slice(0, 3),
  }));
}
