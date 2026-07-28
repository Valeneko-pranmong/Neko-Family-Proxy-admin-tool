const PREFIX = "neko-control:coupon-codes:";

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveCouponCodes(batchId, codes) {
  if (!batchId || !Array.isArray(codes) || codes.length === 0) return false;
  try {
    storage()?.setItem(
      `${PREFIX}${batchId}`,
      JSON.stringify({ codes: codes.map(String), savedAt: new Date().toISOString() }),
    );
    return true;
  } catch {
    return false;
  }
}

export function getCouponCodes(batchId) {
  try {
    const value = storage()?.getItem(`${PREFIX}${batchId}`);
    const parsed = value ? JSON.parse(value) : null;
    return Array.isArray(parsed?.codes) ? parsed.codes.map(String) : [];
  } catch {
    return [];
  }
}

export function hasCouponCodes(batchId) {
  return getCouponCodes(batchId).length > 0;
}

export function deleteCouponCodes(batchId) {
  try {
    storage()?.removeItem(`${PREFIX}${batchId}`);
  } catch {
    // The database operation still succeeds when browser storage is unavailable.
  }
}
