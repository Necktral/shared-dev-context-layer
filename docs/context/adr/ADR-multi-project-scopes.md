# ADR — Scopes current multi-proyecto (fin del mono-proyecto de facto)

- **Estado:** Proposed
- **Fecha:** 2026-07-04
- **Tipo:** Architecture Decision Record
- **Migración:** `0008_multi_project_scopes` (`down_revision="0007_write_plane_fixes"`)
- **Directiva fuente:** [`docs/blueprint/REVISION-DIRECTIVE.md`](../../blueprint/REVISION-DIRECTIVE.md) §D2 (promueve ADR-B3 a ADR formal; resuelve F05, F29)
- **Principio rector:** *El foco de trabajo es siempre un proyecto; el current es por proyecto, no global.*
- **Alcance:** modelo de datos canónico (`context_scopes`, migración `0003`→`0008`), resolución de scope (`task_service.py`, `focus_resolver.py`), API de tarea activa (`GET /active-task`, `GET /internal/tasks/active`, `POST /internal/events`).

> **NOTA DE ESQUELETO.** Este ADR se crea en WP-R0 como paso 1 del flujo non_additive; su **contenido completo se redacta al ejecutar WP-1.1** (docstring de la migración `0008`, lista verificada de lectores scope-aware, estrategia de downgrade con evidencia y plan de tests). Clasificación: **`persisted_contract` non_additive** — se ejecuta el flujo completo de 5 pasos de `CONTRACT-GOVERNANCE §3`.

---

## 1. Contexto y hallazgo (verificado en el código, no de memoria)

El índice `uq_context_scopes_single_current` (`0003:121-127`) es **UNIQUE GLOBAL sobre `is_current`**: a lo sumo **UNA** fila `is_current=true` en toda la base de datos. Consecuencia: el sistema es **mono-proyecto de facto** — dos proyectos no pueden tener foco current simultáneo, y los lectores del invariante resuelven el "scope current" con un `ORDER BY created_at DESC LIMIT 1` **global** (arbitrario entre proyectos):

| Lector | Comportamiento hoy | Evidencia |
|---|---|---|
| `task_service.get_active_task` | `is_current` global, `order by created_at desc limit 1` | `task_service.py:10-20` |
| `task_service.require_active_task` | ídem, propaga el mismo lookup | `task_service.py:47-51` |
| `focus_resolver.resolve_scope` / `canonical_scope` | lookup de scope current sin filtrar proyecto | `focus_resolver.py:175`, `:317` |
| `GET /active-task`, `GET /internal/tasks/active`, `POST /internal/events` | heredan la resolución global | `api/internal.py:48-54` |

**Conclusión (confirmada):** eliminar el UNIQUE global cambia la **semántica del dato persistido** `is_current` (de "≤1 fila en toda la BD" a "≤1 por proyecto"). Es un cambio `persisted_contract` non_additive, no una simple reindexación.

---

## 2. Decisión

1. **Current por `(workspace, project)`.** Se elimina `uq_context_scopes_single_current` y se crea el índice **simple** (sin `COALESCE`, que era rama muerta sugiriendo un diseño inexistente — F29):
   ```
   CREATE UNIQUE INDEX uq_context_scopes_current_per_project
     ON context_scopes (workspace_id, project_id) WHERE is_current
   ```
2. **`project_id` sigue `NOT NULL`.** No hay "scope current a nivel workspace": no tiene consumidor en la visión v1. La **política** a nivel workspace queda en `policy_state` (`workspace_id`/`project_id` nullable de WP-1.1b), no en el scope. Habilitar current de workspace exigiría `DROP NOT NULL` + `COALESCE` + revisar todos los joins de scope — coste real por valor especulativo; si v2 lo necesita, será su propia migración con su propio ADR.
3. **Lectores scope-aware en el MISMO PR.** Los 4 lectores enumerados en D2.3 se hacen scope-aware: con `project_id` explícito filtran el current de ESE proyecto; sin él, conservan `created_at desc` documentado como **"último proyecto enfocado"** (determinista, ya no arbitrario). `GET /active-task` y `GET /internal/tasks/active` ganan query param opcional `project_id`.
4. **Downgrade lossy-by-design.** El `downgrade()` primero colapsa a un único current — conserva SOLO el de `created_at` más reciente — y después recrea el índice global:
   ```
   UPDATE context_scopes SET is_current=false
     WHERE is_current AND id <> (
       SELECT id FROM context_scopes WHERE is_current ORDER BY created_at DESC LIMIT 1)
   ```
   Se documenta en el docstring de la migración y aquí como **lossy-by-design**.

---

## 3. Cambios al modelo de datos (migración `0008_multi_project_scopes`)

> A completar en WP-1.1. Contenido previsto (§3.1 de la directiva): drop de `uq_context_scopes_single_current`; creación de `uq_context_scopes_current_per_project`; `policy_state.workspace_id`/`project_id` nullable + FK + índice. `context_scopes.project_id` permanece `NOT NULL` (`0003:102`, `models/context_scope.py`). Downgrade lossy-by-design (§2.4). Numeración: `down_revision="0007_write_plane_fixes"`; `alembic heads` debe devolver exactamente 1 head.

---

## 4. Plan de tests (gate de aceptación)

> A completar en WP-1.1. Cobertura mínima prevista (D2.5):
> - dos proyectos con current simultáneo (imposible bajo el índice viejo, posible bajo el nuevo);
> - **resolución por proyecto:** con currents en P1 y P2, `get_active_task(project_id=P1)` devuelve la task de P1 y `GET /active-task?project_id=P2` la de P2;
> - **downgrade** sobre BD con 2 currents ⇒ conserva solo el `created_at` más reciente.

---

## 5. No-goals / anti-patrones

- ❌ Scope current a nivel workspace en v1 (sin consumidor; la política de workspace vive en `policy_state`).
- ❌ Índice con `COALESCE` (rama muerta, F29).
- ❌ Relajar `project_id` a nullable.
- ❌ Resolución global arbitraria: sin `project_id`, el fallback es "último enfocado" determinista, no arbitrario.

---

## 6. Consecuencias

- **Positivas:** el sistema deja de ser mono-proyecto de facto; el current pasa a ser por proyecto; la resolución sin `project_id` es determinista ("último enfocado") en vez de arbitraria.
- **Costos:** cambio `persisted_contract` non_additive (flujo de 5 pasos); 4 lectores tocados en el mismo PR; downgrade **lossy** (pierde currents no-más-recientes al revertir).
- **Reversibilidad:** el `downgrade()` recrea el índice global, pero es lossy-by-design: no reconstruye los currents colapsados.

---

## 7. Criterio de revisión

Revisar este ADR solo ante: aparición de un consumidor real de "scope current a nivel workspace" (que motivaría el `DROP NOT NULL` + `COALESCE` diferido a v2), o cambio del modelo de foco (proyecto ⇒ otra granularidad).

> **Contenido completo al ejecutar WP-1.1.**
