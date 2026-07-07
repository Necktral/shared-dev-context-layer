import * as vscode from "vscode";
import {
  DEFAULT_AUTH_HEADER_NAME,
  DEFAULT_AUTH_MODE,
  DEFAULT_CODEX_CLI_COMMAND,
  DEFAULT_COUNCIL_ENABLED,
  DEFAULT_COUNCIL_EXTERNAL_REVIEW_ENABLED,
  DEFAULT_COUNCIL_EXTERNAL_REVIEW_MAX_CHARS,
  DEFAULT_COUNCIL_EXTERNAL_REVIEW_MODEL,
  DEFAULT_DIAGNOSTIC_MODE,
  DEFAULT_FIXTURE_SCENARIO,
  DEFAULT_LOCAL_DB_DATABASE,
  DEFAULT_LOCAL_DB_HOST,
  DEFAULT_LOCAL_INDEX_CHUNK_OVERLAP_CHARS,
  DEFAULT_LOCAL_INDEX_CHUNK_SIZE_CHARS,
  DEFAULT_LOCAL_INDEX_EXCLUDE_DIRS,
  DEFAULT_LOCAL_INDEX_INCLUDE_EXTENSIONS,
  DEFAULT_LOCAL_INDEX_MAX_FILE_BYTES,
  DEFAULT_LOCAL_DB_PASSWORD,
  DEFAULT_LOCAL_DB_PORT,
  DEFAULT_LOCAL_DB_SCHEMA,
  DEFAULT_LOCAL_DB_SSL,
  DEFAULT_LOCAL_DB_USER,
  DEFAULT_MCP_ENDPOINT,
  DEFAULT_OPERATION_PROFILE,
  DEFAULT_REQUIRE_AUTHENTICATION,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RUNTIME_MODE,
  LOCAL_DB_PASSWORD_STORAGE_KEY,
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

export interface LocalDbConfig {
  enabled: boolean;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string;
  ssl: boolean;
}

export interface LocalIndexConfig {
  excludeDirs: string[];
  includeExtensions: string[];
  maxFileBytes: number;
  chunkSizeChars: number;
  chunkOverlapChars: number;
}

export interface CouncilConfig {
  enabled: boolean;
  externalReview: {
    enabled: boolean;
    model: string;
    maxChars: number;
  };
}

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

function getLocalDbEnabled(profile: OperationProfile): boolean {
  const configured = vscode.workspace.getConfiguration().get<boolean>("wisContextSync.localDb.enabled");
  const enabled = configured ?? true;
  if (profile !== "local_private") {
    return false;
  }
  return enabled;
}

function getLocalDbHost(): string {
  const configured = vscode.workspace.getConfiguration().get<string>("wisContextSync.localDb.host");
  const host = configured?.trim();
  if (!host) {
    return DEFAULT_LOCAL_DB_HOST;
  }
  return host;
}

function getLocalDbPort(): number {
  const configured = vscode.workspace.getConfiguration().get<number>("wisContextSync.localDb.port");
  if (!configured || Number.isNaN(configured) || configured <= 0) {
    return DEFAULT_LOCAL_DB_PORT;
  }
  return Math.floor(configured);
}

function getLocalDbDatabase(): string {
  const configured = vscode.workspace.getConfiguration().get<string>("wisContextSync.localDb.database");
  const database = configured?.trim();
  if (!database) {
    return DEFAULT_LOCAL_DB_DATABASE;
  }
  return database;
}

function getLocalDbUser(): string {
  const configured = vscode.workspace.getConfiguration().get<string>("wisContextSync.localDb.user");
  const user = configured?.trim();
  if (!user) {
    return DEFAULT_LOCAL_DB_USER;
  }
  return user;
}

function getLocalDbPasswordFromSettings(): string {
  const configured = vscode.workspace.getConfiguration().get<string>("wisContextSync.localDb.password");
  return configured?.trim() ?? DEFAULT_LOCAL_DB_PASSWORD;
}

function getLocalDbSchema(): string {
  const configured = vscode.workspace.getConfiguration().get<string>("wisContextSync.localDb.schema");
  const schema = configured?.trim();
  if (!schema) {
    return DEFAULT_LOCAL_DB_SCHEMA;
  }
  return schema;
}

function getLocalDbSsl(): boolean {
  return vscode.workspace.getConfiguration().get<boolean>("wisContextSync.localDb.ssl") ?? DEFAULT_LOCAL_DB_SSL;
}

function normalizeStringArray(raw: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(raw)) {
    return [...fallback];
  }
  const normalized = raw
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (normalized.length === 0) {
    return [...fallback];
  }
  return [...new Set(normalized)];
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  if (!value || Number.isNaN(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

export function getLocalIndexConfig(): LocalIndexConfig {
  const config = vscode.workspace.getConfiguration();
  const excludeDirs = normalizeStringArray(
    config.get<unknown>("wisContextSync.localIndex.excludeDirs"),
    DEFAULT_LOCAL_INDEX_EXCLUDE_DIRS,
  );
  const includeExtensions = normalizeStringArray(
    config.get<unknown>("wisContextSync.localIndex.includeExtensions"),
    DEFAULT_LOCAL_INDEX_INCLUDE_EXTENSIONS,
  ).map((ext) => (ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`));

  const maxFileBytes = normalizePositiveNumber(
    config.get<number>("wisContextSync.localIndex.maxFileBytes"),
    DEFAULT_LOCAL_INDEX_MAX_FILE_BYTES,
  );
  const chunkSizeChars = normalizePositiveNumber(
    config.get<number>("wisContextSync.localIndex.chunkSizeChars"),
    DEFAULT_LOCAL_INDEX_CHUNK_SIZE_CHARS,
  );
  const chunkOverlapCharsRaw = normalizePositiveNumber(
    config.get<number>("wisContextSync.localIndex.chunkOverlapChars"),
    DEFAULT_LOCAL_INDEX_CHUNK_OVERLAP_CHARS,
  );

  const chunkOverlapChars = Math.min(chunkOverlapCharsRaw, Math.max(1, chunkSizeChars - 1));

  return {
    excludeDirs,
    includeExtensions,
    maxFileBytes,
    chunkSizeChars,
    chunkOverlapChars,
  };
}

function getBooleanFromEnv(name: string): boolean | null {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return null;
  }
  if (raw === "1" || raw === "true" || raw === "yes") {
    return true;
  }
  if (raw === "0" || raw === "false" || raw === "no") {
    return false;
  }
  return null;
}

export function getCouncilConfig(): CouncilConfig {
  const config = vscode.workspace.getConfiguration();
  const model = config.get<string>("wisContextSync.council.externalReview.model")?.trim();
  const envModel = process.env.GEMINI_REVIEW_MODEL?.trim();
  const maxChars = normalizePositiveNumber(
    config.get<number>("wisContextSync.council.externalReview.maxChars") ??
      Number(process.env.GEMINI_REVIEW_MAX_CHARS),
    DEFAULT_COUNCIL_EXTERNAL_REVIEW_MAX_CHARS,
  );

  return {
    enabled: config.get<boolean>("wisContextSync.council.enabled") ?? DEFAULT_COUNCIL_ENABLED,
    externalReview: {
      enabled:
        getBooleanFromEnv("GEMINI_EXTERNAL_REVIEW_ENABLED") ??
        config.get<boolean>("wisContextSync.council.externalReview.enabled") ??
        DEFAULT_COUNCIL_EXTERNAL_REVIEW_ENABLED,
      model: model || envModel || DEFAULT_COUNCIL_EXTERNAL_REVIEW_MODEL,
      maxChars,
    },
  };
}

export async function resolveLocalDbConfig(
  secretStorage: vscode.SecretStorage,
  profile: OperationProfile = getOperationProfile(),
): Promise<LocalDbConfig> {
  let password = getLocalDbPasswordFromSettings();
  if (!password) {
    const fromSecret = await secretStorage.get(LOCAL_DB_PASSWORD_STORAGE_KEY);
    password = fromSecret?.trim() ?? "";
  }

  return {
    enabled: getLocalDbEnabled(profile),
    host: getLocalDbHost(),
    port: getLocalDbPort(),
    database: getLocalDbDatabase(),
    user: getLocalDbUser(),
    password,
    schema: getLocalDbSchema(),
    ssl: getLocalDbSsl(),
  };
}
