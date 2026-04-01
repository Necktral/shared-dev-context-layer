import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { AuthRuntimeContext } from "./wisGateway";

export interface ContextPlaneCallInput {
  endpoint: string;
  timeoutMs: number;
  auth?: AuthRuntimeContext;
  consumer: string;
  sessionKey: string;
}

export interface ContextPlaneResponse {
  ok: boolean;
  tool: string;
  status: string | null;
  payload: Record<string, unknown> | null;
  message: string;
  httpStatus: number | null;
  requiredScopes: string[];
}

function requestInitFromAuth(auth: AuthRuntimeContext | undefined): RequestInit | undefined {
  if (!auth || auth.mode === "none" || !auth.token) {
    return undefined;
  }

  if (auth.mode === "bearer") {
    return {
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    };
  }

  return {
    headers: {
      [auth.header_name]: auth.token,
    },
  };
}

function parseTransportError(error: unknown): { message: string; httpStatus: number | null } {
  if (error instanceof StreamableHTTPError) {
    const code = typeof error.code === "number" ? error.code : null;
    return {
      message: `MCP HTTP error (${code ?? "unknown"}): ${error.message}`,
      httpStatus: code,
    };
  }
  if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
    return {
      message: `Timeout MCP: ${error.message}`,
      httpStatus: null,
    };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    httpStatus: null,
  };
}

export class McpContextPlaneClient {
  public async callTool(
    input: ContextPlaneCallInput,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<ContextPlaneResponse> {
    const requestInit = requestInitFromAuth(input.auth);
    const client = new Client({ name: "wis-context-sync-vscode-write-plane", version: "0.2.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(input.endpoint),
      requestInit ? { requestInit } : undefined,
    );

    try {
      await client.connect(transport);
      const response = await client.callTool(
        {
          name: tool,
          arguments: {
            ...args,
            consumer: input.consumer,
            session_key: input.sessionKey,
          },
        },
        undefined,
        { timeout: input.timeoutMs },
      );
      if (response.isError) {
        return {
          ok: false,
          tool,
          status: "error",
          payload: null,
          message: "Tool MCP retornó isError=true.",
          httpStatus: null,
          requiredScopes: [],
        };
      }
      const structured = response.structuredContent;
      if (!structured || typeof structured !== "object" || Array.isArray(structured)) {
        return {
          ok: false,
          tool,
          status: "schema_error",
          payload: null,
          message: "Respuesta MCP sin structuredContent objeto.",
          httpStatus: null,
          requiredScopes: [],
        };
      }
      const payload = structured as Record<string, unknown>;
      const status = typeof payload.status === "string" ? payload.status : null;
      const requiredScopes = Array.isArray(payload.required_scopes)
        ? payload.required_scopes.map((entry) => String(entry))
        : [];
      const ok = !status || !["forbidden", "unauthorized", "invalid_request", "error"].includes(status);
      return {
        ok,
        tool,
        status,
        payload,
        message: ok ? "ok" : `Tool devolvió estado no exitoso: ${status}`,
        httpStatus: status === "unauthorized" ? 401 : status === "forbidden" ? 403 : null,
        requiredScopes,
      };
    } catch (error) {
      const parsed = parseTransportError(error);
      return {
        ok: false,
        tool,
        status: parsed.httpStatus === 401 ? "unauthorized" : parsed.httpStatus === 403 ? "forbidden" : "transport_error",
        payload: null,
        message: parsed.message,
        httpStatus: parsed.httpStatus,
        requiredScopes: [],
      };
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  public static nextIdempotencyKey(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }
}

