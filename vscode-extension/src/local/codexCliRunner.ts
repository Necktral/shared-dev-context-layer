import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CodexRunnerExecuteOptions, CodexRunnerPort } from "./ports";
import type { CodexExecutionRequest, CodexExecutionResult, CodexExecutionMode } from "./types";
import {
  buildCodexExecutionPrompt,
  classifyCodexStderr,
  parseCodexJsonlOutput,
  sha256Hex,
} from "./execution/codexExecutionUtils";

export interface CodexCliRunnerOptions {
  timeoutMs?: number;
  killGraceMs?: number;
  spawnProcess?: CodexSpawnFunction;
}

export interface CodexSpawnedProcess {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: (code: number | null) => void): this;
}

export type CodexSpawnFunction = (
  executable: string,
  args: string[],
  options: {
    shell: false;
    stdio: ["ignore", "pipe", "pipe"];
  },
) => CodexSpawnedProcess;

export class CodexCliRunner implements CodexRunnerPort {
  private readonly timeoutMs: number;
  private readonly killGraceMs: number;
  private readonly spawnProcess: CodexSpawnFunction;

  constructor(options?: CodexCliRunnerOptions) {
    this.timeoutMs = options?.timeoutMs ?? 120_000;
    this.killGraceMs = options?.killGraceMs ?? 1_500;
    this.spawnProcess = options?.spawnProcess ?? ((executable, args, spawnOptions) => (
      spawn(executable, args, spawnOptions) as unknown as CodexSpawnedProcess
    ));
  }

  public async healthcheck(command: string, options?: CodexRunnerExecuteOptions): Promise<CodexExecutionResult> {
    const result = await this.execute({
      mode: "healthcheck",
      command,
      executable: command,
      args: ["--version"],
      abortSignal: options?.abortSignal,
    });
    const stderrSummary = classifyCodexStderr(result.stderr);
    return {
      ...result,
      warnings_count: stderrSummary.warningCount,
    };
  }

  public async run(
    request: CodexExecutionRequest,
    command: string,
    options?: CodexRunnerExecuteOptions,
  ): Promise<CodexExecutionResult> {
    const prompt = buildCodexExecutionPrompt(request);
    const promptHash = sha256Hex(prompt);
    const workingRoot = request.repo_root ?? request.workspace_root ?? process.cwd();
    const outputFile = path.join(os.tmpdir(), `wis-codex-last-${randomUUID()}.txt`);
    const args = ["exec", "--json", "--ephemeral", "--sandbox", "workspace-write", "-C", workingRoot, "-o", outputFile, prompt];
    const executed = await this.execute({
      mode: "run",
      command,
      executable: command,
      args,
      abortSignal: options?.abortSignal,
    });
    const parsedStdout = parseCodexJsonlOutput(executed.stdout);
    const stderrSummary = classifyCodexStderr(executed.stderr);
    const lastMessage = await this.readLastMessageFile(outputFile);
    await this.deleteFileQuietly(outputFile);

    return {
      ...executed,
      final_message: lastMessage ?? parsedStdout.finalMessage,
      thread_id: parsedStdout.threadId,
      events_count: parsedStdout.eventsCount,
      warnings_count: stderrSummary.warningCount,
      usage_tokens: parsedStdout.usageTokens,
      request_preview: {
        task_id: request.task.id,
        objective: request.task.objective,
        repo_root: request.repo_root,
        workspace_root: request.workspace_root,
        branch: request.branch,
        active_file: request.active_file,
        prompt,
        prompt_hash: promptHash,
        prompt_chars: prompt.length,
        stderr_warning_reasons: stderrSummary.reasons,
        stderr_warning_count: stderrSummary.warningCount,
        ignored_jsonl_lines: parsedStdout.ignoredLines,
      },
    };
  }

  private async execute(input: {
    mode: CodexExecutionMode;
    command: string;
    executable: string;
    args: string[];
    abortSignal?: AbortSignal;
  }): Promise<CodexExecutionResult> {
    const startedAtIso = new Date().toISOString();
    const startedAt = Date.now();
    const commandLine = this.formatCommandLine(input.executable, input.args);

    return new Promise<CodexExecutionResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      let cancelled = false;
      let forceKillTimer: NodeJS.Timeout | null = null;
      const child = this.spawnProcess(input.executable, input.args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const clearForceKillTimer = (): void => {
        if (!forceKillTimer) {
          return;
        }
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      };

      const requestStop = (reason: "abort" | "timeout"): void => {
        if (settled) {
          return;
        }
        if (reason === "abort") {
          cancelled = true;
        } else {
          timedOut = true;
        }
        child.kill("SIGTERM");
        if (!forceKillTimer) {
          forceKillTimer = setTimeout(() => {
            if (settled) {
              return;
            }
            child.kill("SIGKILL");
          }, this.killGraceMs);
        }
      };

      const onAbort = (): void => {
        requestStop("abort");
      };
      input.abortSignal?.addEventListener("abort", onAbort, { once: true });
      if (input.abortSignal?.aborted) {
        onAbort();
      }

      const finish = (result: CodexExecutionResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        clearForceKillTimer();
        input.abortSignal?.removeEventListener("abort", onAbort);
        resolve(result);
      };

      const timeout = setTimeout(() => {
        requestStop("timeout");
      }, this.timeoutMs);

      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        finish({
          mode: input.mode,
          ok: false,
          cancelled,
          command: input.command,
          command_line: commandLine,
          exit_code: null,
          stdout,
          stderr,
          final_message: null,
          thread_id: null,
          events_count: 0,
          warnings_count: 0,
          usage_tokens: null,
          started_at: startedAtIso,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
          error: error.message,
          request_preview: null,
        });
      });

      child.on("close", (code) => {
        const hasExitedOk = !timedOut && !cancelled && code === 0;
        let error: string | null = null;
        if (cancelled) {
          error = "Execution cancelled by user.";
        } else if (timedOut) {
          error = `Command timed out after ${this.timeoutMs}ms`;
        } else if (code !== 0) {
          error = `Command exited with code ${code ?? "unknown"}`;
        }

        finish({
          mode: input.mode,
          ok: hasExitedOk,
          cancelled,
          command: input.command,
          command_line: commandLine,
          exit_code: code,
          stdout,
          stderr,
          final_message: null,
          thread_id: null,
          events_count: 0,
          warnings_count: 0,
          usage_tokens: null,
          started_at: startedAtIso,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
          error,
          request_preview: null,
        });
      });
    });
  }

  private formatCommandLine(executable: string, args: string[]): string {
    const values = [executable, ...args];
    return values
      .map((value) => {
        if (value.length === 0) {
          return "\"\"";
        }
        if (/[\s"]/u.test(value)) {
          return `"${value.replace(/"/g, "\\\"")}"`;
        }
        return value;
      })
      .join(" ");
  }

  private async readLastMessageFile(filePath: string): Promise<string | null> {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }

  private async deleteFileQuietly(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch {
      // no-op on cleanup
    }
  }
}
