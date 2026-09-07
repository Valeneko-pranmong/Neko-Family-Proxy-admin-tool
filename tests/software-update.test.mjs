import assert from "node:assert/strict";
import test from "node:test";

let SoftwareUpdateProviderError;
let getArtifactGrant;
let getSoftwareUpdateManifest;
let providerPromise;

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
        artifact_sha256: SHA.launcher,
        artifact_size: SIZE.launcher,
        artifact_format: "raw-pe-v1",
        distribution: "public-launcher",
        public_url: "https://objects.example.invalid/releases/launcher-0002.exe",
      },
      core: {
        artifact_id: IDS.core,
        artifact_sha256: SHA.core,
        artifact_size: SIZE.core,
        artifact_format: "zip-core-v1",
        distribution: "controlled-core",
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
    "artifact_format", "artifact_id", "artifact_sha256", "artifact_size", "distribution", "public_url",
  ]);
  assert.deepEqual(Object.keys(record.components.core).sort(), [
    "artifact_format", "artifact_id", "artifact_sha256", "artifact_size", "distribution", "storage",
  ]);
  assert.deepEqual(Object.keys(record.components.core.storage).sort(), ["bucket", "object"]);
  assert.deepEqual(getSoftwareUpdateManifest("beta", environment(record)), record.envelope);
});

test("canonical release-v2 payload agrees exactly with trusted component metadata", () => {
  const record = validRecord();
  const payload = canonicalPayload();
  for (const key of ["launcher", "core"]) {
    assert.equal(payload.components[key].artifact_id, record.components[key].artifact_id);
    assert.equal(payload.components[key].artifact_sha256, record.components[key].artifact_sha256);
    assert.equal(payload.components[key].artifact_size, record.components[key].artifact_size);
    assert.equal(payload.components[key].artifact_format, record.components[key].artifact_format);
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
  ["missing launcher field", (r) => { delete r.components.launcher.artifact_size; }],
  ["extra launcher field", (r) => { r.components.launcher[SENTINEL] = SENTINEL; }],
  ["missing core field", (r) => { delete r.components.core.artifact_sha256; }],
  ["extra core field", (r) => { r.components.core[SENTINEL] = SENTINEL; }],
  ["missing storage bucket", (r) => { delete r.components.core.storage.bucket; }],
  ["extra storage field", (r) => { r.components.core.storage[SENTINEL] = SENTINEL; }],
  ["uppercase launcher SHA", (r) => { r.components.launcher.artifact_sha256 = "A".repeat(64); }],
  ["wrong-length core SHA", (r) => { r.components.core.artifact_sha256 = "2".repeat(63); }],
  ["launcher size zero", (r) => { r.components.launcher.artifact_size = 0; }],
  ["core size negative", (r) => { r.components.core.artifact_size = -1; }],
  ["launcher size fractional", (r) => { r.components.launcher.artifact_size = 1.5; }],
  ["core size boolean", (r) => { r.components.core.artifact_size = true; }],
  ["launcher size over limit", (r) => { r.components.launcher.artifact_size = 134_217_729; }],
  ["core size over limit", (r) => { r.components.core.artifact_size = 1_073_741_825; }],
  ["wrong launcher format", (r) => { r.components.launcher.artifact_format = "zip-core-v1"; }],
  ["wrong core format", (r) => { r.components.core.artifact_format = "raw-pe-v1"; }],
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
