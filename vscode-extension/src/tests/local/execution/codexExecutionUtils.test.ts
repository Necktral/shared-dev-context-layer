import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCodexExecutionPrompt,
  capText,
  classifyCodexStderr,
  parseCodexJsonlOutput,
  sha256Hex,
} from "../../../local/execution/codexExecutionUtils";
import type { CodexExecutionRequest } from "../../../local/types";

function sampleRequest(): CodexExecutionRequest {
  return {
    task: {
      id: "task-1",
      objective: "Refactor auth token flow",
      context_summary: "Contexto de retrieval con evidencia relevante.",
      candidate_files: ["src/auth/tokenService.ts", "src/auth/sessionStore.ts"],
      constraints: ["No romper compatibilidad de API."],
      acceptance_criteria: ["Pruebas unitarias en verde."],
      execution_brief: {
        version: "v2",
        objective_compact: "Refactor auth token flow con minima regresion.",
        candidate_files: ["src/auth/tokenService.ts"],
        key_evidence: ["tokenService.ts#2: refresh token pipeline actual"],
        run_constraints: ["Mantener interfaz publica actual."],
        acceptance_checks: ["Cobertura en flujo refresh token."],
      },
      created_at: "2026-04-04T00:00:00.000Z",
    },
    repo_root: "/workspace/repo",
    workspace_root: "/workspace",
    branch: "main",
    active_file: "/workspace/repo/src/auth/tokenService.ts",
  };
}

test("buildCodexExecutionPrompt es determinista con misma entrada", () => {
  const request = sampleRequest();
  const first = buildCodexExecutionPrompt(request);
  const second = buildCodexExecutionPrompt(request);
  assert.equal(first, second);
  assert.match(first, /## Objetivo/);
  assert.match(first, /Refactor auth token flow/);
  assert.match(first, /repo_root: \/workspace\/repo/);
});

test("parseCodexJsonlOutput tolera mezcla de JSON y ruido", () => {
  const stdout = [
    "linea-no-json",
    '{"type":"thread.started","thread_id":"thread-abc"}',
    '{"type":"item.completed","item":{"id":"x","type":"agent_message","text":"Resultado final"}}',
    '{"type":"turn.completed","usage":{"input_tokens":12,"cached_input_tokens":2,"output_tokens":8}}',
    "otro ruido",
  ].join("\n");

  const parsed = parseCodexJsonlOutput(stdout);
  assert.equal(parsed.threadId, "thread-abc");
  assert.equal(parsed.finalMessage, "Resultado final");
  assert.equal(parsed.eventsCount, 3);
  assert.equal(parsed.ignoredLines, 2);
  assert.deepEqual(parsed.usageTokens, {
    input_tokens: 12,
    cached_input_tokens: 2,
    output_tokens: 8,
  });
});

test("classifyCodexStderr normaliza warnings conocidos y cuenta ocurrencias", () => {
  const stderr = [
    "2026-01-01 WARN codex_rmcp_client::oauth: failed to read OAuth tokens from keyring",
    "2026-01-01 WARN codex_state::runtime: failed to open state db at /tmp/db.sqlite",
    "2026-01-01 ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed",
    "mensaje informativo",
  ].join("\n");

  const summary = classifyCodexStderr(stderr);
  assert.equal(summary.warningCount, 3);
  assert.ok(summary.reasons.includes("oauth_keyring_unavailable"));
  assert.ok(summary.reasons.includes("state_db_warning"));
  assert.ok(summary.reasons.includes("transport_warning"));
});

test("capText y sha256Hex mantienen cap y hash estable", () => {
  const original = "0123456789".repeat(20);
  const capped = capText(original, 30);
  assert.ok(capped.length <= 30);
  assert.equal(sha256Hex("abc"), sha256Hex("abc"));
  assert.notEqual(sha256Hex("abc"), sha256Hex("abcd"));
});
