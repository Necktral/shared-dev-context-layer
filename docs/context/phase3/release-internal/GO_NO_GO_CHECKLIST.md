# GO/NO-GO Checklist - Fase 3

## A. Contrato y superficie publica

- [x] Runtime contract documentado y vigente: `offline_fixture | mcp`
- [x] Comandos oficiales alineados docs+codigo:
  - [x] `WIS: Load Operational Context`
  - [x] `WIS: Reset Session`
  - [x] `WIS: Prepare Handoff`
- [x] Contratos tipados congelados:
  - [x] `OperationalContextEnvelope`
  - [x] `HandoffIntent`
  - [x] `HandoffTarget`
  - [x] `HandoffBuildResult`
  - [x] `HandoffArtifact`

## B. Calidad automatica

- [x] `vscode-extension`: compile + tests verdes
- [x] `backend`: `alembic upgrade head` + `pytest -q` verde
- [x] docs consistency check verde
- [x] sin strings legacy prohibidas
- [x] sin marcadores `filecite` residuales

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

- [x] snapshots de envelope, renderer, artifact y prompts estables
- [x] evidencia `Prepare Handoff`:
  - [x] `ready`
  - [x] `partial`
  - [x] `blocked`
- [x] paridad semantica fixture vs mcp validada

## E. No-write proof

- [x] sin write actions contra WIS
- [x] sin shell auto-execution
- [x] sin mutacion automatica de repo
- [x] policy `delegated_limited` respetada

## F. Release interna

- [x] changelog de cierre validado
- [x] guia diaria del equipo publicada
- [ ] checklist firmado por responsables
- [x] tag creada: `v0.1.0-phase3-internal` (local)
- [x] tag publicada en remoto
- [x] branch `main` publicada en remoto (incluye `.github/workflows/phase3-ci.yml`)

## Decision

- [ ] GO
- [ ] NO-GO

Motivo (si NO-GO):

## Bloqueos actuales para pasar a GO

- Falta `CF_NAMED_TUNNEL_TOKEN` para crear named tunnel.
- Falta `CF_MCP_PUBLIC_BASE_URL` para validar endpoint estable remoto.
