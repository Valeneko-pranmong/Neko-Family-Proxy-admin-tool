import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import {
  deleteCouponCodes,
  getCouponCodes,
  hasCouponCodes,
  saveCouponCodes,
} from "../standalone/src/coupon-archive.js";
import { renderCoupons } from "../standalone/src/sections/render.js";

const port = 8799;
const supabasePort = 8800;
const base = `http://127.0.0.1:${port}`;

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      // The child process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Local Admin API did not start");
}

function createFakeSupabase() {
  return createServer(async (request, response) => {
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
          ? "admin-id"
          : body.email === "suspended@example.com"
            ? "suspended-id"
            : "customer-id";
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
          { id: "admin-id", email: "admin@example.com" },
          { id: "customer-id", email: "customer@example.com" },
        ],
      }));
      return;
    }
    const authUserId = url.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/)?.[1];
    if (request.method === "GET" && authUserId) {
      const emailById = {
        "admin-id": "admin@example.com",
        "customer-id": "customer@example.com",
        "suspended-id": "suspended@example.com",
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
    if (request.method === "HEAD" && url.pathname === "/rest/v1/profiles") {
      response.writeHead(200, { "Content-Range": "0-0/1" });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/rest/v1/profiles") {
      const id = (url.searchParams.get("id") || "").replace(/^eq\./, "");
      const username = (url.searchParams.get("username") || "").replace(/^eq\./, "");
      const idByUsername = {
        test_admin: "admin-id",
        test_customer: "customer-id",
        test_suspended: "suspended-id",
      };
      const resolvedId = id || idByUsername[username];
      response.writeHead(200, { "Content-Type": "application/json" });
      if (username && !resolvedId) {
        response.end("[]");
      } else if (resolvedId) {
        response.end(JSON.stringify([{
          id: resolvedId,
          display_name: resolvedId === "admin-id" ? "Test Admin" : "Test Customer",
          username: Object.entries(idByUsername).find(([, value]) => value === resolvedId)?.[0],
          role: resolvedId === "admin-id" || resolvedId === "suspended-id" ? "admin" : "customer",
          status: resolvedId === "suspended-id" ? "suspended" : "active",
        }]));
      } else {
        response.end(JSON.stringify([{
          id: "admin-id",
          display_name: "Test Admin",
          username: "test_admin",
          role: "admin",
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }]));
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
        user_id: "customer-id",
        coupon_id: null,
        batch_id: "batch-id",
        succeeded: true,
        error_code: null,
        attempted_at: new Date().toISOString(),
      }]));
      return;
    }
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/)?.[1];
    if (request.method === "POST" && rpc) {
      let text = "";
      for await (const chunk of request) text += chunk;
      const body = JSON.parse(text);
      assert.equal(request.headers["content-profile"], "launcher");
      assert.equal(body.p_actor_id, "admin-id");
      response.writeHead(200, { "Content-Type": "application/json" });
      if (rpc === "admin_generate_coupon_batch") {
        response.end(JSON.stringify(
          Array.from({ length: body.p_quantity }, (_, index) => ({
            batch_id: "generated-batch-id",
            code: `NEKO-TEST-${index + 1}`,
          })),
        ));
        return;
      }
      if (rpc === "admin_revoke_coupon_batch" || rpc === "admin_delete_coupon_batch") {
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
}

test("local admin API accepts Supabase credentials only for role admin", async () => {
  const fakeSupabase = createFakeSupabase();
  fakeSupabase.listen(supabasePort, "127.0.0.1");
  await once(fakeSupabase, "listening");
  const child = spawn(process.execPath, ["admin-api/src/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ADMIN_HOST: "127.0.0.1",
      ADMIN_PORT: String(port),
      SUPABASE_URL: `http://127.0.0.1:${supabasePort}`,
      SUPABASE_SECRET_KEY: "test-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForHealth();
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

    const deleted = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_batch", batchId: "generated-batch-id" }),
    });
    assert.equal(deleted.status, 200);
  } finally {
    child.kill();
    await once(child, "close").catch(() => {});
    fakeSupabase.close();
    await once(fakeSupabase, "close").catch(() => {});
  }
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
