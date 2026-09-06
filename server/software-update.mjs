import crypto from "node:crypto";

const MAX_RECORD_CHARACTERS = 131_072;
const ARTIFACT_ID = /^[A-Za-z0-9._-]{1,96}$/;
const CHANNEL = "beta";
const RECORD_FIELDS = ["artifacts", "channel", "envelope"];

export class SoftwareUpdateProviderError extends Error {
  constructor(code, status = 500) {
    super(code);
    this.code = code;
    this.status = status;
    this.isSafe = true;
  }
}

function fail(code, status = 500) {
  throw new SoftwareUpdateProviderError(code, status);
}

function exactKeys(value, expected) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function validateEnvelope(value) {
  if (!exactKeys(value, ["envelope_version", "key_id", "payload_b64", "signature_b64"])) {
    fail("SOFTWARE_UPDATE_RECORD_INVALID");
  }
  if (
    value.envelope_version !== 1
    || typeof value.key_id !== "string"
    || !/^[A-Za-z0-9._-]{1,64}$/.test(value.key_id)
    || typeof value.payload_b64 !== "string"
    || typeof value.signature_b64 !== "string"
  ) {
    fail("SOFTWARE_UPDATE_RECORD_INVALID");
  }
}

function validateArtifactUrl(value) {
  if (typeof value !== "string") fail("SOFTWARE_UPDATE_RECORD_INVALID");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("SOFTWARE_UPDATE_RECORD_INVALID");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
    || !url.hostname
  ) {
    fail("SOFTWARE_UPDATE_RECORD_INVALID");
  }
  return url.toString();
}

function activeRecord(env) {
  const text = env.SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON;
  if (text === undefined || String(text).trim() === "") return null;
  if (typeof text !== "string" || text.length > MAX_RECORD_CHARACTERS) {
    fail("SOFTWARE_UPDATE_RECORD_INVALID");
  }
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    fail("SOFTWARE_UPDATE_RECORD_INVALID");
  }
  if (!exactKeys(record, RECORD_FIELDS) || record.channel !== CHANNEL) {
    fail("SOFTWARE_UPDATE_RECORD_INVALID");
  }
  validateEnvelope(record.envelope);
  if (record.artifacts === null || typeof record.artifacts !== "object" || Array.isArray(record.artifacts)) {
    fail("SOFTWARE_UPDATE_RECORD_INVALID");
  }
  const artifacts = Object.create(null);
  for (const [artifactId, artifactUrl] of Object.entries(record.artifacts)) {
    if (!ARTIFACT_ID.test(artifactId)) fail("SOFTWARE_UPDATE_RECORD_INVALID");
    artifacts[artifactId] = validateArtifactUrl(artifactUrl);
  }
  if (Object.keys(artifacts).length === 0) fail("SOFTWARE_UPDATE_RECORD_INVALID");
  return { channel: CHANNEL, envelope: record.envelope, artifacts };
}

export function getSoftwareUpdateManifest(channel, env = process.env) {
  if (channel !== CHANNEL) fail("SOFTWARE_UPDATE_CHANNEL_INVALID", 400);
  const record = activeRecord(env);
  return record === null ? null : structuredClone(record.envelope);
}

export function getArtifactGrant(artifactId, env = process.env, now = new Date(), authHeader = null) {
  if (typeof artifactId !== "string" || !ARTIFACT_ID.test(artifactId)) {
    fail("SOFTWARE_UPDATE_ARTIFACT_ID_INVALID", 400);
  }
  const record = activeRecord(env);
  if (record === null || !Object.hasOwn(record.artifacts, artifactId)) {
    fail("SOFTWARE_UPDATE_ARTIFACT_NOT_FOUND", 404);
  }

  // Check if artifact is controlled core
  let isCore = false;
  try {
    const rawPayload = Buffer.from(record.envelope.payload_b64, "base64").toString("utf-8");
    const payload = JSON.parse(rawPayload);
    if (payload?.components?.core?.artifact_id === artifactId) {
      isCore = true;
    }
  } catch {
    // If payload cannot be parsed, treat as non-core
  }

  if (isCore) {
    if (!authHeader || typeof authHeader !== "string" || !authHeader.startsWith("NekoDistribution ")) {
      fail("DISTRIBUTION_CAPABILITY_REQUIRED", 401);
    }
    const token = authHeader.slice("NekoDistribution ".length).trim();
    if (!token) {
      fail("DISTRIBUTION_CAPABILITY_REQUIRED", 401);
    }
    const tokenSha = crypto.createHash("sha256").update(token).digest("hex");

    let capabilities = [];
    if (env.DISTRIBUTION_CAPABILITIES_JSON) {
      try {
        capabilities = JSON.parse(env.DISTRIBUTION_CAPABILITIES_JSON);
      } catch {
        fail("SOFTWARE_UPDATE_RECORD_INVALID", 500);
      }
    }

    let authorized = false;
    const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
    if (Array.isArray(capabilities)) {
      for (const cap of capabilities) {
        if (!cap || typeof cap !== "object") continue;
        if (!cap.enabled) continue;
        if (typeof cap.expires_at === "string") {
          const expMs = new Date(cap.expires_at).getTime();
          if (Number.isFinite(expMs) && nowMs > expMs) continue;
        }
        if (Array.isArray(cap.artifact_ids) && !cap.artifact_ids.includes(artifactId)) {
          continue;
        }
        if (typeof cap.credential_sha256 === "string" && cap.credential_sha256.length === 64) {
          const a = Buffer.from(cap.credential_sha256, "hex");
          const b = Buffer.from(tokenSha, "hex");
          if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
            authorized = true;
            break;
          }
        }
      }
    }

    if (!authorized) {
      fail("DISTRIBUTION_CAPABILITY_INVALID", 403);
    }
  }

  const timestamp = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(timestamp)) fail("SOFTWARE_UPDATE_CLOCK_INVALID");
  return {
    url: record.artifacts[artifactId],
    expires_at: new Date(timestamp + 10 * 60 * 1000).toISOString(),
  };
}
