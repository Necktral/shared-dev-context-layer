import test from "node:test";
import assert from "node:assert/strict";
import {
  WorkspaceBoundaryError,
  WorkspaceBoundaryGuard,
} from "../../../platform/security/workspaceBoundaryGuard";

test("WorkspaceBoundaryGuard valida snapshot dentro de boundaries", () => {
  const guard = new WorkspaceBoundaryGuard();
  assert.doesNotThrow(() => {
    guard.assertSnapshot({
      workspaceRoot: "/workspace",
      repoRoot: "/workspace/repo",
      activeFile: "/workspace/repo/src/index.ts",
    });
  });
});

test("WorkspaceBoundaryGuard falla cuando falta workspaceRoot", () => {
  const guard = new WorkspaceBoundaryGuard();
  assert.throws(
    () =>
      guard.assertSnapshot({
        workspaceRoot: null,
        repoRoot: "/workspace/repo",
        activeFile: "/workspace/repo/src/index.ts",
      }),
    WorkspaceBoundaryError,
  );
});

test("WorkspaceBoundaryGuard detecta escape de root", () => {
  const guard = new WorkspaceBoundaryGuard();
  assert.throws(
    () => guard.assertWithinRoot("/workspace/other/file.ts", "/workspace/repo", "test"),
    WorkspaceBoundaryError,
  );
});

test("WorkspaceBoundaryGuard filtra candidate_files fuera de boundary y deduplica", () => {
  const guard = new WorkspaceBoundaryGuard();
  const files = guard.safeCandidateFiles(
    [
      "src/index.ts",
      "src/index.ts",
      "/workspace/repo/src/app.ts",
      "/workspace/other/escape.ts",
      "../escape.ts",
    ],
    "/workspace/repo",
  );
  assert.deepEqual(files.sort(), ["/workspace/repo/src/app.ts", "/workspace/repo/src/index.ts"]);
});
