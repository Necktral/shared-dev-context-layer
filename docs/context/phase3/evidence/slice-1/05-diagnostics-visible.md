# Slice 1 Evidence - 05 Diagnostics Visible

- Fecha/hora (UTC): 2026-03-30T22:39:35Z
- Comando ejecutado:
  - `rg -n "wisContextSync.diagnosticMode|session_key|session_created_at|session_state|diagnosticMode" vscode-extension/package.json vscode-extension/src/*.ts`

## Salida observada

```text
vscode-extension/package.json:37:        "wisContextSync.diagnosticMode": {
vscode-extension/src/config.ts:13:    vscode.workspace.getConfiguration().get<boolean>("wisContextSync.diagnosticMode") ??
vscode-extension/src/extension.ts:23:    session_key: session.sessionKey,
vscode-extension/src/extension.ts:24:    session_created_at: session.sessionCreatedAt,
vscode-extension/src/extension.ts:25:    session_state: session.sessionState,
vscode-extension/src/diagnostics.ts:5:  session_key: string;
vscode-extension/src/diagnostics.ts:6:  session_created_at: string;
vscode-extension/src/diagnostics.ts:7:  session_state: "created" | "reused" | "reset";
```

- Resultado: `pass`
- Nota corta: diagnostico configurable y campos de sesion visibles en eventos `extension_activated`, `load_operational_context_requested` y `session_reset`.
