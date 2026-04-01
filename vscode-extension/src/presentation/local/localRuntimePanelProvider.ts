import * as vscode from "vscode";
import type { ProjectRuntimeSnapshot } from "../../local/types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((item) => String(item)).join(", ") : "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  const asString = String(value);
  return asString.length > 0 ? asString : "-";
}

export class LocalRuntimePanelProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;

  private snapshot: ProjectRuntimeSnapshot;

  constructor(initialSnapshot: ProjectRuntimeSnapshot) {
    this.snapshot = initialSnapshot;
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: false,
    };
    this.render();
  }

  public update(snapshot: ProjectRuntimeSnapshot): void {
    this.snapshot = snapshot;
    this.render();
  }

  private render(): void {
    if (!this.view) {
      return;
    }

    const lastResult = this.snapshot.last_result
      ? JSON.stringify(this.snapshot.last_result, null, 2)
      : "Sin resultados todavía.";

    const errors = this.snapshot.errors.length > 0 ? this.snapshot.errors.join("\n") : "Sin errores.";

    const html = `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <style>
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        padding: 10px;
      }
      section {
        margin-bottom: 12px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        padding: 8px;
      }
      h2 {
        margin: 0 0 6px 0;
        font-size: 12px;
        text-transform: uppercase;
      }
      pre {
        white-space: pre-wrap;
        margin: 0;
      }
      .muted {
        opacity: 0.8;
      }
    </style>
  </head>
  <body>
    <section>
      <h2>Project</h2>
      <div>Profile: <strong>${escapeHtml(renderValue(this.snapshot.operation_profile))}</strong></div>
      <div>Workspace: ${escapeHtml(renderValue(this.snapshot.workspace_root))}</div>
      <div>Repo: ${escapeHtml(renderValue(this.snapshot.repo_root))}</div>
      <div>Branch: ${escapeHtml(renderValue(this.snapshot.branch))}</div>
      <div>Active File: ${escapeHtml(renderValue(this.snapshot.active_file))}</div>
    </section>

    <section>
      <h2>Runtime</h2>
      <div>State: <strong>${escapeHtml(renderValue(this.snapshot.runtime_state))}</strong></div>
      <div>Last Action: ${escapeHtml(renderValue(this.snapshot.last_action))}</div>
      <div class="muted">Updated: ${escapeHtml(renderValue(this.snapshot.updated_at))}</div>
    </section>

    <section>
      <h2>Actions</h2>
      <div>WIS: Local Index</div>
      <div>WIS: Local Prepare Task</div>
      <div>WIS: Local Run Codex</div>
      <div>WIS: Local Refresh</div>
    </section>

    <section>
      <h2>Last Result</h2>
      <pre>${escapeHtml(lastResult)}</pre>
    </section>

    <section>
      <h2>Errors</h2>
      <pre>${escapeHtml(errors)}</pre>
    </section>
  </body>
</html>`;

    this.view.webview.html = html;
  }
}
