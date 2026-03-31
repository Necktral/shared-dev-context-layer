# GO/NO-GO Checklist - Fase 3

## A. Contrato y superficie publica

- [ ] Runtime contract documentado y vigente: `offline_fixture | mcp`
- [ ] Comandos oficiales alineados docs+codigo:
  - [ ] `WIS: Load Operational Context`
  - [ ] `WIS: Reset Session`
  - [ ] `WIS: Prepare Handoff`
- [ ] Contratos tipados congelados:
  - [ ] `OperationalContextEnvelope`
  - [ ] `HandoffIntent`
  - [ ] `HandoffTarget`
  - [ ] `HandoffBuildResult`
  - [ ] `HandoffArtifact`

## B. Calidad automatica

- [ ] `vscode-extension`: compile + tests verdes
- [ ] `backend`: `alembic upgrade head` + `pytest -q` verde
- [ ] docs consistency check verde
- [ ] sin strings legacy prohibidas
- [ ] sin marcadores `filecite` residuales

## C. Cierre operativo 3A (manual)

### offline_fixture

- [ ] `success_full` -> `loaded`
- [ ] `partial_missing_recent_errors` -> `partially_loaded`
- [ ] `degraded_no_remote_bundle` -> `degraded`
- [ ] `transport_error` -> fallo/degradacion explicita
- [ ] `no_active_task` -> issue dominio visible
- [ ] `validation_stale` -> issue visible

### mcp

- [ ] endpoint valido -> carga real
- [ ] timeout/unreachable -> `transport_error|unavailable`
- [ ] respuesta parcial -> `partially_loaded`
- [ ] schema invalido -> `schema_error`

## D. Cierre operativo 3B + Slice 4 baseline

- [ ] snapshots de envelope, renderer, artifact y prompts estables
- [ ] evidencia `Prepare Handoff`:
  - [ ] `ready`
  - [ ] `partial`
  - [ ] `blocked`
- [ ] paridad semantica fixture vs mcp validada

## E. No-write proof

- [ ] sin write actions contra WIS
- [ ] sin shell auto-execution
- [ ] sin mutacion automatica de repo
- [ ] policy `delegated_limited` respetada

## F. Release interna

- [ ] changelog de cierre validado
- [ ] guia diaria del equipo publicada
- [ ] checklist firmado por responsables
- [ ] tag creada: `v0.1.0-phase3-internal`
- [ ] tag publicada en remoto

## Decision

- [ ] GO
- [ ] NO-GO

Motivo (si NO-GO):

