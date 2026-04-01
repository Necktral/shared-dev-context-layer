import { spawn } from "node:child_process";
import type { CodexRunnerPort } from "./ports";
import type { CodexExecutionRequest, CodexExecutionResult, CodexExecutionMode } from "./types";

export interface CodexCliRunnerOptions {
  timeoutMs?: number;
}

export class CodexCliRunner implements CodexRunnerPort {
  private readonly timeoutMs: number;

  constructor(options?: CodexCliRunnerOptions) {
    this.timeoutMs = options?.timeoutMs ?? 15_000;
  }

  public async healthcheck(command: string): Promise<CodexExecutionResult> {
    return this.execute("healthcheck", command, `${command} --version`, null);
  }

  public async run(request: CodexExecutionRequest, command: string): Promise<CodexExecutionResult> {
    return this.execute(
      "run",
      command,
      `${command} --help`,
      {
        task_id: request.task.id,
        objective: request.task.objective,
      },
    );
  }

  private async execute(
    mode: CodexExecutionMode,
    command: string,
    commandLine: string,
    requestPreview: Record<string, unknown> | null,
  ): Promise<CodexExecutionResult> {
    const startedAtIso = new Date().toISOString();
    const startedAt = Date.now();

    return new Promise<CodexExecutionResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;

      const child = spawn(commandLine, {
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const finish = (result: CodexExecutionResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, this.timeoutMs);

      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        finish({
          mode,
          ok: false,
          command,
          command_line: commandLine,
          exit_code: null,
          stdout,
          stderr,
          started_at: startedAtIso,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
          error: error.message,
          request_preview: requestPreview,
        });
      });

      child.on("close", (code) => {
        const hasExitedOk = !timedOut && code === 0;
        let error: string | null = null;
        if (timedOut) {
          error = `Command timed out after ${this.timeoutMs}ms`;
        } else if (code !== 0) {
          error = `Command exited with code ${code ?? "unknown"}`;
        }

        finish({
          mode,
          ok: hasExitedOk,
          command,
          command_line: commandLine,
          exit_code: code,
          stdout,
          stderr,
          started_at: startedAtIso,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
          error,
          request_preview: requestPreview,
        });
      });
    });
  }
}
