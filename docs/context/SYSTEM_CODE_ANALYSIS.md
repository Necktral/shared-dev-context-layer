# Análisis de Código del Sistema
_Status: activo_
_Scope: backend · vscode-extension · mcp-server_

## 1. Objetivo

Documentar el análisis técnico del sistema `shared-dev-context-layer`: estructura de capas,
flujos de datos, contratos entre componentes, e issues de consistencia identificados en el código.

---

## 2. Estructura del sistema

```
shared-dev-context-layer/
├── backend/               FastAPI + SQLAlchemy + PostgreSQL
│   ├── app/api/           Rutas HTTP (health, public, internal)
│   ├── app/auth/          Verificador JWT Auth0
│   ├── app/core/          Configuración centralizada (Settings)
│   ├── app/db/            Sesión SQLAlchemy, modelos base, seeds
│   ├── app/mcp/           Servidor MCP (FastMCP, observabilidad)
│   ├── app/models/        Modelos ORM (Task, ContextItem, ...)
│   ├── app/policies/      Políticas delegadas
│   ├── app/schemas/       Esquemas Pydantic de entrada/salida
│   └── app/services/      Lógica de dominio
├── vscode-extension/      Extensión TypeScript (arquitectura hexagonal)
│   └── src/
│       ├── activation/    Bootstrap y registradores de comandos
│       ├── application/   Servicios de orquestación
│       ├── domain/        Tipos canónicos (sin dependencias externas)
│       ├── environment/   Inspector de entorno local
│       ├── infrastructure/Adaptadores (WISGateway, fixtures)
│       └── presentation/  Renderizadores de output
└── docs/                  Contratos, ADRs, specs y runbooks
```

---

## 3. Capas del backend

### 3.1 API HTTP (`app/api/`)

| Router    | Prefijo      | Descripción |
|-----------|--------------|-------------|
| `health`  | `/health`    | Liveness/readiness check |
| `public`  | `/`          | Alias de tarea activa y política |
| `internal`| `/internal`  | Endpoints de escritura (events, snapshots) |

Todos los endpoints de escritura requieren tarea activa y, cuando aplica, política activa.

### 3.2 MCP Server (`app/mcp/server.py`)

El servidor MCP expone 17 tools con OAuth2 por scope:

| Scope                    | Tools |
|--------------------------|-------|
| `wis.context.read`       | `get_active_task`, `get_context_snapshot`, `get_validation_status`, `get_approved_decisions`, `get_recent_errors`, `search_context`, `get_context_by_id`, `list_context_windows`, `resolve_related_items` |
| `wis.context.sync.read`  | `get_sync_status` |
| `wis.context.write`      | `preview_write_impact`, `upsert_context_item`, `append_context_event`, `link_context_entities`, `set_context_labels`, `archive_context_item` |
| `wis.context.sync.write` | `apply_sync_batch` |

El guard de scope (`_scope_guard`) se puede desactivar con `MCP_AUTH_BYPASS_LOCAL=true` para entornos
de desarrollo y pruebas.

### 3.3 Resolución de scope (`app/services/focus_resolver.py`)

`resolve_scope` implementa una cadena de resolución con precedencia explícita:

```
task_id → project_id → workspace_id → session_key → canonical_scope → legacy_active_task
```

Emite `scope_conflict` cuando los IDs suministrados no son consistentes entre sí
(e.g., `task_id` pertenece a un proyecto distinto del `project_id` suministrado).

### 3.4 Configuración (`app/core/config.py`)

`Settings` (Pydantic BaseSettings) valida en startup:

- `MCP_PUBLIC_BASE_URL`: requerida cuando auth está activo; debe ser `https://`, sin path ni query.
- `MCP_RESOURCE_ID`: debe ser URI absoluto; cae back a `MCP_AUTH0_AUDIENCE` si no se especifica.
- `MCP_LOG_LEVEL`: normalizado a mayúsculas; válido: `DEBUG|INFO|WARNING|ERROR|CRITICAL`.
- `MCP_ALLOWED_ORIGINS`: lista CSV deduplicada y normalizada a minúsculas.

---

## 4. Capa de extensión VS Code

La extensión sigue una arquitectura hexagonal de 5 capas (ver
`WIS_VSCODE_EXTENSION_ARCHITECTURE.md`):

```
Domain Core  →  Application  →  Infrastructure  →  Presentation
                     ↕
              Diagnostics / Evidence
```

El flujo de carga principal:

1. `LoadOperationalContextService.load()` orquesta la sesión, inspección local y carga del bundle.
2. `WISGateway` abstrae los dos modos de runtime:
   - `FixtureWISGateway` (`offline_fixture`): respuestas deterministas sin conectividad.
   - `McpWISGateway` (`mcp`): llamadas reales vía MCP streamable-http.
3. `composeOperationalContext` ensambla el `OperationalContextEnvelope`.
4. `ContextPresenter` renderiza en el output channel.

No existe fallback silencioso entre modos; el modo se define por configuración.

---

## 5. Modelo de datos principal

```
Workspace (1) ──< Project (1) ──< Task
                               ──< ContextItem ──< ContextItemLabel (normalizada)
                                               ──< ContextItemLink
                               ──< ContextSnapshot
                               ──< Event
                               ──< ValidationRun
                               ──< ApprovedDecision
```

Las labels se mantienen en dos lugares:
- `context_items.labels_json` (JSONB denormalizado, para lectura rápida)
- `context_item_labels` (tabla normalizada, para integridad referencial)

---

## 6. Issues de consistencia identificados

### 6.1 Bug: `upsert_context_item` no sincroniza `ContextItemLabel` (CORREGIDO)

**Ubicación**: `app/services/context_item_service.py` → `upsert_context_item`

**Descripción**: Al crear o actualizar un ítem con labels vía `upsert_context_item`, la función
actualizaba `context_items.labels_json` pero dejaba la tabla `context_item_labels` sin sincronizar.
Por contraste, `append_context_labels` mantiene ambas tablas en sincronía.

**Impacto**: La tabla `context_item_labels` quedaba desactualizada tras cualquier llamada a
`upsert_context_item` con labels, generando divergencia entre el estado denormalizado y el
normalizado.

**Corrección aplicada**: Se añadió un helper `_sync_labels_table` que borra y recrea las filas en
`context_item_labels` cada vez que `upsert_context_item` escribe labels. Esto unifica el
comportamiento con `append_context_labels`.

### 6.2 Observación: `apply_sync_batch` registra metadatos, no ejecuta operaciones

**Ubicación**: `app/mcp/server.py` → `apply_sync_batch`

**Descripción**: El tool `apply_sync_batch` recibe una lista de operaciones pero sólo persiste
metadatos del batch (`ContextSyncBatch`). Las operaciones individuales no se ejecutan dentro del
tool; se espera que el llamador las haya ejecutado previamente con las tools individuales.

**Evaluación**: Comportamiento by-design. El tool actúa como registro de auditoría transaccional,
no como ejecutor. Documentado aquí para evitar confusión en futuras integraciones.

### 6.3 Observación: wildcards en búsqueda de texto libre

**Ubicación**: `app/services/context_item_service.py` → `search_context_items`

**Descripción**: La cadena de búsqueda del usuario se interpola directamente en un patrón LIKE
(`f"%{query.strip()}%"`). Los caracteres `%` y `_` del input se tratan como comodines SQL.

**Evaluación**: No es un problema de seguridad (SQLAlchemy parametriza la consulta, previniendo
inyección SQL), pero puede producir resultados inesperados si el usuario busca literales que
contienen `%` o `_`. El comportamiento actual es aceptable para el volumen de datos proyectado;
se registra como deuda técnica menor.

---

## 7. Cobertura de tests

| Componente               | Tipo de test                  | Estado |
|--------------------------|-------------------------------|--------|
| `Settings` (config)      | Unitario (pytest)             | ✅ Completo |
| `Auth0JWTTokenVerifier`  | Unitario (pytest)             | ✅ Completo |
| `resolve_scope`          | Integración con seed DB       | ✅ Completo |
| MCP auth / scope guards  | Integración (FastMCP test app)| ✅ Completo |
| MCP tool metadata        | Integración (FastMCP test app)| ✅ Completo |
| MCP observabilidad       | Integración (FastMCP test app)| ✅ Completo |
| `upsert_context_item`    | Unitario (pytest, in-memory)  | ✅ Añadido en este análisis |
| VSCode extension (144 tests) | Unitario (node:test)     | ✅ Completo |

---

## 8. Puntos de extensión y riesgos

| Área                        | Observación |
|-----------------------------|-------------|
| Auth0 JWKS cache            | `lru_cache` sin TTL; un refresh de JWKS requiere reinicio del proceso. Aceptable para producción con JWKs estables. |
| `ContextScope.is_current`   | Un único scope activo por workspace; la resolución de conflictos si hay varios activos se basa en `created_at DESC`. Invariante a mantener en mutaciones. |
| `MCP_ALLOWED_ORIGINS`       | Si la lista está vacía el guard de origen es permisivo (warning emitido). Asegurar configuración explícita en producción. |
| `preview_write_impact`      | Genera una key de preview efímera (`preview-{uuid}`); nunca persiste. Correcto para dry-run. |
| `dry_run` en sync batch     | El batch en dry_run no se persiste en `ContextSyncBatch`. Correcto: no contamina el historial de auditoría. |

---

## 9. Cross-links

- Arquitectura: `WIS_VSCODE_EXTENSION_ARCHITECTURE.md`
- Contrato control plane: `WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
- Deuda técnica: `TECHNICAL-DEBT-REGISTER.md`
- Runbook MCP: `../mcp/README.md`
