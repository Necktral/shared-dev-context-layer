import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeAuthPolicy } from "../../auth/runtimeAuthPolicy";

test("RuntimeAuthPolicy permite mode none cuando no es requerido y no hay token", () => {
  const policy = new RuntimeAuthPolicy();
  const decision = policy.evaluate({
    mode: "none",
    required: false,
    token: null,
    header_name: "x-api-key",
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, "ok");
});

test("RuntimeAuthPolicy bloquea mode none cuando required=true", () => {
  const policy = new RuntimeAuthPolicy();
  const decision = policy.evaluate({
    mode: "none",
    required: true,
    token: null,
    header_name: "x-api-key",
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "mode_none_but_required");
});

test("RuntimeAuthPolicy bloquea token en mode none", () => {
  const policy = new RuntimeAuthPolicy();
  const decision = policy.evaluate({
    mode: "none",
    required: false,
    token: "secret",
    header_name: "x-api-key",
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "token_present_in_none_mode");
});

test("RuntimeAuthPolicy bloquea bearer/api_key sin token", () => {
  const policy = new RuntimeAuthPolicy();
  assert.equal(
    policy.evaluate({
      mode: "bearer",
      required: true,
      token: null,
      header_name: "x-api-key",
    }).code,
    "missing_token",
  );
  assert.equal(
    policy.evaluate({
      mode: "api_key",
      required: false,
      token: "",
      header_name: "x-api-key",
    }).code,
    "missing_token",
  );
});

test("RuntimeAuthPolicy bloquea api_key sin header_name", () => {
  const policy = new RuntimeAuthPolicy();
  const decision = policy.evaluate({
    mode: "api_key",
    required: true,
    token: "abc",
    header_name: "  ",
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "invalid_header_name");
});

test("RuntimeAuthPolicy permite bearer/api_key válidos", () => {
  const policy = new RuntimeAuthPolicy();
  const bearerDecision = policy.evaluate({
    mode: "bearer",
    required: true,
    token: "token-1",
    header_name: "x-api-key",
  });
  const apiKeyDecision = policy.evaluate({
    mode: "api_key",
    required: true,
    token: "token-2",
    header_name: "x-api-key",
  });
  assert.equal(bearerDecision.allowed, true);
  assert.equal(apiKeyDecision.allowed, true);
});
