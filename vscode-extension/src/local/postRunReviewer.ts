import type { OperatorReviewResult } from "./types";
import type { PostRunReviewInput, PostRunReviewerPort } from "./ports";
import { toComparablePathKey } from "./pathNormalization";

function comparePaths(left: string, right: string): number {
  return toComparablePathKey(left).localeCompare(toComparablePathKey(right)) || left.localeCompare(right);
}

function normalizeUnique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function buildChangedFilesFocus(input: PostRunReviewInput): string[] {
  return [
    ...new Set([
      ...input.workspace_diff.deleted_files,
      ...input.workspace_diff.modified_files,
      ...input.workspace_diff.created_files,
    ]),
  ]
    .sort(comparePaths)
    .slice(0, 12);
}

function buildNextActionPlan(decision: OperatorReviewResult["review_decision"], changedFilesFocus: string[]): string {
  const focusText =
    changedFilesFocus.length > 0
      ? `Archivos foco: ${changedFilesFocus.slice(0, 4).join(", ")}.`
      : "No hay archivos foco para revisión.";
  switch (decision) {
    case "accept":
      return `${focusText} Ejecutar validaciones locales y continuar con la siguiente tarea.`;
    case "accept_with_warnings":
      return `${focusText} Revisar warnings reportados y validar antes de continuar.`;
    case "needs_manual_review":
      return `${focusText} Realizar revisión manual de cambios y riesgos antes de aceptar.`;
    case "retry_recommended":
      return `${focusText} Ajustar alcance/prompt y reintentar ejecución controlada.`;
    case "blocked":
      return `${focusText} Corregir precondición bloqueante y reejecutar.`;
    case "reject":
      return `${focusText} Rechazar resultado y preparar nueva tarea con restricciones más claras.`;
    default:
      return focusText;
  }
}

export class PostRunReviewer implements PostRunReviewerPort {
  public async review(input: PostRunReviewInput): Promise<OperatorReviewResult> {
    const reasonCodes: string[] = [];
    const warningsCount = input.execution_result.warnings_count;
    const deletedFilesCount = input.workspace_diff.deleted_files.length;

    reasonCodes.push(`outcome:${input.classified_outcome}`);

    let decision: OperatorReviewResult["review_decision"];
    switch (input.classified_outcome) {
      case "blocked":
        decision = "blocked";
        break;
      case "failed":
        decision = "reject";
        break;
      case "timeout":
      case "cancelled":
      case "no_op":
        decision = "retry_recommended";
        break;
      case "partial_changes":
        decision = "needs_manual_review";
        break;
      case "applied_changes":
        if (deletedFilesCount > 0) {
          decision = "needs_manual_review";
          reasonCodes.push("deleted_files_present");
        } else if (warningsCount > 0) {
          decision = "accept_with_warnings";
          reasonCodes.push("warnings_present");
        } else {
          decision = "accept";
        }
        break;
      default:
        decision = "needs_manual_review";
        reasonCodes.push("decision_defaulted");
        break;
    }

    if (input.reindex_result.mode === "fallback_full") {
      reasonCodes.push("reindex_fallback_full");
    }
    if (!input.reindex_result.ok) {
      reasonCodes.push("reindex_not_ok");
    }
    if (warningsCount > 0 && !reasonCodes.includes("warnings_present")) {
      reasonCodes.push("warnings_present");
    }

    const changedFilesFocus = buildChangedFilesFocus(input);
    const reviewRisks = normalizeUnique([
      ...input.review_payload.pending_risks,
      ...(deletedFilesCount > 0 ? ["Hay archivos borrados; validar impacto lateral."] : []),
      ...(!input.reindex_result.ok ? ["Reindex post-run no exitoso."] : []),
    ]);

    const reviewSummary = [
      `Decision: ${decision}.`,
      `Outcome: ${input.classified_outcome}.`,
      `Changed files: ${input.workspace_diff.changed_files_count}.`,
      `Warnings: ${warningsCount}.`,
    ].join(" ");

    return {
      review_decision: decision,
      review_summary: reviewSummary,
      review_risks: reviewRisks,
      changed_files_focus: changedFilesFocus,
      next_action_plan: buildNextActionPlan(decision, changedFilesFocus),
      source_execution_id: input.source_execution_id,
      source_task_id: input.source_task_id,
      reason_codes: normalizeUnique(reasonCodes),
    };
  }
}
