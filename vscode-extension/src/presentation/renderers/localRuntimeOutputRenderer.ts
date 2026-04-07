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
    this.output.appendLine(`db_status: ${snapshot.db_status}`);
    this.output.appendLine(`db_error: ${snapshot.db_error ?? "-"}`);
    this.output.appendLine(`updated_at: ${snapshot.updated_at}`);

    if (result.details) {
      this.output.appendLine("details:");
      this.output.appendLine(JSON.stringify(result.details, null, 2));

      const reviewDecision =
        typeof result.details.review_decision === "string" ? result.details.review_decision : null;
      if (reviewDecision) {
        const reviewSummary =
          typeof result.details.review_summary === "string" ? result.details.review_summary : "-";
        const nextAction =
          typeof result.details.next_action_plan === "string" ? result.details.next_action_plan : "-";
        const risks = Array.isArray(result.details.review_risks)
          ? result.details.review_risks.filter((entry): entry is string => typeof entry === "string").join(" | ")
          : "-";
        this.output.appendLine("operator_review:");
        this.output.appendLine(`decision: ${reviewDecision}`);
        this.output.appendLine(`summary: ${reviewSummary}`);
        this.output.appendLine(`risks: ${risks || "-"}`);
        this.output.appendLine(`next_action: ${nextAction}`);
      }

      const operatorPlaybooks = Array.isArray(result.details.operator_playbooks)
        ? result.details.operator_playbooks
            .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
            .map((entry) => {
              const id = typeof entry.id === "string" ? entry.id : "unknown";
              const title = typeof entry.title === "string" ? entry.title : "-";
              const tier = typeof entry.source_tier === "string" ? entry.source_tier : "-";
              return `${id} (${tier}) -> ${title}`;
            })
        : [];
      if (operatorPlaybooks.length > 0) {
        this.output.appendLine("operator_playbooks:");
        for (const line of operatorPlaybooks) {
          this.output.appendLine(`- ${line}`);
        }
      }
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
