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
}

export class CodexCliRunner implements CodexRunnerPort {
  private readonly timeoutMs: number;

  constructor(options?: CodexCliRunnerOptions) {
    this.timeoutMs = options?.timeoutMs ?? 120_000;
  }

  public async healthcheck(command: string, options?: CodexRunnerExecuteOptions): Promise<CodexExecutionResult> {
    const result = await this.execute({
      mode: "healthcheck",
      command,
      commandLine: `${command} --version`,
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
    const commandLine = `${command} exec --json --ephemeral --sandbox workspace-write -C ${this.quoteShellArg(workingRoot)} -o ${this.quoteShellArg(outputFile)} ${this.quoteShellArg(prompt)}`;
    const executed = await this.execute({
      mode: "run",
      command,
      commandLine,
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
    commandLine: string;
    abortSignal?: AbortSignal;
  }): Promise<CodexExecutionResult> {
    const startedAtIso = new Date().toISOString();
    const startedAt = Date.now();

    return new Promise<CodexExecutionResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      let cancelled = false;

      const child = spawn(input.commandLine, {
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const onAbort = (): void => {
        cancelled = true;
        child.kill("SIGTERM");
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
        input.abortSignal?.removeEventListener("abort", onAbort);
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
          mode: input.mode,
          ok: false,
          cancelled,
          command: input.command,
          command_line: input.commandLine,
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
          command_line: input.commandLine,
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

  private quoteShellArg(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
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
