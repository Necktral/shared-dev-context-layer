import type { OperationalContextEnvelope, ToolResult } from "../domain/operationalContext";
import {
  handoffIssue,
  type HandoffArtifact,
  type HandoffBuildResult,
  type HandoffBuildStatus,
  type HandoffIntent,
  type HandoffTarget,
} from "../domain/handoff";
import type { HandoffArtifactStorePort } from "./handoffArtifactStore";
import type { OperationalContextStorePort } from "./operationalContextStore";

const MAX_DECISIONS = 10;
const MAX_ERRORS = 10;
const MAX_CANDIDATE_FILES = 5;
const MAX_RISKS = 8;

export interface BuildHandoffInput {
  intent: HandoffIntent;
  target?: HandoffTarget;
  targetLabel?: string;
}

export interface HandoffRendererPort {
  render(result: HandoffBuildResult): void;
}

export interface HandoffBuilderDependencies {
  contextStore: OperationalContextStorePort;
  artifactStore: HandoffArtifactStorePort;
  renderer: HandoffRendererPort;
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function classifyBuildStatus(envelope: OperationalContextEnvelope): HandoffBuildStatus {
  if (envelope.meta.load_state === "loaded") {
    return "ready";
  }
  if (envelope.meta.load_state === "partially_loaded" || envelope.meta.load_state === "degraded") {
    return "partial";
  }
  return "blocked";
}

function extractTask(toolResult: ToolResult | null): Record<string, unknown> {
  if (!toolResult?.payload) {
    return {};
  }
  return toRecord(toRecord(toolResult.payload).task);
}

function extractDecisions(toolResult: ToolResult | null): string[] {
  if (!toolResult?.payload) {
    return [];
  }
  const payload = toRecord(toolResult.payload);
  const decisions = Array.isArray(payload.decisions) ? payload.decisions : [];

  return decisions
    .map((item) => {
      const decision = toRecord(item);
      const key = toStringOrNull(decision.decision_key) ?? "decision";
      const title = toStringOrNull(decision.title) ?? "untitled";
      const statement = toStringOrNull(decision.decision) ?? "no_statement";
      return `${key}: ${title} -> ${statement}`;
    })
    .slice(0, MAX_DECISIONS);
}

function extractRecentErrors(toolResult: ToolResult | null): {
  status: "available" | "unavailable" | "no_data";
  total: number | null;
  highlights: string[];
} {
  if (!toolResult?.payload || toolResult.kind !== "ok" || toolResult.status !== "ok") {
    return {
      status: "unavailable",
      total: null,
      highlights: [],
    };
  }

  const payload = toRecord(toolResult.payload);
  const totalRaw = payload.total;
  const total = typeof totalRaw === "number" ? totalRaw : null;
  const errors = Array.isArray(payload.errors) ? payload.errors : [];

  if ((total ?? errors.length) === 0) {
    return {
      status: "no_data",
      total: total ?? 0,
      highlights: [],
    };
  }

  return {
    status: "available",
    total: total ?? errors.length,
    highlights: errors
      .slice(0, MAX_ERRORS)
      .map((item) => {
        const event = toRecord(item);
        const severity = toStringOrNull(event.severity) ?? "unknown";
        const summary = toStringOrNull(event.summary) ?? "no_summary";
        return `[${severity}] ${summary}`;
      }),
  };
}

function uniqueAndTrim(values: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function resolveTargetLabel(target: HandoffTarget, override?: string): string {
  const trimmed = override?.trim();
  if (trimmed) {
    return trimmed;
  }

  switch (target) {
    case "codex":
      return "Codex";
    case "chatgpt":
      return "ChatGPT";
    case "github_copilot":
      return "GitHub Copilot";
    case "custom":
      return "Custom Agent";
  }
}

function buildPrompts(artifact: HandoffArtifact): { ask: string; code: string } {
  const constraintsText = artifact.approved_constraints.length
    ? artifact.approved_constraints.map((entry) => `- ${entry}`).join("\n")
    : "- No hay decisiones aprobadas disponibles.";

  const candidateFilesText = artifact.candidate_files.length
    ? artifact.candidate_files.map((file) => `- ${file}`).join("\n")
    : "- Sin archivos candidatos.";

  const riskText = artifact.open_risks.length
    ? artifact.open_risks.map((risk) => `- ${risk}`).join("\n")
    : "- Sin riesgos abiertos explícitos.";

  const uncertainty = artifact.meta.uncertainty_note
    ? `\n\nIncertidumbre actual: ${artifact.meta.uncertainty_note}`
    : "";

  const ask = [
    `Agente objetivo: ${artifact.meta.target_label}`,
    `Objetivo actual: ${artifact.current_goal ?? "No definido"}`,
    `Task: ${artifact.task_summary.title ?? "No active task"} (${artifact.task_summary.status ?? "unknown"})`,
    `Validation: ${artifact.validation_state.status}`,
    "Restricciones aprobadas:",
    constraintsText,
    "Riesgos abiertos:",
    riskText,
  ].join("\n") + uncertainty;

  const code = [
    `Implementa el siguiente cambio de manera incremental y verificable para ${artifact.meta.target_label}.`,
    `Objetivo: ${artifact.current_goal ?? "No definido"}`,
    "Archivos candidatos:",
    candidateFilesText,
    "Restricciones aprobadas:",
    constraintsText,
    "Riesgos abiertos:",
    riskText,
    "Incluye pruebas y explica cualquier incertidumbre operativa detectada.",
  ].join("\n") + uncertainty;

  return { ask, code };
}

export class HandoffBuilder {
  constructor(private readonly deps: HandoffBuilderDependencies) {}

  public build(input: BuildHandoffInput): HandoffBuildResult {
    const envelope = this.deps.contextStore.getLast();
    if (!envelope) {
      const blockedResult: HandoffBuildResult = {
        status: "blocked",
        artifact: null,
        issues: [
          handoffIssue(
            "No hay OperationalContextEnvelope en memoria.",
            "error",
            true,
            "Ejecutar `WIS: Load Operational Context` antes de preparar handoff.",
          ),
        ],
      };
      this.deps.artifactStore.setLastResult(blockedResult);
      this.deps.renderer.render(blockedResult);
      return blockedResult;
    }

    const status = classifyBuildStatus(envelope);
    if (status === "blocked") {
      const blockedResult: HandoffBuildResult = {
        status,
        artifact: null,
        issues: [
          handoffIssue(
            `Load state no utilizable para handoff: ${envelope.meta.load_state}`,
            "error",
            true,
            "Recargar contexto hasta obtener estado loaded, partially_loaded o degraded.",
          ),
        ],
      };
      this.deps.artifactStore.setLastResult(blockedResult);
      this.deps.renderer.render(blockedResult);
      return blockedResult;
    }

    const target = input.target ?? "codex";
    const targetLabel = resolveTargetLabel(target, input.targetLabel);
    const task = extractTask(envelope.wis_context.active_task);
    const decisions = extractDecisions(envelope.wis_context.approved_decisions);
    const errorsSummary = extractRecentErrors(envelope.wis_context.recent_errors);
    const validationPayload = toRecord(envelope.wis_context.validation_status?.payload);

    const requestedFocus = input.intent.local_focus ?? [];
    const candidateFiles = uniqueAndTrim(
      [
        ...requestedFocus,
        envelope.local_environment.active_file ?? "",
      ],
      MAX_CANDIDATE_FILES,
    );

    const openRisks = uniqueAndTrim(
      [
        ...envelope.issues.map((issue) => `[${issue.severity}] ${issue.source}: ${issue.message}`),
        ...(status === "partial"
          ? [`[warning] handoff_builder: contexto con incertidumbre (${envelope.meta.load_state}).`]
          : []),
      ],
      MAX_RISKS,
    );

    const uncertaintyNote = status === "partial"
      ? `El contexto operativo está en estado ${envelope.meta.load_state}; validar antes de cambios de alto impacto.`
      : null;

    const artifactBase: HandoffArtifact = {
      task_summary: {
        id: toStringOrNull(task.id),
        title: toStringOrNull(task.title),
        status: toStringOrNull(task.status),
        priority: toStringOrNull(task.priority),
      },
      current_goal: toStringOrNull(task.goal) ?? toStringOrNull(task.next_action) ?? toStringOrNull(task.title),
      approved_constraints: decisions,
      validation_state: {
        status: toStringOrNull(validationPayload.current_status) ?? "unknown",
        summary: toStringOrNull(validationPayload.summary),
        source: toStringOrNull(validationPayload.last_validation_source),
      },
      recent_errors_summary: errorsSummary,
      local_focus: {
        active_file: envelope.local_environment.active_file,
        branch: envelope.local_environment.branch,
        requested_focus: uniqueAndTrim(requestedFocus, MAX_CANDIDATE_FILES),
      },
      candidate_files: candidateFiles,
      open_risks: openRisks,
      recommended_next_action:
        toStringOrNull(task.next_action) ??
        (status === "partial"
          ? "Reducir incertidumbre operativa antes de aplicar cambios amplios."
          : "Implementar el siguiente cambio de forma incremental con pruebas."),
      codex_ask_prompt: "",
      codex_code_prompt: "",
      meta: {
        generated_at: new Date().toISOString(),
        target,
        target_label: targetLabel,
        source_consumer: envelope.meta.consumer,
        session_key: envelope.meta.session_key,
        runtime_mode: envelope.meta.runtime_mode,
        load_state: envelope.meta.load_state,
        transport_status: envelope.meta.transport_status,
        uncertainty_note: uncertaintyNote,
      },
    };

    const prompts = buildPrompts(artifactBase);
    const artifact: HandoffArtifact = {
      ...artifactBase,
      codex_ask_prompt: prompts.ask,
      codex_code_prompt: prompts.code,
    };

    const result: HandoffBuildResult = {
      status,
      artifact,
      issues: status === "partial"
        ? [
            handoffIssue(
              "Handoff generado con contexto parcialmente confiable.",
              "warning",
              true,
              "Validar conflictos y transporte antes de delegación de alto riesgo.",
            ),
          ]
        : [],
    };

    this.deps.artifactStore.setLastResult(result);
    this.deps.renderer.render(result);
    return result;
  }
}
