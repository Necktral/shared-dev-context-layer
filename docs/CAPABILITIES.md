# Especificación de Capacidades — Shared Dev Context Layer

> **Fuente de verdad: el código, no los docs.** Auditoría multi-agente del 2026-07-04 sobre el árbol de trabajo
> (`/media/wis/086880D36880C0C4/desarrollos/shared-dev-context-layer`, commit `0133208`).
> Cada afirmación cita `fichero:línea`. Generada como referencia de ingeniería para la fase de construcción.

**Alcance:** 6 subsistemas · 207 capacidades documentadas.

**Estado de verificación:** cada subsistema tenía prevista doble verificación adversarial (exactitud + completitud). Por límite de sesión del plan, solo `backend-http-auth` completó ambas; el resto queda con verificación parcial (los defectos críticos del plano MCP fueron verificados a mano de forma independiente). Ver apéndice A.

## Índice

1. Plano de tools MCP del backend (`mcp-tools`)
2. Modelo de datos y servicios de dominio del backend (`backend-domain`)
3. API HTTP, autenticación y configuración del backend (`backend-http-auth`)
4. Extensión VS Code — control plane remoto (`ext-control-plane`)
5. Extensión VS Code — runtime local (Codex + Postgres local) (`ext-local-runtime`)
6. Operación: scripts, CI, docker, integraciones (`ops-scripts-ci`)
7. Apéndice A — Hallazgos de verificación
8. Apéndice B — obsidian-mind (investigación)

## 1. Plano de tools MCP del backend

Servidor FastMCP "WIS Context Sync MCP" (streamable-http en /mcp, host 0.0.0.0, puerto settings.mcp_port=8002) que expone 21 @mcp.tool registradas en TOOL_SCOPES: 9 de lectura (wis.context.read), 1 de lectura de sync (wis.context.sync.read), 6 de escritura (wis.context.write), 1 de sync write (wis.context.sync.write), propose/list del plano deliberativo y 2 de ratificación (wis.context.ratify). Cada tool atraviesa la cadena: resolve_scope → _scope_guard (OAuth por scope, con bypass local) → [escrituras: _ensure_idempotency_key → replay idempotente vía context_write_audit → _require_ratification] → servicio → auditoría (write_audit + publish_audit) → filtro delegated_limited. El transporte está envuelto en MCPTransportObservabilityASGI (Origin guard, logging JSON estructurado, detección de contract drift) y publica /.well-known/oauth-protected-resource. Defectos conocidos confirmados en código: apply_sync_batch no aplica las operations en modo commit (solo persiste la fila de batch), y ratify_proposal/reject_proposal se anuncian con readOnlyHint=true pese a ser escrituras reales.

### 1.1 `get_active_task`  ·  _mcp_tool_

**Interfaz:** `get_active_task(workspace_id: str|None=None, project_id: str|None=None, task_id: str|None=None, consumer: str|None=None, session_key: str|None=None) -> dict`

Lee la tarea activa del scope resuelto. Scope OAuth: wis.context.read; readOnlyHint anunciado=true; real=lectura (solo escribe publish_audit). Gates: _resolve_scope_or_error (errores: scope_invalid/scope_not_found/scope_conflict/no_scope/no_active_task) → _scope_guard('get_active_task') → _apply_policy_and_audit (record_publish_audit destination='chatgpt_developer_mode', result='delivered' + filtro delegated_limited). Respuesta: {status:'ok', task:{id, workspace_id, project_id, title, goal, status, priority, repo, branch, next_action, current_phase, is_active, created_at, updated_at, last_snapshot_at, last_validation_status}, mode: settings.system_mode, scope, resolution_metadata}.

**Evidencia:** backend/app/mcp/server.py:539-588; backend/app/mcp/server.py:60; backend/app/mcp/server.py:210-226; backend/app/policies/delegated_limited.py:12

⚠️ **Caveats:** La resolución de scope se ejecuta ANTES del scope guard: un caller sin token recibe payloads de error de scope con resolution_metadata y dispara queries DB sin autenticar (patrón común a las 21 tools).

### 1.2 `get_context_snapshot`  ·  _mcp_tool_

**Interfaz:** `get_context_snapshot(workspace_id: str|None=None, project_id: str|None=None, task_id: str|None=None, consumer: str|None=None, session_key: str|None=None) -> dict`

Devuelve el último ContextSnapshot de la tarea si existe y su snapshot_content contiene 'identity' (source='database'); si no, genera build_operational_snapshot al vuelo (source='derived_runtime'). Scope: wis.context.read. Respuesta: {task_id, status:'ok', source:'database'|'derived_runtime', scope, consumer_context, resolution_metadata, snapshot, metadata:{policy: settings.system_mode, origin: generated_from, created_at}}. Misma cadena de gates que get_active_task.

**Evidencia:** backend/app/mcp/server.py:591-659

⚠️ **Caveats:** Un snapshot persistido cuyo contenido no sea dict o no tenga clave 'identity' se ignora silenciosamente y se deriva en runtime.

### 1.3 `get_recent_errors`  ·  _mcp_tool_

**Interfaz:** `get_recent_errors(limit: int = 20, window_hours: int = 24, workspace_id: str|None=None, project_id: str|None=None, task_id: str|None=None, consumer: str|None=None, session_key: str|None=None) -> dict`

Lista errores recientes de la tarea activa vía list_recent_errors_for_task. Scope: wis.context.read. Respuesta: {status:'ok', task_id, scope, resolution_metadata, window_hours, limit, total, errors:[{id, workspace_id, project_id, task_id, event_type, created_at, summary, source, severity, payload}]}.

**Evidencia:** backend/app/mcp/server.py:662-706; backend/app/mcp/server.py:247-259

⚠️ **Caveats:** limit y window_hours no tienen validación de rango en la tool (se pasan tal cual al servicio).

### 1.4 `get_validation_status`  ·  _mcp_tool_

**Interfaz:** `get_validation_status(workspace_id: str|None=None, project_id: str|None=None, task_id: str|None=None, consumer: str|None=None, session_key: str|None=None) -> dict`

Última ValidationRun del scope (workspace+project+task). Scope: wis.context.read. Sin run: {status:'ok', task_id, scope, resolution_metadata, current_status:'unknown', last_validation_type:None, last_validation_source:None, last_validation_at:None, summary:'No validation run available.', details:{}}. Con run: current_status/last_validation_type/last_validation_source/last_validation_at (isoformat)/summary/details del registro.

**Evidencia:** backend/app/mcp/server.py:709-772

### 1.5 `get_approved_decisions`  ·  _mcp_tool_

**Interfaz:** `get_approved_decisions(workspace_id: str|None=None, project_id: str|None=None, task_id: str|None=None, consumer: str|None=None, session_key: str|None=None) -> dict`

Lista decisiones aprobadas activas del scope vía list_active_decisions_for_scope. Scope: wis.context.read. Respuesta: {status:'ok', task_id, scope, resolution_metadata, total, decisions:[{id, workspace_id, project_id, task_id, decision_key, title, category, decision, rationale, constraints (constraints_json), approved_at, is_active, updated_at}]}.

**Evidencia:** backend/app/mcp/server.py:775-820; backend/app/mcp/server.py:229-244

### 1.6 `search_context`  ·  _mcp_tool_

**Interfaz:** `search_context(query: str|None=None, item_type: str|None=None, status: str|None='active', limit: int = 20, offset: int = 0, workspace_id: str|None=None, project_id: str|None=None, task_id: str|None=None, consumer: str|None=None, session_key: str|None=None) -> dict`

Busca context items en el scope vía search_context_items_service. Scope: wis.context.read. Respuesta: {status:'ok', scope, resolution_metadata, query, total (len de la página devuelta, no total global), limit, offset, items:[context_item_to_dict]}.

**Evidencia:** backend/app/mcp/server.py:823-878

⚠️ **Caveats:** 'total' es len(rows) de la página, no el conteo total de coincidencias; no hay cursor de paginación.

### 1.7 `get_context_by_id`  ·  _mcp_tool_

**Interfaz:** `get_context_by_id(context_item_id: str, workspace_id: str|None=None, project_id: str|None=None, task_id: str|None=None, consumer: str|None=None, session_key: str|None=None) -> dict`

Obtiene un context item por UUID dentro del workspace resuelto. Scope: wis.context.read. UUID inválido → _invalid_request('context_item_id debe ser UUID válido.', +context_item_id). Respuesta: {status:'ok'|'not_found', scope, resolution_metadata, context_item_id, item: dict|None}.

**Evidencia:** backend/app/mcp/server.py:881-932; backend/app/mcp/server.py:423-431

### 1.8 `list_context_windows`  ·  _mcp_tool_

**Interfaz:** `list_context_windows(window_hours: int = 24, limit: int = 20, workspace_id: str|None=None, project_id: str|None=None, task_id: str|None=None, consumer: str|None=None, session_key: str|None=None) -> dict`

Resumen de actividad por ventana temporal vía list_context_windows_service; el dict del servicio se hace spread en la respuesta. Scope: wis.context.read. Campos que sobreviven el allowlist delegated_limited: status, scope, resolution_metadata, window_hours, since, items_total, errors_total, snapshots_total, items.

**Evidencia:** backend/app/mcp/server.py:935-980; backend/app/policies/delegated_limited.py:39-49

⚠️ **Caveats:** Cualquier campo extra que devuelva el servicio y no esté en el allowlist se descarta silenciosamente.

### 1.9 `resolve_related_items`  ·  _mcp_tool_

**Interfaz:** `resolve_related_items(context_item_id: str, limit: int = 20, workspace_id: str|None=None, project_id: str|None=None, task_id: str|None=None, consumer: str|None=None, session_key: str|None=None) -> dict`

Resuelve entidades relacionadas de un item vía resolve_related_items_service. Scope: wis.context.read. UUID inválido → invalid_request. Respuesta: {status:'ok', scope, resolution_metadata, context_item_id, total, related}.

**Evidencia:** backend/app/mcp/server.py:983-1037

### 1.10 `get_sync_status`  ·  _mcp_tool_

**Interfaz:** `get_sync_status(limit: int = 20, workspace_id: str|None=None, project_id: str|None=None, task_id: str|None=None, consumer: str|None=None, session_key: str|None=None) -> dict`

Lista batches de sync recientes vía get_sync_status_service. Scope: wis.context.sync.read (único read con scope distinto). readOnlyHint=true. Respuesta: {status:'ok', scope, resolution_metadata, total, batches}.

**Evidencia:** backend/app/mcp/server.py:1040-1084; backend/app/mcp/server.py:69

### 1.11 `preview_write_impact`  ·  _mcp_tool_

**Interfaz:** `preview_write_impact(operation: str, payload: dict[str, Any]|None=None, workspace_id: str|None=None, project_id: str|None=None, task_id: str|None=None, consumer: str|None=None, session_key: str|None=None) -> dict`

Preview no mutante del impacto de una operación de escritura. Scope: wis.context.write, por lo que readOnlyHint anunciado=false, pero NUNCA muta tablas de dominio (solo publish_audit). Respuesta: {status:'ok', scope, resolution_metadata, operation, dry_run: true (siempre), impact:{operation, dry_run:true, estimated_writes: 1 si operation ∈ {'upsert_context_item','append_context_event','archive_context_item'} sino 0, preview_item_key: payload['item_key'] o 'preview-<uuid4>', payload_keys: sorted(payload.keys())}, requires_scopes: TOOL_SCOPES.get(operation, [])}. No usa idempotency ni ratificación.

**Evidencia:** backend/app/mcp/server.py:1087-1135; backend/app/services/context_item_service.py:475-476

⚠️ **Caveats:** Clasificación anunciada≠real: se anuncia como write (readOnlyHint=false) siendo de facto lectura. 'operation' no se valida contra un enum; cualquier string devuelve estimated_writes=0 y requires_scopes=[].

### 1.12 `upsert_context_item`  ·  _mcp_tool_

**Interfaz:** `upsert_context_item(item_key: str, item_type: str, title: str, content: dict[str, Any]|None=None, labels: list[str]|None=None, expected_version: int|None=None, dry_run: bool = True, idempotency_key: str|None=None, workspace_id: str|None=None, project_id: str|None=None, task_id: str|None=None, consumer: str|None=None, session_key: str|None=None) -> dict`

Crea/actualiza context item. Scope: wis.context.write. Cadena completa: resolve_scope → _scope_guard → _ensure_idempotency_key (obligatorio si dry_run=false) → request_id = idempotency_key o 'dryrun-<uuid4>' → _existing_replay_payload (replay por workspace_id+tool_name+request_id) → _require_ratification(target_kind='context_item', target_key=item_key, category=item_type) → upsert_context_item_service(expected_version para control optimista, actor=actor_sub) → _write_audit_and_filter. Respuesta: {status:'ok', scope, resolution_metadata, dry_run, request_id, result, before, after, idempotent_replay:false, audit_ref:{write_audit_id, created_at}}.

**Evidencia:** backend/app/mcp/server.py:1189-1282; backend/app/mcp/server.py:1138-1186; backend/app/mcp/server.py:2102-2131

⚠️ **Caveats:** Si se pasa idempotency_key con dry_run=true, el audit se registra con ese request_id y un commit posterior (dry_run=false, misma key) será tratado como replay: devuelve result del dry_run y NO ejecuta el commit (get_existing_request_audit no distingue dry_run). Aplica a todas las write tools con replay.

### 1.13 `append_context_event`  ·  _mcp_tool_

**Interfaz:** `append_context_event(event_type: str, summary: str, source: str = 'mcp', severity: str = 'info', metadata_json: dict[str, Any]|None=None, dry_run: bool = True, idempotency_key: str|None=None, + 5 params de scope comunes) -> dict`

Añade un Event a la tarea activa. Scope: wis.context.write. Misma cadena de gates que upsert (ratificación con target_key=f'event:{event_type}', category=None). dry_run=true: result='dry_run' y event={event_type, summary, source, severity, metadata} sin persistir Event (pero SÍ persiste write_audit+publish_audit). Commit: create_event_for_task → result='created', event=_event_to_dict(creado). Respuesta: {status, scope, resolution_metadata, dry_run, request_id, result, event, idempotent_replay:false, audit_ref}.

**Evidencia:** backend/app/mcp/server.py:1285-1404

⚠️ **Caveats:** El dry_run no es 100% no-mutante: registra filas en context_write_audit y publish_audit.

### 1.14 `link_context_entities`  ·  _mcp_tool_

**Interfaz:** `link_context_entities(source_item_id: str, target_item_id: str, relation: str, metadata: dict[str, Any]|None=None, dry_run: bool = True, idempotency_key: str|None=None, + 5 params de scope comunes) -> dict`

Crea/actualiza relación entre dos context items. Scope: wis.context.write. Gates: scope → guard → idempotency → replay → _require_ratification(target_key=source_item_id) → validación UUID de ambos ids ('source_item_id y target_item_id deben ser UUID válidos.') → link_context_entities_service → _write_audit_and_filter. Respuesta: {status:'ok', scope, resolution_metadata, dry_run, request_id, result, before, after, idempotent_replay:false, audit_ref}.

**Evidencia:** backend/app/mcp/server.py:1407-1502

⚠️ **Caveats:** La validación de UUID va DESPUÉS del gate de ratificación (orden distinto a set_context_labels/archive, donde el UUID se valida antes del gate).

### 1.15 `set_context_labels`  ·  _mcp_tool_

**Interfaz:** `set_context_labels(context_item_id: str, labels: list[str], dry_run: bool = True, idempotency_key: str|None=None, + 5 params de scope comunes) -> dict`

Pese al nombre 'set', llama append_context_labels_service: normaliza (strip, dedup, sort) y hace UNIÓN con las labels existentes (labels_json ∪ nuevas); reconstruye la tabla ContextItemLabel con la unión. Scope: wis.context.write. Gates: scope → guard → idempotency → replay → validación UUID → _require_ratification(target_key=context_item_id). result puede ser 'not_found' si el item no existe. Respuesta: {status:'ok', scope, resolution_metadata, dry_run, request_id, result, before, after, idempotent_replay:false, audit_ref}.

**Evidencia:** backend/app/mcp/server.py:1505-1595; backend/app/services/context_item_service.py:284-315

⚠️ **Caveats:** Semántica anunciada≠real: no reemplaza ni permite eliminar labels, solo añade (unión). result='not_found' viaja dentro de una respuesta con status='ok'.

### 1.16 `archive_context_item`  ·  _mcp_tool_

**Interfaz:** `archive_context_item(context_item_id: str, dry_run: bool = True, idempotency_key: str|None=None, + 5 params de scope comunes) -> dict`

Archiva un context item vía archive_context_item_service. Scope: wis.context.write. Gates: scope → guard → idempotency → replay → validación UUID → _require_ratification(target_key=context_item_id) → servicio → _write_audit_and_filter. Respuesta: {status:'ok', scope, resolution_metadata, dry_run, request_id, result, before, after, idempotent_replay:false, audit_ref}.

**Evidencia:** backend/app/mcp/server.py:1598-1686

### 1.17 `apply_sync_batch`  ·  _mcp_tool_

**Interfaz:** `apply_sync_batch(operations: list[dict[str, Any]], dry_run: bool = True, idempotency_key: str|None=None, + 5 params de scope comunes) -> dict`

Scope: wis.context.sync.write. Gates: scope → guard → idempotency → replay → _require_ratification(target_key='sync_batch'). dry_run: NO persiste batch (comentario explícito línea 1743), devuelve batch={id:null, status:'dry_run', operation_count, idempotency_key} y result='dry_run'. Commit: create_or_reuse_sync_batch (reusa por workspace_id+idempotency_key → idempotent_replay=true si existía) crea SOLO la fila ContextSyncBatch con status='applied', operation_count y summary={operations: len, dry_run, operation_names:[op.get('operation','unknown')]}. Respuesta commit: {status:'ok', scope, resolution_metadata, dry_run:false, request_id, result:'applied', summary, batch:{id, status, operation_count, idempotency_key}, idempotent_replay, audit_ref}.

**Evidencia:** backend/app/mcp/server.py:1689-1815; backend/app/services/context_item_service.py:438-472

⚠️ **Caveats:** DEFECTO CONOCIDO CONFIRMADO: en modo commit NO aplica las operations a las tablas de dominio; solo persiste la fila de batch marcada 'applied'. Además tiene doble mecanismo de idempotencia (replay por write_audit + reuse por batch) que pueden divergir.

### 1.18 `propose_change`  ·  _mcp_tool_

**Interfaz:** `propose_change(target_kind: str, target_key: str, rationale: str, proposed_payload: dict[str, Any]|None=None, dry_run: bool = False, idempotency_key: str|None=None, + 5 params de scope comunes) -> dict`

Crea una Proposal para ratificación humana. Scope: wis.context.write; readOnlyHint=false (correcto). target_kind válido ∈ ('decision','context_item') (PROPOSAL_TARGET_KINDS). dry_run=true: valida target_kind y devuelve {status:'ok', dry_run:true, result:'dry_run', scope, resolution_metadata, preview:{target_kind, target_key}}. Commit: create_proposal (idempotencia propia: si idempotency_key coincide con Proposal existente del workspace, la reusa), transición 'proposed'→'in_review', evento deliberativo 'proposal.raised' si task_id y project_id no nulos, db.commit(). Respuesta: {status:'ok', scope, resolution_metadata, proposal:{id, workspace_id, project_id, task_id, target_kind, target_key, status, rationale, proposed_payload, ratified_by, ratified_at, ratified_decision_id, created_at}}. InvalidProposalInput → invalid_request.

**Evidencia:** backend/app/mcp/server.py:2134-2206; backend/app/models/proposal.py:11-12; backend/app/services/proposal_service.py:35-84

⚠️ **Caveats:** Inconsistencias vs. el resto del write plane: dry_run default=False (los demás True); NO pasa por _ensure_idempotency_key, _existing_replay_payload, _require_ratification ni _write_audit_and_filter (sin fila en context_write_audit, sin publish_audit, sin audit_ref, sin filtro delegated_limited — TOOL_ALLOWLISTS tampoco tiene entrada, así que pasa todo).

### 1.19 `list_proposals`  ·  _mcp_tool_

**Interfaz:** `list_proposals(target_kind: str|None=None, target_key: str|None=None, status: str|None=None, limit: int = 50, + 5 params de scope comunes) -> dict`

Scope: wis.context.read. Si target_kind Y target_key: list_proposals_for_target (filtro opcional por status, orden created_at desc). Si no: SELECT por workspace con filtro status opcional, ORDER BY created_at DESC LIMIT limit (default 50). Respuesta: {status:'ok', scope, resolution_metadata, total, proposals:[_proposal_to_dict]}. No pasa por filtro delegated_limited ni auditoría.

**Evidencia:** backend/app/mcp/server.py:2209-2253; backend/app/services/proposal_service.py:122-137

⚠️ **Caveats:** El parámetro limit se IGNORA en la rama target_kind+target_key (list_proposals_for_target no aplica limit).

### 1.20 `ratify_proposal`  ·  _mcp_tool_

**Interfaz:** `ratify_proposal(proposal_id: str, + 5 params de scope comunes) -> dict`

Scope: wis.context.ratify. ESCRITURA REAL anunciada como readOnlyHint=true (defecto: _is_write_tool solo detecta sufijo '.write'). Flujo: UUID inválido → invalid_request; proposal inexistente o de otro workspace → {status:'not_found', message:'Proposal no encontrada en este workspace.'}. Si target_kind=='decision': construye/actualiza ApprovedDecision con decision_key=payload.decision_key o target_key, title=payload.title o target_key, decision=payload.decision o rationale, rationale=payload.rationale o rationale, category=payload.category o 'general', constraints_json=payload.constraints o {}, approved_by=actor_sub, is_active=true; upsert in-place si ya existe (workspace_id, decision_key, task_id, project_id). transition_proposal(→'ratified', ratified_by=actor obligatorio no vacío). Evento 'proposal.ratified' si task+project. invalidate_context_for_scope → campo 'staleness'. db.commit(). Respuesta ok: {status:'ok', scope, resolution_metadata, proposal, ratified_decision_id: str|None, staleness}. Errores: {status:'invalid_transition', message, proposal, scope} (InvalidProposalTransition, sin resolution_metadata), invalid_request (InvalidProposalInput), {status:'error', error:'ratify_failed', message} (Exception genérica con rollback).

**Evidencia:** backend/app/mcp/server.py:2256-2363; backend/app/mcp/server.py:1838-1840; backend/app/services/proposal_service.py:86-115

⚠️ **Caveats:** DEFECTO CONOCIDO CONFIRMADO: readOnlyHint=true anunciado siendo write. Para target_kind=='context_item' no crea decisión (ratified_decision_id=None), solo marca la Proposal ratificada (habilita el gate _require_ratification). Sin dry_run, sin idempotency_key, sin context_write_audit ni publish_audit. Transiciones válidas hacia 'ratified' solo desde estados permitidos en ALLOWED_TRANSITIONS.

### 1.21 `reject_proposal`  ·  _mcp_tool_

**Interfaz:** `reject_proposal(proposal_id: str, reason: str|None=None, + 5 params de scope comunes) -> dict`

Scope: wis.context.ratify. ESCRITURA REAL anunciada readOnlyHint=true. UUID inválido → invalid_request; no encontrada/otro workspace → not_found. transition_proposal(→'rejected'); evento 'proposal.rejected' con summary 'Rechazada por {actor}' + ': {reason}' si reason; db.commit(). Respuesta: {status:'ok', scope, resolution_metadata, proposal}. InvalidProposalTransition → {status:'invalid_transition', message, proposal, scope}.

**Evidencia:** backend/app/mcp/server.py:2366-2417

⚠️ **Caveats:** Mismo defecto readOnlyHint=true. 'reason' solo se persiste embebido en el summary del evento deliberativo, no en la Proposal. Sin auditoría de escritura.

### 1.22 `TOOL_SCOPES`  ·  _guard_

**Interfaz:** `dict[str, list[str]] con 21 entradas: 9× ['wis.context.read'] (get_active_task, get_context_snapshot, get_recent_errors, get_validation_status, get_approved_decisions, search_context, get_context_by_id, list_context_windows, resolve_related_items) + list_proposals; get_sync_status: ['wis.context.sync.read']; preview_write_impact, upsert_context_item, append_context_event, link_context_entities, set_context_labels, archive_context_item, propose_change: ['wis.context.write']; apply_sync_batch: ['wis.context.sync.write']; ratify_proposal, reject_proposal: ['wis.context.ratify']`

Registro central scope→tool usado por _scope_guard, metadata securitySchemes/readOnlyHint y detección de drift en tools/list. RESOURCE_SCOPES_SUPPORTED = ['wis.context.read','wis.context.sync.read','wis.context.write','wis.context.sync.write','wis.context.ratify'].

**Evidencia:** backend/app/mcp/server.py:59-89

⚠️ **Caveats:** readOnlyHint se deriva SOLO de '.write' en algún scope (_is_write_tool), lo que clasifica mal ratify/reject (write reales, hint read-only) y preview_write_impact (read real, hint write).

### 1.23 `_scope_guard`  ·  _guard_

**Interfaz:** `_scope_guard(tool_name: str) -> dict|None`

Si TOOL_SCOPES no tiene entrada → None (permite). Si settings.mcp_auth_bypass_local=true → permite siempre y emite mcp_scope_guard_evaluated con bypass_local=true. Sin token → {status:'unauthorized', error:'invalid_token', message:'Authentication required for this tool.', required_scopes, present_scopes:[], _meta:{'mcp/www_authenticate': 'Bearer error=..., error_description=..., scope=..., resource_metadata=...'}} + evento mcp_auth_missing. Scopes insuficientes → {status:'forbidden', error:'insufficient_scope', message:'Token does not include required scopes for this tool.', required_scopes, present_scopes, missing_scopes, _meta} + evento mcp_auth_scope_denied. Permitido → evento mcp_scope_guard_evaluated outcome='allowed'. El caller siempre añade scope y resolution_metadata al payload de error.

**Evidencia:** backend/app/mcp/server.py:337-420; backend/app/mcp/server.py:131-153

⚠️ **Caveats:** El bypass local desactiva el guard aunque mcp_auth_enabled=true. resource_metadata solo se incluye en WWW-Authenticate si auth runtime activo y mcp_public_base_url configurado.

### 1.24 `_ensure_idempotency_key`  ·  _guard_

**Interfaz:** `_ensure_idempotency_key(*, resolved: ResolvedScope, idempotency_key: str|None, dry_run: bool) -> dict|None`

Con dry_run=true → None (no exige key). Con dry_run=false y key vacía/whitespace → {status:'invalid_request', message:'idempotency_key es obligatorio cuando dry_run=false.', scope, resolution_metadata, dry_run}. Aplicado por: upsert_context_item, append_context_event, link_context_entities, set_context_labels, archive_context_item, apply_sync_batch. NO aplicado por propose_change/ratify/reject.

**Evidencia:** backend/app/mcp/server.py:1138-1153

### 1.25 `_existing_replay_payload (replay idempotente)`  ·  _guard_

**Interfaz:** `_existing_replay_payload(db, *, resolved, tool_name: str, request_id: str, dry_run: bool) -> dict|None; lookup: get_existing_request_audit por (workspace_id, tool_name, request_id) en context_write_audit`

Si existe fila de audit con el mismo request_id para el tool en el workspace, devuelve sin ejecutar: {status:'ok', scope, resolution_metadata, dry_run (de la llamada ACTUAL), request_id, result (del audit almacenado), idempotent_replay:true, audit_ref:{write_audit_id, created_at}}, filtrado por delegated_limited. request_id = idempotency_key o 'dryrun-<uuid4>' (los dry_run sin key nunca colisionan).

**Evidencia:** backend/app/mcp/server.py:1156-1186; backend/app/audit/write_audit_service.py:19-32

⚠️ **Caveats:** El replay NO devuelve before/after ni event originales (solo se almacenan hashes sha256 en el audit). No distingue dry_run: una llamada dry_run=true con idempotency_key 'quema' la key y bloquea el commit posterior (devuelve replay del dry_run).

### 1.26 `_require_ratification`  ·  _guard_

**Interfaz:** `_require_ratification(db, resolved, *, tool_name: str, target_kind: str, target_key: str, category: str|None, dry_run: bool) -> dict|None`

dry_run=true → None (siempre preview). Política desde policy_state: DEFAULT_APPROVAL_POLICY={'by_tool':{},'by_category':{},'default':'auto'}; precedencia by_tool > by_category > default; solo el modo 'ratify' gatea. Si gatea y NO existe Proposal ratificada para (workspace_id, target_kind, target_key) → {status:'ratification_required', error:'no_ratified_proposal', message:'Este commit requiere una Proposal ratificada por un humano.', target:{kind, key}, tool, scope, resolution_metadata}. Default de fábrica = 'auto': no gatea nada hasta configurar la política.

**Evidencia:** backend/app/mcp/server.py:2102-2131; backend/app/services/approval_policy_service.py:15-47

⚠️ **Caveats:** El rechazo se produce antes de registrar write_audit: los intentos bloqueados por ratificación NO dejan fila en context_write_audit.

### 1.27 `_write_audit_and_filter`  ·  _guard_

**Interfaz:** `_write_audit_and_filter(db, *, tool_name, resolved, request_id, dry_run, result, subject_id, before_payload, after_payload, response_payload) -> dict`

Cadena de auditoría del write plane: (1) record_write_audit en context_write_audit con actor_sub (claim sub sin verificar del token, o client_id, o 'local_bypass'), scopes, before_hash/after_hash (sha256 de JSON canónico sort_keys), result, dry_run, metadata={consumer_context, resolution_metadata}; (2) record_publish_audit destination='chatgpt_developer_mode', package_type=tool_name, fields_included=sorted(response.keys()), fields_redacted=[], result; (3) añade audit_ref={write_audit_id, created_at}; (4) filtra con apply_delegated_limited_policy. Lectura equivalente: _apply_policy_and_audit (solo publish_audit result='delivered' + filtro).

**Evidencia:** backend/app/mcp/server.py:453-500; backend/app/mcp/server.py:434-450; backend/app/audit/write_audit_service.py:35-70; backend/app/mcp/server.py:278-288

⚠️ **Caveats:** record_write_audit hace db.commit() propio: el audit del dry_run persiste aunque no haya mutación de dominio. actor_sub proviene de decode_unverified_claims (claims sin verificar firma en este punto).

### 1.28 `apply_delegated_limited_policy`  ·  _guard_

**Interfaz:** `apply_delegated_limited_policy(tool_name: str, payload: dict) -> tuple[filtered: dict, included_fields: list[str], redacted_fields: list[str]]; TOOL_ALLOWLISTS: dict con allowlist de claves raíz por tool (17 entradas, sin propose_change/list_proposals/ratify_proposal/reject_proposal); SENSITIVE_KEYS={'secret','token','password','api_key','credential'}`

Filtra la respuesta a las claves raíz del allowlist del tool (si el tool no está en TOOL_ALLOWLISTS, pasa todo) y redacta recursivamente cualquier clave cuyo nombre contenga (substring, case-insensitive) un marcador sensible → '[REDACTED]'.

**Evidencia:** backend/app/policies/delegated_limited.py:3-9; backend/app/policies/delegated_limited.py:11-139; backend/app/policies/delegated_limited.py:142-166

⚠️ **Caveats:** Las 4 tools del plano deliberativo no tienen allowlist ni pasan por el filtro (server no lo invoca para ellas): sus respuestas no se redactan.

### 1.29 `FastMCP server + transporte streamable-http /mcp`  ·  _service_

**Interfaz:** `FastMCP(name='WIS Context Sync MCP', instructions='(OAuth-protected )context server with read/write planes and scope guards.', host='0.0.0.0', port=settings.mcp_port (default 8002), streamable_http_path='/mcp', auth=AuthSettings(issuer_url=mcp_auth0_issuer, resource_server_url=mcp_public_base_url, required_scopes=['wis.context.read']), token_verifier=Auth0JWTTokenVerifier(issuer, audience, jwks_url, resource_id=effective_mcp_resource_id (mcp_resource_id o mcp_auth0_audience), clock_skew_seconds=max(mcp_auth_clock_skew_seconds,0) default 60))`

Auth runtime activo solo si mcp_auth_enabled=true Y mcp_auth_bypass_local=false. Con auth activo, RuntimeError al construir si faltan MCP_AUTH0_ISSUER/MCP_AUTH0_AUDIENCE/MCP_AUTH0_JWKS_URL o MCP_PUBLIC_BASE_URL. required_scopes del transporte = ['wis.context.read'] (mínimo para cualquier request). __main__ arranca uvicorn con build_observed_streamable_http_app() en mcp.settings.host/port.

**Evidencia:** backend/app/mcp/server.py:92-93; backend/app/mcp/server.py:156-192; backend/app/mcp/server.py:2424-2432; backend/app/core/config.py:11-29

⚠️ **Caveats:** Si mcp_resource_id difiere de mcp_auth0_audience, arranca igualmente en modo legacy-compatible y solo emite warning mcp_auth_legacy_resource_id_divergence (server.py:196-207).

### 1.30 `GET /.well-known/oauth-protected-resource`  ·  _endpoint_

**Interfaz:** `Route(methods=['GET','OPTIONS'], endpoint=cors_middleware(_protected_resource_metadata_endpoint)); JSON: {resource: effective_mcp_resource_id, authorization_servers: [issuer con '/' final] | [], scopes_supported: los 5 RESOURCE_SCOPES_SUPPORTED, bearer_methods_supported: ['header']}`

build_observed_streamable_http_app elimina cualquier ruta previa con ese path del router del streamable_http_app y la inserta en la posición 0 (la versión custom prevalece sobre la del SDK).

**Evidencia:** backend/app/mcp/server.py:117-128; backend/app/mcp/server.py:2037-2051

⚠️ **Caveats:** Se sirve sin autenticación (metadata pública por diseño RFC 9728). 'resource' es null si no hay resource id efectivo configurado.

### 1.31 `securitySchemes + readOnlyHint por tool (_apply_tool_auth_metadata)`  ·  _service_

**Interfaz:** `tool.meta['securitySchemes'] = [{'type':'oauth2','scopes': TOOL_SCOPES[tool]}]; tool.annotations.readOnlyHint = not any(scope.endswith('.write'))`

Post-registro (llamado en import, server.py:2420), muta el _tool_manager interno de FastMCP para que tools/list publique requisitos de auth sin probar llamadas. Tools sin entrada en TOOL_SCOPES no se tocan.

**Evidencia:** backend/app/mcp/server.py:1818-1840; backend/app/mcp/server.py:96-101; backend/app/mcp/server.py:2420

⚠️ **Caveats:** DEFECTO CONOCIDO CONFIRMADO: ratify_proposal y reject_proposal (scope wis.context.ratify, sin sufijo .write) quedan con readOnlyHint=true siendo escrituras; preview_write_impact queda readOnlyHint=false siendo lectura. Depende de atributos privados (_tool_manager._tools) del SDK: frágil ante upgrades.

### 1.32 `Origin guard (MCPTransportObservabilityASGI)`  ·  _guard_

**Interfaz:** `MCPTransportObservabilityASGI(app, *, logger, streamable_path, allowed_origins: list[str]|None); comparación case-insensitive tras strip; fuente: settings.mcp_allowed_origins_list (CSV de MCP_ALLOWED_ORIGINS, default '')`

Solo intercepta requests HTTP cuyo path == streamable_path ('/mcp'). Si allowed_origins está configurado, hay header Origin y no está en el set → 403 con body JSON {'error':'invalid_origin','error_description':'Origin header is not allowed for this MCP endpoint.'} + evento mcp_origin_denied (WARNING) sin llegar a la app. Al construir la app con auth activo y sin MCP_ALLOWED_ORIGINS se emite mcp_origin_guard_permissive (WARNING).

**Evidencia:** backend/app/mcp/observability.py:197-273; backend/app/mcp/server.py:2053-2069; backend/app/core/config.py:138-142

⚠️ **Caveats:** Permisivo en dos casos: allowlist vacío (permite todo) y request SIN header Origin (siempre permitida). No protege el endpoint /.well-known (path distinto).

### 1.33 `Observabilidad de transporte y runtime (eventos)`  ·  _service_

**Interfaz:** `MCPStructuredLogger.emit(event_name, *, level='INFO', **fields) → JSON lines a stdout (logger 'app.mcp.observability'). Eventos transporte: mcp_request_started, mcp_request_completed (status_code, duration_ms redondeado a 3 decimales), mcp_request_failed, mcp_handshake_initialize_started/succeeded/failed, mcp_auth_missing|mcp_auth_invalid (en 401, según presencia de Authorization), mcp_auth_scope_denied (403), mcp_origin_denied. Eventos runtime: mcp_scope_guard_evaluated, mcp_auth_missing, mcp_auth_scope_denied, mcp_list_tools_started/succeeded/failed, mcp_call_tool_started/succeeded/failed. Startup: mcp_auth_legacy_resource_id_divergence, mcp_origin_guard_permissive. failure_classification de call_tool: ok|unexpected_error|invalid_structured_content|scope_denied|schema_validation_error|tool_exception`

Sanitización: claves con substring de SENSITIVE_KEYS → '[REDACTED]'; strings truncados a 2048 chars ('...[truncated]'); campos None omitidos. Headers logueados solo del allowlist (default: x-request-id,mcp-session-id,user-agent,x-forwarded-for,traceparent,mcp-protocol-version,accept,content-type; authorization/cookie/set-cookie siempre excluidos; fallback mínimo {x-request-id, mcp-session-id, user-agent}). Captura de cuerpos request/response limitada a _MAX_CAPTURE_BYTES=16384. request_id = header x-request-id o uuid4. Claims saneados a allowlist {iss, aud, sub, azp, client_id, scope, scp, permissions, exp}. Los argumentos de tools solo se loguean en mcp_call_tool_started si mcp_log_payloads=true (default false). El wrapper de CallToolRequest clasifica por structuredContent.status/error del resultado.

**Evidencia:** backend/app/mcp/observability.py:17-23; backend/app/mcp/observability.py:35-115; backend/app/mcp/observability.py:153-184; backend/app/mcp/observability.py:284-460; backend/app/mcp/server.py:1843-2034; backend/app/mcp/observability.py:463-469

⚠️ **Caveats:** La instrumentación de handlers parchea request_handlers privados del lowlevel server (idempotente vía flag _mcp_observed). extract_jsonrpc_info solo inspecciona el primer elemento de un batch JSON-RPC.

### 1.34 `Detección de contract drift`  ·  _guard_

**Interfaz:** `Evento mcp_contract_drift_detected (WARNING) con dos reasons: 'tool_scope_drift' (runtime tools/list: unknown_published_tools = publicadas sin entrada en TOOL_SCOPES; missing_from_published = en TOOL_SCOPES pero no publicadas) y 'missing_mcp_session_id' (transporte: respuesta <400 a initialize|tools/list|tools/call sin header mcp-session-id)`

En cada tools/list exitoso también emite mcp_list_tools_succeeded con total_tools, tool_names, read_tools_total, write_tools_total (contados con _is_write_tool sobre TOOL_SCOPES).

**Evidencia:** backend/app/mcp/server.py:1886-1919; backend/app/mcp/observability.py:446-460

⚠️ **Caveats:** Solo detecta drift entre lo publicado y TOOL_SCOPES; no valida firmas/parámetros de las tools.

### Configuración (mcp-tools)

| Clave | Default | Efecto |
|---|---|---|
| `mcp_port (MCP_PORT)` | `8002` | Puerto del servidor MCP (FastMCP port). |
| `mcp_auth_enabled (MCP_AUTH_ENABLED)` | `true` | Activa el plano OAuth; el runtime real requiere además mcp_auth_bypass_local=false (_auth_runtime_enabled). |
| `mcp_auth_bypass_local (MCP_AUTH_BYPASS_LOCAL)` | `false` | true desactiva el token verifier del transporte Y hace que _scope_guard permita todas las tools sin token. |
| `mcp_auth0_issuer / mcp_auth0_audience / mcp_auth0_jwks_url` | `None` | Config Auth0 del verifier JWT; obligatorios (RuntimeError) cuando el auth runtime está activo. |
| `mcp_public_base_url (MCP_PUBLIC_BASE_URL)` | `None` | resource_server_url de AuthSettings y base de resource_metadata en WWW-Authenticate; obligatorio y https:// con auth activo. |
| `mcp_resource_id (MCP_RESOURCE_ID)` | `None` | Resource id RFC 8707; effective_mcp_resource_id = mcp_resource_id o mcp_auth0_audience; divergencia entre ambos solo emite warning de arranque. |
| `mcp_allowed_origins (MCP_ALLOWED_ORIGINS)` | `"" (vacío)` | CSV de Origins permitidos en /mcp; vacío = guard permisivo (warning mcp_origin_guard_permissive con auth activo). |
| `mcp_auth_clock_skew_seconds (MCP_AUTH_CLOCK_SKEW_SECONDS)` | `60` | Tolerancia de reloj del verificador JWT (se aplica max(valor,0)). |
| `mcp_log_level (MCP_LOG_LEVEL)` | `INFO` | Nivel del logger estructurado app.mcp.observability. |
| `mcp_log_json (MCP_LOG_JSON)` | `true` | true = JSON lines; false = pares key=value en texto. |
| `mcp_log_payloads (MCP_LOG_PAYLOADS)` | `false` | true incluye arguments saneados en mcp_call_tool_started. |
| `mcp_log_include_headers_allowlist (MCP_LOG_INCLUDE_HEADERS_ALLOWLIST)` | `x-request-id,mcp-session-id,user-agent,x-forwarded-for,traceparent,mcp-protocol-version,accept,content-type` | Headers que se loguean en eventos de transporte (authorization/cookie/set-cookie excluidos siempre). |
| `system_mode (SYSTEM_MODE)` | `delegated_limited` | Se refleja como 'mode'/'metadata.policy' en respuestas de lectura; no cambia el filtro (siempre se aplica delegated_limited). |

### Qué NO soporta hoy (mcp-tools)

- apply_sync_batch NO aplica las operations en modo commit: solo persiste la fila ContextSyncBatch con status='applied' (server.py:1775-1801); no hay ejecución de las operaciones contra tablas de dominio.
- ratify_proposal y reject_proposal se anuncian con readOnlyHint=true (derivación por sufijo '.write' en _is_write_tool, server.py:96-97 + 1838-1840) siendo escrituras reales; preview_write_impact se anuncia como write siendo lectura.
- La resolución de scope (queries DB + payload con resolution_metadata) ocurre ANTES de _scope_guard en las 21 tools: callers no autenticados obtienen errores de scope detallados.
- Las 4 tools deliberativas (propose_change, list_proposals, ratify_proposal, reject_proposal) no pasan por _write_audit_and_filter ni apply_delegated_limited_policy: sin fila en context_write_audit, sin publish_audit, sin redacción de claves sensibles y sin audit_ref.
- El replay idempotente no distingue dry_run: un dry_run=true con idempotency_key consume la key y el commit posterior con la misma key devuelve el replay del dry_run sin ejecutar la mutación.
- El replay idempotente no puede reconstruir before/after/event originales (el audit solo guarda hashes sha256).
- set_context_labels no soporta reemplazar ni eliminar labels: hace unión con las existentes (append_context_labels, context_item_service.py:284-315).
- list_proposals ignora 'limit' cuando se pasan target_kind y target_key.
- propose_change tiene dry_run default=False, inconsistente con el resto del write plane (default True).
- Origin guard permisivo si MCP_ALLOWED_ORIGINS está vacío o si la request no envía header Origin; no cubre /.well-known/oauth-protected-resource.
- dry_run de las write tools no es totalmente no-mutante: persiste filas en context_write_audit (db.commit propio) y publish_audit.
- No hay rate limiting, cuotas, budgets ni timeouts propios por tool; los únicos límites numéricos son clock skew 60s, captura de cuerpos 16384 bytes y truncado de strings de log a 2048 chars.
- No expone MCP resources ni prompts; solo tools sobre transporte streamable-http en /mcp.
- Paginación limitada a limit/offset simples; 'total' en respuestas es el tamaño de la página devuelta, no el conteo global.
- El gate de ratificación con política default 'auto' no gatea nada hasta configurar policy_state con modo 'ratify'; los intentos bloqueados por ratificación no dejan rastro en context_write_audit.
- actor_sub para auditoría proviene de decode_unverified_claims (claims sin verificación de firma en ese punto) con fallback 'local_bypass'.
- _apply_tool_auth_metadata y _instrument_runtime_handlers dependen de atributos privados del SDK MCP (_tool_manager._tools, _mcp_server.request_handlers): frágiles ante upgrades del SDK.

## 2. Modelo de datos y servicios de dominio del backend

El backend persiste 18 tablas PostgreSQL (SQLAlchemy 2.0 declarativo + Alembic, 6 migraciones 0001-0006) organizadas en tres planos: read model multi-scope (workspaces/projects/consumers/execution_sessions/context_scopes + tasks/approved_decisions/events/context_snapshots/validation_runs/publish_audit/policy_state), write plane MCP (context_items/links/labels/sync_batches/context_write_audit, fase 4) y capa deliberativa (proposals + columnas aditivas, fases 0005-0006). Los servicios de dominio implementan el lifecycle de Proposal con transiciones validadas (proposed→in_review→ratified/rejected/superseded, ratificación con identidad humana obligatoria), approval policy con precedencia by_tool>by_category>default('auto') donde solo 'ratify' gatea, deliberation trail append-only sobre events, invalidación de staleness sobre scopes/snapshots, optimistic locking por version/expected_version en context_items, auditoría con stable_hash SHA-256 de JSON canónico, y la política de salida delegated_limited con allowlists por tool (17) y redacción recursiva de claves sensibles. Dos seeds idempotentes (v1: workspace/project/task/policy; v5: consumers, sesión y scope canónicos, validaciones, 6 decisiones y snapshot phase5_seed) bootstrapean el estado canónico.

### 2.1 `workspaces`  ·  _table_

**Interfaz:** `id UUID PK server_default gen_random_uuid() | workspace_key TEXT NOT NULL UNIQUE (uq_workspaces_workspace_key) | name TEXT NOT NULL | description TEXT NULL | is_active BOOLEAN NOT NULL default true | created_at timestamptz NOT NULL default now() | updated_at timestamptz NOT NULL default now() (ORM onupdate=func.now())`

Raíz del multi-scope. Introducida por la migración 0003_multi_scope_read_model, que además siembra el workspace canónico id=11111111-1111-4111-8111-111111111111 con workspace_key='default'. Índice: ix_workspaces_is_active(is_active).

**Evidencia:** backend/app/models/workspace.py:11-29; backend/alembic/versions/0003_multi_scope_read_model.py:31-43,131-140

⚠️ **Caveats:** updated_at se actualiza solo vía ORM (onupdate), no hay trigger de DB: escrituras SQL directas no lo tocan.

### 2.2 `projects`  ·  _table_

**Interfaz:** `id UUID PK gen_random_uuid() | workspace_id UUID NOT NULL FK workspaces.id ondelete=CASCADE | project_key TEXT NOT NULL | name TEXT NOT NULL | repo_url TEXT NULL | default_branch TEXT NULL | status TEXT NOT NULL default 'active' | is_active BOOLEAN NOT NULL default true | created_at/updated_at timestamptz NOT NULL default now()`

Introducida por 0003. UNIQUE(workspace_id, project_key)=uq_projects_workspace_project_key. Índices: ix_projects_workspace_id, ix_projects_is_active. 0003 siembra el proyecto canónico id=22222222-2222-4222-8222-222222222222, project_key='default_project', repo_url='shared-dev-context-layer', default_branch='main'.

**Evidencia:** backend/app/models/project.py:11-39; backend/alembic/versions/0003_multi_scope_read_model.py:45-62,141-150

### 2.3 `consumers`  ·  _table_

**Interfaz:** `id UUID PK gen_random_uuid() | consumer_type TEXT NOT NULL UNIQUE (uq_consumers_consumer_type) | name TEXT NOT NULL | version TEXT NULL | is_active BOOLEAN NOT NULL default true | created_at/updated_at timestamptz NOT NULL default now()`

Introducida por 0003, que siembra 4 consumers con UUIDs fijos: chatgpt (33333333-…), vscode_extension (44444444-…), codex (55555555-…), github_copilot (66666666-…), todos version 'v1'. Sin índices adicionales aparte del unique.

**Evidencia:** backend/app/models/consumer.py:11-29; backend/alembic/versions/0003_multi_scope_read_model.py:64-75,151-169

### 2.4 `execution_sessions`  ·  _table_

**Interfaz:** `id UUID PK | consumer_id UUID NOT NULL FK consumers CASCADE | workspace_id UUID NOT NULL FK workspaces CASCADE | project_id UUID NOT NULL FK projects CASCADE | task_id UUID NULL FK tasks SET NULL | session_key TEXT NOT NULL UNIQUE (uq_execution_sessions_session_key) | started_at timestamptz NOT NULL default now() | ended_at timestamptz NULL | status TEXT NOT NULL default 'active'`

Introducida por 0003. Índices: ix_execution_sessions_consumer_id, ix_execution_sessions_started_at. 0003 siembra la sesión canónica id=77777777-…, session_key='canonical-chatgpt-session', status='active'.

**Evidencia:** backend/app/models/execution_session.py:11-42; backend/alembic/versions/0003_multi_scope_read_model.py:77-96,408-431

### 2.5 `context_scopes`  ·  _table_

**Interfaz:** `id UUID PK | workspace_id UUID NOT NULL FK workspaces CASCADE | project_id UUID NOT NULL FK projects CASCADE | task_id UUID NULL FK tasks SET NULL | consumer_id UUID NULL FK consumers SET NULL | execution_session_id UUID NULL FK execution_sessions SET NULL | scope_kind TEXT NOT NULL default 'task' | is_current BOOLEAN NOT NULL default false | resolved_by TEXT NOT NULL | created_at timestamptz NOT NULL default now()`

Puntero de foco canónico. Introducida por 0003. Índices: ix_context_scopes_workspace_id/project_id/task_id/consumer_id + índice único parcial uq_context_scopes_single_current sobre (is_current) WHERE is_current = true. 0003 siembra el scope canónico id=88888888-… con is_current=true, resolved_by='migration_0003'.

**Evidencia:** backend/app/models/context_scope.py:11-48; backend/alembic/versions/0003_multi_scope_read_model.py:98-127,453-474

⚠️ **Caveats:** El unique parcial es GLOBAL sobre toda la tabla: solo puede existir UN scope is_current=true en toda la base, no uno por workspace. Sin columna updated_at.

### 2.6 `tasks`  ·  _table_

**Interfaz:** `id UUID PK gen_random_uuid() | title TEXT NOT NULL | goal TEXT NOT NULL | status TEXT NOT NULL | priority TEXT NOT NULL | branch TEXT NULL | repo TEXT NULL | next_action TEXT NULL | current_phase TEXT NULL (añadida en 0002) | workspace_id UUID NOT NULL FK workspaces ondelete=RESTRICT (0003) | project_id UUID NOT NULL FK projects ondelete=RESTRICT (0003) | is_active BOOLEAN NOT NULL default false | created_at/updated_at timestamptz NOT NULL default now()`

Introducida por 0001_init. Índices: ix_tasks_is_active (0001), ix_tasks_workspace_id, ix_tasks_project_id (0003). 0001 creó unique parcial global uq_tasks_single_active(is_active) WHERE is_active=true; 0003 lo eliminó y lo sustituyó por uq_tasks_active_per_project(project_id) WHERE is_active=true (una tarea activa POR PROYECTO). status/priority son TEXT libres, sin CHECK ni enum.

**Evidencia:** backend/app/models/task.py:11-44; backend/alembic/versions/0001_init.py:24-46; backend/alembic/versions/0002_phase5_domain_enrichment.py:39; backend/alembic/versions/0003_multi_scope_read_model.py:171-206

### 2.7 `approved_decisions`  ·  _table_

**Interfaz:** `id UUID PK | task_id UUID NULL FK tasks CASCADE (NOT NULL en 0001, pasa a nullable en 0003) | workspace_id UUID NOT NULL FK workspaces CASCADE (0003) | project_id UUID NULL FK projects CASCADE (0003) | decision_key TEXT NOT NULL (0002) | title TEXT NOT NULL (0002) | decision TEXT NOT NULL | rationale TEXT NOT NULL | category TEXT NOT NULL (0002) | constraints_json JSONB NOT NULL default '{}' | is_active BOOLEAN NOT NULL default true | approved_at timestamptz NOT NULL default now() (0002) | approved_by TEXT NOT NULL default 'WIS' (0002) | superseded_by UUID NULL SIN FK (0002) | proposal_id UUID NULL FK proposals ondelete=SET NULL (0006) | created_at/updated_at`

Introducida por 0001; enriquecida en 0002 (backfill: decision_key='legacy.'||id, title=left(decision,120), category='architecture'); multi-scope en 0003; enlazada a proposals en 0006 (fk_approved_decisions_proposal). Índices: ix_approved_decisions_task_id, ix_approved_decisions_created_at (0001); ix_approved_decisions_workspace_id, ix_approved_decisions_project_id (0003). Unicidad de decision_key por nivel via 3 uniques parciales (0003): uq_approved_decisions_task_decision_key(task_id,decision_key) WHERE task_id IS NOT NULL; uq_approved_decisions_project_decision_key(project_id,decision_key) WHERE task_id IS NULL AND project_id IS NOT NULL; uq_approved_decisions_workspace_decision_key(workspace_id,decision_key) WHERE task_id IS NULL AND project_id IS NULL.

**Evidencia:** backend/app/models/approved_decision.py:11-59; backend/alembic/versions/0001_init.py:48-62; backend/alembic/versions/0002_phase5_domain_enrichment.py:41-87; backend/alembic/versions/0003_multi_scope_read_model.py:208-271; backend/alembic/versions/0006_deliberative_columns.py:45-53

⚠️ **Caveats:** superseded_by no tiene ForeignKey (UUID suelto). El mismo decision_key puede existir simultáneamente en nivel task, project y workspace (los seeds lo explotan: 'policy.mode.delegated_limited' está en task y workspace).

### 2.8 `events`  ·  _table_

**Interfaz:** `id UUID PK | task_id UUID NOT NULL FK tasks CASCADE | workspace_id UUID NOT NULL FK workspaces CASCADE (0003) | project_id UUID NOT NULL FK projects CASCADE (0003) | consumer_id UUID NULL FK consumers SET NULL (0003) | execution_session_id UUID NULL FK execution_sessions SET NULL (0003) | proposal_id UUID NULL FK proposals SET NULL (0006, fk_events_proposal) | event_type TEXT NOT NULL | summary TEXT NOT NULL | source TEXT NOT NULL | severity TEXT NOT NULL | metadata_json JSONB NOT NULL default '{}' | payload_json JSONB NOT NULL default '{}' (0002) | event_ts timestamptz NOT NULL default now() | created_at timestamptz NOT NULL default now() (0002)`

Introducida por 0001. Índices: ix_events_task_id, ix_events_event_ts (0001); ix_events_created_at (0002); ix_events_workspace_id, ix_events_project_id, ix_events_consumer_id (0003); ix_events_proposal_id (0006). Es la tabla que soporta el deliberation trail (via proposal_id) además de los eventos operativos.

**Evidencia:** backend/app/models/event.py:11-64; backend/alembic/versions/0001_init.py:64-78; backend/alembic/versions/0002_phase5_domain_enrichment.py:89-112; backend/alembic/versions/0003_multi_scope_read_model.py:273-302; backend/alembic/versions/0006_deliberative_columns.py:23-27; backend/app/services/event_service.py:27-41,44-57

⚠️ **Caveats:** metadata_json y payload_json están duplicados: event_service.create_event_for_task escribe el mismo payload.metadata_json en ambos campos. event_type y severity son TEXT libres sin CHECK; el filtro de errores del snapshot exige literalmente event_type=='error' y severity in ('error','critical').

### 2.9 `context_snapshots`  ·  _table_

**Interfaz:** `id UUID PK | task_id UUID NOT NULL FK tasks CASCADE | workspace_id UUID NOT NULL FK workspaces CASCADE (0003) | project_id UUID NOT NULL FK projects CASCADE (0003) | consumer_id UUID NULL FK consumers SET NULL (0003) | execution_session_id UUID NULL FK execution_sessions SET NULL (0003) | snapshot_type TEXT NOT NULL | snapshot_content JSONB NOT NULL | policy_applied TEXT NOT NULL | generated_from TEXT NOT NULL default 'unknown' (0002) | is_current BOOLEAN NOT NULL default true (0006) | version INTEGER NOT NULL default 1 (0006) | created_at timestamptz NOT NULL default now()`

Introducida por 0001; generated_from en 0002 (backfill 'legacy'); multi-scope en 0003; is_current+version en 0006 para staleness. Índices: ix_context_snapshots_task_id, ix_context_snapshots_created_at (0001); ix workspace/project/consumer (0003).

**Evidencia:** backend/app/models/context_snapshot.py:11-50; backend/alembic/versions/0001_init.py:80-92; backend/alembic/versions/0002_phase5_domain_enrichment.py:114-124; backend/alembic/versions/0003_multi_scope_read_model.py:356-406; backend/alembic/versions/0006_deliberative_columns.py:41-42

⚠️ **Caveats:** version tiene default 1 pero ningún servicio la incrementa nunca; is_current solo se pone a false por staleness_service, nunca se re-marca true en snapshots viejos.

### 2.10 `publish_audit`  ·  _table_

**Interfaz:** `id UUID PK | task_id UUID NOT NULL FK tasks CASCADE | destination TEXT NOT NULL | package_type TEXT NOT NULL | fields_included JSONB NOT NULL default '[]' | fields_redacted JSONB NOT NULL default '[]' | result TEXT NOT NULL | created_at timestamptz NOT NULL default now()`

Introducida por 0001 y nunca modificada. Índices: ix_publish_audit_task_id, ix_publish_audit_created_at. Se escribe vía app/audit/service.record_publish_audit(db, task_id, destination, package_type, fields_included, fields_redacted, result='delivered') que hace commit inmediato.

**Evidencia:** backend/app/models/publish_audit.py:11-37; backend/alembic/versions/0001_init.py:94-108; backend/app/audit/service.py:8-28

⚠️ **Caveats:** Única tabla de dominio que NO fue migrada al multi-scope: carece de workspace_id/project_id.

### 2.11 `policy_state`  ·  _table_

**Interfaz:** `id UUID PK | sync_enabled BOOLEAN NOT NULL default false | mode TEXT NOT NULL | scope TEXT NOT NULL | redaction_level TEXT NOT NULL | approval_mode TEXT NOT NULL | approval_policy_json JSONB NOT NULL default '{}' (0006) | updated_at timestamptz NOT NULL default now() (ORM onupdate)`

Introducida por 0001; approval_policy_json añadida en 0006 (Paso 4). Índice: ix_policy_state_updated_at. Es global (sin FK a workspace); la política 'activa' es la fila con updated_at más reciente (policy_service.get_active_policy / approval_policy_service.get_policy_state ordenan por updated_at desc y toman first()).

**Evidencia:** backend/app/models/policy_state.py:11-34; backend/alembic/versions/0001_init.py:110-121; backend/alembic/versions/0006_deliberative_columns.py:30-38; backend/app/services/approval_policy_service.py:1-25; backend/app/services/policy_service.py:7-9

⚠️ **Caveats:** approval_mode es un campo MUERTO: ningún servicio lo lee para decidir nada; fue reemplazado por approval_policy_json (el docstring del servicio lo dice explícitamente: 'Reemplaza el approval_mode global (muerto)'). seed_v1 aún lo escribe con 'wis_controlled'.

### 2.12 `validation_runs`  ·  _table_

**Interfaz:** `id UUID PK | task_id UUID NOT NULL FK tasks CASCADE | workspace_id UUID NOT NULL FK workspaces CASCADE (0003) | project_id UUID NOT NULL FK projects CASCADE (0003) | consumer_id UUID NULL FK consumers SET NULL (0003) | execution_session_id UUID NULL FK execution_sessions SET NULL (0003) | validation_type TEXT NOT NULL | status TEXT NOT NULL | summary TEXT NOT NULL | details JSONB NOT NULL default '{}' | source TEXT NOT NULL | executed_at timestamptz NOT NULL default now() | created_at timestamptz NOT NULL default now()`

Introducida por 0002_phase5_domain_enrichment. Índices: ix_validation_runs_task_id, ix_validation_runs_executed_at (0002); ix workspace/project/consumer (0003). Lectura: get_latest_validation_run_for_scope filtra por task_id si existe, si no por (workspace_id, project_id), ordena executed_at desc + created_at desc, limit 1.

**Evidencia:** backend/app/models/validation_run.py:11-54; backend/alembic/versions/0002_phase5_domain_enrichment.py:22-37; backend/alembic/versions/0003_multi_scope_read_model.py:304-354; backend/app/services/validation_service.py:19-35

### 2.13 `context_items`  ·  _table_

**Interfaz:** `id UUID PK | workspace_id UUID NOT NULL FK workspaces CASCADE | project_id UUID NULL FK projects CASCADE | task_id UUID NULL FK tasks SET NULL | item_key TEXT NOT NULL | item_type TEXT NOT NULL | title TEXT NOT NULL | content_json JSONB NOT NULL default '{}' | labels_json JSONB NOT NULL default '[]' | status TEXT NOT NULL default 'active' | version INTEGER NOT NULL default 1 | created_by TEXT NULL | updated_by TEXT NULL | created_at/updated_at timestamptz NOT NULL default now()`

Introducida por 0004_phase4_mcp_write_plane. UNIQUE(workspace_id, item_key)=uq_context_items_workspace_item_key. Índices: ix_context_items_workspace_id/project_id/task_id/status/item_type. Estados usados por código: 'active' y 'archived' (sin CHECK).

**Evidencia:** backend/app/models/context_item.py:11-60; backend/alembic/versions/0004_phase4_mcp_write_plane.py:22-49

### 2.14 `context_item_links`  ·  _table_

**Interfaz:** `id UUID PK | workspace_id UUID NOT NULL FK workspaces CASCADE | source_item_id UUID NOT NULL FK context_items CASCADE | target_item_id UUID NOT NULL FK context_items CASCADE | relation TEXT NOT NULL | metadata_json JSONB NOT NULL default '{}' | created_by TEXT NULL | created_at timestamptz NOT NULL default now()`

Introducida por 0004. UNIQUE(workspace_id, source_item_id, target_item_id, relation)=uq_context_item_links_relation. Índices: ix_context_item_links_workspace_id/source_item_id/target_item_id. link_context_entities hace upsert por esa cuádrupla (si existe, sobreescribe metadata_json y created_by).

**Evidencia:** backend/app/models/context_item_link.py:11-50; backend/alembic/versions/0004_phase4_mcp_write_plane.py:51-75; backend/app/services/context_item_service.py:115-153,353-435

⚠️ **Caveats:** resolve_related_items solo sigue links salientes (source_item_id == item), nunca entrantes.

### 2.15 `context_item_labels`  ·  _table_

**Interfaz:** `id UUID PK | workspace_id UUID NOT NULL FK workspaces CASCADE | item_id UUID NOT NULL FK context_items CASCADE | label TEXT NOT NULL | created_by TEXT NULL | created_at timestamptz NOT NULL default now()`

Introducida por 0004. UNIQUE(workspace_id, item_id, label)=uq_context_item_labels_item_label. Índices: ix_context_item_labels_workspace_id/item_id/label. append_context_labels mantiene doble representación: borra todas las filas del item y reinserta el set unificado, y sincroniza el denormalizado labels_json del item.

**Evidencia:** backend/app/models/context_item_label.py:11-34; backend/alembic/versions/0004_phase4_mcp_write_plane.py:77-92; backend/app/services/context_item_service.py:284-326

### 2.16 `context_sync_batches`  ·  _table_

**Interfaz:** `id UUID PK | workspace_id UUID NOT NULL FK workspaces CASCADE | project_id UUID NULL FK projects CASCADE | task_id UUID NULL FK tasks SET NULL | idempotency_key TEXT NOT NULL | operation_count INTEGER NOT NULL default 0 | status TEXT NOT NULL default 'draft' | dry_run BOOLEAN NOT NULL default true | summary_json JSONB NOT NULL default '{}' | requested_by TEXT NULL | created_at/updated_at timestamptz NOT NULL default now()`

Introducida por 0004. UNIQUE(workspace_id, idempotency_key)=uq_context_sync_batches_idempotency. Índices: ix_context_sync_batches_workspace_id/project_id/task_id/status. create_or_reuse_sync_batch devuelve (batch, reused: bool); si la clave ya existe devuelve la fila existente con reused=True; si no, crea con status='dry_run' si dry_run else 'applied' y hace commit.

**Evidencia:** backend/app/models/context_sync_batch.py:11-53; backend/alembic/versions/0004_phase4_mcp_write_plane.py:94-117; backend/app/services/context_item_service.py:438-472

⚠️ **Caveats:** El default 'draft' de status nunca se usa en el código: los batches nacen ya como 'dry_run' o 'applied'; no hay máquina de estados ni transición posterior.

### 2.17 `context_write_audit`  ·  _table_

**Interfaz:** `id UUID PK | workspace_id UUID NOT NULL FK workspaces CASCADE | project_id UUID NULL FK projects CASCADE | task_id UUID NULL FK tasks SET NULL | tool_name TEXT NOT NULL | subject_id TEXT NULL | request_id TEXT NOT NULL | actor_sub TEXT NOT NULL | scopes_json JSONB NOT NULL default '[]' | before_hash TEXT NULL | after_hash TEXT NULL | result TEXT NOT NULL | dry_run BOOLEAN NOT NULL default true | metadata_json JSONB NOT NULL default '{}' | created_at timestamptz NOT NULL default now()`

Introducida por 0004. UNIQUE(workspace_id, tool_name, request_id)=uq_context_write_audit_request — soporte de idempotencia del write plane MCP (get_existing_request_audit busca por esa terna). Índices: ix_context_write_audit_workspace_id/project_id/task_id/tool_name/result. Guarda hash del antes/después, no el payload en claro.

**Evidencia:** backend/app/models/context_write_audit.py:11-60; backend/alembic/versions/0004_phase4_mcp_write_plane.py:119-146; backend/app/audit/write_audit_service.py:19-70

### 2.18 `proposals`  ·  _table_

**Interfaz:** `id UUID PK | workspace_id UUID NOT NULL FK workspaces CASCADE | project_id UUID NULL FK projects CASCADE | task_id UUID NULL FK tasks SET NULL | proposer_consumer_id UUID NULL FK consumers SET NULL | target_kind TEXT NOT NULL CHECK ck_proposals_target_kind in ('decision','context_item') | target_key TEXT NOT NULL | proposed_payload JSONB NOT NULL default '{}' | rationale TEXT NOT NULL | status TEXT NOT NULL default 'proposed' CHECK ck_proposals_status in ('proposed','in_review','ratified','rejected','superseded') | ratified_decision_id UUID NULL FK approved_decisions SET NULL | ratified_by TEXT NULL | ratified_at timestamptz NULL | superseded_by UUID NULL FK proposals SET NULL (self-FK) | idempotency_key TEXT NULL | created_at/updated_at timestamptz NOT NULL default now()`

Introducida por 0005_deliberative_ratification. Índices: ix_proposals_ws_status(workspace_id,status); ix_proposals_target(workspace_id,target_kind,target_key); unique parcial uq_proposals_idem(workspace_id,idempotency_key) WHERE idempotency_key IS NOT NULL. Constantes del modelo: PROPOSAL_STATUSES=('proposed','in_review','ratified','rejected','superseded'), PROPOSAL_TARGET_KINDS=('decision','context_item').

**Evidencia:** backend/app/models/proposal.py:11-97; backend/alembic/versions/0005_deliberative_ratification.py:22-65

### 2.19 `proposal_service (lifecycle de Proposal)`  ·  _service_

**Interfaz:** `create_proposal(db, *, workspace_id: UUID, target_kind: str, target_key: str, rationale: str, proposed_payload: dict|None=None, project_id=None, task_id=None, proposer_consumer_id=None, idempotency_key: str|None=None) -> Proposal; transition_proposal(db, proposal, new_status: str, *, ratified_by: str|None=None, ratified_decision_id: UUID|None=None, superseded_by: UUID|None=None) -> Proposal; get_proposal(db, proposal_id); list_proposals_for_target(db, *, workspace_id, target_kind, target_key, statuses: list[str]|None=None); find_ratified_proposal(db, *, workspace_id, target_kind, target_key) -> Proposal|None`

Transiciones permitidas (ALLOWED_TRANSITIONS): proposed -> {in_review, rejected, superseded}; in_review -> {ratified, rejected, superseded}; ratified/rejected/superseded son terminales (set vacío). Validaciones: create exige target_kind en PROPOSAL_TARGET_KINDS, target_key y rationale no vacíos (si no, InvalidProposalInput); con idempotency_key repetida devuelve la Proposal existente sin crear otra. transition valida que new_status esté en PROPOSAL_STATUSES y que la transición esté permitida (si no, InvalidProposalTransition). Ratificar exige ratified_by no vacío (invariante I1: identidad humana verificada, sin default) y fija ratified_at=now(UTC) y ratified_decision_id. 'superseded' fija superseded_by. Todo es db.flush() — el commit lo decide el caller. find_ratified_proposal devuelve la ratificada más reciente por ratified_at desc (hook del gate de ratificación en app/mcp/server.py:2119).

**Evidencia:** backend/app/services/proposal_service.py:18-24,35-115,140-159; backend/tests/test_proposal_lifecycle.py:35-65

⚠️ **Caveats:** No hay transición de reapertura desde estados terminales. La reutilización idempotente en create ignora que el payload nuevo difiera del existente (devuelve la vieja tal cual).

### 2.20 `approval_policy_service (granularidad de aprobación)`  ·  _service_

**Interfaz:** `DEFAULT_APPROVAL_POLICY = {"by_tool": {}, "by_category": {}, "default": "auto"}; get_policy_state(db) -> PolicyState|None; get_approval_policy(db) -> dict; requires_ratification(policy: dict|None, *, tool_name: str|None=None, category: str|None=None) -> bool`

Precedencia estricta: by_tool[tool_name] > by_category[category] > policy['default'] (valor por defecto 'auto'). requires_ratification devuelve True SOLO si el modo resuelto es exactamente 'ratify'; cualquier otro valor (incluido 'auto') no gatea — retrocompatibilidad total con el write path. get_approval_policy lee approval_policy_json de la PolicyState más reciente; si es dict vacío o no-dict devuelve una copia de DEFAULT_APPROVAL_POLICY. Consumido por el gate en app/mcp/server.py:2116-2119.

**Evidencia:** backend/app/services/approval_policy_service.py:15-47; backend/tests/test_deliberative_services.py:30-43

⚠️ **Caveats:** Un approval_policy_json == {} (el server_default) es falsy y cae al DEFAULT: para activar el gate hay que escribir la política explícitamente. Los valores de modo no están validados (cualquier string distinto de 'ratify' equivale a 'auto').

### 2.21 `deliberation_service (deliberation trail)`  ·  _service_

**Interfaz:** `PROPOSAL_EVENT_TYPES = ('proposal.raised', 'proposal.objected', 'proposal.counter', 'proposal.ratified', 'proposal.rejected'); record_proposal_event(db, *, proposal: Proposal, event_type: str, summary: str, source: str='mcp', severity: str='info', consumer_id: UUID|None=None, payload: dict|None=None) -> Event; list_deliberation_trail(db, *, proposal_id: UUID) -> list[Event]`

Trail append-only sobre la tabla events, ligado por events.proposal_id. record_proposal_event valida event_type contra los 5 tipos (ValueError si no) y exige que la Proposal tenga task_id Y project_id no nulos (ValueError 'La Proposal debe estar task/project-scoped para registrar el trail'). El payload_json del evento fusiona el payload dado con {proposal_id, target_kind, target_key} (siempre gana la inyección). list_deliberation_trail ordena event_ts asc, created_at asc. Hace flush, no commit.

**Evidencia:** backend/app/services/deliberation_service.py:17-70; backend/tests/test_deliberative_services.py:50-60

⚠️ **Caveats:** Proposals de nivel workspace o project-only NO pueden tener trail (la validación exige ambos ids). No escribe metadata_json (queda '{}').

### 2.22 `staleness_service (invalidación de coherencia)`  ·  _service_

**Interfaz:** `invalidate_context_for_scope(db, *, workspace_id: UUID, project_id: UUID|None=None, task_id: UUID|None=None) -> dict[str, int] con claves 'scopes_invalidated' y 'snapshots_invalidated'`

Tras ratificar un cambio de canon, hace UPDATE masivo: ContextScope.is_current=false y ContextSnapshot.is_current=false para las filas is_current=true del workspace, opcionalmente acotado por project_id y/o task_id. Devuelve los rowcount. Hace flush, no commit. Se invoca desde el flujo de ratificación en app/mcp/server.py:2334.

**Evidencia:** backend/app/services/staleness_service.py:19-44; backend/tests/test_deliberative_services.py:78-96

⚠️ **Caveats:** No re-crea ni re-marca ningún scope current: tras invalidar, el sistema queda sin scope canónico hasta que algo re-resuelva (el resolver cae entonces a legacy_active_task). No toca ContextItem ni versiones.

### 2.23 `context_item_service.upsert_context_item (optimistic locking)`  ·  _service_

**Interfaz:** `upsert_context_item(db, *, workspace_id, project_id: UUID|None, task_id: UUID|None, item_key: str, item_type: str, title: str, content: dict|None, labels: list[str]|None, expected_version: int|None, actor: str, dry_run: bool) -> dict con result in {'dry_run','created','updated','conflict'}, before, after (+expected_version/actual_version en conflict)`

Lookup por (workspace_id, item_key). Si no existe: create con version=1, status='active' (dry_run devuelve preview sin persistir). Si existe y expected_version is not None y existing.version != expected_version: devuelve result='conflict' con before==after==estado actual y ambos números de versión, SIN escribir. Si coincide (o expected_version es None): update de item_type/title/content/labels, version = version+1, status forzado a 'active', updated_by=actor, commit inmediato. Labels se normalizan: strip, dedupe, sorted. content None -> {}.

**Evidencia:** backend/app/services/context_item_service.py:191-281,284-326,329-350

⚠️ **Caveats:** expected_version=None = last-write-wins (sin lock). El check es en memoria, sin SELECT FOR UPDATE ni WHERE version=N en el UPDATE: hay carrera posible entre lectura y commit. project_id/task_id usan 'or existing.x': no se puede desasignar a NULL. Un upsert sobre item archivado lo reactiva silenciosamente (status='active'). append_context_labels y archive_context_item incrementan version + commit pero NO aceptan expected_version.

### 2.24 `context_item_service (lecturas y límites)`  ·  _service_

**Interfaz:** `search_context_items(..., query=None, item_type=None, status='active', limit=20, offset=0); list_context_windows(..., window_hours=24, limit=20); resolve_related_items(..., limit=20); get_sync_status(..., limit=20); make_preview_item_key() -> 'preview-{uuid4}'`

search: filtro ILIKE '%q%' sobre title OR item_key, orden updated_at desc; limit clamped a [1,200] via max(min(limit,200),1); offset clamped a >=0. list_context_windows: ventana max(window_hours,1) horas; cuenta errors (event_type=='error') y snapshots del periodo y devuelve items (limit clamp [1,200]) + items_total/errors_total/snapshots_total/since. resolve_related_items: solo links salientes, limit clamp [1,200]. get_sync_status: batches por workspace/project/task, orden created_at desc, limit clamp [1,200].

**Evidencia:** backend/app/services/context_item_service.py:39-64,76-112,115-153,156-188,475-476

⚠️ **Caveats:** En list_context_windows, items_total = len(items) (acotado por limit), mientras errors_total/snapshots_total son counts reales SQL — semántica inconsistente. status=None en search desactiva el filtro de estado.

### 2.25 `context_snapshot_service.build_operational_snapshot`  ·  _service_

**Interfaz:** `build_operational_snapshot(db, task: Task, policy_mode: str, generated_from: str='derived_runtime', *, workspace_id=None, project_id=None, consumer_context: dict|None=None, resolution_metadata: dict|None=None) -> dict`

Compone el snapshot operacional con secciones exactas: identity {workspace_id, project_id, task_id, task_title, goal, phase (fallback 'unknown')}, execution_state {focus (fallback 'general_execution'), repo, branch, next_action, status, priority}, validation {status (fallback 'unknown'), last_validation_type, last_validation_source, last_validation_at, summary (fallback 'No validation run available.'), details}, decisions {count, items} (via list_active_decisions_for_scope), errors {recent_errors_count, dominant_error (= summary del más reciente), items} usando list_recent_errors_for_task con limit=20 y window_hours=24, next_action, scope, consumer_context, resolution_metadata, metadata {policy, origin, generated_at ISO UTC}. workspace_id/project_id efectivos: parámetro o los del task.

**Evidencia:** backend/app/services/context_snapshot_service.py:39-126

### 2.26 `decision_service (resolución de decisiones por scope)`  ·  _service_

**Interfaz:** `list_active_decisions_for_task(db, task_id); list_active_decisions_for_project(db, project_id) [exige task_id IS NULL]; list_active_decisions_for_workspace(db, workspace_id) [exige project_id IS NULL AND task_id IS NULL]; list_active_decisions_for_scope(db, *, workspace_id, project_id, task_id: UUID|None) -> list[ApprovedDecision]`

Solo filas is_active=true, orden approved_at desc + updated_at desc por nivel. list_active_decisions_for_scope concatena task + project + workspace y deduplica por decision_key con precedencia task > project > workspace (la primera aparición gana).

**Evidencia:** backend/app/services/decision_service.py:9-63

### 2.27 `event_service`  ·  _service_

**Interfaz:** `list_recent_events_for_task(db, task_id, limit=20); create_event_for_task(db, task_id, payload: EventCreate) -> Event (LookupError si el task no existe); list_recent_errors_for_task(db, task_id, limit=20, window_hours=24)`

create_event_for_task hereda workspace_id/project_id del task y escribe payload.metadata_json tanto en metadata_json como en payload_json; commit inmediato. list_recent_errors filtra event_type=='error' AND severity IN ('error','critical') AND created_at >= now-window, orden created_at desc.

**Evidencia:** backend/app/services/event_service.py:12-57

### 2.28 `focus_resolver.resolve_scope`  ·  _service_

**Interfaz:** `resolve_scope(db, *, workspace_id: str|None, project_id: str|None, task_id: str|None, consumer: str|None, session_key: str|None) -> ResolvedScope {status, workspace, project, task, consumer, execution_session, resolution_metadata}; status in {'ok','no_scope','scope_invalid','scope_not_found','scope_conflict'}`

Precedencia de resolución: task_id > project_id > workspace_id > session_key > ContextScope is_current=true más reciente ('canonical_scope') > Task is_active=true más reciente ('legacy_active_task'). UUIDs malformados -> status='scope_invalid' con conflict_flags ['invalid_<campo>']. consumer se resuelve por consumer_type exacto; session por session_key; mismatch consumer/sesión -> 'scope_conflict' flag 'consumer_session_mismatch'. Coherencia jerárquica validada: task_project_mismatch, task_workspace_mismatch, project_workspace_mismatch. Fallbacks documentados en resolution_metadata.fallback_level: none | task_from_project | project_only | task_from_workspace | project_from_workspace | workspace_only | task_from_session_project | session_context | legacy_active_task. status='ok' exige workspace Y project resueltos; si no, 'no_scope'. resolution_metadata incluye source, fallback_level, conflict_flags, requested, resolved_scope.

**Evidencia:** backend/app/services/focus_resolver.py:78-354

### 2.29 `task_service`  ·  _service_

**Interfaz:** `get_active_task(db) -> Task|None; get_task_by_id(db, task_id); get_active_task_for_project(db, project_id); get_active_task_for_workspace(db, workspace_id); require_active_task(db) -> Task (LookupError 'No active task configured.' si no hay)`

get_active_task prioriza el task del ContextScope is_current=true más reciente; fallback a Task.is_active=true por updated_at desc. Las variantes por project/workspace intentan primero is_active=true y como fallback la tarea más recientemente actualizada del ámbito (aunque no esté activa).

**Evidencia:** backend/app/services/task_service.py:10-51

### 2.30 `snapshot_service (snapshots manuales)`  ·  _service_

**Interfaz:** `create_manual_snapshot(db, task_id, payload: ManualSnapshotCreate, policy_mode: str) -> ContextSnapshot; get_latest_snapshot_for_task(db, task_id) -> ContextSnapshot|None`

Crea snapshot con generated_from='manual_api', policy_applied = payload.policy_applied or policy_mode, heredando workspace/project del task; LookupError si el task no existe; commit inmediato. El latest es por created_at desc sin filtrar is_current.

**Evidencia:** backend/app/services/snapshot_service.py:11-42

### 2.31 `stable_hash + write_audit_service (hashing de auditoría)`  ·  _service_

**Interfaz:** `stable_hash(payload: Any) -> str = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest(); get_existing_request_audit(db, *, workspace_id, tool_name, request_id) -> ContextWriteAudit|None; record_write_audit(db, *, workspace_id, project_id, task_id, tool_name, subject_id, request_id, actor_sub, scopes: list[str], before_payload: Any, after_payload: Any, result: str, dry_run: bool, metadata: dict|None=None) -> ContextWriteAudit`

Hash canónico determinista: JSON con claves ordenadas, sin espacios, UTF-8, SHA-256 hex (64 chars). record_write_audit guarda before_hash/after_hash = stable_hash(payload) si el payload no es None (None -> columna NULL), commit inmediato. get_existing_request_audit implementa el replay idempotente por (workspace_id, tool_name, request_id), usado en app/mcp/server.py:1164.

**Evidencia:** backend/app/audit/write_audit_service.py:14-70

⚠️ **Caveats:** stable_hash lanza TypeError con payloads no serializables a JSON (p.ej. datetime crudo); solo se registran hashes, no diffs recuperables.

### 2.32 `apply_delegated_limited_policy (política delegated_limited)`  ·  _guard_

**Interfaz:** `apply_delegated_limited_policy(tool_name: str, payload: dict) -> tuple[filtered: dict, included_fields: list[str], redacted_fields: list[str]]; SENSITIVE_KEYS = {'secret','token','password','api_key','credential'}; TOOL_ALLOWLISTS: dict[str, set[str]] con 17 tools`

Dos etapas. (1) Filtrado de campos raíz: solo pasan las claves de primer nivel presentes en TOOL_ALLOWLISTS[tool_name]. Allowlists exactas: get_active_task={status,task,mode,scope,resolution_metadata}; get_context_snapshot={task_id,status,source,scope,consumer_context,resolution_metadata,snapshot,metadata}; get_recent_errors={status,task_id,scope,resolution_metadata,window_hours,limit,total,errors}; get_validation_status={status,task_id,scope,resolution_metadata,current_status,last_validation_type,last_validation_source,last_validation_at,summary,details}; get_approved_decisions={status,task_id,scope,resolution_metadata,total,decisions}; search_context={status,scope,resolution_metadata,query,total,items,limit,offset}; get_context_by_id={status,scope,resolution_metadata,context_item_id,item}; list_context_windows={status,scope,resolution_metadata,window_hours,since,items_total,errors_total,snapshots_total,items}; resolve_related_items={status,scope,resolution_metadata,context_item_id,total,related}; get_sync_status={status,scope,resolution_metadata,total,batches}; preview_write_impact={status,scope,resolution_metadata,operation,dry_run,impact,requires_scopes}; upsert_context_item / link_context_entities / set_context_labels / archive_context_item = {status,scope,resolution_metadata,dry_run,request_id,result,before,after,idempotent_replay,audit_ref}; append_context_event = {status,scope,resolution_metadata,dry_run,request_id,result,event,idempotent_replay,audit_ref}; apply_sync_batch = {status,scope,resolution_metadata,dry_run,request_id,result,summary,batch,idempotent_replay,audit_ref}. (2) Redacción recursiva: en cualquier dict anidado, toda clave cuyo lowercase CONTENGA como substring alguno de los 5 markers se reemplaza por '[REDACTED]' y su path (dot-notation, listas como path[i]) se acumula en redacted_fields. Devuelve (payload filtrado+redactado, included_fields = claves raíz supervivientes ordenadas, redacted_fields = paths ordenados y dedupeados).

**Evidencia:** backend/app/policies/delegated_limited.py:3-9,11-139,142-166

⚠️ **Caveats:** FAIL-OPEN: si tool_name no está en TOOL_ALLOWLISTS, el allowlist es set(payload.keys()) y TODO el payload pasa (solo aplica la redacción por claves sensibles). Solo cubre 17 nombres de tool. La redacción actúa únicamente sobre NOMBRES de clave de dict, no sobre valores string sensibles ni sobre elementos de listas de strings. El match por substring puede redactar de más (p.ej. 'tokenizer').

### 2.33 `seed_v1 (script app/db/seed_v1.py)`  ·  _script_

**Interfaz:** `run_seed() -> None; ejecutable como python -m: if __name__ == '__main__'. Constantes: DEFAULT_WORKSPACE_KEY='default', DEFAULT_PROJECT_KEY='default_project'`

Idempotente. Siembra: (1) Workspace 'default' ('Default Workspace'); (2) Project 'default_project' ('Default Project', repo_url='shared-dev-context-layer', default_branch='main', status='active'); (3) si no hay Task is_active=true, desactiva todas y crea Task {title='bootstrap del sistema', goal='levantar arquitectura base', status='in_progress', priority='alta', branch='main', repo='shared-dev-context-layer', next_action='definir tools MCP v1', is_active=true}; si ya hay activa, solo rellena workspace_id/project_id nulos; (4) PolicyState: crea o SOBREESCRIBE SIEMPRE con sync_enabled=False, mode='delegated_limited', scope='task', redaction_level='strict', approval_mode='wis_controlled'. Un commit final; imprime 'Seed v1 completed.'

**Evidencia:** backend/app/db/seed_v1.py:9-91

⚠️ **Caveats:** No escribe approval_policy_json (queda '{}' del server_default, por lo que get_approval_policy devuelve el DEFAULT 'auto' y ningún tool queda gateado). Re-ejecutarlo resetea la política a los valores de arriba aunque un operador la haya cambiado.

### 2.34 `seed_v5 (script app/db/seed_v5.py)`  ·  _script_

**Interfaz:** `run_seed() -> None (ejecuta primero run_seed de seed_v1). CANONICAL_SESSION_KEY='canonical-chatgpt-session'`

Idempotente por upserts. Siembra sobre el task activo (RuntimeError 'No active task available for seed_v5.' si no hay): (1) task.current_phase='phase5_domain_enrichment' si estaba vacío; (2) 4 consumers (chatgpt 'ChatGPT Developer Mode', vscode_extension 'VS Code Extension', codex 'Codex CLI', github_copilot 'GitHub Copilot', todos v1, upsert por consumer_type); (3) ExecutionSession canónica session_key='canonical-chatgpt-session' ligada al consumer chatgpt, status='active', ended_at=None; (4) desmarca todos los ContextScope is_current y marca/crea el scope canónico (workspace+project+task+chatgpt+sesión, scope_kind='task', resolved_by='seed_v5', is_current=true); (5) 2 ValidationRun (upsert por task+validation_type+source): {health, passed, 'backend, db y mcp disponibles', details {backend:'up',db:'up',mcp:'up'}, source manual} y {mcp_tools, passed, '5 tools read-only validadas', details {tools_ok:5}, source manual}; (6) decisiones (upsert por workspace+project+task+decision_key, approved_by='WIS', constraints {}): 4 a nivel task (stack.backend.python_fastapi [stack], stack.database.postgresql [stack], policy.mode.delegated_limited [policy], integration.v1.read_only [architecture]), 1 a nivel project (project.default.branch_policy [operations], task_id=None), 1 a nivel workspace (policy.mode.delegated_limited [policy], project_id=None, task_id=None); (7) un ContextSnapshot snapshot_type='phase5_seed' con snapshot_content de build_operational_snapshot(generated_from='phase5_seed'), policy_applied = mode de la política (fallback 'delegated_limited'). Un commit final; imprime 'Seed v5 completed.'

**Evidencia:** backend/app/db/seed_v5.py:19-94,162-359

⚠️ **Caveats:** No siembra context_items, proposals, ni approval_policy_json. Las validation runs seed dicen '5 tools read-only' (dato histórico de v1, no refleja el número actual de tools).

### 2.35 `db/session.py (SessionLocal / get_db)`  ·  _service_

**Interfaz:** `engine = create_engine(settings.database_url, pool_pre_ping=True); SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False); get_db() -> Generator[Session] (yield + close en finally)`

Motor síncrono (psycopg3: config normaliza postgresql:// a postgresql+psycopg://). pool_pre_ping=True; sin pool_size/timeout explícitos (defaults de SQLAlchemy). expire_on_commit=False permite usar objetos tras commit sin refresh implícito.

**Evidencia:** backend/app/db/session.py:10-28; backend/app/core/config.py:35-40

### 2.36 `db/health.check_database_connection`  ·  _service_

**Interfaz:** `check_database_connection() -> tuple[bool, str|None]`

Ejecuta SELECT 1 con el engine; (True, None) si conecta, (False, str(exc)) ante SQLAlchemyError. Sin timeout propio.

**Evidencia:** backend/app/db/health.py:7-13

### 2.37 `audit/service.record_publish_audit`  ·  _service_

**Interfaz:** `record_publish_audit(db, task_id: UUID, destination: str, package_type: str, fields_included: list[str], fields_redacted: list[str], result: str='delivered') -> PublishAudit`

Inserta fila en publish_audit y hace commit+refresh inmediato. Es el registro de auditoría del plano de publicación read-only (complementario a context_write_audit del write plane).

**Evidencia:** backend/app/audit/service.py:8-28

### 2.38 `Gate de ratificación (integración de los servicios deliberativos)`  ·  _guard_

**Interfaz:** `Flujo en app/mcp/server.py: get_approval_policy + requires_ratification(policy, tool_name, category) -> si True y no hay find_ratified_proposal para el target, la escritura se bloquea; ratificar dispara transition_proposal(..., 'ratified', ratified_by=actor) + record_proposal_event + invalidate_context_for_scope; rechazar dispara transition_proposal(..., 'rejected') + record_proposal_event`

Confirma que los servicios de dominio deliberativos NO son código muerto: están cableados al write plane MCP (server.py líneas 2116-2119 gate, 2177-2191 creación+in_review+evento, 2327-2334 ratificación+staleness, 2399-2401 rechazo). Documentado aquí solo como evidencia de wiring; el detalle del MCP server pertenece a otro subsistema.

**Evidencia:** backend/app/mcp/server.py:2116-2119,2177-2191,2327-2334,2399-2401 (verificado por grep, subsistema MCP fuera de este inventario)

### Configuración (backend-domain)

| Clave | Default | Efecto |
|---|---|---|
| `database_url` | `(obligatoria, sin default)` | URL de PostgreSQL del engine; se normaliza postgresql:// -> postgresql+psycopg:// (backend/app/core/config.py:35-40) |
| `system_mode` | `delegated_limited` | Modo del sistema en Settings (backend/app/core/config.py:13); la política persistida en policy_state.mode la siembra seed_v1 con el mismo valor |
| `policy_state (fila sembrada por seed_v1)` | `sync_enabled=false, mode='delegated_limited', scope='task', redaction_level='strict', approval_mode='wis_controlled', approval_policy_json={}` | Estado de política 'activo' = fila con updated_at más reciente; approval_policy_json vacío implica DEFAULT_APPROVAL_POLICY {'by_tool':{}, 'by_category':{}, 'default':'auto'} y por tanto ningún gate de ratificación activo |
| `DEFAULT_APPROVAL_POLICY` | `{"by_tool": {}, "by_category": {}, "default": "auto"}` | Fallback de approval_policy_service.get_approval_policy; solo el valor literal 'ratify' gatea (backend/app/services/approval_policy_service.py:15) |
| `Límites numéricos de servicios` | `limit=20 (clamp 1..200) en search/windows/related/sync_status; window_hours=24 (min 1); errores recientes: limit=20, window_hours=24; severidades de error: ('error','critical')` | Clamps aplicados con max(min(limit,200),1) y max(offset,0) (backend/app/services/context_item_service.py:63,99,127,170; backend/app/services/event_service.py:44) |
| `SENSITIVE_KEYS` | `{'secret','token','password','api_key','credential'}` | Markers de redacción por substring en claves de dict para delegated_limited (backend/app/policies/delegated_limited.py:3-9) |
| `UUIDs canónicos de la migración 0003` | `workspace 11111111-1111-4111-8111-111111111111, project 22222222-…, consumers 33333333-…(chatgpt)/44444444-…(vscode)/55555555-…(codex)/66666666-…(copilot), session 77777777-…, scope 88888888-…` | Filas canónicas insertadas con ON CONFLICT DO NOTHING por 0003 (backend/alembic/versions/0003_multi_scope_read_model.py:20-27) |

### Qué NO soporta hoy (backend-domain)

- policy_state es global: no existe política por workspace/proyecto/consumer; la 'activa' es simplemente la fila con updated_at más reciente (backend/app/services/policy_service.py:7-9).
- policy_state.approval_mode ('wis_controlled') es un campo muerto: ningún servicio lo consulta para decidir; fue reemplazado por approval_policy_json (backend/app/services/approval_policy_service.py:1-6), pero seed_v1 lo sigue escribiendo.
- uq_context_scopes_single_current es único GLOBAL (WHERE is_current=true sobre toda la tabla): no se soportan scopes current simultáneos en workspaces distintos (backend/alembic/versions/0003_multi_scope_read_model.py:121-127).
- delegated_limited es fail-open para tools desconocidas: sin allowlist registrada, todo el payload pasa (solo redacción de claves sensibles). Solo hay 17 allowlists definidas (backend/app/policies/delegated_limited.py:143).
- La redacción de delegated_limited solo actúa sobre nombres de clave de dict (match por substring), nunca sobre valores string ni sobre listas de strings sueltas.
- Optimistic locking limitado: expected_version solo se respeta en upsert_context_item y solo en update; append_context_labels y archive_context_item incrementan version sin check; el check es en memoria (sin SELECT FOR UPDATE ni UPDATE ... WHERE version=N), con carrera posible (backend/app/services/context_item_service.py:246-254,322,346).
- upsert_context_item no permite poner project_id/task_id a NULL (usa 'or existing.x') y reactiva silenciosamente items archivados (status forzado a 'active').
- Estados terminales de Proposal (ratified/rejected/superseded) no admiten ninguna transición: no hay reopen ni undo (backend/app/services/proposal_service.py:18-24).
- El deliberation trail exige Proposal con task_id Y project_id no nulos: las proposals de nivel workspace o solo-project no pueden registrar eventos de deliberación (backend/app/services/deliberation_service.py:39-40).
- No existe tabla dedicada de deliberación: el trail vive en events.proposal_id; borrar la proposal deja los eventos con proposal_id=NULL (ondelete SET NULL), rompiendo la trazabilidad.
- approved_decisions.superseded_by no tiene ForeignKey (UUID suelto, sin integridad referencial).
- publish_audit no tiene workspace_id/project_id: quedó fuera del multi-scope de 0003.
- context_sync_batches no tiene máquina de estados: status se fija al crear ('dry_run' o 'applied'); el default 'draft' nunca se usa; no hay estados de fallo/rollback.
- context_snapshots.version existe (default 1) pero nada la incrementa; staleness solo baja is_current, nunca versiona ni regenera snapshots.
- invalidate_context_for_scope deja el sistema sin scope current (no re-resuelve); el fallback posterior es el 'legacy_active_task' del focus_resolver.
- resolve_related_items solo navega links salientes (source->target); no hay traversal inverso ni multi-hop.
- events duplica metadata_json/payload_json (create_event_for_task escribe lo mismo en ambos); no hay CHECK/enum para event_type, severity, task.status, task.priority, context_items.status ni execution_sessions.status.
- stable_hash falla con TypeError ante payloads no JSON-serializables; la auditoría guarda solo hashes SHA-256, no diffs recuperables.
- updated_at se mantiene con onupdate ORM, no con triggers de DB: UPDATEs SQL directos (incluidos los update() masivos de staleness_service) no refrescan updated_at.
- Idempotencia de create_proposal por idempotency_key devuelve la proposal existente aunque el payload nuevo difiera (sin detección de mismatch).
- Los docs del repo tienen drift confirmado: el código de policies solo lista 17 tools en TOOL_ALLOWLISTS mientras el server MCP expone más; usar solo el código como referencia.
- seed_v1 re-ejecutado sobreescribe incondicionalmente la PolicyState (resetea mode/scope/redaction/approval_mode); ninguno de los seeds escribe approval_policy_json, así que tras seed el gate de ratificación queda desactivado ('default':'auto').

## 3. API HTTP, autenticación y configuración del backend

FastAPI app titulada "WIS Context Sync" con 11 endpoints HTTP: 2 en main.py (/ y /mcp/info), /health, 2 alias públicos (/active-task, /policy) y 6 bajo /internal/*. NINGÚN endpoint HTTP tiene autenticación (no hay Depends de auth ni middleware en toda app/api/); la verificación JWT (Auth0JWTTokenVerifier, RS256 vía JWKS) protege únicamente el servidor MCP en mcp_port=8002, no esta API en backend_port=8001. La configuración es una BaseSettings de pydantic-settings con 16 campos, .env como fuente, extra="ignore", y un model_validator que solo exige https/sin-path/resource_id cuando el runtime de auth MCP está activo (mcp_auth_enabled=True y mcp_auth_bypass_local=False).

### 3.1 `GET /`  ·  _endpoint_

**Interfaz:** `GET / -> 200 dict[str,str] literal: {"service": "wis-context-sync", "status": "ok", "message": "Backend running"}. Sin parámetros. Sin auth.`

Root informativo. Siempre 200, contenido estático. No toca BD.

**Evidencia:** backend/app/main.py:9-15

⚠️ **Caveats:** Definido directamente en la app (no en build_api_router).

### 3.2 `GET /mcp/info`  ·  _endpoint_

**Interfaz:** `GET /mcp/info -> 200 dict[str,str]: {"name": "WIS Context Sync MCP", "mode": "read-write-v2", "status": "ready", "auth_enabled": "true"|"false"}. Sin auth.`

auth_enabled es el string "true" si settings.mcp_auth_enabled and not settings.mcp_auth_bypass_local, si no "false". Importa get_settings dentro de la función (lazy).

**Evidencia:** backend/app/main.py:18-28

⚠️ **Caveats:** auth_enabled es string, no booleano JSON. Es informativo del servidor MCP (puerto separado), no de esta API.

### 3.3 `GET /health`  ·  _endpoint_

**Interfaz:** `GET /health -> response_model=HealthResponse {status: str, app: str, db: str, timestamp: str (ISO UTC), mode: str}. 200 si BD arriba; 503 (JSONResponse con el MISMO cuerpo) si BD abajo. Sin auth. Tag: health.`

Ejecuta SELECT 1 vía engine.connect() (check_database_connection devuelve tuple[bool, str|None]; SQLAlchemyError -> (False, str(exc))). status="ok"/"degraded", app siempre "up", db="up"/"down", timestamp=datetime.now(timezone.utc).isoformat(), mode=settings.system_mode (default "delegated_limited").

**Evidencia:** backend/app/api/health.py:13-29; backend/app/db/health.py:7-13; backend/app/schemas/health.py:4-9

⚠️ **Caveats:** El mensaje de error de BD se descarta (se ignora el segundo elemento de la tupla); el cuerpo 503 no incluye detalle del fallo.

### 3.4 `GET /active-task`  ·  _endpoint_

**Interfaz:** `GET /active-task -> response_model=TaskOut {id: UUID, title: str, goal: str, status: str, priority: str, branch: str|None, repo: str|None, next_action: str|None, current_phase: str|None, workspace_id: UUID, project_id: UUID, is_active: bool, created_at: datetime, updated_at: datetime}. Sin auth. Tag: public.`

Alias público de /internal/tasks/active. Resolución de tarea activa: primero ContextScope con is_current=True (order by created_at desc, limit 1) y su task_id; si no, la Task con is_active=True más recientemente actualizada (order by updated_at desc). Errores: 404 detail="No active task configured." (LookupError de require_active_task).

**Evidencia:** backend/app/api/public.py:13-18; backend/app/services/task_service.py:10-20,47-51; backend/app/schemas/task.py:7-23

### 3.5 `GET /policy`  ·  _endpoint_

**Interfaz:** `GET /policy -> response_model=PolicyStateOut {id: UUID, sync_enabled: bool, mode: str, scope: str, redaction_level: str, approval_mode: str, updated_at: datetime}. Sin auth. Tag: public.`

Alias público de /internal/policy/active. get_active_policy = el PolicyState más recientemente actualizado (select order by updated_at desc, first). Errores: 404 detail="No policy state configured." si no hay filas.

**Evidencia:** backend/app/api/public.py:21-26; backend/app/services/policy_service.py:7-9; backend/app/schemas/policy.py:7-16

### 3.6 `GET /internal/tasks/active`  ·  _endpoint_

**Interfaz:** `GET /internal/tasks/active -> response_model=TaskOut. Sin auth (los /internal/* NO tienen auth). Tag: internal.`

Idéntico a GET /active-task (misma require_active_task). 404 detail="No active task configured." si no hay tarea activa.

**Evidencia:** backend/app/api/internal.py:19-24; backend/app/services/task_service.py:47-51

### 3.7 `GET /internal/decisions/active`  ·  _endpoint_

**Interfaz:** `GET /internal/decisions/active -> response_model=list[ApprovedDecisionOut] {id: UUID, task_id: UUID|None, workspace_id: UUID, project_id: UUID|None, decision_key: str, title: str, category: str, decision: str, rationale: str, constraints_json: dict, approved_at: datetime, approved_by: str, superseded_by: UUID|None, is_active: bool, created_at: datetime, updated_at: datetime}. Sin auth.`

Resuelve la tarea activa (404 "No active task configured." si no hay) y devuelve ApprovedDecision con task_id == tarea activa AND is_active=True, ordenadas por approved_at desc, updated_at desc. Solo nivel task: NO mezcla decisiones de project/workspace (esa fusión list_active_decisions_for_scope existe pero no se usa aquí).

**Evidencia:** backend/app/api/internal.py:27-33; backend/app/services/decision_service.py:9-15; backend/app/schemas/decision.py:7-25

### 3.8 `GET /internal/events/recent`  ·  _endpoint_

**Interfaz:** `GET /internal/events/recent?limit=<int> -> response_model=list[EventOut]. Query param limit: int, default=20, ge=1, le=100 (422 fuera de rango). EventOut: {id: UUID, task_id: UUID, workspace_id: UUID, project_id: UUID, consumer_id: UUID|None, execution_session_id: UUID|None, event_type: str, summary: str, source: str, severity: str, metadata_json: dict, payload_json: dict, event_ts: datetime, created_at: datetime}. Sin auth.`

404 "No active task configured." si no hay tarea activa. Devuelve Event de la tarea activa ordenados por event_ts desc, limit aplicado en SQL.

**Evidencia:** backend/app/api/internal.py:36-45; backend/app/services/event_service.py:12-19; backend/app/schemas/event.py:15-31

### 3.9 `POST /internal/events`  ·  _endpoint_

**Interfaz:** `POST /internal/events body=EventCreate {event_type: str (min_length=1), summary: str (min_length=1), source: str = "internal_api", severity: str = "info", metadata_json: dict = {}} -> 201 response_model=EventOut. Sin auth.`

404 "No active task configured." si no hay tarea activa. Crea Event heredando workspace_id/project_id de la tarea; payload_json se rellena con EL MISMO valor que metadata_json (no se puede fijar por separado). commit + refresh y devuelve el evento creado.

**Evidencia:** backend/app/api/internal.py:48-54; backend/app/services/event_service.py:22-41; backend/app/schemas/event.py:7-12

⚠️ **Caveats:** Sin enums: event_type/severity/source aceptan cualquier string. create_event_for_task puede lanzar LookupError("Task not found.") que el endpoint NO captura (sería 500), aunque en la práctica es inalcanzable salvo carrera porque task.id viene de require_active_task.

### 3.10 `GET /internal/policy/active`  ·  _endpoint_

**Interfaz:** `GET /internal/policy/active -> response_model=PolicyStateOut. Sin auth.`

Idéntico a GET /policy. 404 detail="No policy state configured." si no existe PolicyState.

**Evidencia:** backend/app/api/internal.py:57-62; backend/app/services/policy_service.py:7-9

### 3.11 `POST /internal/snapshots/manual`  ·  _endpoint_

**Interfaz:** `POST /internal/snapshots/manual body=ManualSnapshotCreate {snapshot_type: str = "manual_test", snapshot_content: dict = {}, policy_applied: str|None = None} -> 201 response_model=ContextSnapshotOut {id: UUID, task_id: UUID, workspace_id: UUID, project_id: UUID, consumer_id: UUID|None, execution_session_id: UUID|None, snapshot_type: str, snapshot_content: dict, policy_applied: str, generated_from: str, created_at: datetime}. Sin auth.`

Dos gates 404: "No active task configured." (sin tarea activa) y "No policy state configured." (sin PolicyState). Crea ContextSnapshot con workspace_id/project_id heredados de la tarea, policy_applied = payload.policy_applied or policy.mode (modo de la política activa como fallback), generated_from="manual_api" fijo.

**Evidencia:** backend/app/api/internal.py:65-76; backend/app/services/snapshot_service.py:11-33; backend/app/schemas/snapshot.py:7-26

⚠️ **Caveats:** Mismo riesgo teórico de LookupError("Task not found.") no capturado dentro de create_manual_snapshot (500 en carrera).

### 3.12 `build_api_router`  ·  _service_

**Interfaz:** `build_api_router() -> APIRouter; incluye health_router, public_router, internal_router en ese orden. app = FastAPI(title="WIS Context Sync") y app.include_router(build_api_router()).`

Composición del router. No hay middleware alguno (ni CORS, ni auth, ni logging) registrado en la app FastAPI.

**Evidencia:** backend/app/api/router.py:8-13; backend/app/main.py:5-6

### 3.13 `get_db`  ·  _service_

**Interfaz:** `get_db() -> Generator[Session, None, None]; dependencia FastAPI usada por todos los endpoints con BD.`

engine = create_engine(settings.database_url, pool_pre_ping=True). SessionLocal con autocommit=False, autoflush=False, expire_on_commit=False. Cierra la sesión en finally.

**Evidencia:** backend/app/db/session.py:10-28

### 3.14 `Settings (pydantic BaseSettings)`  ·  _setting_

**Interfaz:** `class Settings(BaseSettings) con model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore"). 16 campos (ver lista config). get_settings() decorado con @lru_cache (singleton por proceso).`

Normalizadores field_validator (mode=before): database_url reemplaza prefijo "postgresql://" por "postgresql+psycopg://" (solo ese prefijo exacto, 1 vez); mcp_public_base_url strip + vacío->None + rstrip("/"); mcp_resource_id strip + vacío->None; mcp_log_level upper + debe estar en {DEBUG, INFO, WARNING, ERROR, CRITICAL} o ValueError "MCP_LOG_LEVEL must be one of: ..."; mcp_log_include_headers_allowlist split por coma, strip, lowercase, re-join; mcp_allowed_origins split por coma y saltos de línea, strip, lowercase, dedupe preservando orden.

**Evidencia:** backend/app/core/config.py:8-31,33-90,145-147

⚠️ **Caveats:** database_url es el ÚNICO campo sin default: sin DATABASE_URL el proceso no arranca. lru_cache implica que cambios de entorno requieren reinicio. "postgres://" (sin ql) NO se normaliza.

### 3.15 `Settings.validate_auth_runtime_settings (model_validator mode=after)`  ·  _guard_

**Interfaz:** `validate_auth_runtime_settings(self) -> Settings. Auxiliar: _validate_absolute_http_uri(value, env_name) exige urlparse.scheme in {"http","https"} y netloc no vacío, si no ValueError "{env_name} must be an absolute URI (http/https)."`

Orden exacto: (1) si mcp_resource_id está definido, valida que sea URI absoluta http/https (SIEMPRE, incluso con auth desactivada). (2) auth_runtime_enabled = mcp_auth_enabled and not mcp_auth_bypass_local; si False, retorna sin más comprobaciones. (3) Si True: mcp_public_base_url obligatorio (error: "MCP_PUBLIC_BASE_URL is required when MCP auth runtime is enabled (MCP_AUTH_ENABLED=true and MCP_AUTH_BYPASS_LOCAL=false)."); debe empezar por "https://" (error: "MCP_PUBLIC_BASE_URL must be an https URL."); sin query ni fragment ("MCP_PUBLIC_BASE_URL must not include query params or fragments."); path debe ser "" o "/" ("MCP_PUBLIC_BASE_URL must not include a path (do not use /mcp)."). (4) effective_mcp_resource_id = mcp_resource_id or mcp_auth0_audience; obligatorio ("MCP_RESOURCE_ID or MCP_AUTH0_AUDIENCE is required when MCP auth runtime is enabled.") y debe ser URI absoluta http/https (se re-valida con env_name "MCP_RESOURCE_ID").

**Evidencia:** backend/app/core/config.py:92-126,128-130

⚠️ **Caveats:** NO valida aquí mcp_auth0_issuer/mcp_auth0_audience/mcp_auth0_jwks_url como trío: esa comprobación vive en el arranque del servidor MCP (RuntimeError en backend/app/mcp/server.py:161-165, y :167-169 para public_base_url). El resource_id efectivo puede ser http:// (solo el base_url exige https). Tampoco valida mcp_auth_clock_skew_seconds negativo (el server lo clampa con max(...,0) en backend/app/mcp/server.py:180).

### 3.16 `Settings.effective_mcp_resource_id / has_legacy_resource_id_divergence / mcp_allowed_origins_list`  ·  _setting_

**Interfaz:** `@property effective_mcp_resource_id -> str|None = mcp_resource_id or mcp_auth0_audience. @property has_legacy_resource_id_divergence -> bool = ambos definidos Y distintos. @property mcp_allowed_origins_list -> list[str] (split por coma del string ya normalizado; [] si vacío).`

effective_mcp_resource_id es el resource que se inyecta al verificador JWT. has_legacy_resource_id_divergence dispara un log WARNING "mcp_auth_legacy_resource_id_divergence" al arrancar el servidor MCP.

**Evidencia:** backend/app/core/config.py:128-142; backend/app/mcp/server.py:196-200

### 3.17 `Auth0JWTTokenVerifier`  ·  _guard_

**Interfaz:** `class Auth0JWTTokenVerifier(TokenVerifier) [de mcp.server.auth.provider]. __init__(*, issuer: str, audience: str, jwks_url: str, resource_id: str|None = None, clock_skew_seconds: int = 60, algorithms: Iterable[str] = ("RS256",)). async verify_token(token: str) -> AccessToken | None.`

issuer se normaliza a issuer.rstrip("/")+"/" (siempre con barra final). resource_id = resource_id or audience. jwks: PyJWKClient(jwks_url) y get_signing_key_from_jwt(token). Decodificación: jwt.decode(token, signing_key.key, algorithms=["RS256"] (única por defecto), audience=self.audience, issuer=self.issuer, leeway=self.clock_skew_seconds, options={"require": ["iss", "aud", "exp"]}). Claims requeridos: iss, aud, exp. Leeway = clock_skew_seconds (default 60s; en producción viene de max(settings.mcp_auth_clock_skew_seconds, 0)). Éxito: extrae scopes, expires_at = int(exp) si exp es int/float, si no None; client_id = str(azp or client_id or sub or "unknown") (en ese orden de precedencia); emite log "mcp_auth_token_verified" (iss, aud, sub, azp, scopes, expires_at); devuelve AccessToken(token=token, client_id=client_id, scopes=scopes, expires_at=expires_at_value, resource=self.resource_id).

**Evidencia:** backend/app/auth/jwt_verifier.py:75-107,173-200; instanciación: backend/app/mcp/server.py:175-181

⚠️ **Caveats:** Solo protege el servidor MCP (FastMCP en mcp_port con AuthSettings required_scopes=["wis.context.read"], backend/app/mcp/server.py:170-174); la API HTTP FastAPI no lo usa en absoluto. No hay caché explícita de JWKS más allá de la interna de PyJWKClient. No valida claim nbf explícitamente en require (PyJWT lo verifica si está presente, con el mismo leeway).

### 3.18 `Auth0JWTTokenVerifier — manejo de excepciones`  ·  _guard_

**Interfaz:** `Todas devuelven None (token rechazado) y emiten evento "mcp_auth_invalid" con auth_stage="jwt_verifier", expected_issuer, expected_audience.`

Orden de captura: (1) ExpiredSignatureError -> failure_reason="expired", level WARNING, SIN claims en el log. (2) InvalidAudienceError -> "invalid_audience", WARNING, incluye claims=sanitize_auth_claims(decode_unverified_claims(token)). (3) InvalidIssuerError -> "invalid_issuer", WARNING, con claims saneados. (4) InvalidSignatureError -> "invalid_signature", WARNING, SIN claims. (5) InvalidTokenError (catch-all PyJWT, incluye claims requeridos ausentes) -> "invalid_token", WARNING, con claims saneados. (6) Exception genérica (p.ej. fallo de red al JWKS) -> "unexpected_error", level ERROR, con exception={class, message}. sanitize_auth_claims solo deja pasar el allowlist {iss, aud, sub, azp, client_id, scope, scp, permissions, exp} (backend/app/mcp/observability.py:100-115).

**Evidencia:** backend/app/auth/jwt_verifier.py:108-171

⚠️ **Caveats:** Un fallo de JWKS (red/clave no encontrada) cae en el catch genérico -> el cliente ve el mismo rechazo que un token inválido. El logger _jwt_logger es @lru_cache y si get_settings() falla usa fallback SimpleNamespace(mcp_log_level="INFO", mcp_log_json=True, mcp_log_payloads=False, mcp_log_include_headers_allowlist=None) (backend/app/auth/jwt_verifier.py:60-72).

### 3.19 `extract_scopes_from_claims + normalize_scopes`  ·  _guard_

**Interfaz:** `extract_scopes_from_claims(claims: dict) -> list[str]; normalize_scopes(raw_scope: str | list[str] | None) -> list[str].`

Precedencia estricta de extracción: (1) claims["scope"] SOLO si es str; (2) claims["scp"] si es str O list; (3) claims["permissions"] SOLO si es list; (4) []. normalize_scopes: None -> []; str -> reemplaza comas por espacios, split por whitespace, strip; list -> str() de cada elemento + strip; en ambos casos devuelve sorted(set(tokens)) — orden alfabético estable y deduplicado.

**Evidencia:** backend/app/auth/jwt_verifier.py:22-30,43-57

⚠️ **Caveats:** Si "scope" existe pero es lista, se IGNORA y se pasa a "scp". "permissions" como string se ignora. El orden original de scopes se pierde (siempre alfabético).

### 3.20 `decode_unverified_claims`  ·  _guard_

**Interfaz:** `decode_unverified_claims(token: str) -> dict[str, Any].`

jwt.decode(token, options={"verify_signature": False, "verify_aud": False}) — NO verifica firma, audiencia, expiración ni nada. Devuelve el dict de claims si el payload es un dict; ante CUALQUIER excepción o payload no-dict devuelve {} (nunca lanza). Usos: (1) adjuntar claims saneados a los logs de fallo de auth (jwt_verifier.py:126,137,158); (2) _extract_actor_context en el servidor MCP para derivar actor_sub del claim sub del token YA verificado (backend/app/mcp/server.py:281); (3) _auth_context_fields para campos iss/aud/sub/azp en logs (backend/app/mcp/server.py:325).

**Evidencia:** backend/app/auth/jwt_verifier.py:33-40

⚠️ **Caveats:** Es estrictamente para observabilidad/atribución post-verificación; jamás debe usarse como gate de autorización porque no valida nada.

### 3.21 `sanitize_auth_claims`  ·  _guard_

**Interfaz:** `sanitize_auth_claims(claims: Mapping[str, Any] | None) -> dict[str, Any].`

Allowlist exacto de claims que llegan a logs: iss, aud, sub, azp, client_id, scope, scp, permissions, exp; el resultado pasa además por sanitize_structure. Claims None/vacíos -> {}.

**Evidencia:** backend/app/mcp/observability.py:100-115

### Configuración (backend-http-auth)

| Clave | Default | Efecto |
|---|---|---|
| `PROJECT_NAME (project_name)` | `shared-dev-context-layer` | Nombre del proyecto; no se usa en la API HTTP (backend/app/core/config.py:9). |
| `BACKEND_PORT (backend_port)` | `8001` | Puerto previsto para la API FastAPI; main.py no lo consume directamente (lo usa el runner externo/uvicorn) (backend/app/core/config.py:10). |
| `MCP_PORT (mcp_port)` | `8002` | Puerto del servidor FastMCP (backend/app/core/config.py:11; backend/app/mcp/server.py:188). |
| `DATABASE_URL (database_url)` | `(SIN default — obligatorio)` | URL SQLAlchemy; prefijo postgresql:// se reescribe a postgresql+psycopg:// (backend/app/core/config.py:12,33-38). Sin ella el proceso no arranca. |
| `SYSTEM_MODE (system_mode)` | `delegated_limited` | Se expone como campo mode en GET /health (backend/app/core/config.py:13; backend/app/api/health.py:23). |
| `MCP_AUTH_ENABLED (mcp_auth_enabled)` | `True` | Junto con bypass define auth_runtime_enabled: activa validaciones del model_validator y la auth del servidor MCP (backend/app/core/config.py:14,103). |
| `MCP_AUTH_BYPASS_LOCAL (mcp_auth_bypass_local)` | `False` | True desactiva el runtime de auth aunque mcp_auth_enabled sea True (backend/app/core/config.py:15,103). |
| `MCP_AUTH0_ISSUER (mcp_auth0_issuer)` | `None` | Issuer esperado del JWT; el verificador lo normaliza con barra final. No lo valida config.py, sí el arranque MCP (RuntimeError si falta con auth activa) (backend/app/core/config.py:16; backend/app/mcp/server.py:161-165; backend/app/auth/jwt_verifier.py:88). |
| `MCP_AUTH0_AUDIENCE (mcp_auth0_audience)` | `None` | Audience esperada del jwt.decode; también fallback del resource_id efectivo (backend/app/core/config.py:17,128-130). |
| `MCP_AUTH0_JWKS_URL (mcp_auth0_jwks_url)` | `None` | URL del JWKS para PyJWKClient (backend/app/core/config.py:18; backend/app/auth/jwt_verifier.py:91). |
| `MCP_PUBLIC_BASE_URL (mcp_public_base_url)` | `None` | Con auth activa: obligatoria, https://, sin query/fragment, sin path (path debe ser "" o "/"); normalizada con strip+rstrip("/") (backend/app/core/config.py:19,40-48,107-119). |
| `MCP_RESOURCE_ID (mcp_resource_id)` | `None` | Si está definido debe ser URI absoluta http/https (se valida SIEMPRE, incluso sin auth). effective = mcp_resource_id or mcp_auth0_audience; obligatorio con auth activa (backend/app/core/config.py:20,50-58,100-101,120-125). |
| `MCP_ALLOWED_ORIGINS (mcp_allowed_origins)` | `"" (vacío)` | Lista CSV/multilínea normalizada (lowercase, dedupe). NO se aplica a la API HTTP (no hay CORSMiddleware); solo disponible vía mcp_allowed_origins_list para el plano MCP (backend/app/core/config.py:21,77-90,138-142). |
| `MCP_AUTH_CLOCK_SKEW_SECONDS (mcp_auth_clock_skew_seconds)` | `60` | leeway de jwt.decode. Config no valida negativos; el server MCP aplica max(valor, 0) al instanciar el verificador (backend/app/core/config.py:22; backend/app/mcp/server.py:180; backend/app/auth/jwt_verifier.py:105). |
| `MCP_LOG_LEVEL (mcp_log_level)` | `INFO` | Debe pertenecer a {DEBUG, INFO, WARNING, ERROR, CRITICAL} (upper-case automático); si no, ValueError al cargar settings (backend/app/core/config.py:23,60-67). |
| `MCP_LOG_JSON (mcp_log_json)` | `True` | Formato JSON del logger estructurado MCP (backend/app/core/config.py:24). |
| `MCP_LOG_PAYLOADS (mcp_log_payloads)` | `False` | Si se loguean payloads (backend/app/core/config.py:25). |
| `MCP_LOG_INCLUDE_HEADERS_ALLOWLIST (mcp_log_include_headers_allowlist)` | `x-request-id,mcp-session-id,user-agent,x-forwarded-for,traceparent,mcp-protocol-version,accept,content-type` | Headers permitidos en logs; normalizado a lowercase sin espacios (backend/app/core/config.py:26-29,69-75). |

### Qué NO soporta hoy (backend-http-auth)

- NINGÚN endpoint HTTP tiene autenticación ni autorización: no existe Depends de auth, middleware ni API key en backend/app/main.py ni backend/app/api/*.py. /internal/* es tan público como /health. El JWT/Auth0 protege exclusivamente el servidor MCP (mcp_port=8002).
- No hay CORSMiddleware ni ningún otro middleware en la app FastAPI; MCP_ALLOWED_ORIGINS no afecta a la API HTTP.
- La API HTTP es de alcance mínimo: no permite crear/editar tareas, políticas, decisiones, propuestas ni items de contexto; solo lecturas + POST de eventos y snapshots manuales. ProposalOut (backend/app/schemas/proposal.py) está definido pero NINGÚN endpoint HTTP lo usa (solo el plano MCP).
- POST /internal/events no permite fijar payload_json (siempre se copia metadata_json), ni consumer_id ni execution_session_id (quedan NULL); tampoco valida enums de event_type/severity/source.
- Sin paginación real: /internal/events/recent solo admite limit 1..100 (default 20), sin offset/cursor. /internal/decisions/active no tiene límite alguno.
- GET /internal/decisions/active solo devuelve decisiones a nivel de task; no fusiona project/workspace aunque el servicio list_active_decisions_for_scope exista (backend/app/services/decision_service.py:45-63).
- El model_validator de Settings NO exige el trío MCP_AUTH0_ISSUER/AUDIENCE/JWKS_URL: esa validación se pospone al arranque del servidor MCP (RuntimeError, backend/app/mcp/server.py:161-169), por lo que una config incompleta pasa la carga de Settings.
- El resource_id efectivo admite http:// (solo MCP_PUBLIC_BASE_URL exige https).
- normalize_database_url solo reescribe el prefijo exacto postgresql://; postgres:// no se soporta.
- get_settings() usa lru_cache: cambios de entorno requieren reinicio del proceso.
- verify_token solo admite RS256 por defecto (algorithms=("RS256",)); nadie pasa otra lista en el código, así que HS256/ES256/etc. no están soportados.
- decode_unverified_claims no verifica nada (firma, exp, aud): solo apto para logs/atribución; el servidor MCP lo usa para derivar actor_sub de un token ya verificado.
- LookupError("Task not found.") lanzado dentro de create_event_for_task/create_manual_snapshot no está capturado por los endpoints (500 teórico en condición de carrera).
- El cuerpo del 503 de /health no incluye el mensaje de error de la BD (se descarta).
- GET /mcp/info devuelve auth_enabled como string "true"/"false", no booleano.

## 4. Extensión VS Code — control plane remoto

Extensión VS Code "WIS Context Sync" que actúa como control plane autenticado sobre un servidor MCP (Streamable HTTP, default http://localhost:8002/mcp) con doble runtime: offline_fixture (determinista, 6 escenarios) y mcp (transporte real). Expone 18 comandos: 5 de control plane (load/reset/handoff/auth), 7 de context tools (write plane con dry_run e idempotency_key) y 6 locales (perfil local_private). El read plane llama 5 tools WIS y normaliza cada resultado a kinds ok/remote_error/transport_error/schema_error/unavailable componiendo un OperationalContextEnvelope en memoria, del cual se deriva un HandoffArtifact (ready/partial/blocked) con prompts para Codex. Auth con modos none/bearer/api_key, token en SecretStorage y gate RuntimeAuthPolicy previo a cada comando remoto; salida por output channel "WIS Context Sync" y un webview de solo lectura "WIS Local Runtime".

### 4.1 `wisContextSync.loadOperationalContext`  ·  _vscode_command_

**Interfaz:** `Command id: wisContextSync.loadOperationalContext | Título: "WIS: Load Operational Context" | Sin argumentos de usuario`

Gate de auth: resuelve AuthRuntimeContext via AuthManager y evalúa RuntimeAuthPolicy.evaluate(auth); si !allowed, loguea '[WIS][AUTH][POLICY] ... blocked. code=<code>' y muestra error, sin ejecutar load. Si pasa, llama LoadOperationalContextService.load(auth): emite LoadEvents (load_started/local_inspection_completed/wis_bundle_loaded/load_completed), inspecciona entorno local, crea gateway según runtimeMode (offline_fixture→FixtureWISGateway(fixtureScenario), mcp→McpWISGateway), compone OperationalContextEnvelope, lo guarda en InMemoryOperationalContextStore, lo presenta en output channel y muestra toast con load_state/runtime_mode/transport_status/auth/session_key.

**Evidencia:** vscode-extension/src/activation/registrars/controlPlaneRegistrar.ts:12-32; vscode-extension/src/application/loadOperationalContextService.ts:96-178; vscode-extension/src/activation/bootstrap.ts:154-167

⚠️ **Caveats:** El gate de auth se aplica también en modo offline_fixture (el fixture no usa el token). Nunca pasa scope (workspace_id/project_id/task_id) al gateway: WISLoadInput.scope queda undefined siempre.

### 4.2 `wisContextSync.resetSession`  ·  _vscode_command_

**Interfaz:** `Command id: wisContextSync.resetSession | Título: "WIS: Reset Session"`

Genera nueva session_key con formato `wis-vscode-${Date.now()}-${randomUUID().slice(0,8)}` y la persiste en workspaceState (keys wisContextSync.sessionKey y wisContextSync.sessionCreatedAt). Reporta DiagnosticsSnapshot evento 'session_reset' y muestra la nueva session_key. No requiere auth (sin gate de policy).

**Evidencia:** vscode-extension/src/activation/registrars/controlPlaneRegistrar.ts:34-41; vscode-extension/src/sessionManager.ts:41-55; vscode-extension/src/constants.ts:66-67

⚠️ **Caveats:** No limpia el contextStore ni el handoffArtifactStore: el envelope previo (con la session_key vieja) sigue disponible para prepareHandoff.

### 4.3 `wisContextSync.prepareHandoff`  ·  _vscode_command_

**Interfaz:** `Command id: wisContextSync.prepareHandoff | Título: "WIS: Prepare Handoff" | Intent hardcodeado: user_intent='Preparar handoff estructurado para siguiente ejecución Codex.', local_focus=[active_file del último envelope] o [], detail_level='standard', target='codex'`

Lee el último OperationalContextEnvelope del store en memoria y construye HandoffArtifact vía HandoffBuilder.build. Estado del build: load_state 'loaded'→'ready'; 'partially_loaded'|'degraded'→'partial'; cualquier otro (o envelope ausente)→'blocked' (artifact=null, issue con evidence_hint 'Ejecutar `WIS: Load Operational Context` antes de preparar handoff.'). En 'partial' añade uncertainty_note y issue warning. Renderiza el artifact al output channel (incl. codex_ask_prompt y codex_code_prompt) y guarda el resultado en InMemoryHandoffArtifactStore. Límites: MAX_DECISIONS=10, MAX_ERRORS=10, MAX_CANDIDATE_FILES=5, MAX_RISKS=8.

**Evidencia:** vscode-extension/src/activation/registrars/controlPlaneRegistrar.ts:43-63; vscode-extension/src/application/handoffBuilder.ts:13-16,43-51,182-316; vscode-extension/src/presentation/renderers/handoffOutputChannelRenderer.ts:8-42

⚠️ **Caveats:** No requiere auth. target siempre 'codex' desde la UI (los targets 'chatgpt' y 'github_copilot' existen en el type pero no son seleccionables). detail_level se declara en HandoffIntent pero el builder NUNCA lo lee: compact/standard/full no cambian nada. El artifact solo vive en memoria (se pierde al recargar la ventana).

### 4.4 `wisContextSync.configureAuthentication`  ·  _vscode_command_

**Interfaz:** `Command id: wisContextSync.configureAuthentication | Título: "WIS: Configure Authentication" | InputBox password:true, validateInput rechaza vacío`

AuthManager.configureInteractive(): si authMode==='none' retorna sin pedir token y el comando muestra warning pidiendo cambiar wisContextSync.authMode a 'bearer' o 'api_key'. Si no, pide token por InputBox (prompt 'Ingresa Bearer token' o 'Ingresa token para header <header_name>') y lo guarda con trim en SecretStorage key exacta 'wisContextSync.authToken'. Muestra info con mode y required.

**Evidencia:** vscode-extension/src/activation/registrars/controlPlaneRegistrar.ts:65-82; vscode-extension/src/auth/authManager.ts:32-67; vscode-extension/src/constants.ts:68

### 4.5 `wisContextSync.clearAuthentication`  ·  _vscode_command_

**Interfaz:** `Command id: wisContextSync.clearAuthentication | Título: "WIS: Clear Authentication"`

Borra SecretStorage key 'wisContextSync.authToken' (context.secrets.delete) y muestra 'Token de autenticación eliminado de SecretStorage.'

**Evidencia:** vscode-extension/src/activation/registrars/controlPlaneRegistrar.ts:84-88; vscode-extension/src/auth/authManager.ts:69-71

### 4.6 `wisContextSync.searchContext`  ·  _vscode_command_

**Interfaz:** `Command id: wisContextSync.searchContext | Título: "WIS: Search Context" | Pide query por InputBox. Llama tool MCP 'search_context' con args: { query, limit: 20, offset: 0, consumer, session_key }`

Único comando del write plane sin dry_run ni idempotency_key. Pasa por el executor común: gate RuntimeAuthPolicy, obtiene sesión, llama McpContextPlaneClient.callTool contra wisContextSync.mcpEndpoint con timeout requestTimeoutMs, renderiza ContextPlaneResponse al output channel; en fallo muestra 403 'insufficient_scope' + required_scopes, 401 'unauthorized', u otro mensaje.

**Evidencia:** vscode-extension/src/activation/registrars/contextToolsRegistrar.ts:18-30; vscode-extension/src/application/contextCommandService.ts:15-17; vscode-extension/src/activation/commands/commandExecutors.ts:11-53

⚠️ **Caveats:** limit=20 y offset=0 hardcodeados; sin paginación. Ignora runtimeMode: SIEMPRE golpea el endpoint MCP real, incluso con runtimeMode=offline_fixture.

### 4.7 `wisContextSync.upsertContextItem`  ·  _vscode_command_

**Interfaz:** `Command id: wisContextSync.upsertContextItem | Título: "WIS: Upsert Context Item" | Prompts: item_key, title, item_type (default 'note', hint note|decision|risk), labels CSV opcional, QuickPick dry_run/commit. Tool MCP 'upsert_context_item' args: { item_key, item_type, title, content: {}, labels: string[], dry_run: boolean, [idempotency_key: 'upsert-context-item-<uuid>' solo si commit], consumer, session_key }`

idempotency_key se inyecta SOLO cuando dry_run=false, con formato `upsert-context-item-${randomUUID()}` vía McpContextPlaneClient.nextIdempotencyKey. content siempre {} desde la UI (el service acepta content pero el comando no lo pide).

**Evidencia:** vscode-extension/src/activation/registrars/contextToolsRegistrar.ts:32-68; vscode-extension/src/application/contextCommandService.ts:19-39; vscode-extension/src/infrastructure/wis/mcpContextPlaneClient.ts:146-148

### 4.8 `wisContextSync.appendContextEvent`  ·  _vscode_command_

**Interfaz:** `Command id: wisContextSync.appendContextEvent | Título: "WIS: Append Context Event" | Prompts: summary, event_type (default 'info'), QuickPick dry_run/commit. Tool MCP 'append_context_event' args: { event_type, summary, severity: 'info', source: 'vscode_extension', dry_run, [idempotency_key: 'append-context-event-<uuid>' solo commit], consumer, session_key }`

severity y source no configurables desde UI (defaults 'info' y 'vscode_extension' aplicados en el service).

**Evidencia:** vscode-extension/src/activation/registrars/contextToolsRegistrar.ts:70-91; vscode-extension/src/application/contextCommandService.ts:41-59

### 4.9 `wisContextSync.linkContextEntities`  ·  _vscode_command_

**Interfaz:** `Command id: wisContextSync.linkContextEntities | Título: "WIS: Link Context Entities" | Prompts: source UUID, target UUID, relation (default 'depends_on', hint depends_on|blocks|relates_to), dry_run/commit. Tool MCP 'link_context_entities' args: { source_item_id, target_item_id, relation, dry_run, [idempotency_key: 'link-context-entities-<uuid>' solo commit], consumer, session_key }`

relation es texto libre (el hint sugiere el enum pero no se valida en cliente).

**Evidencia:** vscode-extension/src/activation/registrars/contextToolsRegistrar.ts:93-119; vscode-extension/src/application/contextCommandService.ts:61-77

### 4.10 `wisContextSync.setContextLabels`  ·  _vscode_command_

**Interfaz:** `Command id: wisContextSync.setContextLabels | Título: "WIS: Set Context Labels" | Prompts: context_item_id UUID, labels CSV (obligatorio), dry_run/commit. Tool MCP 'set_context_labels' args: { context_item_id, labels: string[], dry_run, [idempotency_key: 'set-context-labels-<uuid>' solo commit], consumer, session_key }`

labels se parsean por split(',') con trim y filtrado de vacíos (labelsFromInput).

**Evidencia:** vscode-extension/src/activation/registrars/contextToolsRegistrar.ts:121-142; vscode-extension/src/application/contextCommandService.ts:79-93; vscode-extension/src/activation/commands/commandUiUtils.ts:31-36

### 4.11 `wisContextSync.archiveContextItem`  ·  _vscode_command_

**Interfaz:** `Command id: wisContextSync.archiveContextItem | Título: "WIS: Archive Context Item" | Prompts: context_item_id UUID, dry_run/commit. Tool MCP 'archive_context_item' args: { context_item_id, dry_run, [idempotency_key: 'archive-context-item-<uuid>' solo commit], consumer, session_key }`

Archivado con preview dry_run opcional; misma tubería que el resto del write plane.

**Evidencia:** vscode-extension/src/activation/registrars/contextToolsRegistrar.ts:144-160; vscode-extension/src/application/contextCommandService.ts:95-107

### 4.12 `wisContextSync.applySyncBatch`  ·  _vscode_command_

**Interfaz:** `Command id: wisContextSync.applySyncBatch | Título: "WIS: Apply Sync Batch" | Prompt: JSON array de operaciones (default '[{"operation":"upsert_context_item"}]'), dry_run/commit. Tool MCP 'apply_sync_batch' args: { operations: Array<Record<string,unknown>>, dry_run, [idempotency_key: 'apply-sync-batch-<uuid>' solo commit], consumer, session_key }`

Valida en cliente que el JSON parsee y sea array; si no, muestra error y aborta sin llamar al MCP.

**Evidencia:** vscode-extension/src/activation/registrars/contextToolsRegistrar.ts:162-197; vscode-extension/src/application/contextCommandService.ts:109-121

### 4.13 `Comandos locales (6): localIndex, localPrepareTask, localRunCodex, localRefresh, localDoctor, localConfigureDbPassword`  ·  _vscode_command_

**Interfaz:** `wisContextSync.localIndex → "WIS: Local Index"; wisContextSync.localPrepareTask → "WIS: Local Prepare Task" (pide objetivo técnico); wisContextSync.localRunCodex → "WIS: Local Run Codex" (withProgress cancelable via AbortController); wisContextSync.localRefresh → "WIS: Local Refresh"; wisContextSync.localDoctor → "WIS: Local Doctor"; wisContextSync.localConfigureDbPassword → "WIS: Local Configure DB Password" (InputBox password; vacío = delete de SecretStorage key 'wisContextSync.localDbPassword')`

Total 18 comandos en package.json (5 control plane + 7 context tools + 6 locales). Los locales delegan en LocalCommandService (perfil local_private) y LocalDoctorService; localDoctor imprime LocalDoctorReport JSON con checks {environment.inspect, workspace.boundary, auth.policy, local.db (solo local_private), runtime.mode} y overall pass|warn|fail. localRunCodex interpreta review_decision (accept|accept_with_warnings|needs_manual_review|retry_recommended|blocked|reject) para el toast. Los comandos locales NO pasan por RuntimeAuthPolicy (salvo el check auth.policy informativo dentro de doctor).

**Evidencia:** vscode-extension/package.json:44-117; vscode-extension/src/activation/registrars/localRuntimeRegistrar.ts:15-138; vscode-extension/src/platform/doctor/localDoctorService.ts:48-145; vscode-extension/src/local/types.ts:196-202

### 4.14 `Runtime modes (2): mcp | offline_fixture`  ·  _service_

**Interfaz:** `type RuntimeMode = "mcp" | "offline_fixture"; selección por setting wisContextSync.runtimeMode (default "offline_fixture"); factory: offline_fixture→new FixtureWISGateway(fixtureScenario), mcp→new McpWISGateway()`

El modo solo afecta al READ plane (loadOperationalContext). Valores inválidos del setting se normalizan al default offline_fixture.

**Evidencia:** vscode-extension/src/domain/operationalContext.ts:4; vscode-extension/src/config.ts:60-65,95-98; vscode-extension/src/activation/bootstrap.ts:161-166

⚠️ **Caveats:** El write plane (7 context tools) no respeta runtimeMode: siempre transporte MCP real.

### 4.15 `FixtureWISGateway — 6 fixture scenarios`  ·  _service_

**Interfaz:** `type FixtureScenario = "success_full" | "partial_missing_recent_errors" | "degraded_no_remote_bundle" | "transport_error" | "no_active_task" | "validation_stale" (default "success_full")`

success_full: los 5 payloads ok con scope fijo {workspace_id:'ws-fixture-001', project_id:'prj-fixture-001', task_id:'task-fixture-001'}. validation_stale: igual pero get_validation_status devuelve current_status='stale' (genera issue con conflict_flag 'validation_stale'). no_active_task: todas las tools devuelven status='no_active_task' con task_id:null y fallback_level 'project_only' (kind remote_error). partial_missing_recent_errors: solo get_recent_errors falla con kind transport_error. transport_error: las 5 con kind transport_error ('Fixture simula timeout de transporte.'). degraded_no_remote_bundle: las 5 con kind unavailable ('Fixture simula endpoint no disponible.'). Scenario desconocido → schema_error. transport_diagnostics en fixture NO incluye available_tools/missing_tools.

**Evidencia:** vscode-extension/src/infrastructure/wis/fixtureWISGateway.ts:6-12,14-26,183-229,170-181

⚠️ **Caveats:** El fixture ignora auth y session (input no usado en runTool). Determinista salvo timestamps (new Date()).

### 4.16 `McpWISGateway — read plane (5 tools WIS)`  ·  _service_

**Interfaz:** `WIS_TOOLS = ["get_active_task", "get_context_snapshot", "get_validation_status", "get_approved_decisions", "get_recent_errors"]. Args por tool via scopeArguments: { consumer, session_key } + opcionales workspace_id/project_id/task_id si scope presente. Cliente MCP SDK Client({name:'wis-context-sync-vscode', version:'0.0.1'}) sobre StreamableHTTPClientTransport(endpoint); listTools y callTool ambos con { timeout: timeout_ms }.`

loadOperationalBundle: (1) pre-gate: si auth.mode!=='none' && auth.required && !auth.token → bundle failure con las 5 tools 'unavailable' (mensaje 'Autenticación requerida pero no hay token configurado.') sin tocar red; (2) connect + tools/list; tools ausentes de la lista → failureToolResult 'unavailable' y se añaden a missing_tools; (3) llamadas SECUENCIALES por tool con normalizeToolPayload sobre extractStructuredPayload (structuredContent → toolResult → content[type=text] JSON.parse → raw); (4) errores por-tool o de conexión clasificados con classifyTransportFailure; (5) status agregado: todas ok→'success'; alguna ok|remote_error→'partial'; ninguna→'failure'. Auth headers: bearer→'Authorization: Bearer <token>'; api_key→'<header_name>: <token>'; none/sin token→sin headers. Métodos individuales getActiveTask/getContextSnapshot/getValidationStatus/getApprovedDecisions/getRecentErrors existen pero cargan el bundle completo y extraen una tool.

**Evidencia:** vscode-extension/src/infrastructure/wis/toolContracts.ts:3-9,54-75; vscode-extension/src/infrastructure/wis/mcpWISGateway.ts:16-54,111-129,154-255; vscode-extension/src/infrastructure/wis/normalizers.ts:124-166

⚠️ **Caveats:** Sin reintentos ni paralelismo; hasta 5 llamadas secuenciales + tools/list, cada una con el mismo timeout (peor caso ≈ 6×timeoutMs). El pre-gate de token duplica al RuntimeAuthPolicy del comando (defensa en profundidad).

### 4.17 `classifyTransportFailure — clasificación de fallos de transporte (read plane)`  ·  _service_

**Interfaz:** `(error: unknown) → { kind: 'transport_error'|'unavailable'|'schema_error', message, evidenceHint }`

McpError con ErrorCode.RequestTimeout → transport_error ('Timeout MCP: ...', hint ajustar wisContextSync.requestTimeoutMs). StreamableHTTPError code 401|403 → transport_error ('Autenticación MCP rechazada (HTTP <code>).'). StreamableHTTPError code 404|405|>=500 → unavailable ('Endpoint MCP no disponible (HTTP <code>).'). Otro StreamableHTTPError → transport_error ('Fallo Streamable HTTP: ...'). Mensaje que matchea /ENOTFOUND|ECONNREFUSED|fetch failed|network|Failed to fetch/i → unavailable. Resto → transport_error ('Error MCP no clasificado: ...').

**Evidencia:** vscode-extension/src/infrastructure/wis/mcpWISGateway.ts:56-107

⚠️ **Caveats:** Nunca retorna 'schema_error' pese a estar en el type de retorno. 401/403 se clasifican como transport_error (no como estado auth distinto) en el read plane.

### 4.18 `normalizeToolPayload — normalización de estados por tool`  ·  _service_

**Interfaz:** `ToolResult = { tool, kind: 'ok'|'remote_error'|'transport_error'|'schema_error'|'unavailable', status: WISToolStatus|null, payload, issues: OperationalIssue[], raw }. WISToolStatus = 'ok'|'no_active_task'|'no_scope'|'scope_invalid'|'scope_not_found'|'scope_conflict'.`

Payload no-objeto → schema_error ('Payload MCP no es objeto.'). status ausente/desconocido → schema_error. Campos requeridos por status: ok → por tool (get_active_task: status,task,scope,resolution_metadata; get_context_snapshot: status,snapshot,metadata,consumer_context,scope,resolution_metadata; get_validation_status: status,current_status,scope,resolution_metadata; get_approved_decisions: status,decisions,total,scope,resolution_metadata; get_recent_errors: status,errors,total,scope,resolution_metadata); no_active_task/no_scope/scope_* → status,scope,resolution_metadata; faltantes → schema_error con lista de campos en evidence_hint. status='ok' → kind 'ok' sin issues. Otro status conocido → kind 'remote_error' con issue domain (severity 'error' solo si scope_conflict, si no 'warning'; recoverable=false solo si scope_invalid; conflict_flag = primer conflict_flags de resolution_metadata). failureToolResult crea kinds transport_error/schema_error/unavailable con issue kind 'protocol' (schema) o 'transport' (resto), severity 'error'.

**Evidencia:** vscode-extension/src/infrastructure/wis/normalizers.ts:44-122; vscode-extension/src/infrastructure/wis/toolContracts.ts:11-52

### 4.19 `composeOperationalContext — clasificación transport_status / load_state`  ·  _service_

**Interfaz:** `TransportStatus = 'ok'|'partial'|'degraded'|'transport_error'|'schema_error'|'unavailable'. LoadState = 'idle'|'preparing'|'inspecting_local'|'connecting_wis'|'loading_remote'|'composing'|'presenting'|'loaded'|'partially_loaded'|'degraded'|'failed'.`

transport_status: bundle 'success'→'ok'; si no, con prioridad: alguna tool schema_error→'schema_error'; alguna transport_error→'transport_error'; bundle 'partial'→'partial'; alguna unavailable→'unavailable'; resto→'degraded'. load_state: las 5 tools kind='ok'&&status='ok'→'loaded'; ≥1 ok|remote_error→'partially_loaded'; entorno local usable (workspace_root||repo_root||active_file)→'degraded'; si no→'failed'. Issues añadidos: bundle.issues + issue local si inspector_status!=='ok' (error→severity error, no_workspace/no_repo→warning) + issue warning con conflict_flag 'validation_stale' si validation payload.current_status==='stale' + issue warning con conflict_flag 'local_branch_vs_wis_branch_mismatch' si branch local ≠ task.branch de WIS.

**Evidencia:** vscode-extension/src/domain/loadState.ts:1-21; vscode-extension/src/application/composeOperationalContext.ts:26-62,64-146; vscode-extension/src/domain/authorityRules.ts:41-66

### 4.20 `OperationalContextEnvelope`  ·  _otro_

**Interfaz:** `Campos exactos: meta { consumer, session_key, endpoint, runtime_mode, fetched_at, transport_status, load_state }; local_environment { workspace_root, repo_root, branch, active_file, inspector_status: 'ok'|'no_workspace'|'no_repo'|'error', inspector_error, timestamp }; wis_context { active_task, context_snapshot, validation_status, approved_decisions, recent_errors } (cada uno ToolResult|null); issues: OperationalIssue[] { kind: 'transport'|'protocol'|'domain'|'local'|'presentation', source, severity: 'info'|'warning'|'error', message, recoverable, evidence_hint, conflict_flag? }; authority_map { canonical_fields (7: active_task, context_snapshot, validation_status, approved_decisions, recent_errors, scope, resolution_metadata), local_hint_fields (6: workspace_root, repo_root, branch, active_file, inspector_status, inspector_error), conflict_flags }; transport_diagnostics { endpoint, runtime_mode, timeout_ms, fetched_at, available_tools?, missing_tools? }.`

Producto del load; persistido solo en InMemoryOperationalContextStore (getLast/setLast/clear). Consumido por HandoffBuilder y por el presenter de output channel (ViewModelMapper con secciones Session/Local Environment/Active Task/Validation/Approved Decisions/Recent Errors/Load State/Diagnostics/Issues).

**Evidencia:** vscode-extension/src/domain/operationalContext.ts:23-110; vscode-extension/src/domain/errorModel.ts:1-12; vscode-extension/src/domain/authorityRules.ts:3-20; vscode-extension/src/application/operationalContextStore.ts:3-23; vscode-extension/src/presentation/viewModels.ts:68-162

### 4.21 `HandoffArtifact`  ·  _otro_

**Interfaz:** `HandoffTarget = 'codex'|'chatgpt'|'github_copilot'. HandoffDetailLevel = 'compact'|'standard'|'full'. HandoffBuildStatus = 'ready'|'partial'|'blocked'. Artifact: { task_summary {id,title,status,priority}, current_goal, approved_constraints: string[] (≤MAX_DECISIONS=10, formato '<decision_key>: <title> -> <decision>'), validation_state {status (default 'unknown'), summary, source (de last_validation_source)}, recent_errors_summary {status:'available'|'unavailable'|'no_data', total, highlights ≤MAX_ERRORS=10 formato '[<severity>] <summary>'}, local_focus {active_file, branch, requested_focus ≤5}, candidate_files ≤MAX_CANDIDATE_FILES=5 (requested_focus + active_file, dedup), open_risks ≤MAX_RISKS=8 (issues '[sev] source: message' + warning extra si partial), recommended_next_action, codex_ask_prompt, codex_code_prompt, meta {generated_at, target, source_consumer, session_key, runtime_mode, load_state, transport_status, uncertainty_note} }.`

current_goal = task.goal ?? task.next_action ?? task.title. recommended_next_action = task.next_action ?? (partial ? 'Reducir incertidumbre operativa antes de aplicar cambios amplios.' : 'Implementar el siguiente cambio de forma incremental con pruebas.'). recent_errors_summary 'unavailable' si tool no ok; 'no_data' si total/errors==0. uncertainty_note solo en partial. Prompts ask/code generados por plantilla texto con constraints/candidate_files/risks.

**Evidencia:** vscode-extension/src/domain/handoff.ts:4-70; vscode-extension/src/application/handoffBuilder.ts:13-16,53-177,250-315

⚠️ **Caveats:** detail_level nunca se aplica; targets != 'codex' inaccesibles desde comandos. Guardado solo en memoria (InMemoryHandoffArtifactStore); no hay export a fichero/clipboard.

### 4.22 `McpContextPlaneClient — write plane (7 tools)`  ·  _service_

**Interfaz:** `callTool(input {endpoint, timeoutMs, auth?, consumer, sessionKey}, tool, args) → ContextPlaneResponse {ok, tool, status, payload, message, httpStatus, requiredScopes}. Cliente MCP: Client({name:'wis-context-sync-vscode-write-plane', version:'0.2.0'}) + StreamableHTTPClientTransport. Inyección SIEMPRE: arguments = {...args, consumer, session_key}. nextIdempotencyKey(prefix) = `${prefix}-${randomUUID()}`. Tools: search_context, upsert_context_item, append_context_event, link_context_entities, set_context_labels, archive_context_item, apply_sync_batch.`

consumer siempre 'vscode_extension' (FIXED_CONSUMER); session_key la de SessionManager. Respuesta: isError=true → {ok:false, status:'error'}. Sin structuredContent objeto → {ok:false, status:'schema_error'}. Con payload: ok = !status || status ∉ {forbidden, unauthorized, invalid_request, error}; httpStatus derivado 401 si unauthorized, 403 si forbidden; required_scopes extraído del payload. Excepción de transporte: StreamableHTTPError → httpStatus=code y status 'unauthorized'(401)/'forbidden'(403)/'transport_error'; McpError RequestTimeout → 'transport_error' con 'Timeout MCP: ...'. Cierre del client en finally. Timeout por llamada = requestTimeoutMs.

**Evidencia:** vscode-extension/src/infrastructure/wis/mcpContextPlaneClient.ts:7-149; vscode-extension/src/constants.ts:2; vscode-extension/src/application/contextCommandService.ts:123-136

⚠️ **Caveats:** Cualquier status desconocido (p.ej. 'dry_run') se considera ok=true. Nueva conexión MCP por cada llamada (sin pooling/reuso). No usa los normalizers del read plane.

### 4.23 `RuntimeAuthPolicy`  ·  _guard_

**Interfaz:** `evaluate(context {mode:'none'|'bearer'|'api_key', token, required, header_name?}) → {allowed, code, message}. RuntimeAuthDecisionCode = 'ok' | 'missing_token' | 'mode_none_but_required' | 'invalid_header_name' | 'token_present_in_none_mode'.`

mode none + required=true → blocked 'mode_none_but_required'. mode none + token presente → blocked 'token_present_in_none_mode' ('Existe token configurado pero authMode=none.'). mode none limpio → ok. bearer/api_key sin token (o token blank) → blocked 'missing_token'. api_key con header_name vacío → blocked 'invalid_header_name'. Resto → ok. Se aplica como gate previo en loadOperationalContext y en los 7 comandos de context tools; también como check 'auth.policy' en Local Doctor.

**Evidencia:** vscode-extension/src/auth/runtimeAuthPolicy.ts:12-75; vscode-extension/src/activation/registrars/controlPlaneRegistrar.ts:13-24; vscode-extension/src/activation/commands/commandExecutors.ts:13-21; vscode-extension/src/platform/doctor/localDoctorService.ts:100-110

⚠️ **Caveats:** El bloqueo aplica INCLUSO con requireAuthentication=false: bearer/api_key sin token bloquea siempre (missing_token). El setting requireAuthentication solo añade el caso mode_none_but_required y el pre-gate del gateway. Nota: 'missing_token' bloquea aunque runtimeMode=offline_fixture.

### 4.24 `AuthManager + SecretStorage`  ·  _service_

**Interfaz:** `SecretStorage keys EXACTAS: 'wisContextSync.authToken' (token MCP), 'wisContextSync.localDbPassword' (password Postgres local). workspaceState keys: 'wisContextSync.sessionKey', 'wisContextSync.sessionCreatedAt'. resolveAuthContext() → {mode, header_name, required, token|null (trimmed)}. status() añade has_token.`

Token leído de SecretStorage en cada resolución (sin cache). Headers efectivos en ambos planes: bearer → 'Authorization: Bearer <token>'; api_key → header con nombre de wisContextSync.authHeaderName (default 'x-api-key'). Si mode none o sin token, no se envían headers de auth.

**Evidencia:** vscode-extension/src/auth/authManager.ts:13-71; vscode-extension/src/constants.ts:66-69; vscode-extension/src/infrastructure/wis/mcpWISGateway.ts:111-129; vscode-extension/src/infrastructure/wis/mcpContextPlaneClient.ts:25-43

### 4.25 `SessionManager`  ·  _service_

**Interfaz:** `consumer fijo: 'vscode_extension' (FIXED_CONSUMER). session_key: `wis-vscode-${Date.now()}-${randomUUID().slice(0,8)}`. SessionState = 'created'|'reused'|'reset'.`

getOrCreateSession reutiliza la key de workspaceState (state 'reused', backfill de created_at si falta); resetSession siempre crea nueva. La sesión es por-workspace (workspaceState), sin TTL ni expiración.

**Evidencia:** vscode-extension/src/sessionManager.ts:17-56; vscode-extension/src/constants.ts:2,66-67

### 4.26 `wisContextSync.localRuntimePanel — webview del panel`  ·  _otro_

**Interfaz:** `View id: wisContextSync.localRuntimePanel, nombre 'WIS Local Runtime', contribuido en explorer. WebviewViewProvider registrado en activate; activationEvent 'onView:wisContextSync.localRuntimePanel'. webview.options = { enableScripts: false }.`

HTML estático regenerado en cada update (suscripción a InMemoryLocalRuntimeStore). Secciones: 'Project' (Profile/Workspace/Repo/Branch/Active File), 'Runtime' (State/DB Status/DB Error/Last Action/Updated), 'Actions' (lista TEXTUAL de los 6 comandos locales, sin botones), 'Last Result' (JSON del LocalCommandResult), 'Post-Run Review' (Decision/Summary/Changed Focus/Next Action/risks), 'Errors'. Todo escapado con escapeHtml. Estilo con variables CSS de VS Code.

**Evidencia:** vscode-extension/package.json:36-43,15; vscode-extension/src/extension.ts:17; vscode-extension/src/presentation/local/localRuntimePanelProvider.ts:27-158; vscode-extension/src/activation/bootstrap.ts:256-259

⚠️ **Caveats:** Sin scripts ni postMessage: el panel es solo-lectura, no puede lanzar comandos ni refrescarse a demanda desde la UI. Solo muestra estado del runtime LOCAL; no muestra el OperationalContextEnvelope ni el handoff (esos van al output channel 'WIS Context Sync').

### 4.27 `DiagnosticsReporter + output channel 'WIS Context Sync'`  ·  _service_

**Interfaz:** `OutputChannel nombre exacto: 'WIS Context Sync' (EXTENSION_OUTPUT_CHANNEL). report(DiagnosticsSnapshot, detailed) — detailed=diagnosticMode imprime JSON completo; si no, línea compacta. reportLoadEvent(LoadEvent) → '[WIS] <event> state=<state> at=<ts> details=<json>'. reportOperationalEnvelope → línea '[WIS] envelope consumer=... transport_status=... load_state=... issues=N' + JSON completo si detailed.`

Eventos de load emitidos: load_started (state preparing), local_inspection_completed (inspecting_local), wis_bundle_loaded (loading_remote), load_completed (state = load_state final). En activación se reporta 'extension_activated' con snapshot de sesión y entorno.

**Evidencia:** vscode-extension/src/constants.ts:1; vscode-extension/src/diagnostics.ts:23-49; vscode-extension/src/diagnostics/evidenceFormatter.ts:4-18; vscode-extension/src/application/loadOperationalContextService.ts:98-175; vscode-extension/src/activation/bootstrap.ts:141-151

### 4.28 `EnvironmentInspector — hints locales`  ·  _service_

**Interfaz:** `inspect() → EnvironmentSnapshot { workspace_root, repo_root, branch, active_file, timestamp, inspector_status: 'ok'|'no_workspace'|'no_repo'|'error', inspector_error }`

Sin ejecutar git: busca .git ascendiendo desde active_file/workspace_root (soporta gitdir: pointer para worktrees), lee HEAD para branch (ref refs/heads/X → X; detached → primeros 12 chars del SHA). active_file solo si el documento activo es scheme 'file'.

**Evidencia:** vscode-extension/src/environment/environmentInspector.ts:17-148

### 4.29 `Manifest de la extensión`  ·  _otro_

**Interfaz:** `name: 'wis-context-sync-control-plane', displayName: 'WIS Context Sync', version: '0.2.0-internal', publisher: 'necktral', engines.vscode: '^1.90.0', main: './dist/extension.js'. Dependencies: @modelcontextprotocol/sdk ^1.29.0, pg ^8.16.3. activationEvents: onView:wisContextSync.localRuntimePanel + los 18 onCommand.`

Scripts npm: compile (tsc), watch, test (node --test sobre dist/tests), test:local-db (LOCAL_DB_TESTS=1), manual:load-context-output y manual:a1 (CLI manual con --runtime-mode offline_fixture --scenario success_full).

**Evidencia:** vscode-extension/package.json:1-34,311-328

### Configuración (ext-control-plane)

| Clave | Default | Efecto |
|---|---|---|
| `wisContextSync.mcpEndpoint` | `http://localhost:8002/mcp` | Endpoint MCP (string) usado por read plane y write plane. package.json:121-125; constants.ts:3 |
| `wisContextSync.diagnosticMode` | `true` | boolean. Si true, imprime JSON completo de snapshots/envelopes en el output channel. package.json:126-130; config.ts:113-118 |
| `wisContextSync.runtimeMode` | `offline_fixture` | enum ['mcp','offline_fixture']. Selecciona gateway del read plane; valores inválidos → default. package.json:131-139; config.ts:60-65 |
| `wisContextSync.requestTimeoutMs` | `5000` | number, minimum 100 (package.json). Timeout por llamada MCP (tools/list y cada callTool en ambos planes). Valores <100/NaN/falsy → 5000. package.json:140-145; config.ts:100-106 |
| `wisContextSync.fixtureScenario` | `success_full` | enum ['success_full','partial_missing_recent_errors','degraded_no_remote_bundle','transport_error','no_active_task','validation_stale']. Escenario determinista cuando runtimeMode=offline_fixture; inválido → default. package.json:146-158; config.ts:32-39,67-72 |
| `wisContextSync.authMode` | `none` | enum ['none','bearer','api_key']. Modo auth del transporte MCP; token vive en SecretStorage. Inválido → 'none'. package.json:159-168; config.ts:74-79 |
| `wisContextSync.authHeaderName` | `x-api-key` | Header usado en modo api_key; vacío/blank → default. package.json:169-173; config.ts:125-132 |
| `wisContextSync.requireAuthentication` | `false` | boolean. Con authMode!=none y sin token: el gateway devuelve bundle failure 'unavailable'; con authMode=none: RuntimeAuthPolicy bloquea con mode_none_but_required. package.json:174-178; mcpWISGateway.ts:162-187; runtimeAuthPolicy.ts:28-34 |
| `wisContextSync.operationProfile` | `phase3_control_plane` | enum ['phase3_control_plane','local_private']. local_private habilita persistencia Postgres y semántica de comandos locales; en phase3_control_plane la persistencia local es NoopPersistence. package.json:179-187; config.ts:81-86,163-170; bootstrap.ts:96-100 |
| `wisContextSync.codexCliCommand` | `codex` | Comando CLI del runner local Codex; blank → 'codex'. package.json:188-192; config.ts:154-161 |
| `wisContextSync.localDb.enabled` | `true` | boolean. Solo efectivo con operationProfile=local_private; en otro perfil se fuerza false. package.json:193-197; config.ts:163-170 |
| `wisContextSync.localDb.host` | `localhost` | Host PostgreSQL local_private. package.json:198-202; config.ts:172-179 |
| `wisContextSync.localDb.port` | `5432` | number, minimum 1; <=0/NaN → 5432; floor aplicado. package.json:203-208; config.ts:181-187 |
| `wisContextSync.localDb.database` | `wis_context` | Nombre de base de datos. package.json:209-213; config.ts:189-196 |
| `wisContextSync.localDb.user` | `wis_admin` | Usuario PostgreSQL. package.json:214-218; config.ts:198-205 |
| `wisContextSync.localDb.password` | `"" (vacío)` | Password plaintext opcional; si vacío se usa SecretStorage key 'wisContextSync.localDbPassword'. package.json:219-223; config.ts:281-301 |
| `wisContextSync.localDb.schema` | `local_private` | Schema namespace de la persistencia local. package.json:224-228; config.ts:212-219 |
| `wisContextSync.localDb.ssl` | `false` | SSL para la conexión Postgres. package.json:229-233; config.ts:221-223 |
| `wisContextSync.localIndex.excludeDirs` | `['.git','node_modules','dist','build','.next','coverage','.turbo','.cache','out','tmp','vendor']` | Directorios excluidos por el indexador local; array vacío/no-array → default; dedup. package.json:234-253; config.ts:225-237,246-251 |
| `wisContextSync.localIndex.includeExtensions` | `['.ts','.tsx','.js','.jsx','.mjs','.cjs','.json','.yml','.yaml','.md','.mdx','.txt','.py','.go','.rs','.java','.kt','.sql','.sh','.toml','.ini','.cfg','.env','.css','.scss','.html','.xml'] (27)` | Extensiones permitidas; normalizadas a minúsculas con punto inicial. package.json:254-289; config.ts:252-255 |
| `wisContextSync.localIndex.maxFileBytes` | `2097152` | number, minimum 1024 (package.json). Tamaño máximo de fichero indexado; <=0/NaN → default. package.json:290-295; config.ts:257-260 |
| `wisContextSync.localIndex.chunkSizeChars` | `1200` | number, minimum 100. Tamaño de chunk para file_chunks. package.json:296-301; config.ts:261-264 |
| `wisContextSync.localIndex.chunkOverlapChars` | `120` | number, minimum 0 en package.json, PERO el normalizador trata 0 como falsy y lo revierte a 120; luego clamp a min(valor, chunkSizeChars-1). package.json:302-307; config.ts:265-270 |

### Qué NO soporta hoy (ext-control-plane)

- El write plane (los 7 comandos de context tools) NO respeta runtimeMode: siempre usa transporte MCP real contra mcpEndpoint; no existe fixture/offline para escrituras (contextCommandService.ts:13 crea McpContextPlaneClient directamente).
- El read plane nunca envía scope: aunque scopeArguments soporta workspace_id/project_id/task_id, LoadOperationalContextService.load no construye WISLoadInput.scope y no hay setting/UI para fijarlo (loadOperationalContextService.ts:130-137).
- HandoffDetailLevel ('compact'|'standard'|'full') está declarado pero el builder no lo lee: no cambia el contenido del artifact. El comando siempre pasa 'standard'.
- HandoffTarget 'chatgpt' y 'github_copilot' existen en el type pero ningún comando permite seleccionarlos; target siempre 'codex' (controlPlaneRegistrar.ts:53).
- Sin persistencia del OperationalContextEnvelope ni del HandoffArtifact: stores en memoria, se pierden al recargar la ventana; prepareHandoff queda 'blocked' tras cada reload hasta re-ejecutar load.
- Sin reintentos, backoff ni pooling de conexiones MCP: cada comando/tool abre y cierra un client nuevo; llamadas del bundle son secuenciales (peor caso ≈ 6×requestTimeoutMs).
- search_context: limit=20 y offset=0 hardcodeados; sin paginación ni filtros desde la UI.
- upsert_context_item desde UI siempre manda content:{} (el parámetro content del service no es accesible por comando); append_context_event siempre severity='info' y source='vscode_extension'.
- No hay validación de idempotency_key reuse: cada commit genera un UUID nuevo, no hay reintento con la misma key ante fallo de transporte (riesgo de doble mutación al re-ejecutar el comando).
- En el write plane cualquier status remoto desconocido (fuera de forbidden/unauthorized/invalid_request/error) se trata como éxito (ok=true) — no valida schema por tool como el read plane.
- El webview 'WIS Local Runtime' es de solo lectura (enableScripts:false): sin botones, sin postMessage, no puede disparar comandos; y no muestra el envelope/handoff del control plane remoto, solo el runtime local.
- classifyTransportFailure declara 'schema_error' como kind posible pero nunca lo retorna; 401/403 en read plane se clasifican como transport_error genérico.
- resetSession no invalida el envelope/handoff previos guardados (mezcla posible de session_key vieja en artifacts).
- RuntimeAuthPolicy bloquea con missing_token en authMode bearer/api_key incluso con requireAuthentication=false y en runtimeMode=offline_fixture (el fixture ni usa el token); token residual en SecretStorage con authMode=none también bloquea (token_present_in_none_mode).
- consumer fijo 'vscode_extension'; no configurable. Sin multi-workspace: solo workspaceFolders[0].
- El comando WIS: Prepare Handoff no permite editar user_intent ni local_focus (hardcodeados); no exporta a fichero/clipboard.
- package.json localIndex.chunkOverlapChars minimum=0 no es honrado por config.ts: 0 revierte al default 120 (normalizePositiveNumber trata 0 como falsy).

## 5. Extensión VS Code — runtime local (Codex + Postgres local)

Runtime local "local_private" de la extensión wisContextSync: 4 comandos locales (local_refresh, local_index, local_prepare_task, local_run_codex) orquestados por LocalCommandService sobre un pipeline snapshot→ejecución Codex CLI→diff→reindex→clasificación→review, con persistencia en PostgreSQL (schema local_private, 13 tablas creadas vía 6 migraciones SQL + schema_migrations). Incluye indexado incremental SHA-256 con chunking 1200/120, retrieval léxico híbrido (coarse SQL ILIKE + scorer fino) con budget fijo 5/8/3/6000, locks de proyecto con TTL 180 s y heartbeat 60 s, claims de idempotencia con lease, máquina de estados de task de 10 estados, doctor de 5 checks, boundary guard de workspace y sistema de playbooks de 3 tiers. Todo el retrieval es léxico (LIKE/ILIKE): no hay embeddings pese a existir la columna embedding_status.

### 5.1 `wisContextSync.localRefresh / LocalCommandService.localRefresh()`  ·  _vscode_command_

**Interfaz:** `public async localRefresh(): Promise<LocalCommandResult>; LocalCommandResult = { command: 'local_refresh', status: 'ok'|'blocked'|'error', ok: boolean, message: string, timestamp: ISO, details: Record<string,unknown>|null }`

Gate de perfil: si getOperationProfile() !== 'local_private' devuelve status 'blocked' con message 'Comando local bloqueado. Cambia wisContextSync.operationProfile a local_private.' y details {required_profile:'local_private', current_profile}. Si pasa: inspecciona entorno, actualiza store, hace healthcheck de persistencia (SELECT 1 + migraciones); si falla devuelve error con details {db_status, db_error, migrations_applied}. En éxito devuelve details {inspector_status, workspace_root, repo_root, db_status, migrations_applied}.

**Evidencia:** vscode-extension/src/local/localCommandService.ts:95-136,1225-1240; vscode-extension/package.json:31,106

⚠️ **Caveats:** local_refresh NO aplica boundary guard (solo local_index/prepare/run lo aplican). El healthcheck aplica migraciones pendientes como efecto lateral (mensaje 42P01 dice 'Ejecuta Local Refresh para migrar').

### 5.2 `wisContextSync.localIndex / LocalCommandService.localIndex()`  ·  _vscode_command_

**Interfaz:** `public async localIndex(): Promise<LocalCommandResult>`

Gates en orden: perfil local_private → boundary guard (status 'blocked', blocked_reason 'workspace_boundary_violation') → healthcheck DB. Crea projects row (ensureProject), inserta index_runs con status 'started', ejecuta indexer.runIndex (modo full), persiste métricas (scanned/new/modified/deleted/skipped/chunk/error counts) y cierra el run con status 'completed' o 'failed'. Details de éxito: {project_id, index_run_id, root_path, scanned, new, modified, deleted, skipped, chunks_written, errors, db_status}.

**Evidencia:** vscode-extension/src/local/localCommandService.ts:138-240

⚠️ **Caveats:** En excepción del indexer las métricas se escriben todas a 0 salvo error_count=1.

### 5.3 `wisContextSync.localPrepareTask / LocalCommandService.localPrepareTask(intent)`  ·  _vscode_command_

**Interfaz:** `public async localPrepareTask(intent: string): Promise<LocalCommandResult>`

Rechaza intent vacío ('La intención no puede estar vacía.'). Gates: perfil, boundary, healthcheck. Clave de idempotencia = sha256('local_prepare_task|'+project.id+'|'+intent.trim().toLowerCase()+'|'+repo_root+'|'+branch+'|'+active_file) (join con '|'). Si resolveIdempotentResult devuelve payload, hace replay sin re-ejecutar. Flujo: retriever.retrieve → taskBuilder.buildTask → sanitiza candidate_files con boundary guard (execution_brief.candidate_files recortado a 8) → saveTask (status 'draft', lifecycle_state 'draft') → saveTaskContext (payload retrieval_trace_v1) → saveTask de nuevo con retrieval_context_ref → transitionTaskState draft→prepared (reason 'local_prepare_task_completed') → guarda task_draft en el store en memoria → saveIdempotentResult. Details: {project_id, task_id, task_context_id, candidate_files, selected_chunks, evidence_items, objective, task_state:'prepared', idempotency_key}.

**Evidencia:** vscode-extension/src/local/localCommandService.ts:242-374,1475-1478,1298-1330

⚠️ **Caveats:** Usa idempotencia simple (resolveIdempotentResult/saveIdempotentResult UPSERT) SIN claim/lease: dos prepare concurrentes idénticos pueden ejecutarse ambos. El task_draft vive en memoria (InMemoryLocalRuntimeStore); se pierde al recargar VS Code aunque esté persistido en DB.

### 5.4 `wisContextSync.localRunCodex / LocalCommandService.localRunCodex(options?)`  ·  _vscode_command_

**Interfaz:** `public async localRunCodex(options?: { abortSignal?: AbortSignal }): Promise<LocalCommandResult>`

Pipeline completo con gates secuenciales que devuelven error con details.classified_outcome:'blocked': (1) perfil; (2) boundary; (3) healthcheck DB; (4) existencia de task_draft en el store ('No hay task_draft. Ejecuta primero WIS: Local Prepare Task.'); (5) repo_root/workspace_root resolubles; (6) lock de proyecto (acquireProjectRunLock ttl 180 s; si falla → 'Proyecto bloqueado por ejecución activa', lock_status:'busy'); (7) claim de idempotencia con clave sha256('local_run_codex|'+project.id+'|'+draft.id+'|'+draft.created_at+'|'+repo_root+'|'+branch): status 'completed' → replay del response_json (o error 'invalid_idempotency_replay' si no hay payload); 'in_progress' → blocked_reason 'idempotency_in_progress'; 'claimed'/'reclaimed' → continúa; (8) arranque de heartbeat de leases; (9) validación de codexCliCommand (si inválido: failIdempotencyClaim + evento error_code 'invalid_command_configuration'); (10) estado del task: null → bootstrap null→prepared (reason 'task_state_bootstrap_for_run'); distinto de 'prepared' → error 'Task en estado inválido para ejecución: X. Requiere prepared.'. Luego prepared→running, reconciler.reconcile ejecuta healthcheck del CLI + run (transición running→reconciling justo después de la ejecución, incluso en fallo/cancelación). Si el heartbeat perdió lease: outcome forzado a 'blocked', reasons +='lease_lost:<motivo>', anomaly_flags +='lock_lease_lost', severity 'error', blocked_reason 'lock_lease_lost'. Persiste en UNA transacción: executions row + 11 artifacts + decisions row ('Operator review: <decision>') + events row (event_envelope_v2, con telemetría, idempotency_key sha256 propio). Transición reconciling→estado final (finalTaskStateFromOutcome). Claim: completeIdempotencyClaim solo si status ok y sin lease perdido (si complete devuelve false lanza 'No se pudo completar claim de idempotencia.'); si no, failIdempotencyClaim. finally: para heartbeat, quita abort listeners, releaseProjectRunLock best-effort. En excepción: safeFailIdempotencyClaim + tryTransitionTaskToFailure (running→failed o reconciling→failed).

**Evidencia:** vscode-extension/src/local/localCommandService.ts:376-1197,1502-1546,1630-1647

⚠️ **Caveats:** Los gates 4-10 que fallan DESPUÉS de adquirir el lock lo liberan en finally, pero los que fallan tras el claim (p.ej. estado inválido en gate 10, líneas 613-626) NO cierran el claim (queda in_progress hasta expirar el lease de 180 s). Re-ejecutar un run fallido con el mismo draft hace replay del resultado fallido (claim 'failed' se reporta como 'completed').

### 5.5 `Constantes de caps de artifacts y lock`  ·  _guard_

**Interfaz:** `PROMPT_ARTIFACT_MAX_CHARS=12000; TRACE=18000; RESULT=6000; SNAPSHOT=8000; CHANGE_SUMMARY=8000; OUTCOME=4000; REINDEX=6000; REVIEW=8000; OPERATOR_REVIEW=8000; PROJECT_RUN_LOCK_TTL_SECONDS=180; PROJECT_RUN_LOCK_HEARTBEAT_INTERVAL_MS=60000`

capText(text,max) trunca a max-3 chars y añade '...'. Los 11 artifact_type persistidos por run: codex_exec_prompt (v1, con prompt_hash sha256), codex_exec_trace (JSON con stdout_jsonl/stderr/usage), codex_exec_result (final_message + exit_code/duration/cancelled), workspace_before_snapshot_summary y workspace_after_snapshot_summary (entries_preview primeras 40), workspace_change_summary (unchanged preview 20), changed_files_manifest (SIN cap de chars), execution_outcome_classification, post_run_reindex_summary, post_run_review_payload, post_run_operator_decision.

**Evidencia:** vscode-extension/src/local/localCommandService.ts:56-66,732-994; vscode-extension/src/local/execution/codexExecutionUtils.ts:222-227

⚠️ **Caveats:** changed_files_manifest es el único artifact sin cap: puede ser arbitrariamente grande si hay muchos ficheros cambiados.

### 5.6 `Heartbeat de leases (startLeaseHeartbeat)`  ·  _guard_

**Interfaz:** `private startLeaseHeartbeat({projectId, lockId, claim, abortController}): Promise<{state:{lockLeaseLost,claimLeaseLost,leaseLostReason}, stop():Promise<void>}>`

Tick inicial inmediato y luego setInterval cada 60000 ms: renueva en paralelo renewProjectRunLock y renewIdempotencyClaim con ttl_seconds=180. Si alguno devuelve false marca lockLeaseLost/claimLeaseLost con leaseLostReason 'lock_lease_lost' o 'idempotency_claim_lost' y aborta el AbortController interno (mata el proceso Codex en vuelo). Excepción en el tick → ambos lost con reason 'heartbeat_error:<msg>'. Si el tick inicial ya falla no se instala el interval. stop() limpia el timer y espera el tick en vuelo.

**Evidencia:** vscode-extension/src/local/localCommandService.ts:1548-1628,697-716

⚠️ **Caveats:** El abort por lease perdido produce execution cancelled pero el outcome final se fuerza a 'blocked', no 'cancelled'.

### 5.7 `IncrementalWorkspaceIndexer.runIndex (modo full)`  ·  _service_

**Interfaz:** `runIndex({projectId, snapshot}): Promise<{message, metrics:{scanned,new,modified,deleted,skipped,chunksWritten,errors}, details:{mode:'full', root_path, ..., changes:[{kind,path}]}}>`

Root = path.resolve(repo_root ?? workspace_root); lanza error si ambos ausentes. Escanea el árbol, carga listProjectFiles(includeDeleted=true) y por candidato decide: sin fila previa → kind 'new' (new+=1); fila con is_deleted=true → kind 'reactivated' (cuenta como modified+=1); content_hash SHA-256 distinto → 'modified'; igual → 'unchanged'. En new/reactivated/modified hace upsertIndexedFile (resetea is_deleted=false, deleted_at=NULL, last_indexed_at) y reemplaza TODOS los chunks del fichero (DELETE + INSERT transaccional). Soft-delete: paths activos conocidos no vistos en el scan → markFilesDeleted (is_deleted=true, deleted_at) + deleteChunksByFileIds (los chunks SÍ se borran físicamente). Mensaje: 'Indexación incremental completada. scanned=…, new=…, modified=…, deleted=…, skipped=…'. FileChangeKind enum completo: new|modified|unchanged|deleted|skipped|reactivated.

**Evidencia:** vscode-extension/src/local/indexing/incrementalWorkspaceIndexer.ts:61-142,249-339; vscode-extension/src/local/ports.ts:94-109; vscode-extension/src/local/persistence/postgresPersistenceAdapter.ts:536-654

⚠️ **Caveats:** Errores por fichero se tragan (errorCount=1 por candidato) sin log del path. La reactivación se reporta como 'modified' en métricas aunque el kind sea 'reactivated'.

### 5.8 `IncrementalWorkspaceIndexer.runIndexByPaths (modo scoped)`  ·  _service_

**Interfaz:** `runIndexByPaths({projectId, snapshot, paths: string[]}): Promise<WorkspaceIndexResult> con details.mode='scoped' y details.target_paths`

Normaliza paths (normalizeProjectPath: barras→'/', quita './', colapsa '//', quita trailing '/'), dedupe y ordena. Scope vacío → mensaje 'Indexación incremental por paths omitida: scope vacío.' Por path: rechaza '..' o vacío → skipped; segmento presente en excludeDirs → skipped; extensión fuera de includeExtensions → skipped; fuera del root (normalizeRelativePathFromRoot lanza) → skipped; ENOENT o no-fichero → 'missing' (soft-delete si existía activo, si no kind 'unchanged'); size > maxFileBytes → skipped (+soft-delete si existía activo); binario (TextFileDetector) → skipped; si pasa todo → persistCandidate igual que full. Soft-deletes acumulados al final.

**Evidencia:** vscode-extension/src/local/indexing/incrementalWorkspaceIndexer.ts:144-247,341-416; vscode-extension/src/local/pathNormalization.ts:20-60

⚠️ **Caveats:** Un fichero que crece por encima de maxFileBytes o se vuelve binario se soft-borra del índice en el reindex scoped.

### 5.9 `WorkspaceFileScanner + TextFileDetector + FileHasher`  ·  _service_

**Interfaz:** `scan(rootPath, config): Promise<{candidates: IndexedFileCandidate[], skipped, errors}>; TextFileDetector.isLikelyText(Buffer): boolean; FileHasher.sha256FromBuffer/sha256FromText → hex`

Recorrido con pila (LIFO) de fs.readdir withFileTypes. Directorios cuyo nombre exacto esté en excludeDirs se podan a cualquier profundidad. Ficheros: extensión debe estar en includeExtensions (skipped++ si no), stat.size > maxFileBytes → skipped, contenido binario → skipped. Detección de binario: muestrea min(len,4096) bytes; byte 0x00 → binario inmediato; 'suspicious' = byte que no es TAB/LF/CR (9,10,13), ni imprimible ASCII 32-126, ni >=128; texto si suspicious/sampleSize < 0.1; buffer vacío → texto. Hash de fichero: SHA-256 hex del Buffer crudo. Candidatos ordenados por relativePath.

**Evidencia:** vscode-extension/src/local/indexing/workspaceFileScanner.ts:24-122; vscode-extension/src/local/indexing/textFileDetector.ts:2-23; vscode-extension/src/local/indexing/fileHasher.ts:4-10

⚠️ **Caveats:** No sigue .gitignore; no distingue symlinks (entry.isFile() sobre dirent, symlinks a ficheros no cuentan como isFile con withFileTypes, quedan fuera). Contenido se decodifica utf8 aunque la detección tolera bytes >=128 (posible mojibake en latin-1).

### 5.10 `BasicChunker`  ·  _service_

**Interfaz:** `new BasicChunker({chunkSizeChars, chunkOverlapChars}).chunk(content): ChunkRecord[] con {chunkIndex, content, contentHash}`

Ventana deslizante por caracteres: step = max(1, chunkSizeChars - chunkOverlapChars) (con defaults 1200/120 → step 1080). Cada chunk = content.slice(start, start+chunkSizeChars); contentHash = SHA-256 del texto del chunk (utf8). Contenido whitespace-only → 0 chunks. Overlap efectivo clampeado en config a min(configurado, chunkSize-1).

**Evidencia:** vscode-extension/src/local/indexing/basicChunker.ts:12-42; vscode-extension/src/config.ts:270

⚠️ **Caveats:** Corta a mitad de línea/palabra; sin awareness sintáctica.

### 5.11 `parseRetrievalQueryWithRoots (parser de query)`  ·  _service_

**Interfaz:** `parseRetrievalQueryWithRoots(intent, {repo_root, workspace_root}): {raw_intent, normalized_intent, tokens[], path_hints[], filename_hints[]}`

Normaliza a lowercase, '\\'→'/', recorta puntuación envolvente (regex ^[`"'([{]+|[`"')\]}:;,!?]+$). STOP_WORDS exactas (23): a, al, and, con, de, del, el, en, for, in, la, las, los, of, or, para, por, the, to, un, una, y. Token útil = longitud >= 2 y no stop-word. Partes con '/' o '.' generan path_hint (convertido a relativo del proyecto vía toProjectRelativePath; absolutos fuera de roots se descartan) y filename_hint (basename). Además fragmenta cada parte por [^a-z0-9._/-]+ y expande tokens partiendo por [/.\\_-]+. Todo deduplicado preservando orden.

**Evidencia:** vscode-extension/src/local/retrieval/retrievalQueryParser.ts:5-136

⚠️ **Caveats:** Lista de stop-words fija bilingüe ES/EN; tokens de 1 carácter se pierden siempre.

### 5.12 `Búsqueda coarse SQL (searchIndexedFiles / searchFileChunks)`  ·  _service_

**Interfaz:** `searchIndexedFiles({projectId, tokens, pathHints, filenameHints, limit}) y searchFileChunks(idem + fileIds?)`

ILIKE con patrones escapados (escape de \ % _ , ESCAPE '\\') sobre LOWER(path), LOWER(basename) y LOWER(content). Pesos coarse FILES: path_exact*600 + filename_exact*420 + path_prefix_hits*120 + filename_token_hits*80 + path_token_hits*40; CHUNKS: path_exact*500 + filename_exact*360 + path_prefix*100 + filename_token*70 + path_token*35 + content_token*40. Filtra is_deleted=false y coarse_score>0; ORDER BY coarse_score DESC, path ASC (chunks + chunk_index ASC). El retriever llama con limit 24 (files) y 48 (chunks). coarse_reasons posibles: path_exact_match, filename_exact_match, path_prefix_match, path_token_match, filename_token_match, content_token_match. Sin tokens ni hints o limit<=0 → [].

**Evidencia:** vscode-extension/src/local/persistence/postgresPersistenceAdapter.ts:310-491,1148-1214; vscode-extension/src/local/retrieval/hybridContextRetriever.ts:99-114

⚠️ **Caveats:** Escaneo LIKE sin índices trigram; coste O(filas) por token.

### 5.13 `Scorer fino (rankRetrievalCandidates)`  ·  _service_

**Interfaz:** `rankRetrievalCandidates({files, chunks, query}): RankedFileCandidate[] {file_id, file_path, score, reasons[], chunks[]}`

Score de fichero: coarse_score base; +min(24, path_token_hits*4) si path_token_hits>1 ('path_multi_token_density'); +min(18, filename_token_hits*6) si >0 ('filename_token_density'); -6 si hay path_hints y path_token_hits==0. Score de chunk: base max(fileScore, chunk.coarse_score); +matchedTerms*12 y +min(24, totalOccurrences*3) con reason 'content_match'; +min(20, content_token_hits*4) si >1 ('coarse_content_density'); +14 si matchedTerms>1 ('multi_term_match'); +10 si totalOccurrences>=3 ('high_term_density'). Penalización de saturación por fichero: chunk en posición i pierde i*4 puntos (reason 'same_file_saturation'), floor 0. Score compuesto de fichero = max(fileScore, mejorChunk) + min(4, nChunks)*3; reason extra 'has_ranked_chunks'. Orden determinista: score DESC, path comparable ASC, chunk_index ASC, content_hash. toRankingEvidence emite hasta maxItems entradas stage 'final'.

**Evidencia:** vscode-extension/src/local/retrieval/retrievalScorer.ts:64-241

⚠️ **Caveats:** Chunks con score 0 se filtran; ficheros con fileScore 0 y sin chunks se descartan.

### 5.14 `Budget de retrieval (applyRetrievalBudget)`  ·  _guard_

**Interfaz:** `DEFAULT_RETRIEVAL_BUDGET = { max_files: 5, max_chunks: 8, max_chunks_per_file: 3, max_total_chars: 6000 } (const, no configurable)`

candidate_files = primeros 5 ficheros rankeados. Selección de chunks round-robin entre los 5 ficheros: máximo 3 por fichero, 8 en total, y suma de content.length <= 6000 (chunk que excede se salta, no se trunca). budget_stats devuelve los 4 límites + selected_files/selected_chunks/selected_chars + truncated + truncation_reasons ⊆ {max_files, max_chunks_per_file, max_total_chars, max_chunks}.

**Evidencia:** vscode-extension/src/local/retrieval/retrievalBudget.ts:4-91

⚠️ **Caveats:** El límite de chars descarta chunks enteros (no los recorta), pudiendo dejar presupuesto sin usar.

### 5.15 `HybridContextRetriever.retrieve`  ·  _service_

**Interfaz:** `retrieve({intent, projectId, snapshot}): Promise<RetrievedContext {summary, candidate_files, query_trace, coarse_trace, selected_chunks, ranking_evidence, budget_stats, fallback_trace}>`

Parsea query con roots; 3 fallbacks a active_file (relativo al proyecto) con reasons exactos: 'empty_query_tokens', 'no_coarse_candidates', 'no_ranked_candidates' (fallback: candidate_files=[active_file] o [], score 1/0, budget_stats en cero, fallback_trace.used=true). Camino normal: coarse files limit 24 + chunks limit 48 en paralelo; supplemental getFileChunksByFileIds con limitPerFile=3 (primeros chunks por chunk_index, coarse_score 0); dedupe por file_id:chunk_index; ranking fino; budget; coarse_trace ordenada y recortada a 24 entradas; ranking_evidence recortada a 12 (tras trim a 5 ficheros × 3 chunks); summary generado ('Retrieval local listo: N archivos candidatos, M chunks seleccionados. Primer fragmento: path#idx (evidencia) -> snippet160.').

**Evidencia:** vscode-extension/src/local/retrieval/hybridContextRetriever.ts:73-177; vscode-extension/src/local/retrieval/retrievalEvidenceFormatter.ts:12-86

⚠️ **Caveats:** summary se calcula después y muta el objeto context.

### 5.16 `ContextAwareTaskBuilder.buildTask (LocalTaskDraft + execution_brief)`  ·  _service_

**Interfaz:** `buildTask(intent, context, snapshot): Promise<LocalTaskDraft>. LocalTaskDraft = { id: uuid, objective: string, context_summary: string, candidate_files: string[], constraints: string[], acceptance_criteria: string[], execution_brief?: { version: 'v2', objective_compact, candidate_files, key_evidence, run_constraints, acceptance_checks }, created_at: ISO }`

objective = intent literal. context_summary = summary del retrieval + hasta 3 líneas '- path#idx: snippet(180)…'. candidate_files = context.candidate_files.slice(0,5). constraints fijas (2): 'Operar solo con contexto local_private y evidencia persistida en PostgreSQL.', 'Mantener ejecución supervisada por usuario.'. acceptance_criteria: 2 fijas ('Resultado estructurado generado por adapter Codex.', 'Registro de estado y salida disponible en panel/output.') + 3ª condicional si hay chunks ('La tarea usa evidencia recuperada del índice local en PostgreSQL.'). execution_brief v2: objective_compact = objective.trim(); candidate_files slice(0,8); key_evidence = hasta 4 'path#idx: snippet(160)' o [snippet(summary,220)] si no hay chunks; run_constraints slice(0,8); acceptance_checks slice(0,8).

**Evidencia:** vscode-extension/src/local/taskBuilder/contextAwareTaskBuilder.ts:21-67; vscode-extension/src/local/types.ts:28-56; vscode-extension/src/local/localCommandService.ts:1298-1330

⚠️ **Caveats:** No usa el snapshot (parámetro _snapshot ignorado). Los candidate_files se re-sanitizan después por boundary guard convirtiéndolos en RUTAS ABSOLUTAS dentro del root.

### 5.17 `CodexCliRunner (adapter del CLI codex)`  ·  _service_

**Interfaz:** `new CodexCliRunner(options?: {timeoutMs?: number (default 120000), killGraceMs?: number (default 1500), spawnProcess?}). healthcheck(command, {abortSignal?}); run(request, command, {abortSignal?}) → CodexExecutionResult {mode:'healthcheck'|'run', ok, cancelled, command, command_line, exit_code, stdout, stderr, final_message, thread_id, events_count, warnings_count, usage_tokens:{input_tokens,cached_input_tokens,output_tokens}|null, started_at, finished_at, duration_ms, error, request_preview}`

healthcheck: argv = [command, '--version']. run: argv EXACTO = [command, 'exec', '--json', '--ephemeral', '--sandbox', 'workspace-write', '-C', workingRoot, '-o', outputFile, prompt] donde workingRoot = repo_root ?? workspace_root ?? process.cwd() y outputFile = path.join(os.tmpdir(), `wis-codex-last-${uuid}.txt`). spawn con shell:false y stdio ['ignore','pipe','pipe']. Timeout 120000 ms → SIGTERM, y SIGKILL tras 1500 ms de gracia; abort → igual pero marca cancelled. ok = !timedOut && !cancelled && exit_code===0. Mensajes de error exactos: 'Execution cancelled by user.', `Command timed out after ${timeoutMs}ms`, `Command exited with code ${code}`. Tras el run lee el fichero temporal (final_message = contenido trim si no vacío, si no el agent_message del JSONL) y lo borra silenciosamente. request_preview incluye prompt completo, prompt_hash sha256, prompt_chars, stderr_warning_reasons, ignored_jsonl_lines. Bootstrap lo instancia SIN opciones → siempre 120 s / 1.5 s.

**Evidencia:** vscode-extension/src/local/codexCliRunner.ts:43-110,112-283; vscode-extension/src/activation/bootstrap.ts:206

⚠️ **Caveats:** El timeout de 120 s NO es configurable por settings. Si el proceso ignora SIGTERM y sobrevive a SIGKILL el promise se resuelve igualmente al 'close'. command_line se formatea con quoting solo para display.

### 5.18 `Parseo JSONL de codex (parseCodexJsonlOutput) y clasificación de stderr`  ·  _service_

**Interfaz:** `parseCodexJsonlOutput(stdout): {threadId, finalMessage, eventsCount, ignoredLines, usageTokens, parsedEvents}; classifyCodexStderr(stderr): {warningCount, reasons[], warnings[{reason,line}]}`

JSONL línea a línea: JSON inválido o no-objeto → ignoredLines++. Eventos reconocidos: type 'thread.started' → thread_id; 'item.completed' con item.type 'agent_message' → finalMessage=item.text (última gana); 'turn.completed' → usage {input_tokens, cached_input_tokens, output_tokens} (los 3 deben ser números finitos o se descarta). stderr: solo líneas con /\bwarn\b/i, /\berror\b/i o 'failed to'; reasons normalizados: 'oauth_keyring_unavailable' (failed to read oauth tokens from keyring), 'state_db_warning' (failed to open state db | state db discrepancy), 'transport_warning' (transport channel closed | worker quit with fatal), 'file_watcher_warning' (failed to unwatch), 'stderr_error' (/\berror\b/i), 'stderr_warning' (resto).

**Evidencia:** vscode-extension/src/local/execution/codexExecutionUtils.ts:113-220

⚠️ **Caveats:** warningCount cuenta LÍNEAS, reasons está deduplicado.

### 5.19 `buildCodexExecutionPrompt`  ·  _service_

**Interfaz:** `buildCodexExecutionPrompt(request: CodexExecutionRequest): string`

Prompt en español con secciones fijas: rol ('ingeniero de software senior ejecutando una tarea local supervisada'), '## Objetivo' (objective_compact del brief o objective, default 'Resolver la tarea tecnica solicitada.'), '## Contexto del task draft' (context_summary compactado a 1400 chars), '## Archivos candidatos' (brief.candidate_files ?? task.candidate_files, máx 12), '## Evidencia clave' (máx 8), '## Restricciones de ejecucion' (máx 12, default '- Mantener cambios acotados y trazables.'), '## Criterios de aceptacion' (máx 12, default '- Entregar resultado verificable.'), '## Entorno' (repo_root/workspace_root/branch/active_file o '-'), '## Formato de salida final' (3 bullets fijos).

**Evidencia:** vscode-extension/src/local/execution/codexExecutionUtils.ts:66-111

### 5.20 `validateCodexExecutableCommand`  ·  _guard_

**Interfaz:** `validateCodexExecutableCommand(command: string|null|undefined): {ok:true, executable:string} | {ok:false, error_code:'invalid_command_configuration', configured_command, reason}`

Vacío/undefined → ok con executable 'codex'. Tokeniza respetando comillas simples/dobles; comilla sin cerrar → error 'Comillas sin cierre en wisContextSync.codexCliCommand.'; más de 1 token → error 'Configura solo el ejecutable o ruta absoluta, sin argumentos embebidos.'; token vacío → 'El ejecutable de codex no puede quedar vacío.'. Único error_code posible: 'invalid_command_configuration'.

**Evidencia:** vscode-extension/src/local/codexCommandValidation.ts:63-105

### 5.21 `classifyExecutionOutcome (clasificador de outcomes)`  ·  _service_

**Interfaz:** `classifyExecutionOutcome({execution, workspaceDiff, warningReasons, reindexMode:'scoped'|'fallback_full'|'skipped', reindexOk, blockedReason?}): {outcome: ExecutionOutcome, reasons[], anomaly_flags[], severity:'info'|'warning'|'error'}. ExecutionOutcome enum completo: blocked|failed|timeout|cancelled|no_op|applied_changes|partial_changes`

Orden de precedencia: (1) blockedReason no vacío → 'blocked'/error, reason 'blocked:<motivo>'; (2) execution.cancelled → 'cancelled'/error ('execution_cancelled'); (3) execution.error matchea /\btime(?:d)?\s*out\b/i o /\btimeout\b/i → 'timeout'/error ('execution_timeout'); (4) !execution.ok → 'failed'/error ('execution_failed'); (5) changed_files_count==0 → 'no_op'/info ('execution_ok_without_changes'); (6) anomalías = severe warnings (SEVERE_WARNING_REASONS = {'stderr_error','transport_warning'} → 'severe_warning:<r>') + 'reindex_failed' si !reindexOk + 'fallback_full_reindex' si mode fallback_full → 'partial_changes'/warning; (7) resto → 'applied_changes'/info ('execution_ok_with_changes').

**Evidencia:** vscode-extension/src/local/executionOutcomeClassifier.ts:3,28-125; vscode-extension/src/local/types.ts:134-141

⚠️ **Caveats:** El reconciler nunca pasa blockedReason (los bloqueos se resuelven antes en LocalCommandService), así que la rama (1) es inalcanzable desde el flujo real.

### 5.22 `PostRunReconciler.reconcile (snapshot→execute→diff→reindex)`  ·  _service_

**Interfaz:** `new PostRunReconciler({snapshotter, indexer, diffAnalyzer?, maxScopedReindexPaths? (default DEFAULT_MAX_SCOPED_REINDEX_PATHS=200)}); reconcile({projectId, snapshot, task, execute}): Promise<PostRunReconciliationResult>`

Secuencia: snapshot before → execute() (callback que corre healthcheck + codex) → snapshot after seedeado con los paths existentes del before (para detectar borrados) → diff → reindex → clasificación → review_payload. Reindex: 0 changedPaths → mode 'skipped'/status 'skipped'/ok true, trigger_reason 'no_changes'; changedPaths.length > 200 → fallback full directo con trigger_reason 'changed_paths_limit_exceeded'; si runIndexByPaths lanza → fallback full con reason el mensaje de error; fallback full que falla → mode 'fallback_full', status 'error', ok false, message 'Reindex post-run falló en fallback full.'. PostRunReindexResult: {mode: scoped|fallback_full|skipped, status: ok|error|skipped, ok, message, trigger_reason, changed_paths, metrics, error}. review_payload incluye next_action por outcome (7 textos fijos) y pending_risks ('Warning severo detectado: X', 'Reindex post-run no exitoso.', 'Reindex cayó a full scan; revisar costo y precisión del scope.'). Telemetry: prepare_latency_ms (=snapshot before), run_latency_ms, reconcile_latency_ms (after+diff+classify+reindex), reindex_latency_ms, total_duration_ms, changed_files_count, warnings_count, anomaly_count. execution_envelope.execution_id = 'pending' (se persiste después).

**Evidencia:** vscode-extension/src/local/postRunReconciler.ts:13,80-296; vscode-extension/src/activation/bootstrap.ts:192-197; vscode-extension/src/local/localCommandService.ts:721

⚠️ **Caveats:** Bootstrap no pasa maxScopedReindexPaths → siempre 200. prepare_latency_ms del telemetry del reconciler es la latencia del snapshot before, pero LocalCommandService lo sobreescribe con Date.now()-draft.created_at.

### 5.23 `WorkspaceSnapshotter + WorkspaceDiffAnalyzer`  ·  _service_

**Interfaz:** `capture({snapshot, seed_paths?}): Promise<WorkspaceSnapshot {snapshot_id: uuid, captured_at, root_path, entries:[{relative_path, exists, size_bytes, content_hash, modified_at}]}>; analyze(before, after): WorkspaceDiffSummary {created_files, modified_files, deleted_files, unchanged_files, changed_files_count, changed_files_preview, unchanged_count}`

El snapshotter reutiliza WorkspaceFileScanner con la MISMA config del indexer (excludeDirs/includeExtensions/maxFileBytes/detección de texto). seed_paths no encontrados se añaden como entries exists:false (así el diff los detecta como deleted). Diff: claves comparables lowercase; created = !beforeExists && afterExists; deleted = beforeExists && !afterExists; modified = ambos existen y (hashes ambos presentes y distintos, o mismatch null/hash, o size_bytes distinto, o modified_at distinto); resto unchanged. changed_files_preview = primeros 20 (CHANGED_PREVIEW_LIMIT=20) del conjunto ordenado created+modified+deleted.

**Evidencia:** vscode-extension/src/local/workspaceSnapshotter.ts:37-94; vscode-extension/src/local/workspaceDiffAnalyzer.ts:4-89

⚠️ **Caveats:** El diff SOLO ve ficheros indexables: cambios en binarios, ficheros > maxFileBytes o extensiones excluidas son invisibles (un run que solo toca esos ficheros clasifica como no_op).

### 5.24 `PostRunReviewer (decisiones de operador)`  ·  _service_

**Interfaz:** `review(input: PostRunReviewInput): Promise<OperatorReviewResult {review_decision, review_summary, review_risks[], changed_files_focus[], next_action_plan, source_execution_id, source_task_id, reason_codes[]}>. ReviewDecision enum completo: accept|accept_with_warnings|needs_manual_review|retry_recommended|blocked|reject`

Mapeo por classified_outcome: blocked→'blocked'; failed→'reject'; timeout|cancelled|no_op→'retry_recommended'; partial_changes→'needs_manual_review'; applied_changes→ si hay deleted_files 'needs_manual_review' (+reason 'deleted_files_present'), si warnings_count>0 'accept_with_warnings' (+'warnings_present'), si no 'accept'; default→'needs_manual_review' (+'decision_defaulted'). Regla de escalado: si la decisión es accept o accept_with_warnings y (reindex mode=='fallback_full' o !reindex.ok) → se escala a 'needs_manual_review' con reason 'decision_escalated_reindex_risk'. reason_codes siempre incluye 'outcome:<outcome>' y añade 'reindex_fallback_full', 'reindex_not_ok', 'warnings_present' cuando aplican; ordenados y deduplicados. changed_files_focus = deleted+modified+created ordenados, máx 12. next_action_plan = 'Archivos foco: <primeros 4>.' + texto fijo por decisión. review_summary = 'Decision: X. Outcome: Y. Changed files: N. Warnings: M.'.

**Evidencia:** vscode-extension/src/local/postRunReviewer.ts:49-134; vscode-extension/src/local/types.ts:196-213

### 5.25 `Máquina de estados de tareas (TaskLifecycleState + transitionTaskState)`  ·  _service_

**Interfaz:** `TaskLifecycleState enum completo (10): draft|prepared|running|reconciling|completed|partial|failed|timeout|cancelled|blocked. transitionTaskState({project_id, task_id, from_state: state|null, to_state, reason, execution_id?}): Promise<void>`

UPDATE guardado: 'WHERE id AND project_id AND ($5 IS NULL OR lifecycle_state = $5)'; si 0 filas lanza 'Transición inválida o task no encontrada: task_id=…, from=…, to=…'. Cada transición inserta fila en task_state_transitions. Transiciones usadas por el código: null→prepared ('task_state_bootstrap_for_run'), draft→prepared ('local_prepare_task_completed'), prepared→running ('local_run_codex_started'), running→reconciling ('local_run_codex_reconciling'), reconciling→{final} ('local_run_codex_closed', con execution_id), y limpieza por excepción running→failed / reconciling→failed ('local_run_codex_exception:<msg>'). Mapeo outcome→estado final: applied_changes|no_op→completed; partial_changes→partial; cancelled→cancelled; timeout→timeout; failed→failed; blocked (y default)→blocked.

**Evidencia:** vscode-extension/src/local/types.ts:7-17; vscode-extension/src/local/persistence/postgresPersistenceAdapter.ts:777-830; vscode-extension/src/local/localCommandService.ts:334-340,603-635,1069-1076,1502-1546

⚠️ **Caveats:** NO hay transición de reintento desde estados terminales: un task en failed/blocked/etc. no puede volver a prepared; hay que preparar un draft nuevo. from_state=null NO exige estado nulo: matchea cualquier estado actual (el 'bootstrap' pisaría un estado existente, aunque en la práctica solo se llama cuando getTaskLifecycleState devolvió null).

### 5.26 `Locks de proyecto (project_run_locks)`  ·  _service_

**Interfaz:** `acquireProjectRunLock({project_id, owner, lock_id, ttl_seconds}): Promise<boolean>; renewProjectRunLock({project_id, lock_id, ttl_seconds}): Promise<boolean>; releaseProjectRunLock({project_id, lock_id}): Promise<void>`

Un lock por proyecto (PK project_id). Acquire: INSERT ... ON CONFLICT (project_id) DO UPDATE ... WHERE expires_at <= now — es decir, takeover SOLO si el lock previo expiró; devuelve false si hay lock vigente. expires_at = now + make_interval(secs => ttl). Renew: UPDATE si lock_id coincide Y expires_at > now (un lock ya expirado NO es renovable → lease perdido). Release: DELETE por (project_id, lock_id). Valores usados por local_run_codex: owner 'local_run_codex', lock_id uuid aleatorio, TTL 180 s, renovación cada 60 s vía heartbeat.

**Evidencia:** vscode-extension/src/local/persistence/postgresPersistenceAdapter.ts:832-879; vscode-extension/migrations/local_private/005_reliability_v2.sql:16-23; vscode-extension/src/local/localCommandService.ts:65-66,474-495

⚠️ **Caveats:** Sin cola de espera: el segundo run concurrente falla inmediatamente con 'blocked'/lock_status 'busy'.

### 5.27 `Claims de idempotencia (idempotency_records con lease)`  ·  _service_

**Interfaz:** `claimIdempotency({project_id, command, idempotency_key, claim_id, owner, ttl_seconds}): Promise<{status: 'claimed'|'reclaimed'|'in_progress'|'completed', claim_id, owner, lease_expires_at, response_json}>; renewIdempotencyClaim(...): boolean; completeIdempotencyClaim({... response_json}): boolean; failIdempotencyClaim({... error_message, response_json}): boolean; resolveIdempotentResult(...): Record|null; saveIdempotentResult({... status:'ok'|'error'|'blocked', response_json}): void`

claim: INSERT status='in_progress' con lease_expires_at=now+ttl, ON CONFLICT (project_id,command,idempotency_key) DO NOTHING → fila nueva = 'claimed'. Si ya existe: status en {completed, failed, ok, error, blocked} → devuelve 'completed' con response_json para replay; status 'in_progress' con lease_expires_at <= now → UPDATE takeover → 'reclaimed' (started_at reset, finished_at/last_error NULL); 'in_progress' con lease vigente → 'in_progress' (bloquea duplicado). Estados desconocidos → fallback legacy tratado como 'completed'. renew: exige claim_id, status 'in_progress' y lease vigente. complete: status→'completed', lease NULL, finished_at, response_json. fail: status→'failed', last_error, response_json. resolveIdempotentResult/saveIdempotentResult: camino simple sin lease (UPSERT) usado por local_prepare_task.

**Evidencia:** vscode-extension/src/local/persistence/postgresPersistenceAdapter.ts:881-1098; vscode-extension/src/local/ports.ts:399-429; vscode-extension/migrations/local_private/006_reliability_tail.sql:1-22

⚠️ **Caveats:** Un claim 'failed' hace que el siguiente intento con la misma clave reciba 'completed' y REPLAY del resultado fallido (no re-ejecuta). No hay GC de registros de idempotencia.

### 5.28 `PostgresPersistenceAdapter (pool, migraciones, mapeo de errores)`  ·  _service_

**Interfaz:** `new PostgresPersistenceAdapter({config: LocalDbConfig, extensionPath}). Pool pg: max 4 conexiones, idleTimeoutMillis 10000, connectionTimeoutMillis 5000, ssl {rejectUnauthorized:false} si ssl=true. healthcheck(): {ok, db_status:'connected'|'disconnected', error, migrations_applied}`

healthcheck: si config.enabled=false devuelve disconnected con error 'Persistencia local deshabilitada por configuración (wisContextSync.localDb.enabled=false).'; si no: SELECT 1 + ensureMigrations (aplica pendientes una sola vez por instancia, flag migrationsReady). Migraciones: lee <extensionPath>/migrations/local_private/*.sql ordenados lexicográficamente, cada una en su propia transacción con CREATE SCHEMA IF NOT EXISTS, tabla schema_migrations(version text PK, applied_at timestamptz) y SET LOCAL search_path TO <schema>, public. ensureProject: project_key = sha256(operation_profile+'|'+workspace_root+'|'+repo_root) con UPSERT por project_key. Mapeo de errores pg a mensajes en español: ECONNREFUSED, 28P01 (credenciales), 3D000 (BD no existe), 3F000 (schema no existe), 42P01 (tabla no existe → 'Ejecuta Local Refresh para migrar'), 23503 (FK), 23505 (unique). Nombre de schema validado con /^[a-zA-Z_][a-zA-Z0-9_]*$/. saveEvent: dedupe por (project_id, event_type, idempotency_key) devolviendo el id existente; seq_no auto-asignado como MAX(seq_no)+1 por execution_id si no se pasa. runInTransaction expone tx con saveExecution/saveExecutionArtifact/saveDecision/saveEvent (BEGIN/COMMIT/ROLLBACK). executions.status derivado: 'cancelled'|'ok'|'error'; timeout boolean derivado por regex sobre result.error.

**Evidencia:** vscode-extension/src/local/persistence/postgresPersistenceAdapter.ts:64-77,83-121,136-182,184-219,1100-1142,1216-1277,1279-1412; vscode-extension/src/activation/bootstrap.ts:89-123

⚠️ **Caveats:** branch NO forma parte de project_key (cambiar de rama no crea proyecto nuevo, solo actualiza la fila). El fallback de creación (bootstrap createLocalPersistence) degrada a NoopPersistence (dbStatus 'disconnected') si el perfil no es local_private, si localDb.enabled=false o si el constructor lanza.

### 5.29 `Esquema local_private — migración 001_init.sql (10 tablas base)`  ·  _table_

**Interfaz:** `projects(id text PK, project_key text NOT NULL UNIQUE, operation_profile text NOT NULL, workspace_root, repo_root, branch, created_at, updated_at) | files(id PK, project_id FK CASCADE, path, content_hash, language, size_bytes bigint, modified_at, created_at, updated_at, UNIQUE(project_id,path)) | file_chunks(id PK, file_id FK CASCADE, project_id FK CASCADE, chunk_index int, content text NOT NULL, content_hash, embedding_status text NOT NULL DEFAULT 'pending', created_at, updated_at, UNIQUE(file_id,chunk_index)) | tasks(id PK, project_id FK, objective NOT NULL, context_summary, status NOT NULL, payload_json jsonb NOT NULL, created_at, updated_at) | task_context(id PK, task_id FK CASCADE, project_id FK, summary, candidate_files jsonb, constraints jsonb, acceptance_criteria jsonb, created_at) | executions(id PK, task_id FK, project_id FK, status, command, command_line, exit_code int, duration_ms int, stdout, stderr, error, started_at, finished_at, created_at) | execution_artifacts(id PK, execution_id FK CASCADE, project_id FK, artifact_type NOT NULL, content NOT NULL, metadata_json jsonb, created_at) | decisions(id PK, project_id FK, title, statement, source, created_at) | events(id PK, project_id FK, task_id FK SET NULL, execution_id FK SET NULL, event_type, severity, message, payload_json jsonb, created_at) | index_runs(id PK, project_id FK, status, summary, started_at NOT NULL, finished_at, created_at, updated_at)`

Todas con índices por project_id y created_at/updated_at DESC (14 índices en total en 001).

**Evidencia:** vscode-extension/migrations/local_private/001_init.sql:1-151

### 5.30 `Esquema — migraciones 002/003/004 (indexer incremental + payload + índices retrieval)`  ·  _table_

**Interfaz:** `002: files += is_deleted boolean NOT NULL DEFAULT false, deleted_at timestamptz, last_indexed_at timestamptz NOT NULL DEFAULT now(); index_runs += scanned_count, new_count, modified_count, deleted_count, skipped_count, chunk_count, error_count (int NOT NULL DEFAULT 0); índices idx_files_project_deleted(project_id,is_deleted), idx_index_runs_project_created_desc. 003: task_context += payload_json jsonb NOT NULL DEFAULT '{}'. 004: idx_files_project_deleted_path(project_id,is_deleted,path), idx_file_chunks_project_file_chunk(project_id,file_id,chunk_index), idx_file_chunks_file_chunk(file_id,chunk_index)`

Soporta soft-delete/reactivación del indexer, métricas de index_runs y el payload retrieval_trace_v1 de task_context (query_trace + coarse_trace ≤40 + final_trace con selected_chunks con snippet 240 chars + ranking_evidence ≤40 + budget_stats + fallback_trace).

**Evidencia:** vscode-extension/migrations/local_private/002_indexer_incremental.sql:1-16; 003_task_context_payload.sql:1-2; 004_retrieval_hardening_indexes.sql:1-3; vscode-extension/src/local/persistence/postgresPersistenceAdapter.ts:708-755

### 5.31 `Esquema — migraciones 005/006 (fiabilidad: locks, idempotencia, transiciones)`  ·  _table_

**Interfaz:** `005: tasks += lifecycle_state text NOT NULL DEFAULT 'draft', retrieval_context_ref text, idempotency_key text; executions += warnings_count int DEFAULT 0, timeout boolean DEFAULT false, idempotency_key text, outcome_json jsonb DEFAULT '{}'; events += seq_no bigint, idempotency_key text; NUEVAS: project_run_locks(project_id text PK FK CASCADE, lock_id NOT NULL, owner NOT NULL, acquired_at, heartbeat_at, expires_at NOT NULL) | idempotency_records(id PK, project_id FK, command, idempotency_key, status NOT NULL, response_json jsonb NOT NULL, created_at, updated_at, UNIQUE(project_id,command,idempotency_key)) | task_state_transitions(id PK, task_id FK CASCADE, project_id FK, from_state text NULL, to_state NOT NULL, reason NOT NULL, execution_id FK SET NULL, created_at). Índices únicos parciales: idx_events_execution_seq(execution_id,seq_no) WHERE execution_id IS NOT NULL; idx_events_project_type_idempotency(project_id,event_type,idempotency_key) WHERE idempotency_key IS NOT NULL. 006: idempotency_records += claim_id, owner, lease_expires_at, started_at, finished_at, last_error; backfill UPDATE status='completed' WHERE status IN ('ok','error','blocked'); índices idx_idempotency_lease_expires_at, idx_idempotency_status`

Base de los claims con lease y de la auditoría de la máquina de estados.

**Evidencia:** vscode-extension/migrations/local_private/005_reliability_v2.sql:1-66; 006_reliability_tail.sql:1-22

### 5.32 `LocalDoctorService (wisContextSync.localDoctor)`  ·  _service_

**Interfaz:** `run(): Promise<{overall:'pass'|'warn'|'fail', checks:[{id, level, message, details?}], generated_at}>. IDs de checks exactos (5): environment.inspect, workspace.boundary, auth.policy, local.db, runtime.mode`

environment.inspect: inspector_status 'error'→fail; 'no_workspace'|'no_repo'→warn; resto→pass. workspace.boundary: boundaryGuard.assertSnapshot pasa→pass, lanza→fail con el mensaje del error. auth.policy: authPolicy.evaluate(auth).allowed→pass/fail con details {code, mode, required}. local.db: SOLO se emite si operationProfile=='local_private'; dbStatus 'connected'→pass, cualquier otro→warn (nunca fail). runtime.mode: 'mcp'|'offline_fixture'→pass, otro→warn. overall = fail si algún check fail, si no warn si alguno warn, si no pass.

**Evidencia:** vscode-extension/src/platform/doctor/localDoctorService.ts:48-145; vscode-extension/src/activation/bootstrap.ts:213-229; vscode-extension/package.json:32,110

⚠️ **Caveats:** DB caída es solo 'warn' en el doctor aunque bloquee todos los comandos locales.

### 5.33 `WorkspaceBoundaryGuard`  ·  _guard_

**Interfaz:** `normalize(input): path.resolve; assertWithinRoot(targetPath, rootPath, reason): void|throw WorkspaceBoundaryError('Target path escapes root boundary.', {reason, rootPath, targetPath, relative}); assertNoSymlinkEscape(target, root, reason) (usa fs.realpathSync.native); assertSnapshot({workspaceRoot, repoRoot, activeFile}); safeCandidateFiles(candidateFiles, rootPath): string[]`

assertWithinRoot: escapa si path.relative(root,target) empieza por '..' o es absoluto (relative=='' es válido). assertSnapshot: workspaceRoot obligatorio ('workspaceRoot is required.'); repoRoot debe estar dentro de workspaceRoot; activeFile dentro de repoRoot si existe repoRoot, si no dentro de workspaceRoot. safeCandidateFiles: trim, resuelve relativos contra el root, valida con assertWithinRoot y devuelve el conjunto de RUTAS ABSOLUTAS aceptadas (descarta silenciosamente las que escapan). Usado por los 3 comandos locales mutantes (enforceWorkspaceBoundary devuelve status 'blocked' con blocked_reason 'workspace_boundary_violation') y para sanear candidate_files del draft antes de preparar y de ejecutar.

**Evidencia:** vscode-extension/src/platform/security/workspaceBoundaryGuard.ts:20-106; vscode-extension/src/local/localCommandService.ts:1267-1330

⚠️ **Caveats:** assertNoSymlinkEscape está implementado pero NUNCA se invoca en código de producción: los symlinks que apuntan fuera del workspace no se detectan en el flujo real.

### 5.34 `Sistema de playbooks (PlaybookRegistry + frontmatter)`  ·  _service_

**Interfaz:** `Frontmatter obligatorio: id, title, kind ∈ {followup, validation, recovery, operator_action}, priority (Number, default '100' si ausente), applies_to CSV ⊆ {local_prepare_task, local_run_codex, post_review, local_refresh}; opcional tags CSV. Formato: bloque '---\n<key: value>\n---\n<body>' (regex /^---\n([\s\S]*?)\n---\n([\s\S]*)$/). Tiers: system=<extensionPath>/playbooks, workspace=<workspace_root>/.wis/playbooks, project=<repo_root>/.wis/playbooks. TIER_WEIGHT {system:1, workspace:2, project:3}`

loadAll(): lee *.md de los 3 tiers, dedupe por frontmatter.id: gana menor priority; a igualdad de priority gana el tier de mayor peso (project > workspace > system). Orden final: priority ASC, luego tier más específico primero, luego id. resolveForAction(action) filtra por applies_to. Errores de parseo lanzan: 'Playbook sin frontmatter válido: <path>', 'Frontmatter incompleto en playbook: <path>', 'kind inválido…', 'applies_to inválido…'. Consumo real: local_run_codex añade details.operator_playbooks = resolveForAction('post_review').map({id,title,kind,source_tier}) solo si hay resultados.

**Evidencia:** vscode-extension/src/platform/playbooks/playbookFrontmatter.ts:1-96; vscode-extension/src/platform/playbooks/playbookRegistry.ts:15-73; vscode-extension/src/activation/bootstrap.ts:175-183; vscode-extension/src/local/localCommandService.ts:1066-1068,1139,1332-1339

⚠️ **Caveats:** No existe carpeta playbooks/ en la raíz de la extensión del repo: el tier system está vacío en la práctica (readTier devuelve [] si el root no existe). Solo se consulta la acción 'post_review'; las otras 3 acciones válidas no tienen ningún consumidor. Un .md malformado en cualquier tier hace lanzar a loadAll (sin try/catch por fichero).

### 5.35 `InMemoryLocalRuntimeStore (estado del panel)`  ·  _service_

**Interfaz:** `getSnapshot()/setSnapshot()/update(updater)/subscribe(listener) sobre ProjectRuntimeSnapshot {operation_profile, workspace_root, repo_root, branch, active_file, db_status:'unknown'|'connected'|'disconnected', db_error, runtime_state:'idle'|'ready'|'running'|'error', last_action, task_draft, last_result, errors: string[], updated_at}`

Deep-clone en cada get/set (task_draft y execution_brief clonados campo a campo). pushResult mantiene solo los últimos 8 mensajes de error (slice(-8)). runtime_state pasa a 'error' con inspector_status 'error', a 'idle' con 'no_workspace'.

**Evidencia:** vscode-extension/src/local/localRuntimeStore.ts:35-73; vscode-extension/src/local/types.ts:241-273; vscode-extension/src/local/localCommandService.ts:1366-1375

### 5.36 `Servicios Noop (fallback sin DB)`  ·  _service_

**Interfaz:** `NoopIndexer, NoopRetriever, NoopTaskBuilder, NoopPersistence (implements PersistencePort completo)`

NoopPersistence: healthcheck refleja dbStatus configurado (default 'disconnected', reason 'Persistence adapter no configurado.'); locks/claims siempre conceden (claimIdempotency devuelve 'claimed' con lease now+60000 ms); getTaskLifecycleState devuelve null. Se usa cuando el perfil no es local_private, localDb.enabled=false o el adapter Postgres falla al construirse — en ese caso los comandos locales fallan igualmente en el gate de healthcheck (dbStatus disconnected).

**Evidencia:** vscode-extension/src/local/noopServices.ts:54-363; vscode-extension/src/activation/bootstrap.ts:89-123

### Configuración (ext-local-runtime)

| Clave | Default | Efecto |
|---|---|---|
| `wisContextSync.operationProfile` | `phase3_control_plane` | Gate maestro: los 4 comandos locales devuelven status 'blocked' salvo que valga 'local_private'. Valores válidos: phase3_control_plane \| local_private (config.ts:81-86; constants.ts:11) |
| `wisContextSync.codexCliCommand` | `codex` | Ejecutable del CLI codex. Debe ser UN solo token (sin argumentos embebidos); si no, local_run_codex falla con error_code 'invalid_command_configuration' (config.ts:154-161; codexCommandValidation.ts:63-105) |
| `wisContextSync.localDb.enabled` | `true` | Si false (o perfil != local_private) se usa NoopPersistence y el healthcheck reporta disconnected (config.ts:163-170) |
| `wisContextSync.localDb.host` | `localhost` | Host PostgreSQL (constants.ts:13) |
| `wisContextSync.localDb.port` | `5432` | Puerto PostgreSQL; valores <=0/NaN caen al default (config.ts:181-187) |
| `wisContextSync.localDb.database` | `wis_context` | Base de datos (constants.ts:15) |
| `wisContextSync.localDb.user` | `wis_admin` | Usuario (constants.ts:16) |
| `wisContextSync.localDb.password` | `"" (vacío)` | Password en claro opcional; si vacío se lee de SecretStorage clave 'wisContextSync.localDbPassword' (config.ts:281-301; constants.ts:17,69) |
| `wisContextSync.localDb.schema` | `local_private` | Schema Postgres; validado con /^[a-zA-Z_][a-zA-Z0-9_]*$/ (postgresPersistenceAdapter.ts:68-77) |
| `wisContextSync.localDb.ssl` | `false` | Si true, ssl con rejectUnauthorized:false (postgresPersistenceAdapter.ts:148) |
| `wisContextSync.localIndex.excludeDirs` | `[.git, node_modules, dist, build, .next, coverage, .turbo, .cache, out, tmp, vendor] (11)` | Directorios podados por NOMBRE exacto a cualquier profundidad, en scan, snapshot y reindex scoped (constants.ts:20-32) |
| `wisContextSync.localIndex.includeExtensions` | `[.ts, .tsx, .js, .jsx, .mjs, .cjs, .json, .yml, .yaml, .md, .mdx, .txt, .py, .go, .rs, .java, .kt, .sql, .sh, .toml, .ini, .cfg, .env, .css, .scss, .html, .xml] (26, normalizadas a lowercase con punto)` | Whitelist de extensiones indexables; el resto se cuenta como skipped (constants.ts:33-61; config.ts:252-255) |
| `wisContextSync.localIndex.maxFileBytes` | `2097152 (2 MiB)` | Ficheros mayores se saltan (skipped) en index/snapshot; en reindex scoped además se soft-borran del índice si estaban activos (constants.ts:62; incrementalWorkspaceIndexer.ts:389-391) |
| `wisContextSync.localIndex.chunkSizeChars` | `1200` | Tamaño de chunk en caracteres (constants.ts:63) |
| `wisContextSync.localIndex.chunkOverlapChars` | `120` | Overlap; clampeado a min(valor, chunkSizeChars-1); step efectivo = max(1, size-overlap) = 1080 con defaults (config.ts:270; basicChunker.ts:19) |

### Qué NO soporta hoy (ext-local-runtime)

- Sin embeddings ni búsqueda semántica: file_chunks.embedding_status se inserta siempre como 'pending' y ningún código lo procesa jamás; todo el retrieval es léxico LIKE/ILIKE (postgresPersistenceAdapter.ts:615; migración 001:38).
- Timeout del CLI codex (120000 ms) y killGraceMs (1500 ms) NO configurables por settings: bootstrap instancia CodexCliRunner sin opciones (bootstrap.ts:206).
- MAX_SCOPED_REINDEX_PATHS (200) y el budget de retrieval (5/8/3/6000) son constantes hard-coded, sin setting (postRunReconciler.ts:13; retrievalBudget.ts:4-9).
- El indexer no lee .gitignore ni patrones glob: exclusión solo por nombre exacto de directorio; no indexa symlinks a ficheros.
- El diff post-run solo ve ficheros indexables (extensión incluida, <= maxFileBytes, texto): un run que solo cambia binarios/ficheros grandes/extensiones excluidas clasifica como no_op y no dispara reindex.
- local_prepare_task usa idempotencia simple sin claim/lease: dos prepares concurrentes idénticos pueden ejecutarse ambos (localCommandService.ts:293-297,360-366).
- Re-ejecutar un run fallido con el mismo draft NO reintenta: el claim en estado 'failed' se devuelve como 'completed' y se hace replay del resultado fallido; tampoco existe transición de estados terminales de task hacia prepared (postgresPersistenceAdapter.ts:924-932).
- Si local_run_codex falla en un gate posterior al claim pero anterior a la ejecución (p.ej. task en estado inválido, línea 613-626), el claim queda 'in_progress' hasta que expire el lease de 180 s: bloqueo temporal de reintentos.
- Sin retención/GC: events, execution_artifacts, executions, idempotency_records y task_state_transitions crecen indefinidamente; el artifact changed_files_manifest no tiene cap de tamaño.
- Migraciones solo forward (sin down/rollback); se identifican por nombre de fichero completo en schema_migrations.
- Playbooks: no se empaqueta ningún playbook system-tier (no existe <extensionPath>/playbooks en el repo); solo se consume la acción 'post_review' (las acciones local_prepare_task/local_run_codex/local_refresh declaradas en el enum no tienen consumidor); un .md malformado en cualquier tier rompe loadAll entero.
- WorkspaceBoundaryGuard.assertNoSymlinkEscape existe pero nunca se llama en producción: escapes vía symlink no se detectan.
- Locks solo a nivel proyecto y sin cola: run concurrente falla inmediato con 'blocked'; no hay takeover salvo lock expirado.
- El task_draft activo vive solo en memoria (InMemoryLocalRuntimeStore): tras recargar la ventana hay que volver a preparar aunque la task esté persistida; no existe comando para reanudar/cancelar tasks persistidas.
- executionSeverityFromOutcome (localCommandService.ts:1432-1440) es código muerto: la severity real sale del clasificador.
- La rama blockedReason del clasificador de outcomes es inalcanzable desde el flujo real (el reconciler nunca la pasa).
- project_key no incluye branch: cambiar de rama reutiliza el mismo proyecto (postgresPersistenceAdapter.ts:1138-1142).

## 6. Operación: scripts, CI, docker, integraciones

Capa operativa del proyecto: un Makefile con 10 targets (docker compose, smoke MCP, stack nativo con pgserver, extensión VS Code), 22 scripts en scripts/ (cierre de contrato, gobernanza de PR, consistencia/tiering de docs, validadores remotos del MCP con evidencia por deltas de tablas de auditoría, túneles Cloudflare quick/named, seeds y dogfood del loop de ratificación, filtros de logs jq), un workflow de CI con 5 jobs, un docker-compose de 4 servicios (postgres → migrate one-shot → backend + mcp) y la integración con Claude Desktop vía mcp-remote (stdio→streamable-http). La verdad de contrato son 21 tools MCP definidas en TOOL_SCOPES del server (los docs y smoke_mcp aún reflejan 17).

### 6.1 `make help`  ·  _script_

**Interfaz:** `make help (sin args)`

Autodocumentación: grep de targets con comentario '## ' en el propio Makefile y los imprime con formato coloreado (awk, %-12s).

**Evidencia:** Makefile:10-11

### 6.2 `make up`  ·  _script_

**Interfaz:** `make up`

Ejecuta 'docker compose up --build -d' y luego 'docker compose ps'. Levanta postgres + migrate + backend + mcp.

**Evidencia:** Makefile:14-16

### 6.3 `make down`  ·  _script_

**Interfaz:** `make down`

Ejecuta 'docker compose down' (detiene y elimina contenedores; NO borra el volumen de datos).

**Evidencia:** Makefile:18-19

### 6.4 `make logs`  ·  _script_

**Interfaz:** `make logs`

Ejecuta 'docker compose logs -f mcp' (sigue solo los logs del servicio mcp).

**Evidencia:** Makefile:21-22

### 6.5 `make ps`  ·  _script_

**Interfaz:** `make ps`

Ejecuta 'docker compose ps'.

**Evidencia:** Makefile:24-25

### 6.6 `make health`  ·  _script_

**Interfaz:** `make health; variable BACKEND_URL ?= http://localhost:8001`

curl -fsS $(BACKEND_URL)/health; si falla imprime 'backend no responde' (no falla el make: el || echo traga el error).

**Evidencia:** Makefile:6,28-29

⚠️ **Caveats:** El target siempre sale con código 0 aunque el backend esté caído (|| echo).

### 6.7 `make smoke`  ·  _script_

**Interfaz:** `make smoke; honra env MCP_URL/MCP_BEARER vía passthrough de entorno`

Ejecuta 'python scripts/smoke_mcp.py'.

**Evidencia:** Makefile:31-32

⚠️ **Caveats:** La variable de Makefile 'MCP_URL ?= http://localhost:8002/mcp' (Makefile:5) está muerta: no se exporta ni se referencia en ninguna receta; el default real vive en smoke_mcp.py:25.

### 6.8 `make native`  ·  _script_

**Interfaz:** `make native`

Ejecuta 'python scripts/dev_native.py' (stack completo sin docker, Ctrl-C para detener).

**Evidencia:** Makefile:35-36

### 6.9 `make vsix`  ·  _script_

**Interfaz:** `make vsix`

cd vscode-extension && npm install && npm run compile. Compila la extensión (NO empaqueta .vsix pese al nombre).

**Evidencia:** Makefile:39-40

⚠️ **Caveats:** No invoca vsce/npm package; solo compila.

### 6.10 `make test-ext`  ·  _script_

**Interfaz:** `make test-ext`

cd vscode-extension && npm test.

**Evidencia:** Makefile:42-43

### 6.11 `scripts/run_contract_closure.sh`  ·  _script_

**Interfaz:** `./scripts/run_contract_closure.sh [docs|extension|local-db|backend|all]; default: all`

Orquestador de cierre de contrato por scope. docs → validate_docs_consistency.sh; extension → (cd vscode-extension; npm ci; npm run compile; npm test); local-db → (cd vscode-extension; npm ci; npm run test:local-db); backend → pip install -r backend/requirements.txt, (cd backend; alembic upgrade head; pytest -q); all → los 4 en ese orden. Scope inválido → usage y exit 1. Evidencia: línea final '[contract-closure] OK ($SCOPE)'.

**Evidencia:** scripts/run_contract_closure.sh:7,9-38,40-63,65

### 6.12 `scripts/run_phase1_local_closure.sh`  ·  _script_

**Interfaz:** `./scripts/run_phase1_local_closure.sh (sin args)`

Cierre local-first de Fase 1: corre validate_docs_consistency.sh, luego run_contract_closure.sh docs/extension/local-db, luego backend con envs por defecto inyectados (PROJECT_NAME=shared-dev-context-layer, BACKEND_PORT=8001, MCP_PORT=8002, SYSTEM_MODE=delegated_limited, DATABASE_URL=postgresql://wis_admin:wis_strong_password_change_this@localhost:5432/wis_context), y remata con npm run compile + npm test + npm run test:local-db en vscode-extension. Evidencia: '[phase1-local] OK'.

**Evidencia:** scripts/run_phase1_local_closure.sh:9-28

⚠️ **Caveats:** Ejecuta validate_docs_consistency.sh dos veces (directo en línea 9 y de nuevo dentro de 'closure docs' línea 10) y duplica compile/test de la extensión al final.

### 6.13 `scripts/validate_pr_governance.sh`  ·  _guard_

**Interfaz:** `Sin args; requiere GITHUB_EVENT_NAME∈{pull_request,pull_request_target} y GITHUB_EVENT_PATH (JSON del evento); requiere historia completa (fetch-depth: 0)`

Valida metadata de gobernanza en el cuerpo del PR. Extrae campos 'contract_class' (enum: internal_only|persisted_contract|integration_contract|ui_facing_contract|n/a), 'local_private_level' (enum: green|yellow|red|n/a), 'composition_impact', 'decomposition_required'. Calcula diff merge-base...head. Gates: (1) cambios bajo vscode-extension/src/local/, vscode-extension/migrations/local_private/ o docs/context/local_private/ exigen local_private_level != n/a; (2) cambios en 10 ficheros de contrato listados (types.ts, ports.ts, localCommandService.ts, postRunReviewer.ts, postgresPersistenceAdapter.ts, localRuntimeOutputRenderer.ts, localRuntimePanelProvider.ts, localDoctorService.ts, migrations/local_private/, CONTRACT-GOVERNANCE.md) o contract_class != n/a ⇒ impacto contractual, que exige contract_class explícito Y actualización de docs/context/CONTRACT-INVENTORY.md; (3) si se toca vscode-extension/src/extension.ts y tiene >=700 LOC exige composition_impact; si >=760 LOC exige decomposition_required con valor 'in_pr' o 'followup_pr:#<n>' o 'followup_pr:<URL de PR de github>'. En evento no-PR sale 0 (skip). Evidencia: '[governance-check] OK'.

**Evidencia:** scripts/validate_pr_governance.sh:9-12,121-129,131-174,181-203,205

### 6.14 `scripts/validate_docs_consistency.sh`  ·  _guard_

**Interfaz:** `Sin args; requiere ripgrep (rg)`

Gate de consistencia documental sobre README.md, docs/ y vscode-extension/README.md: (1) prohíbe comandos legacy 'WIS: Refresh Context'/'WIS: Show Scope Details'; (2) prohíbe marcadores filecite residuales; (3) exige los 10 comandos oficiales 'WIS: ...' (Load Operational Context, Reset Session, Prepare Handoff, Search Context, Upsert Context Item, Append Context Event, Link Context Entities, Set Context Labels, Archive Context Item, Apply Sync Batch) en README de extensión + contrato canónico + package.json; (4) exige canon local_private con la palabra 'complementario'; (5) exige gate local-first con 'GO local|GO global' y referencia desde índices; (6) exige los 6 comandos 'WIS: Local *' (Index, Prepare Task, Run Codex, Refresh, Doctor, Configure DB Password) en canon+README+package.json; (7) exige 'wisContextSync.runtimeMode' con modos offline_fixture y mcp en package.json y contrato; (8) exige '/mcp' en docs/mcp/README.md; (9) exige guía OAuth Auth0 con 'Cliente de OAuth definido por el usuario' y 'openid'; (10) prohíbe conteos fijos '5 tools|cinco tools|5/5 tools|exactamente 5 tools' en 5 docs canónicos; (11) exige términos 'all_published', 'published_tools' y 'delta \+N|invocadas exitosamente' en esos 5 docs; (12) drift semántico: langchain/semantic-kernel en package.json o requirements.txt exige SEMANTIC_FRAMEWORK_APPROVAL.md con encabezado 'APPROVED_SEMANTIC_FRAMEWORKS:' y entradas '- langchain'/'- semantic-kernel'; (13) delega en validate_docs_tiering.sh. Evidencia: '[docs-check] OK'.

**Evidencia:** scripts/validate_docs_consistency.sh:7-10,12-22,25-44,122-131,133-154,156-184,186-189

### 6.15 `scripts/validate_docs_tiering.sh`  ·  _guard_

**Interfaz:** `Sin args; requiere rg`

Valida tiering/precedencia documental: exige existencia de 11 ficheros obligatorios (docs/README.md, docs/context/README.md, REPOSITORY-OPERATIONAL-HARDENING.md, WIS_PHASE_1_LOCAL_FIRST_ACCEPTANCE_GATE.md, CONTRACT-GOVERNANCE.md, LOCAL_PRIVATE-EVOLUTION-POLICY.md, PR-AND-BRANCH-CHECKLIST.md, BRANCH-GOVERNANCE-AND-RECONCILIATION.md, BRANCH-CLOSURE-TECHNICAL-VERDICT.md, TECHNICAL-DEBT-REGISTER.md, CONTRACT-INVENTORY.md); marcadores en docs/README.md ('## Tiering documental', '- Active canon:', '- Policy:', '- Campaign:', '- Debt register:') y regla de precedencia; marcadores en docs/context/README.md ('## Tiering documental activo', '### active_canon', '### policy', '### campaign', '### runbook', '### debt_register'); que las secciones Active canon/active_canon NO contengan documentos no-canónicos (regex 'BRANCH-|TECHNICAL-DEBT-REGISTER|phase3/evidence|phase4/evidence|RUNBOOK'); que BRANCH-GOVERNANCE se declare histórico/no-normativo y BRANCH-CLOSURE mantenga semántica de cierre por planos; y referencia cruzada del gate local-first. Evidencia: '[docs-tiering] OK'.

**Evidencia:** scripts/validate_docs_tiering.sh:9-28,30-61,63-81,83-101,103

### 6.16 `scripts/smoke_mcp.py`  ·  _script_

**Interfaz:** `python scripts/smoke_mcp.py; env: MCP_URL (default http://localhost:8002/mcp), MCP_BEARER (opcional, añade header 'Authorization: Bearer <token>')`

Smoke test no mutante del MCP por streamable-http: (1) espera cold-start con hasta 12 intentos de initialize con sleep de 0.7s; (2) list_tools y verifica que las 17 tools de EXPECTED_TOOLS estén presentes (subconjunto: 10 read + 7 write; NO incluye propose_change/list_proposals/ratify_proposal/reject_proposal); (3) call_tool get_active_task y exige dict con clave 'status'; (4) call_tool upsert_context_item con {item_key:'smoke.check', item_type:'note', title:'smoke', content:{}, dry_run:true} y acepta status ∈ {ok, no_active_task}. Imprime 'SMOKE: PASS|FAIL'; exit 0/1. Requiere paquetes mcp + anyio.

**Evidencia:** scripts/smoke_mcp.py:25-38,41-52,64-85,87-96

⚠️ **Caveats:** EXPECTED_TOOLS tiene 17 nombres pero el server publica 21 (backend/app/mcp/server.py:59-81); pasa porque solo comprueba subconjunto, no igualdad.

### 6.17 `scripts/dev_native.py`  ·  _script_

**Interfaz:** `python scripts/dev_native.py; env opcionales: PGDATA_DIR (default <repo>/.pg-dev), BACKEND_PORT (default '8001'), MCP_PORT (default '8002'). Requiere pip install -r backend/requirements.txt pgserver`

Stack completo SIN docker: (1) levanta Postgres embebido con pgserver en PGDATA_DIR; (2) instala stub de extensión pgcrypto (control version 1.3) porque pgserver no trae el contrib y gen_random_uuid() es core en PG13+; (3) CREATE DATABASE wis_context si no existe; (4) exporta env DATABASE_URL=<uri pgserver>, MCP_AUTH_ENABLED=false, MCP_AUTH_BYPASS_LOCAL=true, SYSTEM_MODE=delegated_limited, PYTHONPATH=backend; (5) corre 'alembic upgrade head' y 'python -m app.db.seed_v5' en backend/; (6) lanza uvicorn app.main:app --host 0.0.0.0 --port $BACKEND_PORT --log-level warning y 'python -m app.mcp.server'; (7) espera hasta 30s (60 iteraciones × 0.5s) a que ambos puertos abran y muestra URLs; SIGINT/SIGTERM hace shutdown ordenado (SIGINT a hijos, wait 5s, kill, server.cleanup()).

**Evidencia:** scripts/dev_native.py:31-40,43-52,61-84,111-131

⚠️ **Caveats:** Sale con sys.exit('Falta pgserver...') si pgserver no está instalado (línea 37-40). El puerto check no valida que el proceso sea el correcto, solo que el puerto esté abierto.

### 6.18 `scripts/dogfood_oracle.py`  ·  _script_

**Interfaz:** `python scripts/dogfood_oracle.py; env: MCP_URL (default http://localhost:8002/mcp), MCP_BEARER (opcional Bearer)`

Dogfood del loop de ratificación (Paso 5 del ADR): MUTA datos de verdad (sin dry_run). (1) espera cold-start (12 intentos × 0.7s); (2) call_tool propose_change con target_kind='decision', target_key='money_path.coffee_sale.v1', rationale fijo y proposed_payload con las 8 suposiciones A1–A8 y las 7 invariantes I1–I7 del coffee-sale; exige status='ok' y extrae proposal.id; (3) call_tool ratify_proposal con ese proposal_id; exige status='ok' e imprime ratified_by, ratified_decision_id y staleness invalidada. Imprime 'DOGFOOD: PASS'; exit 0/1.

**Evidencia:** scripts/dogfood_oracle.py:27-54,78-108,110-119

⚠️ **Caveats:** El docstring advierte que las suposiciones/invariantes son representativas y deben reemplazarse por las reales antes de ratificar en serio (líneas 15-17). No es idempotente por diseño explícito (crea Proposal + ApprovedDecision reales).

### 6.19 `scripts/seed_erp_v2.py`  ·  _script_

**Interfaz:** `Ejecutar dentro del contenedor backend: docker compose run --rm --no-deps -e PYTHONPATH=/app -v "$PWD/scripts:/work:ro" backend python /work/seed_erp_v2.py (importa app.* directamente, no usa MCP)`

Siembra idempotente del contexto ERP_v2 en el workspace canónico ya sembrado: crea/actualiza Project (project_key='erp_v2'), Task activa exacta 'Bug: el cargo no se carga al crear un usuario' (status in_progress, priority alta, current_phase diagnostico), Consumer vscode_extension, ExecutionSession (session_key='erp-v2-local-session'), ContextScope is_current=true scope_kind='task' resolved_by='seed_erp_v2', ApprovedDecision (decision_key='erp.user.cargo_creation_canonical', category architecture, approved_by='WIS'), ValidationRun (validation_type='repro', status='failed', source='manual') y ContextSnapshot (snapshot_type='erp_v2_seed') generado con build_operational_snapshot. Al final hace READBACK con resolve_scope() + build_operational_snapshot() e imprime lo que devolverían get_active_task/get_context_snapshot (primeros 1800 chars del JSON). Falla con RuntimeError si no hay workspace activo (exige seeds base del servicio migrate).

**Evidencia:** scripts/seed_erp_v2.py:14-17,40-45,50-54,74-77,136-137,271-292

⚠️ **Caveats:** Efecto colateral global: desactiva TODAS las tareas del sistema antes de activar la suya (db.execute(update(Task).values(is_active=False)), línea 77) y desmarca todos los ContextScope is_current (línea 137).

### 6.20 `scripts/validate_remote_mcp.sh`  ·  _script_

**Interfaz:** `./scripts/validate_remote_mcp.sh <PUBLIC_URL_OR_MCP_ENDPOINT>; envs: MCP_AUTH_TOKEN (fallback MCP_BEARER_TOKEN), MCP_AUTH_HEADER_NAME (default Authorization), MCP_AUTH_SCHEME (default Bearer), MCP_TOOL_PAYLOAD_REGISTRY_PATH (default scripts/mcp_validation_payloads.json)`

Validador all_published (invoca TODAS las tools publicadas). Normaliza URL añadiendo /mcp si falta; si el endpoint es localhost/127.0.0.1/[::1] el cliente interno usa http://mcp:8002/mcp. Precondiciones: registry JSON existente, stack docker 'Up' (docker compose ps postgres backend mcp | grep Up), sourcing de .env. Evidencia por deltas: lee COUNT(*) pre/post de 11 tablas (tasks, approved_decisions, events, context_snapshots, context_items, context_item_links, context_item_labels, context_sync_batches, policy_state, publish_audit, context_write_audit) vía psql en wis_context_postgres. Reachability: curl con Accept: text/event-stream; falla en HTTP>=500, 401/403, o si falta header mcp-session-id. Ejecuta cliente Python DENTRO del contenedor backend (docker compose exec -T): initialize + list_tools + call_tool de cada tool con payload del registry (payload_source registry|empty_default); clasifica fallos: tool_returned_error (isError), tool_status_not_ok (status ∈ {forbidden, unauthorized, invalid_request, error}), invocation_error, required_params_without_registry_payload (regex sobre el mensaje). Gates de PASS: total_tools>0, failed_count==0, deltas de las 9 tablas de dominio ==0, y delta publish_audit == success_count. Imprime JSON summary (policy=all_published) + línea '__VALIDATION_COUNTS__ success=N total=N failed=N' + resumen final.

**Evidencia:** scripts/validate_remote_mcp.sh:17-29,31-47,58-66,68-96,109-122,128-134,196-242,258-286,288-326

⚠️ **Caveats:** Los payloads del registry para tools de escritura llevan dry_run:true, por eso no mutan dominio; ratify/reject usan un proposal_id inexistente (00000000-0000-4000-8000-000000000009) y pasan mientras el status devuelto no esté en el set de error.

### 6.21 `scripts/validate_remote_mcp_read.sh`  ·  _script_

**Interfaz:** `./scripts/validate_remote_mcp_read.sh <PUBLIC_URL_OR_MCP_ENDPOINT>; mismos envs que validate_remote_mcp.sh; pensado para token de solo lectura`

Validador read_plane con token read-only. Además de todo lo del validador all_published, extrae TOOL_SCOPES de backend/app/mcp/server.py por AST (ast.literal_eval sobre la asignación; falla si no existe o no es dict[str, list[str]]) y clasifica cada tool: write si algún scope termina en '.write', read en caso contrario. Detecta contract_drift (unknown_published_tools = publicadas sin entrada en TOOL_SCOPES; missing_from_published = en TOOL_SCOPES pero no publicadas). Expectativas: cada read tool → status OK (no ∈ {forbidden,unauthorized,invalid_request,error}) → read_ok++; cada write tool → status='forbidden' con error='insufficient_scope' → write_blocked_as_expected++ (cualquier otro motivo de bloqueo cuenta como unexpected_block_reason; un éxito cuenta como unexpected_success write_tool_succeeded_with_read_token). Gates de PASS: read_total>0, write_total>0, read_ok==read_total, write_blocked==write_total, unexpected_failures==0, unexpected_successes==0, unexpected_block_reasons==0, deltas de dominio ==0, delta context_write_audit==0, delta publish_audit==read_ok. Emite JSON summary enriquecido con audit_deltas y domain_deltas + línea '__READ_VALIDATION_COUNTS__ read_ok= read_total= write_blocked= write_total= unexpected_failures= unexpected_successes= unexpected_block_reasons='.

**Evidencia:** scripts/validate_remote_mcp_read.sh:58-103,232-235,267-316,380-481,557-600,602-651,653-661

⚠️ **Caveats:** Nota: bajo esta clasificación ratify_proposal/reject_proposal (scope wis.context.ratify, no termina en .write) cuentan como 'read', por lo que con un token read-only que no tenga wis.context.ratify devolverían forbidden y romperían read_ok==read_total; el contrato asume que el token de prueba cubre los scopes de lectura+ratify o que esas tools devuelven not_found.

### 6.22 `scripts/validate_remote_mcp_write.sh`  ·  _script_

**Interfaz:** `./scripts/validate_remote_mcp_write.sh <PUBLIC_URL_OR_MCP_ENDPOINT>; REQUIERE env MCP_AUTH_TOKEN (con scopes de escritura); MCP_AUTH_HEADER_NAME default Authorization, MCP_AUTH_SCHEME default Bearer`

Validador del write plane con mutación REAL: item_key='write-validate-<epoch>'. Secuencia: (1) upsert_context_item dry_run:true (item '<key>-dryrun'); (2) upsert_context_item commit dry_run:false con content {kind:'validation'}, labels ['validation'], idempotency_key '<key>-upsert'; (3) append_context_event (event_type 'info', dry_run false, idempotency_key '<key>-event'); (4) apply_sync_batch (operations [{operation:'upsert_context_item'}], dry_run false, idempotency_key '<key>-batch'). Los 4 deben devolver status='ok'. Evidencia por deltas de 5 tablas (context_items, events, context_sync_batches, publish_audit, context_write_audit) leídas vía psql en wis_context_postgres: exige delta_items>=1, delta_events>=1, delta_batches>=1, delta_publish>=4, delta_write_audit>=4. Imprime 'Remote MCP write validation PASSED' con los deltas.

**Evidencia:** scripts/validate_remote_mcp_write.sh:7-16,33-49,51-123,125-152,154-157

⚠️ **Caveats:** A diferencia de los otros validadores, el cliente Python corre en el HOST (python3 heredoc directo, no docker compose exec), así que requiere los paquetes mcp+anyio instalados en el host. No comprueba reachability previa ni que el stack esté Up (solo necesita el contenedor wis_context_postgres para los counts).

### 6.23 `scripts/mcp_validation_payloads.json`  ·  _otro_

**Interfaz:** `Registry JSON {tool_name: payload} usado por validate_remote_mcp.sh y validate_remote_mcp_read.sh (override con MCP_TOOL_PAYLOAD_REGISTRY_PATH)`

Payloads mínimos válidos para las 21 tools publicadas. Reads: get_recent_errors {limit:20, window_hours:24}; search_context {query:'bootstrap', limit:10, offset:0}; get_context_by_id/resolve_related_items usan UUID sintético 00000000-0000-4000-8000-000000000001; list_context_windows {window_hours:24, limit:10}; get_sync_status {limit:10}; list_proposals {limit:5}. Writes: todas con dry_run:true (upsert_context_item, append_context_event, link_context_entities relation 'depends_on', set_context_labels, archive_context_item, apply_sync_batch, propose_change target_kind 'context_item'). ratify_proposal/reject_proposal con proposal_id 00000000-0000-4000-8000-000000000009 (inexistente, sin dry_run).

**Evidencia:** scripts/mcp_validation_payloads.json:1-86

### 6.24 `scripts/mcp_read_preflight.sh`  ·  _guard_

**Interfaz:** `./scripts/mcp_read_preflight.sh (sin args); requiere .env en la raíz con MCP_AUTH0_ISSUER, MCP_AUTH0_AUDIENCE y MCP_AUTH0_JWKS_URL no vacíos`

Preflight de arranque del MCP con auth activa (pasos 2-4): (1) valida que las 3 vars Auth0 estén en .env (si faltan lista 'Missing:' y exit 1); (2) docker compose up --build -d mcp; (3) imprime docker compose ps y logs mcp --tail=60 entre delimitadores '=========='; (4) falla si el servicio mcp no está en estado running, si detecta 'Restarting' (restart loop) o si los logs contienen literalmente 'MCP auth is enabled but MCP_AUTH0_ISSUER/MCP_AUTH0_AUDIENCE/MCP_AUTH0_JWKS_URL are not fully configured.'. WARN (no falla) si no encuentra la fila wis_context_mcp en ps. Evidencia: 'SUCCESS: preflight read OK' / 'FAILURE: preflight read NO OK'.

**Evidencia:** scripts/mcp_read_preflight.sh:8-15,17-39,41-55,57-84

### 6.25 `scripts/validate_oauth_token_claims.sh`  ·  _script_

**Interfaz:** `./scripts/validate_oauth_token_claims.sh --token "<JWT>" [--expected-iss <issuer>] [--expected-aud <audience>] [--require-scopes "s1,s2"] [--print-payload]; scopes separables por coma o espacio`

Valida claims del payload de un JWT SIN verificar firma: decodifica base64url del segundo segmento; exige claims iss, aud, exp presentes y que exista 'scope' o 'scp'; exp numérico y > now (epoch); iss igual a --expected-iss si se pasa; aud match string exacto o pertenencia si es lista; scopes requeridos ⊆ scopes presentes (lee 'scope' string o 'scp' string/lista). Salida en éxito: 'JWT claims validation PASSED' + iss/aud/exp/scopes ordenados; con --print-payload añade el payload JSON. Cualquier fallo → SystemExit con 'ERROR: ...'.

**Evidencia:** scripts/validate_oauth_token_claims.sh:4-22,64-68,82-121,123-146,148-154

⚠️ **Caveats:** NO valida la firma ni el header del JWT (solo decodifica el payload); es un check de claims, no de autenticidad.

### 6.26 `scripts/start_cloudflare_tunnel.sh`  ·  _script_

**Interfaz:** `./scripts/start_cloudflare_tunnel.sh; envs: TUNNEL_CONTAINER (default wis_context_cloudflared_tunnel), COMPOSE_NETWORK (default shared-dev-context-layer_wis_context_net), UPSTREAM_URL (default http://wis_context_mcp:8002), MAX_WAIT_SECONDS (default 60)`

Quick tunnel efímero (trycloudflare.com, sin cuenta): exige mcp 'Up' en compose; elimina contenedor previo; docker run -d --rm cloudflare/cloudflared:latest tunnel --no-autoupdate --url $UPSTREAM_URL en la red del compose; sondea logs hasta MAX_WAIT_SECONDS (1 intento/s) buscando regex 'https://[-a-zA-Z0-9]+\.trycloudflare\.com'; imprime Public base URL y MCP endpoint URL (<url>/mcp) o falla con exit 1 si no aparece.

**Evidencia:** scripts/start_cloudflare_tunnel.sh:7-10,12-24,26-39,41-47

### 6.27 `scripts/stop_cloudflare_tunnel.sh`  ·  _script_

**Interfaz:** `./scripts/stop_cloudflare_tunnel.sh; env TUNNEL_CONTAINER (default wis_context_cloudflared_tunnel)`

docker rm -f del contenedor del quick tunnel si está corriendo (match exacto de nombre); mensaje informativo si no lo está. Exit 0 en ambos casos.

**Evidencia:** scripts/stop_cloudflare_tunnel.sh:4-11

### 6.28 `scripts/start_named_cloudflare_tunnel.sh`  ·  _script_

**Interfaz:** `./scripts/start_named_cloudflare_tunnel.sh; REQUIERE envs CF_NAMED_TUNNEL_TOKEN y CF_MCP_PUBLIC_BASE_URL; opcionales: TUNNEL_CONTAINER (default wis_context_cloudflared_named_tunnel), COMPOSE_NETWORK (default shared-dev-context-layer_wis_context_net), UPSTREAM_URL (default http://wis_context_mcp:8002), MAX_WAIT_SECONDS (default 60)`

Túnel named (dominio estable): exige mcp 'Up'; docker run -d --rm cloudflare/cloudflared:latest tunnel --no-autoupdate --url $UPSTREAM_URL run --token $CF_NAMED_TUNNEL_TOKEN; luego sondea hasta MAX_WAIT_SECONDS que ${CF_MCP_PUBLIC_BASE_URL%/}/mcp responda con header mcp-session-id (curl Accept: text/event-stream). Si no responde a tiempo emite WARNING (no exit != 0) y sigue; imprime Public base URL, MCP endpoint URL y referencias a check/stop scripts.

**Evidencia:** scripts/start_named_cloudflare_tunnel.sh:7-25,29-34,36-51,53-59

⚠️ **Caveats:** El comando mezcla '--url' con 'run --token': en tunnels remote-managed de cloudflared el ingress lo define la config del dashboard y el flag --url puede no tener efecto. Además la no-reachability solo produce WARNING, el script sale 0 igual.

### 6.29 `scripts/stop_named_cloudflare_tunnel.sh`  ·  _script_

**Interfaz:** `./scripts/stop_named_cloudflare_tunnel.sh; env TUNNEL_CONTAINER (default wis_context_cloudflared_named_tunnel)`

docker rm -f del contenedor del named tunnel si corre; mensaje si no. Exit 0 siempre.

**Evidencia:** scripts/stop_named_cloudflare_tunnel.sh:4-11

### 6.30 `scripts/check_named_cloudflare_tunnel.sh`  ·  _guard_

**Interfaz:** `./scripts/check_named_cloudflare_tunnel.sh; REQUIERE env CF_MCP_PUBLIC_BASE_URL; TUNNEL_CONTAINER default wis_context_cloudflared_named_tunnel`

Health-check en 3 pasos del named tunnel: (1) contenedor corriendo (docker ps match exacto); (2) DNS del host resoluble (getent hosts); (3) curl a <base>/mcp con Accept: text/event-stream y verificación del header mcp-session-id. Imprime 'Container status: running', 'DNS status: ok', 'MCP header check: ok (HTTP <code>...)' y 'Endpoint check passed: <url>/mcp'; cualquier paso fallido → ERROR y exit 1.

**Evidencia:** scripts/check_named_cloudflare_tunnel.sh:4-13,15-28,30-46

### 6.31 `scripts/check_tunnel_hostname_readiness.sh`  ·  _guard_

**Interfaz:** `./scripts/check_tunnel_hostname_readiness.sh; lee envs CF_NAMED_TUNNEL_TOKEN y CF_MCP_PUBLIC_BASE_URL; exit codes: 0=READY_FOR_TUNNEL_BASIC_VALIDATION, 2=BLOCKED_MISSING_SECRETS, 3=BLOCKED_MISCONFIGURED_ENV`

Preflight de configuración del named tunnel SIN tocar red: valida presencia de ambas vars y formato de CF_MCP_PUBLIC_BASE_URL (debe empezar por https:// con host, NO terminar en /mcp, NO llevar query ni fragment). Salida clave=valor determinista: timestamp_utc, check=tunnel_hostname_readiness, var_status.* (present|missing), derived.expected_mcp_endpoint (<base>/mcp o '<unavailable>'), missing_count/missing, misconfigured_count/misconfigured, status y exit_code.

**Evidencia:** scripts/check_tunnel_hostname_readiness.sh:13-37,38-47,49-69

### 6.32 `scripts/tag_phase3_internal.sh`  ·  _script_

**Interfaz:** `./scripts/tag_phase3_internal.sh [TAG_NAME]; default TAG_NAME=v0.1.0-phase3-internal`

Crea un tag anotado de release interno con gates previos: falla si el tag ya existe localmente o si el working tree no está limpio (git status --porcelain). Ejecuta validate_docs_consistency.sh y (cd vscode-extension; npm ci; npm test). Crea 'git tag -a $TAG_NAME -m "Phase 3 internal stable release"'. NO hace push (imprime el comando sugerido 'git push origin $TAG_NAME').

**Evidencia:** scripts/tag_phase3_internal.sh:7-17,19-31

### 6.33 `scripts/mcp_log_filters.sh`  ·  _script_

**Interfaz:** `./scripts/mcp_log_filters.sh <tail|parse|stage|request|session|tool|failures|summary|help>; stage requiere 1 arg del enum transport|initialize|list_tools|call_tool|jwt|scope_guard|drift; request/session/tool requieren 1 arg (request_id/mcp_session_id/tool_name); tail/parse/failures/summary no aceptan args. Requiere jq (excepto help)`

Toolkit de observabilidad de logs JSON estructurados del MCP. tail = docker compose logs --no-log-prefix -f mcp. parse = filtra stdin dejando solo objetos JSON con event_name (tolera líneas mixtas/ruido, incluso JSON embebido con prefijo). Filtros stage: transport (mcp_request_started/completed/failed, mcp_auth_missing/invalid/scope_denied), initialize (mcp_handshake_initialize_* o rpc_method=initialize), list_tools (mcp_list_tools_* o mcp_contract_drift_detected con reason=tool_scope_drift), call_tool (mcp_call_tool_*), jwt (auth_stage=jwt_verifier), scope_guard (mcp_scope_guard_evaluated, o auth_scope_denied/auth_missing con auth_stage=tool_runtime), drift (mcp_contract_drift_detected). failures = eventos mcp_request_failed, mcp_call_tool_failed, mcp_list_tools_failed, mcp_handshake_initialize_failed, mcp_auth_invalid, mcp_auth_scope_denied, mcp_contract_drift_detected. summary = agregados jq {total_events, by_event, by_status_code, by_failure_classification, by_tool_name}. Uso encadenado: './mcp_log_filters.sh tail | ./mcp_log_filters.sh stage call_tool'.

**Evidencia:** scripts/mcp_log_filters.sh:6-29,38-48,50-111,128-140,142-166,168-249

### 6.34 `scripts/mcp_log_filters_fixture.log`  ·  _otro_

**Interfaz:** `Fixture de 13 líneas (mezcla JSON estructurado + ruido no-JSON) para probar mcp_log_filters.sh offline`

Contiene ejemplos reales de eventos: mcp_request_started, mcp_handshake_initialize_started/succeeded, mcp_contract_drift_detected (reason missing_mcp_session_id), mcp_auth_invalid (jwt_verifier, invalid_audience), mcp_scope_guard_evaluated (allowed), mcp_auth_scope_denied (tool_runtime, missing wis.context.write), mcp_call_tool_failed (scope_denied y tool_exception), mcp_list_tools_failed (invalid_result_shape); más 2 líneas de ruido no-JSON para probar el parser.

**Evidencia:** scripts/mcp_log_filters_fixture.log:1-13

### 6.35 `CI job: governance (governance-pr-metadata)`  ·  _service_

**Interfaz:** `Workflow phase3-ci; triggers: push a main + todo pull_request; job condicionado a github.event_name == 'pull_request'; runs-on ubuntu-latest; checkout con fetch-depth: 0`

Ejecuta ./scripts/validate_pr_governance.sh (metadata contract_class/local_private_level/composition_impact/decomposition_required sobre el body del PR y el diff).

**Evidencia:** .github/workflows/phase3-ci.yml:3-20

### 6.36 `CI job: docs (docs-consistency)`  ·  _service_

**Interfaz:** `runs-on ubuntu-latest; instala ripgrep vía apt`

Ejecuta ./scripts/run_contract_closure.sh docs (= validate_docs_consistency.sh, que a su vez corre validate_docs_tiering.sh).

**Evidencia:** .github/workflows/phase3-ci.yml:22-33

### 6.37 `CI job: vscode-extension (vscode-extension-compile-test)`  ·  _service_

**Interfaz:** `runs-on ubuntu-latest; setup-node@v4 node 20 con cache npm sobre vscode-extension/package-lock.json`

Ejecuta ./scripts/run_contract_closure.sh extension (npm ci + npm run compile + npm test).

**Evidencia:** .github/workflows/phase3-ci.yml:35-50

### 6.38 `CI job: local-private (local-private-postgres-test)`  ·  _service_

**Interfaz:** `runs-on ubuntu-latest; service container postgres:16 (POSTGRES_DB=wis_context, USER=wis_admin, PASSWORD=wis_strong_password_change_this, puerto 5432, health pg_isready interval 10s timeout 5s retries 10); envs LOCAL_DB_TESTS=1, LOCAL_DB_HOST=localhost, LOCAL_DB_PORT=5432, LOCAL_DB_NAME/USER/PASSWORD; node 20`

Ejecuta ./scripts/run_contract_closure.sh local-db (npm ci + npm run test:local-db en vscode-extension contra el Postgres del service container).

**Evidencia:** .github/workflows/phase3-ci.yml:52-92

### 6.39 `CI job: backend (backend-pytest)`  ·  _service_

**Interfaz:** `runs-on ubuntu-latest; service container postgres:16 idéntico; setup-python@v5 3.12; envs: PROJECT_NAME=shared-dev-context-layer, BACKEND_PORT=8001, MCP_PORT=8002, SYSTEM_MODE=delegated_limited, DATABASE_URL=postgresql://wis_admin:wis_strong_password_change_this@localhost:5432/wis_context, MCP_AUTH_ENABLED=true, MCP_AUTH_BYPASS_LOCAL=true, MCP_PUBLIC_BASE_URL=https://mcp.wiscontext-sync.org, MCP_AUTH0_ISSUER=https://necktral.us.auth0.com/, MCP_AUTH0_AUDIENCE=https://wis-context-sync-read-api, MCP_AUTH0_JWKS_URL=https://necktral.us.auth0.com/.well-known/jwks.json`

Ejecuta ./scripts/run_contract_closure.sh backend (pip install requirements, alembic upgrade head, pytest -q en backend/).

**Evidencia:** .github/workflows/phase3-ci.yml:94-133

### 6.40 `docker-compose: servicio postgres`  ·  _service_

**Interfaz:** `image postgres:16; container_name wis_context_postgres; restart unless-stopped; puerto ${POSTGRES_HOST_PORT:-5432}:5432; volumen wis_context_postgres_data:/var/lib/postgresql/data; red wis_context_net (bridge)`

Base de datos. Healthcheck: pg_isready -U $POSTGRES_USER -d $POSTGRES_DB, interval 5s, timeout 5s, retries 10. Es el primer servicio en el orden de arranque (los demás dependen de su condición service_healthy).

**Evidencia:** docker-compose.yml:2-20,73-78

### 6.41 `docker-compose: servicio migrate`  ·  _service_

**Interfaz:** `build backend/; container_name wis_context_migrate; env_file .env; restart "no"; command ["sh","-c","alembic upgrade head && python -m app.db.seed_v5"]`

Servicio one-shot de migraciones + seed: espera postgres healthy, aplica Alembic hasta head y ejecuta el seed base app.db.seed_v5, luego termina. backend y mcp esperan a que complete OK (condition: service_completed_successfully) antes de arrancar. Orden de arranque efectivo: postgres → migrate → {backend, mcp} en paralelo.

**Evidencia:** docker-compose.yml:22-36,45-49,62-66

### 6.42 `docker-compose: servicio backend`  ·  _service_

**Interfaz:** `build backend/; container_name wis_context_backend; restart unless-stopped; env_file .env; puerto ${BACKEND_PORT}:8001 (SIN default en compose: BACKEND_PORT es obligatorio en .env)`

API REST FastAPI (usa el CMD del Dockerfile: uvicorn app.main:app en :8001). Depende de postgres healthy + migrate completado.

**Evidencia:** docker-compose.yml:38-53

### 6.43 `docker-compose: servicio mcp`  ·  _service_

**Interfaz:** `build backend/ (misma imagen que backend); container_name wis_context_mcp; restart unless-stopped; env_file .env; command ["python","-m","app.mcp.server"]; puerto ${MCP_PORT}:8002 (SIN default en compose: MCP_PORT obligatorio en .env)`

Servidor MCP streamable-http: sobreescribe el CMD del Dockerfile con python -m app.mcp.server (bind 0.0.0.0, puerto settings.mcp_port default 8002). Depende de postgres healthy + migrate completado.

**Evidencia:** docker-compose.yml:55-71; backend/app/mcp/server.py:187-188; backend/app/core/config.py:11

### 6.44 `backend/Dockerfile`  ·  _service_

**Interfaz:** `FROM python:3.12-slim; WORKDIR /app; pip install --no-cache-dir -r requirements.txt; COPY app, alembic, alembic.ini, tests; EXPOSE 8001; CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8001"]`

Imagen única compartida por migrate/backend/mcp. Por defecto arranca SOLO el backend REST (uvicorn :8001). NO ejecuta migraciones, NO arranca el servidor MCP y NO expone el puerto 8002 — todo eso lo aportan los command overrides del compose. Incluye los tests dentro de la imagen (COPY tests).

**Evidencia:** backend/Dockerfile:1-15

### 6.45 `integration/install-claude-desktop-mcp.sh`  ·  _script_

**Interfaz:** `./integration/install-claude-desktop-mcp.sh; envs: SERVER_NAME (default wis-context), MCP_URL (default http://localhost:8002/mcp); requiere python3`

Registra/actualiza el server MCP en la config de Claude Desktop con puente mcp-remote (stdio→streamable-http, modo local sin auth). Ruta de config por OS: Darwin → $HOME/Library/Application Support/Claude/claude_desktop_config.json; Linux → $HOME/.config/Claude/claude_desktop_config.json; MINGW*/MSYS*/CYGWIN* → $APPDATA/Claude/claude_desktop_config.json; otro → ruta Linux. Crea el directorio y un '{}' si no existe; hace backup '<cfg>.bak.<YYYYmmddHHMMSS>' antes de tocar; merge seguro vía python3 (json.load con fallback a {}) escribiendo mcpServers[SERVER_NAME] = {"command":"npx","args":["-y","mcp-remote",MCP_URL]} con indent=2 y newline final; preserva otros servers. Exige reinicio completo de Claude Desktop.

**Evidencia:** integration/install-claude-desktop-mcp.sh:16-25,27-39,41-67,69

### 6.46 `integration/claude_desktop_config.example.json`  ·  _otro_

**Interfaz:** `Bloque exacto: {"mcpServers":{"wis-context":{"command":"npx","args":["-y","mcp-remote","http://localhost:8002/mcp"]}}}`

Config de referencia para instalación manual en claude_desktop_config.json; idéntica a lo que escribe el script de instalación con los defaults.

**Evidencia:** integration/claude_desktop_config.example.json:1-8

### 6.47 `.vscode/settings.json (workspace)`  ·  _setting_

**Interfaz:** `wisContextSync.runtimeMode='mcp', wisContextSync.mcpEndpoint='http://localhost:8002/mcp', wisContextSync.authMode='none', wisContextSync.requireAuthentication=false, wisContextSync.diagnosticMode=true (más chatgpt.openOnStartup=true y python-envs.defaultEnvManager='ms-python.python:pyenv')`

Preconfigura la extensión WIS Context Sync del workspace en modo MCP local sin auth apuntando al endpoint del compose/nativo.

**Evidencia:** .vscode/settings.json:1-9

### 6.48 `.vscode/launch.json + tasks.json`  ·  _setting_

**Interfaz:** `launch 'Run WIS Extension': type extensionHost, args --extensionDevelopmentPath=${workspaceFolder}/vscode-extension, outFiles vscode-extension/dist/**/*.js, preLaunchTask 'vscode-extension: compile'. Tasks: 'vscode-extension: compile' (npm run compile, problemMatcher $tsc) y 'vscode-extension: watch' (npm run watch, isBackground, $tsc-watch), ambas con cwd vscode-extension`

Debug F5 de la extensión en un Extension Host con compilación previa automática; task de watch para desarrollo incremental.

**Evidencia:** .vscode/launch.json:3-17; .vscode/tasks.json:3-37

### 6.49 `Contrato de tools MCP (referencia para validadores)`  ·  _otro_

**Interfaz:** `TOOL_SCOPES en backend/app/mcp/server.py: 21 tools. Scopes: wis.context.read (get_active_task, get_context_snapshot, get_recent_errors, get_validation_status, get_approved_decisions, search_context, get_context_by_id, list_context_windows, resolve_related_items, list_proposals), wis.context.sync.read (get_sync_status), wis.context.write (preview_write_impact, upsert_context_item, append_context_event, link_context_entities, set_context_labels, archive_context_item, propose_change), wis.context.sync.write (apply_sync_batch), wis.context.ratify (ratify_proposal, reject_proposal)`

Fuente de verdad del plano read/write que validate_remote_mcp_read.sh parsea por AST para detectar drift. RESOURCE_SCOPES_SUPPORTED = [wis.context.read, wis.context.sync.read, wis.context.write, wis.context.sync.write, wis.context.ratify].

**Evidencia:** backend/app/mcp/server.py:59-89

⚠️ **Caveats:** smoke_mcp.py (17 tools esperadas), integration/README.md ('lista 17 tools') y integration/VERIFICATION.md ('17 tools publicadas') están desfasados respecto a las 21 reales; smoke pasa igualmente porque valida subconjunto.

### Configuración (ops-scripts-ci)

| Clave | Default | Efecto |
|---|---|---|
| `POSTGRES_DB` | `wis_context` | Nombre de la BD en el servicio postgres del compose y en su healthcheck. |
| `POSTGRES_USER` | `wis_admin` | Usuario de Postgres (compose + psql de los validadores remotos). |
| `POSTGRES_PASSWORD` | `wis_local_dev_change_me` | Password local de Postgres (.env.example:11). |
| `POSTGRES_HOST_PORT` | `5432` | Puerto host mapeado a 5432 del contenedor; único puerto con default en compose (docker-compose.yml:13). |
| `BACKEND_PORT` | `8001` | Puerto host del backend REST. Obligatorio para compose (sin default en docker-compose.yml:51); default 8001 solo en .env.example y dev_native.py. |
| `MCP_PORT` | `8002` | Puerto host del servidor MCP. Obligatorio para compose (docker-compose.yml:69); default 8002 en .env.example, dev_native.py y config.py. |
| `PROJECT_NAME` | `shared-dev-context-layer` | Nombre de la app (.env.example:19). |
| `SYSTEM_MODE` | `delegated_limited` | Modo de política del sistema (.env.example:20; también inyectado por dev_native.py:74 y CI). |
| `DATABASE_URL` | `postgresql://wis_admin:wis_local_dev_change_me@postgres:5432/wis_context` | Cadena de conexión usada por migrate/backend/mcp (.env.example:21; dev_native la sobreescribe con la URI de pgserver). |
| `MCP_AUTH_ENABLED` | `false` | Activa la verificación Auth0/JWT del MCP (.env.example:26; CI backend usa true). |
| `MCP_AUTH_BYPASS_LOCAL` | `true` | Con true no se exige token: todas las tools accesibles en localhost; el scope guard emite outcome=allowed con bypass_local=true (.env.example:27; backend/app/mcp/server.py:342-354). |
| `MCP_ALLOWED_ORIGINS` | `(vacío)` | Orígenes CORS permitidos del MCP (.env.example:28). |
| `MCP_LOG_LEVEL` | `INFO` | Nivel de log del MCP (.env.example:31). |
| `MCP_LOG_JSON` | `true` | Logs estructurados JSON (lo que consume mcp_log_filters.sh) (.env.example:32). |
| `MCP_LOG_PAYLOADS` | `false` | Si se loguean payloads de tools (.env.example:33). |
| `MCP_AUTH0_ISSUER / MCP_AUTH0_AUDIENCE / MCP_AUTH0_JWKS_URL / MCP_PUBLIC_BASE_URL` | `(comentadas; solo para exposición a internet)` | Config Auth0 opcional; mcp_read_preflight.sh exige las 3 primeras no vacías para arrancar mcp con auth (.env.example:36-42; scripts/mcp_read_preflight.sh:10-15). |
| `MCP_URL` | `http://localhost:8002/mcp` | Endpoint objetivo de smoke_mcp.py y dogfood_oracle.py (scripts/smoke_mcp.py:25; scripts/dogfood_oracle.py:27). |
| `MCP_BEARER` | `(vacío)` | Token opcional para smoke/dogfood: header 'Authorization: Bearer <token>' (scripts/smoke_mcp.py:26,56). |
| `MCP_AUTH_TOKEN / MCP_BEARER_TOKEN / MCP_AUTH_HEADER_NAME / MCP_AUTH_SCHEME` | `'' / '' / Authorization / Bearer` | Auth de los validadores remotos; si el header no es Authorization se envía el token pelado sin scheme (scripts/validate_remote_mcp.sh:31-41). |
| `MCP_TOOL_PAYLOAD_REGISTRY_PATH` | `scripts/mcp_validation_payloads.json` | Ruta del registry de payloads para validadores all_published/read_plane (scripts/validate_remote_mcp.sh:43). |
| `TUNNEL_CONTAINER` | `wis_context_cloudflared_tunnel (quick) / wis_context_cloudflared_named_tunnel (named)` | Nombre del contenedor cloudflared (scripts/start_cloudflare_tunnel.sh:7; scripts/start_named_cloudflare_tunnel.sh:7). |
| `COMPOSE_NETWORK` | `shared-dev-context-layer_wis_context_net` | Red docker a la que se une el túnel (scripts/start_cloudflare_tunnel.sh:8). |
| `UPSTREAM_URL` | `http://wis_context_mcp:8002` | Upstream del túnel hacia el contenedor mcp (scripts/start_cloudflare_tunnel.sh:9). |
| `MAX_WAIT_SECONDS` | `60` | Espera máxima para URL pública (quick) o reachability del endpoint (named) (scripts/start_cloudflare_tunnel.sh:10). |
| `CF_NAMED_TUNNEL_TOKEN / CF_MCP_PUBLIC_BASE_URL` | `(sin default; obligatorias para named tunnel)` | Token del túnel named y base URL pública https sin sufijo /mcp (scripts/start_named_cloudflare_tunnel.sh:12-19; scripts/check_tunnel_hostname_readiness.sh:26-35). |
| `PGDATA_DIR` | `<repo>/.pg-dev` | Directorio de datos del Postgres embebido de dev_native.py (scripts/dev_native.py:33). |
| `SERVER_NAME (integration)` | `wis-context` | Nombre del server MCP registrado en Claude Desktop (integration/install-claude-desktop-mcp.sh:16). |

### Qué NO soporta hoy (ops-scripts-ci)

- El CI (phase3-ci.yml) NO levanta el stack docker-compose ni ejecuta smoke_mcp.py, dev_native.py, dogfood_oracle.py ni los validadores remotos (validate_remote_mcp*.sh); esos solo corren manualmente en local.
- docker-compose NO incluye servicio de túnel Cloudflare: los túneles se lanzan con 'docker run' aparte y se acoplan a la red del compose por nombre hardcodeado 'shared-dev-context-layer_wis_context_net' (se rompe si el directorio del proyecto se renombra, salvo override de COMPOSE_NETWORK).
- El Dockerfile por sí solo NO ejecuta migraciones ni arranca el servidor MCP; sin los command overrides del compose solo obtienes el backend REST en :8001 contra una BD sin migrar.
- BACKEND_PORT y MCP_PORT no tienen default en docker-compose.yml: sin .env el compose falla/publica puerto vacío ('compose los exige', .env.example:14).
- validate_oauth_token_claims.sh NO verifica la firma del JWT (solo decodifica y valida claims); no sirve como prueba de autenticidad.
- validate_remote_mcp.sh y validate_remote_mcp_read.sh requieren el stack en docker (ejecutan el cliente dentro del contenedor backend y leen counts vía docker exec en wis_context_postgres): no funcionan contra el stack nativo de dev_native.py.
- validate_remote_mcp_write.sh ejecuta su cliente Python en el host: requiere mcp+anyio instalados fuera de docker, y muta datos reales (sin rollback).
- smoke_mcp.py valida presencia de 17 tools como subconjunto: no detecta tools extra ni fija el conteo real (21 en TOOL_SCOPES); integration/README.md:48 y VERIFICATION.md:19 siguen diciendo '17 tools' (drift documental conocido).
- start_named_cloudflare_tunnel.sh sale con código 0 aunque el endpoint no llegue a ser alcanzable (solo WARNING); y mezcla '--url' con 'run --token', donde el ingress remoto del dashboard puede ignorar UPSTREAM_URL.
- make health nunca falla (curl || echo) — no sirve como gate en scripts.
- La variable MCP_URL declarada en Makefile:5 no se usa en ninguna receta (dead default); el default operativo vive en smoke_mcp.py.
- validate_pr_governance.sh solo opera en GitHub Actions con evento pull_request/pull_request_target (fuera de eso hace skip con exit 0): no hay hook local equivalente.
- seed_erp_v2.py desactiva TODAS las tareas y scopes is_current del sistema al ejecutarse: no es seguro en una BD compartida con otras tareas activas.
- tag_phase3_internal.sh no publica el tag (no hace git push) y no corre los tests de backend antes de taggear (solo docs + tests de extensión).
- La instalación de Claude Desktop depende de node/npx en el PATH del entorno de Claude Desktop y de internet la primera vez (descarga de mcp-remote); solo cubre modo local sin auth (no configura Auth0/token para el endpoint remoto).
- mcp_log_filters.sh requiere jq instalado y, para 'tail', el stack docker corriendo; no soporta leer ficheros por argumento (solo stdin o docker compose logs).

## 7. Apéndice A — Hallazgos de verificación

### mcp-tools

- **exactitud:** ❌ no ejecutada (límite de sesión). Pendiente de re-verificación.
- **completitud:** ❌ no ejecutada (límite de sesión). Pendiente de re-verificación.

### backend-domain

- **exactitud:** ❌ no ejecutada (límite de sesión). Pendiente de re-verificación.
- **completitud:** ❌ no ejecutada (límite de sesión). Pendiente de re-verificación.

### backend-http-auth

- **exactitud:** revisadas 56 claims · 1 errores · 0 omisiones.
  - ❌ `Settings (pydantic BaseSettings) — y summary`: El informe afirma que Settings tiene "16 campos" (tanto en el summary como en exact_interface de la capability), pero la clase define 18 campos: project_name, backend_port, mcp_port, database_url, system_mode, mcp_auth_enabled, mcp_auth_bypass_local, mcp_auth0_issuer, mcp_auth0_audience, mcp_auth0_jwks_url, mcp_public_base_url, mcp_resource_id, mcp_allowed_origins, mcp_auth_clock_skew_seconds, mcp_log_level, mcp_log_json, mcp_log_payloads, mcp_log_include_headers_allowlist. La propia lista `config` del informe enumera 18 entradas, contradiciendo el número declarado. → Corrección: Son 18 campos (backend/app/core/config.py:9-29), no 16. La lista `config` del informe ya es correcta y completa con sus 18 entradas; solo el conteo "16 campos" del summary y de la capability Settings debe corregirse a 18.
- **completitud:** revisadas 53 claims · 1 errores · 9 omisiones.
  - ❌ `Settings (pydantic BaseSettings)`: El informe dice "16 campos" (en summary y en exact_interface), pero Settings define 18 campos (backend/app/core/config.py:9-29). La propia lista config del informe enumera 18 entradas, contradiciendo su conteo. → Corrección: Son 18 campos: project_name, backend_port, mcp_port, database_url, system_mode, mcp_auth_enabled, mcp_auth_bypass_local, mcp_auth0_issuer, mcp_auth0_audience, mcp_auth0_jwks_url, mcp_public_base_url, mcp_resource_id, mcp_allowed_origins, mcp_auth_clock_skew_seconds, mcp_log_level, mcp_log_json, mcp_log_payloads, mcp_log_include_headers_allowlist.
  - ➕ Omisión: Superficie HTTP no autenticada adicional a los "11 endpoints": FastAPI se crea con defaults (backend/app/main.py:5), por lo que /docs (Swagger UI), /redoc y /openapi.json están expuestos públicamente (no se pasa docs_url=None/openapi_url=None). El esquema OpenAPI revela toda la API interna sin auth.
  - ➕ Omisión: La resolución de tarea activa vía ContextScope NO exige que la Task apuntada tenga is_active=True ni filtra por scope_kind (backend/app/services/task_service.py:11-17): un ContextScope con is_current=True que apunte a una tarea inactiva/cerrada hace que GET /active-task y GET /internal/tasks/active devuelvan una TaskOut con is_active=false, y ancla también decisions/events/snapshots a esa tarea inactiva. Además, si el scope current tiene task_id NULL o apunta a una Task inexistente, cae en silencio al fallback is_active=True (task_service.py:14-20); el informe describe la precedencia pero omite ambas condiciones.
  - ➕ Omisión: Todos los esquemas de salida usan model_config = ConfigDict(from_attributes=True) (serialización desde objetos ORM): backend/app/schemas/task.py:8, backend/app/schemas/policy.py:8, backend/app/schemas/decision.py:8, backend/app/schemas/event.py:16, backend/app/schemas/snapshot.py:14, backend/app/schemas/proposal.py:8. El informe no lo menciona en ninguna parte.
  - ➕ Omisión: Los esquemas de entrada EventCreate (backend/app/schemas/event.py:7-12) y ManualSnapshotCreate (backend/app/schemas/snapshot.py:7-10) no definen extra="forbid" (aplica el default pydantic extra='ignore'): campos desconocidos en el body — p.ej. intentar fijar payload_json, consumer_id, execution_session_id o event_ts en POST /internal/events, o un typo en snapshot_content — se descartan en silencio sin 422. Relevante porque el informe afirma que payload_json "no se puede fijar por separado" sin señalar que intentarlo no produce error alguno.
  - ➕ Omisión: Sin límites de tamaño en las entradas: ningún campo string tiene max_length y metadata_json (backend/app/schemas/event.py:12) / snapshot_content (backend/app/schemas/snapshot.py:9) son dicts sin cota — POST /internal/events y POST /internal/snapshots/manual aceptan payloads arbitrariamente grandes que se persisten en JSONB sin auth.
  - ➕ Omisión: event_ts y created_at del evento son asignados por el servidor (server_default func.now(); create_event_for_task no los establece, backend/app/services/event_service.py:27-37): el cliente no puede fijar event_ts en POST /internal/events aunque EventOut lo exponga. El informe lista los campos no fijables (consumer_id, execution_session_id, payload_json) pero omite event_ts.
  - ➕ Omisión: normalize_log_level convierte None en "INFO" como fallback silencioso antes de validar (backend/app/core/config.py:63): MCP_LOG_LEVEL vacío/None no falla, se degrada a INFO.
  - ➕ Omisión: normalize_headers_allowlist convierte None en "" (backend/app/core/config.py:72-73): un MCP_LOG_INCLUDE_HEADERS_ALLOWLIST nulo deshabilita todos los headers en logs en vez de conservar el default.
  - ➕ Omisión: check_database_connection solo captura SQLAlchemyError (backend/app/db/health.py:12-13): cualquier otra excepción durante engine.connect()/execute propaga sin manejar y GET /health responde 500 genérico (sin cuerpo HealthResponse) en lugar del 503 degradado. El informe describe la tupla de retorno pero omite este gap del gate.

### ext-control-plane

- **exactitud:** ❌ no ejecutada (límite de sesión). Pendiente de re-verificación.
- **completitud:** ❌ no ejecutada (límite de sesión). Pendiente de re-verificación.

### ext-local-runtime

- **exactitud:** ❌ no ejecutada (límite de sesión). Pendiente de re-verificación.
- **completitud:** ❌ no ejecutada (límite de sesión). Pendiente de re-verificación.

### ops-scripts-ci

- **exactitud:** ❌ no ejecutada (límite de sesión). Pendiente de re-verificación.
- **completitud:** ❌ no ejecutada (límite de sesión). Pendiente de re-verificación.

## 8. Apéndice B — obsidian-mind (investigación)

# Informe: obsidian-mind (breferrari)

## 1. Qué es exactamente

**No es un plugin de Obsidian ni un servidor MCP propio: es una plantilla de vault de Obsidian + scaffolding de agente** ("An Obsidian vault that gives AI coding agents persistent memory"). Es un repositorio git que se clona como vault y trae:

- **Estructura de conocimiento opinada**: `brain/` (North Star.md = goals, Key Decisions, Memories, Patterns, Gotchas), `work/` (proyectos activos, archivo, incidents, 1:1s), `org/` (people, teams), `perf/` (brag doc, competencias, evidencia), `reference/` (conocimiento de codebase/arquitectura), `thinking/` (scratchpad), `bases/` (vistas tipo BBDD de Obsidian), `templates/`.
- **5 hooks de ciclo de vida de Claude Code** en TypeScript (`.claude/scripts/`, Node 22 con `--experimental-strip-types`): SessionStart (inyecta ~2K tokens: extracto de North Star, proyectos activos, git summary, listado de ficheros), UserPromptSubmit (clasifica el contenido: decision/incident/win/meeting/person/project e inyecta hints de ruteo ~100 tokens), PostToolUse (valida frontmatter YAML y wikilinks tras cada escritura de markdown), PreCompact (archiva transcripts a `thinking/session-logs/`), Stop (checklist de cierre `/om-wrap-up`).
- **18 slash commands** (`/om-standup`, `/om-dump`, `/om-wrap-up`, `/om-weekly`, `/om-review-brief`, `/om-vault-audit`, `/om-vault-upgrade`...), **9 subagentes** (context-loader, cross-linker, vault-librarian, vault-migrator...) y **skills** (obsidian-markdown, obsidian-cli, obsidian-bases, json-canvas, qmd).
- **Búsqueda semántica vía QMD** (`@tobilu/qmd`, opcional): colección SQLite con embeddings por vault, aislada por `vault-manifest.json` (`qmd_index`). Fallback a grep si no está.

Filosofía de diseño: los scripts procedurales hacen clasificación/validación/indexado; el agente decide contenido y enlaces. Carga por niveles para no volcar el vault entero en contexto.

## 2. Instalación y superficie de integración

**Instalación**: `shardmind install github:breferrari/obsidian-mind` (wizard que personaliza North Star; el sidecar `.shardmind/` es aditivo y eliminable), o clone directo / template de GitHub. Requiere Obsidian 1.12+ (por el CLI), Node 22+, git.

**API/exposición — la clave**:
- **No hay REST API ni servidor propio.** Todo es **file-first**: markdown plano con frontmatter YAML en un directorio git.
- **Un agente externo como Claude Code lee/escribe directamente con Read/Edit/Write** sobre los ficheros del vault; los hooks de PostToolUse validan lo escrito. Es exactamente el modelo que ya usas: no necesita puente.
- **El único MCP server es QMD**, registrado en `.mcp.json`, que expone `mcp__qmd__query`, `mcp__qmd__get`, `mcp__qmd__multi_get` — es decir, el vault sí ofrece **retrieval semántico consumible por cualquier cliente MCP** (Claude Code, Codex, etc.). Ojo con los pesos: primer `qmd embed` baja ~328MB; reranking LLM ~1.28GB (evitable con `qmd search` BM25 o `qmd vsearch`).
- **Multi-agente**: Claude Code con soporte completo; Codex CLI vía `AGENTS.md` + `.codex/hooks.json`; Gemini CLI vía `GEMINI.md` + `.gemini/settings.json`. Los tres reutilizan los mismos scripts TS. Otros agentes (Cursor, etc.) solo leen convenciones de `AGENTS.md`.
- Obsidian es aquí **solo la UI humana** (grafo, backlinks, Bases); el agente nunca pasa por Obsidian para operar.

## 3. Encaje con shared-dev-context-layer (RAG + goals + design-system + org-planning por proyecto)

Hay **solapamiento conceptual muy alto** — obsidian-mind ya implementa tres de tus cuatro piezas, aunque con sesgo a productividad personal/EM (perf reviews, brag doc, 1:1s) más que a canon de desarrollo por proyecto:

- **Como store de conocimiento por proyecto**: viable y es su mejor encaje. Un vault (o subárbol) por proyecto; `vault-manifest.json` con `qmd_index` propio aísla colecciones QMD en la misma máquina (aunque el issue #105 señala un bug: el nombre de colección se deriva del campo `template` compartido, no de `qmd_index` — relevante si montas multi-vault). `brain/Key Decisions.md` ≈ ADRs, `reference/` ≈ conocimiento de codebase, `work/incidents/` ≈ postmortems. El mapeo natural: goals → `brain/North Star.md`; org-planning → `org/` + `work/`; design-system → no existe nativamente, lo meterías como convención en `reference/design-system/` con frontmatter propio y vistas en `bases/`.
- **Como UI humana del canon**: excelente. Es el valor diferencial real frente a un RAG headless: el humano audita/edita el mismo canon que consume el agente, con grafo, backlinks y Bases como dashboards. `/om-vault-audit` (huérfanos, enlaces rotos, contenido obsoleto) es directamente una herramienta de higiene del canon.
- **Como fuente para el RAG**: QMD te da un RAG local ya resuelto (BM25 + vectorial + rerank opcional, expuesto por MCP) sobre markdown. Si tu shared-dev-context-layer iba a construir su propio índice, puedes o (a) adoptar QMD como motor, o (b) tratar el vault como corpus fuente de tu RAG existente — es markdown con frontmatter consistente y validado por hooks, ideal para chunking.
- **Lo más reutilizable aunque no adoptes el vault entero**: el patrón de hooks (SessionStart con inyección de ~2K tokens de contexto por proyecto + clasificador en UserPromptSubmit + validador de frontmatter en PostToolUse) es exactamente la capa de "context injection" que un shared-dev-context-layer necesita, y los scripts son TS agent-agnostic copiables.
- **Fricciones**: taxonomía orientada a persona, no a proyecto (habría que refactorizar `perf/` fuera o ignorarlo); un vault por proyecto multiplica índices QMD y mantenimiento; los upgrades de plantilla son merges de git sobre tu propio contenido (tus datos viven en el fork → conflictos garantizados al hacer `git pull origin main`); no hay noción de "canon compartido entre proyectos" — eso tendrías que montarlo tú (vault central + wikilinks o symlinks).

Veredicto: sirve mejor como **UI humana + convenciones + motor de retrieval (QMD/MCP)** que como arquitectura completa del sistema multi-agente. Si tu shared-dev-context-layer aún no existe como código, este repo es un punto de partida serio a fork-ear; si ya existe, roba QMD, los hooks y el esquema de frontmatter.

## 4. Madurez y riesgos

**Números**: ~3.2K estrellas, 398 forks, 117 commits, MIT, último release v6.2.1 (2-jun-2026), último commit 2-jun-2026, actividad semanal/quincenal desde abril de 2026 (v5.0 → v6.2.1 en ~2 meses: proyecto joven moviéndose rápido). 13 issues abiertos, 0 PRs abiertos; los issues son mayoritariamente mejoras de infraestructura, no bugs graves (naming de colecciones QMD #105, staleness del binario qmd #100, higiene de `active/` #98/#103, acoplamiento de scripts a `.claude/` #71).

**Riesgos concretos**:
1. **Bus factor ≈ 1**: un mantenedor (breferrari, con "claude" como coautor de commits); sin comunidad de contribuidores real.
2. **Velocidad de breaking changes**: v5→v6 introdujo ShardMind con migración dedicada; con ~2 meses de historia pública, la estructura puede volver a cambiar (issue #82 "Proposed Structure Refactor" abierto).
3. **Dependencias frágiles**: `@tobilu/qmd` (otro proyecto de un solo autor, binario que "puede quedarse stale silenciosamente" según su propio issue #100, descargas de modelos grandes) y `--experimental-strip-types` de Node (flag experimental).
4. **Modelo de upgrade por git merge**: tu conocimiento vive mezclado con la infraestructura de la plantilla; divergir es fácil, mantenerse al día es costoso.
5. **Mitigación clave**: el lock-in real es bajo — todo es markdown plano + git; si el proyecto muere, te quedas con un vault legible por cualquier herramienta y unos scripts TS auto-contenidos que puedes mantener tú.

Sources:
- [github.com/breferrari/obsidian-mind](https://github.com/breferrari/obsidian-mind)
- [README.md (raw)](https://raw.githubusercontent.com/breferrari/obsidian-mind/main/README.md)
- [Commits](https://github.com/breferrari/obsidian-mind/commits/main)
- [Issues](https://github.com/breferrari/obsidian-mind/issues)
