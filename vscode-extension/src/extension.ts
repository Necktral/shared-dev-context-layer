import * as vscode from "vscode";
import { EXTENSION_OUTPUT_CHANNEL, LOCAL_RUNTIME_VIEW_ID } from "./constants";
import { bootstrapExtension } from "./activation/bootstrap";
import { registerCouncilRoomCommands } from "./activation/registrars/councilRoomRegistrar";
import { registerContextToolCommands } from "./activation/registrars/contextToolsRegistrar";
import { registerControlPlaneCommands } from "./activation/registrars/controlPlaneRegistrar";
import { registerLocalRuntimeCommands } from "./activation/registrars/localRuntimeRegistrar";
import { getOperationProfile } from "./config";
import { createInitialProjectRuntimeSnapshot } from "./local/types";
import { LocalRuntimePanelProvider } from "./presentation/local/localRuntimePanelProvider";

let outputChannel: vscode.OutputChannel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel(EXTENSION_OUTPUT_CHANNEL);
  context.subscriptions.push(outputChannel);

  const localPanelProvider = new LocalRuntimePanelProvider(createInitialProjectRuntimeSnapshot(getOperationProfile()));
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(LOCAL_RUNTIME_VIEW_ID, localPanelProvider));

  const runtime = await bootstrapExtension(context, outputChannel, localPanelProvider);

  context.subscriptions.push(...runtime.disposables);

  context.subscriptions.push(
    ...registerControlPlaneCommands(runtime),
    ...registerContextToolCommands(runtime),
    ...registerCouncilRoomCommands(context, runtime),
    ...registerLocalRuntimeCommands(context, runtime),
  );
}

export function deactivate(): void {
  outputChannel?.dispose();
}
