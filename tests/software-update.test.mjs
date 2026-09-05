import assert from "node:assert/strict";
import test from "node:test";

let SoftwareUpdateProviderError;
let getArtifactGrant;
let getSoftwareUpdateManifest;
let softwareUpdateProviderPromise;

async function loadSoftwareUpdateProvider() {
  try {
    const provider = await (softwareUpdateProviderPromise ??=
      import("../server/software-update.mjs"));
    SoftwareUpdateProviderError = provider.SoftwareUpdateProviderError;
    getArtifactGrant = provider.getArtifactGrant;
    getSoftwareUpdateManifest = provider.getSoftwareUpdateManifest;
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      assert.fail("software update provider module is missing");
    }
    throw error;
  }
}

const envelope = {
  envelope_version: 1,
  key_id: "neko-update-test-1",
  payload_b64: "cGF5bG9hZA==",
  signature_b64: "A".repeat(88),
};

function validRecord() {
  return {
    channel: "beta",
    envelope,
    artifacts: {
      "launcher-win-x64-beta-0002": "https://objects.example.invalid/launcher-win-x64-beta-0002",
      "core-win-x64-beta-0002": "https://objects.example.invalid/core-win-x64-beta-0002",
    },
  };
}

function env(record = validRecord()) {
  return { SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON: JSON.stringify(record) };
}

function code(expected) {
  return (error) => error instanceof SoftwareUpdateProviderError && error.code === expected;
}

function safeError(expectedCode, expectedStatus) {
  return (error) => {
    assert.ok(error instanceof SoftwareUpdateProviderError);
    assert.equal(error.code, expectedCode);
    assert.equal(error.status, expectedStatus);
    assert.equal(error.isSafe, true);
    return true;
  };
}

for (const [description, noReleaseEnv] of [
  ["absent", {}],
  ["empty", { SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON: "" }],
  ["whitespace-only", { SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON: " \t\r\n" }],
]) {
  test(`${description} active record is an explicit no-release state`, async () => {
    await loadSoftwareUpdateProvider();
    assert.equal(getSoftwareUpdateManifest("beta", noReleaseEnv), null);
    assert.throws(
      () => getArtifactGrant("launcher-win-x64-beta-0002", noReleaseEnv),
      safeError("SOFTWARE_UPDATE_ARTIFACT_NOT_FOUND", 404),
    );
  });
}

test("manifest returns only the opaque signed envelope", async () => {
  await loadSoftwareUpdateProvider();
  assert.deepEqual(getSoftwareUpdateManifest("beta", env()), envelope);
});

test("artifact grant is allow-listed and expires in ten minutes", async () => {
  await loadSoftwareUpdateProvider();
  const grant = getArtifactGrant(
    "launcher-win-x64-beta-0002",
    env(),
    new Date("2026-09-05T08:00:00.000Z"),
  );
  assert.deepEqual(grant, {
    url: "https://objects.example.invalid/launcher-win-x64-beta-0002",
    expires_at: "2026-09-05T08:10:00.000Z",
  });
  assert.throws(() => getArtifactGrant("unknown", env()), code("SOFTWARE_UPDATE_ARTIFACT_NOT_FOUND"));
});

test("artifact grants require own artifact keys", async () => {
  await loadSoftwareUpdateProvider();
  for (const artifactId of ["toString", "constructor", "__proto__"]) {
    assert.throws(
      () => getArtifactGrant(artifactId, env()),
      safeError("SOFTWARE_UPDATE_ARTIFACT_NOT_FOUND", 404),
    );
  }
});

test("provider rejects malformed JSON without exposing its contents", async () => {
  await loadSoftwareUpdateProvider();
  const sentinel = "SENTINEL_MALFORMED_RELEASE_SECRET_42";
  const malformedEnv = {
    SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON: `{"credential":"${sentinel}"`,
  };

  assert.throws(() => getSoftwareUpdateManifest("beta", malformedEnv), (error) => {
    assert.ok(error instanceof SoftwareUpdateProviderError);
    assert.equal(error.code, "SOFTWARE_UPDATE_RECORD_INVALID");
    assert.doesNotMatch(error.message, new RegExp(sentinel));
    return true;
  });
});

test("provider rejects malformed records, URLs, and secret-bearing extras", async () => {
  await loadSoftwareUpdateProvider();
  const sentinel = "SENTINEL_PROXY_SECRET_42";
  const invalid = [
    { ...validRecord(), extra: true },
    { ...validRecord(), channel: "stable" },
    { ...validRecord(), credential: sentinel },
    { ...validRecord(), envelope: { ...envelope, extra: true } },
    { ...validRecord(), artifacts: {} },
    { ...validRecord(), artifacts: { "bad id": "https://objects.example.invalid/a" } },
    { ...validRecord(), artifacts: { artifact: "http://objects.example.invalid/a" } },
    { ...validRecord(), artifacts: { artifact: "https://user:password@objects.example.invalid/a" } },
    { ...validRecord(), artifacts: { artifact: "https://objects.example.invalid/a?token=secret" } },
    { ...validRecord(), artifacts: { artifact: "https://objects.example.invalid/a#fragment" } },
  ];
  for (const record of invalid) {
    assert.throws(() => getSoftwareUpdateManifest("beta", env(record)), (error) => {
      assert.equal(error.code, "SOFTWARE_UPDATE_RECORD_INVALID");
      assert.doesNotMatch(error.message, new RegExp(sentinel));
      return true;
    });
  }
});

test("provider rejects invalid channel, id, and oversized configuration", async () => {
  await loadSoftwareUpdateProvider();
  assert.throws(() => getSoftwareUpdateManifest("stable", env()), code("SOFTWARE_UPDATE_CHANNEL_INVALID"));
  assert.throws(() => getArtifactGrant("../escape", env()), code("SOFTWARE_UPDATE_ARTIFACT_ID_INVALID"));
  assert.throws(
    () => getSoftwareUpdateManifest("beta", { SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON: "x".repeat(131_073) }),
    code("SOFTWARE_UPDATE_RECORD_INVALID"),
  );
});
