import type { RetrievedContext } from "../ports";
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
      return `No se encontró contexto indexado útil; se mantiene fallback sobre ${context.candidate_files[0]}.`;
    }
    return "No se encontró contexto indexado útil para la intención dada.";
  }

  const topChunk = context.selected_chunks[0];
  const evidence = topChunk.evidence.slice(0, 2).join(", ");
  return `Retrieval local listo: ${context.candidate_files.length} archivos candidatos, ${context.selected_chunks.length} chunks seleccionados. Primer fragmento: ${topChunk.file_path}#${topChunk.chunk_index} (${evidence}) -> ${compactSnippet(topChunk.content, 160)}`;
}

export function buildFallbackContext(activeFile: string | null): RetrievedContext {
  const candidateFiles = activeFile ? [activeFile] : [];
  const rankingEvidence = activeFile
    ? [
        {
          file_path: activeFile,
          score: 1,
          reasons: ["active_file_fallback"],
        },
      ]
    : [
        {
          file_path: "-",
          score: 0,
          reasons: ["no_index_hits"],
        },
      ];

  return {
    summary: activeFile
      ? `No se encontró contexto indexado útil; se usa active_file como fallback (${activeFile}).`
      : "No se encontró contexto indexado útil y no existe active_file disponible.",
    candidate_files: candidateFiles,
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
    },
  };
}

export function trimRankedFilesForEvidence(files: RankedFileCandidate[], maxFiles: number): RankedFileCandidate[] {
  return files.slice(0, maxFiles).map((file) => ({
    ...file,
    chunks: file.chunks.slice(0, 3),
  }));
}
