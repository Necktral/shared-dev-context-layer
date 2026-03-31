import test from "node:test";
import assert from "node:assert/strict";
import { normalizeToolPayload } from "../../infrastructure/wis/normalizers";

test("normalizeToolPayload parsea ok correctamente", () => {
  const result = normalizeToolPayload("get_active_task", {
    status: "ok",
    task: {},
    scope: {},
    resolution_metadata: {},
  });

  assert.equal(result.kind, "ok");
  assert.equal(result.status, "ok");
});

test("normalizeToolPayload preserva scope_conflict como remote_error", () => {
  const result = normalizeToolPayload("get_active_task", {
    status: "scope_conflict",
    scope: {},
    resolution_metadata: {
      conflict_flags: ["task_project_mismatch"],
    },
  });

  assert.equal(result.kind, "remote_error");
  assert.equal(result.status, "scope_conflict");
  assert.equal(result.issues[0]?.conflict_flag, "task_project_mismatch");
});

test("normalizeToolPayload retorna schema_error cuando faltan campos requeridos", () => {
  const result = normalizeToolPayload("get_validation_status", {
    status: "ok",
    scope: {},
    resolution_metadata: {},
  });

  assert.equal(result.kind, "schema_error");
});

test("normalizeToolPayload retorna schema_error con status desconocido", () => {
  const result = normalizeToolPayload("get_recent_errors", {
    status: "unexpected_status",
  });

  assert.equal(result.kind, "schema_error");
  assert.equal(result.status, null);
});
