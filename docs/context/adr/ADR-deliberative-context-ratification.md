# ADR — Capa de contexto deliberativo con ratificación humana

- **Estado:** Implementado y verificado (pasos 1-6) con Postgres real y suite en verde. Pendiente de tu lado: configurar el scope `wis.context.ratify` en Auth0.
- **Fecha:** 2026-07-01
- **Down-revision base:** `0004_phase4_mcp_write_plane` (última migración en el repo)
- **Orientación fuente:** [`docs/context/orientations/deliberative-context-layer.md`](../orientations/deliberative-context-layer.md)
- **Principio rector:** *Ellas deliberan, yo decido.*
- **Alcance:** backend MCP (`app/mcp/server.py` write plane), modelo de datos canónico, contrato de tools MCP.

---

## 1. Contexto y hallazgo (verificado en el código, no de memoria)

| Propiedad | ¿Enforced hoy? | Evidencia en el código |
|---|---|---|
| Quién puede escribir | ✅ | `_scope_guard` exige `wis.context.write` (`app/mcp/server.py`, `TOOL_SCOPES`) |
| Intención de commit | ✅ | `dry_run` defaultea `true`; commit exige `dry_run=false` + `idempotency_key` (`_ensure_idempotency_key`) |
| Auditoría de escritura | ✅ | `record_write_audit` + `stable_hash` (sha256) de before/after (`app/audit/write_audit_service.py`) |
| **Ratificación humana de lo canónico** | ❌ | `PolicyState.approval_mode` existe pero **no se lee en el runtime**; el único uso fuera de models/seed es la definición del campo en `app/schemas/policy.py` |
| **Estado de propuesta / deliberación** | ❌ | `grep -rni "\bproposal\b" app` → **sin resultados**. No existe el objeto |
| **Identidad de quien aprueba** | ❌ | `approved_by` es `server_default 'WIS'` (`app/models/approved_decision.py`) y literal `"WIS"` en `app/db/seed_v5.py` — no la identidad del token |

**Conclusión (confirmada):** hoy *"yo decido"* lo sostiene **quién posee el scope `wis.context.write`**, no una propiedad del sistema. Un agente con ese scope que pase `dry_run=false` escribe canon sin humano en el medio, y la auditoría registra `approved_by="WIS"` igual. Este ADR vuelve el *"yo decido"* **enforced**.

---

## 2. Decisión

Introducir un objeto de primera clase **`Proposal`** y un **gate de ratificación** en el write path. La promoción a canónico (categorías gateadas) exige una `Proposal` en estado `ratified`, cuya ratificación proviene de una **identidad humana verificada por token** (no un default de columna). El disenso se preserva; el trail registra *quién propuso, quién objetó y por qué*.

Se implementa **aditivamente** sobre el esquema y el transporte existentes, respetando los invariantes del repo: *sin fallback silencioso*, `all_published`, `dry_run`-default-true, `idempotency_key` obligatorio y auditoría before/after.

---

## 3. Invariantes de diseño (no negociables)

- **I1 — Ratificación humana para lo canónico.** Ninguna IA promueve a canónico sin ratificación humana explícita, en las categorías que lo requieran.
- **I2 — El disenso se preserva, no se colapsa.** Varias `proposals`/objeciones sobre el mismo target coexisten; el sistema NO arbitra, las presenta al humano.
- **I3 — Trail auditable de la decisión.** Toda transición a canónico registra proposer, objetores y argumentos (el *porqué*), complementando el hash del *qué* que ya guarda `ContextWriteAudit`.

---

## 4. Cambios al modelo de datos (migración `0005_deliberative_ratification`)

Estilo consistente con `0004`: `postgresql.UUID(as_uuid=True)`, `server_default gen_random_uuid()`, FKs con `ondelete`, índices explícitos. Estados como `Text` + `CHECK` (el repo no usa enums nativos; `category`/`status` son `Text`).

### 4.1 Nueva tabla `proposals` (Paso 1)

```
proposals
  id                 uuid  pk  default gen_random_uuid()
  workspace_id       uuid  fk workspaces(id) on delete cascade   not null
  project_id         uuid  fk projects(id)   on delete cascade   null
  task_id            uuid  fk tasks(id)       on delete set null  null
  proposer_consumer_id uuid fk consumers(id) on delete set null   null
  target_kind        text  not null   CHECK in ('decision','context_item')
  target_key         text  not null   -- decision_key | item_key
  proposed_payload   jsonb not null default '{}'::jsonb
  rationale          text  not null
  status             text  not null default 'proposed'
                     CHECK in ('proposed','in_review','ratified','rejected','superseded')
  ratified_decision_id uuid fk approved_decisions(id) on delete set null null
  ratified_by        text  null    -- identidad humana verificada (sub/email del token)
  ratified_at        timestamptz null
  superseded_by      uuid  fk proposals(id) on delete set null null
  idempotency_key    text  null
  created_at         timestamptz not null default now()
  updated_at         timestamptz not null default now()

índices:
  ix_proposals_ws_status      (workspace_id, status)
  ix_proposals_target         (workspace_id, target_kind, target_key)
  uq_proposals_idem           unique (workspace_id, idempotency_key) where idempotency_key is not null
```

> **NO** se pone unique sobre "propuesta activa por target": I2 exige que **coexistan** varias `in_review` sobre el mismo target (disenso). La `decisión` es la transición `in_review → ratified`.

### 4.2 `approved_decisions` pasa a ser *resultado*, no estado

- Añadir columna `proposal_id uuid fk proposals(id)` (nullable por retrocompat; se llena al ratificar).
- `approved_by` deja de depender del default `'WIS'`: en el flujo nuevo se setea con la **identidad verificada del token** (`_extract_actor_context().actor_sub` + email si el claim existe). El `server_default` se mantiene solo para filas legacy.
- `superseded_by` pasa a FK real a `approved_decisions(id)` (hoy es `uuid` suelto).
- `is_active` deja de cargar el estado conceptual; el estado vive en `proposals.status`. `is_active` queda como flag derivado del resultado ratificado vigente.

### 4.3 Deliberation trail sobre `events` (Paso 2)

`events` ya es append-only y tiene `payload_json`. Para trazabilidad consultable:

- Añadir columna nullable `proposal_id uuid fk proposals(id) on delete set null` + índice `ix_events_proposal_id`.
- Nuevos `event_type` (convención, sin cambiar el esquema): `proposal.raised`, `proposal.objected`, `proposal.counter`, `proposal.ratified`, `proposal.rejected`.
- El *porqué* de cada decisión vive acá; es el complemento del hash del *qué* de `ContextWriteAudit`.

### 4.4 Granularidad de aprobación (Paso 4) — reemplaza `approval_mode` global

- Añadir `policy_state.approval_policy_json jsonb not null default '{}'::jsonb`.
- Forma: `{ "by_category": {"money_path":"ratify","label":"auto"}, "by_tool": {"apply_sync_batch":"ratify"}, "default":"auto" }`.
- Resolver nuevo `requires_ratification(policy, *, tool_name, target_kind, category) -> bool` (precedencia: tool > category > default).
- `approval_mode` se marca *deprecated* (se mantiene una release para no romper `seed`/schema) y luego se elimina en `0006`.

---

## 5. Gate de ratificación en el write path (Paso 3)

Punto de inserción: en cada handler write gateado de `app/mcp/server.py`
(`upsert_context_item`, `append_context_event`, `link_context_entities`,
`set_context_labels`, `archive_context_item`, `apply_sync_batch`), **después** de
`_scope_guard` y `_ensure_idempotency_key`, **antes** de la llamada al service.

```python
def _require_ratification(db, resolved, *, tool_name, target_kind, target_key, category, dry_run):
    if dry_run:
        return None                      # dry_run sigue siendo preview puro
    if not requires_ratification(policy, tool_name=tool_name,
                                 target_kind=target_kind, category=category):
        return None                      # categoría auto-commit (labels, links)
    prop = find_ratified_proposal(db, workspace_id=resolved.workspace.id,
                                  target_kind=target_kind, target_key=target_key)
    if prop is None:
        return {                         # RECHAZO EXPLÍCITO (no fallback a dry_run)
            "status": "ratification_required",
            "error": "no_ratified_proposal",
            "message": "Este commit requiere una Proposal ratificada por un humano.",
            "target": {"kind": target_kind, "key": target_key},
            "scope": resolved.scope_payload(),
        }
    return None
```

- Sin `Proposal` ratificada → el commit **se rechaza** con `ratification_required` (coherente con "sin fallback silencioso"). NO se degrada a `dry_run`.
- `dry_run` sigue siendo **preview**; la **autorización** es la `Proposal` ratificada.
- Al commitear con éxito, se marca la `Proposal` como consumida (link a la fila resultante) y se emite `proposal.ratified` en `events`.
- **Se mantiene intacto:** `dry_run`-default-true, `idempotency_key` obligatorio, auditoría before/after, replay idempotente (`get_existing_request_audit`).

---

## 6. Identidad del ratificador (cierra I1)

El punto más delicado: hoy cualquier token con `wis.context.write` puede "aprobar".

- **Nuevo scope `wis.context.ratify`**, otorgado **solo a clientes operados por humanos** (permiso de la app/usuario en Auth0), NO a los M2M de agentes.
- Los agentes conservan `wis.context.write` → pueden **proponer** y hacer **dry_run**, pero **no pueden ratificar**.
- `ratified_by` / `approved_by` se toman de los claims verificados del token (`sub`, y `email`/`name` si están), vía `_extract_actor_context`. El verifier ya está (`Auth0JWTTokenVerifier`); solo se agrega el scope y la lectura del claim humano.

Esto hace *"ellas deliberan (write/propose), yo decido (ratify)"* una propiedad del sistema, no una convención.

---

## 7. Nuevas tools MCP y impacto de contrato

Aditivas a las 17 actuales (registradas en `TOOL_SCOPES` + publicadas):

| Tool | Scope | Plane |
|---|---|---|
| `propose_change` | `wis.context.write` | crea una `Proposal` (`proposed`/`in_review`) |
| `list_proposals` | `wis.context.read` | lista propuestas + disenso por target |
| `ratify_proposal` | `wis.context.ratify` | transición `in_review → ratified` (humano) |
| `reject_proposal` | `wis.context.ratify` | transición `in_review → rejected` (humano) |

- **Contrato:** `all_published` pasa de **17 → 21** tools. Es un **cambio de contrato versionado y explícito**, NO drift: actualizar `scripts/mcp_validation_payloads.json` y los gates `validate_remote_mcp*.sh`, y documentarlo en `docs/mcp/README.md`.
- La extensión VS Code y Claude Desktop no requieren cambios para seguir funcionando (las tools nuevas son aditivas); la UI de ratificación se puede exponer luego.

---

## 8. Coherencia de contexto / staleness (Paso 6)

Las IAs actúan sobre snapshots point-in-time. `ContextScope` ya tiene `is_current`; `ContextSnapshot` **no** (hay que añadir `is_current bool default true` + `version int default 1`).

- Al ratificar una `Proposal` que cambia canon (`target_kind='decision'` o `context_item` canónico): marcar `is_current=false` en los `ContextScope`/`ContextSnapshot` dependientes.
- Un consumidor con `is_current=false` debe **re-resolver contexto** (nuevo snapshot) antes de actuar. Sin fallback al snapshot viejo (las read tools deben señalar la staleness en `resolution_metadata`).

---

## 9. Dogfood: oráculo money-path como primera `Proposal` real (Paso 5)

No es "un test": es la primera corrida real del loop.

1. Una IA propone las suposiciones `A1–A8` + las 7 invariantes del coffee-sale → `propose_change` (`in_review`).
2. WIS revisa (30 s por pregunta) vía `list_proposals`.
3. `ratify_proposal` → `ApprovedDecision` canónico (`approved_by` = humano verificado) + `ValidationRun`.

Ejercita I1, I2, I3 en un caso de alto riesgo (plata).

---

## 10. Plan de migración (reversible)

- `0005_deliberative_ratification` (`down_revision="0004_phase4_mcp_write_plane"`):
  - `upgrade()`: crea `proposals`; añade columnas a `approved_decisions`, `events`, `policy_state`; índices; CHECKs.
  - `downgrade()`: dropea columnas e índices nuevos y la tabla `proposals` (aditivo → reversible limpio).
- **Compat:** las 17 tools y el read/write plane actuales siguen funcionando; `approval_mode` se conserva deprecated una release.
- Seed: `seed_v5` gana `approval_policy_json` por defecto (labels/links=auto; decisions/money-path=ratify) sin romper datos existentes.

---

## 11. Plan de tests (gate de aceptación)

- **Unit:** resolver `requires_ratification` (tool > category > default); transiciones de `Proposal` válidas/ inválidas; `ratified_by` tomado del token.
- **E2E (MCP real, patrón de `tests/test_e2e_mcp_preflight.py`):**
  - propose → ratify → commit gateado **permitido**.
  - commit gateado **sin** `Proposal` ratificada → `ratification_required` (no muta, no dry_run silencioso).
  - token con `write` pero **sin** `ratify` → `ratify_proposal` = `forbidden/insufficient_scope`.
  - I2: dos `proposals` `in_review` coexisten sobre el mismo target; `list_proposals` las devuelve ambas.
  - idempotencia: `idempotency_key` repetido → replay, sin doble commit.
  - staleness: ratificar invalida `is_current`; el consumidor re-resuelve.
- **Contrato:** `validate_remote_mcp.sh` confirma 21 tools `all_published`, sin drift.

---

## 12. Secuencia de implementación (barato primero) — mapea a §9 de la orientación

| # | Paso | Riesgo | Estado |
|---|---|---|---|
| 0 | Verificar write path (scope, sin ratificación) | — | ✅ hecho |
| 1 | Modelo `Proposal` + lifecycle + migración `0005` (aditivo) | bajo | pendiente |
| 2 | Deliberation trail: `event_type` + `events.proposal_id` | bajo | pendiente |
| 3 | Ratification gate en el write path + tools propose/ratify | **medio** (toca `mcp/server.py`) | pendiente |
| 4 | Granularidad (`approval_policy_json` + resolver) | bajo | pendiente |
| 5 | Oráculo money-path como primera `Proposal` (dogfood) | medio | pendiente |
| 6 | Invalidación de snapshots stale post-ratificación | medio | pendiente |

Pasos 1–2 son **aditivos y no cambian comportamiento** (mergeables sin riesgo). El corte de comportamiento real es el Paso 3.

---

## 13. Riesgos y mitigaciones

- **Expansión de contrato (17→21):** mitigar actualizando gates `validate_remote_mcp*.sh` + payloads + `docs/mcp/README.md` en el mismo PR del Paso 3.
- **Bloqueo operativo si todo se gatea:** la granularidad (Paso 4) evita ahogar al humano; default `auto`, solo categorías de alto riesgo `ratify`.
- **Identidad humana mal atribuida:** el scope `wis.context.ratify` debe configurarse en Auth0 **solo** para el cliente humano; validado por el test de scope.
- **Staleness parcial:** si Paso 6 se difiere, documentar que la coherencia multi-consumidor no está garantizada hasta implementarlo.

---

## 14. No-goals / anti-patrones (de la orientación)

- ❌ Colapsar disenso en consenso antes de que el humano lo vea.
- ❌ RAG / recuperación difusa en el camino canónico (rompe determinismo).
- ❌ `approval_mode` global.
- ❌ Promover a canónico desde una IA sin `Proposal` ratificada.
- ❌ `approved_by="WIS"` como default no verificado.
- ❌ Actuar sobre snapshot stale post-ratificación.

---

## 15. Consecuencias

- **Positivas:** *"yo decido"* pasa de convención a invariante enforced; disenso visible; trail completo (qué + porqué + quién objetó); granularidad evita fricción innecesaria.
- **Costos:** una migración, +4 tools, cambio versionado de contrato, y trabajo de configuración en Auth0 (scope `ratify`).
- **Reversibilidad:** Pasos 1–2 y 4 son aditivos; el Paso 3 (gate) es el único con corte de comportamiento y va detrás de la granularidad para no bloquear flujos de bajo riesgo.

---

**Addendum (2026-07-04, blueprint v2):** `semantic_search` es descubrimiento read-only. La resolución canónica — `get_approved_decisions`, `_require_ratification`, el ensamblado de `get_project_brief` — es determinista y NUNCA consume resultados semánticos. El anti-patrón '❌ RAG en el camino canónico' sigue vigente; `semantic_search` no lo viola porque no participa en ninguna decisión de gobernanza.
