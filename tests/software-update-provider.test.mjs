import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const HARNESS = new URL("scripts/verify-software-update-provider.mjs", ROOT);
const RUNTIME_DOC = new URL("docs/current/software-update-production-runtime.md", ROOT);
const FIXTURE_TOKEN = "fixture-token-never-print-7YpQ";
const FIXTURE_SECRET_PATH = "/private/synthetic-core-object-never-print.zip";
const PLACEHOLDER = `console.log("NOT_IMPLEMENTED"); process.exit(0);\n`;

let temporaryDirectory;
let placeholderPath;

async function harnessPath() {
  if (existsSync(HARNESS)) return HARNESS;
  temporaryDirectory ??= await mkdtemp(join(tmpdir(), "neko-provider-proof-test-"));
  placeholderPath ??= join(temporaryDirectory, "not-implemented.mjs");
  await writeFile(placeholderPath, PLACEHOLDER, { mode: 0o700 });
  return placeholderPath;
}

async function runHarness(env, timeoutMs = 6_000) {
  const script = await harnessPath();
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: new URL(".", ROOT),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output: stdout + stderr });
    });
  });
}

function proofEnv(baseUrl, expiresAt, signedPath = FIXTURE_SECRET_PATH) {
  return {
    NEKO_SOFTWARE_UPDATE_PROVIDER_PROOF: "1",
    NEKO_SOFTWARE_UPDATE_PROOF_ANONYMOUS_URL: `${baseUrl}/anonymous?token=${FIXTURE_TOKEN}`,
    NEKO_SOFTWARE_UPDATE_PROOF_SIGNED_URL: `${baseUrl}${signedPath}?token=${FIXTURE_TOKEN}`,
    NEKO_SOFTWARE_UPDATE_PROOF_EXPIRES_AT: expiresAt,
  };
}

function assertNoSensitiveOutput(output, env) {
  for (const value of [
    env.NEKO_SOFTWARE_UPDATE_PROOF_ANONYMOUS_URL,
    env.NEKO_SOFTWARE_UPDATE_PROOF_SIGNED_URL,
    FIXTURE_TOKEN,
    FIXTURE_SECRET_PATH,
  ]) {
    if (value) assert.equal(output.includes(value), false, "proof output must not expose fixture inputs");
  }
}

async function withFixture(handler, run) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    handler(request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ baseUrl, requests });
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
}

test.after(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

test("provider proof is an explicit no-network skip without opt-in", async () => {
  await withFixture((_request, response) => {
    response.writeHead(500).end();
  }, async ({ baseUrl, requests }) => {
    const env = {
      NEKO_SOFTWARE_UPDATE_PROVIDER_PROOF: "0",
      NEKO_SOFTWARE_UPDATE_PROOF_ANONYMOUS_URL: `${baseUrl}/must-not-connect`,
      NEKO_SOFTWARE_UPDATE_PROOF_SIGNED_URL: "http://192.0.2.1/must-not-connect?secret=malicious",
      NEKO_SOFTWARE_UPDATE_PROOF_EXPIRES_AT: new Date(Date.now() + 1_000).toISOString(),
    };
    const result = await runHarness(env, 2_000);
    assert.equal(result.signal, null, "skip must terminate normally");
    assert.equal(result.code, 0, "no opt-in must exit successfully");
    assert.match(result.output, /SKIP/i, "no opt-in must report an explicit skip");
    assert.equal(requests.length, 0, "default execution must make zero network requests");
    assertNoSensitiveOutput(result.output, env);
  });
});

test("opt-in proof uses GET and proves anonymous denial, signed access, and expiry", { timeout: 7_000 }, async () => {
  const expiresAtMs = Date.now() + 1_200;
  const expiresAt = new Date(expiresAtMs).toISOString();
  await withFixture((request, response) => {
    if (request.url.startsWith("/anonymous")) return response.writeHead(403).end("denied");
    if (request.url.startsWith(FIXTURE_SECRET_PATH)) {
      return Date.now() < expiresAtMs
        ? response.writeHead(200, { "content-type": "application/octet-stream" }).end("synthetic-body")
        : response.writeHead(401).end("expired");
    }
    response.writeHead(404).end();
  }, async ({ baseUrl, requests }) => {
    const env = proofEnv(baseUrl, expiresAt);
    const result = await runHarness(env);
    assert.equal(result.code, 0, "complete provider proof must pass");
    assert.equal(result.signal, null);
    assert.ok(requests.length >= 3, "proof must perform anonymous, pre-expiry, and post-expiry checks");
    assert.ok(requests.every(({ method }) => method === "GET"), "proof fixture must observe GET only");
    assert.equal(requests.filter(({ url }) => url.startsWith("/anonymous")).length, 1);
    assert.equal(requests.filter(({ url }) => url.startsWith(FIXTURE_SECRET_PATH)).length, 2,
      "the same signed URL must be checked before and after expiry");
    assertNoSensitiveOutput(result.output, env);
  });
});

test("opt-in proof rejects redirects without following them", async () => {
  await withFixture((request, response) => {
    if (request.url.startsWith("/anonymous")) return response.writeHead(403).end();
    if (request.url.startsWith(FIXTURE_SECRET_PATH)) {
      return response.writeHead(302, { location: `/redirect-target?token=${FIXTURE_TOKEN}` }).end();
    }
    response.writeHead(200).end("redirect was followed");
  }, async ({ baseUrl, requests }) => {
    const env = proofEnv(baseUrl, new Date(Date.now() + 1_000).toISOString());
    const result = await runHarness(env, 3_000);
    assert.notEqual(result.code, 0, "a 3xx signed response must fail proof");
    assert.equal(requests.some(({ url }) => url.startsWith("/redirect-target")), false,
      "proof must disable redirect following");
    assert.ok(requests.every(({ method }) => method === "GET"));
    assertNoSensitiveOutput(result.output, env);
  });
});

test("opt-in proof bounds response-body reads", async () => {
  await withFixture((request, response) => {
    if (request.url.startsWith("/anonymous")) return response.writeHead(404).end();
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.write(Buffer.alloc(2 * 1024 * 1024, 65));
    response.end();
  }, async ({ baseUrl, requests }) => {
    const env = proofEnv(baseUrl, new Date(Date.now() + 1_000).toISOString());
    const result = await runHarness(env, 3_000);
    assert.notEqual(result.signal, "SIGTERM", "body handling must finish within its bound");
    assert.notEqual(result.code, 0, "an oversized response body must fail proof");
    assert.ok(requests.every(({ method }) => method === "GET"));
    assertNoSensitiveOutput(result.output, env);
  });
});

test("production runtime document freezes the provider and deployment contract", async () => {
  const text = existsSync(RUNTIME_DOC) ? await readFile(RUNTIME_DOC, "utf8") : "";

  for (const name of [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON",
    "DISTRIBUTION_CAPABILITIES_JSON",
  ]) assert.match(text, new RegExp(`\\b${name}\\b`), `runtime contract must name ${name}`);

  for (const required of [
    /Vercel Node(?:\.js)? 24/i,
    /public-launcher/,
    /controlled-core/,
    /credential_sha256/,
    /artifact_ids/,
    /expires_at/,
    /enabled/,
    /revoked/,
    /service.role.{0,40}sign/i,
    /capabilit(?:y|ies).{0,80}outside Git/is,
    /scope/i,
    /rotation/i,
    /revocation/i,
    /prior signed URL.{0,80}(?:<=|at most|no more than) 120 seconds/is,
    /malformed.{0,100}fail(?:s|ed)? closed/is,
    /absent.{0,100}fail(?:s|ed)? closed/is,
    /safe rollback order/i,
    /fake\/local tests.{0,80}(?:are|is) NOT hosted proof/is,
    /production deployment has NOT yet occurred/i,
  ]) assert.match(text, required);

  assert.match(text, /"channel"\s*:\s*"beta"/);
  assert.match(text, /"launcher"[\s\S]*?"artifact_id"[\s\S]*?"format"\s*:\s*"raw-pe-v1"[\s\S]*?"distribution"\s*:\s*"public-launcher"[\s\S]*?"sha256"[\s\S]*?"size"[\s\S]*?"public_url"/);
  assert.match(text, /"core"[\s\S]*?"artifact_id"[\s\S]*?"format"\s*:\s*"zip-core-v1"[\s\S]*?"distribution"\s*:\s*"controlled-core"[\s\S]*?"sha256"[\s\S]*?"size"[\s\S]*?"storage"[\s\S]*?"bucket"[\s\S]*?"object"/);
  assert.match(text, /(?:exactly|exact|max(?:imum)?|at most) 120 seconds/i);
  assert.match(text, /private.{0,80}(?:Core|bucket|object)/is);
  assert.match(text, /Core.{0,120}(?:bucket|object).{0,120}private/is);
  assert.match(text, /no anonymous.{0,80}(?:Core|bucket|object|access)/is);
  assert.match(text, /no CDN/i);
  assert.match(text, /no alternate public origin/i);
  assert.match(text, /NEKO_SOFTWARE_UPDATE_PROVIDER_PROOF=1[\s\S]*?NEKO_SOFTWARE_UPDATE_PROOF_ANONYMOUS_URL[\s\S]*?NEKO_SOFTWARE_UPDATE_PROOF_SIGNED_URL[\s\S]*?NEKO_SOFTWARE_UPDATE_PROOF_EXPIRES_AT[\s\S]*?node scripts\/verify-software-update-provider\.mjs/);
  assert.match(text, /live proof.{0,80}(?:mandatory|required).{0,80}before deploy/is);

  assert.equal(text.includes(FIXTURE_TOKEN), false);
  assert.equal(text.includes(FIXTURE_SECRET_PATH), false);
  assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
    "runtime contract must not contain an obvious JWT/service-role secret literal");
});
