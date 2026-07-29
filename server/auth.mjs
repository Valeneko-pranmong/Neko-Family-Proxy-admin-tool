import { createClient } from "@supabase/supabase-js";
import { config } from "./config.mjs";
import { authAdminGet, tableGet } from "./supabase.mjs";

function authError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function authenticateAdmin(username, password) {
  const profiles = await tableGet("profiles", {
    select: "id,display_name,username,role,status",
    username: `eq.${username}`,
    limit: "1",
  });
  const profile = profiles[0];
  if (!profile) {
    throw authError("Username หรือรหัสผ่านไม่ถูกต้อง", 401);
  }

  let authUser;
  try {
    authUser = await authAdminGet(`users/${profile.id}`);
  } catch {
    throw authError("Username หรือรหัสผ่านไม่ถูกต้อง", 401);
  }
  if (!authUser?.email) {
    throw authError("บัญชีนี้ยังไม่พร้อมสำหรับการเข้าสู่ระบบด้วยรหัสผ่าน", 401);
  }

  const authClient = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  let result;
  try {
    result = await authClient.auth.signInWithPassword({
      email: authUser.email,
      password,
    });
  } catch {
    throw authError("ไม่สามารถเชื่อมต่อ Supabase Auth ได้", 502);
  }
  if (result.error || !result.data.user || result.data.user.id !== profile.id) {
    throw authError("Username หรือรหัสผ่านไม่ถูกต้อง", 401);
  }
  if (!profile || profile.role !== "admin") {
    throw authError("บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบ", 403);
  }
  if (profile.status !== "active") {
    throw authError("บัญชีผู้ดูแลนี้ถูกระงับการใช้งาน", 403);
  }
  return {
    userId: result.data.user.id,
    username: profile.username,
    name: profile.display_name || profile.username,
    role: profile.role,
    status: profile.status,
  };
}

