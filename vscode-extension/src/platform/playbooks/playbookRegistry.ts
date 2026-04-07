import * as fs from "node:fs";
import * as path from "node:path";
import {
  parsePlaybookDocument,
  type ParsedPlaybook,
  type PlaybookAction,
} from "./playbookFrontmatter";

export interface PlaybookRegistryRoots {
  systemRoot: string;
  workspaceRoot?: string | null;
  projectRoot?: string | null;
}

const TIER_WEIGHT: Record<ParsedPlaybook["sourceTier"], number> = {
  system: 1,
  workspace: 2,
  project: 3,
};

function isBetterCandidate(candidate: ParsedPlaybook, current: ParsedPlaybook): boolean {
  if (candidate.frontmatter.priority !== current.frontmatter.priority) {
    return candidate.frontmatter.priority < current.frontmatter.priority;
  }
  return TIER_WEIGHT[candidate.sourceTier] > TIER_WEIGHT[current.sourceTier];
}

export class PlaybookRegistry {
  constructor(private readonly roots: PlaybookRegistryRoots) {}

  public loadAll(): ParsedPlaybook[] {
    const docs = [
      ...this.readTier(this.roots.systemRoot, "system"),
      ...this.readTier(this.roots.workspaceRoot ?? null, "workspace"),
      ...this.readTier(this.roots.projectRoot ?? null, "project"),
    ].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));

    const byId = new Map<string, ParsedPlaybook>();

    for (const doc of docs) {
      const current = byId.get(doc.frontmatter.id);
      if (!current || isBetterCandidate(doc, current)) {
        byId.set(doc.frontmatter.id, doc);
      }
    }

    return [...byId.values()].sort(
      (left, right) =>
        left.frontmatter.priority - right.frontmatter.priority ||
        TIER_WEIGHT[right.sourceTier] - TIER_WEIGHT[left.sourceTier] ||
        left.frontmatter.id.localeCompare(right.frontmatter.id),
    );
  }

  public resolveForAction(action: PlaybookAction): ParsedPlaybook[] {
    return this.loadAll().filter((doc) => doc.frontmatter.applies_to.includes(action));
  }

  private readTier(root: string | null, tier: ParsedPlaybook["sourceTier"]): ParsedPlaybook[] {
    if (!root || !fs.existsSync(root)) {
      return [];
    }

    const files = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(root, entry.name));

    return files.map((filePath) =>
      parsePlaybookDocument(fs.readFileSync(filePath, "utf8"), filePath, tier),
    );
  }
}
