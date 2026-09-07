import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

let SoftwareUpdateProviderError;
let getArtifactGrant;
let getSoftwareUpdateManifest;
let createPrivateStorageSignedGetUrl;
let providerPromise;
let supabasePromise;

async function loadSupabaseSigner() {
  process.env.SUPABASE_URL ||= "http://127.0.0.1:1";
  process.env.SUPABASE_SECRET_KEY ||= "synthetic-test-service-key";
  process.env.ACCOUNT_RECOVERY_HMAC_SECRET ||=
    "synthetic-test-recovery-secret-at-least-32-bytes";
  const module = await (supabasePromise ??= import("../server/supabase.mjs"));
  createPrivateStorageSignedGetUrl = module.createPrivateStorageSignedGetUrl;
  assert.equal(
    typeof createPrivateStorageSignedGetUrl,
    "function",
    "server/supabase.mjs must export createPrivateStorageSignedGetUrl",
  );
}

async function loadProvider() {
  try {
    const provider = await (providerPromise ??= import("../server/software-update.mjs"));
    ({ SoftwareUpdateProviderError, getArtifactGrant, getSoftwareUpdateManifest } = provider);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") assert.fail("software update provider module is missing");
    throw error;
  }
}

const IDS = {
  launcher: "launcher-win-x64-beta-0002",
  core: "core-win-x64-beta-0002",
};
const SHA = { launcher: "1".repeat(64), core: "2".repeat(64) };
const SIZE = { launcher: 12_345_678, core: 234_567_890 };
const SENTINEL = "SENTINEL_RAW_SENSITIVE_CONTENT_42";

function canonicalPayload(overrides = {}) {
  const payload = {
    schema_version: 2,
    channel: "beta",
    release_sequence: 2,
    release_id: "beta-release-0002",
    mandatory: false,
    minimum_supported_sequence: 1,
    updater_protocol: { minimum: 1, maximum: 1 },
    components: {
      launcher: {
        version: "5.1.0a2",
        artifact_id: IDS.launcher,
        artifact_sha256: SHA.launcher,
        artifact_size: SIZE.launcher,
        installed_identity_sha256: SHA.launcher,
        artifact_format: "raw-pe-v1",
      },
      core: {
        version: "5.0.0a42",
        artifact_id: IDS.core,
        artifact_sha256: SHA.core,
        artifact_size: SIZE.core,
        installed_identity_sha256: "3".repeat(64),
        artifact_format: "zip-core-v1",
      },
    },
  };
  return { ...payload, ...overrides };
}

function payloadB64(payload = canonicalPayload()) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function validRecord() {
  return {
    channel: "beta",
    envelope: {
      envelope_version: 1,
      key_id: "neko-update-test-1",
      payload_b64: payloadB64(),
      signature_b64: Buffer.alloc(64, 7).toString("base64"),
    },
    components: {
      launcher: {
        artifact_id: IDS.launcher,
        format: "raw-pe-v1",
        distribution: "public-launcher",
        sha256: SHA.launcher,
        size: SIZE.launcher,
        public_url: "https://objects.example.invalid/releases/launcher-0002.exe",
      },
      core: {
        artifact_id: IDS.core,
        format: "zip-core-v1",
        distribution: "controlled-core",
        sha256: SHA.core,
        size: SIZE.core,
        storage: { bucket: "private-updates", object: "beta/0002/core.zip" },
      },
    },
  };
}

function clone(value) {
  return structuredClone(value);
}

function environment(record = validRecord()) {
  return { SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON: JSON.stringify(record) };
}

function rawEnvironment(raw) {
  return { SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON: raw };
}

function errorRepresentations(error) {
  return [error.message, error.code, String(error.status), String(error), JSON.stringify(error)];
}

function assertSafeInvalid(error) {
  assert.ok(error instanceof SoftwareUpdateProviderError);
  assert.equal(error.code, "SOFTWARE_UPDATE_RECORD_INVALID");
  assert.equal(error.message, "SOFTWARE_UPDATE_RECORD_INVALID");
  assert.equal(error.isSafe, true);
  for (const representation of errorRepresentations(error)) {
    assert.doesNotMatch(representation, /SENTINEL|RAW_SENSITIVE|private-updates|core\.zip|objects\.example\.invalid/);
  }
  return true;
}

function assertCode(expectedCode, expectedStatus) {
  return (error) => {
    assert.ok(error instanceof SoftwareUpdateProviderError);
    assert.equal(error.code, expectedCode);
    if (expectedStatus !== undefined) assert.equal(error.status, expectedStatus);
    return true;
  };
}

function assertRecordRejected(envValue) {
  assert.throws(() => getSoftwareUpdateManifest("beta", envValue), assertSafeInvalid);
  assert.throws(() => getArtifactGrant(IDS.launcher, envValue), assertSafeInvalid);
}

function withPayload(record, payload) {
  record.envelope.payload_b64 = payloadB64(payload);
  return record;
}

function mutatePayload(mutator) {
  const record = validRecord();
  const payload = canonicalPayload();
  mutator(payload);
  return withPayload(record, payload);
}

for (const [description, noReleaseEnv] of [
  ["absent", {}],
  ["empty", { SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON: "" }],
  ["whitespace-only", { SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON: " \t\r\n" }],
]) {
  test(`${description} active record is an explicit no-release state`, async () => {
    await loadProvider();
    assert.equal(getSoftwareUpdateManifest("beta", noReleaseEnv), null);
    assert.throws(
      () => getArtifactGrant(IDS.launcher, noReleaseEnv),
      assertCode("SOFTWARE_UPDATE_ARTIFACT_NOT_FOUND", 404),
    );
  });
}

test("valid active record has exact frozen key sets and manifest remains opaque", async () => {
  await loadProvider();
  const record = validRecord();
  assert.deepEqual(Object.keys(record).sort(), ["channel", "components", "envelope"]);
  assert.deepEqual(Object.keys(record.components).sort(), ["core", "launcher"]);
  assert.deepEqual(Object.keys(record.components.launcher).sort(), [
    "artifact_id", "distribution", "format", "public_url", "sha256", "size",
  ]);
  assert.deepEqual(Object.keys(record.components.core).sort(), [
    "artifact_id", "distribution", "format", "sha256", "size", "storage",
  ]);
  assert.deepEqual(Object.keys(record.components.core.storage).sort(), ["bucket", "object"]);
  assert.deepEqual(getSoftwareUpdateManifest("beta", environment(record)), record.envelope);
});

test("canonical release-v2 payload agrees exactly with trusted component metadata", () => {
  const record = validRecord();
  const payload = canonicalPayload();
  for (const key of ["launcher", "core"]) {
    assert.equal(payload.components[key].artifact_id, record.components[key].artifact_id);
    assert.equal(payload.components[key].artifact_sha256, record.components[key].sha256);
    assert.equal(payload.components[key].artifact_size, record.components[key].size);
    assert.equal(payload.components[key].artifact_format, record.components[key].format);
  }
  assert.equal(record.components.launcher.distribution, "public-launcher");
  assert.equal(record.components.core.distribution, "controlled-core");
});

test("legacy-regression witness: malformed payload cannot fail open an anonymous Core grant", async () => {
  await loadProvider();
  const artifactId = "core-legacy-regression-witness";
  const sentinelUrl = "https://objects.example.invalid/SENTINEL_CORE_GRANT_BYTES_42.zip";
  const record = {
    channel: "beta",
    envelope: {
      envelope_version: 1,
      key_id: "legacy-regression-witness",
      payload_b64: Buffer.from("SENTINEL_RAW_SENSITIVE_CONTENT_42{", "utf8").toString("base64"),
      signature_b64: "legacy-shallow-envelope",
    },
    artifacts: { [artifactId]: sentinelUrl },
  };

  assert.throws(
    () => getArtifactGrant(artifactId, environment(record), new Date("2026-09-05T08:00:00.000Z"), null),
    (error) => {
      assertSafeInvalid(error);
      for (const representation of errorRepresentations(error)) {
        assert.doesNotMatch(representation, /SENTINEL_CORE_GRANT_BYTES_42|SENTINEL_RAW_SENSITIVE_CONTENT_42/);
      }
      return true;
    },
  );
});

const recordCases = [
  ["missing top channel", (r) => { delete r.channel; }],
  ["missing top envelope", (r) => { delete r.envelope; }],
  ["missing top components", (r) => { delete r.components; }],
  ["extra top field", (r) => { r[SENTINEL] = SENTINEL; }],
  ["wrong component keys", (r) => { r.components.engine = r.components.core; delete r.components.core; }],
  ["extra component key", (r) => { r.components.extra = clone(r.components.core); }],
  ["duplicate artifact ids", (r) => { r.components.core.artifact_id = IDS.launcher; }],
  ["missing launcher field", (r) => { delete r.components.launcher.size; }],
  ["extra launcher field", (r) => { r.components.launcher[SENTINEL] = SENTINEL; }],
  ["missing core field", (r) => { delete r.components.core.sha256; }],
  ["extra core field", (r) => { r.components.core[SENTINEL] = SENTINEL; }],
  ["missing storage bucket", (r) => { delete r.components.core.storage.bucket; }],
  ["extra storage field", (r) => { r.components.core.storage[SENTINEL] = SENTINEL; }],
  ["uppercase launcher SHA", (r) => { r.components.launcher.sha256 = "A".repeat(64); }],
  ["wrong-length core SHA", (r) => { r.components.core.sha256 = "2".repeat(63); }],
  ["launcher size zero", (r) => { r.components.launcher.size = 0; }],
  ["core size negative", (r) => { r.components.core.size = -1; }],
  ["launcher size fractional", (r) => { r.components.launcher.size = 1.5; }],
  ["core size boolean", (r) => { r.components.core.size = true; }],
  ["launcher size over limit", (r) => { r.components.launcher.size = 134_217_729; }],
  ["core size over limit", (r) => { r.components.core.size = 1_073_741_825; }],
  ["wrong launcher format", (r) => { r.components.launcher.format = "zip-core-v1"; }],
  ["wrong core format", (r) => { r.components.core.format = "raw-pe-v1"; }],
  ["wrong launcher distribution", (r) => { r.components.launcher.distribution = "controlled-core"; }],
  ["wrong core distribution", (r) => { r.components.core.distribution = "public-launcher"; }],
  ["launcher has storage", (r) => { r.components.launcher.storage = { bucket: "x", object: "y" }; }],
  ["core has public URL", (r) => { r.components.core.public_url = "https://example.invalid/core.zip"; }],
  ["launcher URL uses HTTP", (r) => { r.components.launcher.public_url = "http://example.invalid/a"; }],
  ["launcher URL has userinfo", (r) => { r.components.launcher.public_url = "https://u:p@example.invalid/a"; }],
  ["launcher URL has query", (r) => { r.components.launcher.public_url = `https://example.invalid/a?x=${SENTINEL}`; }],
  ["launcher URL has fragment", (r) => { r.components.launcher.public_url = "https://example.invalid/a#x"; }],
  ["unsafe bucket", (r) => { r.components.core.storage.bucket = "bad bucket"; }],
  ["bucket over limit", (r) => { r.components.core.storage.bucket = "a".repeat(64); }],
  ["object leading slash", (r) => { r.components.core.storage.object = "/core.zip"; }],
  ["object trailing slash", (r) => { r.components.core.storage.object = "beta/"; }],
  ["object empty segment", (r) => { r.components.core.storage.object = "beta//core.zip"; }],
  ["object dot segment", (r) => { r.components.core.storage.object = "beta/./core.zip"; }],
  ["object parent segment", (r) => { r.components.core.storage.object = "beta/../core.zip"; }],
  ["object backslash", (r) => { r.components.core.storage.object = "beta\\core.zip"; }],
  ["object percent escape", (r) => { r.components.core.storage.object = "beta/%63ore.zip"; }],
  ["object query", (r) => { r.components.core.storage.object = "beta/core.zip?x"; }],
  ["object fragment", (r) => { r.components.core.storage.object = "beta/core.zip#x"; }],
  ["object over limit", (r) => { r.components.core.storage.object = "a".repeat(513); }],
];

for (const [name, mutate] of recordCases) {
  test(`active record rejects ${name} for manifest and grant`, async () => {
    await loadProvider();
    const record = validRecord();
    mutate(record);
    assertRecordRejected(environment(record));
  });
}

const CAPABILITY_NOW = new Date("2026-09-07T04:05:06.000Z");
const CAPABILITY_BYTES = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const UNKNOWN_CAPABILITY_BYTES = Buffer.from(Array.from({ length: 32 }, (_, index) => 255 - index));
const CAPABILITY_TOKEN = CAPABILITY_BYTES.toString("base64url");
const UNKNOWN_CAPABILITY_TOKEN = UNKNOWN_CAPABILITY_BYTES.toString("base64url");
const CAPABILITY_DIGEST = "630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abC1b8581bd710dd".toLowerCase();
const REGISTRY_SENTINEL = "REGISTRY_SENTINEL_MUST_NOT_ESCAPE";

function capability(overrides = {}) {
  return {
    credential_sha256: CAPABILITY_DIGEST,
    channel: "beta",
    artifact_ids: [IDS.core],
    expires_at: "2026-09-07T04:05:07Z",
    enabled: true,
    revoked: false,
    ...overrides,
  };
}

function capabilityEnvironment(registry = [capability()]) {
  return {
    ...environment(),
    DISTRIBUTION_CAPABILITIES_JSON: typeof registry === "string" ? registry : JSON.stringify(registry),
  };
}

function coreGrant(env = capabilityEnvironment(), header, now = CAPABILITY_NOW) {
  const resolvedHeader = arguments.length < 2 ? `NekoDistribution ${CAPABILITY_TOKEN}` : header;
  return getArtifactGrant(IDS.core, env, now, resolvedHeader);
}

function assertSafeCapabilityError(expectedCode, expectedStatus, secrets = []) {
  return (error) => {
    assert.ok(error instanceof SoftwareUpdateProviderError);
    assert.equal(error.code, expectedCode);
    assert.equal(error.message, expectedCode);
    assert.equal(error.status, expectedStatus);
    assert.equal(error.isSafe, true);
    const ownEnumerable = Object.fromEntries(Object.entries(error));
    const secretSentinels = [CAPABILITY_TOKEN, CAPABILITY_DIGEST, REGISTRY_SENTINEL, ...secrets]
      .map(String)
      .filter((secret) => secret.length > 0);
    for (const representation of [...errorRepresentations(error), JSON.stringify(ownEnumerable)]) {
      for (const secret of secretSentinels) {
        assert.equal(representation.includes(secret), false);
      }
    }
    return true;
  };
}

function assertForbidden(secrets = []) {
  return assertSafeCapabilityError("DISTRIBUTION_CAPABILITY_INVALID", 403, secrets);
}

function assertRegistryInvalid(raw) {
  const env = capabilityEnvironment(raw);
  assert.throws(() => coreGrant(env), assertSafeCapabilityError("SOFTWARE_UPDATE_RECORD_INVALID", 500, [String(raw)]));
}

test("capability token fixtures are deterministic canonical 32-byte base64url values", () => {
  assert.equal(CAPABILITY_BYTES.length, 32);
  assert.equal(CAPABILITY_TOKEN.length, 43);
  assert.match(CAPABILITY_TOKEN, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(CAPABILITY_TOKEN, "base64url").toString("base64url"), CAPABILITY_TOKEN);
  assert.equal(UNKNOWN_CAPABILITY_BYTES.length, 32);
  assert.equal(UNKNOWN_CAPABILITY_TOKEN.length, 43);
});

test("Launcher grant never parses or requires capability configuration", async () => {
  await loadProvider();
  const hostileHeaders = [null, "", `Wrong ${REGISTRY_SENTINEL}`, `NekoDistribution ${REGISTRY_SENTINEL}`];
  const hostileRegistries = [undefined, "", REGISTRY_SENTINEL, "[]", "[{}]"];
  for (const authHeader of hostileHeaders) {
    for (const registry of hostileRegistries) {
      const env = environment();
      if (registry !== undefined) env.DISTRIBUTION_CAPABILITIES_JSON = registry;
      const grant = getArtifactGrant(IDS.launcher, env, CAPABILITY_NOW, authHeader);
      assert.equal(grant.url, validRecord().components.launcher.public_url);
    }
  }
});

test("missing Core Authorization header is 401 without parsing the registry", async () => {
  await loadProvider();
  for (const header of [null, undefined]) {
    assert.throws(
      () => coreGrant({ ...environment(), DISTRIBUTION_CAPABILITIES_JSON: REGISTRY_SENTINEL }, header),
      assertSafeCapabilityError("DISTRIBUTION_CAPABILITY_REQUIRED", 401),
    );
  }
});

const malformedAuthorizationHeaders = [
  ["empty header", ""],
  ["wrong scheme", `Bearer ${CAPABILITY_TOKEN}`],
  ["case-changed scheme", `nekodistribution ${CAPABILITY_TOKEN}`],
  ["scheme only", "NekoDistribution"],
  ["leading whitespace", ` NekoDistribution ${CAPABILITY_TOKEN}`],
  ["trailing whitespace", `NekoDistribution ${CAPABILITY_TOKEN} `],
  ["two spaces", `NekoDistribution  ${CAPABILITY_TOKEN}`],
  ["tab separator", `NekoDistribution\t${CAPABILITY_TOKEN}`],
  ["multiple tokens", `NekoDistribution ${CAPABILITY_TOKEN} ${UNKNOWN_CAPABILITY_TOKEN}`],
  ["comma-joined second header", `NekoDistribution ${CAPABILITY_TOKEN}, NekoDistribution ${UNKNOWN_CAPABILITY_TOKEN}`],
  ["padded token", `NekoDistribution ${CAPABILITY_TOKEN}=`],
  ["42-character token", `NekoDistribution ${CAPABILITY_TOKEN.slice(0, 42)}`],
  ["44-character token", `NekoDistribution ${CAPABILITY_TOKEN}A`],
  ["invalid alphabet", `NekoDistribution ${CAPABILITY_TOKEN.slice(0, 42)}+`],
  ["noncanonical base64url", `NekoDistribution ${CAPABILITY_TOKEN.slice(0, 42)}B`],
  ["decoded length 31", `NekoDistribution ${Buffer.alloc(31, 4).toString("base64url")}`],
  ["decoded length 33", `NekoDistribution ${Buffer.alloc(33, 4).toString("base64url")}`],
];

for (const [name, header] of malformedAuthorizationHeaders) {
  test(`Core rejects ${name} authorization syntax as 403`, async () => {
    await loadProvider();
    assert.throws(() => coreGrant(capabilityEnvironment(), header), assertForbidden([header]));
  });
}

test("exact canonical token authorizes by SHA-256 of decoded bytes, channel, scope, state, and future expiry", async () => {
  await loadProvider();
  const grant = coreGrant();
  assert.deepEqual(Object.keys(grant).sort(), ["expires_at", "url"]);
  assert.match(grant.url, /^supabase-private:\/\//);
});

test("valid Core authorization compares fixed 32-byte Buffer digests with timingSafeEqual", async (t) => {
  await loadProvider();
  const calls = [];
  const realTimingSafeEqual = crypto.timingSafeEqual;
  t.mock.method(crypto, "timingSafeEqual", (left, right) => {
    calls.push([left, right]);
    return realTimingSafeEqual(left, right);
  });

  const grant = coreGrant();
  assert.match(grant.url, /^supabase-private:\/\//);
  assert.ok(calls.length >= 1);
  for (const comparedDigests of calls) {
    assert.equal(comparedDigests.length, 2);
    for (const digest of comparedDigests) {
      assert.ok(Buffer.isBuffer(digest));
      assert.equal(digest.length, 32);
    }
  }
});

const authorizationDenials = [
  ["unknown digest", () => [capabilityEnvironment(), `NekoDistribution ${UNKNOWN_CAPABILITY_TOKEN}`, CAPABILITY_NOW]],
  ["expired", () => [capabilityEnvironment([capability({ expires_at: "2026-09-07T04:05:05Z" })]), `NekoDistribution ${CAPABILITY_TOKEN}`, CAPABILITY_NOW]],
  ["expiry equal to now", () => [capabilityEnvironment([capability({ expires_at: "2026-09-07T04:05:06Z" })]), `NekoDistribution ${CAPABILITY_TOKEN}`, CAPABILITY_NOW]],
  ["disabled", () => [capabilityEnvironment([capability({ enabled: false })]), `NekoDistribution ${CAPABILITY_TOKEN}`, CAPABILITY_NOW]],
  ["revoked", () => [capabilityEnvironment([capability({ revoked: true })]), `NekoDistribution ${CAPABILITY_TOKEN}`, CAPABILITY_NOW]],
  ["channel mismatch", () => [capabilityEnvironment([capability({ channel: "stable" })]), `NekoDistribution ${CAPABILITY_TOKEN}`, CAPABILITY_NOW]],
  ["out of scope", () => [capabilityEnvironment([capability({ artifact_ids: [IDS.launcher] })]), `NekoDistribution ${CAPABILITY_TOKEN}`, CAPABILITY_NOW]],
];

for (const [name, arrange] of authorizationDenials) {
  test(`Core authorization rejects ${name}`, async () => {
    await loadProvider();
    const [env, header, now] = arrange();
    assert.throws(() => coreGrant(env, header, now), assertForbidden([UNKNOWN_CAPABILITY_TOKEN]));
  });
}

test("registry requires a bounded nonempty array", async () => {
  await loadProvider();
  for (const raw of [undefined, "", " ", "null", "{}", "[]", JSON.stringify(Array.from({ length: 1025 }, capability))]) {
    const env = environment();
    if (raw !== undefined) env.DISTRIBUTION_CAPABILITIES_JSON = raw;
    assert.throws(() => coreGrant(env), assertSafeCapabilityError("SOFTWARE_UPDATE_RECORD_INVALID", 500));
  }
});

const malformedRegistryEntries = [
  ["non-object entry", [null]],
  ...["credential_sha256", "channel", "artifact_ids", "expires_at", "enabled", "revoked"].map((field) => [
    `missing ${field}`,
    [(() => { const item = capability(); delete item[field]; return item; })()],
  ]),
  ["extra field", [capability({ extra: REGISTRY_SENTINEL })]],
  ["array entry", [[capability()]]],
  ["uppercase digest", [capability({ credential_sha256: CAPABILITY_DIGEST.toUpperCase() })]],
  ["short digest", [capability({ credential_sha256: "a".repeat(63) })]],
  ["nonhex digest", [capability({ credential_sha256: "g".repeat(64) })]],
  ["channel non-string", [capability({ channel: 1 })]],
  ["unsafe channel identifier", [capability({ channel: "bad channel" })]],
  ["empty scope", [capability({ artifact_ids: [] })]],
  ["duplicate scope", [capability({ artifact_ids: [IDS.core, IDS.core] })]],
  ["invalid scope id", [capability({ artifact_ids: ["bad id"] })]],
  ["too many scope ids", [capability({ artifact_ids: Array.from({ length: 65 }, (_, i) => `core-scope-${i}`) })]],
  ["scope is not array", [capability({ artifact_ids: IDS.core })]],
  ["malformed expiry", [capability({ expires_at: "tomorrow" })]],
  ["non-UTC expiry", [capability({ expires_at: "2026-09-07T11:05:07+07:00" })]],
  ["fractional expiry", [capability({ expires_at: "2026-09-07T04:05:07.000Z" })]],
  ["enabled nonboolean", [capability({ enabled: 1 })]],
  ["revoked nonboolean", [capability({ revoked: 0 })]],
];

for (const [name, registry] of malformedRegistryEntries) {
  test(`registry rejects ${name} as a whole-registry configuration failure`, async () => {
    await loadProvider();
    assertRegistryInvalid(registry);
  });
}

test("registry rejects duplicate JSON entry keys before object construction", async () => {
  await loadProvider();
  const raw = `[{"credential_sha256":"${CAPABILITY_DIGEST}","credential_sha256":"${"f".repeat(64)}","channel":"beta","artifact_ids":["${IDS.core}"],"expires_at":"2026-09-07T04:05:07Z","enabled":true,"revoked":false}]`;
  assertRegistryInvalid(raw);
});

test("one malformed registry entry beside a valid entry fails closed instead of skipping", async () => {
  await loadProvider();
  assertRegistryInvalid([capability(), { ...capability(), extra: REGISTRY_SENTINEL }]);
});

test("invalid injected clock fails closed before capability expiry comparison", async () => {
  await loadProvider();
  for (const now of [new Date(Number.NaN), "2026-09-07T04:05:06Z", null]) {
    assert.throws(
      () => coreGrant(capabilityEnvironment(), `NekoDistribution ${CAPABILITY_TOKEN}`, now),
      assertSafeCapabilityError("SOFTWARE_UPDATE_CLOCK_INVALID", 500),
    );
  }
});

const SIGNED_URL = "https://storage.example.invalid/object/sign/private-updates/beta/0002/core.zip?token=synthetic";
const SIGNER_SECRET_SENTINELS = [
  "private-updates", "beta/0002/core.zip", "synthetic-service-key", CAPABILITY_TOKEN,
  CAPABILITY_DIGEST, "provider-detail-sentinel", SIGNED_URL,
];

function assertSafeGrantFailure(error) {
  assert.ok(error instanceof SoftwareUpdateProviderError);
  assert.equal(error.isSafe, true);
  assert.match(error.code, /(?:PROVIDER|GRANT)/);
  for (const representation of [...errorRepresentations(error), JSON.stringify(Object.fromEntries(Object.entries(error)))]) {
    for (const secret of SIGNER_SECRET_SENTINELS) assert.equal(representation.includes(secret), false);
  }
  return true;
}

function signerSpy(result = SIGNED_URL) {
  const calls = [];
  const signer = async (...args) => {
    calls.push(args);
    if (result instanceof Error) throw result;
    return result;
  };
  return { calls, signer };
}

test("Core grant awaits signer once with only trusted storage identity and TTL 120", async () => {
  await loadProvider();
  const spy = signerSpy();
  const grant = await getArtifactGrant(
    IDS.core,
    capabilityEnvironment(),
    CAPABILITY_NOW,
    `NekoDistribution ${CAPABILITY_TOKEN}`,
    spy.signer,
  );
  assert.deepEqual(spy.calls, [["private-updates", "beta/0002/core.zip", 120]]);
  assert.deepEqual(grant, {
    url: SIGNED_URL,
    expires_at: "2026-09-07T04:07:06.000Z",
  });
});

test("caller artifact id selects only a known trusted component and never storage identity", async () => {
  await loadProvider();
  const spy = signerSpy();
  await assert.rejects(
    Promise.resolve().then(() => getArtifactGrant(
      "attacker-selected-object",
      capabilityEnvironment(),
      CAPABILITY_NOW,
      `NekoDistribution ${CAPABILITY_TOKEN}`,
      spy.signer,
    )),
    assertCode("SOFTWARE_UPDATE_ARTIFACT_NOT_FOUND", 404),
  );
  assert.equal(spy.calls.length, 0);
});

test("Launcher is anonymous, signer-free, capability-parser-free, exact, and 120 seconds", async () => {
  await loadProvider();
  const spy = signerSpy(new Error("must not run"));
  const env = { ...environment(), DISTRIBUTION_CAPABILITIES_JSON: REGISTRY_SENTINEL };
  const grant = await getArtifactGrant(IDS.launcher, env, CAPABILITY_NOW,
    `NekoDistribution ${REGISTRY_SENTINEL}`, spy.signer);
  assert.equal(spy.calls.length, 0);
  assert.deepEqual(grant, {
    url: validRecord().components.launcher.public_url,
    expires_at: "2026-09-07T04:07:06.000Z",
  });
});

test("invalid record and Core authorization failures never call signer", async () => {
  await loadProvider();
  const cases = [
    [environment({ ...validRecord(), channel: "stable" }), `NekoDistribution ${CAPABILITY_TOKEN}`, IDS.core],
    [capabilityEnvironment(), null, IDS.core],
    [capabilityEnvironment(), "bad", IDS.core],
    [capabilityEnvironment(), `NekoDistribution ${UNKNOWN_CAPABILITY_TOKEN}`, IDS.core],
    [capabilityEnvironment([capability({ revoked: true })]), `NekoDistribution ${CAPABILITY_TOKEN}`, IDS.core],
  ];
  for (const [env, header, id] of cases) {
    const spy = signerSpy();
    await assert.rejects(Promise.resolve().then(() => getArtifactGrant(id, env, CAPABILITY_NOW, header, spy.signer)));
    assert.equal(spy.calls.length, 0);
  }
});

for (const [name, output] of [
  ["throw", new Error("provider-detail-sentinel synthetic-service-key")],
  ["non-string URL", { url: SIGNED_URL }],
  ["HTTP URL", "http://storage.example.invalid/signed"],
  ["userinfo URL", "https://user:pass@storage.example.invalid/signed"],
  ["missing-host URL", "https:///signed"],
  ["fragment URL", "https://storage.example.invalid/signed#provider-detail-sentinel"],
]) {
  test(`Core signer ${name} becomes a generic safe grant failure`, async () => {
    await loadProvider();
    const spy = signerSpy(output);
    await assert.rejects(
      Promise.resolve().then(() => getArtifactGrant(
        IDS.core,
        capabilityEnvironment(),
        CAPABILITY_NOW,
        `NekoDistribution ${CAPABILITY_TOKEN}`,
        spy.signer,
      )),
      assertSafeGrantFailure,
    );
    assert.equal(spy.calls.length, 1);
  });
}

test("Supabase private signer wrapper calls Storage API exactly and accepts signedUrl", async () => {
  await loadSupabaseSigner();
  const calls = [];
  const client = { storage: { from(bucket) {
    calls.push(["from", bucket]);
    return { async createSignedUrl(object, ttl) {
      calls.push(["createSignedUrl", object, ttl]);
      return { data: { signedUrl: SIGNED_URL }, error: null };
    } };
  } } };
  assert.equal(await createPrivateStorageSignedGetUrl("bucket-a", "path/core.zip", 120, client), SIGNED_URL);
  assert.deepEqual(calls, [["from", "bucket-a"], ["createSignedUrl", "path/core.zip", 120]]);
});

test("Supabase private signer wrapper validates TTL, provider result, and signed URL safely", async () => {
  await loadSupabaseSigner();
  for (const ttl of [0, 121, 1.5, "120", null]) {
    await assert.rejects(createPrivateStorageSignedGetUrl("bucket-a", "path/core.zip", ttl, {}));
  }
  for (const result of [
    { data: null, error: { message: "provider-detail-sentinel" } },
    { data: { signedUrl: "http://storage.example.invalid/x" }, error: null },
    { data: { signedUrl: "https://u:p@storage.example.invalid/x" }, error: null },
    { data: { signedUrl: "https:///x" }, error: null },
    { data: { signedUrl: "https://storage.example.invalid/x#secret" }, error: null },
  ]) {
    const client = { storage: { from: () => ({ createSignedUrl: async () => result }) } };
    await assert.rejects(createPrivateStorageSignedGetUrl("bucket-a", "path/core.zip", 120, client), (error) => {
      assert.doesNotMatch(String(error), /provider-detail-sentinel|bucket-a|path\/core\.zip|storage\.example\.invalid/);
      return true;
    });
  }
});
