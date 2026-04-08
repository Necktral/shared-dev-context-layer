import test from "node:test";
import assert from "node:assert/strict";
import { renderLoadContextOutput } from "../../tools/loadContextOutput";

const BASE_TIMESTAMP = "2026-04-07T12:00:00.000Z";

test("renderLoadContextOutput emite A1 success_full con loaded/ok", async () => {
  const { output, envelope } = await renderLoadContextOutput({
    runtimeMode: "offline_fixture",
    fixtureScenario: "success_full",
    endpoint: "http://localhost:8002/mcp",
    timeoutMs: 5000,
    diagnosticMode: true,
    session: {
      key: "manual-a1-session",
      createdAt: BASE_TIMESTAMP,
      state: "reused",
    },
    environment: {
      workspaceRoot: "/workspace",
      repoRoot: "/workspace/repo",
      branch: "main",
      activeFile: null,
      inspectorStatus: "ok",
      inspectorError: null,
      timestamp: BASE_TIMESTAMP,
    },
  });

  assert.match(output, /^\[WIS\] load_started/m);
  assert.match(output, /^\[WIS\] load_operational_context$/m);
  assert.match(output, /^runtime_mode: offline_fixture$/m);
  assert.match(output, /^load_state: loaded$/m);
  assert.match(output, /^transport_status: ok$/m);
  assert.equal(envelope.meta.load_state, "loaded");
  assert.equal(envelope.meta.transport_status, "ok");
});

test("renderLoadContextOutput emite bandera stale en validation_stale", async () => {
  const { output, envelope } = await renderLoadContextOutput({
    runtimeMode: "offline_fixture",
    fixtureScenario: "validation_stale",
    endpoint: "http://localhost:8002/mcp",
    timeoutMs: 5000,
    diagnosticMode: true,
    session: {
      key: "manual-a6-session",
      createdAt: BASE_TIMESTAMP,
      state: "reused",
    },
    environment: {
      workspaceRoot: "/workspace",
      repoRoot: "/workspace/repo",
      branch: "main",
      activeFile: null,
      inspectorStatus: "ok",
      inspectorError: null,
      timestamp: BASE_TIMESTAMP,
    },
  });

  assert.match(output, /^load_state: loaded$/m);
  assert.match(output, /^transport_status: ok$/m);
  assert.match(output, /Validation status reportado como stale\./);
  assert.ok(envelope.issues.some((issue) => issue.conflict_flag === "validation_stale"));
});
