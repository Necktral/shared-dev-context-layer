import test from "node:test";
import assert from "node:assert/strict";
import { FixtureWISGateway } from "../../infrastructure/wis/fixtureWISGateway";

const baseInput = {
  endpoint: "http://localhost:8002/mcp",
  runtime_mode: "offline_fixture" as const,
  timeout_ms: 5000,
  consumer: "vscode_extension",
  session_key: "session-fixture",
};

test("FixtureWISGateway success_full produce bundle success", async () => {
  const gateway = new FixtureWISGateway("success_full");
  const bundle = await gateway.loadOperationalBundle(baseInput);

  assert.equal(bundle.status, "success");
  assert.equal(bundle.tool_results.get_active_task.kind, "ok");
  assert.equal(bundle.tool_results.get_recent_errors.kind, "ok");
});

test("FixtureWISGateway partial_missing_recent_errors produce bundle partial", async () => {
  const gateway = new FixtureWISGateway("partial_missing_recent_errors");
  const bundle = await gateway.loadOperationalBundle(baseInput);

  assert.equal(bundle.status, "partial");
  assert.equal(bundle.tool_results.get_recent_errors.kind, "transport_error");
});

test("FixtureWISGateway degraded_no_remote_bundle produce bundle failure", async () => {
  const gateway = new FixtureWISGateway("degraded_no_remote_bundle");
  const bundle = await gateway.loadOperationalBundle(baseInput);

  assert.equal(bundle.status, "failure");
  assert.equal(bundle.tool_results.get_active_task.kind, "unavailable");
});

test("FixtureWISGateway no_active_task conserva estado remoto tipado", async () => {
  const gateway = new FixtureWISGateway("no_active_task");
  const bundle = await gateway.loadOperationalBundle(baseInput);

  assert.equal(bundle.status, "partial");
  assert.equal(bundle.tool_results.get_active_task.kind, "remote_error");
  assert.equal(bundle.tool_results.get_active_task.status, "no_active_task");
});

test("FixtureWISGateway validation_stale conserva payload stale", async () => {
  const gateway = new FixtureWISGateway("validation_stale");
  const bundle = await gateway.loadOperationalBundle(baseInput);

  assert.equal(bundle.status, "success");
  const payload = bundle.tool_results.get_validation_status.payload as { current_status?: string } | null;
  assert.equal(payload?.current_status, "stale");
});
