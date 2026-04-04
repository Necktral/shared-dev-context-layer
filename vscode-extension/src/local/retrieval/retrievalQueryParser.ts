import * as path from "node:path";
import type { ProjectPathRoots } from "../pathNormalization";
import { normalizeProjectPath, toProjectRelativePath } from "../pathNormalization";

const STOP_WORDS = new Set([
  "a",
  "al",
  "and",
  "con",
  "de",
  "del",
  "el",
  "en",
  "for",
  "in",
  "la",
  "las",
  "los",
  "of",
  "or",
  "para",
  "por",
  "the",
  "to",
  "un",
  "una",
  "y",
]);

export interface ParsedRetrievalQuery {
  raw_intent: string;
  normalized_intent: string;
  tokens: string[];
  path_hints: string[];
  filename_hints: string[];
}

function normalizeCandidate(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/^[`"'([{]+|[`"')\]}:;,!?]+$/g, "");
}

function isUsefulToken(token: string): boolean {
  if (token.length < 2) {
    return false;
  }
  return !STOP_WORDS.has(token);
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

export function parseRetrievalQuery(intent: string): ParsedRetrievalQuery {
  return parseRetrievalQueryWithRoots(intent, {
    repo_root: null,
    workspace_root: null,
  });
}

function normalizePathHint(raw: string, roots: ProjectPathRoots): string | null {
  const projectRelative = toProjectRelativePath(raw, roots);
  if (!projectRelative) {
    return null;
  }
  return normalizeProjectPath(projectRelative);
}

export function parseRetrievalQueryWithRoots(intent: string, roots: ProjectPathRoots): ParsedRetrievalQuery {
  const normalizedIntent = normalizeCandidate(intent).replace(/\s+/g, " ").trim();
  if (!normalizedIntent) {
    return {
      raw_intent: intent,
      normalized_intent: "",
      tokens: [],
      path_hints: [],
      filename_hints: [],
    };
  }

  const tokens: string[] = [];
  const pathHints: string[] = [];
  const filenameHints: string[] = [];

  for (const part of normalizedIntent.split(/\s+/)) {
    const normalizedPart = normalizeCandidate(part);
    if (!normalizedPart) {
      continue;
    }

    if (normalizedPart.includes("/") || normalizedPart.includes(".")) {
      const pathHint = normalizePathHint(normalizedPart, roots);
      if (pathHint) {
        pathHints.push(pathHint);
      }
      const basename = path.posix.basename(pathHint ?? normalizedPart);
      if (isUsefulToken(basename)) {
        filenameHints.push(basename);
      }
      if (isUsefulToken(pathHint ?? normalizedPart)) {
        tokens.push(pathHint ?? normalizedPart);
      }
    }

    for (const fragment of normalizedPart.split(/[^a-z0-9._/-]+/)) {
      const normalizedFragment = normalizeCandidate(fragment);
      if (!normalizedFragment || !isUsefulToken(normalizedFragment)) {
        continue;
      }
      tokens.push(normalizedFragment);
      if (normalizedFragment.includes(".")) {
        filenameHints.push(path.posix.basename(normalizedFragment));
      }
    }
  }

  const expandedTokens = [...tokens];
  for (const token of tokens) {
    for (const fragment of token.split(/[/.\\_-]+/)) {
      if (isUsefulToken(fragment)) {
        expandedTokens.push(fragment);
      }
    }
  }

  return {
    raw_intent: intent,
    normalized_intent: normalizedIntent,
    tokens: unique(expandedTokens),
    path_hints: unique(pathHints),
    filename_hints: unique(filenameHints),
  };
}
