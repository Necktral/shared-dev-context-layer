# DIRECTIVA DE REVISIÓN — Blueprint v2 (respuesta a los 49 hallazgos del panel)

> **Autor:** Fable 5 (ingeniero/arquitecto) · **Ejecutor:** Opus 4.8 (constructor) · **Fecha:** 2026-07-04
> **Estado:** NORMATIVO. Donde esta directiva contradiga `ARCHITECTURE.md` o `BUILD-PLAN.md`, **manda esta directiva**. El primer paquete de trabajo (WP-R0, §3.4.1) consiste en aplicar estas correcciones a ambos documentos; a partir de ahí los planos corregidos vuelven a ser la referencia única.
> **Convención:** los hallazgos se citan como `F01…F49` según su orden en `review_findings.json` (ordenado por severidad: F01–F12 blockers, F13–F28 majors, F29–F49 minors). Toda referencia `fichero:línea` de esta directiva está verificada contra el código en el commit actual.
> **Nota de numeración:** el reparto de forks usa D1, D2, D4 y D5 (numeración del panel; el "D3" del panel no resultó ser un fork genuino de arquitectura y sus hallazgos se resuelven ítem a ítem en la tabla del §2).

---

## 1. Decisiones de arquitectura (resueltas por Fable — Opus NO reabre estos forks)

### D1 — Modelo de seguridad objetivo: **"loopback-first; exposición ⇒ auth runtime; ratificación ⇒ operator-token; remotos = read-only"**
*Resuelve F06, F07, F08 (parte de acceso), F10, F21, F22, F23, F40, F41, F42.*

**Contexto de decisión.** Esto es un prototipo experimental personal, pero la visión incluye agentes remotos (ChatGPT vía Auth0) y una garantía central: *"ellas deliberan, yo decido"*. El panel demostró que hoy esa garantía es ficticia: con la config de fábrica (`.env.example:26-27`: `MCP_AUTH_ENABLED=false`, `MCP_AUTH_BYPASS_LOCAL=true`) el MCP escucha en `0.0.0.0` (`server.py:187`), `_scope_guard` concede TODOS los scopes (incluido `wis.context.ratify`) a cualquier llamante, y `scripts/start_cloudflare_tunnel.sh` tunela ese bus a una URL pública sin preflight alguno. La salvaguarda planeada (RuntimeError si bypass + `MCP_PUBLIC_BASE_URL`) nunca dispara por esa vía. No acepto ni "asegurar todo con OAuth ya" (mata la ergonomía del prototipo local) ni "es personal, da igual" (la ratificación perdería todo valor probatorio). El modelo coherente tiene **cuatro planos con perímetros distintos**:

| Plano | Quién | Control |
|---|---|---|
| **Lectura local** (tools read) | agentes locales | bypass local OK, PERO solo alcanzable desde loopback |
| **Escritura local** (write plane MCP) | agentes locales | ídem; identidad = `consumer` (atribución, ver abajo) |
| **Ratificación** (`ratify_proposal`/`reject_proposal`) | SOLO el humano | **operator-token dedicado, verificado SIEMPRE, incluso bajo bypass** |
| **Remoto** (túnel/URL pública) | ChatGPT y futuros | auth runtime OBLIGATORIO (los scripts de túnel abortan sin él) + grants **read-only** |

**Decisiones normativas:**

1. **Bind/publicación loopback por defecto.** El host del MCP deja de ser literal `"0.0.0.0"` (`server.py:187`): nuevo setting `MCP_BIND_HOST`, **default `127.0.0.1`**. En docker-compose el proceso dentro del contenedor bindea `0.0.0.0` (necesario para la red del compose), pero el **perímetro real es la publicación de puertos**: `docker-compose.yml` publica `127.0.0.1:8001:8001` y `127.0.0.1:8002:8002` (no `8002:8002`). Resultado: nada del bus es alcanzable desde la LAN por defecto. El token HTTP de `/internal/*` NO cubre el write plane MCP y se documenta así (F23).
2. **Regla de exposición efectiva.** "Exposición" = túnel activo o URL pública configurada, no solo `MCP_PUBLIC_BASE_URL`. Tres enforcement points: (a) el guard de arranque del transporte MCP (RuntimeError si bypass + `MCP_PUBLIC_BASE_URL`) se mantiene, ubicado en el **arranque del transporte streamable-http**, NO en un validator de `Settings` (para no romper pytest — F10); (b) **`start_cloudflare_tunnel.sh` y `start_named_cloudflare_tunnel.sh` hacen preflight y ABORTAN** si el auth runtime no está activo en el contenedor `mcp` (leen el env efectivo vía `docker inspect`; condición de continuación: `MCP_AUTH_ENABLED=true` y `MCP_AUTH_BYPASS_LOCAL=false`) — F06; (c) el job backend de `phase3-ci.yml:118-119` (bypass=true + public URL) se corrige en el MISMO PR que introduce el guard, quitando `MCP_PUBLIC_BASE_URL` del env del job (F10).
3. **Los agentes remotos quedan read-only en v1.** Política de grants Auth0: los tokens emitidos a clientes remotos llevan como máximo `wis.context.read` + `wis.context.sync.read`. `wis.context.write`, `wis.context.sync.write`, `wis.context.ratify` y el nuevo `wis.context.code.read` (D4) **no se conceden a remotos** en v1. Es política de configuración, no de código; se documenta en ARCHITECTURE §6 y en el runbook de Auth0 (WP-4.3).
4. **La ratificación se ata a un operator-token que el bypass NO satisface.** `ratify_proposal` y `reject_proposal` ganan parámetro `operator_token: str | None = None`, verificado contra el nuevo setting `OPERATOR_RATIFY_TOKEN` **siempre**, también con `MCP_AUTH_BYPASS_LOCAL=true`. Sin token válido ⇒ la tool no ratifica (fail-closed; si el setting no está definido, ratify/reject responden que la ratificación no está configurada). El bootstrap dev (`dev_native.py`, `make up`) autogenera el token en `.env` si falta, y `dogfood_oracle.py` lo lee de env. Orden de verificación dentro de la tool: scope guard → **operator-token** → lookup de proposal; los payloads de registro (`scripts/mcp_validation_payloads.json`) se actualizan para inyectar el token desde env en `validate_remote_mcp.sh` (con token válido + proposal dummy la sonda devuelve `not_found`, que el gate `all_published` ya acepta). El token NUNCA se persiste en `context_write_audit` ni aparece en respuestas (se excluye del `before_payload` y está cubierto por `SENSITIVE_KEYS`). — F07.
5. **`consumer` se documenta como atribución NO autenticada.** ADR-B6 se corrige: `consumer` es un string autodeclarado que sirve para trazabilidad y segmentación del brief, **no** para control de acceso. El control de acceso son: perímetro loopback (local), scopes de token (remoto) y operator-token (ratificación). — F07.
6. **Origin guard = mitigación anti-CSRF de navegador, nada más.** Se implementa default-deny con auth runtime activo (WP-0.5d), pero ARCHITECTURE §6.3 deja de listarlo como mitigación de acceso no autenticado: no autentica nada (permite requests sin cabecera Origin por diseño). — F40.
7. **Superficies de fuga menores.** `GET /mcp/info` (`main.py:18-28`) pierde el campo `auth_enabled` (infoleak de postura); el preflight de túneles usa `docker inspect`, no ese endpoint. — F42. El corpus `code` y los secretos indexados se tratan en D4. El egress de embeddings (contenido Y queries) se trata en WP-2.2/2.4 con default `EMBEDDINGS_PROVIDER=none` (opt-in explícito) — F41.

**Traducción a WPs de Fase 0:** WP-0.5 se amplía a los puntos (a)–(h) del §3.5; el operator-token va en WP-0.2(e) (es parte del plano deliberativo); el cambio de CI va dentro de WP-0.5(c). Todo el cierre de perímetro no-aditivo se ampara en UN addendum ADR nuevo: `docs/context/adr/ADR-phase0-perimeter-closure.md` (cubre 0.5b, 0.5c, 0.5d, túneles y operator-token; satisface el paso 1 del flujo non_additive para todos ellos).

---

### D2 — Migración multi-proyecto: **non_additive, scopes current SOLO por proyecto, lectores scope-aware en el mismo PR**
*Resuelve F05, F29.*

1. **Reclasificación.** WP-1.1 es `persisted_contract` **non_additive**: eliminar `uq_context_scopes_single_current` (0003:121-127) cambia la semántica del dato persistido `is_current` (de "a lo sumo UNA fila en toda la BD" a "una por proyecto"). Se ejecuta el flujo completo de 5 pasos de CONTRACT-GOVERNANCE §3. El paso 1 se satisface **promoviendo ADR-B3 a ADR formal del repo**: `docs/context/adr/ADR-multi-project-scopes.md` (motivo, riesgo, transición, estrategia de downgrade).
2. **Scopes current por proyecto, SIN scopes de workspace.** `context_scopes.project_id` es `NOT NULL` hoy (0003:102, `models/context_scope.py`) y **se queda así**. El índice nuevo es el simple: `CREATE UNIQUE INDEX uq_context_scopes_current_per_project ON context_scopes (workspace_id, project_id) WHERE is_current` — sin `COALESCE` (era rama muerta que sugería un diseño inexistente, F29). Razonamiento: un "scope current a nivel workspace" no tiene ningún consumidor en la visión v1 (el foco de trabajo es siempre un proyecto; la *política* a nivel workspace ya queda cubierta por `policy_state.workspace_id/project_id` nullable de WP-1.1b, que es donde la precedencia workspace sí tiene sentido). Habilitarlo exigiría `DROP NOT NULL` + COALESCE + revisar todos los joins de scope: coste real por valor especulativo. Si v2 lo necesita, será su propia migración con su propio ADR.
3. **Lectores del invariante viejo — lista EXACTA a hacer scope-aware, en el MISMO PR de WP-1.1:**
   - `task_service.get_active_task` (`task_service.py:10-20`): hoy resuelve `ContextScope.is_current order by created_at desc limit 1` global. Gana parámetro `project_id: UUID | None = None`; con él, filtra el scope current de ESE proyecto; sin él, conserva el orden `created_at desc` documentado explícitamente como **"último proyecto enfocado"** (determinista, ya no arbitrario).
   - `task_service.require_active_task` (`task_service.py:47-51`): propaga el mismo parámetro opcional.
   - `focus_resolver.resolve_scope`, fallback `canonical_scope` (`focus_resolver.py:175` y `:317`): cuando la petición trae `project_id` (o se resolvió proyecto por otra vía), el lookup de scope current filtra por ese proyecto; sin proyecto, `created_at desc` = último enfocado.
   - `GET /active-task` (alias público) y `GET /internal/tasks/active`: ganan query param opcional `project_id`; sin él, semántica "último enfocado".
   - `POST /internal/events` (`api/internal.py:48-54`): usa `require_active_task` — hereda el parámetro opcional.
4. **Estrategia de downgrade con ≥2 currents (obligatoria en la migración 0008):** el `downgrade()` primero colapsa a un único current — conserva SOLO el de `created_at` más reciente (`UPDATE context_scopes SET is_current=false WHERE is_current AND id <> (SELECT id FROM context_scopes WHERE is_current ORDER BY created_at DESC LIMIT 1)`) — y después recrea el índice global. Se documenta en el docstring de la migración y en el ADR como **lossy-by-design**.
5. **Aceptación ampliada:** además de "dos proyectos con current simultáneo", test de **resolución**: con currents en P1 y P2, `get_active_task(project_id=P1)` devuelve la task de P1 y `GET /active-task?project_id=P2` la de P2; y test de downgrade sobre BD con 2 currents.

**Numeración:** esta migración pasa a ser `0008_multi_project_scopes` (down_revision=`0007_write_plane_fixes`); ver §3.1. Las columnas de `publish_audit` que el plan viejo metía aquí **se adelantan a 0007** (Fase 0) porque WP-0.2 las necesita (F14).

---

### D4 — Corpus `code`, mapeo y RAG: **v1 expone SOLO `canon` por el bus; `code` se queda local; la resolución canónica sigue determinista**
*Resuelve F08, F16, F24, F25, F36 (y desactiva la mitad del riesgo de F22).*

1. **`semantic_search` v1 = solo corpus `canon`.** La tool del bus busca únicamente en `context_item_embeddings ⋈ context_items` (mismo esquema backend, mismo scope resolution que el resto de tools read). El parámetro `corpus` se conserva en la firma con `'canon'` como único valor aceptado en v1; `'code'` queda **reservado y documentado**: devuelve `invalid_request` con mensaje "corpus 'code' no habilitado en v1 (índice local privado)". Razonamiento: exponer `local_private.file_chunks` por el bus bajo `wis.context.read` era un blocker triple — (a) el scope mínimo del transporte (`server.py:173`) regalaba el repo entero a cualquier token de lectura, ChatGPT incluida; (b) el indexador incluye `.env` (`constants.ts:56`) ⇒ secretos recuperables remotamente, y la redacción de `delegated_limited` es por NOMBRE de clave (`delegated_limited.py:153`), no por contenido del snippet; (c) el backend no tiene búsqueda léxica sobre `file_chunks` (la coarse vive en TS: `postgresPersistenceAdapter.ts`, `searchFileChunks`), así que la "fusión RRF con el léxico existente" era inespecificable en Python (F24). Y el único consumidor real del corpus `code` es el retrieval local de Codex, que **ya** consulta Postgres directamente: la extensión hace la búsqueda vectorial + fusión RRF client-side (WP-2.4), donde el léxico sí existe. Nada de valor se pierde en v1.
2. **El worker de embeddings SÍ procesa ambos corpus** (ADR-B2 se mantiene): `chunk_embeddings` alimenta el retrieval local de la extensión. Si el esquema `local_private` no existe en la BD (arnés backend, instalaciones sin extensión), el worker **omite el corpus `code` con un log claro, sin crash** (F25). El worker no necesita mapear scopes: procesa chunks `pending`/`stale` globalmente.
3. **Mapeo scope↔local_private (para el futuro v2, decidido YA para que no haya drift):** la regla es **igualdad de `project_key`**: `backend.projects.project_key == local_private.projects.project_key` (`001_init.sql:1-10`). Se registra AHORA como fila `integration_contract` en CONTRACT-INVENTORY (estado: "reservado, sin consumidor en v1"). Cuando el corpus `code` entre al bus (v2), lo hará con: scope propio `wis.context.code.read` (nunca en `required_scopes` del transporte, nunca concedido a remotos), exclusión de portadores de secretos y redacción por contenido — precondiciones escritas en el ADR-B2 corregido.
4. **Higiene del índice local (independiente del bus, se hace YA):** `.env` y `.pem` salen de `includeExtensions` (`vscode-extension/src/constants.ts:56`) — aunque el índice sea local, sus chunks entran en prompts hacia Codex. Va en WP-0.5(g) por ser fix de seguridad, no de RAG.
5. **Semántica de "pending" del corpus canon (F25):** `context_items` NO tiene `embedding_status` — el estado vive en la tabla de embeddings. Definición normativa: `pending(item) := NOT EXISTS (SELECT 1 FROM context_item_embeddings e WHERE e.item_id = ci.id AND e.model = :model AND e.content_hash = :hash_actual)`, donde `hash_actual = sha256(canonical_json({"title": ci.title, "content_json": ci.content_json, "labels_json": ci.labels_json}))` con `sort_keys=True, ensure_ascii=False, separators=(",",":")` (misma convención que `stable_hash` de `write_audit_service.py`). Ítems con `status != 'active'` (archivados) se excluyen de pending y de los resultados de búsqueda. Re-ejecutar el worker sin cambios ⇒ 0 re-embeddings (test).
6. **RAG jamás en el camino canónico (F36).** Nota normativa que Opus inserta en ARCHITECTURE §5 y, como addendum de una línea, en `docs/context/adr/ADR-deliberative-context-ratification.md`: *"`semantic_search` es descubrimiento read-only. La resolución canónica — `get_approved_decisions`, `_require_ratification`, el ensamblado de `get_project_brief` — es determinista y NUNCA consume resultados semánticos. El anti-patrón '❌ RAG en el camino canónico' del ADR sigue vigente; `semantic_search` no lo viola porque no participa en ninguna decisión de gobernanza."* Esto elimina la contradicción aparente que obligaría a Opus a parar por la regla 5a.
7. **Redacción de contenido en snippets (defensa en profundidad, aun con solo canon):** las respuestas de `semantic_search` pasan el campo `snippet` por un filtro de patrones de secretos (regex: `AKIA[0-9A-Z]{16}`, `sk-[A-Za-z0-9]{20,}`, `ghp_[A-Za-z0-9]{36}`, `xox[baprs]-`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`, asignaciones `*_KEY|*_SECRET|*_TOKEN|PASSWORD=`) que sustituye el match por `[REDACTED]`. Vive en `delegated_limited.py` como utilidad reutilizable.
8. **Dimensión fija (F47):** v1 soporta SOLO `dim=768` (`vector(768)`). El worker valida `EMBEDDINGS_DIM == 768` al arrancar y falla con mensaje claro si no. Cambiar de dimensión = migración futura. Documentado en `.env.example`.

---

### D5 — Extracción de la cadena de gates: **SÍ, WP-0.8 nuevo en Fase 0, función primero, decorador después**
*Resuelve F26.*

1. **Nuevo WP-0.8 — "Pipeline gobernado de escritura"** (spec completa en §3.4.2). La cadena de gates que hoy vive inline en cada tool de `server.py` (resolve scope → scope_guard → `_ensure_idempotency_key` → `_existing_replay_payload` → `_require_ratification` → aplicar dominio → `_write_audit_and_filter` → commit único → filtro `delegated_limited`) se extrae a **una función** `run_governed_write(...)` en un módulo nuevo `backend/app/mcp/governed_write.py`. Función, no decorador, como forma primaria: es invocable desde las tools MCP, desde el despachador de `apply_sync_batch` (por operación) y desde `vault_sync`/`make sync-vault` **fuera del contexto MCP** — un decorador acoplado a la firma de tool no lo sería. El azúcar `@governed_tool` de ARCHITECTURE §3.1 queda como wrapper opcional sobre la función; si Opus no lo necesita, no lo construye (la promesa de §3.1 se reescribe en WP-R0 para nombrar la función).
2. **Orden:** WP-0.8 va DESPUÉS de WP-0.4 (necesita servicios sin commits internos para que el commit único del pipeline sea real) y ANTES de WP-0.2 y WP-0.3 (que lo consumen). Ver §3.2.
3. **Criterio de aceptación:** (a) las 6 tools de escritura existentes + `apply_sync_batch` enrutadas por `run_governed_write` con los tests existentes verdes sin cambios de comportamiento observable; (b) `grep` de `_ensure_idempotency_key\|_existing_replay_payload` en cuerpos de tools ⇒ solo vía pipeline; (c) test unitario del pipeline con `apply_fn` fake: orden de gates, replay corta antes de aplicar, fallo en `apply_fn` ⇒ rollback total sin fila de audit.
4. **WP-3.3 (`vault_sync`) se reescribe para consumir `run_governed_write`** — ni invoca tools MCP en-proceso ni reimplementa la cadena.

---

## 2. Tabla de trazabilidad — los 49 hallazgos

Columnas: hallazgo (orden del JSON) · severidad · resolución (qué se decide) · dónde aterriza (WP / sección de esta directiva). "✔ fix panel" = se adopta el fix propuesto por el revisor; "✎" = lo adopto con corrección propia.

| # | Sev | Resolución | Aterriza en |
|---|---|---|---|
| F01 | blocker | ✔ fix panel: migración de datos en `0007` (`UPDATE context_write_audit SET request_id='dryrun-'||gen_random_uuid() WHERE dry_run AND request_id NOT LIKE 'dryrun-%'`) + índice parcial de replay + test sobre BD con key quemada histórica. El unique NO se amplía (los dry_run futuros siempre llevan request_id sintético; ampliar el constraint debilitaría "un commit por key"). | WP-0.1 (§3.5) |
| F02 | blocker | ✔ fix panel: WP-0.4 amplía alcance a `create_event_for_task` (flush + commit explícito en `POST /internal/events`) y nombra `record_write_audit` como segundo punto de commit a eliminar; WP-0.4 prerequisito de la op `append_context_event` del batch. | WP-0.4 (§3.5) |
| F03 | blocker | ✔ fix panel: el despachador ejecuta `_require_ratification` POR OPERACIÓN con el `item_type` del payload de cada upsert (vía pipeline de WP-0.8); test batch con goal bajo ratify ⇒ `ratification_required` + rollback total. | WP-0.3 (§3.5) |
| F04 | blocker | ✔ fix panel, ampliado: cambio de default reclasificado **non_additive pleno** con los 5 pasos (addendum al ADR deliberativo; `dogfood_oracle.py` actualizado en el mismo PR con `dry_run=false` + `idempotency_key`; `idempotency_key` OBLIGATORIA en `propose_change` cuando `dry_run=false`, OPCIONAL en ratify/reject con request_id determinista `ratify:<proposal_id>`/`reject:<proposal_id>`; payloads.json actualizado; fila en inventario). | WP-0.2 (§3.5) |
| F05 | blocker | Decidido en **D2**: non_additive + ADR formal `ADR-multi-project-scopes.md` + 4 lectores scope-aware en el mismo PR + downgrade lossy-by-design definido + aceptación de resolución por proyecto. | D2 / WP-1.1 (§3.5) |
| F06 | blocker | Decidido en **D1**: bind/publicación loopback por defecto + preflight con abort en ambos scripts de túnel + guard en arranque del transporte. | D1 / WP-0.5(a,c,e) |
| F07 | blocker | Decidido en **D1.4/D1.5**: operator-token (`OPERATOR_RATIFY_TOKEN`) verificado SIEMPRE (bypass no lo satisface) + `consumer` documentado como atribución no autenticada. Elegida la opción (a) del panel; la (b) (prohibir canon bajo bypass) se descarta: mataría el dogfood local del loop de ratificación. | WP-0.2(e) (§3.5) |
| F08 | blocker | Decidido en **D4**: corpus `code` FUERA del bus en v1; scope `wis.context.code.read` reservado; `.env`/`.pem` fuera del set indexable; redacción por contenido en snippets. | D4 / WP-2.3, WP-0.5(g) |
| F09 | blocker | ✔ fix panel: renumeración por orden real (F0⇒0007, F1⇒0008, F2⇒0009, F3⇒0010) con `down_revision` declarado + regla de serialización de WPs con migración. | §3.1 |
| F10 | blocker | ✔ fix panel: `phase3-ci.yml` corregido en el MISMO PR (quitar `MCP_PUBLIC_BASE_URL` del job backend); guard ubicado en el arranque del transporte streamable-http (no en Settings); revisar `test_mcp_public_base_url_config.py`. | WP-0.5(c) (§3.5) |
| F11 | blocker | ✔ fix panel: imágenes de servicio de CI a `pgvector/pgvector:pg16` en el mismo PR; DDL de embeddings **condicional** (chequeo de `pg_available_extensions`, skip con aviso ⇒ modo degradado léxico; `make native` sobrevive); aceptación incluye "CI verde con imagen nueva" y "make native no rompe". | WP-2.1 (§3.5) |
| F12 | blocker | ✎: la migración de `item_type` es **ALTER**, no ADD COLUMN (la columna existe NOT NULL desde 0004:29). Se mueve a `0010_item_type_governance` (Fase 3, WP-3.1): `SET DEFAULT 'note'` + normalización de valores fuera del set + `CHECK ... NOT VALID` + `VALIDATE`. `item_type` en la tool pasa de requerido a **opcional con default `'note'`** (additive). El mapeo `category=item_type` en `_require_ratification` YA existe (`server.py:1240`) — el trabajo real es default de `approval_policy_json` en seeds + CHECK. | WP-3.1 (§3.5) |
| F13 | major | Mismo tratamiento que F12 (duplicado de lente). | WP-3.1 |
| F14 | major | ✔ fix panel: mover a Fase 0 (`0007`): `publish_audit.task_id DROP NOT NULL` + columnas `workspace_id`/`project_id` nullable+FK+índices; guard `resolved.task.id if resolved.task else None` en `record_publish_audit` dentro del pipeline (hoy `server.py:487` crashea con task=None); test: ratify en scope sin task deja auditoría sin crash. | WP-0.1 (0007) + WP-0.8 (§3.5) |
| F15 | major | ✎: `record_publish_audit` gana `commit: bool = True`; el pipeline de escritura pasa `commit=False` (commit único al final); el camino de lectura (`_apply_policy_and_audit`) conserva el commit. Test: `get_active_task` deja fila en `publish_audit`. | WP-0.4 (§3.5) |
| F16 | major | Decidido en **D4.3**: mapeo = igualdad de `project_key`, registrado YA como fila `integration_contract` "reservado v2" en CONTRACT-INVENTORY; sin consumidor en v1 (corpus code fuera del bus). | D4 / WP-2.2 (inventario) |
| F17 | major | ✔ fix panel: `append_context_event` persiste `resolved.consumer.id` en `events.consumer_id` (EventCreate ya tiene el campo, `schemas/event.py:22`; `create_event_for_task` lo mapea); `propose_change` pasa `proposer_consumer_id` (`create_proposal` ya lo acepta, `proposal_service.py:45`). Test: dos consumers ⇒ eventos con consumer_id distintos. | WP-0.6(e) nuevo (§3.5) |
| F18 | major | Mismo tratamiento que F12; decisión sobre `'risk'`: **entra al set canónico** como categoría operativa (modo `auto`) — evita remapear filas existentes y mantiene veraz el hint `note\|decision\|risk` de la extensión, que se actualiza en el mismo PR añadiendo las categorías nuevas. Set final: `('note','goal','org_plan','design_system','decision','research_finding','risk')`. Reclasificado **non_additive** (persisted+integration) con flujo de 5 pasos. | WP-3.1 (§3.5) |
| F19 | major | ✔ fix panel: plantilla de cuerpo de PR obligatoria con los 4 campos machine-readable + tabla por WP de `contract_class`/`local_private_level` + regla "contract_class != n/a ⇒ CONTRACT-INVENTORY en el mismo PR, también internal_only" + mapeo "docs"→`n/a` + semáforo yellow y addendum ADR para WP-2.4 (toca `ports.ts` y `migrations/local_private/`). | §3.3 |
| F20 | major | ✔ fix panel: WP-0.6(b) declarado `persisted_contract` + `integration_contract`; migración nombrada (`0007`); `PolicyStateOut.approval_mode → Optional[str]` en el MISMO PR; fila en inventario. | WP-0.6 (§3.5) |
| F21 | major | ✔ fix panel: WP-0.5(b) declarado non_additive, amparado en `ADR-phase0-perimeter-closure.md`; compatibilidad = autogeneración de `INTERNAL_API_TOKEN` en bootstrap dev (`dev_native.py` y `make up` escriben `.env` si falta) + inventario de consumidores actuales de esos endpoints (`grep -rn "active-task\|/internal/" scripts/ Makefile integration/`) parcheados en el mismo PR. Fail-closed 503 se mantiene si el token falta en runtime. | WP-0.5(b) (§3.5) |
| F22 | major | ✔ fix panel: denylist de rutas sensibles para `extraRoots` (`~/.ssh`, `~/.aws`, `~/.gnupg`, dotfiles de home, `/etc`; rechazo por defecto) + invocar realmente `assertNoSymlinkEscape` sobre cada raíz indexada (hoy nunca se llama en producción). El punto (3) del panel (corpus separado) queda absorbido por D4: el contenido no sale por el bus en v1. | WP-2.4 (§3.5) |
| F23 | major | Decidido en **D1.1**: publicación de puertos loopback + `MCP_BIND_HOST` default 127.0.0.1 + doc "el token HTTP no cubre el write plane MCP". | WP-0.5(a) (§3.5) |
| F24 | major | Decidido en **D4.1**: opción (a) del panel llevada más lejos — corpus `code` fuera del bus en v1; la fusión RRF de código ocurre client-side en la extensión (WP-2.4), donde el léxico existe. El e2e de corpus code desaparece del arnés backend. | D4 / WP-2.3 |
| F25 | major | Decidido en **D4.5**: definición normativa de `pending(canon)` por content_hash canónico; worker omite corpus `code` con log si el esquema no existe; aceptación con fixture real (N items ⇒ N embeddings; re-run ⇒ 0). | WP-2.2 (§3.5) |
| F26 | major | Decidido en **D5**: WP-0.8 nuevo con `run_governed_write()`; WP-3.3 la consume. | D5 / WP-0.8 (§3.4.2) |
| F27 | major | ✔ fix panel: (a) WP-3.5 NUEVO con la lista exacta de piezas de la extensión para `get_project_brief` en el gateway; (b) WP-4.2 especifica transporte (`McpContextPlaneClient.append_context_event`, consumer `codex_cli`) y semántica offline best-effort (nunca bloquea ni falla el run; test de degradación). | WP-3.5 (§3.4.3), WP-4.2 (§3.5) |
| F28 | major | ✔ fix panel: WP-6.1 NUEVO "E2E del pod scriptado" (dueño del punto 3 de la DoD); punto 5 sustituido por criterio verificable (inventario + docs/mcp + smoke igualdad 23 tools; CAPABILITIES.md se congela como snapshot histórico con encabezado). | WP-6.1 (§3.4.4), §3.6 |
| F29 | minor | Decidido en **D2.2**: índice simple `UNIQUE(workspace_id, project_id) WHERE is_current`; `project_id` sigue NOT NULL; decisión declarada en el WP. | WP-1.1 (§3.5) |
| F30 | minor | ✔ fix panel: `WRITE_TOOL_NAMES` enumerado literal (9 tools; `preview_write_impact` y `list_proposals` fuera). | WP-0.2(a) (§3.5) |
| F31 | minor | ✔ fix panel: precedencia de replay = `context_write_audit` responde primero; el dedupe de `proposal_service.py:55-66` se CONSERVA como defensa documentada como inalcanzable; test de doble propose con misma key verificando shape (`idempotent_replay=true`). | WP-0.2 (§3.5) |
| F32 | minor | ✔ fix panel: evidencia corregida (incluye :405) y formulación "eliminar TODOS los `db.commit()`/`db.refresh()` del módulo". | WP-0.4 (§3.5) |
| F33 | minor | ✔ fix panel: `'results'` se añade a `TOOL_ALLOWLISTS['apply_sync_batch']` en el mismo PR. | WP-0.3 (§3.5) |
| F34 | minor | ✎ decisión unificada con F37/F45: canónico = `codex_cli`; el seed idempotente RENOMBRA `consumer_type 'codex'→'codex_cli'` (UPDATE preservando UUID y FKs — no inserta duplicado) si `codex_cli` no existe aún; `github_copilot` se conserva con `is_active=false`; mapeo documentado en inventario. | WP-4.2 (§3.5) |
| F35 | minor | ✔ fix panel: (1) WP-0.6 referencia la migración `0007` para `approval_mode DROP NOT NULL`; (2) texto corregido a "resolve_scope (~277 líneas, focus_resolver.py:78-354)". | WP-0.6, WP-1.3 (§3.5) |
| F36 | minor | Decidido en **D4.6**: nota normativa en ARCHITECTURE §5 + addendum de una línea al ADR deliberativo. | WP-R0 + WP-2.3 |
| F37 | minor | Resuelto con F34 (misma decisión). | WP-4.2 |
| F38 | minor | ✎: grafo de Fase 0 corregido a `0.1 → 0.4 → 0.8 → 0.2 → 0.3 → 0.6 → 0.7` con `0.5` paralelo (no se fusionan 0.3+0.4: PRs más pequeños y 0.8 en medio los desacopla). | §3.2 |
| F39 | minor | ✔ fix panel: WP-0.1 añade `persisted_contract` con línea de compatibilidad ("filas dry_run históricas quedan excluidas del replay; se normalizan por la migración de datos de 0007") + inventario. | WP-0.1 (§3.5) |
| F40 | minor | Decidido en **D1.6**: Origin guard documentado como anti-CSRF de navegador; se elimina de la lista de mitigaciones de acceso no autenticado. | WP-0.5(d) + WP-R0 |
| F41 | minor | ✎: default `EMBEDDINGS_PROVIDER=none` en `.env.example` (opt-in explícito, ollama recomendado en comentario) + test de aceptación del default + §6.6 extendido al egress de QUERIES (backend y extensión) + `openai_compatible` exige endpoint `https` salvo flag explícito `EMBEDDINGS_ALLOW_INSECURE_ENDPOINT=true`. | WP-2.2, WP-2.4 (§3.5) |
| F42 | minor | Decidido en **D1.7**: `GET /mcp/info` pierde el campo `auth_enabled` (siempre, no solo fuera de dev — nadie lo consume; los túneles usan `docker inspect`). | WP-0.5(h) (§3.5) |
| F43 | minor | Duplicado de F30; mismo set literal de 9 tools. | WP-0.2(a) |
| F44 | minor | ✔ fix panel: grafo corregido — F5 cuelga de F3 (WP-5.1 necesita `item_type` + política por categoría de WP-3.1); regla 1 y grafo quedan consistentes. | §3.2 |
| F45 | minor | Resuelto con F34: seed idempotente inserta los 6 canónicos si faltan; `codex` se renombra (no se duplica); `github_copilot` se desactiva. | WP-4.2 |
| F46 | minor | ✔ fix panel: lista corregida + aceptación `grep -rn "db.commit()" backend/app/services/ ⇒ 0 resultados` (la capa de auditoría vive en `backend/app/audit/`, fuera de services). | WP-0.4 (§3.5) |
| F47 | minor | Decidido en **D4.8**: v1 solo dim=768; validación al arranque del worker con error claro; documentado en `.env.example`. | WP-2.2 (§3.5) |
| F48 | minor | ✔ fix panel: rutas completas — `vscode-extension/src/config.ts` (normalizePositiveNumber, línea 239) y `backend/app/policies/delegated_limited.py`. | WP-2.4, WP-0.2 (texto) |
| F49 | minor | ✔ fix panel: WP-3.2 amplía alcance con fixture de pod en seed_v5 (2 goals, 3 decisiones, 2 design_system, 2 session summaries) y define "resumen design-system" = títulos + primera línea de `content_json` por item, orden `updated_at desc`, respetando presupuesto por sección. | WP-3.2 (§3.5) |

**Cobertura:** 49/49. Blockers: 12/12 con resolución concreta. Majors: 16/16. Minors: 21/21.

---

## 3. Reestructuración del plan

### 3.1 Migraciones renumeradas (orden real de ejecución)

**Backend (Alembic; head actual = `0006_deliberative_columns`):**

| Migración | down_revision | Fase / WP dueño | Contenido |
|---|---|---|---|
| `0007_write_plane_fixes` | `0006` | F0 / **WP-0.1** (la crea; 0.2, 0.4 y 0.6 la comparten — Fase 0 es secuencial) | (a) data-fix: `UPDATE context_write_audit SET request_id = 'dryrun-' || gen_random_uuid() WHERE dry_run AND request_id NOT LIKE 'dryrun-%'`; (b) índice parcial `ix_context_write_audit_replay ON (workspace_id, tool_name, request_id) WHERE NOT dry_run`; (c) `publish_audit.task_id DROP NOT NULL` + `workspace_id`/`project_id` nullable + FK + índices (backfill NULL best-effort); (d) `policy_state.approval_mode DROP NOT NULL`. Downgrade: (a) irreversible (no-op documentado); (c) aborta si hay filas con `task_id IS NULL` (documentado). |
| `0008_multi_project_scopes` | `0007` | F1 / WP-1.1 | Drop `uq_context_scopes_single_current`; `CREATE UNIQUE INDEX uq_context_scopes_current_per_project ON context_scopes (workspace_id, project_id) WHERE is_current`; `policy_state.workspace_id`/`project_id` nullable + FK + índice. Downgrade lossy-by-design (D2.4). |
| `0009_rag_canon` | `0008` | F2 / WP-2.1 | `CREATE EXTENSION IF NOT EXISTS vector` **condicional** (si `vector` ∉ `pg_available_extensions` ⇒ skip con warning y NO crea las tablas dependientes; deja marcador de modo degradado); tabla `context_item_embeddings (item_id FK ondelete CASCADE, model text, dim int, embedding vector(768), content_hash text, created_at)` + `UNIQUE(item_id, model)` + HNSW `vector_cosine_ops`. **Sin nada de item_type** (movido a 0010). |
| `0010_item_type_governance` | `0009` | F3 / WP-3.1 | `ALTER TABLE context_items ALTER COLUMN item_type SET DEFAULT 'note'`; `UPDATE context_items SET item_type='note' WHERE item_type NOT IN ('note','goal','org_plan','design_system','decision','research_finding','risk')`; `ADD CONSTRAINT ck_context_items_item_type CHECK (item_type IN (...)) NOT VALID`; `VALIDATE CONSTRAINT`. |

**Extensión (`migrations/local_private/`, cadena actual 001–006):** `007_embeddings.sql` sin cambios de contenido, pero con **guard condicional**: si el tipo `vector` no existe, el script falla con mensaje accionable (el runner de migraciones de la extensión lo reporta como "pgvector ausente: modo degradado léxico", no como corrupción) — o se divide en `007a` (status transitions, siempre) y `007b` (tabla vector, condicional). Opus elige la mecánica; el requisito es: **BD sin pgvector sigue migrando el resto de la cadena y el doctor lo reporta**.

**Regla nueva para BUILD-PLAN §0 (regla 1-bis):** *"Los WP que crean migraciones backend (WP-0.1, WP-1.1, WP-2.1, WP-3.1) se SERIALIZAN entre sí aunque sus fases sean paralelas; el que aterrice segundo rebasea su `down_revision` al head nuevo. `alembic heads` debe devolver exactamente 1 head en todo momento (con 2 heads, `alembic upgrade head` de `run_contract_closure.sh` falla — eso es el enforcement)."*

### 3.2 Orden de Fase 0 y grafo corregido

Fase 0 (secuencial, con 0.5 paralelizable):

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

Justificación: WP-0.3 declara "Requiere WP-0.4" (F38) y ahora también requiere WP-0.8 (gate por operación vía pipeline, F03). WP-0.6 va tras WP-0.4 porque ambos tocan `event_service` (evitar conflicto de merge). WP-0.2 requiere WP-0.8 (las tools deliberativas adoptan el pipeline, no copian la cadena).

Grafo global corregido (arregla F44 — F5 cuelga de F3):

```
F0 (0.1 → 0.4 → 0.8 → 0.2 → 0.3 → 0.6 → 0.7 ; 0.5 ∥)
 ├─► F1 (1.1 → 1.2 → 1.3)          ──┐
 └─► F2 (2.1 → 2.2 → {2.3, 2.4})   ──┤
                                      └─► F3 (3.1 → {3.2, 3.3, 3.5} → 3.4) ─► F4 (4.1 → 4.2 → 4.3)
                                                                  └────────► F5 (5.1 → 5.2)
                                                                              F6 (6.1, al final)
```

### 3.3 Gobernanza de PR — plantilla obligatoria y clasificación por WP

**Plantilla de cuerpo de PR** (Opus la añade a BUILD-PLAN §0 como regla 2-bis; los 4 campos son los que `scripts/validate_pr_governance.sh:115-129` extrae y valida):

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

**Reglas normativas:**
1. "Contrato: docs" NO es un valor del enum ⇒ los WP documentales (WP-0.7, 4.1, 4.3, 5.2, R0) declaran `contract_class: n/a`, `local_private_level: n/a`.
2. **Todo WP con `contract_class != n/a` actualiza `CONTRACT-INVENTORY.md` en el mismo PR, también `internal_only`** (el gate lo exige: `validate_pr_governance.sh:152-174`). Afecta a WP-0.4, WP-1.2, WP-1.3, WP-2.2 tal y como estaban escritos.
3. Todo PR que toque `vscode-extension/src/local/**`, `vscode-extension/migrations/local_private/` o las superficies críticas de CONTRACT-GOVERNANCE §5 declara `local_private_level` ≥ `yellow`. **WP-2.4 toca `ports.ts` y `migrations/local_private/` ⇒ yellow + addendum ADR obligatorio** (LOCAL_PRIVATE-EVOLUTION-POLICY §2).

**Tabla de clasificación por WP (valores que Opus copia al PR):**

| WP | contract_class | local_private_level | Notas |
|---|---|---|---|
| 0.1 | integration_contract + persisted_contract | n/a | additive; compat de filas dry_run históricas declarada (F39) |
| 0.2 | integration_contract | n/a | **non_additive** (default dry_run + operator-token); 5 pasos; ADRs: deliberativo (addendum) + perimeter-closure |
| 0.3 | integration_contract | n/a | additive (`results`) |
| 0.4 | internal_only | n/a | inventario igualmente (regla 2) |
| 0.5 | integration_contract | **yellow** (por (f) y (g): `src/local/**` y `constants.ts`) | **non_additive** en (b); ADR-phase0-perimeter-closure |
| 0.6 | persisted_contract + integration_contract | n/a | (b) non-nullable→nullable + PolicyStateOut Optional |
| 0.7 | n/a | n/a | docs |
| 0.8 | internal_only | n/a | inventario igualmente |
| 1.1 | persisted_contract | n/a | **non_additive** (D2); ADR-multi-project-scopes |
| 1.2 | internal_only | n/a | inventario (semántica policy_state) |
| 1.3 | internal_only | n/a | inventario igualmente |
| 2.1 | persisted_contract | **yellow** (crea `migrations/local_private/007`) | additive; addendum ADR-B2 (nota pgvector condicional) |
| 2.2 | internal_only | n/a | inventario: fila mapeo project_key "reservado v2" (F16) |
| 2.3 | integration_contract | n/a | additive (nueva tool, solo canon) |
| 2.4 | integration_contract + ui_facing_contract | **yellow + addendum ADR** (toca `ports.ts`) | F19 |
| 3.1 | persisted_contract + integration_contract | n/a | **non_additive** (CHECK restrictivo); 5 pasos; hint de extensión en mismo PR |
| 3.2 | integration_contract | n/a | additive |
| 3.3 | integration_contract | n/a | additive |
| 3.4 | ui_facing_contract | **yellow** (src/local) | additive |
| 3.5 | integration_contract | **yellow** (gateway en src/local o src/platform: verificar ruta real) | additive |
| 4.1 | n/a | n/a | docs/integración |
| 4.2 | persisted_contract | **yellow** (runtime local registra summary) | seed + rename consumer documentado |
| 4.3 | n/a | n/a | docs |
| 5.1 | integration_contract | n/a | additive |
| 5.2 | n/a | n/a | docs |
| 6.1 | n/a | n/a | arnés e2e (si añade fixtures backend: internal_only) |
| R0 | n/a | n/a | docs (esta directiva aplicada a los planos) |

### 3.4 WPs nuevos

#### 3.4.1 WP-R0 — Aplicar esta directiva a los planos (PRIMER WP, antes que todo)
- **Cambio:** editar `docs/blueprint/ARCHITECTURE.md` y `docs/blueprint/BUILD-PLAN.md` aplicando TODO el §3.5 y las decisiones D1–D5: tabla de migraciones nueva (§3.1), modelo de seguridad §6 reescrito (D1), §5 con semantic_search solo-canon + nota RAG-no-canónico (D4.6), ADR-B2/ADR-B6 enmendados, §3.1 nombrando `run_governed_write`, grafo y reglas de BUILD-PLAN (§3.2, §3.3), y las specs de WP enmendadas. Crear los esqueletos de ADR: `docs/context/adr/ADR-phase0-perimeter-closure.md` y `docs/context/adr/ADR-multi-project-scopes.md` (contenido completo al ejecutarse WP-0.5/WP-1.1). Añadir addendum de una línea a `ADR-deliberative-context-ratification.md` (texto exacto en D4.6).
- **Aceptación:** `./scripts/run_contract_closure.sh docs` verde; ninguna referencia a "0007_multi_project_scopes"/"0008_rag_canon" con la numeración vieja sobrevive en los planos.
- **Gobernanza:** `contract_class: n/a`, `local_private_level: n/a`.

#### 3.4.2 WP-0.8 — Pipeline gobernado de escritura (`run_governed_write`)
- **Problema:** la cadena de gates vive inline en cada tool (`server.py:1138-1187` y cuerpos); `vault_sync` (WP-3.3) y el despachador del batch (WP-0.3) la necesitan invocable fuera de una tool MCP (F26); el guard task-nullable de F14 debe vivir en UN sitio.
- **Cambio:** nuevo `backend/app/mcp/governed_write.py` con `run_governed_write(db, *, tool_name, resolved: ResolvedScope, dry_run, idempotency_key, ratification: RatificationSpec | None, apply_fn: Callable[[Session], WriteResult], actor_context, response_builder) -> dict` que encapsula, en orden: `_ensure_idempotency_key` → request_id (`idempotency_key` o `dryrun-<uuid4>`) → replay (`_existing_replay_payload`, filtrado `dry_run==false` tras WP-0.1) → `_require_ratification` (si `ratification` no es None) → `apply_fn` (solo flush, tras WP-0.4) → `record_write_audit` + `record_publish_audit(task_id=resolved.task.id if resolved.task else None, commit=False)` → **commit único** → `apply_delegated_limited_policy`. El `_scope_guard` queda en la tool (depende del transporte). Las 6 write tools + `apply_sync_batch` se reescriben sobre la función. `@governed_tool` (ARCHITECTURE §3.1) queda como azúcar opcional.
- **Aceptación:** ver D5.3. Tests existentes verdes sin cambios de comportamiento; test unitario de orden de gates y rollback; test F14 (ratify/write en scope sin task ⇒ audit sin crash).
- **Gobernanza:** `internal_only` + fila en inventario. **Requiere WP-0.4. Prerrequisito de WP-0.2 y WP-0.3.**

#### 3.4.3 WP-3.5 — `get_project_brief` en el gateway de la extensión
- **Problema:** WP-3.4 asumía que la extensión puede llamar `get_project_brief` "modo mcp", pero `McpWISGateway` solo soporta 5 tools read (F27a).
- **Cambio (lista exacta):** (a) método `getProjectBrief(params)` en `McpWISGateway`; (b) entrada en `normalizeToolPayload` (shape del brief, tolerante a campos ausentes); (c) mapeo en `classifyTransportFailure`; (d) escenario en `FixtureWISGateway` (brief completo, brief vacío, transporte caído); (e) setting `wisContextSync.pod.briefEnabled` (default true) con passthrough a config; (f) tests de normalización y de fixture.
- **Aceptación:** suite de la extensión verde; `FixtureWISGateway` cubre los 3 escenarios; WP-3.4 consume este método sin tocar el gateway.
- **Gobernanza:** `integration_contract` additive; `local_private_level: yellow` si el gateway vive bajo superficie crítica (verificar ruta al empezar). **Entre WP-3.2 y WP-3.4.**

#### 3.4.4 WP-6.1 — E2E del pod scriptado (dueño de la DoD)
- **Cambio:** `scripts/e2e_pod.sh` (o pytest marcado `@pytest.mark.e2e_pod`) que ejecuta contra stack levantado con provider fake/determinista: `make up` → seed → `make sync-vault VAULT=fixtures/pod` → `get_project_brief` (contiene goals del vault) → `append_context_event` con `agent.session_summary` (consumer `claude_code`) → segundo `get_project_brief` (contiene el summary) → `upsert_context_item` de `design_system` sin proposal ⇒ `ratification_required` → `propose_change` + `ratify_proposal` (con operator-token) ⇒ visible en brief → `semantic_search` encuentra un finding por sinónimo (no keyword; fixture con embedding fake que lo garantice).
- **Aceptación:** el script es el criterio 3 (y 4) de la Definición de Hecho; corre en CI como job opcional (`workflow_dispatch`) y en `make e2e-pod`.
- **Gobernanza:** `n/a` (o `internal_only` si añade fixtures backend). **Última pieza del release.**

### 3.5 Enmiendas por WP existente (Opus las aplica literalmente en WP-R0 y las ejecuta en cada WP)

**WP-0.1** — Añadir: crea la migración **`0007_write_plane_fixes`** (contenido §3.1, incluye los puntos de F14 y F35-1 aunque "pertenezcan" a otros WPs: una sola migración de Fase 0). Contrato: `integration_contract` **+ `persisted_contract`** con línea de compatibilidad: "las filas dry_run históricas quedan excluidas del replay por el filtro `dry_run==false`; sus request_id reales se liberan con el data-fix de 0007". Aceptación adicional: test sobre BD donde un dry_run histórico quemó la key K (insertar fila audit dry_run con K) ⇒ commit con K aplica sin `IntegrityError` (F01).

**WP-0.2** — Reescribir: (a) `WRITE_TOOL_NAMES = {upsert_context_item, append_context_event, link_context_entities, set_context_labels, archive_context_item, apply_sync_batch, propose_change, ratify_proposal, reject_proposal}` — 9 tools, literal; `preview_write_impact` y `list_proposals` read-only (F30/F43). (b) Las deliberativas adoptan `run_governed_write` (requiere WP-0.8). Idempotencia: `propose_change` exige `idempotency_key` cuando `dry_run=false` (regla estándar); `ratify_proposal`/`reject_proposal`: `idempotency_key` OPCIONAL — si falta, `request_id = f"ratify:{proposal_id}"` / `f"reject:{proposal_id}"` (idempotencia natural por proposal; segundo ratify de la misma proposal ⇒ replay). Solo se registra audit en desenlaces terminales (applied/dry_run), no en errores de validación. Precedencia de replay: audit primero; dedupe de `proposal_service` se conserva como defensa documentada inalcanzable (F31). (c) `propose_change` pasa a `dry_run=True` — **non_additive pleno, 5 pasos** (F04): addendum al ADR deliberativo; `scripts/dogfood_oracle.py:78-97` actualizado en el MISMO PR (pasa `dry_run: false` + `idempotency_key` explícitos y usa `OPERATOR_RATIFY_TOKEN`); `scripts/mcp_validation_payloads.json` actualizado (propose ya lleva `dry_run: true`; ratify/reject ganan `operator_token` inyectado desde env por `validate_remote_mcp.sh`); fila en inventario. (d) → (e) **operator-token** según D1.4 (setting `OPERATOR_RATIFY_TOKEN`, verificación previa al lookup de proposal, nunca persistido, autogenerado en bootstrap dev). Aceptación añade: ratify sin token ⇒ rechazado incluso con bypass activo; ratify con token ⇒ ok; doble ratify misma proposal ⇒ replay. Ruta corregida: `backend/app/policies/delegated_limited.py` (F48).

**WP-0.3** — Añadir: despachador vía `run_governed_write` por operación con `_require_ratification` usando el `item_type` del payload de cada upsert; cualquier gate dispara ⇒ respuesta `ratification_required` y **rollback total del batch** (F03). `'results'` añadido a `TOOL_ALLOWLISTS['apply_sync_batch']` en `backend/app/policies/delegated_limited.py:127-139` en el mismo PR (F33). Requiere WP-0.4 **y WP-0.8** (orden §3.2). Test nuevo: batch con op upsert de `goal` bajo política ratify ⇒ `ratification_required` + 0 mutaciones.

**WP-0.4** — Reescribir alcance: eliminar TODOS los `db.commit()`/`db.refresh()` de `backend/app/services/context_item_service.py` (líneas actuales 242, 279, 324, 348, **405**, 425, 470 — la lista es informativa, el criterio es "todos") (F32/F46); `event_service.create_event_for_task` pasa a `flush()` y `POST /internal/events` (`api/internal.py:54`) añade `db.commit()` explícito (F02); `record_write_audit` (`write_audit_service.py:68`) deja de comitear (el commit único vive en el pipeline); `record_publish_audit` gana `commit: bool = True` — el pipeline de escritura pasa `False`, el camino de lectura (`_apply_policy_and_audit`) conserva su commit (F15). Aceptación añade: `grep -rn "db.commit()" backend/app/services/` ⇒ 0 resultados; test `get_active_task` deja fila en `publish_audit`. Contrato: `internal_only` **+ inventario** (regla §3.3.2).

**WP-0.5** — Reestructurar en (a)–(h): **(a)** bind/publicación loopback: `MCP_BIND_HOST` default `127.0.0.1` (`server.py:187`); compose publica `127.0.0.1:8001/8002`; doc explícita "el token HTTP no cubre el write plane MCP" (F23). **(b)** `X-Internal-Token` en `/internal/*` y alias — **non_additive**, amparado en `ADR-phase0-perimeter-closure.md`; compatibilidad: autogeneración del token en `dev_native.py` y `make up`; inventariar y parchear consumidores actuales de esos endpoints en el mismo PR (F21). **(c)** guard bypass+public_url en el **arranque del transporte streamable-http**; `phase3-ci.yml` corregido en el MISMO PR (quitar `MCP_PUBLIC_BASE_URL` del job backend, líneas 118-119); revisar `test_mcp_public_base_url_config.py` (F10). **(d)** Origin guard default-deny con auth runtime activo, documentado como anti-CSRF only (F40). **(e)** preflight de túneles: ambos scripts leen el env del contenedor `mcp` vía `docker inspect` y ABORTAN si `MCP_AUTH_ENABLED != true` o `MCP_AUTH_BYPASS_LOCAL != false` (F06). **(f)** `delegated_limited` fail-closed + `mkdtemp` 0700 (sin cambios). **(g)** `.env` y `.pem` fuera de `includeExtensions` (`constants.ts:56`) (D4.4/F08). **(h)** `GET /mcp/info` pierde `auth_enabled` (F42). Gobernanza: yellow (toca `src/local/**` y `constants.ts`); docs FastAPI off fuera de dev se mantiene.

**WP-0.6** — (b) declarado `persisted_contract` + `integration_contract`; la migración es `0007` (ya creada en WP-0.1); `PolicyStateOut.approval_mode → Optional[str]` en el MISMO PR (F20/F35). Añadir **(e)**: `append_context_event` pasa `resolved.consumer.id` en `EventCreate.consumer_id` y `create_event_for_task` lo mapea al `Event`; `propose_change` pasa `proposer_consumer_id=resolved.consumer.id if resolved.consumer else None` a `create_proposal` (F17). Aceptación añade: dos consumers distintos ⇒ eventos con `consumer_id` distintos; proposal registra proposer.

**WP-0.7** — Sin cambios de fondo; añadir que la actualización de `docs/mcp/README.md` refleja también el operator-token y los defaults nuevos. La "regeneración de CAPABILITIES.md" NO es criterio de este WP ni de la DoD (ver §3.6).

**WP-1.1** — Según D2 completa: non_additive, ADR `ADR-multi-project-scopes.md`, índice simple sin COALESCE, migración renumerada `0008_multi_project_scopes`, lectores scope-aware (los 4 enumerados en D2.3) en el MISMO PR, downgrade lossy definido, aceptación con test de resolución por proyecto y test de downgrade con 2 currents.

**WP-1.2** — Sin cambios de fondo (la parte de columnas de `policy_state` vive en 0008/WP-1.1); `internal_only` + inventario.

**WP-1.3** — Texto corregido: "resolve_scope (~277 líneas, `focus_resolver.py:78-354`)" (F35-2); `internal_only` + inventario.

**WP-2.1** — Imágenes de servicio de `phase3-ci.yml:57,99` a `pgvector/pgvector:pg16` en el MISMO PR; `0009_rag_canon` con DDL condicional (§3.1) y `007_embeddings.sql` con guard (§3.1); aceptación añade "CI verde con imagen nueva" y "`make native` completa la cadena de migraciones en modo degradado" (F11). Yellow (crea migración local_private) + addendum a ADR-B2 (nota de condicionalidad).

**WP-2.2** — Añadir: definición normativa de `pending(canon)` (D4.5, texto literal); comportamiento con `local_private` ausente = skip del corpus code con log (F25); default `EMBEDDINGS_PROVIDER=none` en `.env.example` con test de aceptación del default y recomendación ollama comentada (F41); validación `EMBEDDINGS_DIM==768` al arranque (F47); `openai_compatible` exige `https` salvo `EMBEDDINGS_ALLOW_INSECURE_ENDPOINT=true`; fila de inventario para el mapeo `project_key` "reservado v2" (F16). Aceptación reescrita: fixture inserta N `context_items` → `--once` ⇒ N embeddings y 0 pending; re-run sin cambios ⇒ 0 re-embeddings; BD sin `local_private` ⇒ corre sin error.

**WP-2.3** — Reescribir según D4.1: `semantic_search(query, corpus='canon', top_k=8, filters?)` — solo corpus `canon` en v1; `corpus='code'` ⇒ `invalid_request` documentado como reservado; fusión RRF solo entre vectorial y el léxico del backend sobre `context_items` (el `search_context` existente); `retrieval_mode: semantic|lexical_fallback`; redacción de contenido en `snippet` (D4.7); nota RAG-no-canónico + addendum ADR (D4.6). E2E de aceptación solo canon (fixture backend puro, sin `local_private`). Cadena de gates read estándar + allowlist propia con `snippet` incluido.

**WP-2.4** — Añadir: denylist de `extraRoots` (D1/F22: `~/.ssh`, `~/.aws`, `~/.gnupg`, dotfiles, `/etc`; rechazo por defecto con mensaje) + invocación real de `assertNoSymlinkEscape` (`workspaceBoundaryGuard.ts:42`) sobre cada raíz al indexar; la query embebida client-side hereda el aviso de egress (F41); ruta corregida `vscode-extension/src/config.ts` (F48). Gobernanza: **yellow + addendum ADR** por tocar `ports.ts` y `migrations/local_private/` (F19).

**WP-3.1** — Reescribir según F12/F18: la migración es **`0010_item_type_governance`** (ALTER, no ADD; contenido §3.1); set canónico incluye `'risk'`; `upsert_context_item.item_type` pasa de requerido a **opcional con default `'note'`** (cambio de firma declarado, additive); el mapeo `category=item_type` YA existe (`server.py:1240`) — el trabajo real es: seeds con `approval_policy_json` default no destructivo + CHECK + hint del comando de la extensión (`wisContextSync.upsertContextItem`) actualizado en el MISMO PR. Clasificación: `persisted_contract`+`integration_contract` **non_additive** con 5 pasos (addendum al ADR deliberativo: gobernanza por categoría + set cerrado).

**WP-3.2** — Añadir alcance: extender `seed_v5` con fixture de pod (2 goals, 3 decisiones, 2 items design_system, 2 session summaries), seed idempotente no destructivo; definición del resumen design-system: títulos + primera línea de `content_json` por item, orden `updated_at desc`, presupuesto por sección (F49). El brief a nivel proyecto/workspace sin task funciona gracias a 0007 (F14) — test explícito.

**WP-3.3** — `vault_sync` consume `run_governed_write` (D5.4); ni tools en-proceso ni copia de la cadena. Resto sin cambios.

**WP-3.4** — Consume el método del gateway de **WP-3.5** (nuevo prerequisito); resto sin cambios. Yellow (src/local).

**WP-4.2** — Reescribir: (a) reconciliación de identidad según F34/F37/F45: canónico `codex_cli`; el seed renombra `consumer_type 'codex'→'codex_cli'` preservando UUID/FKs si `codex_cli` no existe; inserta los 6 canónicos que falten; `github_copilot` se conserva con `is_active=false`; mapeo documentado en inventario. (b) transporte del session_summary: `McpContextPlaneClient.append_context_event` con `consumer='codex_cli'`, **best-effort** — backend inaccesible ⇒ skip con log, NUNCA bloquea ni falla el run local; test de esa degradación (F27b). Yellow.

**WP-4.3** — `contract_class: n/a`; añade el runbook de grants Auth0 read-only para remotos (D1.3).

**WP-5.1** — Prerequisito explícito: WP-3.1 (validación por categoría). Resto sin cambios.

### 3.6 Definición de Hecho global corregida (release `0.3.0-internal`)

1. `./scripts/run_contract_closure.sh all` verde.
2. `make smoke` valida **igualdad** de 23 tools.
3. `make e2e-pod` (WP-6.1) verde — sustituye al E2E manual sin dueño.
4. (absorbido por el script del punto 3: ratificación con operator-token incluida.)
5. **Sustituido:** ~~"CAPABILITIES.md regenerado"~~ ⇒ `CONTRACT-INVENTORY.md` y `docs/mcp/README.md` actualizados a la superficie final + smoke de igualdad verde + `docs/CAPABILITIES.md` recibe encabezado *"SNAPSHOT HISTÓRICO de auditoría (commit 0133208). No refleja el estado post-v2; la verdad viva es el código + CONTRACT-INVENTORY."* (F28).
6. Postura de seguridad verificada: puertos publicados solo en loopback; `start_cloudflare_tunnel.sh` aborta con bypass activo; ratify sin operator-token rechazado (tests de WP-0.5/0.2 en verde son la evidencia).

---

*Fin de la directiva. Opus: ante cualquier conflicto entre esta directiva y el código real no cubierto aquí, aplica la regla 5a del BUILD-PLAN — consulta a Fable, no improvises.*
