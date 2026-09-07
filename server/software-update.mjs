import crypto from "node:crypto";

const MAX_RECORD_CHARACTERS = 131_072;
const MAX_PAYLOAD_BYTES = 65_536;
const ARTIFACT_ID = /^[A-Za-z0-9._-]{1,96}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const CHANNEL = "beta";
const RECORD_FIELDS = ["channel", "components", "envelope"];
const PAYLOAD_FIELDS = [
  "schema_version", "channel", "release_sequence", "release_id", "mandatory",
  "minimum_supported_sequence", "updater_protocol", "components",
];
const PAYLOAD_COMPONENT_FIELDS = [
  "version", "artifact_id", "artifact_sha256", "artifact_size",
  "installed_identity_sha256", "artifact_format",
];

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

function parseJsonWithoutDuplicateKeys(text) {
  let index = 0;
  const whitespace = () => { while (/\s/u.test(text[index] ?? "")) index += 1; };
  const string = () => {
    const start = index++;
    while (index < text.length) {
      if (text[index] === "\\") { index += 2; continue; }
      if (text[index++] === "\"") return JSON.parse(text.slice(start, index));
    }
    throw new SyntaxError();
  };
  const value = () => {
    whitespace();
    if (text[index] === "{") {
      index += 1;
      whitespace();
      const keys = new Set();
      if (text[index] === "}") { index += 1; return; }
      for (;;) {
        if (text[index] !== "\"") throw new SyntaxError();
        const key = string();
        if (keys.has(key)) throw new SyntaxError();
        keys.add(key);
        whitespace();
        if (text[index++] !== ":") throw new SyntaxError();
        value();
        whitespace();
        if (text[index] === "}") { index += 1; return; }
        if (text[index++] !== ",") throw new SyntaxError();
        whitespace();
      }
    }
    if (text[index] === "[") {
      index += 1;
      whitespace();
      if (text[index] === "]") { index += 1; return; }
      for (;;) {
        value();
        whitespace();
        if (text[index] === "]") { index += 1; return; }
        if (text[index++] !== ",") throw new SyntaxError();
      }
    }
    if (text[index] === "\"") { string(); return; }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(index));
    if (!match) throw new SyntaxError();
    index += match[0].length;
  };
  value();
  whitespace();
  if (index !== text.length) throw new SyntaxError();
  return JSON.parse(text);
}

function decodeCanonicalBase64(value, maxBytes) {
  if (typeof value !== "string" || value.length === 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail("SOFTWARE_UPDATE_RECORD_INVALID");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > maxBytes || bytes.toString("base64") !== value) fail("SOFTWARE_UPDATE_RECORD_INVALID");
  return bytes;
}

function validateEnvelope(value) {
  if (!exactKeys(value, ["envelope_version", "key_id", "payload_b64", "signature_b64"])
    || value.envelope_version !== 1
    || typeof value.key_id !== "string"
    || !/^[A-Za-z0-9._-]{1,64}$/.test(value.key_id)) fail("SOFTWARE_UPDATE_RECORD_INVALID");
  decodeCanonicalBase64(value.signature_b64, 4096);
}

function validateArtifactUrl(value) {
  if (typeof value !== "string") fail("SOFTWARE_UPDATE_RECORD_INVALID");
  let url;
  try { url = new URL(value); } catch { fail("SOFTWARE_UPDATE_RECORD_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.hostname) {
    fail("SOFTWARE_UPDATE_RECORD_INVALID");
  }
  return url.toString();
}

function validSize(value, maximum) {
  return Number.isInteger(value) && value >= 1 && value <= maximum;
}

function validateRecordComponents(value) {
  if (!exactKeys(value, ["launcher", "core"])) fail("SOFTWARE_UPDATE_RECORD_INVALID");
  const launcher = value.launcher;
  const core = value.core;
  if (!exactKeys(launcher, ["artifact_id", "format", "distribution", "sha256", "size", "public_url"])
    || !exactKeys(core, ["artifact_id", "format", "distribution", "sha256", "size", "storage"])
    || !exactKeys(core.storage, ["bucket", "object"])) fail("SOFTWARE_UPDATE_RECORD_INVALID");
  if (!ARTIFACT_ID.test(launcher.artifact_id) || !ARTIFACT_ID.test(core.artifact_id)
    || launcher.artifact_id === core.artifact_id
    || !HEX64.test(launcher.sha256) || !HEX64.test(core.sha256)
    || !validSize(launcher.size, 134_217_728) || !validSize(core.size, 1_073_741_824)
    || launcher.format !== "raw-pe-v1" || core.format !== "zip-core-v1"
    || launcher.distribution !== "public-launcher" || core.distribution !== "controlled-core") {
    fail("SOFTWARE_UPDATE_RECORD_INVALID");
  }
  const bucket = core.storage.bucket;
  const object = core.storage.object;
  if (typeof bucket !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(bucket)
    || typeof object !== "string" || object.length < 1 || object.length > 512
    || !object.split("/").every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(part) && part !== "." && part !== "..")) {
    fail("SOFTWARE_UPDATE_RECORD_INVALID");
  }
  return {
    launcher: { ...launcher, public_url: validateArtifactUrl(launcher.public_url) },
    core: { ...core, storage: { ...core.storage } },
  };
}

function decodePayload(envelope) {
  const bytes = decodeCanonicalBase64(envelope.payload_b64, MAX_PAYLOAD_BYTES);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("SOFTWARE_UPDATE_RECORD_INVALID"); }
  if (text.charCodeAt(0) === 0xfeff) fail("SOFTWARE_UPDATE_RECORD_INVALID");
  try { return parseJsonWithoutDuplicateKeys(text); } catch { fail("SOFTWARE_UPDATE_RECORD_INVALID"); }
}

function validatePayload(payload, components) {
  if (!exactKeys(payload, PAYLOAD_FIELDS)
    || payload.schema_version !== 2 || payload.channel !== CHANNEL
    || !Number.isInteger(payload.release_sequence) || payload.release_sequence < 1
    || typeof payload.release_id !== "string" || !/^[A-Za-z0-9._-]{1,96}$/.test(payload.release_id)
    || typeof payload.mandatory !== "boolean"
    || !Number.isInteger(payload.minimum_supported_sequence) || payload.minimum_supported_sequence < 1
    || payload.minimum_supported_sequence > payload.release_sequence
    || !exactKeys(payload.updater_protocol, ["minimum", "maximum"])
    || !Number.isInteger(payload.updater_protocol.minimum) || payload.updater_protocol.minimum < 1
    || !Number.isInteger(payload.updater_protocol.maximum)
    || payload.updater_protocol.maximum < payload.updater_protocol.minimum
    || !exactKeys(payload.components, ["launcher", "core"])) fail("SOFTWARE_UPDATE_RECORD_INVALID");
  for (const name of ["launcher", "core"]) {
    const item = payload.components[name];
    const trusted = components[name];
    if (!exactKeys(item, PAYLOAD_COMPONENT_FIELDS)
      || typeof item.version !== "string" || item.version.length < 1 || item.version.length > 64
      || !HEX64.test(item.installed_identity_sha256)
      || item.artifact_id !== trusted.artifact_id
      || item.artifact_sha256 !== trusted.sha256
      || item.artifact_size !== trusted.size
      || item.artifact_format !== trusted.format) fail("SOFTWARE_UPDATE_RECORD_INVALID");
  }
}

function activeRecord(env) {
  const text = env.SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON;
  if (text === undefined || String(text).trim() === "") return null;
  if (typeof text !== "string" || text.length > MAX_RECORD_CHARACTERS) fail("SOFTWARE_UPDATE_RECORD_INVALID");
  let record;
  try { record = parseJsonWithoutDuplicateKeys(text); } catch { fail("SOFTWARE_UPDATE_RECORD_INVALID"); }
  if (!exactKeys(record, RECORD_FIELDS) || record.channel !== CHANNEL) fail("SOFTWARE_UPDATE_RECORD_INVALID");
  validateEnvelope(record.envelope);
  const components = validateRecordComponents(record.components);
  validatePayload(decodePayload(record.envelope), components);
  return { channel: CHANNEL, envelope: structuredClone(record.envelope), components };
}

export function getSoftwareUpdateManifest(channel, env = process.env) {
  if (channel !== CHANNEL) fail("SOFTWARE_UPDATE_CHANNEL_INVALID", 400);
  const record = activeRecord(env);
  return record === null ? null : structuredClone(record.envelope);
}

export function getArtifactGrant(artifactId, env = process.env, now = new Date(), authHeader = null) {
  if (typeof artifactId !== "string" || !ARTIFACT_ID.test(artifactId)) fail("SOFTWARE_UPDATE_ARTIFACT_ID_INVALID", 400);
  const record = activeRecord(env);
  const entry = record && Object.values(record.components).find((component) => component.artifact_id === artifactId);
  if (!entry) fail("SOFTWARE_UPDATE_ARTIFACT_NOT_FOUND", 404);
  const isCore = entry === record.components.core;

  if (isCore) {
    if (!authHeader || typeof authHeader !== "string" || !authHeader.startsWith("NekoDistribution ")) fail("DISTRIBUTION_CAPABILITY_REQUIRED", 401);
    const token = authHeader.slice("NekoDistribution ".length).trim();
    if (!token) fail("DISTRIBUTION_CAPABILITY_REQUIRED", 401);
    const tokenSha = crypto.createHash("sha256").update(token).digest("hex");
    let capabilities = [];
    if (env.DISTRIBUTION_CAPABILITIES_JSON) {
      try { capabilities = JSON.parse(env.DISTRIBUTION_CAPABILITIES_JSON); } catch { fail("SOFTWARE_UPDATE_RECORD_INVALID"); }
    }
    const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
    let authorized = false;
    if (Array.isArray(capabilities)) {
      for (const cap of capabilities) {
        if (!cap || typeof cap !== "object" || !cap.enabled) continue;
        if (typeof cap.expires_at === "string") {
          const expMs = new Date(cap.expires_at).getTime();
          if (Number.isFinite(expMs) && nowMs > expMs) continue;
        }
        if (Array.isArray(cap.artifact_ids) && !cap.artifact_ids.includes(artifactId)) continue;
        if (typeof cap.credential_sha256 === "string" && cap.credential_sha256.length === 64) {
          const a = Buffer.from(cap.credential_sha256, "hex");
          const b = Buffer.from(tokenSha, "hex");
          if (a.length === b.length && crypto.timingSafeEqual(a, b)) { authorized = true; break; }
        }
      }
    }
    if (!authorized) fail("DISTRIBUTION_CAPABILITY_INVALID", 403);
  }

  const timestamp = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(timestamp)) fail("SOFTWARE_UPDATE_CLOCK_INVALID");
  return {
    url: isCore ? `supabase-private://${entry.storage.bucket}/${entry.storage.object}` : entry.public_url,
    expires_at: new Date(timestamp + 10 * 60 * 1000).toISOString(),
  };
}
