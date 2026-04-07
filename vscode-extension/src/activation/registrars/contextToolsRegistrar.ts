import * as vscode from "vscode";
import {
  COMMAND_APPEND_CONTEXT_EVENT,
  COMMAND_APPLY_SYNC_BATCH,
  COMMAND_ARCHIVE_CONTEXT_ITEM,
  COMMAND_LINK_CONTEXT_ENTITIES,
  COMMAND_SEARCH_CONTEXT,
  COMMAND_SET_CONTEXT_LABELS,
  COMMAND_UPSERT_CONTEXT_ITEM,
} from "../../constants";
import { createContextToolExecutor } from "../commands/commandExecutors";
import { labelsFromInput, promptDryRunMode, promptRequired } from "../commands/commandUiUtils";
import type { ExtensionRuntimeContext } from "../runtimeContext";

export function registerContextToolCommands(runtime: ExtensionRuntimeContext): vscode.Disposable[] {
  const executeContextTool = createContextToolExecutor(runtime);

  const searchContextDisposable = vscode.commands.registerCommand(COMMAND_SEARCH_CONTEXT, async () => {
    const query = await vscode.window.showInputBox({
      placeHolder: "Texto de búsqueda",
      prompt: "Buscar en contexto",
      value: "",
      ignoreFocusOut: true,
    });
    if (query === undefined) {
      return;
    }

    await executeContextTool("WIS: Search Context", (input) => runtime.contextCommandService.searchContext(input, query));
  });

  const upsertContextItemDisposable = vscode.commands.registerCommand(COMMAND_UPSERT_CONTEXT_ITEM, async () => {
    const itemKey = await promptRequired("context.item.key", "Identificador lógico del item");
    if (!itemKey) {
      return;
    }
    const title = await promptRequired("Título", "Título del item");
    if (!title) {
      return;
    }
    const itemType = await promptRequired("note|decision|risk", "Tipo del item", "note");
    if (!itemType) {
      return;
    }
    const labelsRaw = await vscode.window.showInputBox({
      placeHolder: "labels separadas por coma (opcional)",
      prompt: "Etiquetas del item",
      value: "",
      ignoreFocusOut: true,
    });
    if (labelsRaw === undefined) {
      return;
    }
    const dryRun = await promptDryRunMode();
    if (dryRun === undefined) {
      return;
    }

    await executeContextTool("WIS: Upsert Context Item", (input) =>
      runtime.contextCommandService.upsertContextItem(input, {
        itemKey: itemKey.trim(),
        itemType: itemType.trim(),
        title: title.trim(),
        labels: labelsFromInput(labelsRaw),
        dryRun,
      }),
    );
  });

  const appendContextEventDisposable = vscode.commands.registerCommand(COMMAND_APPEND_CONTEXT_EVENT, async () => {
    const summary = await promptRequired("Resumen del evento", "Describe el evento");
    if (!summary) {
      return;
    }
    const eventType = await promptRequired("event_type", "Tipo de evento", "info");
    if (!eventType) {
      return;
    }
    const dryRun = await promptDryRunMode();
    if (dryRun === undefined) {
      return;
    }

    await executeContextTool("WIS: Append Context Event", (input) =>
      runtime.contextCommandService.appendContextEvent(input, {
        summary: summary.trim(),
        eventType: eventType.trim(),
        dryRun,
      }),
    );
  });

  const linkContextEntitiesDisposable = vscode.commands.registerCommand(COMMAND_LINK_CONTEXT_ENTITIES, async () => {
    const sourceItemId = await promptRequired("source UUID", "ID del item origen");
    if (!sourceItemId) {
      return;
    }
    const targetItemId = await promptRequired("target UUID", "ID del item destino");
    if (!targetItemId) {
      return;
    }
    const relation = await promptRequired("depends_on|blocks|relates_to", "Relación", "depends_on");
    if (!relation) {
      return;
    }
    const dryRun = await promptDryRunMode();
    if (dryRun === undefined) {
      return;
    }

    await executeContextTool("WIS: Link Context Entities", (input) =>
      runtime.contextCommandService.linkContextEntities(input, {
        sourceItemId: sourceItemId.trim(),
        targetItemId: targetItemId.trim(),
        relation: relation.trim(),
        dryRun,
      }),
    );
  });

  const setContextLabelsDisposable = vscode.commands.registerCommand(COMMAND_SET_CONTEXT_LABELS, async () => {
    const contextItemId = await promptRequired("context_item_id UUID", "ID del item");
    if (!contextItemId) {
      return;
    }
    const labelsRaw = await promptRequired("label1,label2", "Labels separadas por coma");
    if (!labelsRaw) {
      return;
    }
    const dryRun = await promptDryRunMode();
    if (dryRun === undefined) {
      return;
    }

    await executeContextTool("WIS: Set Context Labels", (input) =>
      runtime.contextCommandService.setContextLabels(input, {
        contextItemId: contextItemId.trim(),
        labels: labelsFromInput(labelsRaw),
        dryRun,
      }),
    );
  });

  const archiveContextItemDisposable = vscode.commands.registerCommand(COMMAND_ARCHIVE_CONTEXT_ITEM, async () => {
    const contextItemId = await promptRequired("context_item_id UUID", "ID del item a archivar");
    if (!contextItemId) {
      return;
    }
    const dryRun = await promptDryRunMode();
    if (dryRun === undefined) {
      return;
    }

    await executeContextTool("WIS: Archive Context Item", (input) =>
      runtime.contextCommandService.archiveContextItem(input, {
        contextItemId: contextItemId.trim(),
        dryRun,
      }),
    );
  });

  const applySyncBatchDisposable = vscode.commands.registerCommand(COMMAND_APPLY_SYNC_BATCH, async () => {
    const operationsRaw = await promptRequired(
      'JSON ops, ej: [{"operation":"upsert_context_item"}]',
      "Operaciones batch en JSON",
      '[{"operation":"upsert_context_item"}]',
    );
    if (!operationsRaw) {
      return;
    }

    let operations: Array<Record<string, unknown>>;
    try {
      const parsed = JSON.parse(operationsRaw);
      if (!Array.isArray(parsed)) {
        throw new Error("operations debe ser array");
      }
      operations = parsed as Array<Record<string, unknown>>;
    } catch (error) {
      await vscode.window.showErrorMessage(
        `JSON inválido para operations: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    const dryRun = await promptDryRunMode();
    if (dryRun === undefined) {
      return;
    }

    await executeContextTool("WIS: Apply Sync Batch", (input) =>
      runtime.contextCommandService.applySyncBatch(input, {
        operations,
        dryRun,
      }),
    );
  });

  return [
    searchContextDisposable,
    upsertContextItemDisposable,
    appendContextEventDisposable,
    linkContextEntitiesDisposable,
    setContextLabelsDisposable,
    archiveContextItemDisposable,
    applySyncBatchDisposable,
  ];
}
