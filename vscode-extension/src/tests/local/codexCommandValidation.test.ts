import test from "node:test";
import assert from "node:assert/strict";
import { validateCodexExecutableCommand } from "../../local/codexCommandValidation";

test("validateCodexExecutableCommand usa fallback codex cuando está vacío", () => {
  const result = validateCodexExecutableCommand("   ");
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("expected ok");
  }
  assert.equal(result.executable, "codex");
});

test("validateCodexExecutableCommand acepta ejecutable único", () => {
  const result = validateCodexExecutableCommand("codex");
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("expected ok");
  }
  assert.equal(result.executable, "codex");
});

test("validateCodexExecutableCommand acepta ruta con espacios entre comillas", () => {
  const result = validateCodexExecutableCommand("\"C:\\Program Files\\Codex\\codex.exe\"");
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("expected ok");
  }
  assert.equal(result.executable, "C:\\Program Files\\Codex\\codex.exe");
});

test("validateCodexExecutableCommand rechaza comando compuesto", () => {
  const result = validateCodexExecutableCommand("codex --profile dev");
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected invalid command");
  }
  assert.equal(result.error_code, "invalid_command_configuration");
});

test("validateCodexExecutableCommand rechaza comillas abiertas", () => {
  const result = validateCodexExecutableCommand("\"codex");
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected invalid command");
  }
  assert.equal(result.error_code, "invalid_command_configuration");
  assert.match(result.reason, /Comillas sin cierre/i);
});
