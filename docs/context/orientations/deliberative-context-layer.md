# Orientaciones de diseño — Capa de contexto deliberativo con ratificación humana

> **Repo:** `Necktral/shared-dev-context-layer`
> **Principio rector:** *Ellas deliberan, yo decido.*
> **Ubicación sugerida:** `docs/context/orientations/deliberative-context-layer.md` (canon)
> **Estado:** orientación de diseño. Grounded en el estado real del código (verificado, no de memoria).

---

## 0. Hallazgo que motiva este documento (estado real, verificado)

| | Enforced hoy | Evidencia |
|---|---|---|
| Quién puede escribir | ✅ Sí | `_scope_guard` exige scope `wis.context.write` en `mcp/server.py` |
| Intencionalidad de commit | ✅ Sí | `dry_run` defaultea `true`; commit exige `dry_run=false` + `idempotency_key` obligatorio |
| Auditoría de escritura | ✅ Sí | `record_write_audit` hashea before/after de toda escritura |
| **Ratificación humana de lo canónico** | ❌ **No** | `approval_mode="wis_controlled"` se guarda en `seed_v1` pero **no se lee en ningún lado del runtime** |
| **Estado de propuesta / deliberación** | ❌ **No** | No existe objeto `Proposal` ni concepto de ratificación en el código |
| **Identidad del que aprueba** | ❌ **No** | `approved_by="WIS"` es un default de columna, no una identidad verificada del token |

**Conclusión:** hoy *"yo decido"* es una convención sostenida por **quién tiene el token de escritura**, no una propiedad del sistema. Un agente con el scope `wis.context.write` que pase `dry_run=false` escribe canon sin humano en el medio, y la auditoría igual registra `approved_by="WIS"`. El objetivo de estas orientaciones es volver el *"yo decido"* **enforced**.

---

## 1. Principio rector

> **Ellas deliberan, yo decido.**

Esta frase es la especificación, no un eslogan. Define por exclusión:

- **Prohíbe** el consenso entre agentes y el rubber-stamp. Las IAs NO llegan a un acuerdo y te pasan un sello para firmar.
- **Exige** tres cosas que el modelo actual no tiene: un estado de propuesta donde la deliberación ocurra, disenso preservado, y ratificación informada.

El modo de falla a evitar: que las IAs colapsen en un falso consenso y te entreguen una sola posición. El modo sano: cuando difieren, ese desacuerdo te llega **a vos como señal**, con el mejor caso de cada lado. Si coinciden, decidís en un segundo. Si difieren, ahí es exactamente donde tu decisión vale.

---

## 2. Los tres invariantes de diseño (no negociables)

- **I1 — Ratificación humana para lo canónico.** Ninguna IA promueve una decisión a canónica sin ratificación humana explícita, en las categorías que lo requieran. (Cierra el gap de `approval_mode`.)
- **I2 — El disenso se preserva, no se colapsa.** Cuando los consumidores difieren sobre un target, el desacuerdo llega al humano como señal. El sistema no lo auto-resuelve.
- **I3 — Trail auditable de la decisión.** Toda transición a canónico registra quién propuso, quién objetó y con qué argumento. (`ContextWriteAudit` ya hashea *el qué*; falta *el porqué* y *el quién-objetó*.)

---

## 3. Cambios al modelo de datos

### 3.1 Nuevo objeto de primera clase: `Proposal`

El estado que falta. La deliberación necesita un lugar donde vivir.

- **Lifecycle:** `proposed → in_review → ratified | rejected | superseded`
- **Campos mínimos:** `proposer` (consumer_id), `target` (`decision_key` / `context_item` afectado + scope), `proposed_payload` (JSONB), `status`, `rationale`, timestamps.
- La **decisión ES la transición** `in_review → ratified`. Hoy existe el resultado (`ApprovedDecision`) pero no la transición.

### 3.2 `ApprovedDecision` deja de ser el estado

Pasa a ser el **resultado** de una `Proposal` ratificada. La transición `in_review → ratified`:
- crea/activa el `ApprovedDecision`,
- con `approved_by` = **identidad humana verificada del token**, no un default de columna,
- y encadena `superseded_by` si reemplaza una decisión previa.

El booleano `is_active` deja de cargar el estado; el estado vive en `Proposal`.

### 3.3 Deliberation trail sobre `Event` (append-only, ya existe)

Nuevos `event_type`, ligados por payload a `proposal_id`:
`proposal.raised`, `proposal.objected`, `proposal.counter`, `proposal.ratified`, `proposal.rejected`.
El **porqué** de cada decisión vive acá. Es el complemento del hash del *qué* que ya guarda `ContextWriteAudit`.

### 3.4 Granularidad de aprobación (reemplaza el `approval_mode` global)

`PolicyState.approval_mode` es hoy un campo único y muerto. Reemplazarlo por un **mapa por `item_type` / `decision.category` / tool**:
- qué clases **auto-commitean** (bajo riesgo: labels, links),
- cuáles **exigen ratificación** (alto riesgo: invariantes de money-path, escrituras al ledger canónico).

Sin granularidad: o gateás todo (el humano se ahoga) o no gateás nada (perdés el control). `"wis_controlled"` pasa de etiqueta a política ejecutable y granular.

---

## 4. El gate de escritura (lo que hay que cambiar)

**Hoy:** gate = `scope` + `dry_run`(default true) + `idempotency_key`. No hay gate de ratificación.

**Orientación:** en el write path (`mcp/server.py`, alrededor de `_write_audit_and_filter` y los handlers `upsert`/`append`/`link`/`archive`/`apply_sync`), antes de permitir el commit (`dry_run=false`) de una categoría **gateada**, exigir una `Proposal` en estado `ratified` que cubra ese target.

- Sin `Proposal` ratificada → el commit **se rechaza** (NO se degrada a `dry_run` silencioso — coherente con el principio "sin fallback silencioso" del propio repo).
- `dry_run` sigue siendo **preview**; la **autorización** es la `Proposal` ratificada.

**Mantener sin tocar:** `dry_run`-default-true (buen fail-safe), `idempotency_key` obligatorio, auditoría before/after.

---

## 5. Cómo deliberan "en conjunto" sin colapsar

- Varios consumidores emiten `proposals` / objeciones sobre el mismo target.
- El sistema **NO arbitra entre ellos.** Presenta al humano el conjunto de posiciones, cada una con su mejor caso y su trail.
- La precedencia por scope que ya hace `decision_service` (`task > project > workspace`) resuelve **precedencia de contexto**, NO arbitraje de decisión. El arbitraje es la ratificación humana.
- **Anti-patrón explícito:** que dos IAs "se pongan de acuerdo" y suban una sola posición. Si difieren, suben las dos.

---

## 6. Coherencia de contexto (el problema de staleness)

Las IAs actúan sobre snapshots point-in-time. Si una `Proposal` se ratifica en T1 y un consumidor sigue sobre un snapshot de T0, actúa sobre canon viejo.

- Al ratificar una `Proposal` que cambia el canon: marcar como **stale** los `ContextSnapshot` / `ContextScope` dependientes (usar `version` + `is_current`).
- Un consumidor con `is_current=false` debe **re-resolver contexto** (nuevo snapshot) antes de actuar. Sin fallback al snapshot viejo.
- Es el problema clásico de cache-coherence; es lo que muerde cuando hay varias IAs activas a la vez.

---

## 7. El oráculo como primera `Proposal` real (dogfood)

El money-path oracle no es "un test": es la **primera corrida real del loop de ratificación**.

1. Una IA propone las suposiciones `A1–A8` + las 7 invariantes del coffee-sale → `Proposal` en `in_review`.
2. WIS revisa las suposiciones marcadas (30 segundos por pregunta).
3. Ratifica / corrige → `ApprovedDecision` canónico (`approved_by` = humano verificado) + `ValidationRun`.

Ejercita **I1, I2, I3** en un caso de alto riesgo (plata) — el mejor stress test posible del principio.

---

## 8. Qué NO hacer (anti-patrones)

- ❌ Colapsar disenso en consenso antes de que el humano lo vea.
- ❌ RAG / recuperación difusa en el camino canónico (romper determinismo).
- ❌ Un `approval_mode` global (muere sin enforcement o gatea todo).
- ❌ Promover a canónico desde una IA sin `Proposal` ratificada.
- ❌ Dejar `approved_by="WIS"` como default no verificado (atarlo a la identidad del token humano).
- ❌ Actuar sobre un snapshot stale post-ratificación.

---

## 9. Secuencia de implementación (barato primero)

| # | Paso | Estado |
|---|---|---|
| 0 | Verificar el write path → gate por scope, sin ratificación | ✅ hecho |
| 1 | Modelo `Proposal` + lifecycle + migración alembic | pendiente |
| 2 | Deliberation trail: `event_type` nuevos sobre `Event`, ligados a `proposal_id` | pendiente |
| 3 | Ratification gate en el write path (bloquear commit gateado sin `Proposal` ratificada) | pendiente |
| 4 | Granularidad de aprobación (reemplazar `approval_mode` global por mapa por categoría) | pendiente |
| 5 | Oráculo money-path como primera `Proposal` (cierra el loop) | pendiente |
| 6 | Invalidación de snapshots stale post-ratificación | pendiente |

---

### Apéndice — glosario de anclaje al código

- `ContextItem` → definición canónica (`content_json` JSONB, `version`).
- `ApprovedDecision` → resultado de una `Proposal` ratificada (`constraints_json`, `approved_by`, `superseded_by`).
- `ValidationRun` → corrida oráculo-vs-realidad (`validation_type`, `status`, `details`).
- `ContextSnapshot` / `ContextScope` → vista point-in-time por consumidor (`is_current`, `policy_applied`).
- `Event` → trail append-only (portará la deliberación).
- `PolicyState.approval_mode` → hoy muerto; a reemplazar por política granular.
- `delegated_limited.apply_delegated_limited_policy` → filtro por allowlist + redacción de secretos por consumidor (ya funciona).
