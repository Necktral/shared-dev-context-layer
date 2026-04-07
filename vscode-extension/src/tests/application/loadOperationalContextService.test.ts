import test from "node:test";
import assert from "node:assert/strict";
import { LoadOperationalContextService, type DiagnosticsPort, type PresenterPort } from "../../application/loadOperationalContextService";
import { FixtureWISGateway } from "../../infrastructure/wis/fixtureWISGateway";
import { InMemoryOperationalContextStore } from "../../application/operationalContextStore";

test("LoadOperationalContextService ejecuta pipeline completo y presenta envelope", async () => {
  const diagnosticsEvents: string[] = [];
  const diagnostics: DiagnosticsPort = {
    reportLoadEvent(event) {
      diagnosticsEvents.push(event.event);
    },
    reportOperationalEnvelope() {
      diagnosticsEvents.push("envelope_reported");
    },
  };

  let presentedLoadState = "";
  const contextStore = new InMemoryOperationalContextStore();
  const presenter: PresenterPort = {
    present(envelope) {
      presentedLoadState = envelope.meta.load_state;
    },
  };

  const service = new LoadOperationalContextService({
    sessionManager: {
      consumer: "vscode_extension",
      async getOrCreateSession() {
        return {
          sessionKey: "session-abc",
          sessionCreatedAt: new Date().toISOString(),
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
          timestamp: new Date().toISOString(),
          inspector_status: "ok",
          inspector_error: null,
        };
      },
    },
    diagnostics,
    presenter,
    contextStore,
    getConfig: () => ({
      endpoint: "http://localhost:8002/mcp",
      runtimeMode: "offline_fixture",
      timeoutMs: 5000,
      fixtureScenario: "success_full",
      diagnosticMode: true,
    }),
    createGateway: () => new FixtureWISGateway("success_full"),
  });

  const envelope = await service.load();

  assert.equal(envelope.meta.load_state, "loaded");
  assert.equal(presentedLoadState, "loaded");
  assert.ok(diagnosticsEvents.includes("load_started"));
  assert.ok(diagnosticsEvents.includes("load_completed"));
  assert.ok(diagnosticsEvents.includes("envelope_reported"));
  assert.equal(contextStore.getLast()?.meta.session_key, envelope.meta.session_key);
});

test("LoadOperationalContextService respeta runtimeMode mcp sin fallback automático", async () => {
  const observedRuntimeModes: string[] = [];

  const service = new LoadOperationalContextService({
    sessionManager: {
      consumer: "vscode_extension",
      async getOrCreateSession() {
        return {
          sessionKey: "session-mcp-strict",
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
    diagnostics: {
      reportLoadEvent() {
        return undefined;
      },
      reportOperationalEnvelope() {
        return undefined;
      },
    },
    presenter: {
      present() {
        return undefined;
      },
    },
    getConfig: () => ({
      endpoint: "http://localhost:8002/mcp",
      runtimeMode: "mcp",
      timeoutMs: 5000,
      fixtureScenario: "success_full",
      diagnosticMode: true,
    }),
    createGateway: (config) => {
      observedRuntimeModes.push(config.runtimeMode);
      return new FixtureWISGateway("transport_error");
    },
  });

  const envelope = await service.load();

  assert.deepEqual(observedRuntimeModes, ["mcp"]);
  assert.equal(envelope.meta.runtime_mode, "mcp");
  assert.equal(envelope.transport_diagnostics.runtime_mode, "mcp");
  assert.notEqual(envelope.meta.runtime_mode, "offline_fixture");
});
