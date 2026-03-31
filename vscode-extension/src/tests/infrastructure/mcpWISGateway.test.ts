import test from "node:test";
import assert from "node:assert/strict";
import { McpWISGateway, type McpClientFactory } from "../../infrastructure/wis/mcpWISGateway";

const baseInput = {
  endpoint: "http://localhost:8002/mcp",
  runtime_mode: "mcp" as const,
  timeout_ms: 5000,
  consumer: "vscode_extension",
  session_key: "session-mcp",
};

class FakeMcpClient {
  public constructor(
    private readonly handlers: {
      connect?: () => Promise<void>;
      listToolNames?: (timeoutMs: number) => Promise<string[]>;
      callTool?: (name: string) => Promise<unknown>;
      close?: () => Promise<void>;
    },
  ) {}

  public async connect(): Promise<void> {
    if (this.handlers.connect) {
      await this.handlers.connect();
    }
  }

  public async listToolNames(timeoutMs: number): Promise<string[]> {
    if (this.handlers.listToolNames) {
      return this.handlers.listToolNames(timeoutMs);
    }
    return [
      "get_active_task",
      "get_context_snapshot",
      "get_validation_status",
      "get_approved_decisions",
      "get_recent_errors",
    ];
  }

  public async callTool(name: string, _args: Record<string, unknown>, _timeoutMs: number): Promise<unknown> {
    if (this.handlers.callTool) {
      return this.handlers.callTool(name);
    }
    return {
      structuredContent: {
        status: "ok",
        scope: {},
        resolution_metadata: {},
        task: {},
        snapshot: {},
        metadata: {},
        consumer_context: {},
        current_status: "passed",
        decisions: [],
        total: 0,
        errors: [],
      },
    };
  }

  public async close(): Promise<void> {
    if (this.handlers.close) {
      await this.handlers.close();
    }
  }
}

test("McpWISGateway marca schema_error cuando payload MCP viene malformado", async () => {
  const factory: McpClientFactory = () =>
    new FakeMcpClient({
      callTool: async (name) => {
        if (name === "get_active_task") {
          return { structuredContent: { status: "ok" } };
        }
        return {
          structuredContent: {
            status: "ok",
            scope: {},
            resolution_metadata: {},
            snapshot: {},
            metadata: {},
            consumer_context: {},
            current_status: "passed",
            decisions: [],
            total: 0,
            errors: [],
            task: {},
          },
        };
      },
    });

  const gateway = new McpWISGateway(factory);
  const bundle = await gateway.loadOperationalBundle(baseInput);

  assert.equal(bundle.tool_results.get_active_task.kind, "schema_error");
  assert.equal(bundle.status, "partial");
});

test("McpWISGateway clasifica unavailable cuando connect falla por red", async () => {
  const factory: McpClientFactory = () =>
    new FakeMcpClient({
      connect: async () => {
        throw new Error("ECONNREFUSED 127.0.0.1:8002");
      },
    });

  const gateway = new McpWISGateway(factory);
  const bundle = await gateway.loadOperationalBundle(baseInput);

  assert.equal(bundle.status, "failure");
  assert.equal(bundle.tool_results.get_active_task.kind, "unavailable");
  assert.equal(bundle.tool_results.get_context_snapshot.kind, "unavailable");
});
