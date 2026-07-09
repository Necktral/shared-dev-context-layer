import test from "node:test";
import assert from "node:assert/strict";
import { CouncilRoomService } from "../../council/councilRoomService";
import type { CouncilConfig } from "../../config";
import { InMemoryLocalRuntimeStore } from "../../local/localRuntimeStore";
import { NoopPersistence } from "../../local/noopServices";
import type { PersistedEvent, SaveEventInput } from "../../local/ports";
import { createInitialProjectRuntimeSnapshot } from "../../local/types";

class RecordingPersistence extends NoopPersistence {
  public readonly events: SaveEventInput[] = [];

  public override async saveEvent(input: SaveEventInput): Promise<PersistedEvent> {
    this.events.push(input);
    return super.saveEvent(input);
  }
}

function makeConfig(externalReviewEnabled: boolean): CouncilConfig {
  return {
    enabled: true,
    externalReview: {
      enabled: externalReviewEnabled,
      model: "gemini-3.1-flash-lite",
      maxChars: 12000,
    },
  };
}

function makeService(options?: { externalReviewEnabled?: boolean; geminiKey?: string | null }) {
  const store = new InMemoryLocalRuntimeStore(createInitialProjectRuntimeSnapshot("local_private"));
  const persistence = new RecordingPersistence({ dbStatus: "connected", reason: null });
  let id = 0;
  const service = new CouncilRoomService({
    store,
    persistence,
    inspector: {
      inspect: async () => ({
        workspace_root: "/workspace",
        repo_root: "/workspace/repo",
        branch: "main",
        active_file: null,
        timestamp: "2026-07-07T00:00:00.000Z",
        inspector_status: "ok",
        inspector_error: null,
      }),
    },
    getOperationProfile: () => "local_private",
    getCouncilConfig: () => makeConfig(options?.externalReviewEnabled ?? false),
    secretStorage: {
      get: async () => options?.geminiKey ?? undefined,
      store: async () => undefined,
      delete: async () => undefined,
    },
    externalReviewClient: {
      review: async () => ({
        claim: "Gemini sugiere preservar el disenso externo.",
        rationale: "El brief es no sensible y fue sanitizado antes de salir.",
        risks: ["El revisor externo no es autoridad canonica."],
      }),
    },
    now: () => new Date("2026-07-07T00:00:00.000Z"),
    createId: () => `id-${++id}`,
  });
  return { service, store, persistence };
}

test("CouncilRoomService bloquea Gemini si sensitivity_label no es non_sensitive", async () => {
  const { service, store } = makeService({ externalReviewEnabled: true });

  await service.openSession({ question: "Organizar ideas del consejo", sensitivityLabel: "unknown" });
  const result = await service.runRound();

  assert.equal(result.ok, true);
  const council = store.getSnapshot().council;
  assert.equal(council.external_reviewer.status, "blocked");
  assert.ok(council.positions.some((position) => position.role === "external_reviewer" && position.status === "blocked"));
  assert.ok(council.positions.some((position) => position.role === "architect" && position.status === "submitted"));
});

test("CouncilRoomService bloquea raw diffs y patrones de secretos", async () => {
  const { service: diffService, store: diffStore } = makeService();
  const diffResult = await diffService.openSession({
    question: "diff --git a/app.ts b/app.ts\n@@ -1 +1 @@\n-secret\n+value",
    sensitivityLabel: "non_sensitive",
  });

  assert.equal(diffResult.status, "blocked");
  assert.equal(diffStore.getSnapshot().council.session_id, null);
  assert.equal(diffResult.details?.reason, "raw_diff_blocked");

  const { service: secretService, store: secretStore } = makeService();
  const secretResult = await secretService.openSession({
    question: "Configurar GEMINI_API_KEY=abc123 en el consejo",
    sensitivityLabel: "non_sensitive",
  });

  assert.equal(secretResult.status, "blocked");
  assert.equal(secretStore.getSnapshot().council.session_id, null);
  assert.equal(secretResult.details?.reason, "secret_material_blocked");
});

test("CouncilRoomService sintetiza packet con recomendacion, objecion y dissent preservado", async () => {
  const { service, store } = makeService();

  await service.openSession({ question: "Crear sala de consejo gobernada", sensitivityLabel: "sensitive" });
  await service.runRound();
  const result = await service.synthesizePacket();

  assert.equal(result.ok, true);
  const packet = store.getSnapshot().council.packet;
  assert.equal(packet?.version, "agent_council_packet_v1");
  assert.match(packet?.recommendation ?? "", /primera ronda determinista/);
  assert.ok((packet?.objections.length ?? 0) > 0);
  assert.ok(packet?.dissent.some((entry) => entry.role === "critic"));
  assert.ok(packet?.dissent.some((entry) => entry.role === "risk_auditor"));
});

test("CouncilRoomService registra eventos council sin transcript crudo completo", async () => {
  const { service, persistence } = makeService();

  await service.openSession({ question: "Como organizar una sala gobernada", sensitivityLabel: "sensitive" });
  await service.runRound();
  await service.synthesizePacket();

  const eventTypes = persistence.events.map((event) => event.event_type);
  assert.ok(eventTypes.includes("council.session_started"));
  assert.ok(eventTypes.includes("council.position_submitted"));
  assert.ok(eventTypes.includes("council.packet_synthesized"));

  const persisted = JSON.stringify(persistence.events);
  assert.equal(persisted.includes("operator_question"), false);
  assert.equal(persisted.includes("sanitized_brief"), false);
});

test("CouncilRoomService marca Gemini unavailable sin romper ronda local cuando falta key", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const { service, store } = makeService({ externalReviewEnabled: true, geminiKey: null });

    await service.openSession({ question: "Evaluar arquitectura no sensible", sensitivityLabel: "non_sensitive" });
    const result = await service.runRound();

    assert.equal(result.ok, true);
    const council = store.getSnapshot().council;
    assert.equal(council.external_reviewer.status, "unavailable");
    assert.ok(council.positions.some((position) => position.role === "external_reviewer" && position.status === "unavailable"));
    assert.ok(council.positions.some((position) => position.role === "implementer" && position.status === "submitted"));
  } finally {
    if (previousKey) {
      process.env.GEMINI_API_KEY = previousKey;
    }
  }
});
