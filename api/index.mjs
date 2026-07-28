import { createHmac, timingSafeEqual } from "node:crypto";
import { authenticateAdmin } from "../admin-api/src/auth.mjs";
import { getResource, performAction } from "../admin-api/src/routes/admin.mjs";
import { tableGet } from "../admin-api/src/supabase.mjs";

const sessionTtlMs = Number(process.env.ADMIN_SESSION_TTL_MS || 8 * 60 * 60 * 1000);

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
    if (text.length > 1024 * 1024) throw new Error("Request too large");
  }
  return text ? JSON.parse(text) : {};
}

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim();
  if (!secret) throw new Error("Missing ADMIN_SESSION_SECRET");
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

  const profiles = await tableGet("profiles", {
    select: "id,display_name,username,role,status",
    id: `eq.${decoded.viewer.userId}`,
    limit: "1",
  });
  const profile = profiles[0];
  if (!profile || profile.role !== "admin" || profile.status !== "active") return null;
  return {
    viewer: {
      userId: profile.id,
      email: decoded.viewer.email,
      name: profile.display_name || profile.username || decoded.viewer.email,
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

export default async function handler(request, response) {
  try {
    const url = new URL(request.url, "https://neko-control.invalid");
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/login") {
      const body = await bodyJson(request);
      if (typeof body.email !== "string" || typeof body.password !== "string") {
        return sendError(response, 400, "Email and password are required");
      }
      const viewer = await authenticateAdmin(body.email.trim(), body.password);
      return sendJson(response, 200, { ok: true, viewer }, {
        "Set-Cookie": sessionCookie(createSession(viewer), request),
      });
    }
    if (request.method === "POST" && url.pathname === "/api/logout") {
      return sendJson(response, 200, { ok: true }, {
        "Set-Cookie": clearSessionCookie(request),
      });
    }
    if (url.pathname !== "/api/admin") return sendError(response, 404, "Not found");

    const session = await getSession(parseCookies(request).admin_session);
    if (!session) return sendError(response, 401, "Admin login required");
    if (request.method === "GET") {
      const resource = url.searchParams.get("resource") || "overview";
      return sendJson(response, 200, { ok: true, resource, data: await getResource(resource) });
    }
    if (request.method === "POST") {
      return sendJson(response, 200, {
        ok: true,
        ...(await performAction(await bodyJson(request), session.viewer)),
      });
    }
    return sendError(response, 405, "Method not allowed");
  } catch (error) {
    console.error(error);
    return sendError(response, error.status || 500, error.message || "Server error");
  }
}
