import { LoadOperationalContextService } from "../application/loadOperationalContextService";
import type { OperationalContextEnvelope, RuntimeMode } from "../domain/operationalContext";
import { DiagnosticsReporter } from "../diagnostics";
import { FixtureWISGateway, type FixtureScenario } from "../infrastructure/wis/fixtureWISGateway";
import { McpWISGateway } from "../infrastructure/wis/mcpWISGateway";
import type { AuthRuntimeContext } from "../infrastructure/wis/wisGateway";
import { ContextPresenter } from "../presentation/contextPresenter";
import { OutputChannelRenderer } from "../presentation/renderers/outputChannelRenderer";
import { ViewModelMapper } from "../presentation/viewModels";

export interface RenderSessionOptions {
  key?: string;
  createdAt?: string;
  state?: "created" | "reused" | "reset";
}

export interface RenderEnvironmentOptions {
  workspaceRoot?: string | null;
  repoRoot?: string | null;
  branch?: string | null;
  activeFile?: string | null;
  timestamp?: string;
  inspectorStatus?: "ok" | "no_workspace" | "no_repo" | "error";
  inspectorError?: string | null;
}

export interface RenderLoadContextOutputOptions {
  runtimeMode?: RuntimeMode;
  fixtureScenario?: FixtureScenario;
  endpoint?: string;
  timeoutMs?: number;
  diagnosticMode?: boolean;
  auth?: AuthRuntimeContext;
  session?: RenderSessionOptions;
  environment?: RenderEnvironmentOptions;
}

export interface RenderLoadContextOutputResult {
  output: string;
  envelope: OperationalContextEnvelope;
}

class BufferingOutputChannel {
  public readonly lines: string[] = [];

  public appendLine(line: string): void {
    this.lines.push(line);
  }

  public show(_preserveFocus?: boolean): void {
    return undefined;
  }
}

export async function renderLoadContextOutput(
  options: RenderLoadContextOutputOptions = {},
): Promise<RenderLoadContextOutputResult> {
  const now = new Date().toISOString();
  const runtimeMode = options.runtimeMode ?? "offline_fixture";
  const fixtureScenario = options.fixtureScenario ?? "success_full";
  const endpoint = options.endpoint ?? "http://localhost:8002/mcp";
  const timeoutMs = options.timeoutMs ?? 5000;
  const diagnosticMode = options.diagnosticMode ?? true;

  const sessionKey = options.session?.key ?? `manual-${fixtureScenario}-session`;
  const sessionCreatedAt = options.session?.createdAt ?? now;
  const sessionState = options.session?.state ?? "reused";

  const output = new BufferingOutputChannel();
  const diagnostics = new DiagnosticsReporter(output as never);
  const presenter = new ContextPresenter(new ViewModelMapper(), new OutputChannelRenderer(output as never));

  const loadService = new LoadOperationalContextService({
    sessionManager: {
      consumer: "vscode_extension",
      async getOrCreateSession() {
        return {
          sessionKey,
          sessionCreatedAt,
          sessionState,
        };
      },
    },
    environmentInspector: {
      async inspect() {
        return {
          workspace_root: options.environment?.workspaceRoot ?? null,
          repo_root: options.environment?.repoRoot ?? null,
          branch: options.environment?.branch ?? null,
          active_file: options.environment?.activeFile ?? null,
          timestamp: options.environment?.timestamp ?? now,
          inspector_status: options.environment?.inspectorStatus ?? "ok",
          inspector_error: options.environment?.inspectorError ?? null,
        };
      },
    },
    diagnostics,
    presenter,
    getConfig: () => ({
      endpoint,
      runtimeMode,
      timeoutMs,
      fixtureScenario,
      diagnosticMode,
    }),
    createGateway: (config) => {
      if (config.runtimeMode === "offline_fixture") {
        return new FixtureWISGateway(config.fixtureScenario);
      }
      return new McpWISGateway();
    },
  });

  const envelope = await loadService.load(options.auth);
  const outputText = `${output.lines.join("\n")}\n`;

  return {
    output: outputText,
    envelope,
  };
}
