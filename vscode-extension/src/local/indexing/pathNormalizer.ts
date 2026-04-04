import * as path from "node:path";

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

export function normalizeRelativePath(rootPath: string, absolutePath: string): string {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedAbsolute = path.resolve(absolutePath);
  const relative = path.relative(resolvedRoot, resolvedAbsolute);

  if (!relative || relative === ".") {
    return path.posix.basename(resolvedAbsolute);
  }

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path fuera de root de indexación: ${absolutePath}`);
  }

  return toPosixPath(relative);
}
