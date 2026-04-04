import * as path from "node:path";
import type { RetrievedChunk, RetrievedIndexedChunk, RetrievedIndexedFileCandidate, RetrievalRankingEvidence } from "../ports";
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

function basename(filePath: string): string {
  return path.posix.basename(filePath.replace(/\\/g, "/").toLowerCase());
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

function scoreFileCandidate(filePath: string, query: ParsedRetrievalQuery): FileScoreBreakdown {
  const normalizedPath = filePath.toLowerCase();
  const normalizedFilename = basename(filePath);
  const reasons: string[] = [];
  let score = 0;

  if (query.path_hints.includes(normalizedPath)) {
    score += 120;
    reasons.push("path_exact_match");
  }

  if (query.filename_hints.includes(normalizedFilename)) {
    score += 110;
    reasons.push("filename_exact_match");
  }

  for (const token of query.tokens) {
    if (normalizedFilename.includes(token)) {
      score += normalizedFilename === token ? 80 : 35;
      reasons.push(normalizedFilename === token ? "filename_exact_match" : "filename_partial_match");
      continue;
    }

    if (normalizedPath.includes(token)) {
      score += 20;
      reasons.push("path_partial_match");
    }
  }

  if (query.normalized_intent.includes(normalizedPath)) {
    score += 40;
    reasons.push("path_embedded_in_intent");
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
  const reasons = [...fileScore.reasons];
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

  let score = fileScore.score;
  if (matchedTerms > 0) {
    score += matchedTerms * 18;
    score += Math.min(24, totalOccurrences * 4);
    reasons.push("content_match");
  }

  if (matchedTerms > 1) {
    score += 18;
    reasons.push("multi_term_match");
  }

  if (totalOccurrences >= 3) {
    score += 12;
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
    const fileScore = scoreFileCandidate(file.path, input.query);
    const fileChunks = (chunksByFileId.get(file.file_id) ?? [])
      .map((chunk) => {
        const chunkScore = scoreChunkCandidate(chunk, input.query, fileScore);
        return {
          file_path: chunk.file_path,
          chunk_index: chunk.chunk_index,
          content: chunk.content,
          score: chunkScore.score,
          evidence: chunkScore.reasons,
        };
      })
      .filter((chunk) => chunk.score > 0)
      .sort((left, right) => right.score - left.score || left.file_path.localeCompare(right.file_path) || left.chunk_index - right.chunk_index);

    if (fileScore.score === 0 && fileChunks.length === 0) {
      continue;
    }

    const bestChunkScore = fileChunks[0]?.score ?? 0;
    ranked.push({
      file_id: file.file_id,
      file_path: file.path,
      score: Math.max(fileScore.score, bestChunkScore),
      reasons: fileScore.reasons,
      chunks: fileChunks,
    });
  }

  return ranked.sort(
    (left, right) => right.score - left.score || left.file_path.localeCompare(right.file_path),
  );
}

export function toRankingEvidence(files: RankedFileCandidate[], maxItems: number): RetrievalRankingEvidence[] {
  const evidence: RetrievalRankingEvidence[] = [];
  for (const file of files) {
    if (file.chunks.length > 0) {
      for (const chunk of file.chunks) {
        evidence.push({
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
