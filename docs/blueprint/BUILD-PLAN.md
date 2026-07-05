# Plan de Construcción — Shared Dev Context Layer v2

> **Autor:** Fable 5 (ingeniero) · **Ejecutor:** Opus 4.8 (constructor) · **Fecha:** 2026-07-04
> **Versión:** v2.1 — incorpora `REVISION-DIRECTIVE.md` (respuesta a los 49 hallazgos del panel). Donde este plan y la directiva discrepen, **manda la directiva**; este documento ya está reescrito para reflejarla (WP-R0 aplicado).
> Complementa `docs/blueprint/ARCHITECTURE.md` (estado objetivo) y `docs/CAPABILITIES.md` (snapshot histórico de auditoría, ver Definición de Hecho).

## 0. Reglas de ejecución para el constructor

1. **Orden**: la Fase 0 es bloqueante y **secuencial** (`0.1 → 0.4 → 0.8 → 0.2 → 0.3 → 0.6 → 0.7`, con `0.5` paralelizable a partir de `0.1`). Después: Fase 1 y Fase 2 pueden ir en paralelo; Fase 3 requiere 1+2; Fase 4 requiere 3; **Fase 5 requiere 3** (WP-5.1 necesita `item_type` + política por categoría de WP-3.1); Fase 6 va al final.

   **1-bis (serialización de WPs con migración).** Los WP que crean migraciones backend (WP-0.1, WP-1.1, WP-2.1, WP-3.1) se **serializan entre sí aunque sus fases sean paralelas**; el que aterrice segundo rebasea su `down_revision` al head nuevo. `alembic heads` debe devolver **exactamente 1 head en todo momento** (con 2 heads, `alembic upgrade head` de `run_contract_closure.sh` falla — eso es el enforcement).

2. **Un WP = una rama = un PR**, siguiendo `docs/context/PR-AND-BRANCH-CHECKLIST.md` y la gobernanza contractual del repo (`docs/context/CONTRACT-GOVERNANCE.md`): todo PR declara `contract_class` e impacto (`additive`/`non_additive`), y actualiza `docs/context/CONTRACT-INVENTORY.md` si toca contrato.

   **2-bis (plantilla obligatoria de cuerpo de PR).** Todo cuerpo de PR incluye el bloque siguiente; sus 4 primeros campos son los que `scripts/validate_pr_governance.sh:115-129` extrae y valida machine-readable:

   ```
   ## Gobernanza
   contract_class: <internal_only|persisted_contract|integration_contract|ui_facing_contract|n/a>
   local_private_level: <green|yellow|red|n/a>
   composition_impact: <none|low|medium|high>
   decomposition_required: <yes|no>

   - Tipo de cambio: <additive|non_additive>
   - ADR/addendum: <ruta o n/a>
   - CONTRACT-INVENTORY actualizado: <sí|n/a — solo válido si contract_class = n/a>
   - Mini-suite ejecutada: <comandos y resultado>
   ```

   Reglas normativas de la plantilla:
   - **"docs" NO es un valor del enum.** Los WP documentales (WP-0.7, WP-4.1, WP-4.3, WP-5.2, WP-R0) declaran `contract_class: n/a`, `local_private_level: n/a`.
   - **`contract_class != n/a` ⇒ actualizar `CONTRACT-INVENTORY.md` en el MISMO PR, también cuando la clase sea `internal_only`** (el gate lo exige: `validate_pr_governance.sh:152-174`). Afecta explícitamente a WP-0.4, WP-0.8, WP-1.2, WP-1.3 y WP-2.2, que antes se saltaban el inventario.
   - Todo PR que toque `vscode-extension/src/local/**`, `vscode-extension/migrations/local_private/` o las superficies críticas de CONTRACT-GOVERNANCE §5 (`src/local/ports.ts`, `src/local/types.ts`, …) declara `local_private_level` ≥ `yellow`. **WP-2.4 toca `ports.ts` y `migrations/local_private/` ⇒ `yellow` + addendum ADR obligatorio** (LOCAL_PRIVATE-EVOLUTION-POLICY §2).

   **Tabla de clasificación por WP** (valores que se copian literalmente al PR):

   | WP | contract_class | local_private_level | Notas |
   |---|---|---|---|
   | 0.1 | integration_contract + persisted_contract | n/a | additive; compat de filas dry_run históricas declarada |
   | 0.2 | integration_contract | n/a | **non_additive** (default dry_run + operator-token); 5 pasos; ADRs: deliberativo (addendum) + perimeter-closure |
   | 0.3 | integration_contract | n/a | additive (`results`) |
   | 0.4 | internal_only | n/a | inventario igualmente (regla 2-bis) |
   | 0.5 | integration_contract | **yellow** (por (f)/(g): `src/local/**` y `constants.ts`) | **non_additive** en (b); ADR-phase0-perimeter-closure |
   | 0.6 | persisted_contract + integration_contract | n/a | (b) non-nullable→nullable + PolicyStateOut Optional |
   | 0.7 | n/a | n/a | docs |
   | 0.8 | internal_only | n/a | inventario igualmente (regla 2-bis) |
   | 1.1 | persisted_contract | n/a | **non_additive** (D2); ADR-multi-project-scopes |
   | 1.2 | internal_only | n/a | inventario (semántica policy_state) |
   | 1.3 | internal_only | n/a | inventario igualmente |
   | 2.1 | persisted_contract | **yellow** (crea `migrations/local_private/007`) | additive; addendum ADR-B2 (nota pgvector condicional) |
   | 2.2 | internal_only | n/a | inventario: fila mapeo `project_key` "reservado v2" |
   | 2.3 | integration_contract | n/a | additive (nueva tool, solo canon) |
   | 2.4 | integration_contract + ui_facing_contract | **yellow + addendum ADR** (toca `ports.ts`) | denylist + symlink guard |
   | 3.1 | persisted_contract + integration_contract | n/a | **non_additive** (CHECK restrictivo); 5 pasos; hint de extensión en el mismo PR |
   | 3.2 | integration_contract | n/a | additive |
   | 3.3 | integration_contract | n/a | additive |
   | 3.4 | ui_facing_contract | **yellow** (`src/local`) | additive |
   | 3.5 | integration_contract | n/a (gateway en `src/infrastructure/wis/`, fuera de superficie crítica — verificado) | additive |
   | 4.1 | n/a | n/a | docs/integración |
   | 4.2 | persisted_contract | **yellow** (runtime local registra summary) | seed + rename consumer documentado |
   | 4.3 | n/a | n/a | docs |
   | 5.1 | integration_contract | n/a | additive |
   | 5.2 | n/a | n/a | docs |
   | 6.1 | n/a (o internal_only si añade fixtures backend) | n/a | arnés e2e |
   | R0 | n/a | n/a | docs (esta directiva aplicada a los planos) |

3. **Verificación mínima por WP**: `./scripts/run_contract_closure.sh backend` (backend) o `extension`/`local-db` (extensión) en verde, más los criterios de aceptación del WP.
4. **Si el WP toca superficie MCP**: actualizar en el MISMO PR `TOOL_SCOPES`, allowlists `delegated_limited`, `scripts/mcp_validation_payloads.json`, `scripts/smoke_mcp.py`, `docs/mcp/README.md`, `CONTRACT-INVENTORY.md`.
5. **Consultar a Fable** cuando: (a) la spec sea ambigua o contradiga el código real; (b) haga falta un cambio contractual `non_additive` no previsto; (c) una migración pueda perder datos; (d) el SDK MCP rompa los parches sobre atributos privados; (e) el diseño de índices/dimensiones de embeddings no rinda. **Regla 5a: ante cualquier conflicto entre la directiva y el código real no cubierto en ella, consulta a Fable — no improvises.**
6. **No inventar alcance**: lo que no está en un WP no se construye (ver "No-objetivos" en ARCHITECTURE.md §7).

**Convención de evidencia:** las referencias `fichero:línea` de este plan corresponden al commit `0133208`; verifícalas al empezar cada WP (el código puede haberse movido).

---

## Migraciones renumeradas (orden real de ejecución)

**Backend (Alembic; head actual = `0006_deliberative_columns`):**

| Migración | down_revision | Fase / WP dueño | Contenido |
|---|---|---|---|
| `0007_write_plane_fixes` | `0006_deliberative_columns` | F0 / **WP-0.1** (la crea; 0.2, 0.4 y 0.6 la comparten — Fase 0 es secuencial) | (a) data-fix: `UPDATE context_write_audit SET request_id = 'dryrun-' \|\| gen_random_uuid() WHERE dry_run AND request_id NOT LIKE 'dryrun-%'`; (b) índice parcial `ix_context_write_audit_replay ON (workspace_id, tool_name, request_id) WHERE NOT dry_run`; (c) `publish_audit.task_id DROP NOT NULL` + columnas `workspace_id`/`project_id` nullable + FK + índices (backfill NULL best-effort); (d) `policy_state.approval_mode DROP NOT NULL`. Downgrade: (a) irreversible (no-op documentado); (c) aborta si hay filas con `task_id IS NULL` (documentado). |
| `0008_multi_project_scopes` | `0007_write_plane_fixes` | F1 / WP-1.1 | Drop `uq_context_scopes_single_current`; `CREATE UNIQUE INDEX uq_context_scopes_current_per_project ON context_scopes (workspace_id, project_id) WHERE is_current` (índice **simple**, sin `COALESCE`); `policy_state.workspace_id`/`project_id` nullable + FK + índice. Downgrade **lossy-by-design** (D2.4): colapsa a un único current conservando el de `created_at` más reciente y recrea el índice global. |
| `0009_rag_canon` | `0008_multi_project_scopes` | F2 / WP-2.1 | `CREATE EXTENSION IF NOT EXISTS vector` **condicional** (si `vector` ∉ `pg_available_extensions` ⇒ skip con warning, NO crea las tablas dependientes, deja marcador de modo degradado); tabla `context_item_embeddings (item_id FK ondelete CASCADE, model text, dim int, embedding vector(768), content_hash text, created_at)` + `UNIQUE(item_id, model)` + índice HNSW `vector_cosine_ops`. **Sin nada de `item_type`** (movido a 0010). |
| `0010_item_type_governance` | `0009_rag_canon` | F3 / WP-3.1 | `ALTER TABLE context_items ALTER COLUMN item_type SET DEFAULT 'note'` (**ALTER, no ADD**: la columna existe `NOT NULL` desde 0004); `UPDATE context_items SET item_type='note' WHERE item_type NOT IN ('note','goal','org_plan','design_system','decision','research_finding','risk')`; `ADD CONSTRAINT ck_context_items_item_type CHECK (item_type IN (...)) NOT VALID`; `VALIDATE CONSTRAINT`. |

**Extensión (`migrations/local_private/`, cadena actual 001–006):** `007_embeddings.sql` sin cambios de contenido pero con **guard condicional**: si el tipo `vector` no existe, el script falla con mensaje accionable (el runner de migraciones de la extensión lo reporta como "pgvector ausente: modo degradado léxico", no como corrupción). Alternativa admitida: dividir en `007a` (status transitions, siempre) y `007b` (tabla vector, condicional). Opus elige la mecánica; el requisito es: **BD sin pgvector sigue migrando el resto de la cadena y el doctor lo reporta**.

> **Nota de renumeración:** toda referencia a la numeración vieja (`0007_multi_project_scopes`, `0008_rag_canon`, un `0009` de `item_type`) queda **eliminada**. El reparto real es F0⇒0007, F1⇒0008, F2⇒0009, F3⇒0010, cada uno con su `down_revision` encadenado.

---

## FASE 0 — Cimientos correctos (bloqueante, secuencial)

Orden de ejecución: `WP-0.1 → WP-0.4 → WP-0.8 → WP-0.2 → WP-0.3 → WP-0.6 → WP-0.7`. `WP-0.5` (perímetro) es **paralelo** a partir de WP-0.1.

### WP-0.1 — El replay idempotente no debe quemar keys en dry_run
- **Problema:** un `dry_run=true` con `idempotency_key` registra audit con ese `request_id`; el commit posterior con la misma key devuelve el replay del dry_run y NO muta (`_existing_replay_payload`, `backend/app/mcp/server.py:1138-1187`; `get_existing_request_audit` no distingue `dry_run`). Además `record_publish_audit` (`server.py:487`) crashea si el scope no resuelve task (`task=None`), lo que impide auditar ratificaciones a nivel proyecto/workspace.
- **Cambio:** (a) **crea la migración `0007_write_plane_fixes`** con TODO su contenido (§ Migraciones: data-fix de `request_id`, índice parcial de replay, `publish_audit.task_id DROP NOT NULL` + `workspace_id`/`project_id` nullable+FK+índices, `policy_state.approval_mode DROP NOT NULL`). Se incluyen aquí los puntos de F14 y de F35-1 aunque "pertenezcan" a WP-0.6/WP-0.8: **una sola migración de Fase 0**. (b) en dry_run, usar SIEMPRE `request_id` sintético `dryrun-<uuid4>` aunque llegue `idempotency_key`; (c) el lookup de replay filtra `dry_run == false` (solo commits replayean commits). Documentar en la descripción de las tools.
- **Ficheros:** `backend/alembic/versions/0007_write_plane_fixes.py`, `backend/app/mcp/server.py`, `backend/app/audit/write_audit_service.py`.
- **Aceptación:** test nuevo `test_idempotency_dry_run_does_not_burn_key`: dry_run con key K → commit con K ⇒ ejecuta commit real (`result='applied'`, `idempotent_replay=false`); segundo commit con K ⇒ replay. Test adicional sobre BD donde un dry_run histórico quemó la key K (insertar fila audit dry_run con K) ⇒ commit con K aplica sin `IntegrityError`.
- **Contrato:** `integration_contract` **+ `persisted_contract`**, additive. Línea de compatibilidad: "las filas dry_run históricas quedan excluidas del replay por el filtro `dry_run==false`; sus `request_id` reales se liberan con el data-fix de 0007". Inventario en el mismo PR.

### WP-0.4 — Atomicidad dominio+auditoría
- **Problema:** `context_item_service` comitea internamente (`context_item_service.py:242,279,324,348,405,425,470` — la lista es informativa, el criterio es "todos") y la auditoría comitea aparte ⇒ ventana de mutación sin audit. `create_event_for_task` y `record_write_audit`/`record_publish_audit` comitean por su cuenta.
- **Cambio:** eliminar **TODOS** los `db.commit()`/`db.refresh()` de `backend/app/services/context_item_service.py`; los servicios usan `flush()`. `event_service.create_event_for_task` pasa a `flush()` y `POST /internal/events` (`backend/app/api/internal.py:54`) añade `db.commit()` explícito (F02). `record_write_audit` (`write_audit_service.py:68`) deja de comitear (el commit único vive en el pipeline de WP-0.8). `record_publish_audit` gana `commit: bool = True`: el pipeline de escritura pasa `commit=False`, el camino de lectura (`_apply_policy_and_audit`) conserva su commit (F15).
- **Ficheros:** `backend/app/services/context_item_service.py`, `backend/app/services/event_service.py`, `backend/app/api/internal.py`, `backend/app/audit/write_audit_service.py`.
- **Aceptación:** tests existentes verdes; test de inyección de fallo entre dominio y audit ⇒ rollback total; `grep -rn "db.commit()" backend/app/services/` ⇒ **0 resultados** (la capa de auditoría vive en `backend/app/audit/`, fuera de `services/`); test `get_active_task` deja fila en `publish_audit`.
- **Contrato:** `internal_only` **+ inventario** (regla 2-bis). **Prerrequisito de WP-0.8 y WP-0.3.**

### WP-0.8 — Pipeline gobernado de escritura (`run_governed_write`)   ← NUEVO
- **Problema:** la cadena de gates vive inline en cada tool de escritura (`server.py:1138-1187` y cuerpos); `vault_sync` (WP-3.3) y el despachador del batch (WP-0.3) la necesitan **invocable fuera de una tool MCP** (F26); el guard task-nullable de F14 debe vivir en UN sitio.
- **Cambio:** nuevo `backend/app/mcp/governed_write.py` con la **función** (no decorador) `run_governed_write(db, *, tool_name, resolved: ResolvedScope, dry_run, idempotency_key, ratification: RatificationSpec | None, apply_fn: Callable[[Session], WriteResult], actor_context, response_builder) -> dict` que encapsula, en orden:
  1. `_ensure_idempotency_key`
  2. cálculo de `request_id` (`idempotency_key` o `dryrun-<uuid4>`)
  3. replay (`_existing_replay_payload`, ya filtrado `dry_run==false` tras WP-0.1)
  4. `_require_ratification` (si `ratification` no es `None`)
  5. `apply_fn` (solo `flush`, tras WP-0.4)
  6. `record_write_audit` + `record_publish_audit(task_id=resolved.task.id if resolved.task else None, commit=False)`
  7. **commit único**
  8. `apply_delegated_limited_policy`

  El `_scope_guard` **queda en la tool** (depende del transporte). Las 6 write tools + `apply_sync_batch` se reescriben sobre la función. El azúcar `@governed_tool` de ARCHITECTURE §3.1 queda como wrapper **opcional** sobre la función; si no hace falta, no se construye.
- **Ficheros:** `backend/app/mcp/governed_write.py` (nuevo), `backend/app/mcp/server.py`.
- **Aceptación:** (a) las 6 tools de escritura existentes + `apply_sync_batch` enrutadas por `run_governed_write` con los tests existentes verdes **sin cambios de comportamiento observable**; (b) `grep` de `_ensure_idempotency_key\|_existing_replay_payload` en cuerpos de tools ⇒ solo vía pipeline; (c) test unitario del pipeline con `apply_fn` fake: orden de gates, replay corta antes de aplicar, fallo en `apply_fn` ⇒ rollback total sin fila de audit; (d) test F14: ratify/write en scope sin task ⇒ auditoría sin crash.
- **Contrato:** `internal_only` **+ fila en inventario**. **Requiere WP-0.4. Prerrequisito de WP-0.2 y WP-0.3.**

### WP-0.2 — El plano deliberativo pasa por los gates estándar
- **Problema:** `propose_change`/`ratify_proposal`/`reject_proposal`/`list_proposals` no pasan por idempotencia, `context_write_audit`, `publish_audit` ni `delegated_limited`; `readOnlyHint` mal derivado; `propose_change` con `dry_run` default `False`; `_is_write_tool` heurístico (`server.py:96-97`, `2134-2417`). Además la ratificación es hoy alcanzable por cualquier llamante bajo bypass local, vaciando la garantía "ellas deliberan, yo decido".
- **Cambio:**
  - **(a)** reemplazar `_is_write_tool` por el set **literal** `WRITE_TOOL_NAMES = {upsert_context_item, append_context_event, link_context_entities, set_context_labels, archive_context_item, apply_sync_batch, propose_change, ratify_proposal, reject_proposal}` — **9 tools**; `preview_write_impact` y `list_proposals` quedan **read-only** (F30/F43).
  - **(b)** las tools deliberativas adoptan `run_governed_write` (requiere WP-0.8) y reciben allowlist en `backend/app/policies/delegated_limited.py`. Idempotencia: `propose_change` **exige `idempotency_key` cuando `dry_run=false`** (regla estándar); `ratify_proposal`/`reject_proposal` la llevan **OPCIONAL** — si falta, `request_id = f"ratify:{proposal_id}"` / `f"reject:{proposal_id}"` (idempotencia natural por proposal; segundo ratify de la misma proposal ⇒ replay). Solo se registra audit en desenlaces terminales (applied/dry_run), no en errores de validación. Precedencia de replay: `context_write_audit` responde primero; el dedupe de `proposal_service.py:55-66` se **conserva como defensa documentada inalcanzable** (F31).
  - **(c)** `propose_change` pasa a `dry_run: bool = True` — **non_additive pleno, 5 pasos** (F04): addendum al `ADR-deliberative-context-ratification.md`; `scripts/dogfood_oracle.py:78-97` actualizado en el MISMO PR (pasa `dry_run: false` + `idempotency_key` explícitos y usa `OPERATOR_RATIFY_TOKEN`); `scripts/mcp_validation_payloads.json` actualizado (propose ya lleva `dry_run: true`; ratify/reject ganan `operator_token` inyectado desde env por `validate_remote_mcp.sh`); fila en inventario con justificación.
  - **(e) operator-token (D1.4):** `ratify_proposal` y `reject_proposal` ganan `operator_token: str | None = None`, verificado contra el nuevo setting `OPERATOR_RATIFY_TOKEN` **siempre, incluso bajo `MCP_AUTH_BYPASS_LOCAL=true`**. Sin token válido ⇒ la tool no ratifica (fail-closed; si el setting no está definido, ratify/reject responden que la ratificación no está configurada). Orden dentro de la tool: `_scope_guard` → **operator-token** → lookup de proposal. El token **nunca** se persiste en `context_write_audit`, se excluye del `before_payload` y está cubierto por `SENSITIVE_KEYS`. El bootstrap dev (`dev_native.py`, `make up`) autogenera el token en `.env` si falta.
- **Ficheros:** `backend/app/mcp/server.py`, `backend/app/policies/delegated_limited.py` (ruta corregida, F48), `backend/app/core/settings.py`, `scripts/dogfood_oracle.py`, `scripts/mcp_validation_payloads.json`, `scripts/validate_remote_mcp.sh`.
- **Aceptación:** tests: `ratify_proposal` deja fila en `context_write_audit` y `publish_audit`; metadata `readOnlyHint` correcta para las 21 tools; propose respeta `dry_run=true` por defecto; **ratify sin token ⇒ rechazado incluso con bypass activo**; ratify con token ⇒ ok; doble ratify de la misma proposal ⇒ replay.
- **Contrato:** `integration_contract`, **non_additive** (default `dry_run` + operator-token); 5 pasos; ADRs: deliberativo (addendum) + `ADR-phase0-perimeter-closure.md`. Inventario en el mismo PR.

### WP-0.3 — `apply_sync_batch` aplica de verdad
- **Problema:** en commit solo persiste la fila de batch; nunca despacha `operations` (`server.py:1775-1813`).
- **Cambio:** despachador transaccional que enruta **cada operación vía `run_governed_write`**: cada elemento `{operation, payload}` con `operation ∈ {upsert_context_item, append_context_event, link_context_entities, set_context_labels, archive_context_item}` invoca el pipeline con `_require_ratification` usando el `item_type` del payload de cada upsert, **en una única transacción** (all-or-nothing). Respuesta añade `results: [{index, operation, result, subject_id?}]`; operación desconocida ⇒ `invalid_request` sin ejecutar nada. Cualquier gate dispara (p. ej. un upsert de `goal` bajo política ratify) ⇒ respuesta `ratification_required` y **rollback total del batch** (F03). `'results'` añadido a `TOOL_ALLOWLISTS['apply_sync_batch']` (`backend/app/policies/delegated_limited.py:127-139`) en el mismo PR (F33).
- **Ficheros:** `backend/app/mcp/server.py`, `backend/app/policies/delegated_limited.py`.
- **Aceptación:** test batch mixto en dry_run (0 mutaciones de dominio) y commit (todas); test de rollback: si la op 3 falla, las ops 1-2 no persisten; test nuevo: batch con op upsert de `goal` bajo política ratify ⇒ `ratification_required` + 0 mutaciones.
- **Contrato:** `integration_contract` (cumple contrato anunciado; `results` es additive). **Requiere WP-0.4 y WP-0.8.**

### WP-0.5 — Seguridad del perímetro   (paralelo a partir de WP-0.1)
- **Problema:** con la config de fábrica el MCP escucha en `0.0.0.0` (`server.py:187`), `_scope_guard` concede todos los scopes a cualquier llamante y los scripts de túnel tunelan el bus sin preflight; el guard planeado no dispara por esa vía. Modelo objetivo (D1): "loopback-first; exposición ⇒ auth runtime; ratificación ⇒ operator-token; remotos = read-only".
- **Cambio** (subpuntos (a)–(h)):
  - **(a)** bind/publicación loopback: nuevo setting `MCP_BIND_HOST` **default `127.0.0.1`** (`server.py:187`); `docker-compose.yml` publica `127.0.0.1:8001:8001` y `127.0.0.1:8002:8002` (el proceso dentro del contenedor bindea `0.0.0.0`; el perímetro real es la publicación de puertos). Doc explícita: "el token HTTP de `/internal/*` NO cubre el write plane MCP" (F23).
  - **(b)** `/internal/*` y alias públicos exigen header `X-Internal-Token == INTERNAL_API_TOKEN` (nuevo setting; si no está definido, 503 "not configured" — fail-closed). **non_additive**, amparado en `ADR-phase0-perimeter-closure.md`; compatibilidad: autogeneración del token en `dev_native.py` y `make up` si falta en `.env`; inventariar y parchear los consumidores actuales (`grep -rn "active-task\|/internal/" scripts/ Makefile integration/`) en el mismo PR (F21).
  - **(c)** guard `RuntimeError` si `MCP_AUTH_BYPASS_LOCAL=true` y `MCP_PUBLIC_BASE_URL` configurado, ubicado en el **arranque del transporte streamable-http** (NO en un validator de `Settings`, para no romper pytest). `phase3-ci.yml` corregido en el MISMO PR (quitar `MCP_PUBLIC_BASE_URL` del job backend, líneas 118-119); revisar `test_mcp_public_base_url_config.py` (F10).
  - **(d)** Origin guard default-deny con auth runtime activo, documentado como **anti-CSRF de navegador únicamente** (no autentica; permite requests sin cabecera Origin por diseño). Sale de la lista de mitigaciones de acceso no autenticado (F40).
  - **(e)** preflight de túneles: `start_cloudflare_tunnel.sh` y `start_named_cloudflare_tunnel.sh` leen el env efectivo del contenedor `mcp` vía `docker inspect` y **ABORTAN** si `MCP_AUTH_ENABLED != true` o `MCP_AUTH_BYPASS_LOCAL != false` (F06).
  - **(f)** `delegated_limited` fail-closed: tool publicada sin allowlist ⇒ error en arranque (test de completitud de allowlists); `codexCliRunner` usa `mkdtemp` 0700 (`vscode-extension/src/local/codexCliRunner.ts:74`).
  - **(g)** `.env` y `.pem` fuera de `includeExtensions` (`vscode-extension/src/constants.ts:56`) — aunque el índice sea local, sus chunks entran en prompts hacia Codex (D4.4/F08).
  - **(h)** `GET /mcp/info` (`main.py:18-28`) pierde el campo `auth_enabled` (siempre, no solo fuera de dev; nadie lo consume, los túneles usan `docker inspect`) (F42).
  - FastAPI con `docs_url=None, redoc_url=None, openapi_url=None` salvo modo dev (se mantiene).
- **Ficheros:** `backend/app/mcp/server.py`, `backend/app/main.py`, `backend/app/api/internal.py`, `backend/app/core/settings.py`, `scripts/start_cloudflare_tunnel.sh`, `scripts/start_named_cloudflare_tunnel.sh`, `scripts/dev_native.py`, `docker-compose.yml`, `.github/workflows/phase3-ci.yml`, `vscode-extension/src/constants.ts`, `vscode-extension/src/local/codexCliRunner.ts`.
- **Aceptación:** tests por cada guard; `.env.example` documenta `INTERNAL_API_TOKEN`, `MCP_BIND_HOST` y `OPERATOR_RATIFY_TOKEN`; test de completitud de allowlists; verificación de que ambos scripts de túnel abortan con bypass activo.
- **Contrato:** `integration_contract`, `local_private_level: yellow` (por (f)/(g)); **non_additive** en (b), amparado en `ADR-phase0-perimeter-closure.md` (que cubre 0.5b, 0.5c, 0.5d, túneles y operator-token).

### WP-0.6 — Higiene de eventos y esquema
- **Cambio:**
  - **(a)** `event_service.create_event_for_task` deja de duplicar metadata en `payload_json` (`event_service.py:35-36`): `payload_json` = payload real, `metadata_json` = metadata; `deliberation_service` rellena ambos coherentemente; lectores toleran ambos formatos históricos.
  - **(b)** `policy_state.approval_mode` se vuelve **nullable** (vía la migración `0007` ya creada en WP-0.1) y deja de escribirse en seeds; `PolicyStateOut.approval_mode → Optional[str]` en el MISMO PR (F20/F35).
  - **(c)** borrar imports muertos de `server.py`.
  - **(d)** `set_context_labels` gana `mode: add|replace|remove` (default `add`).
  - **(e)** `append_context_event` pasa `resolved.consumer.id` en `EventCreate.consumer_id` (`schemas/event.py:22` ya tiene el campo) y `create_event_for_task` lo mapea al `Event`; `propose_change` pasa `proposer_consumer_id=resolved.consumer.id if resolved.consumer else None` a `create_proposal` (`proposal_service.py:45` ya lo acepta) (F17).
- **Ficheros:** `backend/app/services/event_service.py`, `backend/app/services/deliberation_service.py`, `backend/app/schemas/policy.py`, `backend/app/mcp/server.py`, `backend/app/services/proposal_service.py`.
- **Aceptación:** tests de eventos con `payload≠metadata`; test de `mode=replace/remove`; **dos consumers distintos ⇒ eventos con `consumer_id` distintos**; proposal registra proposer.
- **Contrato:** `persisted_contract` + `integration_contract` additive ((b) non-nullable→nullable + PolicyStateOut Optional). Inventario en el mismo PR.

### WP-0.7 — Sincronizar el contrato visible
- **Cambio:** `smoke_mcp.py` valida **igualdad** del set de tools contra `TOOL_SCOPES` (no subconjunto); actualizar `integration/README.md`, `integration/VERIFICATION.md`, `docs/mcp/README.md` (superficie actual de tools, reflejando también **el operator-token y los defaults nuevos** — `propose_change dry_run=true`), `CONTRACT-INVENTORY.md`; añadir a `TECHNICAL-DEBT-REGISTER.md` los ítems abiertos que este plan no cubre.
- **Aceptación:** `make smoke` verde contra stack levantado; `./scripts/run_contract_closure.sh docs` verde.
- **Contrato:** `n/a` (docs). **La "regeneración de CAPABILITIES.md" NO es criterio de este WP ni de la DoD** (ver Definición de Hecho).

---

## FASE 1 — Multi-proyecto real

### WP-1.1 — Migración `0008_multi_project_scopes` (scopes current por proyecto)
- **Problema:** `uq_context_scopes_single_current` (`0003_multi_scope_read_model.py:121-127`) obliga a **una sola fila `is_current` en toda la BD**, no una por proyecto; eliminarlo cambia la semántica del dato persistido (D2). Los lectores del invariante viejo resuelven el scope current globalmente.
- **Cambio:** **non_additive pleno (5 pasos de CONTRACT-GOVERNANCE §3)**. Paso 1 satisfecho promoviendo ADR-B3 a ADR formal del repo: `docs/context/adr/ADR-multi-project-scopes.md` (motivo, riesgo, transición, estrategia de downgrade).
  - Migración `0008_multi_project_scopes` (down_revision `0007_write_plane_fixes`): drop de `uq_context_scopes_single_current`; `CREATE UNIQUE INDEX uq_context_scopes_current_per_project ON context_scopes (workspace_id, project_id) WHERE is_current` — índice **simple, sin `COALESCE`** (`project_id` sigue `NOT NULL`; F29); `policy_state.workspace_id`/`project_id` nullable + FK + índice. Downgrade **lossy-by-design** (D2.4): `UPDATE context_scopes SET is_current=false WHERE is_current AND id <> (SELECT id FROM context_scopes WHERE is_current ORDER BY created_at DESC LIMIT 1)` y después recrea el índice global; documentado en docstring y ADR.
  - **4 lectores scope-aware en el MISMO PR** (D2.3):
    - `task_service.get_active_task` (`task_service.py:10-20`): gana `project_id: UUID | None = None`; con él filtra el current de ese proyecto; sin él, orden `created_at desc` documentado como "último proyecto enfocado".
    - `task_service.require_active_task` (`task_service.py:47-51`): propaga el parámetro opcional.
    - `focus_resolver.resolve_scope` y fallback `canonical_scope` (`focus_resolver.py:175` y `:317`): con `project_id` filtran por proyecto; sin él, "último enfocado".
    - `GET /active-task` y `GET /internal/tasks/active`: query param opcional `project_id`; `POST /internal/events` hereda vía `require_active_task`.
- **Ficheros:** `backend/alembic/versions/0008_multi_project_scopes.py`, `backend/app/services/task_service.py`, `backend/app/services/focus_resolver.py`, `backend/app/api/internal.py`, alias público de `/active-task`, `docs/context/adr/ADR-multi-project-scopes.md`.
- **Aceptación:** upgrade+downgrade sobre BD sembrada; test "dos proyectos con current simultáneo"; test de **resolución**: con currents en P1 y P2, `get_active_task(project_id=P1)` devuelve la task de P1 y `GET /active-task?project_id=P2` la de P2; test de downgrade sobre BD con 2 currents (colapso al más reciente).
- **Contrato:** `persisted_contract` **non_additive**; ADR-multi-project-scopes.

### WP-1.2 — Resolución de política por scope
- **Cambio:** `policy_service.get_active_policy(db, workspace_id?, project_id?)` con precedencia `project > workspace > global (NULL,NULL)`; `approval_policy_service` y `_require_ratification` reciben el scope resuelto; `focus_resolver` expone el scope al lookup de política. (Las columnas de `policy_state` viven ya en `0008`/WP-1.1.)
- **Aceptación:** tests de precedencia (3 niveles); política global intacta como fallback.
- **Contrato:** `internal_only` + entrada en inventario (semántica de policy_state).

### WP-1.3 — `focus_resolver` por tabla de estrategias + seeds inocuos
- **Cambio:** refactor de `resolve_scope` (~277 líneas, `focus_resolver.py:78-354`) a tabla de estrategias (mismo comportamiento observable — los tests existentes son el arnés); `seed_erp_v2.py` y `seed_v1/v5` dejan de tocar estado global de otros workspaces (nada de `update(Task).values(is_active=False)` global, `seed_erp_v2.py:77,137`: se acotan al workspace propio).
- **Aceptación:** `test_focus_resolver` verde sin cambios; test: sembrar workspace B no desactiva tareas de A.
- **Contrato:** `internal_only` + inventario.

---

## FASE 2 — RAG semántico

### WP-2.1 — Infra pgvector
- **Cambio:** imágenes de servicio de `phase3-ci.yml:57,99` a `pgvector/pgvector:pg16` en el MISMO PR; compose a `pgvector/pgvector:pg16`; migración backend `0009_rag_canon` (DDL **condicional**, § Migraciones) y de extensión `007_embeddings.sql` (con **guard condicional**, § Migraciones); `dev_native.py` detecta ausencia de la extensión `vector` y lo reporta (modo degradado léxico).
- **Aceptación:** `make up` desde volumen existente migra sin pérdida; `SELECT * FROM pg_extension WHERE extname='vector'`; **CI verde con la imagen nueva**; **`make native` completa la cadena de migraciones en modo degradado** (sin pgvector no rompe).
- **Contrato:** `persisted_contract` additive; `local_private_level: yellow` (crea `migrations/local_private/007`); addendum a ADR-B2 (nota de pgvector condicional).

### WP-2.2 — Worker de embeddings
- **Cambio:** `backend/app/rag/{providers.py,embedding_worker.py}`: settings `EMBEDDINGS_PROVIDER (none|ollama|openai_compatible)`, `EMBEDDINGS_ENDPOINT`, `EMBEDDINGS_MODEL` (default `nomic-embed-text`), `EMBEDDINGS_DIM` (768). Loop: lee `pending`/`stale` en lotes de 32, embebe, upsert en `*_embeddings`, marca `embedded`. Errores del provider ⇒ retry con backoff, nunca crash-loop. Entradas: `python -m app.rag.embedding_worker [--once]`, target `make embed`, servicio opcional en compose (`profiles: ["rag"]`).
  - **Definición normativa de `pending(canon)` (D4.5):** `context_items` NO tiene `embedding_status`; el estado vive en la tabla de embeddings. `pending(item) := NOT EXISTS (SELECT 1 FROM context_item_embeddings e WHERE e.item_id = ci.id AND e.model = :model AND e.content_hash = :hash_actual)`, con `hash_actual = sha256(canonical_json({"title": ci.title, "content_json": ci.content_json, "labels_json": ci.labels_json}))` (`sort_keys=True, ensure_ascii=False, separators=(",",":")`, misma convención que `stable_hash` de `write_audit_service.py`). Ítems con `status != 'active'` (archivados) se excluyen de pending y de resultados.
  - El worker **SÍ procesa ambos corpus** (ADR-B2). Si el esquema `local_private` no existe (arnés backend, instalaciones sin extensión), **omite el corpus `code` con un log claro, sin crash** (F25). No mapea scopes: procesa chunks globalmente.
  - Default **`EMBEDDINGS_PROVIDER=none`** en `.env.example` (opt-in explícito; ollama recomendado en comentario); `openai_compatible` **exige endpoint `https`** salvo flag `EMBEDDINGS_ALLOW_INSECURE_ENDPOINT=true`; validación `EMBEDDINGS_DIM==768` al arranque con error claro (F47).
  - **Mapeo scope↔local_private (reservado v2):** regla = igualdad de `project_key` (`backend.projects.project_key == local_private.projects.project_key`). Fila `integration_contract` en CONTRACT-INVENTORY con estado "reservado, sin consumidor en v1" (F16).
- **Aceptación:** fixture inserta N `context_items` → `--once` ⇒ **N embeddings y 0 pending**; re-run sin cambios ⇒ **0 re-embeddings**; provider `none` ⇒ no-op explícito con log (test del default); BD sin `local_private` ⇒ corre sin error.
- **Contrato:** `internal_only` + config documentada en `.env.example` + fila de inventario (mapeo project_key).

### WP-2.3 — Tool `semantic_search` (bus) — **solo corpus `canon` en v1**
- **Problema:** exponer `local_private.file_chunks` por el bus bajo `wis.context.read` era un blocker triple (scope mínimo del transporte regalaba el repo, secretos indexados recuperables, léxico de `file_chunks` inexistente en Python). Decisión D4: el corpus `code` se queda local; el bus expone SOLO `canon`.
- **Cambio:** tool read (`wis.context.read`) con firma `semantic_search(query, corpus='canon', top_k=8, filters?)`:
  - `corpus='canon'` ⇒ embebe la query con el mismo provider, busca por coseno en `context_item_embeddings ⋈ context_items` del scope, **fusión RRF (k=60) solo entre vectorial y el léxico del backend** sobre `context_items` (el `search_context` existente); respuesta con `retrieval_mode: semantic|lexical_fallback`. Sin provider/extensión ⇒ `lexical_fallback` (nunca error).
  - `corpus='code'` ⇒ `invalid_request` con mensaje "corpus 'code' no habilitado en v1 (índice local privado)"; valor **reservado y documentado**.
  - Redacción de contenido en el campo `snippet` (D4.7): filtro de patrones de secretos (`AKIA[0-9A-Z]{16}`, `sk-[A-Za-z0-9]{20,}`, `ghp_[A-Za-z0-9]{36}`, `xox[baprs]-`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`, asignaciones `*_KEY|*_SECRET|*_TOKEN|PASSWORD=`) ⇒ `[REDACTED]`; utilidad reutilizable en `delegated_limited.py`.
  - Nota RAG-no-canónico (D4.6) + addendum al ADR deliberativo (`semantic_search` es descubrimiento read-only; la resolución canónica es determinista y nunca consume resultados semánticos).
  - Cadena de gates read estándar + allowlist propia con `snippet` incluido.
- **Aceptación:** e2e **solo canon** (fixture backend puro, sin `local_private`): hit semántico que el léxico no encuentra; fallback léxico verificado; `corpus='code'` ⇒ `invalid_request`; registry de validación actualizado (WP-0.7 como plantilla).
- **Contrato:** `integration_contract` additive (nueva tool ⇒ inventario + payloads + smoke + docs).

### WP-2.4 — Retrieval híbrido v2 en la extensión (donde el léxico de código SÍ existe)
- **Cambio:** `PersistencePort.searchChunksByEmbedding(embedding, limit)` (pgvector `<=>` coseno) + implementación en `postgresPersistenceAdapter`; `HybridContextRetriever` fusiona léxico+vectorial con RRF antes del scorer/budget actual; la query se embebe llamando al endpoint del provider configurado (nuevo setting espejo en la extensión, que **hereda el aviso de egress** de F41) — si no hay provider, comportamiento actual intacto. Indexador: setting `wisContextSync.localIndex.extraRoots: string[]` (para el vault), con:
  - **denylist de rutas sensibles** (`~/.ssh`, `~/.aws`, `~/.gnupg`, dotfiles de home, `/etc`; **rechazo por defecto** con mensaje) (D1/F22).
  - **invocación real de `assertNoSymlinkEscape`** (`workspaceBoundaryGuard.ts:42`) sobre cada raíz indexada (hoy nunca se llama en producción).
  - `chunkOverlapChars=0` respetado de paso (bug `normalizePositiveNumber`, `vscode-extension/src/config.ts:239`, F48).
- **Aceptación:** tests de fusión RRF (determinista con embeddings fake); matriz sin-provider = comportamiento actual; denylist rechaza `~/.ssh` y símil; symlink de escape rechazado; `chunkOverlapChars=0` respetado.
- **Contrato:** `integration_contract` (puerto) + `ui_facing_contract` additive (settings nuevos); **`local_private_level: yellow` + addendum ADR obligatorio** (toca `ports.ts` y `migrations/local_private/`, F19).

---

## FASE 3 — Pod de conocimiento por proyecto

### WP-3.1 — Categorías canónicas + política por categoría (migración `0010`)
- **Problema:** `item_type` existe `NOT NULL` desde `0004` (`0004_phase4_mcp_write_plane.py`); la gobernanza es un **ALTER**, no un ADD COLUMN. El mapeo `category=item_type` en `_require_ratification` YA existe (`server.py:1240`).
- **Cambio:** migración **`0010_item_type_governance`** (down_revision `0009_rag_canon`, contenido en § Migraciones): `SET DEFAULT 'note'` + normalización de valores fuera del set + `CHECK ... NOT VALID` + `VALIDATE`. Set canónico cerrado: `('note','goal','org_plan','design_system','decision','research_finding','risk')` — **`'risk'` entra** como categoría operativa (modo `auto`), evitando remapear filas existentes y manteniendo veraz el hint `note|decision|risk` de la extensión.
  - `upsert_context_item.item_type` pasa de **requerido a opcional con default `'note'`** (cambio de firma declarado, additive).
  - seeds escriben `approval_policy_json` default: `{"default":"auto","by_category":{"goal":"ratify","org_plan":"ratify","design_system":"ratify","decision":"ratify"}}` — **sin resetear** una política ya personalizada (seed idempotente, no destructivo).
  - hint del comando de la extensión (`wisContextSync.upsertContextItem`) actualizado en el MISMO PR con las categorías nuevas.
- **Ficheros:** `backend/alembic/versions/0010_item_type_governance.py`, `backend/app/mcp/server.py`, seeds, `vscode-extension/` (hint del comando).
- **Aceptación:** test: upsert de `goal` sin proposal ratificada ⇒ `ratification_required`; upsert de `research_finding` ⇒ fluye; re-seed no pisa política editada.
- **Contrato:** `persisted_contract` + `integration_contract` **non_additive** (CHECK restrictivo); 5 pasos (addendum al ADR deliberativo: gobernanza por categoría + set cerrado).

### WP-3.2 — Tool `get_project_brief`
- **Cambio:** `project_brief_service.py` ensambla (por scope): goals activos, top-10 decisiones, resumen design-system, org-plan vigente, últimos 5 `agent.session_summary` por consumer, validación y errores recientes; respeta `max_chars` (default 6000) con truncado por sección (prioridad: goals > decisiones > sesiones > resto). Tool read con cadena estándar + allowlist.
  - Extender `seed_v5` con **fixture de pod** (2 goals, 3 decisiones, 2 items `design_system`, 2 session summaries), seed idempotente no destructivo.
  - Definición del **resumen design-system**: títulos + primera línea de `content_json` por item, orden `updated_at desc`, respetando el presupuesto por sección (F49).
- **Aceptación:** snapshot test del brief sobre `seed_v5` enriquecido; truncado determinista; **el brief a nivel proyecto/workspace sin task funciona gracias a `0007`** (F14) — test explícito.
- **Contrato:** `integration_contract` additive (nueva tool ⇒ ritual completo WP-0.7).

### WP-3.3 — `vault_sync` (vault markdown → bus, one-way v1)
- **Cambio:** `backend/app/sync/vault_sync.py` + `make sync-vault VAULT=<dir>`: recorre `pod/**/*.md`, parsea frontmatter (falta `type` ⇒ warning y skip), `item_key = ruta relativa`, `idempotency_key = sha256(contenido)`, upsert **consumiendo `run_governed_write`** (D5.4) — **ni invoca tools MCP en-proceso ni reimplementa la cadena** —, con la misma cadena de gates (incluida ratificación: un cambio de `goals.md` genera Proposal si la política lo exige, reportado como `ratification_required` pendiente, no como error). Estado resumen al final: creados/actualizados/pendientes-de-ratificar/omitidos.
- **Aceptación:** e2e: vault fixture de 6 ficheros ⇒ items correctos; segundo sync sin cambios ⇒ 0 mutaciones (idempotencia por hash); cambio en `design-system/tokens.md` con política ratify ⇒ Proposal `in_review`.
- **Contrato:** `integration_contract` additive (nuevo camino de escritura, documentar en inventario).

### WP-3.5 — `get_project_brief` en el gateway de la extensión   ← NUEVO
- **Problema:** WP-3.4 asume que la extensión puede llamar `get_project_brief` "modo mcp", pero `McpWISGateway` solo soporta las tools read existentes (F27a).
- **Cambio (lista exacta):** (a) método `getProjectBrief(params)` en `McpWISGateway`; (b) entrada en `normalizeToolPayload` (shape del brief, tolerante a campos ausentes); (c) mapeo en `classifyTransportFailure`; (d) escenario en `FixtureWISGateway` (brief completo, brief vacío, transporte caído); (e) setting `wisContextSync.pod.briefEnabled` (default true) con passthrough a config; (f) tests de normalización y de fixture.
- **Ficheros:** `vscode-extension/src/infrastructure/wis/mcpWISGateway.ts`, `vscode-extension/src/infrastructure/wis/fixtureWISGateway.ts`, `vscode-extension/src/infrastructure/wis/wisGateway.ts`, tests.
- **Aceptación:** suite de la extensión verde; `FixtureWISGateway` cubre los 3 escenarios; WP-3.4 consume este método sin tocar el gateway.
- **Contrato:** `integration_contract` additive; `local_private_level: n/a` (el gateway vive en `src/infrastructure/wis/`, **fuera** de las superficies críticas de CONTRACT-GOVERNANCE §5 — verificado). **Entre WP-3.2 y WP-3.4.**

### WP-3.4 — Constraints del pod en el task builder de Codex
- **Cambio:** `ContextAwareTaskBuilder` añade sección `pod_constraints` al `execution_brief` (goals activos + reglas design-system), obtenida vía el método `getProjectBrief` del **gateway de WP-3.5** (modo mcp) o de un fichero `pod/goals.md` local (modo offline) — sin fallback silencioso: el origen se declara en el brief.
- **Aceptación:** test con pod fixture: el prompt de Codex contiene las constraints; sin pod ⇒ brief marca `pod: absent`.
- **Contrato:** `ui_facing_contract` additive (`execution_brief` gana campos); `local_private_level: yellow` (`src/local`). **Requiere WP-3.5.**

---

## FASE 4 — Los cuatro agentes

### WP-4.1 — Claude Code como consumidor de primera clase
- **Cambio:** `integration/claude-code/`: `.mcp.json` plantilla (streamable-http a `localhost:8002/mcp`), fragmento `CLAUDE.md` ("al iniciar sesión llama `get_project_brief`; al cerrar, `append_context_event` con `event_type='agent.session_summary'`, `consumer='claude_code'`"), y script `install-claude-code-mcp.sh` análogo al de Claude Desktop existente.
- **Aceptación:** verificación manual documentada en `integration/VERIFICATION.md` (sesión real: brief cargado, summary registrado, visible en el brief siguiente).
- **Contrato:** `n/a` (docs/integración).

### WP-4.2 — Identidad de agentes + brief cruzado
- **Cambio:**
  - **(a) reconciliación de identidad (F34/F37/F45):** canónico `codex_cli`; el seed idempotente **RENOMBRA** `consumer_type 'codex'→'codex_cli'` (UPDATE preservando UUID y FKs, sin insertar duplicado) si `codex_cli` no existe aún; **inserta los 6 canónicos que falten** (`chatgpt`, `claude_desktop`, `claude_code`, `codex_cli`, `vscode_extension`, `human_operator`); `github_copilot` se conserva con `is_active=false`; mapeo documentado en inventario.
  - **(b) transporte del session_summary:** el runtime local registra `agent.session_summary` al cerrar cada `localRunCodex` vía `McpContextPlaneClient.append_context_event` con `consumer='codex_cli'`, **best-effort** — backend inaccesible ⇒ skip con log, **NUNCA bloquea ni falla el run local**; `get_project_brief` ya los muestra por consumer (WP-3.2).
- **Aceptación:** e2e: run de Codex ⇒ summary visible en brief; dos consumers distintos ⇒ secciones separadas; **test de degradación**: backend caído ⇒ el run local no falla.
- **Contrato:** `persisted_contract` additive (seed); `local_private_level: yellow` (runtime local registra summary).

### WP-4.3 — Claude Desktop y ChatGPT al día
- **Cambio:** actualizar `integration/` (superficie de tools al día, ejemplos con `semantic_search` y `get_project_brief`). **Añade el runbook de grants Auth0 read-only para remotos** (D1.3): los tokens emitidos a clientes remotos llevan como máximo `wis.context.read` + `wis.context.sync.read`; `wis.context.write`, `wis.context.sync.write`, `wis.context.ratify` y `wis.context.code.read` **no se conceden a remotos** en v1. ChatGPT remoto queda **diferido** (requiere `CF_NAMED_TUNNEL_TOKEN` + Auth0; ver backlog fase 4) — se documenta el gap y el scope `wis.context.ratify` pendiente.
- **Contrato:** `n/a` (docs).

---

## FASE 5 — Investigación fundamentada (requiere Fase 3)

### WP-5.1 — `research_finding` con procedencia obligatoria
- **Cambio:** convención + validación: un `context_item` con `item_type='research_finding'` exige en `content_json`: `claim`, `sources: [{url, title, retrieved_at}]` (≥1), `confidence: high|medium|low`; el upsert rechaza findings sin fuentes (`invalid_request`). El embedder los indexa como parte del corpus canon (ya cubierto por WP-2.2).
- **Aceptación:** test de rechazo sin fuentes; finding recuperable vía `semantic_search`.
- **Contrato:** `integration_contract` additive. **Prerrequisito explícito: WP-3.1** (validación por categoría — el set canónico y la política por categoría deben existir).

### WP-5.2 — Flujo de investigación documentado
- **Cambio:** `docs/blueprint/RESEARCH-FLOW.md`: el operador pide investigación a cualquier agente (p. ej. deep-research en Claude Code); el agente deposita findings citados vía `upsert_context_item` (auto, sin ratificar); las **conclusiones** que tocan canon (decisión de arquitectura, cambio de goals) van vía `propose_change` ⇒ ratificación humana. Sin scheduler propio (no-objetivo).
- **Contrato:** `n/a` (docs).

---

## FASE 6 — Arnés end-to-end (al final)

### WP-6.1 — E2E del pod scriptado (dueño de la DoD)   ← NUEVO
- **Problema:** el E2E del pod no tenía dueño; el punto 3 de la Definición de Hecho era manual y no verificable en CI (F28).
- **Cambio:** `scripts/e2e_pod.sh` (o pytest marcado `@pytest.mark.e2e_pod`) que ejecuta contra stack levantado con provider fake/determinista:
  `make up` → seed → `make sync-vault VAULT=fixtures/pod` → `get_project_brief` (contiene goals del vault) → `append_context_event` con `agent.session_summary` (consumer `claude_code`) → segundo `get_project_brief` (contiene el summary) → `upsert_context_item` de `design_system` sin proposal ⇒ `ratification_required` → `propose_change` + `ratify_proposal` (**con operator-token**) ⇒ visible en brief → `semantic_search` encuentra un finding **por sinónimo** (no keyword; fixture con embedding fake que lo garantice).
- **Aceptación:** el script es el criterio 3 (y 4) de la Definición de Hecho; corre en CI como job opcional (`workflow_dispatch`) y en `make e2e-pod`.
- **Contrato:** `n/a` (o `internal_only` si añade fixtures backend). **Última pieza del release.**

---

## WP-R0 — Aplicar la directiva a los planos (PRIMER WP, ya ejecutado en esta v2.1)
- **Cambio:** editar `docs/blueprint/ARCHITECTURE.md` y `docs/blueprint/BUILD-PLAN.md` aplicando TODO el §3.5 y las decisiones D1–D5: tabla de migraciones nueva, modelo de seguridad §6 reescrito (D1), §5 con `semantic_search` solo-canon + nota RAG-no-canónico (D4.6), ADR-B2/ADR-B6 enmendados, §3.1 nombrando `run_governed_write`, grafo y reglas de BUILD-PLAN. Crear los esqueletos de ADR: `docs/context/adr/ADR-phase0-perimeter-closure.md` y `docs/context/adr/ADR-multi-project-scopes.md` (contenido completo al ejecutarse WP-0.5/WP-1.1). Añadir addendum de una línea a `ADR-deliberative-context-ratification.md`.
- **Aceptación:** `./scripts/run_contract_closure.sh docs` verde; ninguna referencia a `0007_multi_project_scopes`/`0008_rag_canon` con la numeración vieja sobrevive en los planos.
- **Contrato:** `n/a` (docs).

---

## Grafo de dependencias

Fase 0 (secuencial, con `0.5` paralelizable a partir de `0.1`):

```
WP-0.1 (dry_run replay + migración 0007)
  → WP-0.4 (atomicidad: services flush, commit único)
    → WP-0.8 (pipeline run_governed_write)          ← NUEVO
      → WP-0.2 (plano deliberativo + operator-token)
        → WP-0.3 (apply_sync_batch real, gate por operación)
          → WP-0.6 (higiene eventos/esquema + consumer_id)
            → WP-0.7 (contrato visible)
WP-0.5 (perímetro) — paralelo a partir de WP-0.1
```

Grafo global (F5 cuelga de F3; F6 al final):

```
F0 (0.1 → 0.4 → 0.8 → 0.2 → 0.3 → 0.6 → 0.7 ; 0.5 ∥)
 ├─► F1 (1.1 → 1.2 → 1.3)          ──┐
 └─► F2 (2.1 → 2.2 → {2.3, 2.4})   ──┤
                                      └─► F3 (3.1 → {3.2, 3.3, 3.5} → 3.4) ─► F4 (4.1 → 4.2 → 4.3)
                                                                  └────────► F5 (5.1 → 5.2)
                                                                              F6 (6.1, al final)
```

## Definición de Hecho global (release `0.3.0-internal`)
1. `./scripts/run_contract_closure.sh all` verde.
2. `make smoke` valida **igualdad** de 23 tools.
3. `make e2e-pod` (WP-6.1) verde — sustituye al E2E manual sin dueño: `make up` → `make sync-vault` → `get_project_brief` devuelve el pod → sesión que lee brief y deposita summary → `upsert` de `design_system` sin ratificar ⇒ `ratification_required` → `propose_change` + `ratify_proposal` (con operator-token) ⇒ visible en brief → `semantic_search` encuentra un finding por significado (no keyword).
4. (Absorbido por el script del punto 3: la ratificación con operator-token está incluida.)
5. **CONTRACT-INVENTORY.md** y **docs/mcp/README.md** actualizados a la superficie final + smoke de igualdad verde. **`docs/CAPABILITIES.md` NO se regenera**: recibe el encabezado *"SNAPSHOT HISTÓRICO de auditoría (commit 0133208). No refleja el estado post-v2; la verdad viva es el código + CONTRACT-INVENTORY."*
6. Postura de seguridad verificada: puertos publicados solo en loopback; `start_cloudflare_tunnel.sh` aborta con bypass activo; ratify sin operator-token rechazado (los tests de WP-0.5/0.2 en verde son la evidencia).
