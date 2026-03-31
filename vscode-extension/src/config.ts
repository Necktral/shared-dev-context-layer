import * as vscode from "vscode";
import { DEFAULT_DIAGNOSTIC_MODE, DEFAULT_MCP_ENDPOINT } from "./constants";

export function getMcpEndpoint(): string {
  return (
    vscode.workspace.getConfiguration().get<string>("wisContextSync.mcpEndpoint") ??
    DEFAULT_MCP_ENDPOINT
  );
}

export function isDiagnosticModeEnabled(): boolean {
  return (
    vscode.workspace.getConfiguration().get<boolean>("wisContextSync.diagnosticMode") ??
    DEFAULT_DIAGNOSTIC_MODE
  );
}
