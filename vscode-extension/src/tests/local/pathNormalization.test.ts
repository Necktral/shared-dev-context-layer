import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProjectPath,
  normalizeRelativePathFromRoot,
  toComparableFilename,
  toComparablePathKey,
  toProjectRelativePath,
} from "../../local/pathNormalization";

test("normalizeProjectPath unifica separadores y prefijos", () => {
  assert.equal(normalizeProjectPath("./src//Auth\\Service.ts"), "src/Auth/Service.ts");
  assert.equal(normalizeProjectPath("  src\\module\\index.ts  "), "src/module/index.ts");
});

test("toComparablePathKey y toComparableFilename son estables", () => {
  assert.equal(toComparablePathKey("SRC/Auth/Service.TS"), "src/auth/service.ts");
  assert.equal(toComparableFilename("SRC/Auth/Service.TS"), "service.ts");
});

test("normalizeRelativePathFromRoot rechaza rutas fuera de root", () => {
  assert.equal(
    normalizeRelativePathFromRoot("/workspace/repo", "/workspace/repo/src/index.ts"),
    "src/index.ts",
  );
  assert.throws(
    () => normalizeRelativePathFromRoot("/workspace/repo", "/workspace/other/file.ts"),
    /Path fuera de root de indexación/,
  );
});

test("toProjectRelativePath resuelve absoluto a relativo y rechaza fuera de root", () => {
  const roots = { repo_root: "/workspace/repo", workspace_root: "/workspace" };
  assert.equal(toProjectRelativePath("/workspace/repo/src/feature.ts", roots), "src/feature.ts");
  assert.equal(toProjectRelativePath("src\\feature.ts", roots), "src/feature.ts");
  assert.equal(toProjectRelativePath("/outside/project/file.ts", roots), null);
  assert.equal(toProjectRelativePath("../escape.ts", roots), null);
});
