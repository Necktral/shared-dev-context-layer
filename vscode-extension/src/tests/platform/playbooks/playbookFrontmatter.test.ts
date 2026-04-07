import test from "node:test";
import assert from "node:assert/strict";
import { parsePlaybookDocument } from "../../../platform/playbooks/playbookFrontmatter";

test("parsePlaybookDocument parsea frontmatter válido", () => {
  const parsed = parsePlaybookDocument(
    `---
id: pb-1
title: Validar run
kind: validation
priority: 10
applies_to: post_review, local_run_codex
tags: review, local
---
Contenido del playbook.`,
    "/tmp/pb-1.md",
    "workspace",
  );

  assert.equal(parsed.frontmatter.id, "pb-1");
  assert.equal(parsed.frontmatter.kind, "validation");
  assert.deepEqual(parsed.frontmatter.applies_to, ["post_review", "local_run_codex"]);
  assert.deepEqual(parsed.frontmatter.tags, ["review", "local"]);
  assert.equal(parsed.body, "Contenido del playbook.");
});

test("parsePlaybookDocument falla cuando no hay frontmatter", () => {
  assert.throws(
    () => parsePlaybookDocument("sin frontmatter", "/tmp/invalid.md", "system"),
    /Playbook sin frontmatter válido/,
  );
});

test("parsePlaybookDocument falla con kind inválido", () => {
  assert.throws(
    () =>
      parsePlaybookDocument(
        `---
id: pb-2
title: Invalid
kind: unknown
priority: 1
applies_to: post_review
---
contenido`,
        "/tmp/invalid-kind.md",
        "system",
      ),
    /kind inválido/,
  );
});
