import assert from "node:assert/strict";
import crypto from "node:crypto";
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

function assertSafeErrorDoesNotRetain(error, expectedCode, forbiddenValues) {
  assert.ok(error instanceof SoftwareUpdateProviderError);
  assert.equal(error.code, expectedCode);
  assert.equal(error.message, expectedCode);
  assert.equal(error.isSafe, true);

  const retainedRepresentations = [
    error.message,
    error.code,
    String(error.status),
    String(error),
    JSON.stringify(error),
  ];

  for (const forbiddenValue of forbiddenValues) {
    for (const representation of retainedRepresentations) {
      assert.doesNotMatch(representation, new RegExp(forbiddenValue));
    }
  }

  return true;
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

test("invalid top-level extras are not retained by safe errors", async () => {
  await loadSoftwareUpdateProvider();
  const credential = "SENTINEL_PROXY_CREDENTIAL_42";
  const permit = "eyJaaaaaa.bbbbbbb.ccccccc";
  const forbiddenValues = [credential, permit];

  for (const record of [
    { ...validRecord(), credential },
    { ...validRecord(), permit },
  ]) {
    assert.throws(
      () => getSoftwareUpdateManifest("beta", env(record)),
      (error) =>
        assertSafeErrorDoesNotRetain(
          error,
          "SOFTWARE_UPDATE_RECORD_INVALID",
          forbiddenValues,
        ),
    );
  }
});

test("artifact grant requires NekoDistribution capability for controlled core artifact", async () => {
  await loadSoftwareUpdateProvider();
  const rawToken = "my-secret-distribution-cap";
  const tokenSha = crypto.createHash("sha256").update(rawToken).digest("hex");
  const coreArtifactId = "core-win-x64-beta-0002";
  const launcherArtifactId = "launcher-win-x64-beta-0002";

  const payloadDoc = {
    schema_version: 2,
    channel: "beta",
    release_sequence: 2,
    release_id: "r2",
    components: {
      launcher: { artifact_id: launcherArtifactId },
      core: { artifact_id: coreArtifactId },
    },
  };
  const record = {
    ...validRecord(),
    envelope: {
      ...envelope,
      payload_b64: Buffer.from(JSON.stringify(payloadDoc)).toString("base64"),
    },
  };

  const envWithCap = {
    ...env(record),
    DISTRIBUTION_CAPABILITIES_JSON: JSON.stringify([
      {
        credential_sha256: tokenSha,
        enabled: true,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        channel: "beta",
        artifact_ids: [coreArtifactId],
      },
    ]),
  };

  // 1. Core artifact request without Authorization header must fail with 401
  assert.throws(
    () => getArtifactGrant(coreArtifactId, envWithCap, new Date(), null),
    (err) => err.code === "DISTRIBUTION_CAPABILITY_REQUIRED" && err.status === 401,
  );

  // 2. Core artifact request with invalid token must fail with 403
  assert.throws(
    () => getArtifactGrant(coreArtifactId, envWithCap, new Date(), "NekoDistribution wrong-token"),
    (err) => err.code === "DISTRIBUTION_CAPABILITY_INVALID" && err.status === 403,
  );

  // 3. Core artifact request with valid token succeeds
  const grant = getArtifactGrant(coreArtifactId, envWithCap, new Date(), `NekoDistribution ${rawToken}`);
  assert.ok(grant.url);

  // 4. Launcher artifact request can be anonymous
  const launcherGrant = getArtifactGrant(launcherArtifactId, envWithCap, new Date(), null);
  assert.ok(launcherGrant.url);
});


test("unknown artifact ids are not retained by safe errors", async () => {
  await loadSoftwareUpdateProvider();
  const artifactId = "eyJaaaaaa.bbbbbbb.ccccccc";

  assert.throws(
    () => getArtifactGrant(artifactId, env()),
    (error) =>
      assertSafeErrorDoesNotRetain(
        error,
        "SOFTWARE_UPDATE_ARTIFACT_NOT_FOUND",
        [artifactId],
      ),
  );
});
