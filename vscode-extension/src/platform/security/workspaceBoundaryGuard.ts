import * as fs from "node:fs";
import * as path from "node:path";

export class WorkspaceBoundaryError extends Error {
  constructor(
    message: string,
    public readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WorkspaceBoundaryError";
  }
}

export interface BoundarySnapshot {
  workspaceRoot: string | null;
  repoRoot: string | null;
  activeFile: string | null;
}

export class WorkspaceBoundaryGuard {
  public normalize(input: string): string {
    return path.resolve(input);
  }

  public assertWithinRoot(targetPath: string, rootPath: string, reason: string): void {
    const normalizedTarget = this.normalize(targetPath);
    const normalizedRoot = this.normalize(rootPath);
    const relative = path.relative(normalizedRoot, normalizedTarget);
    const escaped =
      relative === "" ? false : relative.startsWith("..") || path.isAbsolute(relative);

    if (escaped) {
      throw new WorkspaceBoundaryError("Target path escapes root boundary.", {
        reason,
        rootPath: normalizedRoot,
        targetPath: normalizedTarget,
        relative,
      });
    }
  }

  public assertNoSymlinkEscape(targetPath: string, rootPath: string, reason: string): void {
    const realTarget = fs.realpathSync.native(targetPath);
    const realRoot = fs.realpathSync.native(rootPath);
    this.assertWithinRoot(realTarget, realRoot, reason);
  }

  public assertSnapshot(snapshot: BoundarySnapshot): void {
    if (!snapshot.workspaceRoot) {
      throw new WorkspaceBoundaryError("workspaceRoot is required.", { snapshot });
    }

    if (snapshot.repoRoot) {
      this.assertWithinRoot(
        snapshot.repoRoot,
        snapshot.workspaceRoot,
        "repoRoot must stay inside workspaceRoot",
      );
    }

    if (snapshot.activeFile && snapshot.repoRoot) {
      this.assertWithinRoot(
        snapshot.activeFile,
        snapshot.repoRoot,
        "activeFile must stay inside repoRoot",
      );
      return;
    }

    if (snapshot.activeFile) {
      this.assertWithinRoot(
        snapshot.activeFile,
        snapshot.workspaceRoot,
        "activeFile must stay inside workspaceRoot",
      );
    }
  }

  public safeCandidateFiles(
    candidateFiles: readonly string[],
    rootPath: string,
  ): string[] {
    const accepted = new Set<string>();
    const normalizedRoot = this.normalize(rootPath);

    for (const raw of candidateFiles) {
      const trimmed = raw.trim();
      if (!trimmed) {
        continue;
      }

      const normalized = path.isAbsolute(trimmed)
        ? this.normalize(trimmed)
        : this.normalize(path.join(normalizedRoot, trimmed));

      try {
        this.assertWithinRoot(normalized, normalizedRoot, "candidate file outside workspace");
        accepted.add(normalized);
      } catch {
        // filtro deliberado: se descartan candidatos fuera de boundary
      }
    }

    return [...accepted];
  }
}
