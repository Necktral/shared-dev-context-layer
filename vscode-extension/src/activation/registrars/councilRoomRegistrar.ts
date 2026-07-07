import * as vscode from "vscode";
import {
  COMMAND_COUNCIL_CONFIGURE_GEMINI_KEY,
  COMMAND_COUNCIL_OPEN_ROOM,
  COMMAND_COUNCIL_RUN_ROUND,
  COMMAND_COUNCIL_SYNTHESIZE_PACKET,
} from "../../constants";
import type { CouncilSensitivityLabel } from "../../local/types";
import { createLocalCommandExecutor } from "../commands/commandExecutors";
import { promptRequired } from "../commands/commandUiUtils";
import type { ExtensionRuntimeContext } from "../runtimeContext";

export function registerCouncilRoomCommands(
  context: vscode.ExtensionContext,
  runtime: ExtensionRuntimeContext,
): vscode.Disposable[] {
  const executeLocalCommand = createLocalCommandExecutor(runtime);

  const openRoomDisposable = vscode.commands.registerCommand(COMMAND_COUNCIL_OPEN_ROOM, async () => {
    const question = await promptRequired("Problema para Council Room", "Describe el problema para Reg y el consejo.");
    if (!question) {
      return;
    }

    const selected = await vscode.window.showQuickPick(
      [
        {
          label: "sensitive",
          detail: "Solo roles locales; no se invita a Gemini.",
          value: "sensitive" as CouncilSensitivityLabel,
        },
        {
          label: "non_sensitive",
          detail: "Permite Gemini si external review está habilitado y hay key.",
          value: "non_sensitive" as CouncilSensitivityLabel,
        },
        {
          label: "unknown",
          detail: "Bloquea Gemini hasta clasificar sensibilidad.",
          value: "unknown" as CouncilSensitivityLabel,
        },
      ],
      {
        placeHolder: "Etiqueta de sensibilidad",
        ignoreFocusOut: true,
      },
    );

    if (!selected) {
      return;
    }

    await executeLocalCommand("WIS: Council Open Room", async () =>
      runtime.councilRoomService.openSession({
        question,
        sensitivityLabel: selected.value,
      }),
    );
  });

  const runRoundDisposable = vscode.commands.registerCommand(COMMAND_COUNCIL_RUN_ROUND, async () => {
    await executeLocalCommand("WIS: Council Run Round", async () => runtime.councilRoomService.runRound());
  });

  const synthesizeDisposable = vscode.commands.registerCommand(COMMAND_COUNCIL_SYNTHESIZE_PACKET, async () => {
    await executeLocalCommand("WIS: Council Synthesize Packet", async () =>
      runtime.councilRoomService.synthesizePacket(),
    );
  });

  const configureGeminiDisposable = vscode.commands.registerCommand(COMMAND_COUNCIL_CONFIGURE_GEMINI_KEY, async () => {
    const key = await vscode.window.showInputBox({
      placeHolder: "GEMINI_API_KEY",
      prompt: "Guardar nueva key de Gemini en SecretStorage. Deja vacío para eliminarla.",
      password: true,
      ignoreFocusOut: true,
    });

    if (key === undefined) {
      return;
    }

    await runtime.councilRoomService.configureGeminiKey(key);
    if (!key.trim()) {
      runtime.outputChannel.appendLine("[WIS][COUNCIL][GEMINI] SecretStorage key cleared.");
      await vscode.window.showInformationMessage("Gemini key eliminada de SecretStorage.");
      return;
    }

    runtime.outputChannel.appendLine("[WIS][COUNCIL][GEMINI] SecretStorage key updated.");
    await vscode.window.showInformationMessage("Gemini key guardada en SecretStorage.");
  });

  void context;
  return [openRoomDisposable, runRoundDisposable, synthesizeDisposable, configureGeminiDisposable];
}
