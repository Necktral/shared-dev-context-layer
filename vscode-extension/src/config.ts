import * as vscode from "vscode";
import { DEFAULT_MCP_ENDPOINT } from "./constants";

export function getMcpEndpoint(): string {
  return (
    vscode.workspace.getConfiguration().get<string>("wisContextSync.mcpEndpoint") ??
    DEFAULT_MCP_ENDPOINT
  );
}
