import type { RetrievedChunk, RetrievalBudgetStats } from "../ports";
import type { RankedFileCandidate } from "./retrievalScorer";

export const DEFAULT_RETRIEVAL_BUDGET = {
  max_files: 5,
  max_chunks: 8,
  max_chunks_per_file: 3,
  max_total_chars: 6000,
} as const;

export interface BudgetedRetrievalResult {
  candidate_files: string[];
  selected_chunks: RetrievedChunk[];
  budget_stats: RetrievalBudgetStats;
}

export function applyRetrievalBudget(files: RankedFileCandidate[]): BudgetedRetrievalResult {
  const candidateFiles = files.slice(0, DEFAULT_RETRIEVAL_BUDGET.max_files).map((file) => file.file_path);
  const selectedChunks: RetrievedChunk[] = [];
  const selectedByFile = new Map<string, number>();
  let selectedChars = 0;
  let truncated = files.length > candidateFiles.length;

  const limitedFiles = files.slice(0, DEFAULT_RETRIEVAL_BUDGET.max_files);
  const cursors = new Map<string, number>(limitedFiles.map((file) => [file.file_id, 0]));

  while (selectedChunks.length < DEFAULT_RETRIEVAL_BUDGET.max_chunks) {
    let progressed = false;

    for (const file of limitedFiles) {
      const selectedForFile = selectedByFile.get(file.file_id) ?? 0;
      if (selectedForFile >= DEFAULT_RETRIEVAL_BUDGET.max_chunks_per_file) {
        continue;
      }

      const cursor = cursors.get(file.file_id) ?? 0;
      if (cursor >= file.chunks.length) {
        continue;
      }

      const chunk = file.chunks[cursor];
      cursors.set(file.file_id, cursor + 1);

      if (selectedChars + chunk.content.length > DEFAULT_RETRIEVAL_BUDGET.max_total_chars) {
        truncated = true;
        continue;
      }

      selectedChunks.push(chunk);
      selectedByFile.set(file.file_id, selectedForFile + 1);
      selectedChars += chunk.content.length;
      progressed = true;

      if (selectedChunks.length >= DEFAULT_RETRIEVAL_BUDGET.max_chunks) {
        truncated = truncated || file.chunks.length > cursor + 1;
        break;
      }
    }

    if (!progressed) {
      break;
    }
  }

  truncated =
    truncated ||
    limitedFiles.some((file) => {
      const selectedForFile = selectedByFile.get(file.file_id) ?? 0;
      return selectedForFile < file.chunks.length;
    });

  return {
    candidate_files: candidateFiles,
    selected_chunks: selectedChunks,
    budget_stats: {
      ...DEFAULT_RETRIEVAL_BUDGET,
      selected_files: candidateFiles.length,
      selected_chunks: selectedChunks.length,
      selected_chars: selectedChars,
      truncated,
    },
  };
}
