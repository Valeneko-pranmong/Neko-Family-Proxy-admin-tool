import {
  rpcPost,
  tableCount,
  tableGet,
  tablePatch,
  tablePost,
} from "../supabase.mjs";

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

async function recordAudit(eventType, actor, metadata = {}) {
  try {
    await tablePost("audit_events", {
      user_id: actor?.userId ?? null,
      event_type: eventType,
      metadata,
    });
  } catch (error) {
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
    username: usernames.get(license.user_id) ?? "—",
    product: productsById.get(license.product_id)?.name ?? "Unknown product",
    product_code: productsById.get(license.product_id)?.code ?? "unknown",
  }));
}

async function getCoupons() {
  const [coupons, batches, products, profiles] = await Promise.all([
    tableGet("coupons", {
      select: "id,batch_id,status,redeemed_by,redeemed_at,created_at",
      order: "created_at.desc",
      limit: "5000",
    }),
    tableGet("coupon_batches", {
      select:
        "id,product_id,duration_days,quantity,expires_at,note,created_at,revoked_at",
      order: "created_at.desc",
      limit: "1000",
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
    const latestRedemption = batchCoupons
      .filter((coupon) => coupon.redeemed_at)
      .sort((a, b) => String(b.redeemed_at).localeCompare(String(a.redeemed_at)))[0];
    return {
      ...batch,
      batch: batch.note || batch.id.slice(0, 8),
      product: productsById.get(batch.product_id)?.name ?? "Unknown product",
      product_code: productsById.get(batch.product_id)?.code ?? "unknown",
      active_count: counts.active,
      redeemed_count: counts.redeemed,
      revoked_count: counts.revoked,
      actual_quantity: batchCoupons.length,
      last_redeemed_by: latestRedemption?.redeemed_by
        ? usernames.get(latestRedemption.redeemed_by) ?? latestRedemption.redeemed_by
        : "—",
      status: batch.revoked_at ? "revoked" : "active",
    };
  });
}

async function getRedemptions() {
  const [attempts, coupons, batches, products, profiles] = await Promise.all([
    tableGet("coupon_redemption_attempts", {
      select: "id,user_id,coupon_id,succeeded,error_code,attempted_at",
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
    const batch = batchesById.get(coupon?.batch_id);
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
  const [installations, profiles] = await Promise.all([
    tableGet("installations", {
      select: "id,user_id,display_name,last_seen_at,revoked_at,created_at",
      order: "last_seen_at.desc",
      limit: "1000",
    }),
    listProfiles(),
  ]);
  const usernames = usernamesByUser(profiles);
  return installations.map((installation) => ({
    ...installation,
    username: usernames.get(installation.user_id) ?? "—",
    status: installation.revoked_at ? "revoked" : "active",
  }));
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

async function getOverview() {
  const [users, products, activeLicenses, activeInstallations, activeSessions, unusedCoupons, audit] =
    await Promise.all([
      tableCount("profiles"),
      tableCount("products", { is_active: "eq.true" }),
      tableCount("licenses", { status: "eq.active" }),
      tableCount("installations", { revoked_at: "is.null" }),
      tableCount("launcher_sessions", { revoked_at: "is.null" }),
      tableCount("coupons", { status: "eq.active" }),
      tableGet("audit_events", {
        select: "id,event_type,metadata,created_at",
        order: "created_at.desc",
        limit: "8",
      }),
    ]);
  return {
    stats: {
      users,
      products,
      activeLicenses,
      activeInstallations,
      activeSessions,
      unusedCoupons,
    },
    trend: [],
    recent: audit.map((event) => ({
      id: String(event.id),
      type: event.event_type,
      title: event.event_type.replaceAll("_", " "),
      detail: JSON.stringify(event.metadata),
      time: event.created_at,
      tone: event.event_type.includes("rejected") ? "red" : "blue",
    })),
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
  return events.map((event) => ({
    ...event,
    username: event.user_id ? usernames.get(event.user_id) ?? event.user_id : "ระบบ",
  }));
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

export async function getResource(resource) {
  if (resource === "users") return getUsers();
  if (resource === "products") return getProducts();
  if (resource === "licenses") return getLicenses();
  if (resource === "coupons") return getCoupons();
  if (resource === "redemptions") return getRedemptions();
  if (resource === "installations") return getInstallations();
  if (resource === "sessions") return getSessions();
  if (resource === "audit") return getAudit();
  return getOverview();
}

export async function performAction(body, actor) {
  const action = String(body.action || "");
  if (action === "set_user_status") {
    const status = String(body.status);
    if (!["active", "suspended", "banned"].includes(status)) throw new Error("Invalid status");
    const userId = String(body.userId);
    if (userId === actor.userId && status !== "active") {
      throw new Error("ไม่สามารถระงับบัญชีผู้ดูแลที่กำลังใช้งานอยู่");
    }
    requireUpdated(
      await tablePatch("profiles", { id: `eq.${userId}` }, { status }),
      "User not found",
    );
    await recordAudit("admin_user_status_changed", actor, {
      target_user_id: userId,
      status,
    });
    return {};
  }
  if (action === "revoke_license") {
    const licenseId = String(body.licenseId);
    requireUpdated(
      await tablePatch("licenses", { id: `eq.${licenseId}` }, { status: "revoked" }),
      "License not found",
    );
    await recordAudit("admin_license_revoked", actor, { license_id: licenseId });
    return {};
  }
  if (action === "extend_license") {
    const licenses = await tableGet("licenses", {
      select: "id,valid_until",
      id: `eq.${String(body.licenseId)}`,
      limit: "1",
    });
    const current = licenses[0];
    if (!current) throw new Error("License not found");
    const days = Number(body.days);
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("Invalid extension");
    const base = Math.max(Date.now(), Date.parse(current.valid_until));
    const validUntil = new Date(base + days * 86400000).toISOString();
    requireUpdated(
      await tablePatch(
        "licenses",
        { id: `eq.${String(body.licenseId)}` },
        { valid_until: validUntil, status: "active" },
      ),
      "License not found",
    );
    await recordAudit("admin_license_extended", actor, {
      license_id: String(body.licenseId),
      days,
      valid_until: validUntil,
    });
    return { valid_until: validUntil };
  }
  if (action === "revoke_session") {
    const sessionId = String(body.sessionId);
    requireUpdated(
      await tablePatch(
        "launcher_sessions",
        { id: `eq.${sessionId}` },
        { revoked_at: new Date().toISOString() },
      ),
      "Session not found",
    );
    await recordAudit("admin_session_revoked", actor, { session_id: sessionId });
    return {};
  }
  if (action === "revoke_installation") {
    const installationId = String(body.installationId);
    const revokedAt = new Date().toISOString();
    requireUpdated(
      await tablePatch(
        "installations",
        { id: `eq.${installationId}` },
        { revoked_at: revokedAt },
      ),
      "Installation not found",
    );
    await tablePatch(
      "launcher_sessions",
      { installation_id: `eq.${installationId}`, revoked_at: "is.null" },
      { revoked_at: revokedAt },
    );
    await recordAudit("admin_session_revoked", actor, {
      installation_id: installationId,
      scope: "installation",
    });
    return {};
  }
  if (action === "revoke_batch") {
    const batchId = String(body.batchId);
    const revoked = await rpcPost("admin_revoke_coupon_batch", {
      p_actor_id: actor.userId,
      p_batch_id: batchId,
    });
    if (revoked !== true) throw new Error("Coupon batch not found");
    return {};
  }
  if (action === "generate_coupons") return generateCoupons(body, actor);
  throw new Error("Unknown admin action");
}
