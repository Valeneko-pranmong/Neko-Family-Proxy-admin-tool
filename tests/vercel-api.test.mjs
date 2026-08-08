import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import {
  deleteCouponCodes,
  getCouponCodes,
  hasCouponCodes,
  saveCouponCodes,
} from "../standalone/src/coupon-archive.js";
import {
  renderCoupons,
  renderInstallations,
  renderLicenses,
  renderOverview,
  renderPasswordResetDialog,
  renderProducts,
  renderSessions,
  renderUsers,
} from "../standalone/src/sections/render.js";
import { sections } from "../standalone/src/config.js";

const port = 8799;
const supabasePort = 8800;
const base = `http://127.0.0.1:${port}`;
const adminId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const suspendedId = "33333333-3333-4333-8333-333333333333";
const missingId = "44444444-4444-4444-8444-444444444444";
const installationId = "55555555-5555-4555-8555-555555555555";
const licenseId = "66666666-6666-4666-8666-666666666666";
const sessionId = "77777777-7777-4777-8777-777777777777";

function createFakeSupabase() {
  const control = {
    adminActive: true,
    failAudit: false,
    failAuthUpdate: false,
    failSessionRevoke: false,
    falseRpcs: new Set(),
    invalidTimestampRpcs: new Set(),
    events: [],
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${supabasePort}`);
    if (request.method === "POST" && url.pathname === "/auth/v1/token") {
      let text = "";
      for await (const chunk of request) text += chunk;
      const body = JSON.parse(text);
      if (body.password !== "correct-pass") {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ code: "invalid_credentials", msg: "Invalid login credentials" }));
        return;
      }
      const id =
        body.email === "admin@example.com"
          ? adminId
          : body.email === "suspended@example.com"
            ? suspendedId
            : customerId;
      const now = new Date().toISOString();
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        access_token: "fake-access-token",
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "fake-refresh-token",
        user: {
          id,
          aud: "authenticated",
          role: "authenticated",
          email: body.email,
          email_confirmed_at: now,
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: {},
          identities: [],
          created_at: now,
          updated_at: now,
          is_anonymous: false,
        },
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/auth/v1/admin/users") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        users: [
          { id: adminId, email: "admin@example.com" },
          { id: customerId, email: "customer@example.com" },
        ],
      }));
      return;
    }
    const authUserId = url.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/)?.[1];
    if (request.method === "GET" && authUserId) {
      const emailById = {
        [adminId]: "admin@example.com",
        [customerId]: "customer@example.com",
        [suspendedId]: "suspended@example.com",
      };
      const email = emailById[authUserId];
      if (!email) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "User not found" }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: authUserId, email }));
      return;
    }
    if (request.method === "PUT" && authUserId) {
      let text = "";
      for await (const chunk of request) text += chunk;
      const body = JSON.parse(text);
      control.events.push({
        type: "auth_update",
        userId: authUserId,
        password: body.password,
      });
      if (control.failAuthUpdate) {
        response.writeHead(502, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "Auth unavailable" }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: authUserId, email: "customer@example.com" }));
      return;
    }
    if (request.method === "HEAD" && url.pathname === "/rest/v1/profiles") {
      response.writeHead(200, { "Content-Range": "0-0/1" });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/rest/v1/profiles") {
      const id = (url.searchParams.get("id") || "").replace(/^eq\./, "");
      const username = (url.searchParams.get("username") || "").replace(/^eq\./, "");
      const idByUsername = {
        test_admin: adminId,
        test_customer: customerId,
        test_suspended: suspendedId,
      };
      const knownIds = new Set([adminId, customerId, suspendedId]);
      const resolvedId = id ? (knownIds.has(id) ? id : null) : idByUsername[username];
      response.writeHead(200, { "Content-Type": "application/json" });
      if ((id || username) && !resolvedId) {
        response.end("[]");
      } else if (resolvedId) {
        response.end(JSON.stringify([{
          id: resolvedId,
          display_name: resolvedId === adminId ? "Test Admin" : "Test Customer",
          username: Object.entries(idByUsername).find(([, value]) => value === resolvedId)?.[0],
          role: resolvedId === adminId || resolvedId === suspendedId ? "admin" : "customer",
          status:
            resolvedId === suspendedId || (resolvedId === adminId && !control.adminActive)
              ? "suspended"
              : "active",
        }]));
      } else {
        response.end(JSON.stringify([
          {
            id: adminId,
            display_name: "Test Admin",
            username: "test_admin",
            role: "admin",
            status: control.adminActive ? "active" : "suspended",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: customerId,
            display_name: "Test Customer",
            username: "test_customer",
            role: "customer",
            status: "active",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]));
      }
      return;
    }
    if (request.method === "GET" && url.pathname === "/rest/v1/products") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify([{
        id: "product-id",
        code: "neko-family-proxy",
        name: "Neko Family Proxy",
        max_devices: 1,
        is_active: true,
        created_at: new Date().toISOString(),
      }]));
      return;
    }
    if (request.method === "GET" && url.pathname === "/rest/v1/installations") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify([
        {
          id: "installation-id",
          user_id: customerId,
          display_name: "Office PC",
          installation_key_hash: "a".repeat(64),
          last_seen_at: "2026-08-08T00:00:00.000Z",
          revoked_at: null,
          created_at: "2026-08-01T00:00:00.000Z",
        },
        {
          id: "legacy-installation-id",
          user_id: customerId,
          display_name: "Legacy PC",
          installation_key_hash: null,
          last_seen_at: "2026-07-08T00:00:00.000Z",
          revoked_at: "2026-07-09T00:00:00.000Z",
          created_at: "2026-07-01T00:00:00.000Z",
        },
      ]));
      return;
    }
    if (request.method === "GET" && url.pathname === "/rest/v1/launcher_sessions") {
      response.writeHead(200, { "Content-Type": "application/json" });
      const offset = Number(url.searchParams.get("offset") || 0);
      const activeOnly = url.searchParams.get("revoked_at") === "is.null";
      if (activeOnly && offset === 0) {
        response.end(JSON.stringify(Array.from({ length: 1000 }, (_, index) => ({
          id: `historical-session-${index}`,
          user_id: customerId,
          installation_id: `historical-installation-${index}`,
          license_id: "license-id",
          created_at: "2026-08-07T00:00:00.000Z",
          last_seen_at: "2026-08-07T00:01:00.000Z",
          revoked_at: null,
        }))));
        return;
      }
      if (activeOnly && offset === 1000) {
        response.end(JSON.stringify([{
          id: "session-id",
          user_id: customerId,
          installation_id: "installation-id",
          license_id: "license-id",
          created_at: "2026-08-08T00:00:00.000Z",
          last_seen_at: "2026-08-08T00:01:00.000Z",
          revoked_at: null,
        }]));
        return;
      }
      if (activeOnly) {
        response.end("[]");
        return;
      }
      response.end(JSON.stringify([{
        id: "session-id",
        user_id: customerId,
        installation_id: "installation-id",
        license_id: "license-id",
        created_at: "2026-08-08T00:00:00.000Z",
        last_seen_at: "2026-08-08T00:01:00.000Z",
        revoked_at: null,
      }]));
      return;
    }
    if (request.method === "GET" && url.pathname === "/rest/v1/coupon_batches") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify([{
        id: "batch-id",
        product_id: "product-id",
        duration_days: 30,
        quantity: 2,
        note: "Disposable batch",
        created_at: new Date().toISOString(),
        revoked_at: null,
      }]));
      return;
    }
    if (request.method === "GET" && url.pathname === "/rest/v1/coupons") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify([{
        id: "remaining-coupon-id",
        batch_id: "batch-id",
        status: "active",
        redeemed_by: null,
        redeemed_at: null,
        created_at: new Date().toISOString(),
      }]));
      return;
    }
    if (
      request.method === "GET"
      && url.pathname === "/rest/v1/coupon_redemption_attempts"
    ) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify([{
        id: 1,
        user_id: customerId,
        coupon_id: null,
        batch_id: "batch-id",
        succeeded: true,
        error_code: null,
        attempted_at: new Date().toISOString(),
      }]));
      return;
    }
    if (request.method === "PATCH" && url.pathname === "/rest/v1/launcher_sessions") {
      let text = "";
      for await (const chunk of request) text += chunk;
      control.events.push({ type: "session_revoke", body: JSON.parse(text) });
      if (control.failSessionRevoke) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "Database unavailable" }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify([{ id: "session-1" }, { id: "session-2" }]));
      return;
    }
    if (request.method === "POST" && url.pathname === "/rest/v1/audit_events") {
      let text = "";
      for await (const chunk of request) text += chunk;
      const body = JSON.parse(text);
      control.events.push({ type: "audit", body });
      if (control.failAudit) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "internal-audit-detail" }));
        return;
      }
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(JSON.stringify([body]));
      return;
    }
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/)?.[1];
    if (request.method === "POST" && rpc) {
      let text = "";
      for await (const chunk of request) text += chunk;
      const body = JSON.parse(text);
      assert.equal(request.headers["content-profile"], "launcher");
      assert.equal(body.p_actor_id, adminId);
      control.events.push({ type: "rpc", rpc, body });
      response.writeHead(200, { "Content-Type": "application/json" });
      if (control.falseRpcs.has(rpc)) {
        response.end("false");
        return;
      }
      if (control.invalidTimestampRpcs.has(rpc)) {
        response.end(JSON.stringify("not-a-timestamp"));
        return;
      }
      if (rpc === "admin_generate_coupon_batch") {
        response.end(JSON.stringify(
          Array.from({ length: body.p_quantity }, (_, index) => ({
            batch_id: "generated-batch-id",
            code: `NEKO-TEST-${index + 1}`,
          })),
        ));
        return;
      }
      if (rpc === "admin_extend_license") {
        response.end(JSON.stringify("2026-09-30T00:00:00.000Z"));
        return;
      }
      if (
        rpc === "admin_set_user_status"
        || rpc === "admin_revoke_license"
        || rpc === "admin_revoke_session"
        || rpc === "admin_revoke_installation"
        || rpc === "admin_revoke_coupon_batch"
        || rpc === "admin_delete_coupon_batch"
      ) {
        response.end("true");
        return;
      }
    }
    const emptyTables = new Set([
      "products",
      "licenses",
      "installations",
      "launcher_sessions",
      "audit_events",
      "coupon_batches",
      "coupons",
      "coupon_redemption_attempts",
    ]);
    const table = url.pathname.match(/^\/rest\/v1\/([^/]+)$/)?.[1];
    if (table && emptyTables.has(table) && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("[]");
      return;
    }
    if (table && emptyTables.has(table) && request.method === "HEAD") {
      response.writeHead(200, { "Content-Range": "0-0/0" });
      response.end();
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ message: "Not found" }));
  });
  server.control = control;
  return server;
}

test("Vercel API accepts Supabase credentials only for role admin", async () => {
  const fakeSupabase = createFakeSupabase();
  fakeSupabase.listen(supabasePort, "127.0.0.1");
  await once(fakeSupabase, "listening");
  process.env.SUPABASE_URL = `http://127.0.0.1:${supabasePort}`;
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  process.env.ADMIN_SESSION_SECRET =
    "test-session-secret-that-is-long-enough-for-hmac-signing";
  const { default: handler } = await import(
    `../api/index.mjs?test=${Date.now()}`
  );
  const apiServer = createServer(handler);
  apiServer.listen(port, "127.0.0.1");
  await once(apiServer, "listening");

  try {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);

    const wrongLogin = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test_admin", password: "wrong" }),
    });
    assert.equal(wrongLogin.status, 401);

    const customerLogin = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test_customer", password: "correct-pass" }),
    });
    assert.equal(customerLogin.status, 403);

    const suspendedLogin = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test_suspended", password: "correct-pass" }),
    });
    assert.equal(suspendedLogin.status, 403);

    const unauthenticated = await fetch(`${base}/api/admin?resource=overview`);
    assert.equal(unauthenticated.status, 401);
    const unauthenticatedReset = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reset_user_password",
        userId: customerId,
        confirmUsername: "test_customer",
      }),
    });
    assert.equal(unauthenticatedReset.status, 401);

    const login = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test_admin", password: "correct-pass" }),
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get("set-cookie") || "", /admin_session=/);
    const loginBody = await login.json();
    assert.equal(loginBody.viewer.role, "admin");
    assert.equal(loginBody.viewer.status, "active");
    assert.equal(loginBody.viewer.username, "test_admin");

    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    const resources = [
      "overview",
      "users",
      "products",
      "licenses",
      "coupons",
      "redemptions",
      "installations",
      "sessions",
      "audit",
    ];
    for (const resource of resources) {
      const response = await fetch(`${base}/api/admin?resource=${resource}`, {
        headers: { Cookie: cookie },
      });
      assert.equal(response.status, 200, `${resource} should load`);
      const payload = await response.json();
      assert.equal(payload.resource, resource);
      if (resource === "coupons") {
        assert.equal(payload.data[0].active_count, 1);
        assert.equal(payload.data[0].redeemed_count, 1);
        assert.equal(payload.data[0].actual_quantity, 2);
      }
      if (resource === "redemptions") {
        assert.equal(payload.data[0].batch, "Disposable batch");
        assert.equal(payload.data[0].product, "Neko Family Proxy");
      }
      if (resource === "installations") {
        assert.equal(payload.data[0].installation_key_hash_masked, "aaaa…aaaa");
        assert.equal("installation_key_hash" in payload.data[0], false);
        assert.equal(payload.data[0].owns_active_session, true);
        assert.equal(
          payload.data[0].active_session_created_at,
          "2026-08-08T00:00:00.000Z",
        );
        assert.equal(
          payload.data[0].active_session_last_seen_at,
          "2026-08-08T00:01:00.000Z",
        );
        assert.equal(payload.data[1].installation_key_hash_masked, "—");
        assert.equal("installation_key_hash" in payload.data[1], false);
      }
    }

    const generated = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "generate_coupons",
        productCode: "neko-family-proxy",
        durationDays: 30,
        quantity: 2,
      }),
    });
    assert.equal(generated.status, 200);
    assert.deepEqual((await generated.json()).codes, ["NEKO-TEST-1", "NEKO-TEST-2"]);

    const adminActionCases = [
      {
        payload: { action: "set_user_status", userId: customerId, status: "suspended" },
        rpc: "admin_set_user_status",
        rpcBody: {
          p_actor_id: adminId,
          p_user_id: customerId,
          p_status: "suspended",
        },
      },
      {
        payload: { action: "revoke_installation", installationId },
        rpc: "admin_revoke_installation",
        rpcBody: {
          p_actor_id: adminId,
          p_installation_id: installationId,
        },
      },
      {
        payload: { action: "revoke_license", licenseId },
        rpc: "admin_revoke_license",
        rpcBody: {
          p_actor_id: adminId,
          p_license_id: licenseId,
        },
      },
      {
        payload: { action: "extend_license", licenseId, days: 30 },
        rpc: "admin_extend_license",
        rpcBody: {
          p_actor_id: adminId,
          p_license_id: licenseId,
          p_days: 30,
        },
      },
      {
        payload: { action: "revoke_session", sessionId },
        rpc: "admin_revoke_session",
        rpcBody: {
          p_actor_id: adminId,
          p_session_id: sessionId,
        },
      },
    ];
    for (const actionCase of adminActionCases) {
      const eventsBeforeAction = fakeSupabase.control.events.length;
      const response = await fetch(`${base}/api/admin`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify(actionCase.payload),
      });
      assert.equal(response.status, 200, `${actionCase.payload.action} should succeed`);
      assert.deepEqual(
        fakeSupabase.control.events.slice(eventsBeforeAction),
        [{ type: "rpc", rpc: actionCase.rpc, body: actionCase.rpcBody }],
      );
    }

    const eventsBeforeInvalidInstallation = fakeSupabase.control.events.length;
    const invalidInstallation = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke_installation", installationId: "not-a-uuid" }),
    });
    assert.equal(invalidInstallation.status, 400);
    assert.equal(fakeSupabase.control.events.length, eventsBeforeInvalidInstallation);

    fakeSupabase.control.falseRpcs.add("admin_revoke_installation");
    const missingInstallation = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke_installation", installationId }),
    });
    assert.equal(missingInstallation.status, 404);
    assert.deepEqual(await missingInstallation.json(), { ok: false, error: "ไม่พบ installation" });
    fakeSupabase.control.falseRpcs.delete("admin_revoke_installation");

    const falseRpcCases = [
      ["set_user_status", "admin_set_user_status", { userId: customerId, status: "suspended" }],
      ["revoke_license", "admin_revoke_license", { licenseId }],
      ["revoke_session", "admin_revoke_session", { sessionId }],
    ];
    for (const [action, rpc, fields] of falseRpcCases) {
      fakeSupabase.control.falseRpcs.add(rpc);
      const response = await fetch(`${base}/api/admin`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...fields }),
      });
      assert.equal(response.status, 404, `${action} false RPC result should be safe failure`);
      assert.equal((await response.json()).ok, false);
      fakeSupabase.control.falseRpcs.delete(rpc);
    }

    fakeSupabase.control.invalidTimestampRpcs.add("admin_extend_license");
    const invalidTimestamp = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "extend_license", licenseId, days: 30 }),
    });
    assert.equal(invalidTimestamp.status, 404);
    assert.equal((await invalidTimestamp.json()).ok, false);
    fakeSupabase.control.invalidTimestampRpcs.delete("admin_extend_license");

    const invalidStatus = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set_user_status",
        userId: customerId,
        status: "not-a-status",
      }),
    });
    assert.equal(invalidStatus.status, 400);
    assert.deepEqual(await invalidStatus.json(), { ok: false, error: "สถานะสมาชิกไม่ถูกต้อง" });

    const selfRestriction = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set_user_status",
        userId: adminId,
        status: "suspended",
      }),
    });
    assert.equal(selfRestriction.status, 403);
    assert.deepEqual(await selfRestriction.json(), {
      ok: false,
      error: "ไม่สามารถระงับบัญชีผู้ดูแลที่กำลังใช้งานอยู่",
    });

    const mismatch = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reset_user_password",
        userId: customerId,
        confirmUsername: "wrong_customer",
      }),
    });
    assert.equal(mismatch.status, 400);

    const missingTarget = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reset_user_password",
        userId: missingId,
        confirmUsername: "missing_customer",
      }),
    });
    assert.equal(missingTarget.status, 404);

    const selfReset = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reset_user_password",
        userId: adminId,
        confirmUsername: "test_admin",
      }),
    });
    assert.equal(selfReset.status, 403);

    const adminTarget = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reset_user_password",
        userId: suspendedId,
        confirmUsername: "test_suspended",
      }),
    });
    assert.equal(adminTarget.status, 403);

    const beforeSuccess = fakeSupabase.control.events.length;
    const reset = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reset_user_password",
        userId: customerId,
        confirmUsername: " TEST_CUSTOMER ",
      }),
    });
    assert.equal(reset.status, 200);
    assert.equal(reset.headers.get("cache-control"), "no-store");
    const resetBody = await reset.json();
    assert.match(resetBody.temporaryPassword, /[A-Z]/);
    assert.match(resetBody.temporaryPassword, /[a-z]/);
    assert.match(resetBody.temporaryPassword, /[0-9]/);
    assert.match(resetBody.temporaryPassword, /[^A-Za-z0-9]/);
    assert.ok(resetBody.temporaryPassword.length >= 16);
    const resetEvents = fakeSupabase.control.events.slice(beforeSuccess);
    assert.deepEqual(resetEvents.map((event) => event.type), [
      "session_revoke",
      "auth_update",
      "audit",
    ]);
    assert.equal(resetEvents[2].body.event_type, "admin_password_reset");
    assert.equal(resetEvents[2].body.metadata.sessions_revoked, 2);
    assert.deepEqual(Object.keys(resetEvents[2].body.metadata).sort(), [
      "sessions_revoked",
      "target_user_id",
      "target_username",
    ]);
    assert.doesNotMatch(
      JSON.stringify(resetEvents[2].body.metadata),
      new RegExp(resetBody.temporaryPassword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );

    fakeSupabase.control.failSessionRevoke = true;
    const eventsBeforeRevokeFailure = fakeSupabase.control.events.length;
    const revokeFailure = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reset_user_password",
        userId: customerId,
        confirmUsername: "test_customer",
      }),
    });
    assert.equal(revokeFailure.status, 502);
    assert.equal(
      fakeSupabase.control.events.slice(eventsBeforeRevokeFailure).some(
        (event) => event.type === "auth_update",
      ),
      false,
    );
    assert.equal("temporaryPassword" in await revokeFailure.json(), false);
    fakeSupabase.control.failSessionRevoke = false;

    fakeSupabase.control.failAuthUpdate = true;
    const authFailure = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reset_user_password",
        userId: customerId,
        confirmUsername: "test_customer",
      }),
    });
    assert.equal(authFailure.status, 502);
    assert.equal("temporaryPassword" in await authFailure.json(), false);
    fakeSupabase.control.failAuthUpdate = false;

    fakeSupabase.control.failAudit = true;
    const auditFailure = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reset_user_password",
        userId: customerId,
        confirmUsername: "test_customer",
      }),
    });
    assert.equal(auditFailure.status, 500);
    const auditFailureBody = await auditFailure.json();
    assert.equal("temporaryPassword" in auditFailureBody, false);
    assert.doesNotMatch(JSON.stringify(auditFailureBody), /internal-audit-detail/);
    fakeSupabase.control.failAudit = false;

    const deleted = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_batch", batchId: "generated-batch-id" }),
    });
    assert.equal(deleted.status, 200);

    fakeSupabase.control.adminActive = false;
    const inactiveSession = await fetch(`${base}/api/admin?resource=overview`, {
      headers: { Cookie: cookie },
    });
    assert.equal(inactiveSession.status, 401);
    fakeSupabase.control.adminActive = true;
  } finally {
    apiServer.close();
    await once(apiServer, "close").catch(() => {});
    fakeSupabase.close();
    await once(fakeSupabase, "close").catch(() => {});
  }
});

test("password reset controls are limited to customers and clearable from the DOM", () => {
  const users = renderUsers([
    { id: customerId, username: "test_customer", role: "customer", status: "active" },
    { id: adminId, username: "test_admin", role: "admin", status: "active" },
  ]);
  assert.equal((users.match(/data-action="reset_user_password"/g) || []).length, 1);
  assert.match(users, new RegExp(`data-id="${customerId}"`));

  const success = renderPasswordResetDialog({
    userId: customerId,
    username: "test_customer",
    phase: "success",
    temporaryPassword: "Temp-Password-123!",
  });
  assert.match(success, /Temp-Password-123!/);
  assert.match(success, /data-action="copy_temporary_password"/);
  assert.equal(renderPasswordResetDialog(null), "");
});

test("standalone bundle contains no server credential", () => {
  const bundle = readFileSync("standalone/dist/neko-control.html", "utf8");
  assert.doesNotMatch(bundle, /SUPABASE_SECRET_KEY|test-secret/);
});

test("coupon rows expose safe management actions", () => {
  const html = renderCoupons([
    {
      id: "active-batch",
      batch: "active",
      product: "Neko Family Proxy",
      product_code: "neko-family-proxy",
      duration_days: 30,
      active_count: 1,
      actual_quantity: 1,
      redeemed_count: 0,
      status: "active",
      has_archived_codes: true,
    },
    {
      id: "revoked-batch",
      batch: "revoked",
      product: "Neko Family Proxy",
      product_code: "neko-family-proxy",
      duration_days: 30,
      active_count: 0,
      actual_quantity: 1,
      redeemed_count: 0,
      status: "revoked",
      has_archived_codes: false,
    },
    {
      id: "used-batch",
      batch: "used",
      product: "Neko Family Proxy",
      product_code: "neko-family-proxy",
      duration_days: 30,
      active_count: 0,
      actual_quantity: 1,
      redeemed_count: 1,
      status: "revoked",
      has_archived_codes: false,
    },
  ]);

  assert.match(html, /data-action="copy_coupon_codes" data-id="active-batch"/);
  assert.match(html, /data-action="revoke_batch" data-id="active-batch"/);
  assert.match(html, /data-action="delete_batch" data-id="revoked-batch"/);
  assert.doesNotMatch(html, /data-action="delete_batch" data-id="used-batch"/);
});

test("installation history is distinct from the current active session", () => {
  const html = renderInstallations([
    {
      id: "installation-active",
      username: "test_customer",
      display_name: "Office PC",
      installation_key_hash_masked: "aaaa…aaaa",
      created_at: "2026-08-01T00:00:00.000Z",
      last_seen_at: "2026-08-08T00:00:00.000Z",
      revoked_at: null,
      owns_active_session: true,
      active_session_created_at: "2026-08-08T00:00:00.000Z",
      active_session_last_seen_at: "2026-08-08T00:01:00.000Z",
    },
    {
      id: "installation-history",
      username: "test_customer",
      display_name: "Home PC",
      installation_key_hash_masked: "bbbb…bbbb",
      created_at: "2026-07-01T00:00:00.000Z",
      last_seen_at: "2026-07-02T00:00:00.000Z",
      revoked_at: null,
      owns_active_session: false,
      active_session_created_at: null,
      active_session_last_seen_at: null,
    },
  ]);

  assert.match(html, /ติดตั้งที่จดจำไว้/);
  assert.match(html, /เซสชันปัจจุบัน/);
  assert.match(html, /aaaa…aaaa/);
  assert.doesNotMatch(html, new RegExp("a{64}"));
  assert.match(html, /เครื่องที่กำลังใช้งาน/);
  assert.match(html, /ประวัติการติดตั้ง/);
  assert.match(html, /บล็อกเฉพาะการติดตั้งนี้/);
  assert.match(html, /หากต้องการบล็อกทุกเครื่อง ให้ระงับบัญชีแทน/);
});

test("deprecated max-device fields are not presented as the active session policy", () => {
  const products = renderProducts([
    {
      id: "product-id",
      code: "neko-family-proxy",
      name: "Neko Family Proxy",
      max_devices: 1,
      is_active: true,
      created_at: "2026-08-01T00:00:00.000Z",
    },
  ]);
  const licenses = renderLicenses([
    {
      id: "license-id",
      username: "test_customer",
      product: "Neko Family Proxy",
      product_code: "neko-family-proxy",
      status: "active",
      valid_from: "2026-08-01T00:00:00.000Z",
      valid_until: "2026-09-01T00:00:00.000Z",
      max_devices: 1,
    },
  ]);

  assert.doesNotMatch(products, /อุปกรณ์สูงสุด/);
  assert.doesNotMatch(licenses, />อุปกรณ์</);
  assert.match(products, /ใช้งานพร้อมกันได้หนึ่งเครื่อง/);
  assert.match(licenses, /การลงชื่อเข้าใช้จากเครื่องใหม่จะแทนที่เซสชันเดิม/);
});

test("overview and session history wording do not imply concurrent online devices", () => {
  const overview = renderOverview({
    stats: { activeInstallations: 2, activeSessions: 1 },
  });
  const sessions = renderSessions([
    {
      id: sessionId,
      username: "test_customer",
      device: "Office PC",
      license_id: licenseId,
      created_at: "2026-08-08T00:00:00.000Z",
      last_seen_at: "2026-08-08T00:01:00.000Z",
      revoked_at: null,
    },
  ]);
  const sessionNavigation = sections.find((section) => section.id === "sessions");

  assert.match(overview, /การติดตั้งที่จดจำ/);
  assert.doesNotMatch(overview, /อุปกรณ์ที่ใช้งาน/);
  assert.match(overview, /Session ปัจจุบัน/);
  assert.match(sessions, /ประวัติ Launcher session/);
  assert.match(sessions, /แต่ละบัญชีมี session ปัจจุบันได้หนึ่งรายการ/);
  assert.doesNotMatch(sessions, /เซสชันออนไลน์/);
  assert.equal(sessionNavigation?.label, "Launcher sessions");

  const launcherMain = readFileSync("standalone/src/main.js", "utf8");
  assert.match(
    launcherMain,
    /จะยกเลิกทุก installation และ Launcher session ปัจจุบัน/,
  );
});

test("coupon codes can be archived and removed in browser storage", () => {
  const values = new Map();
  global.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };
  try {
    assert.equal(saveCouponCodes("batch-1", ["NEKO-ONE", "NEKO-TWO"]), true);
    assert.equal(hasCouponCodes("batch-1"), true);
    assert.deepEqual(getCouponCodes("batch-1"), ["NEKO-ONE", "NEKO-TWO"]);
    deleteCouponCodes("batch-1");
    assert.deepEqual(getCouponCodes("batch-1"), []);
  } finally {
    delete global.window;
  }
});
