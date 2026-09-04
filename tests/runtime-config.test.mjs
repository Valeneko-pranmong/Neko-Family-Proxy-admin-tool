import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

const supabasePort = 8804;
const sentinel = "SENTINEL_PROXY_SECRET_42";
const publishedAt = "2026-09-04T13:00:00.000Z";

process.env.SUPABASE_URL = `http://127.0.0.1:${supabasePort}`;
process.env.SUPABASE_SECRET_KEY = "test-service-role-secret";
process.env.ACCOUNT_RECOVERY_HMAC_SECRET =
  "test-recovery-hmac-secret-that-is-long-enough";

const {
  getRuntimeConfigMetadata,
  publishRuntimeConfig,
} = await import("../server/runtime-config.mjs");

function fakeSupabase() {
  const requests = [];
  const server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    requests.push({
      path: request.url,
      headers: request.headers,
      body: text ? JSON.parse(text) : null,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    if (request.url === "/rest/v1/rpc/get_active_runtime_proxy_config") {
      response.end(JSON.stringify({
        config_version: 17,
        endpoint_id: "japan-vps-1",
        host: "127.0.0.1",
        port: 8388,
        protocol: "shadowsocks",
        cipher: "aes-256-gcm",
        credential: sentinel,
        published_at: publishedAt,
      }));
      return;
    }
    response.end(JSON.stringify({
      config_version: 18,
      endpoint_id: "japan-vps-2",
      published_at: publishedAt,
      credential: sentinel,
    }));
  });
  server.requests = requests;
  return server;
}

test("getRuntimeConfigMetadata uses launcher service-role RPC and returns safe metadata", async () => {
  const server = fakeSupabase();
  server.listen(supabasePort, "127.0.0.1");
  await once(server, "listening");
  try {
    const metadata = await getRuntimeConfigMetadata();
    assert.deepEqual(metadata, {
      config_version: 17,
      endpoint_id: "japan-vps-1",
      published_at: publishedAt,
    });
    assert.doesNotMatch(JSON.stringify(metadata), new RegExp(sentinel));
    assert.equal(server.requests.length, 1);
    assert.equal(
      server.requests[0].path,
      "/rest/v1/rpc/get_active_runtime_proxy_config",
    );
    assert.equal(server.requests[0].headers["content-profile"], "launcher");
    assert.equal(server.requests[0].headers.apikey, "test-service-role-secret");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("publishRuntimeConfig accepts only exact public fields and fixes protocol server-side", async () => {
  const server = fakeSupabase();
  server.listen(supabasePort, "127.0.0.1");
  await once(server, "listening");
  try {
    const metadata = await publishRuntimeConfig({
      endpoint_id: "japan-vps-2",
      host: "proxy.example.com",
      port: 8389,
      cipher: "aes-256-gcm",
      credential: sentinel,
    });
    assert.deepEqual(metadata, {
      config_version: 18,
      endpoint_id: "japan-vps-2",
      published_at: publishedAt,
    });
    assert.deepEqual(server.requests[0].body, {
      p_endpoint_id: "japan-vps-2",
      p_host: "proxy.example.com",
      p_port: 8389,
      p_cipher: "aes-256-gcm",
      p_credential: sentinel,
    });
    assert.equal(server.requests[0].headers["content-profile"], "launcher");
    assert.doesNotMatch(JSON.stringify(metadata), new RegExp(sentinel));
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("publishRuntimeConfig rejects extra, malformed, and non-exact values before RPC", async () => {
  const valid = {
    endpoint_id: "japan-vps-2",
    host: "proxy.example.com",
    port: 8389,
    cipher: "aes-256-gcm",
    credential: sentinel,
  };
  const invalid = [
    { ...valid, protocol: "shadowsocks" },
    { ...valid, endpoint_id: "bad\nendpoint" },
    { ...valid, host: "" },
    { ...valid, port: "8389" },
    { ...valid, port: 65536 },
    { ...valid, cipher: "x".repeat(65) },
    { ...valid, credential: "bad\rcredential" },
  ];
  for (const payload of invalid) {
    await assert.rejects(
      () => publishRuntimeConfig(payload),
      (error) => error?.status === 400 && error?.isSafe === true,
    );
  }
});
