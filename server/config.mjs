import process from "node:process";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing Vercel environment variable: ${name}`);
  return value;
};

export const config = {
  supabaseUrl: required("SUPABASE_URL").replace(/\/$/, ""),
  supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
  accountRecoveryHmacSecret: required("ACCOUNT_RECOVERY_HMAC_SECRET"),
};
