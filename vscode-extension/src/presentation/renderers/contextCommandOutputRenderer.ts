import * as vscode from "vscode";
import type { ContextPlaneResponse } from "../../infrastructure/wis/mcpContextPlaneClient";

export class ContextCommandOutputRenderer {
  constructor(private readonly output: vscode.OutputChannel) {}

  public render(tool: string, response: ContextPlaneResponse): void {
    this.output.appendLine("");
    this.output.appendLine(`== Context Command :: ${tool} ==`);
    this.output.appendLine(`ok: ${response.ok ? "true" : "false"}`);
    this.output.appendLine(`status: ${response.status ?? "unknown"}`);
    this.output.appendLine(`http_status: ${response.httpStatus ?? "n/a"}`);
    this.output.appendLine(`message: ${response.message}`);
    if (response.requiredScopes.length > 0) {
      this.output.appendLine(`required_scopes: ${response.requiredScopes.join(", ")}`);
    }
    if (response.payload) {
      this.output.appendLine("payload:");
      this.output.appendLine(JSON.stringify(response.payload, null, 2));
    }
  }
}

