import type { AuthRuntimeContext } from "../infrastructure/wis/wisGateway";
import { McpContextPlaneClient, type ContextPlaneCallInput, type ContextPlaneResponse } from "../infrastructure/wis/mcpContextPlaneClient";

export interface ContextCommandExecutionInput {
  endpoint: string;
  timeoutMs: number;
  auth?: AuthRuntimeContext;
  consumer: string;
  sessionKey: string;
}

export class ContextCommandService {
  constructor(private readonly client: McpContextPlaneClient = new McpContextPlaneClient()) {}

  public async searchContext(input: ContextCommandExecutionInput, query: string): Promise<ContextPlaneResponse> {
    return this.call(input, "search_context", { query, limit: 20, offset: 0 });
  }

  public async upsertContextItem(
    input: ContextCommandExecutionInput,
    params: {
      itemKey: string;
      itemType: string;
      title: string;
      dryRun: boolean;
      content?: Record<string, unknown>;
      labels?: string[];
    },
  ): Promise<ContextPlaneResponse> {
    return this.call(input, "upsert_context_item", {
      item_key: params.itemKey,
      item_type: params.itemType,
      title: params.title,
      content: params.content ?? {},
      labels: params.labels ?? [],
      dry_run: params.dryRun,
      ...(params.dryRun ? {} : { idempotency_key: McpContextPlaneClient.nextIdempotencyKey("upsert-context-item") }),
    });
  }

  public async appendContextEvent(
    input: ContextCommandExecutionInput,
    params: {
      eventType: string;
      summary: string;
      dryRun: boolean;
      severity?: string;
      source?: string;
    },
  ): Promise<ContextPlaneResponse> {
    return this.call(input, "append_context_event", {
      event_type: params.eventType,
      summary: params.summary,
      severity: params.severity ?? "info",
      source: params.source ?? "vscode_extension",
      dry_run: params.dryRun,
      ...(params.dryRun ? {} : { idempotency_key: McpContextPlaneClient.nextIdempotencyKey("append-context-event") }),
    });
  }

  public async linkContextEntities(
    input: ContextCommandExecutionInput,
    params: {
      sourceItemId: string;
      targetItemId: string;
      relation: string;
      dryRun: boolean;
    },
  ): Promise<ContextPlaneResponse> {
    return this.call(input, "link_context_entities", {
      source_item_id: params.sourceItemId,
      target_item_id: params.targetItemId,
      relation: params.relation,
      dry_run: params.dryRun,
      ...(params.dryRun ? {} : { idempotency_key: McpContextPlaneClient.nextIdempotencyKey("link-context-entities") }),
    });
  }

  public async setContextLabels(
    input: ContextCommandExecutionInput,
    params: {
      contextItemId: string;
      labels: string[];
      dryRun: boolean;
    },
  ): Promise<ContextPlaneResponse> {
    return this.call(input, "set_context_labels", {
      context_item_id: params.contextItemId,
      labels: params.labels,
      dry_run: params.dryRun,
      ...(params.dryRun ? {} : { idempotency_key: McpContextPlaneClient.nextIdempotencyKey("set-context-labels") }),
    });
  }

  public async archiveContextItem(
    input: ContextCommandExecutionInput,
    params: {
      contextItemId: string;
      dryRun: boolean;
    },
  ): Promise<ContextPlaneResponse> {
    return this.call(input, "archive_context_item", {
      context_item_id: params.contextItemId,
      dry_run: params.dryRun,
      ...(params.dryRun ? {} : { idempotency_key: McpContextPlaneClient.nextIdempotencyKey("archive-context-item") }),
    });
  }

  public async applySyncBatch(
    input: ContextCommandExecutionInput,
    params: {
      operations: Array<Record<string, unknown>>;
      dryRun: boolean;
    },
  ): Promise<ContextPlaneResponse> {
    return this.call(input, "apply_sync_batch", {
      operations: params.operations,
      dry_run: params.dryRun,
      ...(params.dryRun ? {} : { idempotency_key: McpContextPlaneClient.nextIdempotencyKey("apply-sync-batch") }),
    });
  }

  private async call(
    input: ContextCommandExecutionInput,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<ContextPlaneResponse> {
    const callInput: ContextPlaneCallInput = {
      endpoint: input.endpoint,
      timeoutMs: input.timeoutMs,
      auth: input.auth,
      consumer: input.consumer,
      sessionKey: input.sessionKey,
    };
    return this.client.callTool(callInput, tool, args);
  }
}

