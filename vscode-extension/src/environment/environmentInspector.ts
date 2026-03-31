import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export type InspectorStatus = "ok" | "no_workspace" | "no_repo" | "error";

export interface EnvironmentSnapshot {
  workspace_root: string | null;
  repo_root: string | null;
  branch: string | null;
  active_file: string | null;
  timestamp: string;
  inspector_status: InspectorStatus;
  inspector_error: string | null;
}

export class EnvironmentInspector {
  public async inspect(): Promise<EnvironmentSnapshot> {
    const timestamp = new Date().toISOString();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
    const activeFile = this.getActiveFilePath();

    if (!workspaceRoot) {
      return {
        workspace_root: null,
        repo_root: null,
        branch: null,
        active_file: activeFile,
        timestamp,
        inspector_status: "no_workspace",
        inspector_error: null,
      };
    }

    try {
      const probePath = activeFile ?? workspaceRoot;
      const repoRoot = await this.findRepoRoot(probePath);
      if (!repoRoot) {
        return {
          workspace_root: workspaceRoot,
          repo_root: null,
          branch: null,
          active_file: activeFile,
          timestamp,
          inspector_status: "no_repo",
          inspector_error: null,
        };
      }

      const branch = await this.readBranchName(repoRoot);
      return {
        workspace_root: workspaceRoot,
        repo_root: repoRoot,
        branch,
        active_file: activeFile,
        timestamp,
        inspector_status: "ok",
        inspector_error: null,
      };
    } catch (error) {
      return {
        workspace_root: workspaceRoot,
        repo_root: null,
        branch: null,
        active_file: activeFile,
        timestamp,
        inspector_status: "error",
        inspector_error: error instanceof Error ? error.message : "unknown_error",
      };
    }
  }

  private getActiveFilePath(): string | null {
    const document = vscode.window.activeTextEditor?.document;
    if (!document || document.uri.scheme !== "file") {
      return null;
    }
    return document.uri.fsPath;
  }

  private async findRepoRoot(startPath: string): Promise<string | null> {
    let current = startPath;
    try {
      const stat = await fs.stat(startPath);
      if (!stat.isDirectory()) {
        current = path.dirname(startPath);
      }
    } catch {
      current = path.dirname(startPath);
    }

    while (true) {
      const dotGitPath = path.join(current, ".git");
      if (await this.pathExists(dotGitPath)) {
        return current;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        return null;
      }
      current = parent;
    }
  }

  private async readBranchName(repoRoot: string): Promise<string | null> {
    const gitDir = await this.resolveGitDir(repoRoot);
    const headPath = path.join(gitDir, "HEAD");
    const headRaw = await fs.readFile(headPath, "utf8");
    const head = headRaw.trim();

    if (head.startsWith("ref:")) {
      const ref = head.replace(/^ref:\s*/, "");
      if (ref.startsWith("refs/heads/")) {
        return ref.replace("refs/heads/", "");
      }
      return ref;
    }

    return head.length >= 12 ? head.slice(0, 12) : head;
  }

  private async resolveGitDir(repoRoot: string): Promise<string> {
    const dotGitPath = path.join(repoRoot, ".git");
    const stat = await fs.stat(dotGitPath);
    if (stat.isDirectory()) {
      return dotGitPath;
    }

    const dotGitContent = (await fs.readFile(dotGitPath, "utf8")).trim();
    const match = dotGitContent.match(/^gitdir:\s*(.+)$/i);
    if (!match) {
      throw new Error("invalid_gitdir_pointer");
    }

    const gitdir = match[1].trim();
    return path.isAbsolute(gitdir) ? gitdir : path.resolve(repoRoot, gitdir);
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}
