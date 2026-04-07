import * as vscode from "vscode";
import {
  COMMAND_LOCAL_CONFIGURE_DB_PASSWORD,
  COMMAND_LOCAL_DOCTOR,
  COMMAND_LOCAL_INDEX,
  COMMAND_LOCAL_PREPARE_TASK,
  COMMAND_LOCAL_REFRESH,
  COMMAND_LOCAL_RUN_CODEX,
  LOCAL_DB_PASSWORD_STORAGE_KEY,
} from "../../constants";
import { createLocalCommandExecutor } from "../commands/commandExecutors";
import { promptRequired } from "../commands/commandUiUtils";
import type { ExtensionRuntimeContext } from "../runtimeContext";

export function registerLocalRuntimeCommands(
  context: vscode.ExtensionContext,
  runtime: ExtensionRuntimeContext,
): vscode.Disposable[] {
  const executeLocalCommand = createLocalCommandExecutor(runtime);

  const localIndexDisposable = vscode.commands.registerCommand(COMMAND_LOCAL_INDEX, async () => {
    await executeLocalCommand("WIS: Local Index", async () => runtime.localCommandService.localIndex());
  });

  const localPrepareTaskDisposable = vscode.commands.registerCommand(COMMAND_LOCAL_PREPARE_TASK, async () => {
    const intent = await promptRequired("Objetivo técnico", "Describe la tarea que quieres preparar para Codex");
    if (!intent) {
      return;
    }
    await executeLocalCommand("WIS: Local Prepare Task", async () => runtime.localCommandService.localPrepareTask(intent));
  });

  const localRunCodexDisposable = vscode.commands.registerCommand(COMMAND_LOCAL_RUN_CODEX, async () => {
    let cancelled = false;
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "WIS: Local Run Codex",
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: "Ejecutando Codex CLI..." });
        const controller = new AbortController();
        token.onCancellationRequested(() => {
          cancelled = true;
          controller.abort();
        });
        return runtime.localCommandService.localRunCodex({ abortSignal: controller.signal });
      },
    );

    runtime.localOutputRenderer.render(result, runtime.localStore.getSnapshot());
    runtime.outputChannel.show(true);

    if (!result.ok) {
      if (cancelled || result.details?.cancelled === true) {
        await vscode.window.showWarningMessage("WIS: Local Run Codex cancelado.");
        return;
      }
      if (result.status === "blocked") {
        await vscode.window.showWarningMessage(result.message);
        return;
      }
      await vscode.window.showErrorMessage(`WIS: Local Run Codex falló: ${result.message}`);
      return;
    }

    const reviewDecision = typeof result.details?.review_decision === "string" ? result.details.review_decision : null;
    const nextActionPlan = typeof result.details?.next_action_plan === "string" ? result.details.next_action_plan : null;
    if (reviewDecision === "accept_with_warnings" || reviewDecision === "needs_manual_review") {
      await vscode.window.showWarningMessage(
        `WIS: Local Run Codex completado con revisión ${reviewDecision}. ${nextActionPlan ?? ""}`.trim(),
      );
      return;
    }
    if (reviewDecision === "retry_recommended" || reviewDecision === "blocked" || reviewDecision === "reject") {
      await vscode.window.showWarningMessage(
        `WIS: Local Run Codex requiere acción (${reviewDecision}). ${nextActionPlan ?? ""}`.trim(),
      );
      return;
    }
    await vscode.window.showInformationMessage("WIS: Local Run Codex completado.");
  });

  const localRefreshDisposable = vscode.commands.registerCommand(COMMAND_LOCAL_REFRESH, async () => {
    await executeLocalCommand("WIS: Local Refresh", async () => runtime.localCommandService.localRefresh());
  });

  const localDoctorDisposable = vscode.commands.registerCommand(COMMAND_LOCAL_DOCTOR, async () => {
    const report = await runtime.doctorService.run();
    runtime.outputChannel.appendLine("[WIS][LOCAL][DOCTOR] report");
    runtime.outputChannel.appendLine(JSON.stringify(report, null, 2));
    runtime.outputChannel.show(true);

    if (report.overall === "fail") {
      await vscode.window.showErrorMessage("WIS: Local Doctor detectó fallos críticos. Revisa output channel.");
      return;
    }
    if (report.overall === "warn") {
      await vscode.window.showWarningMessage("WIS: Local Doctor completó con advertencias.");
      return;
    }
    await vscode.window.showInformationMessage("WIS: Local Doctor completado sin hallazgos críticos.");
  });

  const localConfigureDbPasswordDisposable = vscode.commands.registerCommand(COMMAND_LOCAL_CONFIGURE_DB_PASSWORD, async () => {
    const password = await vscode.window.showInputBox({
      placeHolder: "Password PostgreSQL",
      prompt: "Guardar password de wisContextSync.localDb en SecretStorage.",
      password: true,
      ignoreFocusOut: true,
    });

    if (password === undefined) {
      return;
    }

    if (!password.trim()) {
      await context.secrets.delete(LOCAL_DB_PASSWORD_STORAGE_KEY);
      runtime.outputChannel.appendLine("[WIS][LOCAL][DB] SecretStorage password cleared.");
      await vscode.window.showInformationMessage("Password de localDb eliminado de SecretStorage.");
      return;
    }

    await context.secrets.store(LOCAL_DB_PASSWORD_STORAGE_KEY, password);
    runtime.outputChannel.appendLine("[WIS][LOCAL][DB] SecretStorage password updated.");
    await vscode.window.showInformationMessage("Password de localDb guardado en SecretStorage.");
  });

  return [
    localIndexDisposable,
    localPrepareTaskDisposable,
    localRunCodexDisposable,
    localRefreshDisposable,
    localDoctorDisposable,
    localConfigureDbPasswordDisposable,
  ];
}
