import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import type { LocalIndexConfig } from "../../config";
import type { IndexedFileCandidate } from "../ports";
import { FileHasher } from "./fileHasher";
import { normalizeRelativePath } from "./pathNormalizer";
import { TextFileDetector } from "./textFileDetector";

export interface WorkspaceScanResult {
  candidates: IndexedFileCandidate[];
  skipped: number;
  errors: number;
}

function normalizeExtension(extension: string): string {
  if (!extension) {
    return "";
  }
  return extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
}

export class WorkspaceFileScanner {
  public async scan(rootPath: string, config: LocalIndexConfig): Promise<WorkspaceScanResult> {
    const candidates: IndexedFileCandidate[] = [];
    const excludeSet = new Set(config.excludeDirs.map((entry) => entry.trim()).filter((entry) => entry.length > 0));
    const includeSet = new Set(config.includeExtensions.map((entry) => normalizeExtension(entry)).filter((entry) => entry.length > 0));

    let skipped = 0;
    let errors = 0;
    const queue: string[] = [path.resolve(rootPath)];

    while (queue.length > 0) {
      const currentDir = queue.pop();
      if (!currentDir) {
        continue;
      }

      let entries: Dirent[];
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        errors += 1;
        continue;
      }

      for (const entry of entries) {
        const absolutePath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (excludeSet.has(entry.name)) {
            continue;
          }
          queue.push(absolutePath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const extension = normalizeExtension(path.extname(entry.name));
        if (!includeSet.has(extension)) {
          skipped += 1;
          continue;
        }

        let stat: Awaited<ReturnType<typeof fs.stat>>;
        try {
          stat = await fs.stat(absolutePath);
        } catch {
          errors += 1;
          continue;
        }

        if (stat.size > config.maxFileBytes) {
          skipped += 1;
          continue;
        }

        let rawContent: Buffer;
        try {
          rawContent = await fs.readFile(absolutePath);
        } catch {
          errors += 1;
          continue;
        }

        if (!TextFileDetector.isLikelyText(rawContent)) {
          skipped += 1;
          continue;
        }

        let relativePath: string;
        try {
          relativePath = normalizeRelativePath(rootPath, absolutePath);
        } catch {
          skipped += 1;
          continue;
        }

        const utf8Content = rawContent.toString("utf8");
        candidates.push({
          absolutePath,
          relativePath,
          extension,
          sizeBytes: stat.size,
          contentHash: FileHasher.sha256FromBuffer(rawContent),
          content: utf8Content,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
    }

    candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

    return {
      candidates,
      skipped,
      errors,
    };
  }
}
