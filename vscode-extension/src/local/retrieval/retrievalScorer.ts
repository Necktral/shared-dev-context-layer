import type { RetrievedChunk, RetrievedIndexedChunk, RetrievedIndexedFileCandidate, RetrievalRankingEvidence } from "../ports";
import { toComparablePathKey } from "../pathNormalization";
import type { ParsedRetrievalQuery } from "./retrievalQueryParser";

export interface RankedFileCandidate {
  file_id: string;
  file_path: string;
  score: number;
  reasons: string[];
  chunks: RetrievedChunk[];
}

interface FileScoreBreakdown {
  score: number;
  reasons: string[];
}

interface ChunkScoreBreakdown {
  score: number;
  reasons: string[];
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function countOccurrences(text: string, token: string): number {
  let count = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const found = text.indexOf(token, cursor);
    if (found === -1) {
      break;
    }
    count += 1;
    cursor = found + token.length;
  }
  return count;
}

function compareChunks(
  left: { score: number; file_path: string; chunk_index: number; content_hash: string | null },
  right: { score: number; file_path: string; chunk_index: number; content_hash: string | null },
): number {
  return (
    right.score - left.score ||
    toComparablePathKey(left.file_path).localeCompare(toComparablePathKey(right.file_path)) ||
    left.chunk_index - right.chunk_index ||
    (left.content_hash ?? "").localeCompare(right.content_hash ?? "")
  );
}

function compareFiles(
  left: { score: number; file_path: string; file_id: string },
  right: { score: number; file_path: string; file_id: string },
): number {
  return (
    right.score - left.score ||
    toComparablePathKey(left.file_path).localeCompare(toComparablePathKey(right.file_path)) ||
    left.file_id.localeCompare(right.file_id)
  );
}

function scoreFileCandidate(file: RetrievedIndexedFileCandidate, query: ParsedRetrievalQuery): FileScoreBreakdown {
  const reasons = [...file.coarse_reasons];
  let score = file.coarse_score;

  if (file.path_token_hits > 1) {
    score += Math.min(24, file.path_token_hits * 4);
    reasons.push("path_multi_token_density");
  }
  if (file.filename_token_hits > 0) {
    score += Math.min(18, file.filename_token_hits * 6);
    reasons.push("filename_token_density");
  }

  if (query.path_hints.length > 0 && file.path_token_hits === 0) {
    score -= 6;
  }

  return {
    score,
    reasons: unique(reasons),
  };
}

function scoreChunkCandidate(
  chunk: RetrievedIndexedChunk,
  query: ParsedRetrievalQuery,
  fileScore: FileScoreBreakdown,
): ChunkScoreBreakdown {
  const normalizedContent = chunk.content.toLowerCase();
  const reasons = [...fileScore.reasons, ...chunk.coarse_reasons];
  let matchedTerms = 0;
  let totalOccurrences = 0;

  for (const token of query.tokens) {
    const occurrences = countOccurrences(normalizedContent, token);
    if (occurrences === 0) {
      continue;
    }
    matchedTerms += 1;
    totalOccurrences += occurrences;
  }

  let score = Math.max(fileScore.score, chunk.coarse_score);
  if (matchedTerms > 0) {
    score += matchedTerms * 12;
    score += Math.min(24, totalOccurrences * 3);
    reasons.push("content_match");
  }

  if (chunk.content_token_hits > 1) {
    score += Math.min(20, chunk.content_token_hits * 4);
    reasons.push("coarse_content_density");
  }

  if (matchedTerms > 1) {
    score += 14;
    reasons.push("multi_term_match");
  }

  if (totalOccurrences >= 3) {
    score += 10;
    reasons.push("high_term_density");
  }

  return {
    score,
    reasons: unique(reasons),
  };
}

export function rankRetrievalCandidates(input: {
  files: RetrievedIndexedFileCandidate[];
  chunks: RetrievedIndexedChunk[];
  query: ParsedRetrievalQuery;
}): RankedFileCandidate[] {
  const fileMap = new Map<string, RetrievedIndexedFileCandidate>();
  for (const file of input.files) {
    fileMap.set(file.file_id, file);
  }
  for (const chunk of input.chunks) {
    if (!fileMap.has(chunk.file_id)) {
      fileMap.set(chunk.file_id, {
        file_id: chunk.file_id,
        path: chunk.file_path,
        content_hash: "",
        coarse_score: chunk.coarse_score,
        coarse_reasons: chunk.coarse_reasons,
        path_token_hits: chunk.path_token_hits,
        filename_token_hits: chunk.filename_token_hits,
      });
    }
  }

  const chunksByFileId = new Map<string, RetrievedIndexedChunk[]>();
  for (const chunk of input.chunks) {
    const current = chunksByFileId.get(chunk.file_id) ?? [];
    current.push(chunk);
    chunksByFileId.set(chunk.file_id, current);
  }

  const ranked: RankedFileCandidate[] = [];
  for (const file of fileMap.values()) {
    const fileScore = scoreFileCandidate(file, input.query);
    const scoredChunks = (chunksByFileId.get(file.file_id) ?? [])
      .map((chunk) => {
        const chunkScore = scoreChunkCandidate(chunk, input.query, fileScore);
        return {
          file_path: chunk.file_path,
          chunk_index: chunk.chunk_index,
          content: chunk.content,
          content_hash: chunk.content_hash || null,
          coarse_score: chunk.coarse_score,
          score: chunkScore.score,
          evidence: chunkScore.reasons,
        };
      })
      .filter((chunk) => chunk.score > 0)
      .sort(compareChunks)
      .map((chunk, index) => {
        const saturationPenalty = index * 4;
        const nextScore = Math.max(0, chunk.score - saturationPenalty);
        return {
          ...chunk,
          score: nextScore,
          evidence: saturationPenalty > 0 ? unique([...chunk.evidence, "same_file_saturation"]) : chunk.evidence,
        };
      })
      .sort(compareChunks);

    if (fileScore.score === 0 && scoredChunks.length === 0) {
      continue;
    }

    const bestChunkScore = scoredChunks[0]?.score ?? 0;
    const fileCompositeScore = Math.max(fileScore.score, bestChunkScore) + Math.min(4, scoredChunks.length) * 3;
    ranked.push({
      file_id: file.file_id,
      file_path: file.path,
      score: fileCompositeScore,
      reasons: unique(scoredChunks.length > 0 ? [...fileScore.reasons, "has_ranked_chunks"] : fileScore.reasons),
      chunks: scoredChunks,
    });
  }

  return ranked.sort(compareFiles);
}

export function toRankingEvidence(files: RankedFileCandidate[], maxItems: number): RetrievalRankingEvidence[] {
  const evidence: RetrievalRankingEvidence[] = [];
  for (const file of files) {
    if (file.chunks.length > 0) {
      for (const chunk of file.chunks) {
        evidence.push({
          stage: "final",
          file_path: chunk.file_path,
          chunk_index: chunk.chunk_index,
          score: chunk.score,
          reasons: chunk.evidence,
        });
        if (evidence.length >= maxItems) {
          return evidence;
        }
      }
      continue;
    }

    evidence.push({
      stage: "final",
      file_path: file.file_path,
      score: file.score,
      reasons: file.reasons,
    });
    if (evidence.length >= maxItems) {
      return evidence;
    }
  }
  return evidence;
}
