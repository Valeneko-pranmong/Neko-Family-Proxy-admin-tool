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
  renderRecoveryCodeDialog,
  renderProducts,
  renderSessions,
  renderUsers,
} from "../standalone/src/sections/render.js";
import { sections } from "../standalone/src/config.js";
import { escapeHtml } from "../standalone/src/ui/escape.js";

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
const batchId = "88888888-8888-4888-8888-888888888888";

function createFakeSupabase() {
  const control = {
    adminActive: true,
    failAudit: false,
    failAuthUpdate: false,
    failSessionRevoke: false,
    falseRpcs: new Set(),
    invalidBooleanRpcs: new Set(),
    invalidTimestampRpcs: new Set(),
    errorRpcs: new Map(),
    serverMetrics: null,
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
      if (rpc.startsWith("admin_")) assert.equal(body.p_actor_id, adminId);
      control.events.push({ type: "rpc", rpc, body });
      if (control.errorRpcs.has(rpc)) {
        const rpcError = control.errorRpcs.get(rpc);
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          code: typeof rpcError === "object" ? rpcError.code : "P0001",
          message: typeof rpcError === "object" ? rpcError.message : rpcError,
        }));
        return;
      }
      if (rpc === "store_server_metrics_sample") {
        control.serverMetricsHistory ||= [];
        const existing = control.serverMetricsHistory.find(
          (h) => h.server_id === body.p_server_id && h.observed_at === body.p_observed_at,
        );
        if (existing) {
          const isIdentical =
            existing.rx_bytes_total === body.p_rx_bytes_total &&
            existing.tx_bytes_total === body.p_tx_bytes_total &&
            existing.rx_bps === body.p_rx_bps &&
            existing.tx_bps === body.p_tx_bps &&
            existing.host_uptime_seconds === body.p_host_uptime_seconds &&
            existing.shadowsocks_service_status === body.p_shadowsocks_service_status &&
            existing.shadowsocks_listener_status === body.p_shadowsocks_listener_status &&
            existing.ping_status === body.p_ping_status;
          if (isIdentical) {
            response.writeHead(200, { "Content-Type": "application/json" });
            response.end(
              JSON.stringify({
                ok: true,
                history_inserted: false,
                latest_updated: false,
                is_idempotent_retry: true,
              }),
            );
            return;
          }
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              code: "P0001",
              message: "sample_conflict",
            }),
          );
          return;
        }

        control.serverMetricsHistory.push({
          server_id: body.p_server_id,
          observed_at: body.p_observed_at,
          host_uptime_seconds: body.p_host_uptime_seconds,
          shadowsocks_service_status: body.p_shadowsocks_service_status,
          shadowsocks_listener_status: body.p_shadowsocks_listener_status,
          ping_ms: body.p_ping_ms,
          ping_status: body.p_ping_status,
          packet_loss_percent: body.p_packet_loss_percent,
          rx_bytes_total: body.p_rx_bytes_total,
          tx_bytes_total: body.p_tx_bytes_total,
          rx_bps: body.p_rx_bps,
          tx_bps: body.p_tx_bps,
          cpu_percent: body.p_cpu_percent,
          memory_percent: body.p_memory_percent,
        });

        let latestUpdated = false;
        if (!control.serverMetrics || body.p_observed_at > control.serverMetrics.observed_at) {
          control.serverMetrics = {
            server_id: body.p_server_id,
            observed_at: body.p_observed_at,
            host_uptime_seconds: body.p_host_uptime_seconds,
            shadowsocks_service_status: body.p_shadowsocks_service_status,
            shadowsocks_listener_status: body.p_shadowsocks_listener_status,
            ping_ms: body.p_ping_ms,
            ping_status: body.p_ping_status,
            packet_loss_percent: body.p_packet_loss_percent,
            rx_bytes_total: body.p_rx_bytes_total,
            tx_bytes_total: body.p_tx_bytes_total,
            rx_bps: body.p_rx_bps,
            tx_bps: body.p_tx_bps,
            cpu_percent: body.p_cpu_percent,
            memory_percent: body.p_memory_percent,
          };
          latestUpdated = true;
        }

        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            ok: true,
            history_inserted: true,
            latest_updated: latestUpdated,
            is_idempotent_retry: false,
          }),
        );
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      if (control.falseRpcs.has(rpc)) {
        response.end("false");
        return;
      }
      if (control.invalidBooleanRpcs.has(rpc)) {
        response.end(JSON.stringify({ unexpected: true }));
        return;
      }
      if (control.invalidTimestampRpcs.has(rpc)) {
        response.end(JSON.stringify(control.invalidTimestampValue || "not-a-timestamp"));
        return;
      }
      if (rpc === "admin_generate_coupon_batch") {
        response.end(JSON.stringify(
          Array.from({ length: body.p_quantity }, (_, index) => ({
            batch_id: batchId,
            code: `NEKO-TEST-${index + 1}`,
          })),
        ));
        return;
      }
      if (rpc === "admin_extend_license") {
        response.end(JSON.stringify("2026-09-30T00:00:00.000Z"));
        return;
      }
      if (rpc === "admin_generate_recovery_code") {
        response.end(JSON.stringify([{
          recovery_id: body.p_recovery_id,
          username: "test_customer",
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        }]));
        return;
      }
      if (rpc === "verify_recovery_code") {
        response.end(JSON.stringify([{
          ok: true,
          error_code: null,
          recovery_session_id: body.p_session_id,
          user_id: customerId,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        }]));
        return;
      }
      if (rpc === "claim_recovery_password_change") {
        response.end(JSON.stringify([{
          user_id: customerId,
          recovery_id: "99999999-9999-4999-8999-999999999999",
          already_completed: false,
        }]));
        return;
      }
      if (
        rpc === "release_recovery_password_change"
        || rpc === "complete_recovery_password_change"
      ) {
        response.end("true");
        return;
      }
      if (
        rpc === "admin_set_user_status"
        || rpc === "admin_revoke_license"
        || rpc === "admin_revoke_session"
        || rpc === "admin_revoke_coupon_batch"
        || rpc === "admin_delete_coupon_batch"
      ) {
        response.end("true");
        return;
      }
      if (rpc === "upsert_server_metrics_latest") {
        if (control.serverMetrics && body.p_observed_at <= control.serverMetrics.observed_at) {
          response.end("false");
          return;
        }
        control.serverMetrics = {
          server_id: body.p_server_id,
          observed_at: body.p_observed_at,
          host_uptime_seconds: body.p_host_uptime_seconds,
          shadowsocks_service_status: body.p_shadowsocks_service_status,
          shadowsocks_listener_status: body.p_shadowsocks_listener_status,
          ping_ms: body.p_ping_ms,
          ping_status: body.p_ping_status,
          packet_loss_percent: body.p_packet_loss_percent,
          rx_bytes_total: body.p_rx_bytes_total,
          tx_bytes_total: body.p_tx_bytes_total,
          rx_bps: body.p_rx_bps,
          tx_bps: body.p_tx_bps,
          cpu_percent: body.p_cpu_percent,
          memory_percent: body.p_memory_percent,
        };
        response.end("true");
        return;
      }
      if (rpc === "query_server_metrics_history") {
        control.serverMetricsHistory ||= [];
        const serverId = body.p_server_id || "japan-vps-1";
        const range = body.p_range || "1h";
        const points = control.serverMetricsHistory
          .filter((h) => h.server_id === serverId)
          .map((h) => ({
            bucket_start: h.observed_at,
            sample_count: 1,
            rx_bps_avg: h.rx_bps,
            rx_bps_max: h.rx_bps,
            tx_bps_avg: h.tx_bps,
            tx_bps_max: h.tx_bps,
            ping_ms_avg: h.ping_ms,
            ping_ms_min: h.ping_ms,
            ping_ms_max: h.ping_ms,
            packet_loss_percent_avg: h.packet_loss_percent,
            packet_loss_percent_max: h.packet_loss_percent,
            shadowsocks_service_healthy: h.shadowsocks_service_status === "active",
            shadowsocks_listener_healthy: h.shadowsocks_listener_status === "listening",
            had_service_failure: h.shadowsocks_service_status !== "active",
            had_listener_failure: h.shadowsocks_listener_status !== "listening",
          }));
        response.end(
          JSON.stringify({
            ok: true,
            server_id: serverId,
            range,
            bucket_seconds: range === "1h" ? 60 : range === "24h" ? 300 : 1800,
            window_start: new Date(Date.now() - 3600000).toISOString(),
            window_end: new Date().toISOString(),
            available_since: control.serverMetricsHistory[0]?.observed_at || null,
            points_count: points.length,
            points,
          }),
        );
        return;
      }
      if (rpc === "prune_server_metrics_history") {
        control.serverMetricsHistory ||= [];
        const cutoff = new Date(Date.now() - (body.p_retention_days || 7) * 86400000).toISOString();
        const before = control.serverMetricsHistory.length;
        control.serverMetricsHistory = control.serverMetricsHistory.filter((h) => h.observed_at >= cutoff);
        response.end(JSON.stringify(before - control.serverMetricsHistory.length));
        return;
      }
    }
    if (request.method === "GET" && url.pathname === "/rest/v1/server_metrics_latest") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(control.serverMetrics ? [control.serverMetrics] : []));
      return;
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
  process.env.ACCOUNT_RECOVERY_HMAC_SECRET =
    "test-recovery-hmac-secret-that-is-long-enough";
  process.env.SERVER_METRICS_INGEST_SECRET =
    "test-server-metrics-ingest-secret-32-bytes";
  process.env.VERCEL = "1";
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
    const unauthenticatedRecovery = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "generate_recovery_code",
        userId: customerId,
        confirmUsername: "test_customer",
      }),
    });
    assert.equal(unauthenticatedRecovery.status, 401);

    const login = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test_admin", password: "correct-pass" }),
    });
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get("set-cookie") || "";
    assert.match(loginCookie, /admin_session=/);
    assert.match(loginCookie, /HttpOnly/i);
    assert.match(loginCookie, /SameSite=Strict/i);
    assert.match(loginCookie, /Path=\//i);
    assert.match(loginCookie, /Max-Age=28800/i);
    assert.match(loginCookie, /Secure/i);
    const loginBody = await login.json();
    assert.equal(loginBody.viewer.role, "admin");
    assert.equal(loginBody.viewer.status, "active");
    assert.equal(loginBody.viewer.username, "test_admin");

    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];

    const crossOriginAction = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: "https://attacker.invalid",
      },
      body: JSON.stringify({ action: "revoke_session", sessionId }),
    });
    assert.equal(crossOriginAction.status, 403);
    assert.deepEqual(await crossOriginAction.json(), {
      ok: false,
      error: "Cross-origin request rejected",
    });

    const malformedJson = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(malformedJson.status, 400);
    assert.deepEqual(await malformedJson.json(), {
      ok: false,
      error: "Invalid JSON request",
    });

    const unknownResource = await fetch(`${base}/api/admin?resource=secret-table`, {
      headers: { Cookie: cookie },
    });
    assert.equal(unknownResource.status, 404);

    const unknownAction = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unknown_action" }),
    });
    assert.equal(unknownAction.status, 400);
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
      assert.equal(payload.viewer.userId, adminId);
      assert.equal(payload.viewer.role, "admin");
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
        assert.equal(payload.data[0].active_session_id, "session-id");
        assert.equal(payload.data[0].status, "remembered");
        assert.equal("revoked_at" in payload.data[0], false);
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
        assert.equal(payload.data[1].status, "remembered");
        assert.equal(payload.data[1].owns_active_session, false);
        assert.equal("revoked_at" in payload.data[1], false);
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

    const eventsBeforeLegacyInstallationAction = fakeSupabase.control.events.length;
    const legacyInstallationAction = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke_installation", installationId }),
    });
    assert.equal(legacyInstallationAction.status, 400);
    assert.equal(fakeSupabase.control.events.length, eventsBeforeLegacyInstallationAction);

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

    const exceptionRpcCases = [
      ["set_user_status", "admin_set_user_status", "user_not_found", "ไม่พบบัญชีสมาชิก", { userId: missingId, status: "suspended" }],
      ["revoke_license", "admin_revoke_license", "license_not_found", "ไม่พบ License", { licenseId }],
      ["extend_license", "admin_extend_license", "license_not_found", "ไม่พบ License", { licenseId, days: 30 }],
      ["revoke_session", "admin_revoke_session", "session_not_found", "ไม่พบ session", { sessionId }],
    ];
    for (const [action, rpc, backendMessage, safeMessage, fields] of exceptionRpcCases) {
      fakeSupabase.control.errorRpcs.set(rpc, backendMessage);
      const response = await fetch(`${base}/api/admin`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...fields }),
      });
      assert.equal(response.status, 404, `${action} SQL exception should map to safe 404`);
      assert.deepEqual(await response.json(), { ok: false, error: safeMessage });
      fakeSupabase.control.errorRpcs.delete(rpc);
    }

    for (const [action, rpc, backendMessage, , fields] of exceptionRpcCases) {
      fakeSupabase.control.errorRpcs.set(rpc, { code: "42501", message: backendMessage });
      const response = await fetch(`${base}/api/admin`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...fields }),
      });
      assert.equal(response.status, 500, `${action} wrong SQL code must fail closed`);
      assert.deepEqual(await response.json(), { ok: false, error: "Server error" });
      fakeSupabase.control.errorRpcs.delete(rpc);
    }

    fakeSupabase.control.errorRpcs.set("admin_revoke_license", "unexpected_backend_failure");
    const unknownRpcException = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke_license", licenseId }),
    });
    assert.equal(unknownRpcException.status, 500);
    assert.deepEqual(await unknownRpcException.json(), { ok: false, error: "Server error" });
    fakeSupabase.control.errorRpcs.delete("admin_revoke_license");

    for (const [action, rpc, fields] of falseRpcCases) {
      fakeSupabase.control.invalidBooleanRpcs.add(rpc);
      const response = await fetch(`${base}/api/admin`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...fields }),
      });
      assert.equal(response.status, 502, `${action} malformed RPC result should fail closed`);
      assert.deepEqual(await response.json(), {
        ok: false,
        error: "Backend ตอบกลับไม่ถูกต้อง",
      });
      fakeSupabase.control.invalidBooleanRpcs.delete(rpc);
    }

    fakeSupabase.control.invalidTimestampRpcs.add("admin_extend_license");
    const invalidTimestamp = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "extend_license", licenseId, days: 30 }),
    });
    assert.equal(invalidTimestamp.status, 502);
    assert.deepEqual(await invalidTimestamp.json(), {
      ok: false,
      error: "Backend ตอบวันหมดอายุไม่ถูกต้อง",
    });
    fakeSupabase.control.invalidTimestampRpcs.delete("admin_extend_license");

    fakeSupabase.control.invalidTimestampRpcs.add("admin_extend_license");
    fakeSupabase.control.invalidTimestampValue = "0";
    const dateParseLoophole = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "extend_license", licenseId, days: 30 }),
    });
    assert.equal(dateParseLoophole.status, 502);
    fakeSupabase.control.invalidTimestampRpcs.delete("admin_extend_license");
    delete fakeSupabase.control.invalidTimestampValue;

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

    const legacyReset = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reset_user_password",
        userId: customerId,
        confirmUsername: "test_customer",
      }),
    });
    assert.equal(legacyReset.status, 400);

    const recovery = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "generate_recovery_code",
        userId: customerId,
        confirmUsername: "test_customer",
      }),
    });
    assert.equal(recovery.status, 200);
    assert.equal(recovery.headers.get("cache-control"), "no-store");
    const recoveryBody = await recovery.json();
    assert.match(recoveryBody.recovery_id, /^[0-9a-f-]{36}$/i);
    assert.match(
      recoveryBody.recovery_code,
      /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){4}-[A-Z2-9]{6}$/,
    );
    assert.equal(recoveryBody.username, "test_customer");
    const generationRpc = fakeSupabase.control.events.find(
      (event) => event.rpc === "admin_generate_recovery_code",
    );
    assert.ok(generationRpc);
    assert.equal("recovery_code" in generationRpc.body, false);
    assert.doesNotMatch(JSON.stringify(generationRpc.body), new RegExp(
      recoveryBody.recovery_code.replaceAll("-", ""),
    ));

    const verified = await fetch(`${base}/api/account/recovery/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vercel-Forwarded-For": "198.51.100.10",
      },
      body: JSON.stringify({
        username: "test_customer",
        recovery_code: recoveryBody.recovery_code,
      }),
    });
    assert.equal(verified.status, 200);
    const verifiedBody = await verified.json();
    assert.equal(verifiedBody.scope, "change_password");
    assert.match(verifiedBody.recovery_session, /^[A-Za-z0-9_-]{40,}$/);
    const firstVerify = fakeSupabase.control.events.find(
      (event) => event.rpc === "verify_recovery_code",
    );
    const vercelForwarded = await fetch(`${base}/api/account/recovery/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vercel-Forwarded-For": "198.51.100.10",
        "X-Forwarded-For": "203.0.113.20",
      },
      body: JSON.stringify({
        username: "test_customer",
        recovery_code: recoveryBody.recovery_code,
      }),
    });
    assert.equal(vercelForwarded.status, 200);
    const vercelVerify = fakeSupabase.control.events.filter(
      (event) => event.rpc === "verify_recovery_code",
    ).at(-1);
    assert.equal(
      vercelVerify.body.p_requester_verifier,
      firstVerify.body.p_requester_verifier,
      "Vercel client address must take precedence over generic forwarded address",
    );
    const vercelIpv6 = await fetch(`${base}/api/account/recovery/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vercel-Forwarded-For": "2001:db8::10",
      },
      body: JSON.stringify({
        username: "test_customer",
        recovery_code: recoveryBody.recovery_code,
      }),
    });
    assert.equal(vercelIpv6.status, 200);
    const ipv6Verify = fakeSupabase.control.events.filter(
      (event) => event.rpc === "verify_recovery_code",
    ).at(-1);
    assert.notEqual(ipv6Verify.body.p_requester_verifier, firstVerify.body.p_requester_verifier);
    const ambiguousForwarded = await fetch(`${base}/api/account/recovery/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vercel-Forwarded-For": "198.51.100.10, 203.0.113.20",
        "X-Forwarded-For": "203.0.113.20",
      },
      body: JSON.stringify({
        username: "test_customer",
        recovery_code: recoveryBody.recovery_code,
      }),
    });
    assert.equal(ambiguousForwarded.status, 200);
    const ambiguousVerify = fakeSupabase.control.events.filter(
      (event) => event.rpc === "verify_recovery_code",
    ).at(-1);
    const noForwarded = await fetch(`${base}/api/account/recovery/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "test_customer",
        recovery_code: recoveryBody.recovery_code,
      }),
    });
    assert.equal(noForwarded.status, 200);
    const noForwardedVerify = fakeSupabase.control.events.filter(
      (event) => event.rpc === "verify_recovery_code",
    ).at(-1);
    assert.notEqual(
      ambiguousVerify.body.p_requester_verifier,
      firstVerify.body.p_requester_verifier,
      "malformed Vercel address must not select a listed address",
    );
    assert.equal(
      ambiguousVerify.body.p_requester_verifier,
      noForwardedVerify.body.p_requester_verifier,
      "malformed Vercel address must fall back to peer instead of generic header",
    );

    const missingRecoveryBearer = await fetch(
      `${base}/api/account/recovery/change-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: "Valid-New-Password-123!" }),
      },
    );
    assert.equal(missingRecoveryBearer.status, 401);

    const changed = await fetch(`${base}/api/account/recovery/change-password`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${verifiedBody.recovery_session}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ new_password: "Valid-New-Password-123!" }),
    });
    assert.equal(changed.status, 200);
    assert.deepEqual(await changed.json(), {
      ok: true,
      completed: true,
      state: "completed",
    });
    const recoveryEvents = fakeSupabase.control.events.filter(
      (event) => event.rpc?.includes("recovery_password_change") || event.type === "auth_update",
    );
    assert.deepEqual(recoveryEvents.map((event) => event.rpc || event.type), [
      "claim_recovery_password_change",
      "auth_update",
      "complete_recovery_password_change",
    ]);
    assert.doesNotMatch(
      JSON.stringify(recoveryEvents.filter((event) => event.type !== "auth_update")),
      /Valid-New-Password-123!/,
    );

    const deleted = await fetch(`${base}/api/admin`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_batch", batchId }),
    });
    assert.equal(deleted.status, 200);

    // --- Server Monitoring Ingest & Read Integration Tests ---
    const ingestUrl = `${base}/api/server/metrics/ingest`;
    const validSecret = "test-server-metrics-ingest-secret-32-bytes";

    // 1. Missing Authorization header -> 401
    const noAuth = await fetch(ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server_id: "japan-vps-1",
        observed_at: new Date().toISOString(),
        host_uptime_seconds: 1000,
        shadowsocks_service_status: "active",
        shadowsocks_listener_status: "listening",
        rx_bytes_total: 1000,
        tx_bytes_total: 2000,
        rx_bps: 100,
        tx_bps: 200,
      }),
    });
    assert.equal(noAuth.status, 401);

    // 2. Wrong Authorization secret -> 401
    const wrongAuth = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-secret-token",
      },
      body: JSON.stringify({
        server_id: "japan-vps-1",
        observed_at: new Date().toISOString(),
        host_uptime_seconds: 1000,
        shadowsocks_service_status: "active",
        shadowsocks_listener_status: "listening",
        rx_bytes_total: 1000,
        tx_bytes_total: 2000,
        rx_bps: 100,
        tx_bps: 200,
      }),
    });
    assert.equal(wrongAuth.status, 401);

    // 3. Payload with forbidden client telemetry -> 400
    const forbiddenPayload = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validSecret}`,
      },
      body: JSON.stringify({
        server_id: "japan-vps-1",
        observed_at: new Date().toISOString(),
        host_uptime_seconds: 1000,
        shadowsocks_service_status: "active",
        shadowsocks_listener_status: "listening",
        rx_bytes_total: 1000,
        tx_bytes_total: 2000,
        rx_bps: 100,
        tx_bps: 200,
        core_pid: 1234, // Forbidden client telemetry
      }),
    });
    assert.equal(forbiddenPayload.status, 400);

    // 4. Valid payload -> 200 { ok: true, accepted: true, server_id: "japan-vps-1" }
    const validTime = new Date().toISOString();
    const validReq = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validSecret}`,
      },
      body: JSON.stringify({
        server_id: "japan-vps-1",
        observed_at: validTime,
        host_uptime_seconds: 50000,
        shadowsocks_service_status: "active",
        shadowsocks_listener_status: "listening",
        upstream_ping_ms: 12.4,
        upstream_ping_status: "AVAILABLE",
        upstream_packet_loss_percent: 0.0,
        rx_bytes_total: 1000000,
        tx_bytes_total: 2000000,
        rx_bps: 15400.0,
        tx_bps: 16800.0,
        cpu_percent: 10.5,
        memory_percent: 22.0,
      }),
    });
    assert.equal(validReq.status, 200);
    const validJson = await validReq.json();
    assert.equal(validJson.ok, true);
    assert.equal(validJson.accepted, true);
    assert.equal(validJson.server_id, "japan-vps-1");

    // 5. Older replay payload -> 200 { ok: true, accepted: false }
    const olderTime = new Date(Date.now() - 60000).toISOString();
    const replayReq = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validSecret}`,
      },
      body: JSON.stringify({
        server_id: "japan-vps-1",
        observed_at: olderTime,
        host_uptime_seconds: 49940,
        shadowsocks_service_status: "active",
        shadowsocks_listener_status: "listening",
        rx_bytes_total: 900000,
        tx_bytes_total: 1800000,
        rx_bps: 10000.0,
        tx_bps: 10000.0,
      }),
    });
    assert.equal(replayReq.status, 200);
    const replayJson = await replayReq.json();
    assert.equal(replayJson.ok, true);
    assert.equal(replayJson.accepted, false);

    // 6. GET /api/server/metrics (authenticated)
    const serverRes = await fetch(`${base}/api/server/metrics`, {
      headers: { Cookie: cookie },
    });
    assert.equal(serverRes.status, 200);
    const serverJson = await serverRes.json();
    assert.equal(serverJson.ok, true);
    assert.ok(serverJson.server);
    assert.equal(serverJson.server.server_id, "japan-vps-1");
    assert.equal(serverJson.server.host_status, "ONLINE");
    assert.equal(serverJson.server.shadowsocks_service_status, "active");
    assert.equal(serverJson.server.shadowsocks_listener_status, "listening");
    assert.equal(serverJson.server.ping_ms, 12.4);
    assert.equal(serverJson.server.ping_target_label, "VPS → Upstream");
    assert.equal(serverJson.server.packet_loss_percent, 0.0);
    assert.equal(serverJson.server.rx_bytes_total, 1000000);
    assert.equal(serverJson.server.tx_bytes_total, 2000000);
    assert.equal(serverJson.server.rx_bps, 15400.0);
    assert.equal(serverJson.server.tx_bps, 16800.0);

    // Privacy assertion: zero client telemetry in server snapshot
    assert.equal(serverJson.server.core_pid, undefined);
    assert.equal(serverJson.server.client_rx_bytes, undefined);
    assert.equal(serverJson.server.device_id, undefined);

    // --- Phase T6B Historical Server Metrics API Tests ---
    // 6a. GET /api/server/metrics/history without auth -> 401
    const unauthHistory = await fetch(`${base}/api/server/metrics/history?range=1h`);
    assert.equal(unauthHistory.status, 401);

    // 6b. GET /api/server/metrics/history with invalid range -> 400
    const invalidRange = await fetch(`${base}/api/server/metrics/history?range=invalid_range`, {
      headers: { Cookie: cookie },
    });
    assert.equal(invalidRange.status, 400);

    // 6c. GET /api/server/metrics/history?range=1h (authenticated) -> 200
    const history1h = await fetch(`${base}/api/server/metrics/history?range=1h`, {
      headers: { Cookie: cookie },
    });
    assert.equal(history1h.status, 200);
    const h1Json = await history1h.json();
    assert.equal(h1Json.ok, true);
    assert.equal(h1Json.server_id, "japan-vps-1");
    assert.equal(h1Json.range, "1h");
    assert.equal(h1Json.bucket_seconds, 60);
    assert.ok(Array.isArray(h1Json.points));
    assert.ok(h1Json.points.length <= 60);

    // 6d. GET /api/server/metrics/history?range=24h (authenticated) -> 200
    const history24h = await fetch(`${base}/api/server/metrics/history?range=24h`, {
      headers: { Cookie: cookie },
    });
    assert.equal(history24h.status, 200);
    const h24Json = await history24h.json();
    assert.equal(h24Json.ok, true);
    assert.equal(h24Json.range, "24h");
    assert.equal(h24Json.bucket_seconds, 300);
    assert.ok(h24Json.points.length <= 288);

    // 6e. GET /api/server/metrics/history?range=7d (authenticated) -> 200
    const history7d = await fetch(`${base}/api/server/metrics/history?range=7d`, {
      headers: { Cookie: cookie },
    });
    assert.equal(history7d.status, 200);
    const h7dJson = await history7d.json();
    assert.equal(h7dJson.ok, true);
    assert.equal(h7dJson.range, "7d");
    assert.equal(h7dJson.bucket_seconds, 1800);
    assert.ok(h7dJson.points.length <= 336);

    // 6f. Ingestion Identical Retry -> 200 { ok: true, accepted: true, is_idempotent_retry: true }
    const identicalRetryReq = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validSecret}`,
      },
      body: JSON.stringify({
        server_id: "japan-vps-1",
        observed_at: validTime,
        host_uptime_seconds: 50000,
        shadowsocks_service_status: "active",
        shadowsocks_listener_status: "listening",
        upstream_ping_ms: 12.4,
        upstream_ping_status: "AVAILABLE",
        upstream_packet_loss_percent: 0.0,
        rx_bytes_total: 1000000,
        tx_bytes_total: 2000000,
        rx_bps: 15400.0,
        tx_bps: 16800.0,
        cpu_percent: 10.5,
        memory_percent: 22.0,
      }),
    });
    assert.equal(identicalRetryReq.status, 200);
    const identicalJson = await identicalRetryReq.json();
    assert.equal(identicalJson.ok, true);
    assert.equal(identicalJson.is_idempotent_retry, true);

    // 6g. Ingestion Conflicting Duplicate -> 409 Conflict
    const conflictingReq = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validSecret}`,
      },
      body: JSON.stringify({
        server_id: "japan-vps-1",
        observed_at: validTime, // Same timestamp
        host_uptime_seconds: 50000,
        shadowsocks_service_status: "failed", // DIFFERENT payload!
        shadowsocks_listener_status: "closed",
        rx_bytes_total: 9999999,
        tx_bytes_total: 9999999,
        rx_bps: 99999.0,
        tx_bps: 99999.0,
      }),
    });
    assert.equal(conflictingReq.status, 409);

    // 7. GET /api/admin?resource=overview (authenticated)
    const overviewRes = await fetch(`${base}/api/admin?resource=overview`, {
      headers: { Cookie: cookie },
    });
    assert.equal(overviewRes.status, 200);
    const overviewJson = await overviewRes.json();
    assert.equal(overviewJson.ok, true);
    assert.ok(overviewJson.data.server);
    assert.equal(overviewJson.data.server.host_status, "ONLINE");
    assert.equal(typeof overviewJson.data.stats.onlineSessionCount, "number");
    assert.equal(typeof overviewJson.data.stats.entitledActiveUserCount, "number");

    fakeSupabase.control.adminActive = false;
    const inactiveSession = await fetch(`${base}/api/admin?resource=overview`, {
      headers: { Cookie: cookie },
    });
    assert.equal(inactiveSession.status, 401);
    fakeSupabase.control.adminActive = true;

    const logout = await fetch(`${base}/api/logout`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(logout.status, 200);
    const logoutCookie = logout.headers.get("set-cookie") || "";
    assert.match(logoutCookie, /admin_session=;/);
    assert.match(logoutCookie, /Max-Age=0/i);
    assert.match(logoutCookie, /HttpOnly/i);
    assert.match(logoutCookie, /SameSite=Strict/i);
    assert.match(logoutCookie, /Secure/i);
  } finally {
    apiServer.close();
    await once(apiServer, "close").catch(() => {});
    fakeSupabase.close();
    await once(fakeSupabase, "close").catch(() => {});
  }
});

test("user controls expose ban/reactivation and hide self-restriction actions", () => {
  const users = renderUsers([
    { id: customerId, username: "test_customer", role: "customer", status: "active" },
    { id: adminId, username: "test_admin", role: "admin", status: "active" },
    { id: suspendedId, username: "test_suspended", role: "customer", status: "suspended" },
  ], { userId: adminId });
  assert.equal((users.match(/data-action="generate_recovery_code"/g) || []).length, 2);
  assert.match(users, /data-action="suspend_user"/);
  assert.match(users, /data-action="ban_user"/);
  assert.match(users, /data-action="activate_user"/);
  assert.match(users, /บัญชีที่กำลังใช้งาน/);
  assert.doesNotMatch(
    users,
    new RegExp(`data-action="(?:suspend_user|ban_user)" data-id="${adminId}"`),
  );

  const success = renderRecoveryCodeDialog({
    userId: customerId,
    username: "test_customer",
    phase: "success",
    recoveryCode: "ABCD-EFGH-JKLM-NPQR-STUV-WX2345",
    countdown: "04:59",
  });
  assert.match(success, /ABCD-EFGH-JKLM-NPQR-STUV-WX2345/);
  assert.match(success, /04:59/);
  assert.match(success, /data-action="copy_recovery_code"/);
  assert.doesNotMatch(success, /รหัสผ่านชั่วคราว/);
  assert.equal(renderRecoveryCodeDialog(null), "");
});

test("standalone bundle contains no server credential", () => {
  const bundle = readFileSync("standalone/dist/neko-control.html", "utf8");
  assert.doesNotMatch(
    bundle,
    /SUPABASE_(?:SECRET|SERVICE_ROLE)_KEY|ADMIN_SESSION_SECRET|service[_ -]?role|test-secret/i,
  );
});

test("browser-rendered API errors and dynamic fields are HTML escaped", () => {
  const payload = `<img src=x onerror="globalThis.compromised=true">`;
  assert.equal(
    escapeHtml(payload),
    "&lt;img src=x onerror=&quot;globalThis.compromised=true&quot;&gt;",
  );
  const launcherMain = readFileSync("standalone/src/main.js", "utf8");
  assert.match(launcherMain, /escapeHtml\(store\.state\.error\)/);
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
      active_session_id: sessionId,
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
  assert.match(html, new RegExp(`data-action="revoke_session" data-id="${sessionId}"`));
  assert.doesNotMatch(html, /revoke_installation|บล็อกเฉพาะการติดตั้ง|บล็อกเมื่อ/);
  assert.match(html, /อุปกรณ์ที่จดจำไว้ไม่ใช่การเข้าสู่ระบบที่กำลังใช้งาน/);
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
    /ยุติ Launcher session ปัจจุบันนี้หรือไม่ อุปกรณ์จะยังคงถูกจดจำและสามารถเข้าสู่ระบบใหม่ได้/,
  );
  assert.match(
    launcherMain,
    /name === "revoke_session" && item\.active_session_id === id/,
  );
  assert.doesNotMatch(launcherMain, /revoke_installation|บล็อกเฉพาะการติดตั้ง/);
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
