import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeAuthPolicy } from "../../../auth/runtimeAuthPolicy";
import { LocalDoctorService } from "../../../platform/doctor/localDoctorService";
import { WorkspaceBoundaryGuard } from "../../../platform/security/workspaceBoundaryGuard";

function createDeps(overrides?: Partial<{
  environment: {
    workspace_root: string | null;
    repo_root: string | null;
    active_file: string | null;
    inspector_status: string;
    inspector_error: string | null;
  };
  auth: {
    mode: "none" | "bearer" | "api_key";
    token: string | null;
    required: boolean;
    header_name?: string | null;
  };
  dbStatus: string;
  dbReason: string | null;
  runtimeMode: "mcp" | "offline_fixture";
  operationProfile: string;
}>) {
  const environment = overrides?.environment ?? {
    workspace_root: "/workspace",
    repo_root: "/workspace/repo",
    active_file: "/workspace/repo/src/index.ts",
    inspector_status: "ok",
    inspector_error: null,
  };
  const auth = overrides?.auth ?? {
    mode: "none" as const,
    token: null,
    required: false,
    header_name: "x-api-key",
  };
  return {
    inspectEnvironment: async () => environment,
    resolveAuth: async () => auth,
    getPersistenceSnapshot: () => ({
      dbStatus: overrides?.dbStatus ?? "connected",
      reason: overrides?.dbReason ?? null,
    }),
    getRuntimeMode: () => overrides?.runtimeMode ?? ("offline_fixture" as const),
    getOperationProfile: () => overrides?.operationProfile ?? "local_private",
  };
}

test("LocalDoctorService devuelve pass cuando checks principales están sanos", async () => {
  const service = new LocalDoctorService(
    createDeps(),
    new WorkspaceBoundaryGuard(),
    new RuntimeAuthPolicy(),
  );
  const report = await service.run();
  assert.equal(report.overall, "pass");
  assert.equal(report.checks.some((check) => check.level === "fail"), false);
});

test("LocalDoctorService devuelve fail con auth inválida", async () => {
  const service = new LocalDoctorService(
    createDeps({
      auth: {
        mode: "bearer",
        required: true,
        token: null,
        header_name: "x-api-key",
      },
    }),
    new WorkspaceBoundaryGuard(),
    new RuntimeAuthPolicy(),
  );
  const report = await service.run();
  assert.equal(report.overall, "fail");
  const authCheck = report.checks.find((check) => check.id === "auth.policy");
  assert.equal(authCheck?.level, "fail");
});

test("LocalDoctorService devuelve warn cuando db está desconectada en local_private", async () => {
  const service = new LocalDoctorService(
    createDeps({
      dbStatus: "disconnected",
      dbReason: "db down",
    }),
    new WorkspaceBoundaryGuard(),
    new RuntimeAuthPolicy(),
  );
  const report = await service.run();
  assert.equal(report.overall, "warn");
  const dbCheck = report.checks.find((check) => check.id === "local.db");
  assert.equal(dbCheck?.level, "warn");
});
