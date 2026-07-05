# Planos de Arquitectura — Shared Dev Context Layer v2 ("Context Pods")

> **Autor:** Fable 5 (ingeniero) · **Ejecutor previsto:** Opus 4.8 (constructor) · **Fecha:** 2026-07-04
> **Nota de versión:** **v2.1 — incorpora `REVISION-DIRECTIVE.md` (49 hallazgos).** Este documento aplica las decisiones D1–D5 y las enmiendas por WP de la directiva de revisión. Donde este documento y `REVISION-DIRECTIVE.md` coincidan, la directiva es la fuente normativa original; donde este documento describa el estado objetivo tras aplicar la directiva, es la referencia viva. La numeración de migraciones, el modelo de seguridad §6 y el contrato MCP §5 reflejan ya las correcciones normativas.
> **Lectura obligatoria previa:** `docs/blueprint/REVISION-DIRECTIVE.md` (directiva NORMATIVA; manda sobre estos planos donde los contradiga), `docs/CAPABILITIES.md` (SNAPSHOT HISTÓRICO de auditoría, commit `0133208`; no refleja el estado post-v2 — la verdad viva es el código + `CONTRACT-INVENTORY.md`) y `docs/blueprint/BUILD-PLAN.md` (plan de ejecución por paquetes).
>
> **Regla de oro para el constructor:** para describir el *estado actual*, manda el código (no los docs históricos, que tienen drift conocido). Para el *estado objetivo*, manda este documento y la directiva. Si encuentras un conflicto de diseño no cubierto aquí, **consulta a Fable antes de improvisar** (regla 5a de BUILD-PLAN) — no "resuelvas" ambigüedades de arquitectura por tu cuenta.

---

## 1. Visión objetivo

Cuatro agentes — **ChatGPT, Codex, Claude (Desktop) y Claude Code** — trabajan sincronizados sobre cada proyecto de desarrollo, consumiendo y alimentando un **pod de contexto por proyecto**: RAG semántico + goals + org-planning + design-system + decisiones ratificadas, todo bajo el bus MCP gobernado que ya existe (scopes OAuth, dry_run, idempotencia, auditoría, ratificación humana).

```
              ┌────────────┐  ┌───────────┐  ┌────────────────┐  ┌─────────────┐
              │  ChatGPT   │  │  Claude   │  │  Claude Code   │  │ Codex (CLI) │
              │ (conector  │  │  Desktop  │  │ (.mcp.json +   │  │ vía extensión│
              │  Auth0)    │  │(mcp-remote)│ │  CLAUDE.md)    │  │  VS Code     │
              └─────┬──────┘  └─────┬─────┘  └───────┬────────┘  └──────┬──────┘
                    └───────────────┴────────┬───────┴───────────────────┘
                                             ▼
                              ╔══════════════════════════╗
                              ║   BUS MCP GOBERNADO      ║  21 → 23 tools
                              ║  (backend, :8002/mcp)    ║  auth·dry_run·idem·
                              ╚═══════════╦══════════════╝  audit·ratificación
                                          ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │                POD DE CONTEXTO (uno por proyecto)               │
        │                                                                 │
        │  FUENTE DE VERDAD                      ÍNDICE (derivado)        │
        │  ├─ repo (código)              ──┐                              │
        │  ├─ vault markdown (canon        ├──►  Postgres + pgvector      │
        │  │   humano: goals/design-      │     · corpus "code"           │
        │  │   system/org-planning)     ──┘     · corpus "canon"          │
        │  └─ Postgres (estado gobernado:                                 │
        │      decisiones, proposals, audit, eventos)                     │
        └─────────────────────────────────────────────────────────────────┘
```

El ciclo del sistema no cambia: `intención → contexto → ejecución → registro → reanálisis`. Lo que cambia es que (a) el contexto pasa a ser **por proyecto** y **semántico**, (b) el canon humano vive en **markdown** además de en Postgres, y (c) los **cuatro agentes** son consumidores/productores identificados del mismo bus.

> **Nota de alcance sobre el diagrama (v2.1):** el diagrama muestra ambos corpus del índice (`code` y `canon`) porque ambos se **materializan** en Postgres — el worker de embeddings procesa los dos (ADR-B2). Pero en v1 **solo el corpus `canon` sale por el bus MCP**; el corpus `code` permanece local y sirve exclusivamente al retrieval de Codex, que consulta Postgres directamente (ver ADR-B2 enmendado y §5). La flecha "corpus code → bus" no existe en v1.

---

## 2. Decisiones de arquitectura (mini-ADRs)

> Los mini-ADRs de esta sección son la síntesis de arquitectura. El repo mantiene, además, ADRs formales bajo `docs/context/adr/` para los cambios que exigen el flujo `non_additive` de CONTRACT-GOVERNANCE. Referencias formales relevantes tras la directiva:
> - **`ADR-phase0-perimeter-closure.md`** — ampara todo el cierre de perímetro de Fase 0 (bind/publicación loopback, `X-Internal-Token` en `/internal/*`, guard de arranque del transporte, preflight de túneles con abort, operator-token de ratificación). Es el ADR que satisface el paso 1 del flujo `non_additive` para WP-0.5b/0.5c/0.5d y el operator-token de WP-0.2. Ver §6 (D1).
> - **`ADR-multi-project-scopes.md`** — promoción formal de ADR-B3: motivo, riesgo, transición y estrategia de downgrade *lossy-by-design* de la migración `0008`. Ver §4 y ADR-B3.
> - **`ADR-deliberative-context-ratification.md`** — recibe el addendum de una línea sobre RAG-no-canónico (§5, D4.6) y los addenda de gobernanza por categoría (ADR-B5) y default `dry_run` de `propose_change`.

### ADR-B1 — Markdown para el canon humano; Postgres para el estado gobernado; UN índice RAG
- El **vault markdown** (convenciones inspiradas en obsidian-mind) es la fuente que el humano edita: `goals.md`, `design-system/`, `org-planning/`, `decisions/`, `research/`. Portátil, versionado en git, visible en Obsidian.
- **Postgres** guarda lo que gobierna la máquina: proposals, decisiones ratificadas, auditoría, idempotencia, eventos. No es lock-in problemático: es estado transaccional, no contenido humano.
- El **índice RAG (pgvector)** es derivado y desechable: se reconstruye desde repo + vault + context_items. El lock-in se mide sobre las fuentes, no sobre el índice.
- **Rechazado:** adoptar obsidian-mind entero (taxonomía orientada a persona, bus factor 1, upgrades por git-merge). Se adoptan sus *ideas*: convención de vault, frontmatter validado, hooks de inyección de contexto.
- **Rechazado:** depender del binario QMD como motor RAG (segundo índice SQLite fuera del bus gobernado, otro proyecto de autor único).

### ADR-B2 — Un único worker de embeddings (Python, backend), dos corpus; en v1 solo `canon` sale por el bus
- Un solo proceso embebedor (`backend/app/rag/embedding_worker.py`) procesa **ambos corpus** en la misma base `wis_context`:
  - **corpus `canon`**: `context_items` (goals, decisiones, design-system, research) — sirve a los 4 agentes vía MCP.
  - **corpus `code`**: `local_private.file_chunks` (chunks del repo+vault que ya genera el indexador de la extensión) — alimenta el retrieval **local** de Codex (`chunk_embeddings`).
- **Enmienda v2.1 (D4):** el worker procesa ambos corpus, PERO el corpus `code` **NO se expone por el bus MCP en v1**: se queda local, disponible únicamente para el retrieval de Codex, que consulta Postgres directamente y hace la fusión vectorial + RRF *client-side* en la extensión (donde el léxico sobre `file_chunks` sí existe — `postgresPersistenceAdapter.ts`, `searchFileChunks`). El único consumidor real del corpus `code` es ese retrieval local; nada de valor se pierde al no publicarlo. `semantic_search` v1 busca **solo `canon`** (ver §5).
- **Degradación limpia del worker (F25):** si el esquema `local_private` no existe en la BD (arnés backend puro, instalaciones sin extensión), el worker **omite el corpus `code` con un log claro, sin crash**, y sigue procesando `canon`. El worker no mapea scopes: procesa chunks `pending`/`stale` globalmente.
- **Mapeo scope↔`local_private` (reservado v2, decidido ya para evitar drift):** la regla es **igualdad de `project_key`** — `backend.projects.project_key == local_private.projects.project_key` (`001_init.sql:1-10`). Se registra AHORA como fila `integration_contract` en `CONTRACT-INVENTORY.md` con estado "reservado, sin consumidor en v1".
- **Precondiciones para exponer el corpus `code` por el bus en v2** (escritas aquí para que no haya drift; ninguna se relaja en v1):
  1. **Scope propio `wis.context.code.read`**, distinto de `wis.context.read`, que **nunca** aparece en `required_scopes` del transporte MCP y **nunca** se concede a clientes remotos (política de grants Auth0, D1.3).
  2. **Exclusión de portadores de secretos** del set indexable: `.env`, `.pem` y equivalentes fuera de `includeExtensions` (`vscode-extension/src/constants.ts:56`) — higiene aplicada YA en v1 (WP-0.5g) aunque el índice sea local, porque sus chunks entran en prompts hacia Codex.
  3. **Redacción por contenido** (no solo por nombre de clave): filtro de patrones de secretos sobre el `snippet` antes de devolverlo. La redacción actual de `delegated_limited` es por NOMBRE de clave (`delegated_limited.py:153`), insuficiente para snippets de código; se añade el filtro por contenido como utilidad reutilizable en `delegated_limited.py`.
- Proveedor **agnóstico** vía config: `EMBEDDINGS_PROVIDER = ollama | openai_compatible | none`, **default `none`** (opt-in explícito; ollama recomendado en comentario de `.env.example`). Modelo default `nomic-embed-text`, **768 dims fijas en v1** (`vector(768)`; el worker valida `EMBEDDINGS_DIM == 768` al arrancar y falla con mensaje claro si no — cambiar de dimensión es una migración futura, F47). Sin proveedor ⇒ el sistema degrada a léxico puro (comportamiento actual), **sin fallback silencioso**: el estado se reporta.
- **Egress opt-in (F41):** si el provider es remoto (`openai_compatible`), el contenido de los chunks Y las queries salen de la máquina — decisión explícita del operador, nunca default (`EMBEDDINGS_PROVIDER=none` por defecto). `openai_compatible` exige endpoint `https` salvo `EMBEDDINGS_ALLOW_INSECURE_ENDPOINT=true`. Ver §6.6.
- La extensión **no** implementa embebedor propio (evita duplicar lógica en TS); su retriever consulta pgvector directamente (ya tiene cliente `pg`).
- **Nota de condicionalidad pgvector (addendum WP-2.1):** el DDL de embeddings (backend `0009_rag_canon` y extensión `007_embeddings.sql`) es **condicional** — si el tipo `vector` no está disponible, la migración salta la parte vectorial con aviso y el sistema queda en modo degradado léxico, sin corromper la cadena de migraciones. Ver §4.
- **Justificación del acoplamiento cross-schema** (backend lee `local_private.*`): prototipo personal, misma BD, un solo operador. Se documenta como `integration_contract` en el inventario para que no sea drift silencioso.

### ADR-B3 — Multi-proyecto real: scope current por proyecto y política por scope
- Hoy `uq_context_scopes_single_current` es **global** (un solo scope activo en toda la BD) y `policy_state` es global. Esto hace el sistema mono-proyecto de facto y bloquea la visión.
- Objetivo: **un scope current por (workspace, project)** y resolución de política con precedencia `project > workspace > global`.
- **Promoción a ADR formal (D2):** este mini-ADR se promueve a `docs/context/adr/ADR-multi-project-scopes.md`. El índice de reemplazo es el simple `CREATE UNIQUE INDEX uq_context_scopes_current_per_project ON context_scopes (workspace_id, project_id) WHERE is_current` — **sin `COALESCE`** (era rama muerta que sugería un scope de workspace inexistente; F29). `context_scopes.project_id` **sigue `NOT NULL`**. La política a nivel workspace se cubre por `policy_state.workspace_id/project_id` nullable (WP-1.1b), no por un scope de workspace. La migración (`0008`) trae un `downgrade()` **lossy-by-design**: colapsa a un único current (conserva el de `created_at` más reciente) antes de recrear el índice global. Ver §4.

### ADR-B4 — "Sincronizados" v1 = pod compartido + trail de sesiones; NO co-edición simultánea
- v1: cada agente (identificado en la tabla `consumers` existente) **lee el brief del pod al empezar** y **registra un resumen de sesión al terminar** (`append_context_event`, `event_type='agent.session_summary'`). El brief incluye los últimos resúmenes de los demás agentes ⇒ cada agente arranca sabiendo qué hicieron los otros.
- La concurrencia se resuelve con lo que ya existe: idempotencia, optimistic locking, locks de proyecto (runtime local) y ratificación para el canon.
- La colaboración simultánea sobre la misma tarea (v2) queda explícitamente **fuera de alcance**.

### ADR-B5 — Gobernanza por categoría: el canon se ratifica, lo operativo fluye
- `approval_policy_json` (ya implementado, hoy inerte porque nadie lo configura) pasa a tener defaults activos: categorías **canon** (`goal`, `design_system`, `org_plan`, `decision`) ⇒ modo `ratify` (requiere Proposal ratificada por humano); categorías **operativas** (`research_finding`, `risk` en modo `auto`, eventos, items efímeros) ⇒ `auto`.
- Coherente con el lema del proyecto: *"ellas deliberan, yo decido"* — pero sin gatear todo (evita la saturación que el propio ADR del repo advertía).
- **Set canónico cerrado de `item_type` (v2.1):** `('note','goal','org_plan','design_system','decision','research_finding','risk')`. `risk` entra como categoría operativa (modo `auto`) para no remapear filas existentes y mantener veraz el hint de la extensión. El cierre del set con `CHECK` es `non_additive` (migración `0010`, ver §4). Addendum a `ADR-deliberative-context-ratification.md`.

### ADR-B6 — Atribución de agente en el plano de escritura (`consumer` = atribución NO autenticada)
- Toda escritura lleva `consumer` (ya existe el parámetro en las 21 tools) con valores canónicos registrados en `consumers`: `chatgpt`, `claude_desktop`, `claude_code`, `codex_cli`, `vscode_extension`, `human_operator`.
- El brief y la auditoría segmentan por consumer ⇒ trazabilidad de "quién dijo/hizo qué" entre agentes.
- **Enmienda v2.1 (D1.5 / F07):** `consumer` es un **string autodeclarado**. Sirve para **trazabilidad y segmentación del brief**, **NO** para control de acceso. Un llamante puede afirmar cualquier `consumer`; el sistema no lo autentica. El **control de acceso real** son tres perímetros distintos, ninguno de los cuales es `consumer`:
  - **perímetro loopback** — el bus solo es alcanzable desde `127.0.0.1` por defecto (bind/publicación de puertos, §6);
  - **scopes del token** — para llamantes remotos autenticados por OAuth (Auth0), con grants read-only en v1;
  - **operator-token** — `OPERATOR_RATIFY_TOKEN`, verificado SIEMPRE para `ratify_proposal`/`reject_proposal`, incluso bajo bypass local (§6, D1.4).
- **Identidad canónica de Codex (F34/F37/F45):** el consumer canónico es `codex_cli`; el seed idempotente RENOMBRA `consumer_type 'codex'→'codex_cli'` (UPDATE preservando UUID y FKs, no inserta duplicado) si `codex_cli` no existe aún; `github_copilot` se conserva con `is_active=false`.

### ADR-B7 — Primero corregir, luego construir
- La auditoría (`docs/CAPABILITIES.md`, snapshot histórico) encontró defectos que corrompen las garantías sobre las que todo lo demás se apoya (idempotencia que quema keys en dry_run, plano deliberativo sin auditoría, `apply_sync_batch` que no aplica, API HTTP sin auth, perímetro abierto). **Ninguna fase de construcción arranca sin cerrar la Fase 0 del BUILD-PLAN.** Construir RAG sobre un write plane con esos agujeros es construir sobre arena. La directiva de revisión reordena y amplía esta Fase 0 (WP-0.8 nuevo, operator-token, cierre de perímetro).

---

## 3. Arquitectura por componentes (estado objetivo)

### 3.1 Backend (Python)
```
backend/app/
├── mcp/
│   ├── server.py              # 23 tools (21 actuales corregidas + semantic_search + get_project_brief)
│   └── governed_write.py      # NUEVO (WP-0.8): run_governed_write(...) — pipeline gobernado de escritura
├── rag/                       # NUEVO
│   ├── embedding_worker.py        # loop: embed pending (canon + code local), provider-agnostic, dim=768
│   ├── providers.py               # ollama | openai_compatible | none
│   └── retrieval.py               # búsqueda vectorial + fusión RRF (canon) para semantic_search
├── services/                  # (existentes; context_item_service pierde sus commits internos)
│   └── project_brief_service.py   # NUEVO: ensambla el brief del pod
├── sync/                      # NUEVO
│   └── vault_sync.py              # vault markdown → context_items (one-way v1); consume run_governed_write
└── ...
```

**Extracción de la cadena de gates (D5 / WP-0.8).** La cadena que hoy vive inline en cada tool de `server.py` (resolve scope → `_scope_guard` → `_ensure_idempotency_key` → `_existing_replay_payload` → `_require_ratification` → aplicar dominio → `_write_audit_and_filter` → commit único → filtro `delegated_limited`) se extrae a una **función**, no a un decorador, como forma primaria:

```python
# backend/app/mcp/governed_write.py
run_governed_write(
    db, *, tool_name, resolved: ResolvedScope, dry_run, idempotency_key,
    ratification: RatificationSpec | None, apply_fn: Callable[[Session], WriteResult],
    actor_context, response_builder,
) -> dict
```

Encapsula, en orden: `_ensure_idempotency_key` → `request_id` (`idempotency_key` o `dryrun-<uuid4>`) → replay (`_existing_replay_payload`, filtrado `dry_run==false`) → `_require_ratification` (si `ratification` no es None) → `apply_fn` (solo `flush`) → `record_write_audit` + `record_publish_audit(task_id=resolved.task.id if resolved.task else None, commit=False)` → **commit único** → `apply_delegated_limited_policy`.

Es **función y no decorador** porque debe ser invocable fuera del contexto de una tool MCP: desde las 6 write tools + `apply_sync_batch` (por operación, WP-0.3), y desde `vault_sync`/`make sync-vault` (WP-3.3), que no tienen firma de tool. El `_scope_guard` **queda en la tool** (depende del transporte). El azúcar **`@governed_tool`** (mencionado en versiones previas de estos planos) queda como **wrapper opcional** sobre la función: si el constructor no lo necesita, no lo construye. **WP-0.8 crea `governed_write.py`** y reescribe las tools de escritura sobre `run_governed_write`; requiere WP-0.4 (services sin commits internos) y es prerrequisito de WP-0.2 y WP-0.3.

### 3.2 Extensión VS Code (TypeScript)
- `HybridContextRetriever` v2: coarse léxico (actual) **+** vecinos pgvector, fusión **RRF** (k=60), mismo budget (5/8/3/6000). Nuevo método en `PersistencePort`: `searchChunksByEmbedding(queryEmbedding, limit)`. Esta fusión ocurre **client-side** en la extensión (es donde vive el léxico sobre `file_chunks`); el corpus `code` no pasa por el bus.
- El indexador acepta **roots adicionales** (setting `wisContextSync.localIndex.extraRoots`) para indexar el vault del proyecto junto al repo, con **denylist de rutas sensibles** (`~/.ssh`, `~/.aws`, `~/.gnupg`, dotfiles de home, `/etc`; rechazo por defecto) e invocación real de `assertNoSymlinkEscape` sobre cada raíz (WP-2.4).
- `ContextAwareTaskBuilder` inyecta en el prompt de Codex las **constraints del pod** (goals activos + reglas de design-system) obtenidas del backend.
- `McpWISGateway` gana `getProjectBrief(params)` (WP-3.5) para que la extensión consuma `get_project_brief` en modo MCP; `FixtureWISGateway` cubre brief completo / brief vacío / transporte caído.

### 3.3 Vault por proyecto (convención, no código)
```
<proyecto>/pod/                    # o vault Obsidian apuntando aquí
├── goals.md                       # North Star del proyecto
├── org-planning/…                 # planes, hitos, responsables
├── design-system/…                # tokens, componentes, reglas de UI
├── decisions/…                    # espejo legible de ApprovedDecisions
└── research/…                     # hallazgos con fuentes citadas
```
Frontmatter obligatorio: `type: goal|org_plan|design_system|decision|research_finding|risk|note`, `status`, `tags`, `updated`. `vault_sync` mapea `type` → `context_items.item_type` y deriva `idempotency_key` del hash de contenido (re-sync natural e idempotente). `vault_sync` aplica cada upsert vía `run_governed_write` (WP-3.3).

### 3.4 Integraciones de agentes
| Agente | Transporte | Entrada de contexto | Salida |
|---|---|---|---|
| Claude Code | `.mcp.json` → `http://localhost:8002/mcp` | hook SessionStart / instrucción CLAUDE.md → `get_project_brief` | `append_context_event` + `propose_change` para canon |
| Claude Desktop | `integration/` existente (mcp-remote) | `get_project_brief` | ídem |
| Codex | extensión (runtime local) | task builder con constraints del pod; retrieval local (corpus `code`, fusión RRF client-side) | pipeline actual (ya auditado); `append_context_event` best-effort (`codex_cli`) |
| ChatGPT | conector Auth0 (Fase 4 remota, **opcional/diferido** — requiere secretos) | `get_project_brief` | **read-only en v1** (grants: `wis.context.read` + `wis.context.sync.read`; sin write/ratify/`code.read`) |

---

## 4. Modelo de datos objetivo

### Migraciones backend (Alembic; head actual = `0006_deliberative_columns`)

Renumeración por orden real de ejecución (F09; §3.1 de la directiva). `alembic heads` debe devolver **exactamente 1 head** en todo momento; los WP que crean migraciones (`0007`, `0008`, `0009`, `0010`) se serializan entre sí aunque sus fases sean paralelas, y el que aterrice segundo rebasea su `down_revision` al head nuevo.

| Migración | down_revision | Fase / WP dueño | Contenido |
|---|---|---|---|
| `0007_write_plane_fixes` | `0006` | F0 / **WP-0.1** (la crea; 0.2, 0.4 y 0.6 la comparten — Fase 0 es secuencial) | (a) data-fix: `UPDATE context_write_audit SET request_id = 'dryrun-' || gen_random_uuid() WHERE dry_run AND request_id NOT LIKE 'dryrun-%'`; (b) índice parcial `ix_context_write_audit_replay ON (workspace_id, tool_name, request_id) WHERE NOT dry_run`; (c) `publish_audit.task_id DROP NOT NULL` + `workspace_id`/`project_id` nullable + FK + índices (backfill NULL best-effort); (d) `policy_state.approval_mode DROP NOT NULL`. Downgrade: (a) irreversible (no-op documentado); (c) aborta si hay filas con `task_id IS NULL`. |
| `0008_multi_project_scopes` | `0007` | F1 / WP-1.1 | Drop `uq_context_scopes_single_current`; `CREATE UNIQUE INDEX uq_context_scopes_current_per_project ON context_scopes (workspace_id, project_id) WHERE is_current` (**sin `COALESCE`**; `project_id` sigue `NOT NULL`); `policy_state.workspace_id`/`project_id` nullable + FK + índice. **Downgrade lossy-by-design** (D2.4): colapsa a un único current (conserva el de `created_at` más reciente) y recrea el índice global. |
| `0009_rag_canon` | `0008` | F2 / WP-2.1 | `CREATE EXTENSION IF NOT EXISTS vector` **condicional** (si `vector` ∉ `pg_available_extensions` ⇒ skip con warning y NO crea las tablas dependientes; deja marcador de modo degradado); tabla `context_item_embeddings (item_id FK ondelete CASCADE, model text, dim int, embedding vector(768), content_hash text, created_at)` + `UNIQUE(item_id, model)` + índice HNSW `vector_cosine_ops`. **Nada de `item_type`** (movido a `0010`). |
| `0010_item_type_governance` | `0009` | F3 / WP-3.1 | **`ALTER`, no `ADD COLUMN`** — `item_type` ya existe `NOT NULL` desde `0004:29`. `ALTER TABLE context_items ALTER COLUMN item_type SET DEFAULT 'note'`; `UPDATE context_items SET item_type='note' WHERE item_type NOT IN ('note','goal','org_plan','design_system','decision','research_finding','risk')`; `ADD CONSTRAINT ck_context_items_item_type CHECK (item_type IN (...)) NOT VALID`; `VALIDATE CONSTRAINT`. |

### Migraciones extensión (`migrations/local_private/`, cadena actual 001–006)
| Migración | Contenido |
|---|---|
| `007_embeddings.sql` | Tabla `chunk_embeddings (chunk_id FK ondelete CASCADE, model text, dim int, embedding vector(768), created_at)` + `UNIQUE(chunk_id, model)` + HNSW. Transiciones de `file_chunks.embedding_status`: `pending → embedded → stale` (el indexador marca `stale` al reescribir un chunk). **Guard condicional:** si el tipo `vector` no existe, el runner de migraciones de la extensión lo reporta como *"pgvector ausente: modo degradado léxico"* (no como corrupción) — la BD sin pgvector sigue migrando el resto de la cadena. El constructor elige la mecánica (fallo accionable con mensaje, o split `007a` status-transitions siempre / `007b` tabla vector condicional); el requisito es que `make native` complete la cadena en modo degradado. |

### Semántica de `pending` del corpus `canon` (definición normativa, D4.5)
`context_items` NO tiene columna `embedding_status` — el estado vive en la tabla de embeddings. Definición:
```
pending(item) := NOT EXISTS (
  SELECT 1 FROM context_item_embeddings e
  WHERE e.item_id = ci.id AND e.model = :model AND e.content_hash = :hash_actual
)
```
donde `hash_actual = sha256(canonical_json({"title": ci.title, "content_json": ci.content_json, "labels_json": ci.labels_json}))` con `sort_keys=True, ensure_ascii=False, separators=(",",":")` (misma convención que `stable_hash` de `write_audit_service.py`). Ítems con `status != 'active'` (archivados) se excluyen de `pending` y de los resultados de búsqueda. Re-ejecutar el worker sin cambios ⇒ 0 re-embeddings.

### Cambio operativo
- Imagen Postgres del compose y de los servicios de CI (`phase3-ci.yml:57,99`): `postgres:16` → **`pgvector/pgvector:pg16`** (compatible con el volumen de datos existente; misma major). Se cambia en el mismo PR que introduce el DDL condicional.

---

## 5. Contrato MCP objetivo (21 → 23 tools)

### Correcciones a tools existentes (Fase 0 — semántica, sin romper firma salvo lo indicado)
| Tool | Cambio | Clase contractual |
|---|---|---|
| todas las write | replay idempotente distingue `dry_run` (una key usada en dry_run NO bloquea el commit) | `integration_contract` (additive: corrige semántica anunciada) |
| `apply_sync_batch` | **implementa** el despacho real de `operations` (transaccional, all-or-nothing, resultados por operación, `_require_ratification` por operación vía `run_governed_write`) | `integration_contract` (corrige contrato anunciado incumplido) |
| `ratify_proposal`, `reject_proposal`, `propose_change`, `list_proposals` | pasan por la cadena estándar: idempotencia, `context_write_audit`, `publish_audit`, allowlists `delegated_limited`; `readOnlyHint` correcto | `integration_contract` |
| `propose_change` | pasa a `dry_run=True` por defecto (**non_additive**, 5 pasos); `idempotency_key` obligatoria cuando `dry_run=false` | `integration_contract` (non_additive) |
| `ratify_proposal`/`reject_proposal` | ganan `operator_token: str | None = None` (verificado contra `OPERATOR_RATIFY_TOKEN` **siempre**, ver §6); `idempotency_key` opcional ⇒ `request_id = f"ratify:{proposal_id}"`/`f"reject:{proposal_id}"` (idempotencia natural por proposal) | `integration_contract` (non_additive) |
| `preview_write_impact` | `readOnlyHint=true` (es lectura) | metadata |
| `set_context_labels` | nuevo parámetro `mode: add\|replace\|remove` (default `add` = comportamiento actual) | `integration_contract` additive |
| `upsert_context_item` | `item_type` pasa de requerido a **opcional con default `'note'`** (additive); set canónico cerrado por CHECK en `0010` | `integration_contract` (additive de firma; el cierre del set es non_additive) |

### Tools nuevas
| Tool | Plano | Scope | Contrato |
|---|---|---|---|
| `semantic_search(query, corpus='canon', top_k=8, filters?)` | read | `wis.context.read` | **Solo corpus `canon` en v1.** Busca en `context_item_embeddings ⋈ context_items` (mismo scope resolution que el resto de tools read) + fusión **RRF** con el léxico del backend sobre `context_items` (`search_context`). Devuelve hits con score, `item_id`, `snippet` (pasado por el filtro de redacción por contenido, D4.7) y `retrieval_mode: semantic\|lexical_fallback`. El parámetro `corpus` se conserva en la firma con `'canon'` como único valor aceptado; **`corpus='code'` ⇒ `invalid_request`** ("corpus 'code' no habilitado en v1 (índice local privado)"). Cadena de gates read estándar + allowlist propia con `snippet` incluido. |
| `get_project_brief(workspace_id?, project_id?, max_chars=6000)` | read | `wis.context.read` | Ensambla el pod: goals activos + top decisiones + resumen design-system (títulos + primera línea de `content_json` por item, orden `updated_at desc`, presupuesto por sección) + org-plan vigente + últimos `agent.session_summary` por consumer + validación/errores recientes. Funciona a nivel proyecto/workspace **sin task** gracias a `0007` (F14). Es **el** punto de entrada de sesión de todos los agentes. |

> **Nota normativa — RAG jamás en el camino canónico (D4.6, F36):** `semantic_search` es **descubrimiento read-only**. La resolución canónica — `get_approved_decisions`, `_require_ratification`, el ensamblado de `get_project_brief` — es **determinista** y **NUNCA** consume resultados semánticos. El anti-patrón "❌ RAG en el camino canónico" de `ADR-deliberative-context-ratification.md` sigue vigente; `semantic_search` no lo viola porque no participa en ninguna decisión de gobernanza. (Este mismo texto se añade como addendum de una línea al ADR deliberativo.)

Todo cambio de superficie actualiza en el mismo PR: `TOOL_SCOPES`, allowlists de `delegated_limited`, `scripts/mcp_validation_payloads.json`, `scripts/smoke_mcp.py` (igualdad de las 23 tools, no subconjunto), `docs/mcp/README.md` y `docs/context/CONTRACT-INVENTORY.md` — regla ya vigente en la gobernanza del repo.

---

## 6. Modelo de seguridad objetivo (reescrito — D1: "loopback-first")

**Contexto.** Esto es un prototipo experimental personal, pero la visión incluye agentes remotos (ChatGPT vía Auth0) y una garantía central: *"ellas deliberan, yo decido"*. Con la config de fábrica actual esa garantía es ficticia: `.env.example:26-27` trae `MCP_AUTH_ENABLED=false` + `MCP_AUTH_BYPASS_LOCAL=true`, el MCP escucha en `0.0.0.0` (`server.py:187`), `_scope_guard` concede TODOS los scopes (incluido `wis.context.ratify`) a cualquier llamante bajo bypass, y `scripts/start_cloudflare_tunnel.sh` tunela ese bus a una URL pública sin preflight. El modelo objetivo **no** es "OAuth para todo ya" (mataría la ergonomía local) ni "es personal, da igual" (la ratificación perdería valor probatorio): es **loopback-first con cuatro planos de perímetros distintos**.

### 6.1 Los cuatro planos y su control

| Plano | Quién | Control real |
|---|---|---|
| **Lectura local** (tools read) | agentes locales | bypass local OK, PERO solo alcanzable desde loopback |
| **Escritura local** (write plane MCP) | agentes locales | ídem; identidad = `consumer` (atribución NO autenticada, ADR-B6) |
| **Ratificación** (`ratify_proposal`/`reject_proposal`) | SOLO el humano | **operator-token dedicado, verificado SIEMPRE, incluso bajo bypass** |
| **Remoto** (túnel / URL pública) | ChatGPT y futuros | auth runtime OBLIGATORIO (los scripts de túnel abortan sin él) + grants **read-only** |

### 6.2 Las siete decisiones normativas (amparadas en `ADR-phase0-perimeter-closure.md`)

1. **Bind/publicación loopback por defecto.** El host del MCP deja de ser literal `"0.0.0.0"` (`server.py:187`): nuevo setting **`MCP_BIND_HOST`, default `127.0.0.1`**. En docker-compose el proceso dentro del contenedor bindea `0.0.0.0` (necesario para la red del compose), pero el **perímetro real es la publicación de puertos**: `docker-compose.yml` publica `127.0.0.1:8001:8001` y `127.0.0.1:8002:8002` (no `8002:8002`). Resultado: nada del bus es alcanzable desde la LAN por defecto. El token HTTP de `/internal/*` **NO cubre el write plane MCP** y se documenta así (F23).

2. **Regla de exposición efectiva.** "Exposición" = túnel activo **o** URL pública configurada, no solo `MCP_PUBLIC_BASE_URL`. Tres *enforcement points*:
   - **(a)** el guard de arranque (RuntimeError si `MCP_AUTH_BYPASS_LOCAL=true` **y** `MCP_PUBLIC_BASE_URL` configurado) se ubica en el **arranque del transporte streamable-http**, NO en un validator de `Settings` (para no romper pytest — F10);
   - **(b)** `start_cloudflare_tunnel.sh` y `start_named_cloudflare_tunnel.sh` hacen **preflight y ABORTAN** si el auth runtime no está activo en el contenedor `mcp` (leen el env efectivo vía `docker inspect`; condición de continuación: `MCP_AUTH_ENABLED=true` **y** `MCP_AUTH_BYPASS_LOCAL=false`) — F06;
   - **(c)** el job backend de `phase3-ci.yml:118-119` (bypass=true + public URL) se corrige en el **mismo PR** que introduce el guard, quitando `MCP_PUBLIC_BASE_URL` del env del job (F10); revisar `test_mcp_public_base_url_config.py`.

3. **Remotos read-only en v1.** Política de grants Auth0: los tokens emitidos a clientes remotos llevan como máximo `wis.context.read` + `wis.context.sync.read`. `wis.context.write`, `wis.context.sync.write`, `wis.context.ratify` y `wis.context.code.read` (reservado, D4) **no se conceden a remotos** en v1. Es política de configuración, no de código; se documenta aquí y en el runbook de Auth0 (WP-4.3).

4. **Ratificación atada a operator-token que el bypass NO satisface.** `ratify_proposal` y `reject_proposal` ganan `operator_token: str | None = None`, verificado contra el nuevo setting **`OPERATOR_RATIFY_TOKEN`** **siempre**, también con `MCP_AUTH_BYPASS_LOCAL=true`. Sin token válido ⇒ la tool no ratifica (**fail-closed**; si el setting no está definido, ratify/reject responden que la ratificación no está configurada). El bootstrap dev (`dev_native.py`, `make up`) autogenera el token en `.env` si falta; `dogfood_oracle.py` lo lee de env. **Orden de verificación dentro de la tool:** scope guard → **operator-token** → lookup de proposal. El token NUNCA se persiste en `context_write_audit` ni aparece en respuestas (se excluye del `before_payload` y está cubierto por `SENSITIVE_KEYS`).

5. **`consumer` es atribución NO autenticada** (ADR-B6 enmendado): string autodeclarado para trazabilidad y segmentación del brief, **no** para control de acceso. El control de acceso son los otros tres perímetros (loopback local, scopes de token remoto, operator-token de ratificación).

6. **Origin guard = anti-CSRF de navegador, nada más.** Se implementa default-deny con auth runtime activo (WP-0.5d), pero **no se lista como mitigación de acceso no autenticado**: no autentica nada (permite requests sin cabecera `Origin` por diseño). Es defensa contra CSRF de navegador y nada más (F40).

7. **Superficies de fuga menores.** `GET /mcp/info` (`main.py:18-28`) **pierde el campo `auth_enabled`** (infoleak de postura; siempre, no solo fuera de dev — nadie lo consume; los túneles usan `docker inspect`, no ese endpoint) — F42. La higiene del índice local (`.env`/`.pem` fuera de `includeExtensions`) y los secretos indexados se tratan en D4/§ADR-B2. El **egress de embeddings** (contenido Y queries) es **opt-in explícito**: `EMBEDDINGS_PROVIDER=none` por defecto (§6.6, F41).

### 6.3 Otras propiedades de seguridad (mantenidas)
- **API HTTP interna cerrada:** `/internal/*` y los alias públicos exigen `X-Internal-Token` (secreto local en `.env`); `docs_url=None, redoc_url=None, openapi_url=None` cuando `SYSTEM_MODE != dev`. El cambio es **non_additive** (WP-0.5b, amparado en `ADR-phase0-perimeter-closure.md`); compatibilidad por autogeneración del token en bootstrap dev; fail-closed 503 si el token falta en runtime.
- **`delegated_limited` fail-closed:** tool sin allowlist registrada ⇒ error de configuración en arranque (no pasar el payload entero).
- Ficheros temporales del runner Codex en `mkdtemp` 0700 (no `/tmp` world-readable).

### 6.6 Perímetro del embedder y egress
- El embedder y `vault_sync` corren **dentro del perímetro local** (localhost, sin exposición).
- **Egress opt-in (F41):** `EMBEDDINGS_PROVIDER` tiene default `none` en `.env.example` (opt-in explícito; ollama recomendado en comentario). Si el provider es `openai_compatible`, el **contenido de los chunks Y las queries** (backend y extensión) salen de la máquina — decisión explícita del operador, nunca default. `openai_compatible` exige endpoint `https` salvo `EMBEDDINGS_ALLOW_INSECURE_ENDPOINT=true`. La query embebida client-side de la extensión hereda este aviso de egress.

---

## 7. No-objetivos (v2+, NO construir ahora)
- Co-edición simultánea de la misma tarea por varios agentes (merge de intenciones, CRDT, colas).
- Multi-usuario / multi-tenant (esto es un prototipo personal).
- UI de gestión del pod (el vault + Obsidian ya es la UI humana).
- Orquestación de investigación automática (v1: los agentes investigan y *depositan* hallazgos citados; no hay scheduler propio).
- Re-ranking con LLM en el retrieval (RRF basta para el tamaño de corpus esperado).
- **Corpus `code` por el bus MCP** (reservado v2: exige `wis.context.code.read` propio nunca concedido a remotos, exclusión de portadores de secretos y redacción por contenido; ver ADR-B2). En v1 el corpus `code` es local y solo lo consume el retrieval de Codex.
- **Scope current a nivel workspace** (sin consumidor en v1; la política de workspace se cubre por `policy_state`, no por un scope de workspace; ver ADR-B3/D2).

## 8. Riesgos principales y mitigación
| Riesgo | Mitigación |
|---|---|
| pgvector no disponible (imagen vieja, native stack con pgserver) | DDL de embeddings **condicional** (`0009_rag_canon` y `007_embeddings.sql` chequean `pg_available_extensions`/tipo `vector` y saltan la parte vectorial con aviso, no corrompen la cadena); `semantic_search` degrada a léxico con `retrieval_mode: lexical_fallback` explícito; `make native` completa la cadena en modo degradado; doctor de la extensión reporta "pgvector ausente: modo degradado léxico". |
| El worker de embeddings se queda atrás (chunks `pending` acumulados) | métrica en `get_sync_status` + check en `make health`; el retrieval funciona igual (léxico) mientras tanto; la definición normativa de `pending` (§4) garantiza convergencia (re-run sin cambios ⇒ 0 re-embeddings). |
| El worker crashea si falta `local_private` (arnés backend, sin extensión) | el worker **omite el corpus `code` con log claro** y sigue procesando `canon` (F25). |
| Drift docs↔código (recurrente en este repo) | cada WP incluye la actualización de contrato/docs en su definición de hecho; `smoke_mcp.py` valida **igualdad** del set de 23 tools; `CONTRACT-INVENTORY.md` + `docs/mcp/README.md` son la verdad viva (CAPABILITIES.md queda como snapshot histórico). |
| Dependencia de atributos privados del SDK MCP (`_tool_manager`, `request_handlers`) | ya existe; congelar versión `mcp==1.28.0` y anotar el riesgo; migrar a API pública cuando el SDK la ofrezca. La extracción a `run_governed_write` (WP-0.8) no reduce esta dependencia (el `_scope_guard` sigue en la tool, atado al transporte), pero la aísla en un único punto. |
| Perímetro abierto por descuido (bypass expuesto a internet) | loopback-first (bind/publicación `127.0.0.1`), guard de arranque del transporte, preflight de túneles con **abort**, operator-token verificado siempre (§6, `ADR-phase0-perimeter-closure.md`). |
