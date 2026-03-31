# Slice 3B Hardening Evidence

Objetivo: congelar contrato y rendering con pruebas reproducibles antes de depender de `HandoffBuilder`.

## Evidencia automatizada

Comando:

```bash
cd vscode-extension
npm test
```

Debe incluir validación de:

- Snapshot shape de `OperationalContextEnvelope`
- Snapshot output del renderer de contexto
- Snapshot de `HandoffArtifact`
- Snapshot de prompts Codex (`ask` y `code`)
- Clasificación de errores (`transport`, `schema`, `domain`)
- Paridad semántica entre envelope fuente `offline_fixture` y `mcp`

## Criterio de cierre

- Suite sin fallos
- Snapshots estables
- Sin drift de contrato público
- Sin writes introducidos en la extensión
