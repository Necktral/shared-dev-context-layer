import test from "node:test";
import assert from "node:assert/strict";
import { LoadOperationalContextService, type DiagnosticsPort, type PresenterPort } from "../../application/loadOperationalContextService";
import { InMemoryOperationalContextStore } from "../../application/operationalContextStore";
import { FixtureWISGateway } from "../../infrastructure/wis/fixtureWISGateway";
import { HandoffBuilder } from "../../application/handoffBuilder";
import { InMemoryHandoffArtifactStore } from "../../application/handoffArtifactStore";

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

test("integración load -> store -> prepare handoff", async () => {
  const contextStore = new InMemoryOperationalContextStore();

  const loadService = new LoadOperationalContextService({
    sessionManager: {
      consumer: "vscode_extension",
      async getOrCreateSession() {
        return {
          sessionKey: "integration-session",
          sessionCreatedAt: "2026-03-31T10:00:00.000Z",
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
          active_file: "/workspace/repo/src/entry.ts",
          timestamp: "2026-03-31T10:00:00.000Z",
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
      fixtureScenario: "success_full",
      diagnosticMode: true,
    }),
    createGateway: () => new FixtureWISGateway("success_full"),
  });

  await loadService.load();

  const handoffStore = new InMemoryHandoffArtifactStore();
  const handoffBuilder = new HandoffBuilder({
    contextStore,
    artifactStore: handoffStore,
    renderer: {
      render() {
        return undefined;
      },
    },
  });

  const result = handoffBuilder.build({
    intent: {
      user_intent: "Generar handoff integrado",
    },
    target: "codex",
  });

  assert.equal(result.status, "ready");
  assert.ok(result.artifact);
  assert.equal(handoffStore.getLastArtifact()?.meta.target, "codex");
});

test("paridad semántica de handoff entre envelope offline_fixture y mcp", () => {
  const baseEnvelope = {
    meta: {
      consumer: "vscode_extension",
      session_key: "parity-session",
      endpoint: "http://localhost:8002/mcp",
      fetched_at: "2026-03-31T10:00:00.000Z",
      transport_status: "ok" as const,
      load_state: "loaded" as const,
    },
    local_environment: {
      workspace_root: "/workspace",
      repo_root: "/workspace/repo",
      branch: "main",
      active_file: "/workspace/repo/src/parity.ts",
      inspector_status: "ok" as const,
      inspector_error: null,
      timestamp: "2026-03-31T10:00:00.000Z",
    },
    wis_context: {
      active_task: {
        tool: "get_active_task" as const,
        kind: "ok" as const,
        status: "ok" as const,
        payload: {
          status: "ok",
          task: {
            id: "task-parity",
            title: "Parity task",
            goal: "Keep same semantic artifact",
            status: "in_progress",
            next_action: "Implement parity checks",
          },
        },
        issues: [],
        raw: {},
      },
      context_snapshot: null,
      validation_status: {
        tool: "get_validation_status" as const,
        kind: "ok" as const,
        status: "ok" as const,
        payload: {
          status: "ok",
          current_status: "passed",
          summary: "all green",
          last_validation_source: "ci",
        },
        issues: [],
        raw: {},
      },
      approved_decisions: {
        tool: "get_approved_decisions" as const,
        kind: "ok" as const,
        status: "ok" as const,
        payload: {
          status: "ok",
          decisions: [{ decision_key: "a", title: "A", decision: "B" }],
        },
        issues: [],
        raw: {},
      },
      recent_errors: {
        tool: "get_recent_errors" as const,
        kind: "ok" as const,
        status: "ok" as const,
        payload: {
          status: "ok",
          total: 0,
          errors: [],
        },
        issues: [],
        raw: {},
      },
    },
    issues: [],
    authority_map: {
      canonical_fields: ["active_task"],
      local_hint_fields: ["active_file"],
      conflict_flags: [],
    },
    transport_diagnostics: {
      endpoint: "http://localhost:8002/mcp",
      timeout_ms: 5000,
      fetched_at: "2026-03-31T10:00:00.000Z",
    },
  };

  const contextStoreOffline = new InMemoryOperationalContextStore();
  contextStoreOffline.setLast({
    ...baseEnvelope,
    meta: {
      ...baseEnvelope.meta,
      runtime_mode: "offline_fixture",
    },
    transport_diagnostics: {
      ...baseEnvelope.transport_diagnostics,
      runtime_mode: "offline_fixture",
    },
  });

  const contextStoreMcp = new InMemoryOperationalContextStore();
  contextStoreMcp.setLast({
    ...baseEnvelope,
    meta: {
      ...baseEnvelope.meta,
      runtime_mode: "mcp",
    },
    transport_diagnostics: {
      ...baseEnvelope.transport_diagnostics,
      runtime_mode: "mcp",
    },
  });

  const builderOffline = new HandoffBuilder({
    contextStore: contextStoreOffline,
    artifactStore: new InMemoryHandoffArtifactStore(),
    renderer: { render() { return undefined; } },
  });

  const builderMcp = new HandoffBuilder({
    contextStore: contextStoreMcp,
    artifactStore: new InMemoryHandoffArtifactStore(),
    renderer: { render() { return undefined; } },
  });

  const offline = builderOffline.build({ intent: { user_intent: "parity" } });
  const mcp = builderMcp.build({ intent: { user_intent: "parity" } });

  assert.equal(offline.status, "ready");
  assert.equal(mcp.status, "ready");
  assert.equal(offline.artifact?.task_summary.id, mcp.artifact?.task_summary.id);
  assert.equal(offline.artifact?.current_goal, mcp.artifact?.current_goal);
  assert.deepEqual(offline.artifact?.approved_constraints, mcp.artifact?.approved_constraints);
  assert.deepEqual(offline.artifact?.candidate_files, mcp.artifact?.candidate_files);
  assert.equal(offline.artifact?.codex_code_prompt, mcp.artifact?.codex_code_prompt);
});
