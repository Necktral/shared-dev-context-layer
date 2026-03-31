import * as vscode from "vscode";
import { getMcpEndpoint, isDiagnosticModeEnabled } from "./config";
import {
  COMMAND_LOAD_CONTEXT,
  COMMAND_RESET_SESSION,
  EXTENSION_OUTPUT_CHANNEL,
} from "./constants";
import { DiagnosticsReporter } from "./diagnostics";
import { SessionManager, SessionSnapshot } from "./sessionManager";

let outputChannel: vscode.OutputChannel | undefined;

function createSnapshot(
  event: string,
  consumer: string,
  session: SessionSnapshot,
  endpoint: string,
  initialized: boolean,
) {
  return {
    event,
    consumer,
    session_key: session.sessionKey,
    session_created_at: session.sessionCreatedAt,
    session_state: session.sessionState,
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
  const activeSession = await sessionManager.getOrCreateSession();
  diagnostics.report(
    createSnapshot("extension_activated", sessionManager.consumer, activeSession, endpoint, true),
    isDiagnosticModeEnabled(),
  );

  const loadDisposable = vscode.commands.registerCommand(COMMAND_LOAD_CONTEXT, async () => {
    const currentEndpoint = getMcpEndpoint();
    const session = await sessionManager.getOrCreateSession();
    const snapshot = createSnapshot(
      "load_operational_context_requested",
      sessionManager.consumer,
      session,
      currentEndpoint,
      true,
    );
    diagnostics.report(snapshot, isDiagnosticModeEnabled());
    outputChannel?.show(true);
    await vscode.window.showInformationMessage(
      `WIS Context Sync loaded (read-only). consumer=${snapshot.consumer}, session=${snapshot.session_key}`,
    );
  });

  const resetDisposable = vscode.commands.registerCommand(COMMAND_RESET_SESSION, async () => {
    const currentEndpoint = getMcpEndpoint();
    const session = await sessionManager.resetSession();
    const snapshot = createSnapshot("session_reset", sessionManager.consumer, session, currentEndpoint, true);
    diagnostics.report(
      snapshot,
      isDiagnosticModeEnabled(),
    );
    outputChannel?.show(true);
    await vscode.window.showInformationMessage(
      `WIS session reset. new session_key=${snapshot.session_key}`,
    );
  });

  context.subscriptions.push(loadDisposable, resetDisposable);
}

export function deactivate(): void {
  outputChannel?.dispose();
}
