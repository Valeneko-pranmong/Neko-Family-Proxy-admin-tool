import {
  rpcPost,
  tableCount,
  tableGet,
  tableGetAll,
  tablePost,
} from "./supabase.mjs";
import { accountRecovery } from "./account-recovery.mjs";
import {
  aggregateTrend,
  classifyLicense,
  countRecentlyOnlineSessions,
  formatAuditEvent,
  isCouponBatchUsable,
  normalizeTrendRange,
  RECENT_ONLINE_WINDOW_MS,
  REPORT_TIMEZONE,
  trendStart,
} from "./dashboard.mjs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function actionError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.isSafe = true;
  return error;
}

async function listProfiles() {
  return tableGet("profiles", {
    select: "id,username",
    limit: "1000",
  });
}

function usernamesByUser(profiles) {
  return new Map(profiles.map((profile) => [profile.id, profile.username ?? ""]));
}

function requireUpdated(rows, message) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(message);
  return rows;
}

function requireRpcBoolean(value, notFoundMessage) {
  if (value === false) throw actionError(notFoundMessage, 404);
  if (value !== true) throw actionError("Backend ตอบกลับไม่ถูกต้อง", 502);
}

async function rpcPostWithNotFound(functionName, payload, backendMessage, safeMessage) {
  try {
    return await rpcPost(functionName, payload);
  } catch (error) {
    if (error?.supabaseCode === "P0001" && error?.supabaseMessage === backendMessage) {
      throw actionError(safeMessage, 404);
    }
    throw error;
  }
}

async function recordAudit(eventType, actor, metadata = {}, { required = false } = {}) {
  try {
    await tablePost("audit_events", {
      user_id: actor?.userId ?? null,
      event_type: eventType,
      metadata,
    });
  } catch (error) {
    if (required) {
      console.error(`Could not record ${eventType} audit event`);
      throw error;
    }
    console.error(`Could not record ${eventType} audit event`, error);
  }
}


async function getUsers() {
  return tableGet("profiles", {
    select: "id,display_name,username,role,status,created_at,updated_at",
    order: "created_at.desc",
    limit: "1000",
  });
}

async function getProducts() {
  return tableGet("products", {
    select: "id,code,name,max_devices,is_active,created_at",
    order: "name.asc",
    limit: "200",
  });
}

async function getLicenses() {
  const now = new Date();
  const [licenses, products, profiles] = await Promise.all([
    tableGet("licenses", {
      select:
        "id,user_id,product_id,status,valid_from,valid_until,max_devices,created_at",
      order: "valid_until.desc",
      limit: "1000",
    }),
    tableGet("products", { select: "id,code,name", order: "name.asc" }),
    listProfiles(),
  ]);
  const productsById = new Map(products.map((product) => [product.id, product]));
  const usernames = usernamesByUser(profiles);
  return licenses.map((license) => ({
    ...license,
    effective_status: classifyLicense(license, now),
    username: usernames.get(license.user_id) ?? "—",
    product: productsById.get(license.product_id)?.name ?? "Unknown product",
    product_code: productsById.get(license.product_id)?.code ?? "unknown",
  }));
}

async function getCoupons() {
  const [coupons, batches, products, profiles] = await Promise.all([
    tableGetAll("coupons", {
      select: "id,batch_id,status,redeemed_by,redeemed_at,created_at",
      order: "created_at.desc,id.desc",
    }),
    tableGetAll("coupon_batches", {
      select:
        "id,product_id,duration_days,quantity,expires_at,note,created_at,revoked_at",
      order: "created_at.desc,id.desc",
    }),
    tableGet("products", { select: "id,name,code" }),
    listProfiles(),
  ]);
  const productsById = new Map(products.map((product) => [product.id, product]));
  const usernames = usernamesByUser(profiles);
  const couponsByBatch = new Map();
  for (const coupon of coupons) {
    const batchCoupons = couponsByBatch.get(coupon.batch_id) ?? [];
    batchCoupons.push(coupon);
    couponsByBatch.set(coupon.batch_id, batchCoupons);
  }
  return batches.map((batch) => {
    const batchCoupons = couponsByBatch.get(batch.id) ?? [];
    const counts = { active: 0, redeemed: 0, revoked: 0 };
    for (const coupon of batchCoupons) {
      if (coupon.status in counts) counts[coupon.status] += 1;
    }
    const redeemedCount = Math.max(
      counts.redeemed,
      Number(batch.quantity) - batchCoupons.length,
    );
    const latestRedemption = batchCoupons
      .filter((coupon) => coupon.redeemed_at)
      .sort((a, b) => String(b.redeemed_at).localeCompare(String(a.redeemed_at)))[0];
    const batchUsable = isCouponBatchUsable(batch);
    return {
      ...batch,
      batch: batch.note || batch.id.slice(0, 8),
      product: productsById.get(batch.product_id)?.name ?? "Unknown product",
      product_code: productsById.get(batch.product_id)?.code ?? "unknown",
      active_count: batchUsable ? counts.active : 0,
      redeemed_count: redeemedCount,
      revoked_count: counts.revoked,
      actual_quantity: Number(batch.quantity),
      last_redeemed_by: latestRedemption?.redeemed_by
        ? usernames.get(latestRedemption.redeemed_by) ?? latestRedemption.redeemed_by
        : "—",
      status: batch.revoked_at ? "revoked" : batchUsable ? "active" : "expired",
    };
  });
}

async function getRedemptions() {
  const [attempts, coupons, batches, products, profiles] = await Promise.all([
    tableGet("coupon_redemption_attempts", {
      select: "id,user_id,coupon_id,batch_id,succeeded,error_code,attempted_at",
      order: "attempted_at.desc",
      limit: "1000",
    }),
    tableGet("coupons", { select: "id,batch_id", limit: "5000" }),
    tableGet("coupon_batches", { select: "id,product_id,note", limit: "1000" }),
    tableGet("products", { select: "id,name,code", limit: "200" }),
    listProfiles(),
  ]);
  const usernames = usernamesByUser(profiles);
  const couponsById = new Map(coupons.map((coupon) => [coupon.id, coupon]));
  const batchesById = new Map(batches.map((batch) => [batch.id, batch]));
  const productsById = new Map(products.map((product) => [product.id, product]));
  return attempts.map((attempt) => {
    const coupon = couponsById.get(attempt.coupon_id);
    const batch = batchesById.get(attempt.batch_id ?? coupon?.batch_id);
    const product = productsById.get(batch?.product_id);
    return {
      ...attempt,
      username: usernames.get(attempt.user_id) ?? "—",
      batch: batch?.note || batch?.id?.slice(0, 8) || "—",
      product: product?.name ?? "—",
    };
  });
}

async function getInstallations() {
  const [installations, profiles, activeSessions] = await Promise.all([
    tableGetAll("installations", {
      select:
        "id,user_id,installation_key_hash,display_name,last_seen_at,created_at",
      order: "last_seen_at.desc",
    }),
    listProfiles(),
    tableGetAll("launcher_sessions", {
      select: "id,installation_id,created_at,last_seen_at",
      revoked_at: "is.null",
    }),
  ]);
  const usernames = usernamesByUser(profiles);
  const activeSessionsByInstallation = new Map(
    activeSessions.map((session) => [session.installation_id, session]),
  );
  return installations.map((installation) => {
    const activeSession = activeSessionsByInstallation.get(installation.id);
    const installationHash =
      typeof installation.installation_key_hash === "string"
        ? installation.installation_key_hash
        : "";
    const installationHashMasked = installationHash.length >= 8
      ? `${installationHash.slice(0, 4)}…${installationHash.slice(-4)}`
      : "—";
    const {
      installation_key_hash: _installationKeyHash,
      revoked_at: _legacyRevokedAt,
      ...safeInstallation
    } = installation;
    return {
      ...safeInstallation,
      installation_key_hash_masked: installationHashMasked,
      username: usernames.get(installation.user_id) ?? "—",
      status: "remembered",
      owns_active_session: Boolean(activeSession),
      active_session_id: activeSession?.id ?? null,
      active_session_created_at: activeSession?.created_at ?? null,
      active_session_last_seen_at: activeSession?.last_seen_at ?? null,
    };
  });
}

async function getSessions() {
  const [sessions, profiles, installations] = await Promise.all([
    tableGet("launcher_sessions", {
      select:
        "id,user_id,installation_id,license_id,created_at,last_seen_at,revoked_at",
      order: "last_seen_at.desc",
      limit: "1000",
    }),
    listProfiles(),
    tableGet("installations", {
      select: "id,display_name",
      limit: "1000",
    }),
  ]);
  const usernames = usernamesByUser(profiles);
  const devices = new Map(
    installations.map((installation) => [
      installation.id,
      installation.display_name ?? "Unnamed device",
    ]),
  );
  return sessions.map((session) => ({
    ...session,
    username: usernames.get(session.user_id) ?? "—",
    device: devices.get(session.installation_id) ?? "Unknown device",
  }));
}

async function getOverview(requestedRange = "14d") {
  const range = normalizeTrendRange(requestedRange);
  const now = new Date();
  const generatedAt = now.toISOString();
  const trendFrom = trendStart(range, now).toISOString();
  const recentFrom = new Date(now.getTime() - RECENT_ONLINE_WINDOW_MS).toISOString();
  const expiringAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const [
    users,
    activeUsers,
    suspendedUsers,
    bannedUsers,
    activeLicenses,
    expiringLicenses,
    expiredLicenses,
    revokedLicenses,
    installations,
    activeSessions,
    recentSessions,
    recentlyOnlineLicenses,
    activeCoupons,
    couponBatches,
    trendSessions,
    trendRedemptions,
    audit,
  ] = await Promise.all([
    tableCount("profiles"),
    tableCount("profiles", { status: "eq.active" }),
    tableCount("profiles", { status: "eq.suspended" }),
    tableCount("profiles", { status: "eq.banned" }),
    tableCount("licenses", {
      status: "eq.active",
      valid_from: `lte.${generatedAt}`,
      valid_until: `gt.${generatedAt}`,
    }),
    tableCount("licenses", {
      status: "eq.active",
      valid_from: `lte.${generatedAt}`,
      valid_until: `gt.${generatedAt}`,
      and: `(valid_until.lte.${expiringAt})`,
    }),
    tableCount("licenses", {
      status: "eq.active",
      valid_until: `lte.${generatedAt}`,
    }),
    tableCount("licenses", { status: "eq.revoked" }),
    tableCount("installations"),
    tableCount("launcher_sessions", { revoked_at: "is.null" }),
    tableGetAll("launcher_sessions", {
      select: "id,license_id,last_seen_at,revoked_at",
      revoked_at: "is.null",
      last_seen_at: `gte.${recentFrom}`,
      and: `(last_seen_at.lte.${generatedAt})`,
      order: "last_seen_at.asc,id.asc",
    }),
    tableGetAll("licenses", {
      select: "id,status,valid_from,valid_until",
      status: "eq.active",
      valid_from: `lte.${generatedAt}`,
      valid_until: `gt.${generatedAt}`,
      order: "id.asc",
    }),
    tableGetAll("coupons", {
      select: "id,batch_id",
      status: "eq.active",
      redeemed_at: "is.null",
      order: "id.asc",
    }),
    tableGetAll("coupon_batches", {
      select: "id,revoked_at,expires_at",
      revoked_at: "is.null",
      or: `(expires_at.is.null,expires_at.gt.${generatedAt})`,
      order: "id.asc",
    }),
    tableGetAll("launcher_sessions", {
      select: "id,created_at",
      created_at: `gte.${trendFrom}`,
      order: "created_at.asc,id.asc",
    }),
    tableGetAll("coupon_redemption_attempts", {
      select: "id,attempted_at",
      succeeded: "eq.true",
      attempted_at: `gte.${trendFrom}`,
      order: "attempted_at.asc,id.asc",
    }),
    tableGet("audit_events", {
      select: "id,event_type,metadata,created_at",
      order: "created_at.desc",
      limit: "8",
    }),
  ]);
  const usableBatchIds = new Set(
    couponBatches
      .filter((batch) => isCouponBatchUsable(batch, now))
      .map((batch) => batch.id),
  );
  const usableCoupons = activeCoupons.reduce(
    (count, coupon) => count + (usableBatchIds.has(coupon.batch_id) ? 1 : 0),
    0,
  );
  return {
    stats: {
      users,
      userBreakdown: { active: activeUsers, suspended: suspendedUsers, banned: bannedUsers },
      activeLicenses,
      licenseBreakdown: {
        expiringSoon: expiringLicenses,
        expired: expiredLicenses,
        revoked: revokedLicenses,
      },
      installations,
      activeSessions,
      recentlyOnline: countRecentlyOnlineSessions(recentSessions, recentlyOnlineLicenses, now),
      usableCoupons,
    },
    trend: aggregateTrend({
      range,
      now,
      sessions: trendSessions,
      redemptions: trendRedemptions,
      users: [],
    }),
    recent: audit.map(formatAuditEvent),
    generatedAt,
    timezone: REPORT_TIMEZONE,
    range,
    recentlyOnlineThresholdSeconds: RECENT_ONLINE_WINDOW_MS / 1000,
  };
}

async function getAudit() {
  const [events, profiles] = await Promise.all([
    tableGet("audit_events", {
      select: "id,user_id,event_type,metadata,created_at",
      order: "created_at.desc",
      limit: "1000",
    }),
    listProfiles(),
  ]);
  const usernames = usernamesByUser(profiles);
  return events.map((event) => {
    const formatted = formatAuditEvent(event);
    return {
      ...formatted,
      username: event.user_id ? usernames.get(event.user_id) ?? event.user_id : "ระบบ",
    };
  });
}

async function generateCoupons(body, actor) {
  const productCode = String(body.productCode || "").toLowerCase();
  const durationDays = Number(body.durationDays);
  const quantity = Number(body.quantity);
  if (!/^[a-z0-9-]{3,64}$/.test(productCode)) throw new Error("Invalid product");
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
    throw new Error("Invalid duration");
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
    throw new Error("Invalid quantity");
  }
  const rows = await rpcPost("admin_generate_coupon_batch", {
    p_actor_id: actor.userId,
    p_product_code: productCode,
    p_duration_days: durationDays,
    p_quantity: quantity,
    p_expires_at: body.expiresAt ? String(body.expiresAt) : null,
    p_note: body.note ? String(body.note).slice(0, 500) : null,
  });
  if (!Array.isArray(rows) || rows.length !== quantity) {
    throw new Error("Could not create coupon batch");
  }
  return {
    batch: { id: rows[0].batch_id },
    codes: rows.map((row) => row.code),
  };
}

export async function getResource(resource, options = {}) {
  if (resource === "users") return getUsers();
  if (resource === "products") return getProducts();
  if (resource === "licenses") return getLicenses();
  if (resource === "coupons") return getCoupons();
  if (resource === "redemptions") return getRedemptions();
  if (resource === "installations") return getInstallations();
  if (resource === "sessions") return getSessions();
  if (resource === "audit") return getAudit();
  if (resource === "overview") return getOverview(options.range);
  throw actionError("ไม่พบข้อมูลที่ร้องขอ", 404);
}

export async function performAction(body, actor) {
  const action = String(body.action || "");
  if (action === "generate_recovery_code") {
    return accountRecovery.generateRecoveryCode({
      actor,
      userId: body.userId,
      confirmUsername: body.confirmUsername,
    });
  }
  if (action === "set_user_status") {
    const status = String(body.status);
    if (!["active", "suspended", "banned"].includes(status)) {
      throw actionError("สถานะสมาชิกไม่ถูกต้อง");
    }
    const userId = String(body.userId);
    if (!UUID_PATTERN.test(userId)) throw actionError("รหัสผู้ใช้ไม่ถูกต้อง");
    if (userId === actor.userId && status !== "active") {
      throw actionError("ไม่สามารถระงับบัญชีผู้ดูแลที่กำลังใช้งานอยู่", 403);
    }
    const updated = await rpcPostWithNotFound("admin_set_user_status", {
      p_actor_id: actor.userId,
      p_user_id: userId,
      p_status: status,
    }, "user_not_found", "ไม่พบบัญชีสมาชิก");
    requireRpcBoolean(updated, "ไม่พบบัญชีสมาชิก");
    return {};
  }
  if (action === "revoke_license") {
    const licenseId = String(body.licenseId);
    if (!UUID_PATTERN.test(licenseId)) throw actionError("รหัส License ไม่ถูกต้อง");
    const revoked = await rpcPostWithNotFound("admin_revoke_license", {
      p_actor_id: actor.userId,
      p_license_id: licenseId,
    }, "license_not_found", "ไม่พบ License");
    requireRpcBoolean(revoked, "ไม่พบ License");
    return {};
  }
  if (action === "extend_license") {
    const licenseId = String(body.licenseId);
    if (!UUID_PATTERN.test(licenseId)) throw actionError("รหัส License ไม่ถูกต้อง");
    const days = Number(body.days);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw actionError("จำนวนวันต่ออายุไม่ถูกต้อง");
    }
    const validUntil = await rpcPostWithNotFound("admin_extend_license", {
      p_actor_id: actor.userId,
      p_license_id: licenseId,
      p_days: days,
    }, "license_not_found", "ไม่พบ License");
    if (validUntil === false) throw actionError("ไม่พบ License", 404);
    if (
      typeof validUntil !== "string"
      || !TIMESTAMPTZ_PATTERN.test(validUntil)
      || Number.isNaN(Date.parse(validUntil))
    ) {
      throw actionError("Backend ตอบวันหมดอายุไม่ถูกต้อง", 502);
    }
    return { valid_until: validUntil };
  }
  if (action === "revoke_session") {
    const sessionId = String(body.sessionId);
    if (!UUID_PATTERN.test(sessionId)) throw actionError("รหัส session ไม่ถูกต้อง");
    const revoked = await rpcPostWithNotFound("admin_revoke_session", {
      p_actor_id: actor.userId,
      p_session_id: sessionId,
    }, "session_not_found", "ไม่พบ session");
    requireRpcBoolean(revoked, "ไม่พบ session");
    return {};
  }

  if (action === "revoke_batch") {
    const batchId = String(body.batchId);
    if (!UUID_PATTERN.test(batchId)) throw actionError("รหัสชุดคูปองไม่ถูกต้อง");
    const revoked = await rpcPost("admin_revoke_coupon_batch", {
      p_actor_id: actor.userId,
      p_batch_id: batchId,
    });
    requireRpcBoolean(revoked, "ไม่พบชุดคูปอง");
    return {};
  }
  if (action === "delete_batch") {
    const batchId = String(body.batchId);
    if (!UUID_PATTERN.test(batchId)) throw actionError("รหัสชุดคูปองไม่ถูกต้อง");
    const deleted = await rpcPost("admin_delete_coupon_batch", {
      p_actor_id: actor.userId,
      p_batch_id: batchId,
    });
    requireRpcBoolean(deleted, "ไม่พบชุดคูปอง");
    return {};
  }
  if (action === "generate_coupons") return generateCoupons(body, actor);
  throw actionError("คำสั่งผู้ดูแลไม่ถูกต้อง");
}
