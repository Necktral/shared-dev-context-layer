import test from "node:test";
import assert from "node:assert/strict";
import { LocalCommandService } from "../../local/localCommandService";
import { InMemoryLocalRuntimeStore } from "../../local/localRuntimeStore";
import { createInitialProjectRuntimeSnapshot, type CodexExecutionResult, type OperationProfile } from "../../local/types";
import { NoopIndexer, NoopPersistence, NoopRetriever, NoopTaskBuilder } from "../../local/noopServices";

function environment() {
  return {
    workspace_root: "/workspace",
    repo_root: "/workspace/repo",
    branch: "main",
    active_file: "/workspace/repo/src/index.ts",
    timestamp: new Date().toISOString(),
    inspector_status: "ok" as const,
    inspector_error: null,
  };
}

function okExecution(mode: "healthcheck" | "run"): CodexExecutionResult {
  return {
    mode,
    ok: true,
    command: "codex",
    command_line: "codex --help",
    exit_code: 0,
    stdout: "ok",
    stderr: "",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: 10,
    error: null,
    request_preview: null,
  };
}

test("LocalCommandService bloquea comandos locales cuando profile no es local_private", async () => {
  let profile: OperationProfile = "phase3_control_plane";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => okExecution("run"),
    },
    persistence: new NoopPersistence(),
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
  });

  const result = await service.localIndex();
  assert.equal(result.status, "blocked");
  assert.equal(store.getSnapshot().last_result?.status, "blocked");
});

test("LocalCommandService en local_private prepara tarea y ejecuta Codex", async () => {
  let profile: OperationProfile = "local_private";
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot(profile));
  let savedTaskId = "";
  let savedExecutionTaskId = "";

  const service = new LocalCommandService({
    inspector: { inspect: async () => environment() },
    store,
    indexer: new NoopIndexer(),
    retriever: new NoopRetriever(),
    taskBuilder: new NoopTaskBuilder(),
    codexRunner: {
      healthcheck: async () => okExecution("healthcheck"),
      run: async () => okExecution("run"),
    },
    persistence: {
      async saveTask(task) {
        savedTaskId = task.id;
      },
      async saveExecution(taskId) {
        savedExecutionTaskId = taskId;
      },
    },
    getOperationProfile: () => profile,
    getCodexCliCommand: () => "codex",
  });

  const prepared = await service.localPrepareTask("Ajustar baseline local");
  assert.equal(prepared.status, "ok");
  assert.ok(savedTaskId.length > 0);

  const executed = await service.localRunCodex();
  assert.equal(executed.status, "ok");
  assert.equal(savedExecutionTaskId, savedTaskId);
  assert.equal(store.getSnapshot().runtime_state, "ready");
});
