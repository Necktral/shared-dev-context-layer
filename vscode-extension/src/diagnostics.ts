import * as vscode from "vscode";

export interface DiagnosticsSnapshot {
  consumer: string;
  sessionKey: string;
  endpoint: string;
  initialized: boolean;
  event: string;
  timestamp: string;
}

export class DiagnosticsReporter {
  constructor(private readonly output: vscode.OutputChannel) {}

  public report(snapshot: DiagnosticsSnapshot): void {
    this.output.appendLine(`[WIS] ${snapshot.event}`);
    this.output.appendLine(JSON.stringify(snapshot, null, 2));
    this.output.appendLine("");
  }
}
