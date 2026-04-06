import { normalizeRelativePathFromRoot } from "../pathNormalization";

export function normalizeRelativePath(rootPath: string, absolutePath: string): string {
  return normalizeRelativePathFromRoot(rootPath, absolutePath);
}
