import test from "node:test";
import assert from "node:assert/strict";
import { LoadOperationalContextService, type DiagnosticsPort, type PresenterPort } from "../../application/loadOperationalContextService";
import { FixtureWISGateway, type FixtureScenario } from "../../infrastructure/wis/fixtureWISGateway";
import { InMemoryOperationalContextStore } from "../../application/operationalContextStore";

function noOpDiagnostics(): DiagnosticsPort {
  return {
    reportLoadEvent() {
      return undefined;
    },
    reportOperationalEnvelope() {
      return undefined;
    },
  };
}

function noOpPresenter(): PresenterPort {
  return {
    present() {
      return undefined;
    },
  };
}

const SCENARIO_EXPECTATIONS: Array<{
  scenario: FixtureScenario;
  load_state: "loaded" | "partially_loaded" | "degraded" | "failed";
  transport_status: "ok" | "partial" | "degraded" | "transport_error" | "schema_error" | "unavailable";
}> = [
  { scenario: "success_full", load_state: "loaded", transport_status: "ok" },
  { scenario: "partial_missing_recent_errors", load_state: "partially_loaded", transport_status: "transport_error" },
  { scenario: "degraded_no_remote_bundle", load_state: "degraded", transport_status: "unavailable" },
  { scenario: "transport_error", load_state: "degraded", transport_status: "transport_error" },
  { scenario: "no_active_task", load_state: "partially_loaded", transport_status: "partial" },
  { scenario: "validation_stale", load_state: "loaded", transport_status: "ok" },
];

for (const expected of SCENARIO_EXPECTATIONS) {
  test(`offline_fixture scenario ${expected.scenario} mantiene load/transport esperados`, async () => {
    const contextStore = new InMemoryOperationalContextStore();
    const service = new LoadOperationalContextService({
      sessionManager: {
        consumer: "vscode_extension",
        async getOrCreateSession() {
          return {
            sessionKey: `matrix-${expected.scenario}`,
            sessionCreatedAt: "2026-04-07T12:00:00.000Z",
            sessionState: "reused",
          };
        },
      },
      environmentInspector: {
        async inspect() {
          return {
            workspace_root: "/workspace",
            repo_root: "/workspace/repo",
            branch: "main",
            active_file: "/workspace/repo/src/index.ts",
            timestamp: "2026-04-07T12:00:00.000Z",
            inspector_status: "ok",
            inspector_error: null,
          };
        },
      },
      diagnostics: noOpDiagnostics(),
      presenter: noOpPresenter(),
      contextStore,
      getConfig: () => ({
        endpoint: "http://localhost:8002/mcp",
        runtimeMode: "offline_fixture",
        timeoutMs: 5000,
        fixtureScenario: expected.scenario,
        diagnosticMode: true,
      }),
      createGateway: () => new FixtureWISGateway(expected.scenario),
    });

    const envelope = await service.load();
    assert.equal(envelope.meta.runtime_mode, "offline_fixture");
    assert.equal(envelope.meta.load_state, expected.load_state);
    assert.equal(envelope.meta.transport_status, expected.transport_status);
    assert.equal(contextStore.getLast()?.meta.load_state, expected.load_state);
  });
}

test("offline_fixture validation_stale expone issue de dominio explicito", async () => {
  const service = new LoadOperationalContextService({
    sessionManager: {
      consumer: "vscode_extension",
      async getOrCreateSession() {
        return {
          sessionKey: "matrix-validation-stale",
          sessionCreatedAt: "2026-04-07T12:00:00.000Z",
          sessionState: "reused",
        };
      },
    },
    environmentInspector: {
      async inspect() {
        return {
          workspace_root: "/workspace",
          repo_root: "/workspace/repo",
          branch: "main",
          active_file: "/workspace/repo/src/index.ts",
          timestamp: "2026-04-07T12:00:00.000Z",
          inspector_status: "ok",
          inspector_error: null,
        };
      },
    },
    diagnostics: noOpDiagnostics(),
    presenter: noOpPresenter(),
    getConfig: () => ({
      endpoint: "http://localhost:8002/mcp",
      runtimeMode: "offline_fixture",
      timeoutMs: 5000,
      fixtureScenario: "validation_stale",
      diagnosticMode: true,
    }),
    createGateway: () => new FixtureWISGateway("validation_stale"),
  });

  const envelope = await service.load();
  const staleIssue = envelope.issues.find((issue) => issue.conflict_flag === "validation_stale");

  assert.ok(staleIssue);
  assert.equal(staleIssue?.kind, "domain");
  assert.equal(staleIssue?.source, "get_validation_status");
});
