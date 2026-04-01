import test from "node:test";
import assert from "node:assert/strict";
import { CodexCliRunner } from "../../local/codexCliRunner";

test("CodexCliRunner healthcheck reporta ok con binario disponible", async () => {
  const runner = new CodexCliRunner({ timeoutMs: 5000 });
  const result = await runner.healthcheck(process.execPath);

  assert.equal(result.mode, "healthcheck");
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(typeof result.duration_ms, "number");
});

test("CodexCliRunner healthcheck reporta error con binario inexistente", async () => {
  const runner = new CodexCliRunner({ timeoutMs: 5000 });
  const result = await runner.healthcheck("codex_binario_que_no_existe_12345");

  assert.equal(result.mode, "healthcheck");
  assert.equal(result.ok, false);
  assert.ok(result.error !== null);
});
