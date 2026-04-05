import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { CodexCliRunner, type CodexSpawnedProcess } from "../../local/codexCliRunner";
import type { CodexExecutionRequest } from "../../local/types";

class MockSpawnedProcess extends EventEmitter implements CodexSpawnedProcess {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly killSignals: Array<NodeJS.Signals | number | undefined> = [];
  private readonly onKill: (signal: NodeJS.Signals | number | undefined) => void;

  constructor(onKill?: (signal: NodeJS.Signals | number | undefined) => void) {
    super();
    this.onKill = onKill ?? (() => undefined);
  }

  public kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal);
    this.onKill(signal);
    return true;
  }

  public emitClose(code: number | null): void {
    this.emit("close", code);
  }
}

function sampleRequest(): CodexExecutionRequest {
  return {
    task: {
      id: "task-1",
      objective: "Implementar hardening cross-platform",
      context_summary: "Contexto listo para ejecutar.",
      candidate_files: ["src/local/codexCliRunner.ts"],
      constraints: ["Sin romper contrato de salida."],
      acceptance_criteria: ["Tests en verde."],
      execution_brief: {
        version: "v2",
        objective_compact: "Hardening cross-platform del runner",
        candidate_files: ["src/local/codexCliRunner.ts"],
        key_evidence: ["runner actual usa shell=true"],
        run_constraints: ["sin cambios de schema"],
        acceptance_checks: ["npm test y local-db en verde"],
      },
      created_at: "2026-04-05T00:00:00.000Z",
    },
    repo_root: "/workspace/repo",
    workspace_root: "/workspace",
    branch: "main",
    active_file: "/workspace/repo/src/local/codexCliRunner.ts",
  };
}

test("CodexCliRunner healthcheck reporta ok con binario disponible", async () => {
  const runner = new CodexCliRunner({ timeoutMs: 5000 });
  const result = await runner.healthcheck(process.execPath);

  assert.equal(result.mode, "healthcheck");
  assert.equal(result.ok, true);
  assert.equal(result.cancelled, false);
  assert.equal(result.error, null);
  assert.equal(typeof result.duration_ms, "number");
  assert.equal(result.events_count, 0);
  assert.equal(result.final_message, null);
});

test("CodexCliRunner healthcheck reporta error con binario inexistente", async () => {
  const runner = new CodexCliRunner({ timeoutMs: 5000 });
  const result = await runner.healthcheck("codex_binario_que_no_existe_12345");

  assert.equal(result.mode, "healthcheck");
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, false);
  assert.ok(result.error !== null);
});

test("CodexCliRunner run construye argv determinista con shell=false y limpia archivo temporal", async () => {
  let capturedExecutable = "";
  let capturedArgs: string[] = [];
  let capturedShell = true;
  let outputFilePath = "";

  const runner = new CodexCliRunner({
    timeoutMs: 3000,
    spawnProcess: (executable, args, options) => {
      capturedExecutable = executable;
      capturedArgs = [...args];
      capturedShell = options.shell;
      outputFilePath = args[8] ?? "";
      const process = new MockSpawnedProcess();
      setImmediate(() => {
        process.stdout.write('{"type":"thread.started","thread_id":"thread-xyz"}\n');
        process.stdout.write('{"type":"item.completed","item":{"id":"x","type":"agent_message","text":"stdout final"}}\n');
        process.stdout.write('{"type":"turn.completed","usage":{"input_tokens":11,"cached_input_tokens":2,"output_tokens":5}}\n');
        process.stderr.write("WARN sample warning\n");
        void fs.writeFile(outputFilePath, "mensaje final archivo", "utf8").then(() => {
          process.emitClose(0);
        });
      });
      return process;
    },
  });

  const result = await runner.run(sampleRequest(), "codex");

  assert.equal(capturedExecutable, "codex");
  assert.equal(capturedShell, false);
  assert.deepEqual(
    capturedArgs.slice(0, 9),
    ["exec", "--json", "--ephemeral", "--sandbox", "workspace-write", "-C", "/workspace/repo", "-o", outputFilePath],
  );
  assert.ok(capturedArgs[9].includes("Hardening cross-platform del runner"));
  assert.equal(result.ok, true);
  assert.equal(result.final_message, "mensaje final archivo");
  assert.equal(result.thread_id, "thread-xyz");
  assert.equal(result.events_count, 3);
  assert.equal(result.warnings_count, 1);
  assert.deepEqual(result.usage_tokens, {
    input_tokens: 11,
    cached_input_tokens: 2,
    output_tokens: 5,
  });

  await assert.rejects(() => fs.access(outputFilePath));
});

test("CodexCliRunner cancela con SIGTERM y fuerza SIGKILL si el proceso no cierra", async () => {
  const killSignals: Array<NodeJS.Signals | number | undefined> = [];
  let processRef: MockSpawnedProcess | null = null;
  const runner = new CodexCliRunner({
    timeoutMs: 5000,
    killGraceMs: 20,
    spawnProcess: () => {
      processRef = new MockSpawnedProcess((signal) => {
        if (signal === "SIGKILL") {
          setImmediate(() => {
            processRef?.emitClose(null);
          });
        }
      });
      const originalKill = processRef.kill.bind(processRef);
      processRef.kill = ((signal?: NodeJS.Signals | number) => {
        killSignals.push(signal);
        return originalKill(signal);
      }) as typeof processRef.kill;
      return processRef;
    },
  });

  const controller = new AbortController();
  const runPromise = runner.run(sampleRequest(), "codex", {
    abortSignal: controller.signal,
  });
  setTimeout(() => {
    controller.abort();
  }, 10);

  const result = await runPromise;
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.match(result.error ?? "", /cancelled/i);
  assert.deepEqual(killSignals, ["SIGTERM", "SIGKILL"]);
});

test("CodexCliRunner timeout aplica SIGTERM y fallback SIGKILL", async () => {
  const killSignals: Array<NodeJS.Signals | number | undefined> = [];
  let processRef: MockSpawnedProcess | null = null;
  const runner = new CodexCliRunner({
    timeoutMs: 10,
    killGraceMs: 20,
    spawnProcess: () => {
      processRef = new MockSpawnedProcess((signal) => {
        if (signal === "SIGKILL") {
          setImmediate(() => {
            processRef?.emitClose(null);
          });
        }
      });
      const originalKill = processRef.kill.bind(processRef);
      processRef.kill = ((signal?: NodeJS.Signals | number) => {
        killSignals.push(signal);
        return originalKill(signal);
      }) as typeof processRef.kill;
      return processRef;
    },
  });

  const result = await runner.run(sampleRequest(), "codex");
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, false);
  assert.match(result.error ?? "", /timed out/i);
  assert.deepEqual(killSignals, ["SIGTERM", "SIGKILL"]);
});
