const CHECK = "SOFTWARE_UPDATE_PROVIDER_PROOF";
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 1_048_576;
const EXPIRY_ALLOWANCE_MS = 150;
const MIN_PRE_EXPIRY_MARGIN_MS = 250;
const MAX_INITIAL_LIFETIME_MS = 120_000;
const MAX_POST_EXPIRY_WAIT_MS = MAX_INITIAL_LIFETIME_MS + EXPIRY_ALLOWANCE_MS;
const DENIAL_STATUSES = new Set([401, 403, 404]);

if (process.env.NEKO_SOFTWARE_UPDATE_PROVIDER_PROOF !== "1") {
  console.log(`${CHECK} SKIP: explicit opt-in not enabled`);
  process.exit(0);
}

function fail() {
  console.error(`${CHECK} FAIL`);
  process.exitCode = 1;
}

function parseProofUrl(name, allowLoopbackHttp) {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.length === 0) throw new Error("invalid input");
  const parsed = new URL(raw);
  if (!parsed.hostname || parsed.username || parsed.password || parsed.hash) {
    throw new Error("invalid input");
  }

  if (parsed.protocol === "https:") return parsed.href;

  const hostname = parsed.hostname === "[::1]" ? "::1" : parsed.hostname;
  const isLiteralLoopback = hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost";
  if (parsed.protocol !== "http:" || !allowLoopbackHttp || !isLiteralLoopback) {
    throw new Error("invalid input");
  }
  return parsed.href;
}

async function consumeBounded(response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) throw new Error("body limit");
    }
  } finally {
    if (total > MAX_BODY_BYTES) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function get(url) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await consumeBounded(response);
  return response.status;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  const allowLoopbackHttp = process.env.NEKO_SOFTWARE_UPDATE_PROVIDER_TEST_ALLOW_LOOPBACK_HTTP === "1";
  const anonymousUrl = parseProofUrl("NEKO_SOFTWARE_UPDATE_PROOF_ANONYMOUS_URL", allowLoopbackHttp);
  const signedUrl = parseProofUrl("NEKO_SOFTWARE_UPDATE_PROOF_SIGNED_URL", allowLoopbackHttp);
  const expiresAt = Date.parse(process.env.NEKO_SOFTWARE_UPDATE_PROOF_EXPIRES_AT ?? "");
  const startedAt = Date.now();
  const initialLifetime = expiresAt - startedAt;
  if (
    !Number.isFinite(expiresAt)
    || initialLifetime < MIN_PRE_EXPIRY_MARGIN_MS
    || initialLifetime > MAX_INITIAL_LIFETIME_MS
  ) {
    throw new Error("invalid input");
  }

  const anonymousStatus = await get(anonymousUrl);
  if (!DENIAL_STATUSES.has(anonymousStatus)) throw new Error("anonymous denial");
  console.log(`${CHECK} PASS: anonymous denial`);

  if (Date.now() >= expiresAt) throw new Error("pre-expiry window");
  const signedStatus = await get(signedUrl);
  if (signedStatus < 200 || signedStatus > 299) throw new Error("signed access");
  console.log(`${CHECK} PASS: signed access before expiry`);

  const remainingWait = expiresAt + EXPIRY_ALLOWANCE_MS - Date.now();
  if (remainingWait > MAX_POST_EXPIRY_WAIT_MS) throw new Error("wait limit");
  if (remainingWait > 0) await sleep(remainingWait);

  const expiredStatus = await get(signedUrl);
  if (!DENIAL_STATUSES.has(expiredStatus)) throw new Error("expiry denial");
  console.log(`${CHECK} PASS: signed access denied after expiry`);
  console.log(`${CHECK} PASS`);
} catch {
  fail();
}
