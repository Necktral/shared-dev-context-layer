import { randomUUID } from "node:crypto";
import type { RetrievedContext, TaskBuilderPort } from "../ports";
import type { LocalTaskDraft, ProjectRuntimeSnapshot } from "../types";

function compactSnippet(content: string, limit: number): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function buildContextSummary(context: RetrievedContext): string {
  const lines = [context.summary];
  for (const chunk of context.selected_chunks.slice(0, 3)) {
    lines.push(`- ${chunk.file_path}#${chunk.chunk_index}: ${compactSnippet(chunk.content, 180)}`);
  }
  return lines.join("\n");
}

export class ContextAwareTaskBuilder implements TaskBuilderPort {
  public async buildTask(intent: string, context: RetrievedContext, _snapshot: ProjectRuntimeSnapshot): Promise<LocalTaskDraft> {
    const acceptanceCriteria = [
      "Resultado estructurado generado por adapter Codex.",
      "Registro de estado y salida disponible en panel/output.",
    ];

    if (context.selected_chunks.length > 0) {
      acceptanceCriteria.push("La tarea usa evidencia recuperada del índice local en PostgreSQL.");
    }

    return {
      id: randomUUID(),
      objective: intent,
      context_summary: buildContextSummary(context),
      candidate_files: context.candidate_files.slice(0, 5),
      constraints: [
        "Operar solo con contexto local_private y evidencia persistida en PostgreSQL.",
        "Mantener ejecución supervisada por usuario.",
      ],
      acceptance_criteria: acceptanceCriteria,
      created_at: new Date().toISOString(),
    };
  }
}
