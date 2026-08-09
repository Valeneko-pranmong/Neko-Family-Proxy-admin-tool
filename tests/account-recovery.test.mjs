import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://127.0.0.1";
process.env.SUPABASE_SECRET_KEY ||= "test-secret";
process.env.ACCOUNT_RECOVERY_HMAC_SECRET ||=
  "test-recovery-hmac-secret-that-is-long-enough";
const { createAccountRecoveryService } = await import("../server/account-recovery.mjs");

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  role: "admin",
  status: "active",
};
const userId = "22222222-2222-4222-8222-222222222222";
const recoveryId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";
const expiresAt = "2026-08-09T10:05:00.000Z";

function fixture(overrides = {}) {
  const calls = [];
  const dependencies = {
    randomUuid: (purpose) => purpose === "recovery" ? recoveryId : sessionId,
    randomBytes: (length) => Buffer.alloc(length, calls.length + 1),
    verifier: (purpose, value) => createHash("sha256")
      .update(`${purpose}\0${value}`)
      .digest("hex"),
    rpc: async (name, payload) => {
      calls.push({ kind: "rpc", name, payload });
      if (name === "admin_generate_recovery_code") {
        return [{ recovery_id: recoveryId, username: "test_customer", expires_at: expiresAt }];
      }
      if (name === "verify_recovery_code") {
        return [{
          ok: true,
          error_code: null,
          recovery_session_id: sessionId,
          user_id: userId,
          expires_at: expiresAt,
        }];
      }
      if (name === "claim_recovery_password_change") {
        return [{ user_id: userId, recovery_id: recoveryId, already_completed: false }];
      }
      return true;
    },
    updatePassword: async (targetUserId, password) => {
      calls.push({ kind: "auth", targetUserId, password });
    },
    ...overrides,
  };
  return { service: createAccountRecoveryService(dependencies), calls };
}

test("admin generation returns raw code once but sends only verifier to RPC", async () => {
  const { service, calls } = fixture();
  const result = await service.generateRecoveryCode({
    actor,
    userId,
    confirmUsername: "test_customer",
  });

  assert.equal(result.recovery_id, recoveryId);
  assert.equal(result.username, "test_customer");
  assert.equal(result.expires_at, expiresAt);
  assert.match(result.recovery_code, /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
  const serializedCalls = JSON.stringify(calls);
  assert.doesNotMatch(serializedCalls, new RegExp(result.recovery_code.replaceAll("-", "")));
  const generation = calls.find((call) => call.name === "admin_generate_recovery_code");
  assert.equal(generation.payload.p_actor_id, actor.userId);
  assert.equal(generation.payload.p_user_id, userId);
  assert.equal(generation.payload.p_recovery_id, recoveryId);
  assert.match(generation.payload.p_code_verifier, /^[a-z0-9:]{64}$/i);
  assert.equal("recovery_code" in generation.payload, false);
});

test("generation rejects invalid target and unauthorized actor before RPC", async () => {
  for (const input of [
    { actor: null, userId, confirmUsername: "test_customer" },
    { actor: { ...actor, status: "suspended" }, userId, confirmUsername: "test_customer" },
    { actor, userId: "bad", confirmUsername: "test_customer" },
    { actor, userId, confirmUsername: "BAD USER" },
  ]) {
    const { service, calls } = fixture();
    await assert.rejects(() => service.generateRecoveryCode(input));
    assert.equal(calls.length, 0);
  }
});

test("correct code creates a restricted opaque recovery token", async () => {
  const { service, calls } = fixture();
  const result = await service.verifyRecoveryCode({
    username: " TEST_CUSTOMER ",
    recoveryCode: "ABCD-EFGH-JKLM-NPQR",
    requester: "198.51.100.10",
  });

  assert.equal(result.recovery_session_id, sessionId);
  assert.match(result.recovery_session, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(result.scope, "change_password");
  const verification = calls.find((call) => call.name === "verify_recovery_code");
  assert.equal(verification.payload.p_username, "test_customer");
  assert.equal("recovery_code" in verification.payload, false);
  assert.equal("recovery_session" in verification.payload, false);
});

test("invalid, expired, locked and rate-limited codes return one safe error", async () => {
  for (const errorCode of ["recovery_invalid", "recovery_rate_limited"]) {
    const { service } = fixture({
      rpc: async (name) => name === "verify_recovery_code"
        ? [{ ok: false, error_code: errorCode }]
        : true,
    });
    await assert.rejects(
      () => service.verifyRecoveryCode({
        username: "test_customer",
        recoveryCode: "ABCD-EFGH-JKLM-NPQR",
        requester: "198.51.100.10",
      }),
      (error) => error.status === 400 && error.message === "Recovery code is invalid or expired",
    );
  }
});

test("password change validates policy before claim", async () => {
  for (const password of ["short", "alllowercase123!", "ALLUPPERCASE123!", "NoNumber!!!!"] ) {
    const { service, calls } = fixture();
    await assert.rejects(() => service.changePassword({
      recoverySession: "token-that-is-long-enough-for-testing-1234567890",
      newPassword: password,
    }), (error) => error.status === 400);
    assert.equal(calls.length, 0);
  }
});

test("recovery session changes password then completes and revokes sessions transactionally", async () => {
  const { service, calls } = fixture();
  const result = await service.changePassword({
    recoverySession: "token-that-is-long-enough-for-testing-1234567890",
    newPassword: "Valid-New-Password-123!",
  });

  assert.deepEqual(result, { completed: true, state: "completed" });
  assert.deepEqual(calls.map((call) => call.name || call.kind), [
    "claim_recovery_password_change",
    "auth",
    "complete_recovery_password_change",
  ]);
  const serialized = JSON.stringify(calls.filter((call) => call.kind === "rpc"));
  assert.doesNotMatch(serialized, /Valid-New-Password-123!/);
});

test("Auth failure releases operation as retryable without leaking raw error", async () => {
  const { service, calls } = fixture({
    updatePassword: async () => { throw new Error("raw auth internal detail"); },
  });
  await assert.rejects(
    () => service.changePassword({
      recoverySession: "token-that-is-long-enough-for-testing-1234567890",
      newPassword: "Valid-New-Password-123!",
    }),
    (error) => error.status === 503
      && error.message === "Password recovery is temporarily unavailable; retry the same request",
  );
  assert.deepEqual(calls.map((call) => call.name), [
    "claim_recovery_password_change",
    "release_recovery_password_change",
  ]);
});

test("completed retry returns success without calling Supabase Auth again", async () => {
  const { service, calls } = fixture({
    rpc: async (name, payload) => {
      calls.push({ kind: "rpc", name, payload });
      if (name === "claim_recovery_password_change") {
        return [{ user_id: userId, recovery_id: recoveryId, already_completed: true }];
      }
      return true;
    },
  });
  const result = await service.changePassword({
    recoverySession: "token-that-is-long-enough-for-testing-1234567890",
    newPassword: "Valid-New-Password-123!",
  });
  assert.deepEqual(result, { completed: true, state: "completed" });
  assert.equal(calls.filter((call) => call.kind === "auth").length, 0);
  assert.deepEqual(calls.map((call) => call.name), ["claim_recovery_password_change"]);
});

test("malformed Backend responses fail closed", async () => {
  const { service } = fixture({ rpc: async () => ({ unexpected: true }) });
  await assert.rejects(
    () => service.verifyRecoveryCode({
      username: "test_customer",
      recoveryCode: "ABCD-EFGH-JKLM-NPQR",
      requester: "198.51.100.10",
    }),
    (error) => error.status === 502 && !/unexpected/.test(error.message),
  );
});
