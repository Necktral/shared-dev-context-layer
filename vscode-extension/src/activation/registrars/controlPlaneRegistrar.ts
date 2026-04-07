import * as vscode from "vscode";
import {
  COMMAND_CLEAR_AUTH,
  COMMAND_CONFIGURE_AUTH,
  COMMAND_LOAD_CONTEXT,
  COMMAND_PREPARE_HANDOFF,
  COMMAND_RESET_SESSION,
} from "../../constants";
import type { ExtensionRuntimeContext } from "../runtimeContext";

export function registerControlPlaneCommands(runtime: ExtensionRuntimeContext): vscode.Disposable[] {
  const loadDisposable = vscode.commands.registerCommand(COMMAND_LOAD_CONTEXT, async () => {
    const auth = await runtime.authManager.resolveAuthContext();
    const authDecision = runtime.authPolicy.evaluate(auth);
    if (!authDecision.allowed) {
      runtime.outputChannel.appendLine(
        `[WIS][AUTH][POLICY] WIS: Load Operational Context blocked. code=${authDecision.code} message=${authDecision.message}`,
      );
      runtime.outputChannel.show(true);
      await vscode.window.showErrorMessage(
        `WIS: Load Operational Context bloqueado por policy de autenticación: ${authDecision.message}`,
      );
      return;
    }

    const envelope = await runtime.loadService.load(auth);
    const authSummary = auth.mode === "none" ? "none" : `${auth.mode}/${auth.token ? "configured" : "missing"}`;
    runtime.outputChannel.show(true);
    await vscode.window.showInformationMessage(
      `WIS context ${envelope.meta.load_state}. mode=${envelope.meta.runtime_mode}, transport=${envelope.meta.transport_status}, auth=${authSummary}, session=${envelope.meta.session_key}`,
    );
  });

  const resetDisposable = vscode.commands.registerCommand(COMMAND_RESET_SESSION, async () => {
    const currentEndpoint = runtime.getCurrentConfig().endpoint;
    const session = await runtime.sessionManager.resetSession();
    const snapshot = runtime.buildDiagnosticsSnapshot("session_reset", session, currentEndpoint, true);
    runtime.diagnostics.report(snapshot, runtime.isDiagnosticMode());
    runtime.outputChannel.show(true);
    await vscode.window.showInformationMessage(`WIS session reset. new session_key=${snapshot.session_key}`);
  });

  const prepareHandoffDisposable = vscode.commands.registerCommand(COMMAND_PREPARE_HANDOFF, async () => {
    const lastEnvelope = runtime.contextStore.getLast();
    const intent = {
      user_intent: "Preparar handoff estructurado para siguiente ejecución Codex.",
      local_focus: lastEnvelope?.local_environment.active_file ? [lastEnvelope.local_environment.active_file] : [],
      detail_level: "standard" as const,
    };

    const result = runtime.handoffBuilder.build({
      intent,
      target: "codex",
    });

    runtime.outputChannel.show(true);
    if (result.status === "blocked") {
      await vscode.window.showWarningMessage("Handoff blocked: ejecuta 'WIS: Load Operational Context' y reintenta.");
      return;
    }

    await vscode.window.showInformationMessage(`Handoff ${result.status} generado para ${result.artifact?.meta.target ?? "codex"}.`);
  });

  const configureAuthDisposable = vscode.commands.registerCommand(COMMAND_CONFIGURE_AUTH, async () => {
    const status = await runtime.authManager.configureInteractive();
    runtime.outputChannel.show(true);
    if (status.mode === "none") {
      await vscode.window.showWarningMessage(
        "authMode está en 'none'. Cambia wisContextSync.authMode a 'bearer' o 'api_key' antes de configurar token.",
      );
      return;
    }
    if (!status.has_token) {
      await vscode.window.showWarningMessage("No se guardó token de autenticación.");
      return;
    }

    await vscode.window.showInformationMessage(
      `Autenticación configurada. mode=${status.mode}, required=${status.required ? "true" : "false"}.`,
    );
  });

  const clearAuthDisposable = vscode.commands.registerCommand(COMMAND_CLEAR_AUTH, async () => {
    await runtime.authManager.clearToken();
    runtime.outputChannel.show(true);
    await vscode.window.showInformationMessage("Token de autenticación eliminado de SecretStorage.");
  });

  return [loadDisposable, resetDisposable, prepareHandoffDisposable, configureAuthDisposable, clearAuthDisposable];
}
