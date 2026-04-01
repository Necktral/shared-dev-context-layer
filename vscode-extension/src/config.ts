import * as vscode from "vscode";
import {
  DEFAULT_AUTH_HEADER_NAME,
  DEFAULT_AUTH_MODE,
  DEFAULT_CODEX_CLI_COMMAND,
  DEFAULT_DIAGNOSTIC_MODE,
  DEFAULT_FIXTURE_SCENARIO,
  DEFAULT_MCP_ENDPOINT,
  DEFAULT_OPERATION_PROFILE,
  DEFAULT_REQUIRE_AUTHENTICATION,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RUNTIME_MODE,
} from "./constants";
import type { RuntimeMode } from "./domain/operationalContext";
import type { FixtureScenario } from "./infrastructure/wis/fixtureWISGateway";
import type { AuthMode, ResolvedAuthConfig } from "./infrastructure/wis/wisGateway";
import type { OperationProfile } from "./local/types";

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

function normalizeAuthMode(value: string | undefined): AuthMode {
  if (value === "none" || value === "bearer" || value === "api_key") {
    return value;
  }
  return DEFAULT_AUTH_MODE as AuthMode;
}

function normalizeOperationProfile(value: string | undefined): OperationProfile {
  if (value === "phase3_control_plane" || value === "local_private") {
    return value;
  }
  return DEFAULT_OPERATION_PROFILE as OperationProfile;
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

export function getAuthMode(): AuthMode {
  const configured = vscode.workspace.getConfiguration().get<string>("wisContextSync.authMode");
  return normalizeAuthMode(configured);
}

export function getAuthHeaderName(): string {
  const configured = vscode.workspace.getConfiguration().get<string>("wisContextSync.authHeaderName");
  const trimmed = configured?.trim();
  if (!trimmed) {
    return DEFAULT_AUTH_HEADER_NAME;
  }
  return trimmed;
}

export function isAuthenticationRequired(): boolean {
  return (
    vscode.workspace.getConfiguration().get<boolean>("wisContextSync.requireAuthentication") ??
    DEFAULT_REQUIRE_AUTHENTICATION
  );
}

export function getAuthConfig(): ResolvedAuthConfig {
  return {
    mode: getAuthMode(),
    header_name: getAuthHeaderName(),
    required: isAuthenticationRequired(),
  };
}

export function getOperationProfile(): OperationProfile {
  const configured = vscode.workspace.getConfiguration().get<string>("wisContextSync.operationProfile");
  return normalizeOperationProfile(configured);
}

export function getCodexCliCommand(): string {
  const configured = vscode.workspace.getConfiguration().get<string>("wisContextSync.codexCliCommand");
  const command = configured?.trim();
  if (!command) {
    return DEFAULT_CODEX_CLI_COMMAND;
  }
  return command;
}
