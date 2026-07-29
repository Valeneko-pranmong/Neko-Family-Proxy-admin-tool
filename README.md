# Neko Control Room

เครื่องมือผู้ดูแล Neko Family Proxy สำหรับใช้งานบน Vercel เท่านั้น
หน้าเว็บและ API ใช้ origin เดียวกัน โดยเก็บ Supabase Secret Key ไว้ใน Vercel
Environment Variables และไม่ส่ง key ไปยังเบราว์เซอร์

## โครงสร้าง

- `standalone/src/` — source ของหน้าเว็บ
- `standalone/dist/neko-control.html` — single HTML ที่ Vercel ให้บริการ
- `api/index.mjs` — Vercel Node.js Function และ signed admin session
- `server/` — Supabase, authentication และคำสั่งผู้ดูแลฝั่ง server
- `scripts/build-standalone.mjs` — build หน้าเว็บ
- `scripts/e2e-password-reset.mjs` — E2E สำหรับ disposable Supabase user
- `tests/vercel-api.test.mjs` — API, RBAC, password reset และ UI regression

โปรเจกต์ไม่มี Local Admin API, PowerShell launcher หรือ local in-memory session แล้ว

## Environment Variables บน Vercel

กำหนดอย่างน้อย:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-server-secret
ADMIN_SESSION_SECRET=random-secret-at-least-32-bytes
```

กำหนด `ADMIN_SESSION_TTL_MS` เพิ่มได้ตั้งแต่ 5 นาทีถึง 24 ชั่วโมง
ค่าเริ่มต้นคือ 8 ชั่วโมง

ห้ามใส่ `SUPABASE_SECRET_KEY` หรือ `ADMIN_SESSION_SECRET` ใน source, HTML,
ตัวแปรที่ขึ้นต้นด้วย `PUBLIC_` หรือ `NEXT_PUBLIC_`

## Build และทดสอบ

```powershell
npm install
npm run build
npm test
```

Vercel ใช้ `vercel.json` เพื่อ build `standalone/dist` และ route `/api/*`
ไปยัง Node.js Function ที่ `api/index.mjs`

## การตั้งรหัสผ่านใหม่ให้ลูกค้า

หน้า **สมาชิก** แสดงปุ่ม **ตั้งรหัสผ่านใหม่** เฉพาะ `role = customer`
ผู้ดูแลต้องพิมพ์ Username ให้ตรงก่อนยืนยัน ระบบจะตรวจ admin session อีกครั้ง,
ยกเลิก Launcher session เดิม, สุ่มรหัสผ่านชั่วคราว, เปลี่ยน Supabase Auth
password และบันทึก `admin_password_reset`

รหัสผ่านชั่วคราวแสดงเพียงครั้งเดียวและไม่ถูกเก็บในฐานข้อมูล, Audit, log,
URL, `localStorage` หรือ `sessionStorage`

ก่อนเปิดใช้จริง repository ฐานข้อมูลหลักต้องอนุญาต `admin_password_reset`
ใน constraint `audit_events_event_type_check`

รายละเอียดการติดตั้งและใช้งานอยู่ใน `VERCEL_ADMIN_GUIDE_TH.md`
