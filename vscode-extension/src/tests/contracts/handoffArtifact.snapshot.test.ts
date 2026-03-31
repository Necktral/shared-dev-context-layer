import test from "node:test";
import assert from "node:assert/strict";
import { HandoffBuilder } from "../../application/handoffBuilder";
import { InMemoryHandoffArtifactStore } from "../../application/handoffArtifactStore";
import { InMemoryOperationalContextStore } from "../../application/operationalContextStore";
import type { OperationalContextEnvelope } from "../../domain/operationalContext";

const SNAPSHOT_ARTIFACT = `{
  "task_summary": {
    "id": "task-100",
    "title": "Snapshot Task",
    "status": "in_progress",
    "priority": "medium"
  },
  "current_goal": "Ship stable handoff",
  "approved_constraints": [
    "read_only: Read only -> No writes",
    "authority: WIS first -> Canonical fields win"
  ],
  "validation_state": {
    "status": "passed",
    "summary": "Validation passing",
    "source": "ci"
  },
  "recent_errors_summary": {
    "status": "available",
    "total": 1,
    "highlights": [
      "[error] Snapshot error"
    ]
  },
  "local_focus": {
    "active_file": "/workspace/repo/src/handoff.ts",
    "branch": "main",
    "requested_focus": [
      "/workspace/repo/src/handoff.ts"
    ]
  },
  "candidate_files": [
    "/workspace/repo/src/handoff.ts"
  ],
  "open_risks": [],
  "recommended_next_action": "Implement handoff baseline",
  "codex_ask_prompt": "Objetivo actual: Ship stable handoff\\nTask: Snapshot Task (in_progress)\\nValidation: passed\\nRestricciones aprobadas:\\n- read_only: Read only -> No writes\\n- authority: WIS first -> Canonical fields win\\nRiesgos abiertos:\\n- Sin riesgos abiertos explícitos.",
  "codex_code_prompt": "Implementa el siguiente cambio de manera incremental y verificable.\\nObjetivo: Ship stable handoff\\nArchivos candidatos:\\n- /workspace/repo/src/handoff.ts\\nRestricciones aprobadas:\\n- read_only: Read only -> No writes\\n- authority: WIS first -> Canonical fields win\\nRiesgos abiertos:\\n- Sin riesgos abiertos explícitos.\\nIncluye pruebas y explica cualquier incertidumbre operativa detectada.",
  "meta": {
    "generated_at": "<timestamp>",
    "target": "codex",
    "source_consumer": "vscode_extension",
    "session_key": "snapshot-session",
    "runtime_mode": "offline_fixture",
    "load_state": "loaded",
    "transport_status": "ok",
    "uncertainty_note": null
  }
}`;

const SNAPSHOT_PROMPTS = `ASK\nObjetivo actual: Ship stable handoff
Task: Snapshot Task (in_progress)
Validation: passed
Restricciones aprobadas:
- read_only: Read only -> No writes
- authority: WIS first -> Canonical fields win
Riesgos abiertos:
- Sin riesgos abiertos explícitos.
---
CODE\nImplementa el siguiente cambio de manera incremental y verificable.
Objetivo: Ship stable handoff
Archivos candidatos:
- /workspace/repo/src/handoff.ts
Restricciones aprobadas:
- read_only: Read only -> No writes
- authority: WIS first -> Canonical fields win
Riesgos abiertos:
- Sin riesgos abiertos explícitos.
Incluye pruebas y explica cualquier incertidumbre operativa detectada.`;

function createEnvelope(): OperationalContextEnvelope {
  return {
    meta: {
      consumer: "vscode_extension",
      session_key: "snapshot-session",
      endpoint: "http://localhost:8002/mcp",
      runtime_mode: "offline_fixture",
      fetched_at: "2026-03-31T10:00:00.000Z",
      transport_status: "ok",
      load_state: "loaded",
    },
    local_environment: {
      workspace_root: "/workspace",
      repo_root: "/workspace/repo",
      branch: "main",
      active_file: "/workspace/repo/src/handoff.ts",
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
            id: "task-100",
            title: "Snapshot Task",
            goal: "Ship stable handoff",
            status: "in_progress",
            priority: "medium",
            next_action: "Implement handoff baseline",
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
          summary: "Validation passing",
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
          decisions: [
            {
              decision_key: "read_only",
              title: "Read only",
              decision: "No writes",
            },
            {
              decision_key: "authority",
              title: "WIS first",
              decision: "Canonical fields win",
            },
          ],
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
          total: 1,
          errors: [
            {
              severity: "error",
              summary: "Snapshot error",
            },
          ],
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
      runtime_mode: "offline_fixture",
      timeout_ms: 5000,
      fetched_at: "2026-03-31T10:00:00.000Z",
    },
  };
}

test("snapshot de HandoffArtifact se mantiene estable", () => {
  const contextStore = new InMemoryOperationalContextStore();
  contextStore.setLast(createEnvelope());
  const artifactStore = new InMemoryHandoffArtifactStore();

  const builder = new HandoffBuilder({
    contextStore,
    artifactStore,
    renderer: {
      render() {
        return undefined;
      },
    },
  });

  const result = builder.build({
    intent: {
      user_intent: "Snapshot",
      local_focus: ["/workspace/repo/src/handoff.ts"],
    },
    target: "codex",
  });

  assert.equal(result.status, "ready");
  const artifact = result.artifact;
  assert.ok(artifact);

  const normalized = {
    ...artifact,
    meta: {
      ...artifact.meta,
      generated_at: "<timestamp>",
    },
  };

  assert.equal(JSON.stringify(normalized, null, 2), SNAPSHOT_ARTIFACT);

  const promptSnapshot = `ASK\n${artifact.codex_ask_prompt}\n---\nCODE\n${artifact.codex_code_prompt}`;
  assert.equal(promptSnapshot, SNAPSHOT_PROMPTS);
});
