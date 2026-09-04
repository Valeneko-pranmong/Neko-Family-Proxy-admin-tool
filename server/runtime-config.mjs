import { rpcPost } from "./supabase.mjs";

const PAYLOAD_FIELDS = ["endpoint_id", "host", "port", "cipher", "credential"];
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;
const LIMITS = {
  endpoint_id: 64,
  host: 253,
  cipher: 64,
  credential: 256,
};

function runtimeConfigError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.isSafe = true;
  return error;
}

function isBoundedPrintableAscii(value, maximumLength) {
  return (
    typeof value === "string"
    && value.length <= maximumLength
    && PRINTABLE_ASCII.test(value)
  );
}

function safeMetadata(value, { missingStatus = 502 } = {}) {
  if (value === null || value === undefined) {
    throw runtimeConfigError("No active runtime config", missingStatus);
  }
  if (
    typeof value !== "object"
    || Array.isArray(value)
    || !Number.isSafeInteger(value.config_version)
    || value.config_version < 1
    || !isBoundedPrintableAscii(value.endpoint_id, LIMITS.endpoint_id)
    || typeof value.published_at !== "string"
    || Number.isNaN(Date.parse(value.published_at))
  ) {
    throw runtimeConfigError("Runtime config backend returned invalid metadata", 502);
  }
  return {
    config_version: value.config_version,
    endpoint_id: value.endpoint_id,
    published_at: value.published_at,
  };
}

function validatePayload(payload) {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw runtimeConfigError("Invalid runtime config payload");
  }
  const fields = Object.keys(payload).sort();
  if (
    fields.length !== PAYLOAD_FIELDS.length
    || fields.some((field, index) => field !== [...PAYLOAD_FIELDS].sort()[index])
  ) {
    throw runtimeConfigError("Runtime config payload must contain exact fields");
  }
  for (const field of ["endpoint_id", "host", "cipher", "credential"]) {
    if (!isBoundedPrintableAscii(payload[field], LIMITS[field])) {
      throw runtimeConfigError("Invalid runtime config payload");
    }
  }
  if (!Number.isInteger(payload.port) || payload.port < 1 || payload.port > 65535) {
    throw runtimeConfigError("Invalid runtime config payload");
  }
}

async function runtimeConfigRpc(functionName, payload) {
  try {
    return await rpcPost(functionName, payload, "launcher");
  } catch {
    throw runtimeConfigError("Runtime config backend unavailable", 502);
  }
}

export async function getRuntimeConfigMetadata() {
  const active = await runtimeConfigRpc("get_active_runtime_proxy_config", {});
  return safeMetadata(active, { missingStatus: 404 });
}

export async function publishRuntimeConfig(payload, _actor) {
  validatePayload(payload);
  const published = await runtimeConfigRpc("publish_runtime_proxy_config", {
    p_endpoint_id: payload.endpoint_id,
    p_host: payload.host,
    p_port: payload.port,
    p_cipher: payload.cipher,
    p_credential: payload.credential,
  });
  return safeMetadata(published);
}
