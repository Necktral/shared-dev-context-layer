export const EXTENSION_OUTPUT_CHANNEL = "WIS Context Sync";
export const FIXED_CONSUMER = "vscode_extension";
export const DEFAULT_MCP_ENDPOINT = "http://localhost:8002/mcp";
export const DEFAULT_DIAGNOSTIC_MODE = true;
export const DEFAULT_RUNTIME_MODE = "offline_fixture";
export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
export const DEFAULT_FIXTURE_SCENARIO = "success_full";
export const DEFAULT_AUTH_MODE = "none";
export const DEFAULT_AUTH_HEADER_NAME = "x-api-key";
export const DEFAULT_REQUIRE_AUTHENTICATION = false;
export const DEFAULT_OPERATION_PROFILE = "phase3_control_plane";
export const DEFAULT_CODEX_CLI_COMMAND = "codex";
export const DEFAULT_HANDOFF_TARGET = "codex";
export const DEFAULT_CUSTOM_HANDOFF_TARGET_NAME = "Custom Agent";
export const DEFAULT_LOCAL_DB_HOST = "localhost";
export const DEFAULT_LOCAL_DB_PORT = 5432;
export const DEFAULT_LOCAL_DB_DATABASE = "wis_context";
export const DEFAULT_LOCAL_DB_USER = "wis_admin";
export const DEFAULT_LOCAL_DB_PASSWORD = "";
export const DEFAULT_LOCAL_DB_SCHEMA = "local_private";
export const DEFAULT_LOCAL_DB_SSL = false;
export const DEFAULT_LOCAL_INDEX_EXCLUDE_DIRS = [
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
  "out",
  "tmp",
  "vendor",
] as const;
export const DEFAULT_LOCAL_INDEX_INCLUDE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yml",
  ".yaml",
  ".md",
  ".mdx",
  ".txt",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".sql",
  ".sh",
  ".toml",
  ".ini",
  ".cfg",
  ".env",
  ".css",
  ".scss",
  ".html",
  ".xml",
] as const;
export const DEFAULT_LOCAL_INDEX_MAX_FILE_BYTES = 2_097_152;
export const DEFAULT_LOCAL_INDEX_CHUNK_SIZE_CHARS = 1200;
export const DEFAULT_LOCAL_INDEX_CHUNK_OVERLAP_CHARS = 120;

export const SESSION_KEY_STORAGE_KEY = "wisContextSync.sessionKey";
export const SESSION_CREATED_AT_STORAGE_KEY = "wisContextSync.sessionCreatedAt";
export const AUTH_TOKEN_STORAGE_KEY = "wisContextSync.authToken";
export const LOCAL_DB_PASSWORD_STORAGE_KEY = "wisContextSync.localDbPassword";

export const COMMAND_LOAD_CONTEXT = "wisContextSync.loadOperationalContext";
export const COMMAND_RESET_SESSION = "wisContextSync.resetSession";
export const COMMAND_PREPARE_HANDOFF = "wisContextSync.prepareHandoff";
export const COMMAND_CONFIGURE_AUTH = "wisContextSync.configureAuthentication";
export const COMMAND_CLEAR_AUTH = "wisContextSync.clearAuthentication";
export const COMMAND_SEARCH_CONTEXT = "wisContextSync.searchContext";
export const COMMAND_UPSERT_CONTEXT_ITEM = "wisContextSync.upsertContextItem";
export const COMMAND_APPEND_CONTEXT_EVENT = "wisContextSync.appendContextEvent";
export const COMMAND_LINK_CONTEXT_ENTITIES = "wisContextSync.linkContextEntities";
export const COMMAND_SET_CONTEXT_LABELS = "wisContextSync.setContextLabels";
export const COMMAND_ARCHIVE_CONTEXT_ITEM = "wisContextSync.archiveContextItem";
export const COMMAND_APPLY_SYNC_BATCH = "wisContextSync.applySyncBatch";
export const COMMAND_LOCAL_INDEX = "wisContextSync.localIndex";
export const COMMAND_LOCAL_PREPARE_TASK = "wisContextSync.localPrepareTask";
export const COMMAND_LOCAL_RUN_CODEX = "wisContextSync.localRunCodex";
export const COMMAND_LOCAL_REFRESH = "wisContextSync.localRefresh";
export const COMMAND_LOCAL_DOCTOR = "wisContextSync.localDoctor";
export const COMMAND_LOCAL_CONFIGURE_DB_PASSWORD = "wisContextSync.localConfigureDbPassword";

export const LOCAL_RUNTIME_VIEW_ID = "wisContextSync.localRuntimePanel";
