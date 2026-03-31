import * as vscode from "vscode";
import {
  DEFAULT_DIAGNOSTIC_MODE,
  DEFAULT_FIXTURE_SCENARIO,
  DEFAULT_MCP_ENDPOINT,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RUNTIME_MODE,
} from "./constants";
import type { RuntimeMode } from "./domain/operationalContext";
import type { FixtureScenario } from "./infrastructure/wis/fixtureWISGateway";

const FIXTURE_SCENARIOS: readonly FixtureScenario[] = [
  "success_full",
  "partial_missing_recent_errors",
  "degraded_no_remote_bundle",
  "transport_error",
  "no_active_task",
  "validation_stale",
];

function normalizeRuntimeMode(value: string | undefined): RuntimeMode {
  if (value === "mcp" || value === "offline_fixture") {
    return value;
  }
  return DEFAULT_RUNTIME_MODE as RuntimeMode;
}

function normalizeFixtureScenario(value: string | undefined): FixtureScenario {
  if (value && FIXTURE_SCENARIOS.includes(value as FixtureScenario)) {
    return value as FixtureScenario;
  }
  return DEFAULT_FIXTURE_SCENARIO as FixtureScenario;
}

export function getMcpEndpoint(): string {
  return (
    vscode.workspace.getConfiguration().get<string>("wisContextSync.mcpEndpoint") ??
    DEFAULT_MCP_ENDPOINT
  );
}

export function getRuntimeMode(): RuntimeMode {
  const mode = vscode.workspace.getConfiguration().get<string>("wisContextSync.runtimeMode");
  return normalizeRuntimeMode(mode);
}

export function getRequestTimeoutMs(): number {
  const configured = vscode.workspace.getConfiguration().get<number>("wisContextSync.requestTimeoutMs");
  if (!configured || Number.isNaN(configured) || configured < 100) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  return configured;
}

export function getFixtureScenario(): FixtureScenario {
  const configured = vscode.workspace.getConfiguration().get<string>("wisContextSync.fixtureScenario");
  return normalizeFixtureScenario(configured);
}

export function isDiagnosticModeEnabled(): boolean {
  return (
    vscode.workspace.getConfiguration().get<boolean>("wisContextSync.diagnosticMode") ??
    DEFAULT_DIAGNOSTIC_MODE
  );
}
