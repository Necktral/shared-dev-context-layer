import type * as vscode from "vscode";
import type { HandoffBuildResult } from "../../domain/handoff";
import type { HandoffRendererPort } from "../../application/handoffBuilder";

export class HandoffOutputChannelRenderer implements HandoffRendererPort {
  constructor(private readonly output: vscode.OutputChannel) {}

  public render(result: HandoffBuildResult): void {
    this.output.appendLine("[WIS] prepare_handoff");
    this.output.appendLine(`status: ${result.status}`);

    if (!result.artifact) {
      this.output.appendLine("artifact: null");
      for (const issue of result.issues) {
        this.output.appendLine(`issue: [${issue.severity}] ${issue.source} -> ${issue.message}`);
      }
      this.output.appendLine("");
      this.output.show(true);
      return;
    }

    const artifact = result.artifact;
    this.output.appendLine(`target: ${artifact.meta.target}`);
    this.output.appendLine(`load_state: ${artifact.meta.load_state}`);
    this.output.appendLine(`transport_status: ${artifact.meta.transport_status}`);
    this.output.appendLine(`task: ${artifact.task_summary.title ?? "null"}`);
    this.output.appendLine(`current_goal: ${artifact.current_goal ?? "null"}`);
    this.output.appendLine(`candidate_files(${artifact.candidate_files.length}): ${artifact.candidate_files.join(", ") || "none"}`);
    this.output.appendLine(`open_risks(${artifact.open_risks.length}): ${artifact.open_risks.join(" | ") || "none"}`);

    if (artifact.meta.uncertainty_note) {
      this.output.appendLine(`uncertainty: ${artifact.meta.uncertainty_note}`);
    }

    this.output.appendLine("codex_ask_prompt:");
    this.output.appendLine(artifact.codex_ask_prompt);
    this.output.appendLine("codex_code_prompt:");
    this.output.appendLine(artifact.codex_code_prompt);

    this.output.appendLine("");
    this.output.show(true);
  }
}
