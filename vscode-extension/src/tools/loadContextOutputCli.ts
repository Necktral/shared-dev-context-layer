import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { RuntimeMode } from "../domain/operationalContext";
import type { FixtureScenario } from "../infrastructure/wis/fixtureWISGateway";
import { renderLoadContextOutput } from "./loadContextOutput";

interface CliOptions {
  runtimeMode: RuntimeMode;
  scenario: FixtureScenario;
  endpoint: string;
  timeoutMs: number;
  diagnosticMode: boolean;
  outputFile: string | null;
  sessionKey: string;
  sessionCreatedAt: string;
  sessionState: "created" | "reused" | "reset";
  workspaceRoot: string | null;
  repoRoot: string | null;
  branch: string | null;
  activeFile: string | null;
  inspectorStatus: "ok" | "no_workspace" | "no_repo" | "error";
  inspectorError: string | null;
}

const RUNTIME_MODES: RuntimeMode[] = ["offline_fixture", "mcp"];
const FIXTURE_SCENARIOS: FixtureScenario[] = [
  "success_full",
  "partial_missing_recent_errors",
  "degraded_no_remote_bundle",
  "transport_error",
  "no_active_task",
  "validation_stale",
];

function printHelp(): void {
  process.stdout.write(
    [
      "Usage:",
      "  node dist/tools/loadContextOutputCli.js [options]",
      "",
      "Options:",
      "  --runtime-mode <offline_fixture|mcp>",
      "  --scenario <fixture_scenario>",
      "  --endpoint <url>",
      "  --timeout-ms <number>",
      "  --diagnostic-mode <true|false>",
      "  --output-file <path>",
      "  --session-key <value>",
      "  --session-created-at <ISO8601>",
      "  --session-state <created|reused|reset>",
      "  --workspace-root <path|null>",
      "  --repo-root <path|null>",
      "  --branch <value|null>",
      "  --active-file <path|null>",
      "  --inspector-status <ok|no_workspace|no_repo|error>",
      "  --inspector-error <value|null>",
      "  --help",
      "",
      "Examples:",
      "  node dist/tools/loadContextOutputCli.js --runtime-mode offline_fixture --scenario success_full",
      "  node dist/tools/loadContextOutputCli.js --runtime-mode mcp --endpoint http://localhost:8002/mcp",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const eqIndex = token.indexOf("=");
    if (eqIndex > -1) {
      const key = token.slice(2, eqIndex).trim();
      const value = token.slice(eqIndex + 1).trim();
      args[key] = value;
      continue;
    }

    const key = token.slice(2).trim();
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }

    args[key] = next;
    i += 1;
  }

  return args;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n"].includes(normalized)) {
    return false;
  }

  throw new Error(`Valor booleano inválido: ${raw}`);
}

function parseInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Valor numérico inválido: ${raw}`);
  }
  return parsed;
}

function parseNullable(raw: string | undefined, fallback: string | null): string | null {
  if (raw === undefined) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "null") {
    return null;
  }
  return raw;
}

function findRepoRoot(startDir: string): string | null {
  let current = path.resolve(startDir);

  while (true) {
    if (existsSync(path.join(current, ".git"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function detectBranch(repoRoot: string | null): string | null {
  if (!repoRoot) {
    return null;
  }

  try {
    const branch = execFileSync("git", ["-C", repoRoot, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    }).trim();
    return branch.length ? branch : null;
  } catch {
    return null;
  }
}

function parseRuntimeMode(raw: string | undefined): RuntimeMode {
  const mode = (raw ?? "offline_fixture") as RuntimeMode;
  if (!RUNTIME_MODES.includes(mode)) {
    throw new Error(`runtime-mode inválido: ${raw}`);
  }
  return mode;
}

function parseScenario(raw: string | undefined): FixtureScenario {
  const scenario = (raw ?? "success_full") as FixtureScenario;
  if (!FIXTURE_SCENARIOS.includes(scenario)) {
    throw new Error(`scenario inválido: ${raw}`);
  }
  return scenario;
}

function parseSessionState(raw: string | undefined): "created" | "reused" | "reset" {
  const state = (raw ?? "reused") as "created" | "reused" | "reset";
  if (state !== "created" && state !== "reused" && state !== "reset") {
    throw new Error(`session-state inválido: ${raw}`);
  }
  return state;
}

function parseInspectorStatus(raw: string | undefined): "ok" | "no_workspace" | "no_repo" | "error" {
  const status = (raw ?? "ok") as "ok" | "no_workspace" | "no_repo" | "error";
  if (status !== "ok" && status !== "no_workspace" && status !== "no_repo" && status !== "error") {
    throw new Error(`inspector-status inválido: ${raw}`);
  }
  return status;
}

function buildOptions(argv: string[]): CliOptions {
  const args = parseArgs(argv);
  const repoRootDetected = findRepoRoot(process.cwd());
  const workspaceRootDetected = repoRootDetected ?? process.cwd();
  const branchDetected = detectBranch(repoRootDetected);
  const scenario = parseScenario(args.scenario);

  return {
    runtimeMode: parseRuntimeMode(args["runtime-mode"]),
    scenario,
    endpoint: args.endpoint ?? "http://localhost:8002/mcp",
    timeoutMs: parseInteger(args["timeout-ms"], 5000),
    diagnosticMode: parseBoolean(args["diagnostic-mode"], true),
    outputFile: parseNullable(args["output-file"], null),
    sessionKey: args["session-key"] ?? `manual-${scenario}-session`,
    sessionCreatedAt: args["session-created-at"] ?? new Date().toISOString(),
    sessionState: parseSessionState(args["session-state"]),
    workspaceRoot: parseNullable(args["workspace-root"], workspaceRootDetected),
    repoRoot: parseNullable(args["repo-root"], repoRootDetected),
    branch: parseNullable(args.branch, branchDetected),
    activeFile: parseNullable(args["active-file"], null),
    inspectorStatus: parseInspectorStatus(args["inspector-status"]),
    inspectorError: parseNullable(args["inspector-error"], null),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    printHelp();
    return;
  }

  const options = buildOptions(argv);
  const rendered = await renderLoadContextOutput({
    runtimeMode: options.runtimeMode,
    fixtureScenario: options.scenario,
    endpoint: options.endpoint,
    timeoutMs: options.timeoutMs,
    diagnosticMode: options.diagnosticMode,
    session: {
      key: options.sessionKey,
      createdAt: options.sessionCreatedAt,
      state: options.sessionState,
    },
    environment: {
      workspaceRoot: options.workspaceRoot,
      repoRoot: options.repoRoot,
      branch: options.branch,
      activeFile: options.activeFile,
      inspectorStatus: options.inspectorStatus,
      inspectorError: options.inspectorError,
      timestamp: options.sessionCreatedAt,
    },
  });

  if (options.outputFile) {
    await writeFile(options.outputFile, rendered.output, "utf8");
  }

  process.stdout.write(rendered.output);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[loadContextOutputCli] ${message}\n`);
  process.exitCode = 1;
});
