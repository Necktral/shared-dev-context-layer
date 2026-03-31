import * as vscode from "vscode";
import { getMcpEndpoint, isDiagnosticModeEnabled } from "./config";
import {
  COMMAND_LOAD_CONTEXT,
  COMMAND_RESET_SESSION,
  EXTENSION_OUTPUT_CHANNEL,
} from "./constants";
import { DiagnosticsReporter, type DiagnosticsSnapshot } from "./diagnostics";
import { EnvironmentInspector, EnvironmentSnapshot } from "./environment/environmentInspector";
import { SessionManager, SessionSnapshot } from "./sessionManager";

let outputChannel: vscode.OutputChannel | undefined;

function createSnapshot(
  event: string,
  consumer: string,
  session: SessionSnapshot,
  endpoint: string,
  initialized: boolean,
  environment?: EnvironmentSnapshot,
): DiagnosticsSnapshot {
  return {
    event,
    consumer,
    session_key: session.sessionKey,
    session_created_at: session.sessionCreatedAt,
    session_state: session.sessionState,
    endpoint,
    workspace_root: environment?.workspace_root ?? null,
    repo_root: environment?.repo_root ?? null,
    branch: environment?.branch ?? null,
    active_file: environment?.active_file ?? null,
    inspector_status: environment?.inspector_status ?? "not_checked",
    inspector_error: environment?.inspector_error ?? null,
    initialized,
    timestamp: new Date().toISOString(),
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel(EXTENSION_OUTPUT_CHANNEL);
  context.subscriptions.push(outputChannel);

  const sessionManager = new SessionManager(context);
  const environmentInspector = new EnvironmentInspector();
  const diagnostics = new DiagnosticsReporter(outputChannel);

  const endpoint = getMcpEndpoint();
  const activeSession = await sessionManager.getOrCreateSession();
  const activationEnvironment = await environmentInspector.inspect();
  diagnostics.report(
    createSnapshot(
      "extension_activated",
      sessionManager.consumer,
      activeSession,
      endpoint,
      true,
      activationEnvironment,
    ),
    isDiagnosticModeEnabled(),
  );

  const loadDisposable = vscode.commands.registerCommand(COMMAND_LOAD_CONTEXT, async () => {
    const currentEndpoint = getMcpEndpoint();
    const session = await sessionManager.getOrCreateSession();
    const environment = await environmentInspector.inspect();
    const snapshot = createSnapshot(
      "load_operational_context_requested",
      sessionManager.consumer,
      session,
      currentEndpoint,
      true,
      environment,
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
