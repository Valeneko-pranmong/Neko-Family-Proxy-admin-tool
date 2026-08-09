import process from "node:process";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing Vercel environment variable: ${name}`);
  return value;
};

const strongSecret = (name) => {
  const value = required(name);
  if (Buffer.byteLength(value, "utf8") < 32) {
    throw new Error(`${name} must contain at least 32 bytes`);
  }
  return value;
};

export const config = {
  supabaseUrl: required("SUPABASE_URL").replace(/\/$/, ""),
  supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
  accountRecoveryHmacSecret: strongSecret("ACCOUNT_RECOVERY_HMAC_SECRET"),
};
