import { createClient } from "@supabase/supabase-js";
import { config } from "./config.mjs";

const supabaseAdmin = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

function headersFor(schema) {
  const headers = {
    apikey: config.supabaseSecretKey,
    Authorization: `Bearer ${config.supabaseSecretKey}`,
    "Content-Type": "application/json",
  };
  if (schema) {
    headers["Accept-Profile"] = schema;
    headers["Content-Profile"] = schema;
  }
  return headers;
}

async function requestJson(path, options = {}) {
  const { schema, ...init } = options;
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    cache: "no-store",
    ...init,
    headers: { ...headersFor(schema), ...(init.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail =
      body && typeof body === "object" && "message" in body ? body.message : "";
    const error = new Error(
      `Supabase request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
    error.supabaseCode =
      body && typeof body === "object" && typeof body.code === "string" ? body.code : "";
    error.supabaseMessage = typeof detail === "string" ? detail : "";
    throw error;
  }
  return body;
}

function queryString(query) {
  const params = new URLSearchParams(query);
  return params.toString() ? `?${params}` : "";
}

export const tableGet = (table, query = {}) =>
  requestJson(`/rest/v1/${table}${queryString(query)}`);

export async function tableGetAll(table, query = {}, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await tableGet(table, {
      ...query,
      limit: String(pageSize),
      offset: String(offset),
    });
    if (!Array.isArray(page)) throw new Error("Invalid Supabase table response");
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export const tablePost = (table, payload) =>
  requestJson(`/rest/v1/${table}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });

export const tablePatch = (table, query, payload) =>
  requestJson(`/rest/v1/${table}${queryString(query)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });

export const rpcPost = (functionName, payload, schema = "launcher") =>
  requestJson(`/rest/v1/rpc/${functionName}`, {
    method: "POST",
    schema,
    body: JSON.stringify(payload),
  });

export const tableCount = async (table, query = {}) => {
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${table}${queryString({
      select: "id",
      ...query,
    })}`,
    {
      method: "HEAD",
      headers: { ...headersFor(), Prefer: "count=exact" },
    },
  );
  if (!response.ok) throw new Error(`Supabase count failed (${response.status})`);
  const range = response.headers.get("content-range") || "";
  const count = range.split("/")[1];
  return count && count !== "*" ? Number(count) : 0;
};

export const authAdminGet = (path, query = {}) =>
  requestJson(`/auth/v1/admin/${path}${queryString(query)}`);

export async function updateAuthUserPassword(userId, password) {
  let result;
  try {
    result = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
  } catch {
    throw new Error("ไม่สามารถเชื่อมต่อ Supabase Auth ได้");
  }
  if (result.error || !result.data?.user || result.data.user.id !== userId) {
    throw new Error("Supabase Auth ปฏิเสธการเปลี่ยนรหัสผ่าน");
  }
}
