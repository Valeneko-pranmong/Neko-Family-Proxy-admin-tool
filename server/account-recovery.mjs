import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { config } from "./config.mjs";
import { rpcPost, updateAuthUserPassword } from "./supabase.mjs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;
const RECOVERY_CODE_PATTERN = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,200}$/;
const HEX_PATTERN = /^[0-9a-f]{64}$/;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function safeError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.isSafe = true;
  return error;
}

function normalizeUsername(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase();
}

function firstRow(value) {
  return Array.isArray(value) && value.length === 1 && value[0] && typeof value[0] === "object"
    ? value[0]
    : null;
}

function defaultVerifier(purpose, value) {
  return createHmac("sha256", config.accountRecoveryHmacSecret)
    .update(`${purpose}\0${value}`)
    .digest("hex");
}

function defaultRandomCode(bytes) {
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code.match(/.{1,4}/g).join("-");
}

function validatePassword(password) {
  if (
    typeof password !== "string"
    || password.length < 12
    || password.length > 128
    || !/[A-Z]/.test(password)
    || !/[a-z]/.test(password)
    || !/[0-9]/.test(password)
    || !/[^A-Za-z0-9]/.test(password)
  ) {
    throw safeError(
      "Password must be 12-128 characters and include upper, lower, number, and symbol",
    );
  }
}

function validateActor(actor) {
  if (!actor?.userId || actor.role !== "admin" || actor.status !== "active") {
    throw safeError("Admin authorization required", 403);
  }
}

function validateTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function createAccountRecoveryService(dependencies = {}) {
  const rpc = dependencies.rpc || rpcPost;
  const updatePassword = dependencies.updatePassword || updateAuthUserPassword;
  const makeUuid = dependencies.randomUuid || (() => randomUUID());
  const makeBytes = dependencies.randomBytes || randomBytes;
  const verifier = dependencies.verifier || defaultVerifier;

  return {
    async generateRecoveryCode({ actor, userId, confirmUsername }) {
      validateActor(actor);
      const username = normalizeUsername(confirmUsername);
      if (!UUID_PATTERN.test(String(userId || "")) || !USERNAME_PATTERN.test(username)) {
        throw safeError("Invalid recovery target");
      }
      const recoveryId = makeUuid("recovery");
      const recoveryCode = defaultRandomCode(makeBytes(16));
      const response = await rpc("admin_generate_recovery_code", {
        p_actor_id: actor.userId,
        p_user_id: userId,
        p_confirm_username: username,
        p_recovery_id: recoveryId,
        p_code_verifier: verifier("recovery-code", recoveryCode.replaceAll("-", "")),
      });
      const row = firstRow(response);
      if (
        !row
        || row.recovery_id !== recoveryId
        || !USERNAME_PATTERN.test(normalizeUsername(row.username))
        || !validateTimestamp(row.expires_at)
      ) {
        throw safeError("Recovery backend returned an invalid response", 502);
      }
      return {
        recovery_id: recoveryId,
        username: normalizeUsername(row.username),
        recovery_code: recoveryCode,
        expires_at: row.expires_at,
      };
    },

    async verifyRecoveryCode({ username, recoveryCode, requester }) {
      const normalizedUsername = normalizeUsername(username);
      const normalizedCode = String(recoveryCode || "").normalize("NFKC").trim().toUpperCase();
      if (
        !USERNAME_PATTERN.test(normalizedUsername)
        || !RECOVERY_CODE_PATTERN.test(normalizedCode)
        || typeof requester !== "string"
        || requester.length < 1
        || requester.length > 512
      ) {
        throw safeError("Recovery code is invalid or expired");
      }
      const recoveryToken = makeBytes(32).toString("base64url");
      const recoverySessionId = makeUuid("session");
      const response = await rpc("verify_recovery_code", {
        p_username: normalizedUsername,
        p_code_verifier: verifier("recovery-code", normalizedCode.replaceAll("-", "")),
        p_session_id: recoverySessionId,
        p_token_verifier: verifier("recovery-token", recoveryToken),
        p_requester_verifier: verifier("recovery-requester", requester),
      });
      const row = firstRow(response);
      if (!row) throw safeError("Recovery backend returned an invalid response", 502);
      if (row.ok !== true) {
        if (row.error_code === "recovery_invalid" || row.error_code === "recovery_rate_limited") {
          throw safeError("Recovery code is invalid or expired");
        }
        throw safeError("Recovery backend returned an invalid response", 502);
      }
      if (
        row.recovery_session_id !== recoverySessionId
        || !UUID_PATTERN.test(String(row.user_id || ""))
        || !validateTimestamp(row.expires_at)
      ) {
        throw safeError("Recovery backend returned an invalid response", 502);
      }
      return {
        recovery_session_id: recoverySessionId,
        recovery_session: recoveryToken,
        scope: "change_password",
        expires_at: row.expires_at,
      };
    },

    async changePassword({ recoverySession, newPassword }) {
      if (!TOKEN_PATTERN.test(String(recoverySession || ""))) {
        throw safeError("Recovery session is invalid or expired", 401);
      }
      validatePassword(newPassword);
      const tokenVerifier = verifier("recovery-token", recoverySession);
      const passwordFingerprint = verifier("recovery-password", newPassword);
      if (!HEX_PATTERN.test(tokenVerifier) || !HEX_PATTERN.test(passwordFingerprint)) {
        throw safeError("Recovery verifier configuration is invalid", 500);
      }
      const claim = firstRow(await rpc("claim_recovery_password_change", {
        p_token_verifier: tokenVerifier,
        p_password_fingerprint: passwordFingerprint,
      }));
      if (
        !claim
        || !UUID_PATTERN.test(String(claim.user_id || ""))
        || !UUID_PATTERN.test(String(claim.recovery_id || ""))
        || typeof claim.already_completed !== "boolean"
      ) {
        throw safeError("Recovery backend returned an invalid response", 502);
      }
      if (claim.already_completed) return { completed: true, state: "completed" };

      try {
        await updatePassword(claim.user_id, newPassword);
      } catch {
        try {
          await rpc("release_recovery_password_change", {
            p_token_verifier: tokenVerifier,
            p_password_fingerprint: passwordFingerprint,
            p_failure_code: "auth_update_failed",
          });
        } catch {
          // The claim lease expires server-side. Never expose either internal error.
        }
        throw safeError(
          "Password recovery is temporarily unavailable; retry the same request",
          503,
        );
      }

      const completed = await rpc("complete_recovery_password_change", {
        p_token_verifier: tokenVerifier,
        p_password_fingerprint: passwordFingerprint,
      });
      if (completed !== true) {
        throw safeError(
          "Password was updated but recovery finalization is pending; retry the same request",
          503,
        );
      }
      return { completed: true, state: "completed" };
    },
  };
}

export const accountRecovery = createAccountRecoveryService();
