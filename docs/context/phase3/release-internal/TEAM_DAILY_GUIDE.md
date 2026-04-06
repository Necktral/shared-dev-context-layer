# Team Daily Guide - Phase 3

Guia operativa diaria para usar el control plane read-only sin drift.

## 1. Arranque rapido

1. Abrir workspace en VS Code.
2. Confirmar settings:
   - `wisContextSync.runtimeMode`
   - `wisContextSync.mcpEndpoint`
   - `wisContextSync.fixtureScenario` (si aplica)
3. Ejecutar `WIS: Load Operational Context`.
4. Si se requiere delegacion, ejecutar `WIS: Prepare Handoff`.

## 2. Decision de modo runtime

- Usa `offline_fixture` para desarrollo local y pruebas deterministas.
- Usa `mcp` para validar consumo real de WIS y conectividad.

No cambies de modo esperando fallback automatico.

## 3. Interpretacion minima de estados

### Load

- `loaded`: contexto operativo completo util.
- `partially_loaded`: contexto util con incertidumbre parcial.
- `degraded`: remoto no util, pero hay base local para diagnostico.
- `failed`: sin base util para operacion.

### Handoff

- `ready`: artifact listo para delegacion.
- `partial`: artifact util con incertidumbre explicita.
- `blocked`: falta contexto valido; recargar primero.

## 4. Checklist diario de higiene

- correr `npm test` en `vscode-extension` antes de merge
- correr `./scripts/validate_docs_consistency.sh` si hubo cambios docs
- en trabajo `mcp`, confirmar endpoint terminado en `/mcp`
- nunca introducir writes en extension

## 5. Escalacion de incidentes

- transporte/schema/domain: registrar en evidencia de fase
- mismatch docs/codigo: corregir docs canonicas en mismo delta
- regresion read-only: bloquear merge hasta resolver

## 6. Disciplina de integracion (Package 8)

Secuencia obligatoria para bloques nuevos en `local_private`:

1. `git fetch origin`
2. validar sincronizacion de base: `git rev-list --left-right --count main...origin/main` debe quedar `0 0`
3. crear rama nueva desde `origin/main` (no desde ramas ya mergeadas)
4. mantener `1 bloque = 1 rama objetivo + 1 PR`
5. cerrar bloque solo con CI en verde + evidencia phase4 actualizada

Regla anti-stack:

- no encadenar ramas nuevas sobre ramas ya mergeadas.
- si una PR base ya fue mergeada, restack inmediato sobre `origin/main`.

## 7. Referencias operativas

- Canon: `docs/context/`
- Canon local_private: `docs/context/local_private/README.md`
- Runbook MCP: `docs/mcp/README.md`
- Gate GO/NO-GO: `docs/context/WIS_PHASE_3_ACCEPTANCE_GATE.md`
- Checklist release: `docs/context/phase3/release-internal/GO_NO_GO_CHECKLIST.md`
