import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ToolResult, WISBundleResult, WISToolName } from "../../domain/operationalContext";
import { aggregateBundleStatus, extractStructuredPayload, failureToolResult, normalizeToolPayload } from "./normalizers";
import { scopeArguments, WIS_TOOLS } from "./toolContracts";
import type { WISGateway, WISLoadInput } from "./wisGateway";

interface McpClient {
  connect(): Promise<void>;
  listToolNames(timeoutMs: number): Promise<string[]>;
  callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
  close(): Promise<void>;
}

class SdkMcpClient implements McpClient {
  private readonly client: Client;
  private readonly transport: StreamableHTTPClientTransport;

  constructor(endpoint: string) {
    this.client = new Client({
      name: "wis-context-sync-vscode",
      version: "0.0.1",
    });
    this.transport = new StreamableHTTPClientTransport(new URL(endpoint));
  }

  public async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  public async listToolNames(timeoutMs: number): Promise<string[]> {
    const listed = await this.client.listTools({}, { timeout: timeoutMs });
    return listed.tools.map((tool) => tool.name);
  }

  public async callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    return this.client.callTool(
      {
        name,
        arguments: args,
      },
      undefined,
      { timeout: timeoutMs },
    );
  }

  public async close(): Promise<void> {
    await this.client.close();
  }
}

function classifyTransportFailure(error: unknown): {
  kind: "transport_error" | "unavailable" | "schema_error";
  message: string;
  evidenceHint: string;
} {
  if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
    return {
      kind: "transport_error",
      message: `Timeout MCP: ${error.message}`,
      evidenceHint: "Ajustar wisContextSync.requestTimeoutMs o validar latencia del endpoint.",
    };
  }

  if (error instanceof StreamableHTTPError) {
    if (typeof error.code === "number" && (error.code === 404 || error.code === 405 || error.code >= 500)) {
      return {
        kind: "unavailable",
        message: `Endpoint MCP no disponible (HTTP ${error.code}).`,
        evidenceHint: "Verificar endpoint /mcp, túnel y estado del servicio MCP.",
      };
    }

    return {
      kind: "transport_error",
      message: `Fallo Streamable HTTP: ${error.message}`,
      evidenceHint: "Revisar handshake MCP y headers del transporte streamable-http.",
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|network|Failed to fetch/i.test(message)) {
    return {
      kind: "unavailable",
      message: `No se pudo alcanzar el endpoint MCP: ${message}`,
      evidenceHint: "Validar conectividad local/remota y URL configurada.",
    };
  }

  return {
    kind: "transport_error",
    message: `Error MCP no clasificado: ${message}`,
    evidenceHint: "Inspeccionar output channel y logs de MCP para evidencia detallada.",
  };
}

export type McpClientFactory = (endpoint: string) => McpClient;

export class McpWISGateway implements WISGateway {
  constructor(private readonly clientFactory: McpClientFactory = (endpoint) => new SdkMcpClient(endpoint)) {}

  public async getActiveTask(input: WISLoadInput): Promise<ToolResult> {
    return this.loadSingleTool("get_active_task", input);
  }

  public async getContextSnapshot(input: WISLoadInput): Promise<ToolResult> {
    return this.loadSingleTool("get_context_snapshot", input);
  }

  public async getValidationStatus(input: WISLoadInput): Promise<ToolResult> {
    return this.loadSingleTool("get_validation_status", input);
  }

  public async getApprovedDecisions(input: WISLoadInput): Promise<ToolResult> {
    return this.loadSingleTool("get_approved_decisions", input);
  }

  public async getRecentErrors(input: WISLoadInput): Promise<ToolResult> {
    return this.loadSingleTool("get_recent_errors", input);
  }

  public async loadOperationalBundle(input: WISLoadInput): Promise<WISBundleResult> {
    const toolResults: Record<WISToolName, ToolResult> = {
      get_active_task: failureToolResult("get_active_task", "unavailable", "No ejecutado.", "Bundle aún no iniciado.", null),
      get_context_snapshot: failureToolResult("get_context_snapshot", "unavailable", "No ejecutado.", "Bundle aún no iniciado.", null),
      get_validation_status: failureToolResult("get_validation_status", "unavailable", "No ejecutado.", "Bundle aún no iniciado.", null),
      get_approved_decisions: failureToolResult("get_approved_decisions", "unavailable", "No ejecutado.", "Bundle aún no iniciado.", null),
      get_recent_errors: failureToolResult("get_recent_errors", "unavailable", "No ejecutado.", "Bundle aún no iniciado.", null),
    };

    const client = this.clientFactory(input.endpoint);
    const requestedArgs = scopeArguments({
      consumer: input.consumer,
      session_key: input.session_key,
      scope: input.scope,
    });

    let availableTools: string[] = [];
    const missingTools: string[] = [];

    try {
      await client.connect();
      availableTools = await client.listToolNames(input.timeout_ms);

      for (const tool of WIS_TOOLS) {
        if (!availableTools.includes(tool)) {
          missingTools.push(tool);
          toolResults[tool] = failureToolResult(
            tool,
            "unavailable",
            `Tool MCP no disponible: ${tool}`,
            "La tool no apareció en tools/list.",
            null,
          );
          continue;
        }

        try {
          const response = await client.callTool(tool, requestedArgs, input.timeout_ms);
          const structured = extractStructuredPayload(response);
          toolResults[tool] = normalizeToolPayload(tool, structured);
        } catch (error) {
          const classified = classifyTransportFailure(error);
          toolResults[tool] = failureToolResult(
            tool,
            classified.kind,
            classified.message,
            classified.evidenceHint,
            error,
          );
        }
      }
    } catch (error) {
      const classified = classifyTransportFailure(error);
      for (const tool of WIS_TOOLS) {
        toolResults[tool] = failureToolResult(tool, classified.kind, classified.message, classified.evidenceHint, error);
      }
    } finally {
      await client.close().catch(() => undefined);
    }

    const issues = WIS_TOOLS.flatMap((tool) => toolResults[tool].issues);

    return {
      status: aggregateBundleStatus(toolResults),
      tool_results: toolResults,
      transport_diagnostics: {
        endpoint: input.endpoint,
        runtime_mode: input.runtime_mode,
        timeout_ms: input.timeout_ms,
        fetched_at: new Date().toISOString(),
        available_tools: availableTools,
        missing_tools: missingTools,
      },
      issues,
    };
  }

  private async loadSingleTool(tool: WISToolName, input: WISLoadInput): Promise<ToolResult> {
    const bundle = await this.loadOperationalBundle(input);
    return bundle.tool_results[tool];
  }
}
