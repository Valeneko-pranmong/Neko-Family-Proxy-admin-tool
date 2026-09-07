import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const HARNESS = new URL("scripts/verify-software-update-provider.mjs", ROOT);
const RUNTIME_DOC = new URL("docs/current/software-update-production-runtime.md", ROOT);
const FIXTURE_TOKEN = "fixture-token-never-print-7YpQ";
const FIXTURE_SECRET_PATH = "/private/synthetic-core-object-never-print.zip";
const TEST_ALLOW_LOOPBACK_HTTP = "NEKO_SOFTWARE_UPDATE_PROVIDER_TEST_ALLOW_LOOPBACK_HTTP";
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
  const scriptPath = script instanceof URL ? fileURLToPath(script) : script;
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
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
    [TEST_ALLOW_LOOPBACK_HTTP]: "1",
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
      [TEST_ALLOW_LOOPBACK_HTTP]: "1",
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

test("opt-in proof rejects loopback HTTP without the explicit test seam before network access", async () => {
  await withFixture((_request, response) => {
    response.writeHead(500).end("must not be requested");
  }, async ({ baseUrl, requests }) => {
    const env = proofEnv(baseUrl, new Date(Date.now() + 1_000).toISOString());
    delete env[TEST_ALLOW_LOOPBACK_HTTP];
    const result = await runHarness(env, 2_000);
    assert.notEqual(result.code, 0, "production proof must reject HTTP URLs");
    assert.equal(result.signal, null, "HTTP-policy rejection must terminate normally");
    assert.equal(requests.length, 0, "HTTP URLs must be rejected before any request");
    assert.match(result.output, /SOFTWARE_UPDATE_PROVIDER_PROOF FAIL/);
    assertNoSensitiveOutput(result.output, env);
  });
});

test("test HTTP seam rejects non-loopback hosts before fetch", async () => {
  const env = proofEnv("http://192.0.2.1", new Date(Date.now() + 1_000).toISOString());
  const result = await runHarness(env, 1_000);
  assert.notEqual(result.code, 0, "test HTTP seam must not allow non-loopback targets");
  assert.equal(result.signal, null, "non-loopback HTTP must be rejected immediately, not by timeout");
  assert.match(result.output, /SOFTWARE_UPDATE_PROVIDER_PROOF FAIL/);
  assertNoSensitiveOutput(result.output, env);
});

for (const { label, mutate } of [
  {
    label: "userinfo in the anonymous URL",
    mutate(env, baseUrl) {
      const port = new URL(baseUrl).port;
      env.NEKO_SOFTWARE_UPDATE_PROOF_ANONYMOUS_URL = `http://fixture-user:fixture-password@127.0.0.1:${port}/anonymous?token=${FIXTURE_TOKEN}`;
    },
  },
  {
    label: "userinfo in the signed URL",
    mutate(env, baseUrl) {
      const port = new URL(baseUrl).port;
      env.NEKO_SOFTWARE_UPDATE_PROOF_SIGNED_URL = `http://fixture-user:fixture-password@127.0.0.1:${port}${FIXTURE_SECRET_PATH}?token=${FIXTURE_TOKEN}`;
    },
  },
  {
    label: "a fragment in the anonymous URL",
    mutate(env) {
      env.NEKO_SOFTWARE_UPDATE_PROOF_ANONYMOUS_URL += "#fixture-fragment-never-print";
    },
  },
  {
    label: "a fragment in the signed URL",
    mutate(env) {
      env.NEKO_SOFTWARE_UPDATE_PROOF_SIGNED_URL += "#fixture-fragment-never-print";
    },
  },
]) {
  test(`opt-in proof rejects ${label} before network access`, async () => {
    await withFixture((_request, response) => {
      response.writeHead(500).end("must not be requested");
    }, async ({ baseUrl, requests }) => {
      const env = proofEnv(baseUrl, new Date(Date.now() + 1_000).toISOString());
      mutate(env, baseUrl);
      const result = await runHarness(env, 2_000);
      assert.notEqual(result.code, 0, `${label} must fail proof`);
      assert.equal(result.signal, null, `${label} must terminate normally`);
      assert.equal(requests.length, 0, `${label} must be rejected before any request`);
      assert.match(result.output, /SOFTWARE_UPDATE_PROVIDER_PROOF FAIL/);
      assertNoSensitiveOutput(result.output, env);
    });
  });
}

test("opt-in proof rejects an initial signed-URL lifetime over 120 seconds before network access", async () => {
  await withFixture((_request, response) => {
    response.writeHead(200).end("must not be requested");
  }, async ({ baseUrl, requests }) => {
    const env = proofEnv(baseUrl, new Date(Date.now() + 121_000).toISOString());
    const result = await runHarness(env, 2_000);
    assert.notEqual(result.code, 0, "an initial signed-URL lifetime over 120 seconds must fail proof");
    assert.equal(result.signal, null, "TTL rejection must terminate normally rather than reach the child timeout");
    assert.equal(requests.length, 0, "invalid initial TTL must be rejected before any network request");
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

  const exactRuntimeConstraints = [
    [/SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON.{0,160}(?:nonempty|non-empty).{0,80}(?:max(?:imum)?|at most).{0,20}131(?:072|,072)/is,
      "active-release record is nonempty and at most 131072 characters"],
    [/(?:top(?:-level)? keys|exact keys).{0,120}channel.{0,40}envelope.{0,40}components/is,
      "active-release exact top keys are channel, envelope, components"],
    [/(?:envelope.{0,40}(?:exact keys|keys.{0,20}exact)|exact envelope keys).{0,160}envelope_version.{0,40}key_id.{0,40}payload_b64.{0,40}signature_b64/is,
      "envelope exact key set"],
    [/envelope_version.{0,30}(?:=|is|must be)\s*`?1\b/is, "envelope_version is 1"],
    [/key_id.{0,100}\[A-Za-z0-9\._-\]\{1,64\}/is, "key_id grammar"],
    [/(?:payload_b64|signature_b64).{0,180}canonical standard base64.{0,100}(?:round-trip|re-encod).{0,100}padding/is,
      "canonical standard base64 round-trip and padding"],
    [/signature_b64.{0,100}(?:decoded.{0,30})?(?:max(?:imum)?|at most).{0,20}4096.{0,20}bytes/is,
      "decoded signature maximum is 4096 bytes"],
    [/payload_b64.{0,100}(?:decoded.{0,30})?(?:max(?:imum)?|at most).{0,20}65536.{0,20}bytes/is,
      "decoded payload maximum is 65536 bytes"],
    [/(?:payload|decoded).{0,100}(?:valid|strict).{0,30}UTF-?8.{0,80}(?:without|no) BOM/is,
      "payload is valid UTF-8 without BOM"],
    [/(?:payload|JSON).{0,80}(?:exactly|one) JSON value.{0,100}duplicate[- ]key.{0,30}(?:reject|forbid)/is,
      "payload is one JSON value with duplicate-key rejection"],
    [/(?:launcher.{0,30}(?:exact keys|key set)|exact launcher keys).{0,240}artifact_id.{0,40}format.{0,40}distribution.{0,40}sha256.{0,40}size.{0,40}public_url/is,
      "launcher exact component key set"],
    [/(?:core.{0,30}(?:exact keys|key set)|exact core keys).{0,240}artifact_id.{0,40}format.{0,40}distribution.{0,40}sha256.{0,40}size.{0,40}storage/is,
      "core exact component key set"],
    [/artifact_id.{0,100}\[A-Za-z0-9\._-\]\{1,96\}/is, "artifact_id grammar"],
    [/sha256.{0,100}\[0-9a-f\]\{64\}/is, "sha256 grammar"],
    [/launcher.{0,120}(?:integer|size).{0,80}\b1\b.{0,30}134217728/is, "launcher size integer range 1..134217728"],
    [/core.{0,120}(?:integer|size).{0,80}\b1\b.{0,30}1073741824/is, "core size integer range 1..1073741824"],
    [/raw-pe-v1.{0,100}public-launcher.{0,180}zip-core-v1.{0,100}controlled-core/is,
      "exact launcher/core formats and distributions"],
    [/launcher.{0,120}artifact_id.{0,120}(?:differ|distinct|not equal).{0,120}core.{0,120}artifact_id/is,
      "launcher and core artifact IDs differ"],
    [/launcher.{0,120}(?:public_url|URL).{0,120}HTTPS.{0,160}(?:no|without) userinfo.{0,80}(?:no|without) query.{0,80}(?:no|without) fragment/is,
      "launcher URL is HTTPS without userinfo, query, or fragment"],
    [/bucket.{0,100}\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,62\}/is, "bucket grammar"],
    [/object.{0,120}(?:total|length).{0,60}\b1\b.{0,30}512.{0,100}(?:slash-delimited|segment)/is,
      "object total length is 1..512 and slash-delimited"],
    [/(?:object|segment).{0,160}\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,127\}.{0,120}(?:no|reject).{0,50}(?:empty|dot|\.\/\.\.)/is,
      "object segment grammar rejects empty, dot, and dotdot segments"],
    [/(?:release-v2|decoded payload).{0,100}(?:exact keys|key set.{0,20}exact).{0,300}schema_version.{0,30}channel.{0,30}release_sequence.{0,30}release_id.{0,30}mandatory.{0,30}minimum_supported_sequence.{0,30}updater_protocol.{0,30}components/is,
      "release-v2 payload exact key set"],
    [/schema_version.{0,30}(?:=|is|must be)\s*`?2\b.{0,100}channel.{0,30}(?:=|is|must be)\s*`?beta/is,
      "payload schema_version 2 and beta channel"],
    [/release_sequence.{0,100}integer.{0,50}(?:>=|at least)\s*1/is, "release_sequence integer >= 1"],
    [/release_id.{0,100}\[A-Za-z0-9\._-\]\{1,96\}/is, "release_id grammar"],
    [/mandatory.{0,60}boolean/is, "mandatory is boolean"],
    [/minimum_supported_sequence.{0,100}integer.{0,50}(?:>=|at least)\s*1.{0,100}(?:<=|not greater than).{0,50}release_sequence/is,
      "minimum_supported_sequence bounds"],
    [/updater_protocol.{0,100}(?:exact keys|exactly).{0,80}minimum.{0,40}maximum.{0,120}integer.{0,100}minimum.{0,40}(?:>=|at least)\s*1.{0,100}maximum.{0,40}(?:>=|at least).{0,30}minimum/is,
      "updater_protocol exact integer bounds"],
    [/(?:payload component|launcher.{0,20}(?:and|\/).{0,20}core).{0,100}(?:exact keys|key set.{0,20}exact).{0,300}version.{0,30}artifact_id.{0,30}artifact_sha256.{0,30}artifact_size.{0,30}installed_identity_sha256.{0,30}artifact_format/is,
      "payload launcher/core exact component key set"],
    [/version.{0,100}(?:length|string).{0,50}\b1\b.{0,30}64/is, "component version length 1..64"],
    [/installed_identity_sha256.{0,100}\[0-9a-f\]\{64\}/is, "installed identity SHA grammar"],
    [/(?:payload component|artifact_id).{0,180}(?:exact(?:ly)? agree|must match|equal).{0,120}(?:trusted record|record component)/is,
      "payload components exactly agree with trusted record"],
    [/DISTRIBUTION_CAPABILITIES_JSON.{0,120}(?:text|characters).{0,80}(?:max(?:imum)?|at most).{0,20}1048576/is,
      "capability registry text maximum is 1048576 characters"],
    [/DISTRIBUTION_CAPABILITIES_JSON.{0,120}(?:JSON )?array.{0,80}\b1\b.{0,30}1024.{0,100}duplicate[- ]key.{0,30}(?:reject|forbid)/is,
      "capability registry is a 1..1024 array with duplicate-key rejection"],
    [/(?:entry|capability).{0,40}(?:exact keys|six keys|exactly six).{0,240}credential_sha256.{0,30}channel.{0,30}artifact_ids.{0,30}expires_at.{0,30}enabled.{0,30}revoked/is,
      "capability exact six-key set"],
    [/credential_sha256.{0,100}\[0-9a-f\]\{64\}/is, "credential SHA grammar"],
    [/(?:header|authorization).{0,100}`?NekoDistribution `?.{0,100}(?:exactly|one|single) space.{0,100}token/is,
      "capability header is exactly NekoDistribution, one space, and token"],
    [/token.{0,100}\[A-Za-z0-9_-\]\{43\}.{0,120}canonical unpadded base64url.{0,100}(?:exactly )?32 bytes/is,
      "capability token grammar and canonical 32-byte decoding"],
    [/channel.{0,100}\[A-Za-z0-9\._-\]\{1,64\}.{0,100}(?:production.{0,30})?beta/is,
      "capability channel grammar and production beta value"],
    [/artifact_ids.{0,100}array.{0,60}\b1\b.{0,30}64.{0,100}unique.{0,120}(?:artifact_id|\[A-Za-z0-9\._-\]\{1,96\})/is,
      "artifact_ids is 1..64 unique artifact IDs"],
    [/expires_at.{0,120}YYYY-MM-DDTHH:mm:ssZ.{0,120}(?:parse.{0,40}round-trip|round-trip.{0,40}parse)/is,
      "expiry has exact UTC-seconds grammar and parse round-trip"],
    [/enabled.{0,50}boolean.{0,100}revoked.{0,50}boolean/is, "enabled and revoked are boolean"],
    [/(?:eligible|eligibility|authorize).{0,180}(?:expiry|expires_at).{0,30}>.{0,20}now.{0,120}enabled.{0,30}true.{0,120}revoked.{0,30}false.{0,120}beta.{0,120}(?:scope|artifact_ids)/is,
      "operational eligibility requires future expiry, enabled, unrevoked, beta, and scope"],
    [/timingSafeEqual.{0,100}32-byte digests/is, "timingSafeEqual compares 32-byte digests"],
  ];
  const missingRuntimeConstraints = exactRuntimeConstraints
    .filter(([pattern]) => !pattern.test(text))
    .map(([, description]) => description);
  assert.deepEqual(missingRuntimeConstraints, [],
    `runtime contract is missing exact parser constraints:\n- ${missingRuntimeConstraints.join("\n- ")}`);

  assert.equal(text.includes(FIXTURE_TOKEN), false);
  assert.equal(text.includes(FIXTURE_SECRET_PATH), false);
  assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
    "runtime contract must not contain an obvious JWT/service-role secret literal");
});
