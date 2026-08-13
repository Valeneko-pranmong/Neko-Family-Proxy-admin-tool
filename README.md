# Neko Control Room

เครื่องมือผู้ดูแล Neko Family Proxy สำหรับใช้งานบน Vercel หน้าเว็บและ API ใช้ origin เดียวกัน โดยเก็บ Supabase Secret Key ไว้ใน Vercel Environment Variables และไม่ส่ง key ไปยังเบราว์เซอร์

## โครงสร้าง

- `standalone/src/` — source ของหน้าเว็บ
- `standalone/dist/neko-control.html` — generated single HTML
- `api/index.mjs` — Vercel Node.js Function, Admin session และ Account Recovery endpoints
- `server/` — Supabase, authentication และ trusted server operations
- `docs/LAUNCHER_ACCOUNT_RECOVERY_CONTRACT.md` — contract ที่ Launcher ต้องใช้
- `docs/archive/` — เอกสาร/แผน superseded สำหรับอ้างอิงเท่านั้น ห้ามใช้เป็น current contract หรือ release gate
- `tests/*.test.mjs` — API, RBAC, recovery และ UI regression

## Environment Variables บน Vercel

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-server-secret
ADMIN_SESSION_SECRET=random-secret-at-least-32-bytes
ACCOUNT_RECOVERY_HMAC_SECRET=independent-random-secret-at-least-32-bytes
```

`ACCOUNT_RECOVERY_HMAC_SECRET` ต้องสุ่มแยกจาก secret อื่น ใช้สร้าง HMAC verifier ของ Recovery Code, Recovery Session และ password fingerprint ฝั่ง server เท่านั้น ห้ามเปลี่ยนระหว่างที่มี recovery operation ค้างอยู่

กำหนด `ADMIN_SESSION_TTL_MS` เพิ่มได้ตั้งแต่ 5 นาทีถึง 24 ชั่วโมง ค่าเริ่มต้นคือ 8 ชั่วโมง

ห้ามใส่ secret ใน source, HTML, `PUBLIC_*`, `NEXT_PUBLIC_*`, logs หรือ audit

## Build และทดสอบ

```powershell
npm install
npm run build
npm test
```

Vercel ใช้ `vercel.json` เพื่อ build `standalone/dist` และ route `/api/*` ไปยัง `api/index.mjs`

## Account Recovery

หน้า **สมาชิก** แสดง **สร้าง Recovery Code** เฉพาะบัญชี customer Admin ต้องตรวจตัวตนลูกค้าตามนโยบายและพิมพ์ Username ยืนยัน ระบบจะ:

1. ยกเลิก Recovery Code เก่าของบัญชี
2. สร้าง code แบบสุ่มที่มีอายุ 5 นาทีและใช้ได้ครั้งเดียว
3. เก็บเฉพาะ HMAC verifier ใน PostgreSQL
4. แสดง plaintext code ใน response/dialog ครั้งปัจจุบันเท่านั้น

Recovery Code ไม่ใช่ Supabase password Admin ไม่ตั้งหรือเห็น password ใหม่ ลูกค้านำ Username + code ไปยืนยันใน Launcher เพื่อรับ restricted Recovery Session แล้วตั้ง password เอง หลังสำเร็จระบบยกเลิก Launcher sessions เดิมทั้งหมด

ดู endpoint, error semantics, password policy และ retry behavior ที่ `docs/LAUNCHER_ACCOUNT_RECOVERY_CONTRACT.md`

ก่อนเปิดใช้ Recovery Web API ต้องยืนยันว่า Backend apply migration chain `20260809120000_account_recovery_codes.sql`, `20260809124500_fix_recovery_verify_column_ambiguity.sql` และ `20260810040000_revoke_superseded_recovery_sessions.sql` แล้ว ห้ามแก้ migration เก่าที่ production apply แล้ว
