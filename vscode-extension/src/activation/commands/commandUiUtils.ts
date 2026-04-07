import * as vscode from "vscode";

export async function promptRequired(
  placeHolder: string,
  prompt: string,
  value?: string,
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    placeHolder,
    prompt,
    value,
    ignoreFocusOut: true,
    validateInput: (raw) => (!raw.trim() ? "Campo obligatorio." : null),
  });
}

export async function promptDryRunMode(): Promise<boolean | undefined> {
  const selected = await vscode.window.showQuickPick(
    [
      { label: "dry_run", detail: "Preview sin mutación", value: true },
      { label: "commit", detail: "Ejecutar mutación", value: false },
    ],
    {
      placeHolder: "Selecciona modo de ejecución",
      ignoreFocusOut: true,
    },
  );
  return selected?.value;
}

export function labelsFromInput(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
