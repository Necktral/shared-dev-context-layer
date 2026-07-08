import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const testRoot = join(root, "dist", "tests");
const localDbOnly = process.argv.includes("--local-db");

function collectTests(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTests(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }
  return files;
}

if (!statSync(testRoot, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`Test output directory not found: ${testRoot}`);
  process.exit(1);
}

const tests = collectTests(localDbOnly ? join(testRoot, "local-db") : testRoot).sort((left, right) =>
  left.localeCompare(right),
);
if (tests.length === 0) {
  console.error(`No compiled tests found under ${testRoot}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...tests], {
  stdio: "inherit",
  env: localDbOnly ? { ...process.env, LOCAL_DB_TESTS: "1" } : process.env,
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
