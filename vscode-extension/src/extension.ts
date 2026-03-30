import * as vscode from "vscode";
import { getMcpEndpoint } from "./config";
import {
  COMMAND_LOAD_CONTEXT,
  COMMAND_RESET_SESSION,
  EXTENSION_OUTPUT_CHANNEL,
} from "./constants";
import { DiagnosticsReporter } from "./diagnostics";
import { SessionManager } from "./sessionManager";

let outputChannel: vscode.OutputChannel | undefined;

function createSnapshot(
  event: string,
  consumer: string,
  sessionKey: string,
  endpoint: string,
  initialized: boolean,
) {
  return {
    event,
    consumer,
    sessionKey,
    endpoint,
    initialized,
    timestamp: new Date().toISOString(),
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel(EXTENSION_OUTPUT_CHANNEL);
  context.subscriptions.push(outputChannel);

  const sessionManager = new SessionManager(context);
  const diagnostics = new DiagnosticsReporter(outputChannel);

  const endpoint = getMcpEndpoint();
  const activeSessionKey = await sessionManager.getSessionKey();
  diagnostics.report(
    createSnapshot("extension_activated", sessionManager.consumer, activeSessionKey, endpoint, true),
  );

  const loadDisposable = vscode.commands.registerCommand(COMMAND_LOAD_CONTEXT, async () => {
    const currentEndpoint = getMcpEndpoint();
    const sessionKey = await sessionManager.getSessionKey();
    const snapshot = createSnapshot(
      "load_operational_context_requested",
      sessionManager.consumer,
      sessionKey,
      currentEndpoint,
      true,
    );
    diagnostics.report(snapshot);
    outputChannel?.show(true);
    await vscode.window.showInformationMessage(
      `WIS Context Sync loaded (read-only). consumer=${snapshot.consumer}, session=${snapshot.sessionKey}`,
    );
  });

  const resetDisposable = vscode.commands.registerCommand(COMMAND_RESET_SESSION, async () => {
    const currentEndpoint = getMcpEndpoint();
    const newKey = await sessionManager.rotateSessionKey();
    diagnostics.report(
      createSnapshot("session_reset", sessionManager.consumer, newKey, currentEndpoint, true),
    );
    outputChannel?.show(true);
    await vscode.window.showInformationMessage(`WIS session reset. new session_key=${newKey}`);
  });

  context.subscriptions.push(loadDisposable, resetDisposable);
}

export function deactivate(): void {
  outputChannel?.dispose();
}
