import * as path from "node:path";

export interface ProjectPathRoots {
  repo_root: string | null;
  workspace_root: string | null;
}

function isAbsoluteCrossPlatform(value: string): boolean {
  return path.isAbsolute(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function collapsePosixSeparators(value: string): string {
  return value.replace(/\/{2,}/g, "/");
}

function normalizeComparableAbsolute(rawPath: string): string {
  const trimmed = normalizeSlashes(rawPath.trim());
  if (!trimmed) {
    return "";
  }

  let normalized: string;
  if (path.win32.isAbsolute(trimmed) && /^[A-Za-z]:/.test(trimmed)) {
    normalized = normalizeSlashes(path.win32.normalize(trimmed));
  } else if (path.posix.isAbsolute(trimmed)) {
    normalized = path.posix.normalize(trimmed);
  } else {
    normalized = normalizeSlashes(path.resolve(trimmed));
  }

  const collapsed = collapsePosixSeparators(normalized).replace(/\/+$/, "");
  return collapsed.replace(/^[A-Za-z]:/, (drive) => drive.toLowerCase());
}

export function normalizeProjectPath(rawPath: string): string {
  const trimmed = normalizeSlashes(rawPath.trim());
  if (!trimmed) {
    return "";
  }

  const withoutDotPrefix = trimmed.replace(/^\.\/+/, "");
  const normalized = collapsePosixSeparators(withoutDotPrefix).replace(/\/+$/, "");
  if (!normalized || normalized === ".") {
    return "";
  }
  return normalized;
}

export function toComparablePathKey(rawPath: string): string {
  return normalizeProjectPath(rawPath).toLowerCase();
}

export function toComparableFilename(rawPath: string): string {
  return path.posix.basename(toComparablePathKey(rawPath));
}

export function normalizeRelativePathFromRoot(rootPath: string, absolutePath: string): string {
  const resolvedRoot = normalizeComparableAbsolute(rootPath);
  const resolvedAbsolute = normalizeComparableAbsolute(absolutePath);
  const relative = path.posix.relative(resolvedRoot, resolvedAbsolute);

  if (!relative || relative === ".") {
    return normalizeProjectPath(path.posix.basename(resolvedAbsolute));
  }

  if (relative.startsWith("..") || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)) {
    throw new Error(`Path fuera de root de indexación: ${absolutePath}`);
  }

  const normalized = normalizeProjectPath(relative);
  if (!normalized || normalized.startsWith("..")) {
    throw new Error(`Path fuera de root de indexación: ${absolutePath}`);
  }
  return normalized;
}

export function toProjectRelativePath(rawPath: string, roots: ProjectPathRoots): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }

  if (!isAbsoluteCrossPlatform(trimmed)) {
    const normalized = normalizeProjectPath(trimmed);
    if (!normalized || normalized.startsWith("..")) {
      return null;
    }
    return normalized;
  }

  const comparableRaw = normalizeComparableAbsolute(trimmed);
  const comparableRawCandidates = [comparableRaw];
  const driveStrippedRaw = comparableRaw.replace(/^[a-z]:/i, "");
  if (driveStrippedRaw !== comparableRaw && driveStrippedRaw.startsWith("/")) {
    comparableRawCandidates.push(driveStrippedRaw);
  }
  const candidates = [roots.repo_root, roots.workspace_root].filter((entry): entry is string => Boolean(entry));

  for (const root of candidates) {
    const comparableRoot = normalizeComparableAbsolute(root);
    for (const rawCandidate of comparableRawCandidates) {
      const relative = path.posix.relative(comparableRoot, rawCandidate);
      if (!relative || relative === ".") {
        return normalizeProjectPath(path.posix.basename(rawCandidate));
      }
      if (relative.startsWith("..") || path.posix.isAbsolute(relative)) {
        continue;
      }
      return normalizeProjectPath(relative);
    }
  }

  return null;
}
