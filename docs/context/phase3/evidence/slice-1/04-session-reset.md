# Slice 1 Evidence - 04 Session Reset

- Fecha/hora (UTC): 2026-03-30T22:39:35Z
- Comando ejecutado:
  - `rg -n "resetSession\\(|createSession\\(\"reset\"\\)|COMMAND_RESET_SESSION" vscode-extension/src/sessionManager.ts vscode-extension/src/extension.ts vscode-extension/src/constants.ts`

## Salida observada

```text
vscode-extension/src/constants.ts:10:export const COMMAND_RESET_SESSION = "wisContextSync.resetSession";
vscode-extension/src/extension.ts:63:  const resetDisposable = vscode.commands.registerCommand(COMMAND_RESET_SESSION, async () => {
vscode-extension/src/extension.ts:65:    const session = await sessionManager.resetSession();
vscode-extension/src/sessionManager.ts:41:  public async resetSession(): Promise<SessionSnapshot> {
vscode-extension/src/sessionManager.ts:42:    return this.createSession("reset");
```

- Resultado: `pass`
- Nota corta: reset manual expuesto por comando y genera nuevo `session_key` con estado `reset`.
