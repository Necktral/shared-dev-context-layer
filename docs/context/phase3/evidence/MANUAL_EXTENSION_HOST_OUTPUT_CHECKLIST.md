# Manual Extension Host Output Checklist

Fecha:
Operador:
Branch:

## Scope

Objetivo: validar en Extension Host (F5) los comandos UI y el Output Channel `WIS Context Sync` para runtime dual (`offline_fixture` y `mcp`).

## Preflight

- [ ] Stack local arriba (`postgres`, `backend`, `mcp`)
- [ ] Endpoint MCP local responde en `http://localhost:8002/mcp`
- [ ] Extension compilada (`npm run compile`)
- [ ] Extension Host abierto con F5
- [ ] Output Channel seleccionado: `WIS Context Sync`

## A. Load Operational Context (offline_fixture)

### A1. Scenario: success_full

Configuracion:
- `wisContextSync.runtimeMode=offline_fixture`
- `wisContextSync.fixtureScenario=success_full`

Esperado en output:
- `[WIS] load_operational_context`
- `runtime_mode: offline_fixture`
- `load_state: loaded`
- `transport_status: ok`

Resultado:
- [ ] PASS
- [ ] FAIL
Observaciones:

### A2. Scenario: partial_missing_recent_errors

Configuracion:
- `wisContextSync.fixtureScenario=partial_missing_recent_errors`

Esperado:
- `load_state: partially_loaded`
- `transport_status: transport_error`

Resultado:
- [ ] PASS
- [ ] FAIL
Observaciones:

### A3. Scenario: degraded_no_remote_bundle

Configuracion:
- `wisContextSync.fixtureScenario=degraded_no_remote_bundle`

Esperado:
- `load_state: degraded`
- `transport_status: unavailable`

Resultado:
- [ ] PASS
- [ ] FAIL
Observaciones:

### A4. Scenario: transport_error

Configuracion:
- `wisContextSync.fixtureScenario=transport_error`

Esperado:
- `load_state: degraded`
- `transport_status: transport_error`

Resultado:
- [ ] PASS
- [ ] FAIL
Observaciones:

### A5. Scenario: no_active_task

Configuracion:
- `wisContextSync.fixtureScenario=no_active_task`

Esperado:
- `load_state: partially_loaded`
- `transport_status: partial`

Resultado:
- [ ] PASS
- [ ] FAIL
Observaciones:

### A6. Scenario: validation_stale

Configuracion:
- `wisContextSync.fixtureScenario=validation_stale`

Esperado:
- `load_state: loaded`
- `transport_status: ok`
- Seccion `Issues` con bandera de dominio stale

Resultado:
- [ ] PASS
- [ ] FAIL
Observaciones:

## B. Prepare Handoff

### B1. Handoff ready

Precondicion:
- Correr `WIS: Load Operational Context` con `success_full`

Esperado:
- `[WIS] prepare_handoff`
- `status: ready`
- `load_state: loaded`

Resultado:
- [ ] PASS
- [ ] FAIL
Observaciones:

### B2. Handoff partial

Precondicion:
- Correr `WIS: Load Operational Context` con `transport_error`

Esperado:
- `status: partial`
- `uncertainty:` presente

Resultado:
- [ ] PASS
- [ ] FAIL
Observaciones:

### B3. Handoff blocked

Precondicion:
- Ejecutar `WIS: Reset Session` y luego `WIS: Prepare Handoff` sin recargar contexto

Esperado:
- `status: blocked`
- `artifact: null`

Resultado:
- [ ] PASS
- [ ] FAIL
Observaciones:

## C. Runtime MCP + Context Commands

Configuracion:
- `wisContextSync.runtimeMode=mcp`
- `wisContextSync.mcpEndpoint=http://localhost:8002/mcp`
- `wisContextSync.authMode=none`
- `wisContextSync.requireAuthentication=false`

### C1. Load in MCP

Esperado:
- `runtime_mode: mcp`
- `transport_status` coherente (ok/partial segun estado)

Resultado:
- [ ] PASS
- [ ] FAIL
Observaciones:

### C2. Search Context

Comando:
- `WIS: Search Context` con query `bootstrap`

Esperado:
- `== Context Command :: search_context ==`
- `ok: true`
- `status: ok`

Resultado:
- [ ] PASS
- [ ] FAIL
Observaciones:

### C3. Upsert Context Item (commit)

Input sugerido:
- `item_key=ui.manual.item.a`
- `title=UI Manual Item A`
- `item_type=note`
- `labels=manual,e2e`
- `mode=commit`

Esperado:
- `== Context Command :: upsert_context_item ==`
- `ok: true`
- `status: ok`

Resultado:
- [ ] PASS
- [ ] FAIL
Observaciones:

### C4. Append Context Event (commit)

Input sugerido:
- `summary=ui manual event`
- `event_type=info`
- `mode=commit`

Esperado:
- `== Context Command :: append_context_event ==`
- `ok: true`
- `status: ok`

Resultado:
- [ ] PASS
- [ ] FAIL
Observaciones:

### C5. Apply Sync Batch (dry_run)

Input sugerido:
- `[{"operation":"upsert_context_item"}]`
- `mode=dry_run`

Esperado:
- `== Context Command :: apply_sync_batch ==`
- `ok: true`
- `status: ok`

Resultado:
- [ ] PASS
- [ ] FAIL
Observaciones:

## D. Final Verdict

- [ ] PASS
- [ ] PASS WITH ISSUES
- [ ] NO-GO

Hallazgos (priorizados):
1.
2.
3.

Siguiente accion:
