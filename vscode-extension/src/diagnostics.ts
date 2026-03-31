import type * as vscode from "vscode";
import type { OperationalContextEnvelope } from "./domain/operationalContext";
import { formatLoadEvent, formatOperationalEnvelopeEnvelopeLine } from "./diagnostics/evidenceFormatter";
import type { LoadEvent } from "./diagnostics/loadEvents";

export interface DiagnosticsSnapshot {
  consumer: string;
  session_key: string;
  session_created_at: string;
  session_state: "created" | "reused" | "reset";
  endpoint: string;
  workspace_root: string | null;
  repo_root: string | null;
  branch: string | null;
  active_file: string | null;
  inspector_status: "ok" | "no_workspace" | "no_repo" | "error" | "not_checked";
  inspector_error: string | null;
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
        `consumer=${snapshot.consumer} session_key=${snapshot.session_key} endpoint=${snapshot.endpoint} inspector_status=${snapshot.inspector_status}`,
      );
    }
    this.output.appendLine("");
  }

  public reportLoadEvent(event: LoadEvent): void {
    this.output.appendLine(formatLoadEvent(event));
  }

  public reportOperationalEnvelope(envelope: OperationalContextEnvelope, detailed: boolean): void {
    this.output.appendLine(formatOperationalEnvelopeEnvelopeLine(envelope));
    if (detailed) {
      this.output.appendLine(JSON.stringify(envelope, null, 2));
    }
    this.output.appendLine("");
  }
}
