import * as vscode from "vscode";

export interface DiagnosticsSnapshot {
  consumer: string;
  session_key: string;
  session_created_at: string;
  session_state: "created" | "reused" | "reset";
  endpoint: string;
  initialized: boolean;
  event: string;
  timestamp: string;
}

export class DiagnosticsReporter {
  constructor(private readonly output: vscode.OutputChannel) {}

  public report(snapshot: DiagnosticsSnapshot, detailed: boolean): void {
    this.output.appendLine(`[WIS] ${snapshot.event}`);
    if (detailed) {
      this.output.appendLine(JSON.stringify(snapshot, null, 2));
    } else {
      this.output.appendLine(
        `consumer=${snapshot.consumer} session_key=${snapshot.session_key} endpoint=${snapshot.endpoint}`,
      );
    }
    this.output.appendLine("");
  }
}
