import * as vscode from "vscode";
import type { ContextCommandExecutionInput } from "../../application/contextCommandService";
import type { ContextPlaneResponse } from "../../infrastructure/wis/mcpContextPlaneClient";
import type { LocalCommandResult } from "../../local/types";
import type { ExtensionRuntimeContext } from "../runtimeContext";

type ContextToolRunner = (input: ContextCommandExecutionInput) => Promise<ContextPlaneResponse>;

type LocalToolRunner = () => Promise<LocalCommandResult>;

export function createContextToolExecutor(runtime: ExtensionRuntimeContext) {
  return async (toolLabel: string, runner: ContextToolRunner): Promise<void> => {
    const auth = await runtime.authManager.resolveAuthContext();
    const authDecision = runtime.authPolicy.evaluate(auth);
    if (!authDecision.allowed) {
      runtime.outputChannel.appendLine(
        `[WIS][AUTH][POLICY] ${toolLabel} blocked. code=${authDecision.code} message=${authDecision.message}`,
      );
      runtime.outputChannel.show(true);
      await vscode.window.showErrorMessage(`${toolLabel} bloqueado por policy de autenticación: ${authDecision.message}`);
      return;
    }

    const session = await runtime.sessionManager.getOrCreateSession();
    const config = runtime.getCurrentConfig();
    const result = await runner({
      endpoint: config.endpoint,
      timeoutMs: config.timeoutMs,
      auth,
      consumer: runtime.sessionManager.consumer,
      sessionKey: session.sessionKey,
    });

    runtime.contextCommandRenderer.render(result.tool, result);
    runtime.outputChannel.show(true);

    if (!result.ok) {
      const scopeHint = result.requiredScopes.length > 0 ? ` scopes=${result.requiredScopes.join(",")}` : "";
      if (result.status === "forbidden") {
        await vscode.window.showErrorMessage(`${toolLabel} -> 403 insufficient_scope.${scopeHint}`);
        return;
      }
      if (result.status === "unauthorized") {
        await vscode.window.showErrorMessage(`${toolLabel} -> 401 unauthorized. Configura token/authMode.`);
        return;
      }
      await vscode.window.showErrorMessage(`${toolLabel} falló: ${result.message}`);
      return;
    }

    await vscode.window.showInformationMessage(`${toolLabel} completado. status=${result.status ?? "ok"}`);
  };
}

export function createLocalCommandExecutor(runtime: ExtensionRuntimeContext) {
  return async (label: string, runner: LocalToolRunner): Promise<void> => {
    const result = await runner();
    runtime.localOutputRenderer.render(result, runtime.localStore.getSnapshot());
    runtime.outputChannel.show(true);

    if (!result.ok) {
      if (result.status === "blocked") {
        await vscode.window.showWarningMessage(result.message);
      } else {
        await vscode.window.showErrorMessage(`${label} falló: ${result.message}`);
      }
      return;
    }

    await vscode.window.showInformationMessage(`${label} completado.`);
  };
}
