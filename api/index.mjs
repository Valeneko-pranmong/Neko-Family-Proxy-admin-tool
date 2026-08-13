import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { authenticateAdmin } from "../server/auth.mjs";
import { getResource, performAction } from "../server/admin.mjs";
import { accountRecovery } from "../server/account-recovery.mjs";
import { tableGet } from "../server/supabase.mjs";

const configuredSessionTtlMs = Number(
  process.env.ADMIN_SESSION_TTL_MS || 8 * 60 * 60 * 1000,
);
const sessionTtlMs =
  Number.isFinite(configuredSessionTtlMs)
  && configuredSessionTtlMs >= 5 * 60 * 1000
  && configuredSessionTtlMs <= 24 * 60 * 60 * 1000
    ? configuredSessionTtlMs
    : 8 * 60 * 60 * 1000;

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function sendError(response, status, message) {
  sendJson(response, status, { ok: false, error: message });
}

function parseCookies(request) {
  return Object.fromEntries(
    (request.headers.cookie || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, ...value]) => [key, value.join("=")]),
  );
}

async function bodyJson(request) {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 1024 * 1024) {
      const error = new Error("Request too large");
      error.status = 413;
      error.isSafe = true;
      throw error;
    }
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const error = new Error("Invalid JSON request");
    error.status = 400;
    error.isSafe = true;
    throw error;
  }
}

function hasTrustedMutationOrigin(request) {
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  if (!host) return false;
  try {
    const protocol = request.headers["x-forwarded-proto"] || "https";
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("ADMIN_SESSION_SECRET must contain at least 32 bytes");
  }
  return secret;
}

function sign(value) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function createSession(viewer) {
  const payload = Buffer.from(
    JSON.stringify({ viewer, expiresAt: Date.now() + sessionTtlMs }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

async function getSession(token) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const suppliedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    return null;
  }

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!decoded?.viewer?.userId || !Number.isFinite(decoded.expiresAt) || decoded.expiresAt <= Date.now()) {
    return null;
  }

  let profiles;
  try {
    profiles = await tableGet("profiles", {
      select: "id,display_name,username,role,status",
      id: `eq.${decoded.viewer.userId}`,
      limit: "1",
    });
  } catch {
    const error = new Error("Could not validate admin session");
    error.status = 502;
    throw error;
  }
  const profile = profiles[0];
  if (!profile || profile.role !== "admin" || profile.status !== "active") return null;
  return {
    viewer: {
      userId: profile.id,
      username: profile.username,
      name: profile.display_name || profile.username,
      role: profile.role,
      status: profile.status,
    },
  };
}

function sessionCookie(token, request) {
  const secure = process.env.VERCEL || request.headers["x-forwarded-proto"] === "https";
  return [
    `admin_session=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(sessionTtlMs / 1000)}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function clearSessionCookie(request) {
  const secure = process.env.VERCEL || request.headers["x-forwarded-proto"] === "https";
  return [
    "admin_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function requesterIdentity(request) {
  const headerName = process.env.VERCEL ? "x-vercel-forwarded-for" : "x-forwarded-for";
  const forwarded = request.headers[headerName];
  if (typeof forwarded === "string") {
    const candidate = forwarded.trim();
    if (!candidate.includes(",") && isIP(candidate)) return candidate;
  }
  const peer = String(request.socket?.remoteAddress || "").trim();
  return isIP(peer) ? peer : "unknown";
}

export default async function handler(request, response) {
  try {
    const url = new URL(request.url, "https://neko-control.invalid");
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/login") {
      const body = await bodyJson(request);
      if (typeof body.username !== "string" || typeof body.password !== "string") {
        return sendError(response, 400, "Username and password are required");
      }
      const viewer = await authenticateAdmin(body.username.trim(), body.password);
      return sendJson(response, 200, { ok: true, viewer }, {
        "Set-Cookie": sessionCookie(createSession(viewer), request),
      });
    }
    if (request.method === "POST" && url.pathname === "/api/logout") {
      return sendJson(response, 200, { ok: true }, {
        "Set-Cookie": clearSessionCookie(request),
      });
    }
    if (request.method === "POST" && url.pathname === "/api/account/recovery/verify") {
      const body = await bodyJson(request);
      return sendJson(response, 200, {
        ok: true,
        ...(await accountRecovery.verifyRecoveryCode({
          username: body.username,
          recoveryCode: body.recovery_code,
          requester: requesterIdentity(request),
        })),
      });
    }
    if (
      request.method === "POST"
      && url.pathname === "/api/account/recovery/change-password"
    ) {
      const authorization = String(request.headers.authorization || "");
      const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{40,200})$/);
      if (!match) return sendError(response, 401, "Recovery session required");
      const body = await bodyJson(request);
      return sendJson(response, 200, {
        ok: true,
        ...(await accountRecovery.changePassword({
          recoverySession: match[1],
          newPassword: body.new_password,
        })),
      });
    }
    if (url.pathname !== "/api/admin") return sendError(response, 404, "Not found");

    const session = await getSession(parseCookies(request).admin_session);
    if (!session) return sendError(response, 401, "Admin login required");
    if (request.method === "GET") {
      const resource = url.searchParams.get("resource") || "overview";
      return sendJson(response, 200, {
        ok: true,
        viewer: session.viewer,
        resource,
        data: await getResource(resource, { range: url.searchParams.get("range") }),
      });
    }
    if (request.method === "POST") {
      if (!hasTrustedMutationOrigin(request)) {
        return sendError(response, 403, "Cross-origin request rejected");
      }
      return sendJson(response, 200, {
        ok: true,
        ...(await performAction(await bodyJson(request), session.viewer)),
      });
    }
    return sendError(response, 405, "Method not allowed");
  } catch (error) {
    const status = error?.status || 500;
    const safeMessage = error?.isSafe
      ? error?.message || "Request failed"
      : status === 401
        ? "Authentication failed"
        : status === 403
          ? "Request forbidden"
          : status < 500
            ? "Invalid request"
            : "Server error";
    if (status >= 500) {
      console.error(error?.isSafe ? safeMessage : error);
    }
    return sendError(response, status, safeMessage);
  }
}
