import test from "node:test";
import assert from "node:assert/strict";
import { HandoffBuilder } from "../../application/handoffBuilder";
import { InMemoryHandoffArtifactStore } from "../../application/handoffArtifactStore";
import { InMemoryOperationalContextStore } from "../../application/operationalContextStore";
import type { OperationalContextEnvelope } from "../../domain/operationalContext";

function createEnvelope(loadState: OperationalContextEnvelope["meta"]["load_state"]): OperationalContextEnvelope {
  return {
    meta: {
      consumer: "vscode_extension",
      session_key: "session-1",
      endpoint: "http://localhost:8002/mcp",
      runtime_mode: "offline_fixture",
      fetched_at: "2026-03-31T10:00:00.000Z",
      transport_status: loadState === "loaded" ? "ok" : "partial",
      load_state: loadState,
    },
    local_environment: {
      workspace_root: "/workspace",
      repo_root: "/workspace/repo",
      branch: "local-feature",
      active_file: "/workspace/repo/src/feature.ts",
      inspector_status: "ok",
      inspector_error: null,
      timestamp: "2026-03-31T10:00:00.000Z",
    },
    wis_context: {
      active_task: {
        tool: "get_active_task",
        kind: "ok",
        status: "ok",
        payload: {
          status: "ok",
          task: {
            id: "task-001",
            title: "Implement handoff baseline",
            goal: "Generate structured handoff for Codex",
            status: "in_progress",
            priority: "high",
            next_action: "Implement builder and tests",
            branch: "main",
          },
        },
        issues: [],
        raw: {},
      },
      context_snapshot: null,
      validation_status: {
        tool: "get_validation_status",
        kind: "ok",
        status: "ok",
        payload: {
          status: "ok",
          current_status: "passed",
          summary: "CI green",
          last_validation_source: "ci",
        },
        issues: [],
        raw: {},
      },
      approved_decisions: {
        tool: "get_approved_decisions",
        kind: "ok",
        status: "ok",
        payload: {
          status: "ok",
          decisions: Array.from({ length: 12 }).map((_, index) => ({
            decision_key: `k${index + 1}`,
            title: `Decision ${index + 1}`,
            decision: `Statement ${index + 1}`,
          })),
        },
        issues: [],
        raw: {},
      },
      recent_errors: {
        tool: "get_recent_errors",
        kind: "ok",
        status: "ok",
        payload: {
          status: "ok",
          total: 12,
          errors: Array.from({ length: 12 }).map((_, index) => ({
            severity: index % 2 === 0 ? "error" : "warning",
            summary: `Error summary ${index + 1}`,
          })),
        },
        issues: [],
        raw: {},
      },
    },
    issues: [
      {
        kind: "transport",
        source: "get_recent_errors",
        severity: "warning",
        message: "Intermittent transport retries",
        recoverable: true,
        evidence_hint: "retry",
      },
      {
        kind: "domain",
        source: "authority_map",
        severity: "warning",
        message: "local_branch_vs_wis_branch_mismatch",
        recoverable: true,
        evidence_hint: "check branch",
      },
    ],
    authority_map: {
      canonical_fields: ["active_task"],
      local_hint_fields: ["branch"],
      conflict_flags: ["local_branch_vs_wis_branch_mismatch"],
    },
    transport_diagnostics: {
      endpoint: "http://localhost:8002/mcp",
      runtime_mode: "offline_fixture",
      timeout_ms: 5000,
      fetched_at: "2026-03-31T10:00:00.000Z",
    },
  };
}

function createBuilderWithEnvelope(envelope: OperationalContextEnvelope | null) {
  const contextStore = new InMemoryOperationalContextStore();
  if (envelope) {
    contextStore.setLast(envelope);
  }

  const artifactStore = new InMemoryHandoffArtifactStore();
  const renderedStatuses: string[] = [];

  const builder = new HandoffBuilder({
    contextStore,
    artifactStore,
    renderer: {
      render(result) {
        renderedStatuses.push(result.status);
      },
    },
  });

  return {
    builder,
    artifactStore,
    renderedStatuses,
  };
}

test("HandoffBuilder retorna blocked cuando no hay envelope", () => {
  const { builder, artifactStore, renderedStatuses } = createBuilderWithEnvelope(null);

  const result = builder.build({
    intent: { user_intent: "Preparar handoff" },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.artifact, null);
  assert.ok(result.issues[0]?.message.includes("No hay OperationalContextEnvelope"));
  assert.equal(artifactStore.getLastResult()?.status, "blocked");
  assert.deepEqual(renderedStatuses, ["blocked"]);
});

test("HandoffBuilder genera artifact ready para load_state loaded", () => {
  const { builder } = createBuilderWithEnvelope(createEnvelope("loaded"));

  const result = builder.build({
    intent: {
      user_intent: "Preparar delegación para implementación",
      local_focus: ["/workspace/repo/src/domain/operationalContext.ts"],
    },
  });

  assert.equal(result.status, "ready");
  assert.ok(result.artifact);
  assert.equal(result.artifact?.task_summary.id, "task-001");
  assert.equal(result.artifact?.task_summary.title, "Implement handoff baseline");
  assert.equal(result.artifact?.current_goal, "Generate structured handoff for Codex");
  assert.equal(result.artifact?.meta.target, "codex");
  assert.equal(result.artifact?.meta.target_label, "Codex");
  assert.equal(result.artifact?.approved_constraints.length, 10);
  assert.equal(result.artifact?.recent_errors_summary.highlights.length, 10);
  assert.ok((result.artifact?.candidate_files.length ?? 0) <= 5);
  assert.ok((result.artifact?.open_risks.length ?? 0) <= 8);
  assert.ok(result.artifact?.codex_ask_prompt.includes("Agente objetivo: Codex"));
});

test("HandoffBuilder genera status partial con nota de incertidumbre", () => {
  const { builder } = createBuilderWithEnvelope(createEnvelope("partially_loaded"));

  const result = builder.build({
    intent: { user_intent: "Preparar handoff parcial" },
  });

  assert.equal(result.status, "partial");
  assert.ok(result.artifact?.meta.uncertainty_note);
  assert.ok(result.artifact?.codex_ask_prompt.includes("Incertidumbre actual"));
  assert.ok(result.artifact?.codex_code_prompt.includes("Incertidumbre actual"));
  assert.ok(result.issues.length > 0);
});

test("HandoffBuilder genera status partial cuando load_state es degraded", () => {
  const { builder } = createBuilderWithEnvelope(createEnvelope("degraded"));

  const result = builder.build({
    intent: { user_intent: "Preparar handoff degraded" },
  });

  assert.equal(result.status, "partial");
  assert.ok(result.artifact?.meta.uncertainty_note?.includes("degraded"));
});

test("HandoffBuilder bloquea cuando load_state es failed", () => {
  const { builder } = createBuilderWithEnvelope(createEnvelope("failed"));

  const result = builder.build({
    intent: { user_intent: "No debería construir" },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.artifact, null);
});

test("HandoffBuilder preserva autoridad canónica sobre hints locales", () => {
  const envelope = createEnvelope("loaded");
  envelope.local_environment.branch = "local-only-branch";

  const { builder } = createBuilderWithEnvelope(envelope);
  const result = builder.build({
    intent: {
      user_intent: "Validar autoridad",
      local_focus: ["/workspace/repo/src/local-only.ts"],
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.artifact?.task_summary.id, "task-001");
  assert.equal(result.artifact?.task_summary.title, "Implement handoff baseline");
  assert.equal(result.artifact?.local_focus.branch, "local-only-branch");
});

test("HandoffBuilder soporta target custom con label explícito", () => {
  const { builder } = createBuilderWithEnvelope(createEnvelope("loaded"));

  const result = builder.build({
    intent: { user_intent: "Preparar handoff custom" },
    target: "custom",
    targetLabel: "Necktral Agent",
  });

  assert.equal(result.status, "ready");
  assert.equal(result.artifact?.meta.target, "custom");
  assert.equal(result.artifact?.meta.target_label, "Necktral Agent");
  assert.ok(result.artifact?.codex_ask_prompt.includes("Agente objetivo: Necktral Agent"));
  assert.ok(result.artifact?.codex_code_prompt.includes("para Necktral Agent."));
});
