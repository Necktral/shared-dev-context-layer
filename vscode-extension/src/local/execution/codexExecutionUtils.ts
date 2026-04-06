import { createHash } from "node:crypto";
import type { CodexExecutionRequest, CodexUsageTokens } from "../types";

export interface ParsedCodexJsonlOutput {
  threadId: string | null;
  finalMessage: string | null;
  eventsCount: number;
  ignoredLines: number;
  usageTokens: CodexUsageTokens | null;
  parsedEvents: Array<Record<string, unknown>>;
}

export interface CodexStderrWarning {
  reason: string;
  line: string;
}

export interface CodexStderrSummary {
  warningCount: number;
  reasons: string[];
  warnings: CodexStderrWarning[];
}

function normalizeList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function compactSnippet(content: string, limit: number): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function toCodexUsageTokens(value: unknown): CodexUsageTokens | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const inputTokens = toFiniteNumber(candidate.input_tokens);
  const cachedInputTokens = toFiniteNumber(candidate.cached_input_tokens);
  const outputTokens = toFiniteNumber(candidate.output_tokens);
  if (inputTokens === null || cachedInputTokens === null || outputTokens === null) {
    return null;
  }
  return {
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: outputTokens,
  };
}

function defaultObjective(value: string): string {
  const clean = value.trim();
  return clean.length > 0 ? clean : "Resolver la tarea tecnica solicitada.";
}

export function buildCodexExecutionPrompt(request: CodexExecutionRequest): string {
  const brief = request.task.execution_brief;
  const objective = brief?.objective_compact?.trim() || defaultObjective(request.task.objective);
  const candidateFiles = normalizeList(brief?.candidate_files ?? request.task.candidate_files).slice(0, 12);
  const keyEvidence = normalizeList(
    brief?.key_evidence ?? (request.task.context_summary ? [compactSnippet(request.task.context_summary, 300)] : []),
  ).slice(0, 8);
  const runConstraints = normalizeList(brief?.run_constraints ?? request.task.constraints).slice(0, 12);
  const acceptanceChecks = normalizeList(brief?.acceptance_checks ?? request.task.acceptance_criteria).slice(0, 12);

  const lines: string[] = [
    "Rol: ingeniero de software senior ejecutando una tarea local supervisada.",
    "Idioma de respuesta: espanol tecnico y conciso.",
    "",
    "## Objetivo",
    objective,
    "",
    "## Contexto del task draft",
    compactSnippet(request.task.context_summary, 1400),
    "",
    "## Archivos candidatos",
    ...(candidateFiles.length > 0 ? candidateFiles.map((file) => `- ${file}`) : ["- (sin archivos candidatos)"]),
    "",
    "## Evidencia clave",
    ...(keyEvidence.length > 0 ? keyEvidence.map((entry) => `- ${entry}`) : ["- (sin evidencia adicional)"]),
    "",
    "## Restricciones de ejecucion",
    ...(runConstraints.length > 0 ? runConstraints.map((entry) => `- ${entry}`) : ["- Mantener cambios acotados y trazables."]),
    "",
    "## Criterios de aceptacion",
    ...(acceptanceChecks.length > 0 ? acceptanceChecks.map((entry) => `- ${entry}`) : ["- Entregar resultado verificable."]),
    "",
    "## Entorno",
    `- repo_root: ${request.repo_root ?? "-"}`,
    `- workspace_root: ${request.workspace_root ?? "-"}`,
    `- branch: ${request.branch ?? "-"}`,
    `- active_file: ${request.active_file ?? "-"}`,
    "",
    "## Formato de salida final",
    "- Resumen ejecutivo corto del resultado.",
    "- Cambios realizados y evidencia de verificacion.",
    "- Riesgos pendientes o limites encontrados.",
  ];

  return lines.join("\n");
}

export function parseCodexJsonlOutput(stdout: string): ParsedCodexJsonlOutput {
  let threadId: string | null = null;
  let finalMessage: string | null = null;
  let usageTokens: CodexUsageTokens | null = null;
  let ignoredLines = 0;
  const parsedEvents: Array<Record<string, unknown>> = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      ignoredLines += 1;
      continue;
    }

    if (!parsed || typeof parsed !== "object") {
      ignoredLines += 1;
      continue;
    }

    const event = parsed as Record<string, unknown>;
    parsedEvents.push(event);

    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      threadId = event.thread_id;
      continue;
    }

    if (event.type === "item.completed") {
      const item = event.item;
      if (item && typeof item === "object") {
        const typedItem = item as Record<string, unknown>;
        if (typedItem.type === "agent_message" && typeof typedItem.text === "string") {
          finalMessage = typedItem.text;
        }
      }
      continue;
    }

    if (event.type === "turn.completed") {
      const usage = toCodexUsageTokens(event.usage);
      if (usage) {
        usageTokens = usage;
      }
    }
  }

  return {
    threadId,
    finalMessage,
    eventsCount: parsedEvents.length,
    ignoredLines,
    usageTokens,
    parsedEvents,
  };
}

function normalizeWarningReason(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("failed to read oauth tokens from keyring")) {
    return "oauth_keyring_unavailable";
  }
  if (lower.includes("failed to open state db") || lower.includes("state db discrepancy")) {
    return "state_db_warning";
  }
  if (lower.includes("transport channel closed") || lower.includes("worker quit with fatal")) {
    return "transport_warning";
  }
  if (lower.includes("failed to unwatch")) {
    return "file_watcher_warning";
  }
  if (/\berror\b/i.test(line)) {
    return "stderr_error";
  }
  return "stderr_warning";
}

export function classifyCodexStderr(stderr: string): CodexStderrSummary {
  const warnings: CodexStderrWarning[] = [];

  for (const rawLine of stderr.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const looksLikeWarning = /\bwarn\b/i.test(line) || /\berror\b/i.test(line) || line.toLowerCase().includes("failed to");
    if (!looksLikeWarning) {
      continue;
    }
    warnings.push({
      reason: normalizeWarningReason(line),
      line,
    });
  }

  const reasons = normalizeList(warnings.map((warning) => warning.reason));
  return {
    warningCount: warnings.length,
    reasons,
    warnings,
  };
}

export function capText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return text.split(/\r?\n/).length;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
