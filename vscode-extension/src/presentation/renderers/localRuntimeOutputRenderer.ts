import type * as vscode from "vscode";
import type { LocalCommandResult, ProjectRuntimeSnapshot } from "../../local/types";

export class LocalRuntimeOutputRenderer {
  constructor(private readonly output: vscode.OutputChannel) {}

  public render(result: LocalCommandResult, snapshot: ProjectRuntimeSnapshot): void {
    this.output.appendLine("[WIS][LOCAL] command_execution");
    this.output.appendLine(`command: ${result.command}`);
    this.output.appendLine(`status: ${result.status}`);
    this.output.appendLine(`ok: ${result.ok ? "true" : "false"}`);
    this.output.appendLine(`message: ${result.message}`);
    this.output.appendLine(`profile: ${snapshot.operation_profile}`);
    this.output.appendLine(`workspace_root: ${snapshot.workspace_root ?? "-"}`);
    this.output.appendLine(`repo_root: ${snapshot.repo_root ?? "-"}`);
    this.output.appendLine(`runtime_state: ${snapshot.runtime_state}`);
    this.output.appendLine(`updated_at: ${snapshot.updated_at}`);

    if (result.details) {
      this.output.appendLine("details:");
      this.output.appendLine(JSON.stringify(result.details, null, 2));
    }

    if (snapshot.task_draft) {
      this.output.appendLine(`task_draft: ${snapshot.task_draft.id} (${snapshot.task_draft.objective})`);
    }

    if (snapshot.errors.length > 0) {
      this.output.appendLine(`errors: ${snapshot.errors.join(" | ")}`);
    }

    this.output.appendLine("");
  }
}
