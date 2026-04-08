# Phase 1 CLI Output Evidence (A1 + A6)

Fecha de ejecucion (UTC): 2026-04-08  
Operador: necktral  
Branch de evidencia: `docs/phase1-cli-evidence-a1-a6`

## Objetivo

Generar evidencia reproducible desde terminal (sin Extension Host manual) del output estructurado del canal `WIS Context Sync` para:

- A1 (`success_full`)
- A6 (`validation_stale`)

## Comandos ejecutados

1. `cd vscode-extension && npm run manual:a1 | tee ../docs/context/phase4/evidence/phase1-cli-output-a1-success_full.log`
2. `cd vscode-extension && npm run manual:load-context-output -- --runtime-mode offline_fixture --scenario validation_stale | tee ../docs/context/phase4/evidence/phase1-cli-output-a6-validation_stale.log`

## Resultado A1 (`success_full`)

Estado: `PASS`

Extractos verificados:

- `runtime_mode: offline_fixture`
- `transport_status: ok`
- `load_state: loaded`
- `issue_count: 1`
- `issue_origin_summary: local:0, transport:0, protocol:0, domain:1, presentation:0`

Nota: el issue de dominio observado es `local_branch_vs_wis_branch_mismatch` porque la evidencia se ejecutó fuera de `main`. No afecta el estado esperado de carga/transporte del escenario A1.

Archivo raw:

- `docs/context/phase4/evidence/phase1-cli-output-a1-success_full.log`

## Resultado A6 (`validation_stale`)

Estado: `PASS`

Extractos verificados:

- `runtime_mode: offline_fixture`
- `transport_status: ok`
- `load_state: loaded`
- `current_status: stale`
- `Validation status reportado como stale.`
- `issue_count: 2`
- `issue_origin_summary: local:0, transport:0, protocol:0, domain:2, presentation:0`

Archivo raw:

- `docs/context/phase4/evidence/phase1-cli-output-a6-validation_stale.log`

## Veredicto

La ruta CLI recién integrada produce evidencia reproducible y trazable para los casos A1 y A6, cumpliendo salida visible de `runtime_mode`, `transport_status`, `load_state`, `issue_count` y resumen de origen de issues.
