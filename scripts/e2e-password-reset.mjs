import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
if (!supabaseUrl || !secretKey || !publishableKey) {
  throw new Error(
    "SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY are required",
  );
}

const authOptions = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
};
const adminClient = createClient(supabaseUrl, secretKey, authOptions);
const { performAction } = await import("../server/admin.mjs");

const suffix = randomBytes(6).toString("hex");
const username = `e2e_reset_${suffix}`;
const syntheticDomain = new URL(supabaseUrl).hostname;
const email = `${username}@${syntheticDomain}`;
const originalPassword = `Old!A9${randomBytes(12).toString("hex")}`;
const finalPassword = `Final!B8${randomBytes(12).toString("hex")}`;
let targetUserId = "";
let temporaryClient;
let finalClient;

function requireValue(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function customerClient() {
  return createClient(supabaseUrl, publishableKey, authOptions);
}

try {
  const { data: admins, error: adminError } = await adminClient
    .from("profiles")
    .select("id,username,role,status")
    .eq("role", "admin")
    .eq("status", "active")
    .limit(1);
  if (adminError) throw new Error("Could not load an active admin");
  const actor = requireValue(admins?.[0], "No active admin exists");

  const created = await adminClient.auth.admin.createUser({
    email,
    password: originalPassword,
    email_confirm: true,
    user_metadata: { username, display_name: username },
  });
  if (created.error) throw new Error("Could not create disposable Auth user");
  targetUserId = requireValue(created.data.user?.id, "Disposable user has no ID");

  const { data: products, error: productError } = await adminClient
    .from("products")
    .select("id")
    .eq("code", "neko-family-proxy")
    .limit(1);
  if (productError) throw new Error("Could not load product");
  const productId = requireValue(products?.[0]?.id, "Product not found");
  const validUntil = new Date(Date.now() + 2 * 86400000).toISOString();
  const { error: licenseError } = await adminClient.from("licenses").insert({
    user_id: targetUserId,
    product_id: productId,
    status: "active",
    valid_until: validUntil,
  });
  if (licenseError) throw new Error("Could not create disposable license");

  const originalClient = customerClient();
  const originalLogin = await originalClient.auth.signInWithPassword({
    email,
    password: originalPassword,
  });
  if (originalLogin.error || originalLogin.data.user?.id !== targetUserId) {
    throw new Error("Original password login failed");
  }
  const claimed = await originalClient.schema("launcher").rpc("claim_session", {
    p_product_code: "neko-family-proxy",
    p_installation_key_hash: "e".repeat(64),
    p_display_name: "Password reset E2E",
  });
  if (claimed.error || !claimed.data?.session_id) {
    throw new Error("Could not claim disposable Launcher session");
  }

  const reset = await performAction(
    {
      action: "reset_user_password",
      userId: targetUserId,
      confirmUsername: username,
    },
    { userId: actor.id, username: actor.username, role: actor.role, status: actor.status },
  );
  const temporaryPassword = requireValue(
    reset.temporaryPassword,
    "Admin reset did not return a temporary password",
  );

  const { data: sessions, error: sessionError } = await adminClient
    .from("launcher_sessions")
    .select("id,revoked_at")
    .eq("user_id", targetUserId);
  if (sessionError || !sessions?.length || sessions.some((row) => !row.revoked_at)) {
    throw new Error("Launcher session was not revoked");
  }
  await originalClient.auth.signOut();

  const oldPasswordClient = customerClient();
  const oldPasswordLogin = await oldPasswordClient.auth.signInWithPassword({
    email,
    password: originalPassword,
  });
  if (!oldPasswordLogin.error) throw new Error("Original password still works");

  temporaryClient = customerClient();
  const temporaryLogin = await temporaryClient.auth.signInWithPassword({
    email,
    password: temporaryPassword,
  });
  if (temporaryLogin.error || temporaryLogin.data.user?.id !== targetUserId) {
    throw new Error("Temporary password login failed");
  }

  const { data: licenses, error: licenseReadError } = await adminClient
    .from("licenses")
    .select("valid_until")
    .eq("user_id", targetUserId)
    .limit(1);
  if (licenseReadError || licenses?.[0]?.valid_until !== validUntil) {
    throw new Error("License expiry changed during reset");
  }

  const changed = await temporaryClient.auth.updateUser({ password: finalPassword });
  if (changed.error || changed.data.user?.id !== targetUserId) {
    throw new Error("Customer password change failed");
  }
  await temporaryClient.auth.signOut();

  const expiredTemporaryClient = customerClient();
  const expiredTemporaryLogin = await expiredTemporaryClient.auth.signInWithPassword({
    email,
    password: temporaryPassword,
  });
  if (!expiredTemporaryLogin.error) {
    throw new Error("Temporary password still works after customer password change");
  }

  finalClient = customerClient();
  const finalLogin = await finalClient.auth.signInWithPassword({
    email,
    password: finalPassword,
  });
  if (finalLogin.error || finalLogin.data.user?.id !== targetUserId) {
    throw new Error("Final password login failed");
  }

  const { data: audits, error: auditError } = await adminClient
    .from("audit_events")
    .select("event_type,metadata")
    .eq("event_type", "admin_password_reset")
    .contains("metadata", { target_user_id: targetUserId });
  if (auditError || audits?.length !== 1) {
    throw new Error("Admin password reset audit event was not recorded");
  }
  const auditText = JSON.stringify(audits[0]);
  if (/temporary_password|password|secret|token/i.test(auditText)) {
    throw new Error("Audit event contains a forbidden credential field");
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      userIdPreserved: true,
      licensePreserved: true,
      sessionsRevoked: sessions.length,
      auditRecorded: true,
      customerChangedPassword: true,
    })}\n`,
  );
} finally {
  await temporaryClient?.auth.signOut().catch(() => {});
  await finalClient?.auth.signOut().catch(() => {});
  if (targetUserId) {
    await adminClient
      .from("audit_events")
      .delete()
      .eq("event_type", "admin_password_reset")
      .contains("metadata", { target_user_id: targetUserId });
    await adminClient
      .from("launcher_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", targetUserId)
      .is("revoked_at", null);
    await adminClient.auth.admin.deleteUser(targetUserId);
  }
}
