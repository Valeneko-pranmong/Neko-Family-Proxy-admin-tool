export const REPORT_TIMEZONE = "Asia/Bangkok";
export const RECENT_ONLINE_WINDOW_MS = 2 * 60 * 1000;

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const RANGE_CONFIG = Object.freeze({
  "24h": { units: 24, unitMs: 60 * 60 * 1000, precision: "hour" },
  "7d": { units: 7, unitMs: 24 * 60 * 60 * 1000, precision: "day" },
  "14d": { units: 14, unitMs: 24 * 60 * 60 * 1000, precision: "day" },
  "30d": { units: 30, unitMs: 24 * 60 * 60 * 1000, precision: "day" },
});

export function normalizeTrendRange(value) {
  return Object.hasOwn(RANGE_CONFIG, value) ? value : "14d";
}

export function classifyLicense(license, now = new Date()) {
  const nowMs = now.getTime();
  const validFromMs = Date.parse(license?.valid_from);
  const validUntilMs = Date.parse(license?.valid_until);
  if (license?.status === "revoked") return "revoked";
  if (license?.status !== "active") return license?.status || "inactive";
  if (!Number.isFinite(validFromMs) || !Number.isFinite(validUntilMs)) return "invalid";
  if (validFromMs > nowMs) return "scheduled";
  if (validUntilMs <= nowMs) return "expired";
  if (validUntilMs - nowMs <= 7 * 24 * 60 * 60 * 1000) return "expiring";
  return "active";
}

export function isCouponBatchUsable(batch, now = new Date()) {
  if (batch?.revoked_at) return false;
  if (!batch?.expires_at) return true;
  const expiresAt = Date.parse(batch.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

function hasFreshHeartbeat(session, now) {
  if (session?.revoked_at) return false;
  const lastSeenAt = Date.parse(session?.last_seen_at);
  const recentCutoff = now.getTime() - RECENT_ONLINE_WINDOW_MS;
  return Number.isFinite(lastSeenAt) && lastSeenAt >= recentCutoff && lastSeenAt <= now.getTime();
}

export function summarizeCurrentSessions(sessions, now = new Date()) {
  let current = 0;
  let recentlyOnline = 0;
  for (const session of sessions || []) {
    if (session?.revoked_at) continue;
    current += 1;
    if (hasFreshHeartbeat(session, now)) recentlyOnline += 1;
  }
  return { current, recentlyOnline };
}

export function countRecentlyOnlineSessions(sessions, licenses, now = new Date()) {
  const effectiveLicenseIds = new Set(
    (licenses || [])
      .filter((license) => ["active", "expiring"].includes(classifyLicense(license, now)))
      .map((license) => license.id),
  );
  return (sessions || []).reduce(
    (count, session) => count + (
      hasFreshHeartbeat(session, now) && effectiveLicenseIds.has(session?.license_id) ? 1 : 0
    ),
    0,
  );
}

function floorBangkokBucket(timestamp, precision) {
  const shifted = new Date(timestamp.getTime() + BANGKOK_OFFSET_MS);
  const bucketShifted = precision === "hour"
    ? Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate(),
        shifted.getUTCHours(),
      )
    : Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate(),
      );
  return new Date(bucketShifted - BANGKOK_OFFSET_MS);
}

export function trendStart(range, now = new Date()) {
  const normalized = normalizeTrendRange(range);
  const config = RANGE_CONFIG[normalized];
  const currentBucket = floorBangkokBucket(now, config.precision);
  return new Date(currentBucket.getTime() - (config.units - 1) * config.unitMs);
}

export function aggregateTrend({ range, now = new Date(), sessions, redemptions, users }) {
  const normalized = normalizeTrendRange(range);
  const config = RANGE_CONFIG[normalized];
  const start = trendStart(normalized, now);
  const values = new Map();
  const add = (rows, field, timestampField) => {
    for (const row of rows || []) {
      const timestamp = new Date(row?.[timestampField]);
      if (Number.isNaN(timestamp.getTime()) || timestamp < start || timestamp > now) continue;
      const bucket = floorBangkokBucket(timestamp, config.precision).toISOString();
      const value = values.get(bucket) || { bucket, sessions: 0, redemptions: 0, newUsers: 0 };
      value[field] += 1;
      values.set(bucket, value);
    }
  };
  add(sessions, "sessions", "created_at");
  add(redemptions, "redemptions", "attempted_at");
  add(users, "newUsers", "created_at");
  if (values.size === 0) return [];
  return Array.from({ length: config.units }, (_, index) => {
    const bucket = new Date(start.getTime() + index * config.unitMs).toISOString();
    return values.get(bucket) || { bucket, sessions: 0, redemptions: 0, newUsers: 0 };
  });
}

const EVENT_TITLES = Object.freeze({
  revoke_session: "ยุติ Launcher session",
  admin_revoke_session: "ยุติ Launcher session",
  admin_session_revoked: "ยุติ Launcher session",
  admin_set_user_status: "เปลี่ยนสถานะสมาชิก",
  admin_user_status_changed: "เปลี่ยนสถานะสมาชิก",
  set_user_status: "เปลี่ยนสถานะสมาชิก",
  coupon_redeemed: "ใช้คูปองสำเร็จ",
  admin_revoke_license: "ยกเลิก License",
  admin_license_revoked: "ยกเลิก License",
  admin_license_extended: "ต่ออายุ License",
  revoke_license: "ยกเลิก License",
  admin_revoke_coupon_batch: "ยกเลิกชุดคูปอง",
  account_password_recovered: "เปลี่ยนรหัสผ่านผ่าน Recovery",
  login_rejected: "ปฏิเสธการเข้าสู่ระบบ",
});
const SAFE_METADATA_FIELDS = [
  "username",
  "target_username",
  "product_code",
  "status",
  "reason",
  "error_code",
  "device_name",
  "target_user_id",
  "previous_status",
  "new_status",
  "license_id",
  "session_id",
  "days_added",
];

export function formatAuditEvent(event) {
  const type = String(event?.event_type || "system_event");
  const metadata = event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
  const details = SAFE_METADATA_FIELDS
    .filter((field) => metadata[field] !== null && metadata[field] !== undefined && metadata[field] !== "")
    .map((field) => `${field.replaceAll("_", " ")}: ${String(metadata[field]).slice(0, 120)}`);
  return {
    id: String(event?.id ?? ""),
    type,
    title: EVENT_TITLES[type] || type.replaceAll("_", " "),
    detail: details.join(" · ") || "ไม่มีรายละเอียดเพิ่มเติม",
    time: event?.created_at ?? null,
    tone: /rejected|revoked|failed|banned/.test(type) ? "red" : /success|redeemed|active/.test(type) ? "green" : "blue",
  };
}
