import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PlaybookRegistry } from "../../../platform/playbooks/playbookRegistry";

function writePlaybook(root: string, fileName: string, body: string): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, fileName), body, "utf8");
}

test("PlaybookRegistry aplica precedencia por prioridad y tier", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "playbooks-registry-"));
  const systemRoot = path.join(tempRoot, "system");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const projectRoot = path.join(tempRoot, "project");

  writePlaybook(
    systemRoot,
    "pb-shared-system.md",
    `---
id: pb-shared
title: System base
kind: validation
priority: 20
applies_to: post_review
---
system`,
  );
  writePlaybook(
    workspaceRoot,
    "pb-shared-workspace.md",
    `---
id: pb-shared
title: Workspace preferred by priority
kind: validation
priority: 10
applies_to: post_review
---
workspace`,
  );
  writePlaybook(
    projectRoot,
    "pb-shared-project.md",
    `---
id: pb-shared
title: Project lower priority than workspace
kind: validation
priority: 15
applies_to: post_review
---
project`,
  );
  writePlaybook(
    systemRoot,
    "pb-tie-system.md",
    `---
id: pb-tie
title: System tie
kind: followup
priority: 5
applies_to: local_run_codex
---
system`,
  );
  writePlaybook(
    projectRoot,
    "pb-tie-project.md",
    `---
id: pb-tie
title: Project wins tie
kind: followup
priority: 5
applies_to: local_run_codex
---
project`,
  );

  const registry = new PlaybookRegistry({
    systemRoot,
    workspaceRoot,
    projectRoot,
  });

  const all = registry.loadAll();
  const pbShared = all.find((doc) => doc.frontmatter.id === "pb-shared");
  const pbTie = all.find((doc) => doc.frontmatter.id === "pb-tie");

  assert.equal(pbShared?.frontmatter.title, "Workspace preferred by priority");
  assert.equal(pbShared?.sourceTier, "workspace");
  assert.equal(pbTie?.frontmatter.title, "Project wins tie");
  assert.equal(pbTie?.sourceTier, "project");

  const forPostReview = registry.resolveForAction("post_review");
  assert.equal(forPostReview.some((doc) => doc.frontmatter.id === "pb-shared"), true);
  assert.equal(forPostReview.some((doc) => doc.frontmatter.id === "pb-tie"), false);
});
