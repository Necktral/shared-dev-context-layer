import { createHash, randomUUID } from "node:crypto";
import { GEMINI_API_KEY_STORAGE_KEY } from "../constants";
import type { CouncilConfig } from "../config";
import type { EnvironmentInspector } from "../environment/environmentInspector";
import type { InMemoryLocalRuntimeStore } from "../local/localRuntimeStore";
import type { PersistencePort } from "../local/ports";
import type {
  CouncilExternalReviewerState,
  CouncilPacketV1,
  CouncilPosition,
  CouncilRoomTab,
  CouncilRole,
  CouncilSensitivityLabel,
  LocalCommandName,
  LocalCommandResult,
  OperationProfile,
  ProjectRuntimeSnapshot,
} from "../local/types";

const LOCAL_ROLES: CouncilRole[] = [
  "architect",
  "implementer",
  "critic",
  "operator_advocate",
  "risk_auditor",
  "historian",
  "wildcard",
];

const BLOCKED_SECRET_PATTERNS: readonly RegExp[] = [
  /\b[A-Z0-9_]*(API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*\s*[:=]\s*\S+/i,
  /\b(authorization|x-goog-api-key)\s*[:=]\s*\S+/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/i,
  /\b(GEMINI_API_KEY|MCP_AUTH_TOKEN|AUTH0_CLIENT_SECRET)\b/i,
  /(^|\s)\.env(\s|$|[./\\])/i,
];

const RAW_DIFF_PATTERNS: readonly RegExp[] = [/^diff --git /m, /^@@\s+-\d+/m, /^\+\+\+ b\//m, /^--- a\//m];

const SECRET_REDACTION_PATTERNS: readonly [RegExp, string][] = [
  [/\b[A-Z0-9_]*(API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*\s*[:=]\s*\S+/gi, "<redacted_secret_assignment>"],
  [/\b(authorization|x-goog-api-key)\s*[:=]\s*\S+/gi, "<redacted_secret_header>"],
  [/-----BEGIN [\s\S]+?-----END [A-Z ]+-----/g, "<redacted_private_key>"],
];

export interface CouncilRoomOpenSessionInput {
  question: string;
  sensitivityLabel: CouncilSensitivityLabel;
}

export interface CouncilExternalReviewInput {
  brief: string;
  model: string;
  apiKey: string;
  maxChars: number;
}

export interface CouncilExternalReviewOutput {
  claim: string;
  rationale: string;
  risks: string[];
}

export interface CouncilExternalReviewClient {
  review(input: CouncilExternalReviewInput): Promise<CouncilExternalReviewOutput>;
}

interface SecretStorageLike {
  get(key: string): Promise<string | undefined> | Thenable<string | undefined> | string | undefined;
  store(key: string, value: string): Promise<void> | Thenable<void> | void;
  delete(key: string): Promise<void> | Thenable<void> | void;
}

interface OutputChannelLike {
  appendLine(value: string): void;
}

export interface CouncilRoomServiceDeps {
  store: InMemoryLocalRuntimeStore;
  inspector: Pick<EnvironmentInspector, "inspect">;
  persistence: PersistencePort;
  secretStorage?: SecretStorageLike;
  outputChannel?: OutputChannelLike;
  getOperationProfile: () => OperationProfile;
  getCouncilConfig: () => CouncilConfig;
  externalReviewClient?: CouncilExternalReviewClient;
  now?: () => Date;
  createId?: () => string;
}

interface SanitizedBriefResult {
  ok: boolean;
  brief: string;
  reason: string | null;
}

export class GeminiAiStudioReviewClient implements CouncilExternalReviewClient {
  public async review(input: CouncilExternalReviewInput): Promise<CouncilExternalReviewOutput> {
    if (typeof fetch !== "function") {
      throw new Error("fetch_unavailable");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const prompt = [
        "Eres un revisor externo invitado de un consejo de IAs gobernado.",
        "No eres autoridad canonica, no ratificas y no escribes canon.",
        "Revisa solo este brief sanitizado y no pidas secretos ni raw diffs.",
        "Devuelve una posicion breve con recomendacion, objeciones y riesgos.",
        "",
        input.brief.slice(0, input.maxChars),
      ].join("\n");

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-goog-api-key": input.apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: prompt,
                  },
                ],
              },
            ],
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error(`gemini_http_${response.status}`);
      }

      const payload = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text =
        payload.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? "")
          .join("\n")
          .trim() ?? "";

      if (!text) {
        throw new Error("gemini_empty_response");
      }

      return {
        claim: summarizeText(text, 220),
        rationale: summarizeText(text, 900),
        risks: extractRiskHints(text),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class CouncilRoomService {
  private readonly deps: CouncilRoomServiceDeps;

  private readonly externalReviewClient: CouncilExternalReviewClient;

  constructor(deps: CouncilRoomServiceDeps) {
    this.deps = deps;
    this.externalReviewClient = deps.externalReviewClient ?? new GeminiAiStudioReviewClient();
  }

  public async openSession(input: CouncilRoomOpenSessionInput): Promise<LocalCommandResult> {
    const now = this.isoNow();
    const config = this.deps.getCouncilConfig();
    const sensitivityLabel = normalizeSensitivityLabel(input.sensitivityLabel);
    const sanitized = this.buildSanitizedBrief(input.question, config.externalReview.maxChars);

    if (!config.enabled) {
      const result = this.makeResult("council_open_room", "blocked", "Council Room deshabilitado por settings.", {
        reason: "council_disabled",
      });
      this.pushResult(result, { active_tab: "council", status: "blocked", errors: [result.message], updated_at: now });
      return result;
    }

    if (!input.question.trim()) {
      const result = this.makeResult("council_open_room", "blocked", "Plantea un problema antes de abrir consejo.", {
        reason: "empty_question",
      });
      this.pushResult(result, { active_tab: "council", status: "blocked", errors: [result.message], updated_at: now });
      return result;
    }

    if (!sanitized.ok) {
      const message =
        sanitized.reason === "raw_diff_blocked"
          ? "El brief contiene raw diff. Resume o redacta el diff antes de abrir consejo."
          : "El brief parece contener secretos o material sensible. Redactalo antes de abrir consejo.";
      const result = this.makeResult("council_open_room", "blocked", message, {
        reason: sanitized.reason,
      });
      this.pushResult(result, {
        active_tab: "council",
        status: "blocked",
        operator_question: input.question,
        sensitivity_label: sensitivityLabel,
        sanitized_brief: null,
        positions: [],
        packet: null,
        external_reviewer: this.resolveExternalReviewerState(config, sensitivityLabel, "blocked", sanitized.reason),
        errors: [message],
        updated_at: now,
      });
      return result;
    }

    const sessionId = this.createId();
    const externalState = this.resolveExternalReviewerState(config, sensitivityLabel);
    this.deps.store.update((current) => ({
      ...current,
      last_action: "council_open_room",
      runtime_state: current.runtime_state === "error" ? "error" : current.runtime_state,
      council: {
        ...current.council,
        active_tab: "council",
        session_id: sessionId,
        status: "open",
        operator_question: input.question,
        sensitivity_label: sensitivityLabel,
        sanitized_brief: sanitized.brief,
        positions: [],
        packet: null,
        external_reviewer: externalState,
        errors: [],
        updated_at: now,
      },
      updated_at: now,
    }));

    await this.recordCouncilEvent("council.session_started", "Council session opened.", {
      session_id: sessionId,
      sensitivity_label: sensitivityLabel,
      brief_hash: hashText(sanitized.brief),
      brief_chars: sanitized.brief.length,
      external_reviewer: externalState,
    });

    const result = this.makeResult("council_open_room", "ok", "Council Room abierto. Reg listo para deliberar.", {
      session_id: sessionId,
      sensitivity_label: sensitivityLabel,
      external_reviewer: externalState,
    });
    this.pushResult(result);
    return result;
  }

  public async runRound(): Promise<LocalCommandResult> {
    const snapshot = this.deps.store.getSnapshot();
    const council = snapshot.council;
    const config = this.deps.getCouncilConfig();
    const now = this.isoNow();

    if (!council.session_id || !council.sanitized_brief) {
      const result = this.makeResult("council_run_round", "blocked", "Abre una sesión de consejo primero.", {
        reason: "no_active_session",
      });
      this.pushResult(result, { active_tab: "council", status: "blocked", errors: [result.message], updated_at: now });
      return result;
    }

    if (council.status === "blocked" || council.status === "error") {
      const result = this.makeResult("council_run_round", "blocked", "La sesión actual está bloqueada.", {
        reason: council.status,
      });
      this.pushResult(result);
      return result;
    }

    const localPositions = LOCAL_ROLES.map((role) =>
      this.buildLocalPosition(role, council.session_id as string, council.sanitized_brief as string),
    );
    const externalPosition = await this.buildExternalReviewerPosition(
      council.session_id,
      council.sensitivity_label,
      council.sanitized_brief,
      config,
    );
    const positions = externalPosition ? [...localPositions, externalPosition] : localPositions;
    const externalState = this.externalStateFromPosition(config, council.sensitivity_label, externalPosition);

    this.deps.store.update((current) => ({
      ...current,
      last_action: "council_run_round",
      council: {
        ...current.council,
        active_tab: "council",
        status: "round_complete",
        positions,
        packet: null,
        external_reviewer: externalState,
        errors: [],
        updated_at: now,
      },
      updated_at: now,
    }));

    for (const position of positions) {
      await this.recordCouncilEvent("council.position_submitted", `${position.role} submitted council position.`, {
        session_id: position.session_id,
        role: position.role,
        provider: position.provider,
        status: position.status,
        stance: position.stance,
        claim: position.claim,
        confidence: position.confidence,
        risks: position.risks,
      });
    }

    const result = this.makeResult("council_run_round", "ok", "Ronda de consejo completada.", {
      session_id: council.session_id,
      positions_count: positions.length,
      external_reviewer: externalState,
    });
    this.pushResult(result);
    return result;
  }

  public async synthesizePacket(): Promise<LocalCommandResult> {
    const snapshot = this.deps.store.getSnapshot();
    const council = snapshot.council;
    const now = this.isoNow();

    if (!council.session_id || council.positions.length === 0) {
      const result = this.makeResult(
        "council_synthesize_packet",
        "blocked",
        "Ejecuta una ronda antes de sintetizar packet.",
        { reason: "no_positions" },
      );
      this.pushResult(result, { active_tab: "council", status: "blocked", errors: [result.message], updated_at: now });
      return result;
    }

    const packet = this.buildPacket(snapshot);
    this.deps.store.update((current) => ({
      ...current,
      last_action: "council_synthesize_packet",
      council: {
        ...current.council,
        active_tab: "council",
        status: "synthesized",
        packet,
        errors: [],
        updated_at: now,
      },
      updated_at: now,
    }));

    await this.recordCouncilEvent("council.packet_synthesized", "Reg synthesized council packet.", {
      session_id: packet.session_id,
      packet_version: packet.version,
      recommendation: packet.recommendation,
      objections_count: packet.objections.length,
      dissent_count: packet.dissent.length,
      proposal_candidates_count: packet.proposal_candidates.length,
      packet,
    });

    this.deps.outputChannel?.appendLine("[WIS][COUNCIL] agent_council_packet_v1");
    this.deps.outputChannel?.appendLine(JSON.stringify(packet, null, 2));

    const result = this.makeResult("council_synthesize_packet", "ok", "Reg sintetizó agent_council_packet_v1.", {
      session_id: packet.session_id,
      packet,
    });
    this.pushResult(result);
    return result;
  }

  public async configureGeminiKey(value: string | null): Promise<void> {
    if (!this.deps.secretStorage) {
      return;
    }
    if (!value?.trim()) {
      await this.deps.secretStorage.delete(GEMINI_API_KEY_STORAGE_KEY);
      return;
    }
    await this.deps.secretStorage.store(GEMINI_API_KEY_STORAGE_KEY, value.trim());
  }

  public switchTab(tab: CouncilRoomTab): void {
    const now = this.isoNow();
    this.deps.store.update((current) => ({
      ...current,
      council: {
        ...current.council,
        active_tab: tab,
        updated_at: now,
      },
      updated_at: now,
    }));
  }

  public buildSanitizedBrief(raw: string, maxChars: number): SanitizedBriefResult {
    const normalized = raw.replace(/\r\n/g, "\n").trim();
    if (!normalized) {
      return { ok: false, brief: "", reason: "empty_question" };
    }
    if (RAW_DIFF_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return { ok: false, brief: "", reason: "raw_diff_blocked" };
    }
    if (BLOCKED_SECRET_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return { ok: false, brief: "", reason: "secret_material_blocked" };
    }

    const redacted = SECRET_REDACTION_PATTERNS.reduce(
      (value, [pattern, replacement]) => value.replace(pattern, replacement),
      normalized,
    );
    return {
      ok: true,
      brief: redacted.slice(0, Math.max(1, maxChars)),
      reason: null,
    };
  }

  private buildLocalPosition(role: CouncilRole, sessionId: string, brief: string): CouncilPosition {
    const briefSummary = summarizeText(brief, 180);
    const now = this.isoNow();
    const templates: Record<CouncilRole, Omit<CouncilPosition, "id" | "session_id" | "role" | "created_at">> = {
      reg: {
        provider: "reg",
        status: "submitted",
        stance: "observe",
        claim: "Reg coordina turnos y sintetiza sin ratificar.",
        rationale: "La autoridad canonica queda fuera de la deliberacion automatica.",
        evidence: [briefSummary],
        risks: ["Confundir sintesis con aprobacion canonica."],
        confidence: "high",
      },
      architect: {
        provider: "local_role",
        status: "submitted",
        stance: "refine",
        claim: "Conviene separar UI, orquestacion local y persistencia de eventos.",
        rationale: "La sala debe ser usable sin acoplarla al runner Codex ni abrir features MCP nuevas.",
        evidence: [briefSummary],
        risks: ["Acoplar estado de consejo a comandos de ejecucion local."],
        confidence: "high",
      },
      implementer: {
        provider: "local_role",
        status: "submitted",
        stance: "support",
        claim: "Implementar una primera ronda determinista con roles locales y packet v1.",
        rationale: "Da una experiencia funcional ahora y permite sustituir participantes por LLMs luego.",
        evidence: [briefSummary],
        risks: ["Prometer deliberacion libre antes de tener adapters LLM gobernados."],
        confidence: "high",
      },
      critic: {
        provider: "local_role",
        status: "submitted",
        stance: "object",
        claim: "La mayor objecion es filtrar contenido sensible al revisor externo.",
        rationale: "El free tier externo no debe recibir secretos, raw diffs ni material sin etiqueta.",
        evidence: ["Gemini solo se habilita con sensitivity_label=non_sensitive."],
        risks: ["Una etiqueta incorrecta podria exponer datos."],
        confidence: "high",
      },
      operator_advocate: {
        provider: "local_role",
        status: "submitted",
        stance: "support",
        claim: "El operador necesita una sala clara: problema, rondas, timeline y sintesis.",
        rationale: "La UX debe parecer conversacion gobernada, no una prueba tecnica de API.",
        evidence: [briefSummary],
        risks: ["Demasiados controles pueden esconder el flujo principal."],
        confidence: "medium",
      },
      risk_auditor: {
        provider: "local_role",
        status: "submitted",
        stance: "object",
        claim: "No debe haber ratificacion, escritura canonica ni promocion automatica.",
        rationale: "El consejo recomienda; Reg sintetiza; el operador decide.",
        evidence: ["Eventos persistidos: session_started, position_submitted, packet_synthesized."],
        risks: ["Persistir transcript crudo completo violaria la politica de minimizacion."],
        confidence: "high",
      },
      historian: {
        provider: "local_role",
        status: "submitted",
        stance: "observe",
        claim: "Guardar solo eventos resumidos preserva trazabilidad sin almacenar todo el chat.",
        rationale: "La historia debe responder que se deliberó y que se recomendó, no capturar todo el texto crudo.",
        evidence: ["packet final compatible con agent_council_packet_v1."],
        risks: ["Poca evidencia si los resumenes son demasiado pobres."],
        confidence: "medium",
      },
      wildcard: {
        provider: "local_role",
        status: "submitted",
        stance: "refine",
        claim: "La sala puede empezar ordenada y luego evolucionar a chat grupal con turnos visibles.",
        rationale: "Rondas gobernadas evitan caos y aun asi dejan espacio para disenso creativo.",
        evidence: [briefSummary],
        risks: ["La primera version puede sentirse demasiado determinista."],
        confidence: "medium",
      },
      external_reviewer: {
        provider: "gemini_ai_studio",
        status: "skipped",
        stance: "observe",
        claim: "External reviewer not invoked.",
        rationale: "This placeholder is not used for local role generation.",
        evidence: [],
        risks: [],
        confidence: "low",
      },
    };

    const template = templates[role];
    return {
      ...template,
      id: this.createId(),
      session_id: sessionId,
      role,
      created_at: now,
    };
  }

  private async buildExternalReviewerPosition(
    sessionId: string,
    sensitivityLabel: CouncilSensitivityLabel,
    brief: string,
    config: CouncilConfig,
  ): Promise<CouncilPosition | null> {
    if (!config.externalReview.enabled) {
      return null;
    }

    const base = {
      id: this.createId(),
      session_id: sessionId,
      role: "external_reviewer" as const,
      provider: "gemini_ai_studio" as const,
      created_at: this.isoNow(),
      evidence: ["Gemini is only eligible for sensitivity_label=non_sensitive."],
      confidence: "medium" as const,
    };

    if (sensitivityLabel !== "non_sensitive") {
      return {
        ...base,
        status: "blocked",
        stance: "observe",
        claim: "Gemini bloqueado por sensibilidad.",
        rationale: "El revisor externo solo puede recibir briefs marcados explicitamente como non_sensitive.",
        risks: ["Contenido sin allowlist explicita no sale del entorno local."],
      };
    }

    const apiKey = await this.resolveGeminiApiKey();
    if (!apiKey) {
      return {
        ...base,
        status: "unavailable",
        stance: "observe",
        claim: "Gemini no disponible: falta GEMINI_API_KEY.",
        rationale: "La ronda local continua sin fallar cuando el invitado externo no tiene credenciales.",
        risks: ["Sin revisor externo, el disenso queda limitado a roles locales."],
      };
    }

    try {
      const review = await this.externalReviewClient.review({
        brief,
        model: config.externalReview.model,
        apiKey,
        maxChars: config.externalReview.maxChars,
      });
      return {
        ...base,
        status: "submitted",
        stance: "refine",
        claim: review.claim,
        rationale: review.rationale,
        risks: review.risks.length > 0 ? review.risks : ["Revisor externo no es autoridad canonica."],
      };
    } catch (error) {
      return {
        ...base,
        status: "unavailable",
        stance: "observe",
        claim: "Gemini no disponible durante la ronda.",
        rationale: error instanceof Error ? error.message : "unknown_gemini_error",
        risks: ["La ronda local continua y conserva el fallo como posicion no bloqueante."],
      };
    }
  }

  private buildPacket(snapshot: ProjectRuntimeSnapshot): CouncilPacketV1 {
    const council = snapshot.council;
    const submitted = council.positions.filter((position) => position.status === "submitted");
    const implementer = submitted.find((position) => position.role === "implementer");
    const architect = submitted.find((position) => position.role === "architect");
    const objections = council.positions
      .filter((position) => position.stance === "object" || position.status === "blocked")
      .map((position) => `${position.role}: ${position.claim}`);
    const dissent = council.positions
      .filter((position) => position.stance === "object" || position.status === "blocked" || position.status === "unavailable")
      .map((position) => ({
        role: position.role,
        claim: position.claim,
        rationale: position.rationale,
      }));
    const recommendation =
      implementer?.claim ?? architect?.claim ?? "Mantener deliberacion local y pedir decision explicita del operador.";
    const questionSummary = summarizeText(council.sanitized_brief ?? council.operator_question, 260);
    const regSynthesis = [
      "Reg sintetiza la ronda sin ratificar ni escribir canon.",
      `Recomendacion: ${recommendation}`,
      objections.length > 0 ? `Objeciones conservadas: ${objections.length}.` : "Sin objeciones bloqueantes registradas.",
    ].join(" ");

    return {
      version: "agent_council_packet_v1",
      session_id: council.session_id ?? this.createId(),
      sensitivity_label: council.sensitivity_label,
      question_summary: questionSummary,
      reg_synthesis: regSynthesis,
      recommendation,
      objections,
      dissent,
      next_actions: [
        "Operador revisa la sintesis de Reg.",
        "Si hay acuerdo, convertir la recomendacion en tarea explicita.",
        "Si hay material sensible, mantener la revision dentro de roles locales.",
      ],
      proposal_candidates: [
        {
          target_kind: "operator_decision",
          target_key: `council:${council.session_id ?? "unknown"}`,
          rationale: "Candidate only; no ratification or canonical write is performed automatically.",
          proposed_payload: {
            recommendation,
            sensitivity_label: council.sensitivity_label,
          },
        },
      ],
      positions: council.positions,
      created_at: this.isoNow(),
    };
  }

  private async resolveGeminiApiKey(): Promise<string | null> {
    const fromEnv = process.env.GEMINI_API_KEY?.trim();
    if (fromEnv) {
      return fromEnv;
    }
    const fromSecret = await this.deps.secretStorage?.get(GEMINI_API_KEY_STORAGE_KEY);
    const trimmed = typeof fromSecret === "string" ? fromSecret.trim() : "";
    return trimmed || null;
  }

  private resolveExternalReviewerState(
    config: CouncilConfig,
    sensitivityLabel: CouncilSensitivityLabel,
    overrideStatus?: CouncilExternalReviewerState["status"],
    reason?: string | null,
  ): CouncilExternalReviewerState {
    if (!config.externalReview.enabled) {
      return {
        provider: "gemini_ai_studio",
        enabled: false,
        status: "disabled",
        model: config.externalReview.model,
        reason: "Disabled by wisContextSync.council.externalReview.enabled/GEMINI_EXTERNAL_REVIEW_ENABLED.",
      };
    }
    if (overrideStatus) {
      return {
        provider: "gemini_ai_studio",
        enabled: true,
        status: overrideStatus,
        model: config.externalReview.model,
        reason: reason ?? null,
      };
    }
    if (sensitivityLabel !== "non_sensitive") {
      return {
        provider: "gemini_ai_studio",
        enabled: true,
        status: "blocked",
        model: config.externalReview.model,
        reason: "sensitivity_label must be non_sensitive.",
      };
    }
    return {
      provider: "gemini_ai_studio",
      enabled: true,
      status: "available",
      model: config.externalReview.model,
      reason: null,
    };
  }

  private externalStateFromPosition(
    config: CouncilConfig,
    sensitivityLabel: CouncilSensitivityLabel,
    position: CouncilPosition | null,
  ): CouncilExternalReviewerState {
    if (!position) {
      return this.resolveExternalReviewerState(config, sensitivityLabel);
    }
    if (position.status === "unavailable") {
      return this.resolveExternalReviewerState(config, sensitivityLabel, "unavailable", position.claim);
    }
    if (position.status === "blocked") {
      return this.resolveExternalReviewerState(config, sensitivityLabel, "blocked", position.rationale);
    }
    return this.resolveExternalReviewerState(config, sensitivityLabel, "available", null);
  }

  private async recordCouncilEvent(
    eventType: "council.session_started" | "council.position_submitted" | "council.packet_synthesized",
    message: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const createdAt = this.isoNow();
    this.deps.store.update((current) => ({
      ...current,
      council: {
        ...current.council,
        events: [...current.council.events, { event_type: eventType, message, created_at: createdAt }].slice(-50),
        updated_at: createdAt,
      },
      updated_at: createdAt,
    }));

    try {
      const snapshot = this.deps.store.getSnapshot();
      const environment = await this.deps.inspector.inspect();
      const project = await this.deps.persistence.ensureProject({
        operation_profile: this.deps.getOperationProfile(),
        workspace_root: snapshot.workspace_root ?? environment.workspace_root,
        repo_root: snapshot.repo_root ?? environment.repo_root,
        branch: snapshot.branch ?? environment.branch,
      });
      await this.deps.persistence.saveEvent({
        project_id: project.id,
        task_id: null,
        execution_id: null,
        event_type: eventType,
        severity: "info",
        message,
        payload,
        idempotency_key: `${eventType}:${String(payload.session_id ?? "no_session")}:${hashText(message + createdAt)}`,
      });
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      this.deps.outputChannel?.appendLine(`[WIS][COUNCIL][PERSISTENCE] skipped ${eventType}: ${err}`);
    }
  }

  private pushResult(result: LocalCommandResult, councilPatch?: Partial<ProjectRuntimeSnapshot["council"]>): void {
    this.deps.store.update((current) => ({
      ...current,
      last_action: result.command,
      last_result: result,
      council: {
        ...current.council,
        ...(councilPatch ?? {}),
      },
      updated_at: result.timestamp,
    }));
  }

  private makeResult(
    command: LocalCommandName,
    status: LocalCommandResult["status"],
    message: string,
    details: Record<string, unknown> | null,
  ): LocalCommandResult {
    return {
      command,
      status,
      ok: status === "ok",
      message,
      timestamp: this.isoNow(),
      details,
    };
  }

  private isoNow(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  private createId(): string {
    return this.deps.createId?.() ?? randomUUID();
  }
}

function normalizeSensitivityLabel(value: CouncilSensitivityLabel): CouncilSensitivityLabel {
  if (value === "non_sensitive" || value === "sensitive" || value === "unknown") {
    return value;
  }
  return "unknown";
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function summarizeText(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function extractRiskHints(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const risks = lines.filter((line) => /riesgo|risk|cuidado|bloque/i.test(line)).slice(0, 3);
  return risks.map((line) => summarizeText(line, 180));
}
