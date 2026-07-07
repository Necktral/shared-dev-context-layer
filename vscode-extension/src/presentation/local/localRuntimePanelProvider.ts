import * as vscode from "vscode";
import type { CouncilRoomTab, CouncilSensitivityLabel, ProjectRuntimeSnapshot } from "../../local/types";

export interface LocalRuntimePanelActions {
  openCouncil(input: { question: string; sensitivityLabel: CouncilSensitivityLabel }): Promise<void>;
  runCouncilRound(): Promise<void>;
  synthesizeCouncilPacket(): Promise<void>;
  switchTab(tab: CouncilRoomTab): void;
}

type CouncilPanelMessage =
  | { type: "tab.switch"; tab: CouncilRoomTab }
  | { type: "council.open"; question: string; sensitivityLabel: CouncilSensitivityLabel }
  | { type: "council.runRound" }
  | { type: "council.synthesize" };

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

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeTab(value: unknown): CouncilRoomTab | null {
  return value === "runtime" || value === "council" ? value : null;
}

function normalizeSensitivity(value: unknown): CouncilSensitivityLabel | null {
  return value === "unknown" || value === "sensitive" || value === "non_sensitive" ? value : null;
}

export class LocalRuntimePanelProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;

  private messageDisposable: vscode.Disposable | null = null;

  private snapshot: ProjectRuntimeSnapshot;

  private readonly actions?: LocalRuntimePanelActions;

  constructor(initialSnapshot: ProjectRuntimeSnapshot, actions?: LocalRuntimePanelActions) {
    this.snapshot = initialSnapshot;
    this.actions = actions;
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };
    this.messageDisposable?.dispose();
    this.messageDisposable = view.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message);
    });
    this.render();
  }

  public update(snapshot: ProjectRuntimeSnapshot): void {
    this.snapshot = snapshot;
    this.render();
  }

  private async handleMessage(message: unknown): Promise<void> {
    const parsed = this.parseMessage(message);
    if (!parsed) {
      return;
    }

    if (parsed.type === "tab.switch") {
      this.actions?.switchTab(parsed.tab);
      return;
    }
    if (parsed.type === "council.open") {
      await this.actions?.openCouncil({
        question: parsed.question,
        sensitivityLabel: parsed.sensitivityLabel,
      });
      return;
    }
    if (parsed.type === "council.runRound") {
      await this.actions?.runCouncilRound();
      return;
    }
    await this.actions?.synthesizeCouncilPacket();
  }

  private parseMessage(message: unknown): CouncilPanelMessage | null {
    if (!isRecord(message) || typeof message.type !== "string") {
      return null;
    }
    if (message.type === "tab.switch") {
      const tab = normalizeTab(message.tab);
      return tab ? { type: "tab.switch", tab } : null;
    }
    if (message.type === "council.open") {
      const sensitivityLabel = normalizeSensitivity(message.sensitivityLabel);
      if (typeof message.question !== "string" || !sensitivityLabel) {
        return null;
      }
      return {
        type: "council.open",
        question: message.question.slice(0, 20000),
        sensitivityLabel,
      };
    }
    if (message.type === "council.runRound") {
      return { type: "council.runRound" };
    }
    if (message.type === "council.synthesize") {
      return { type: "council.synthesize" };
    }
    return null;
  }

  private render(): void {
    if (!this.view) {
      return;
    }

    const nonce = createNonce();
    const lastResult = this.snapshot.last_result
      ? JSON.stringify(this.snapshot.last_result, null, 2)
      : "Sin resultados todavía.";

    const errors = this.snapshot.errors.length > 0 ? this.snapshot.errors.join("\n") : "Sin errores.";
    const lastDetails = this.snapshot.last_result?.details;
    const reviewDecision =
      lastDetails && typeof lastDetails.review_decision === "string" ? lastDetails.review_decision : "Sin review";
    const reviewSummary =
      lastDetails && typeof lastDetails.review_summary === "string" ? lastDetails.review_summary : "Sin resumen.";
    const nextAction =
      lastDetails && typeof lastDetails.next_action_plan === "string"
        ? lastDetails.next_action_plan
        : "Sin acción sugerida.";
    const reviewRisks =
      lastDetails && Array.isArray(lastDetails.review_risks)
        ? lastDetails.review_risks.filter((entry): entry is string => typeof entry === "string").join("\n")
        : "Sin riesgos reportados.";
    const changedFilesFocus =
      lastDetails && Array.isArray(lastDetails.changed_files_focus)
        ? lastDetails.changed_files_focus.filter((entry): entry is string => typeof entry === "string").join(", ")
        : "Sin foco de archivos.";

    const council = this.snapshot.council;
    const positionsHtml =
      council.positions.length > 0
        ? council.positions
            .map(
              (position) => `
                <article class="message ${escapeHtml(position.status)}">
                  <div class="message-heading">
                    <strong>${escapeHtml(position.role)}</strong>
                    <span>${escapeHtml(position.status)} · ${escapeHtml(position.stance)} · ${escapeHtml(position.confidence)}</span>
                  </div>
                  <div>${escapeHtml(position.claim)}</div>
                  <p>${escapeHtml(position.rationale)}</p>
                  <pre>${escapeHtml(position.risks.length > 0 ? position.risks.join("\n") : "Sin riesgos.")}</pre>
                </article>`,
            )
            .join("")
        : `<p class="muted">Sin posiciones todavía. Abre consejo y ejecuta una ronda.</p>`;
    const packetHtml = council.packet
      ? `
        <div>Version: <strong>${escapeHtml(council.packet.version)}</strong></div>
        <div>Recommendation: ${escapeHtml(council.packet.recommendation)}</div>
        <pre>${escapeHtml(council.packet.reg_synthesis)}</pre>
        <pre>${escapeHtml(council.packet.objections.length > 0 ? council.packet.objections.join("\n") : "Sin objeciones.")}</pre>`
      : `<p class="muted">Reg todavía no sintetizó packet.</p>`;
    const councilErrors =
      council.errors.length > 0 ? council.errors.join("\n") : "Sin bloqueos activos en Council Room.";
    const eventsHtml =
      council.events.length > 0
        ? council.events
            .slice()
            .reverse()
            .map((event) => `<div>${escapeHtml(event.created_at)} · ${escapeHtml(event.event_type)}</div>`)
            .join("")
        : "Sin eventos de consejo.";
    const activeTab = council.active_tab;

    const html = `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <style>
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        padding: 10px;
      }
      .tabs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-bottom: 10px;
      }
      button, select, textarea {
        font-family: var(--vscode-font-family);
      }
      button {
        border: 1px solid var(--vscode-button-border, transparent);
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        padding: 6px 8px;
        cursor: pointer;
      }
      button.primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      body[data-active-tab="runtime"] #runtime-tab,
      body[data-active-tab="council"] #council-tab {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      .tab-panel {
        display: none;
      }
      body[data-active-tab="runtime"] #runtime-panel,
      body[data-active-tab="council"] #council-panel {
        display: block;
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
      textarea, select {
        width: 100%;
        box-sizing: border-box;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
        padding: 6px;
      }
      textarea {
        min-height: 110px;
        resize: vertical;
      }
      .row {
        display: grid;
        gap: 6px;
        margin-top: 8px;
      }
      .actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
      pre {
        white-space: pre-wrap;
        margin: 0;
      }
      .muted {
        opacity: 0.8;
      }
      .message {
        border-top: 1px solid var(--vscode-panel-border);
        padding: 8px 0;
      }
      .message-heading {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 4px;
      }
      .message-heading span {
        opacity: 0.75;
        text-align: right;
      }
      .blocked, .unavailable {
        color: var(--vscode-editorWarning-foreground);
      }
    </style>
  </head>
  <body data-active-tab="${escapeHtml(activeTab)}">
    <div class="tabs">
      <button id="runtime-tab" data-tab="runtime">Runtime</button>
      <button id="council-tab" data-tab="council">Council Room</button>
    </div>

    <div id="runtime-panel" class="tab-panel">
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
        <div>DB Status: <strong>${escapeHtml(renderValue(this.snapshot.db_status))}</strong></div>
        <div>DB Error: ${escapeHtml(renderValue(this.snapshot.db_error))}</div>
        <div>Last Action: ${escapeHtml(renderValue(this.snapshot.last_action))}</div>
        <div class="muted">Updated: ${escapeHtml(renderValue(this.snapshot.updated_at))}</div>
      </section>

      <section>
        <h2>Actions</h2>
        <div>WIS: Local Index</div>
        <div>WIS: Local Prepare Task</div>
        <div>WIS: Local Run Codex</div>
        <div>WIS: Local Refresh</div>
        <div>WIS: Local Doctor</div>
        <div>WIS: Local Configure DB Password</div>
      </section>

      <section>
        <h2>Last Result</h2>
        <pre>${escapeHtml(lastResult)}</pre>
      </section>

      <section>
        <h2>Post-Run Review</h2>
        <div>Decision: <strong>${escapeHtml(reviewDecision)}</strong></div>
        <div>Summary: ${escapeHtml(reviewSummary)}</div>
        <div>Changed Focus: ${escapeHtml(changedFilesFocus)}</div>
        <div>Next Action: ${escapeHtml(nextAction)}</div>
        <pre>${escapeHtml(reviewRisks)}</pre>
      </section>

      <section>
        <h2>Errors</h2>
        <pre>${escapeHtml(errors)}</pre>
      </section>
    </div>

    <div id="council-panel" class="tab-panel">
      <section>
        <h2>Council Room</h2>
        <textarea id="council-question" placeholder="Plantea el problema para Reg y el consejo. No pegues secretos ni raw diffs.">${escapeHtml(
          council.operator_question,
        )}</textarea>
        <div class="row">
          <select id="council-sensitivity">
            <option value="unknown"${council.sensitivity_label === "unknown" ? " selected" : ""}>unknown</option>
            <option value="sensitive"${council.sensitivity_label === "sensitive" ? " selected" : ""}>sensitive</option>
            <option value="non_sensitive"${council.sensitivity_label === "non_sensitive" ? " selected" : ""}>non_sensitive</option>
          </select>
          <div class="actions">
            <button class="primary" id="open-council">Open Council</button>
            <button id="run-round">Run Round</button>
          </div>
          <button id="synthesize-packet">Reg Synthesis</button>
        </div>
      </section>

      <section>
        <h2>Session</h2>
        <div>Status: <strong>${escapeHtml(council.status)}</strong></div>
        <div>Session: ${escapeHtml(renderValue(council.session_id))}</div>
        <div>Sensitivity: <strong>${escapeHtml(council.sensitivity_label)}</strong></div>
        <div>Gemini: ${escapeHtml(council.external_reviewer.status)} · ${escapeHtml(council.external_reviewer.model)}</div>
        <div class="muted">${escapeHtml(renderValue(council.external_reviewer.reason))}</div>
      </section>

      <section>
        <h2>Timeline</h2>
        ${positionsHtml}
      </section>

      <section>
        <h2>Reg Synthesis</h2>
        ${packetHtml}
      </section>

      <section>
        <h2>Events</h2>
        <pre>${escapeHtml(eventsHtml)}</pre>
      </section>

      <section>
        <h2>Council Errors</h2>
        <pre>${escapeHtml(councilErrors)}</pre>
      </section>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const body = document.body;
      const question = document.getElementById("council-question");
      const sensitivity = document.getElementById("council-sensitivity");

      function post(type, payload) {
        vscode.postMessage({ type, ...(payload || {}) });
      }

      document.querySelectorAll("[data-tab]").forEach((button) => {
        button.addEventListener("click", () => {
          const tab = button.getAttribute("data-tab");
          body.setAttribute("data-active-tab", tab);
          post("tab.switch", { tab });
        });
      });

      document.getElementById("open-council").addEventListener("click", () => {
        post("council.open", {
          question: question.value,
          sensitivityLabel: sensitivity.value
        });
      });
      document.getElementById("run-round").addEventListener("click", () => post("council.runRound"));
      document.getElementById("synthesize-packet").addEventListener("click", () => post("council.synthesize"));
    </script>
  </body>
</html>`;

    this.view.webview.html = html;
  }
}
