import * as path from "node:path";

export interface ProjectPathRoots {
  repo_root: string | null;
  workspace_root: string | null;
}

function isAbsoluteCrossPlatform(value: string): boolean {
  return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function collapsePosixSeparators(value: string): string {
  return value.replace(/\/{2,}/g, "/");
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
  const resolvedRoot = path.resolve(rootPath);
  const resolvedAbsolute = path.resolve(absolutePath);
  const relative = path.relative(resolvedRoot, resolvedAbsolute);

  if (!relative || relative === ".") {
    return normalizeProjectPath(path.posix.basename(normalizeSlashes(resolvedAbsolute)));
  }

  if (relative.startsWith("..") || path.isAbsolute(relative) || path.win32.isAbsolute(relative)) {
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

  const normalizedRawInput = normalizeSlashes(trimmed);
  const resolvedRaw = path.win32.isAbsolute(trimmed) && !path.isAbsolute(trimmed)
    ? normalizedRawInput.replace(/^[A-Za-z]:/, "")
    : normalizeSlashes(path.resolve(trimmed));
  const comparableRaw = collapsePosixSeparators(
    resolvedRaw.startsWith("/") ? resolvedRaw : `/${resolvedRaw}`,
  );
  const candidates = [roots.repo_root, roots.workspace_root].filter((entry): entry is string => Boolean(entry));

  for (const root of candidates) {
    const comparableRoot = collapsePosixSeparators(normalizeSlashes(path.resolve(root)));
    const relative = path.posix.relative(comparableRoot, comparableRaw);
    if (!relative || relative === ".") {
      return normalizeProjectPath(path.posix.basename(comparableRaw));
    }
    if (relative.startsWith("..") || path.posix.isAbsolute(relative)) {
      continue;
    }
    return normalizeProjectPath(relative);
  }

  return null;
}
