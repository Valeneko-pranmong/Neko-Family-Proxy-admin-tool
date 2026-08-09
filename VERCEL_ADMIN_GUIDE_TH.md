# คู่มือ Neko Control Room บน Vercel

ระบบนี้ให้บริการผ่าน Vercel เท่านั้น ไม่มี Local Admin API

## ตั้งค่า

ตั้ง Environment Variables สำหรับ Production/Preview:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=ใส่ Supabase Secret Key
ADMIN_SESSION_SECRET=ค่าสุ่มลับอย่างน้อย 32 bytes
ACCOUNT_RECOVERY_HMAC_SECRET=ค่าสุ่มลับอิสระอย่างน้อย 32 bytes
```

ห้ามใช้ค่าเดียวกันระหว่าง session secret และ recovery HMAC secret ห้ามเปิดเผยผ่าน browser environment หรือ logs จากนั้น apply forward-only Backend migration `20260809120000_account_recovery_codes.sql` ใน staging ก่อน production

## สร้าง Recovery Code

1. ตรวจสอบตัวตนลูกค้าตามกระบวนการธุรกิจ
2. เข้าเมนู **สมาชิก**
3. กด **สร้าง Recovery Code** ที่บัญชี customer
4. พิมพ์ Username ให้ตรงเพื่อยืนยัน
5. อ่านคำเตือน: code อายุ 5 นาที ใช้ได้ครั้งเดียว และ code ใหม่ยกเลิก code เดิม
6. คัดลอก code จาก dialog แล้วส่งผ่านช่องทางส่วนตัว
7. ปิด dialog เมื่อส่งเสร็จ ระบบจะล้าง plaintext จาก memory ของหน้าเว็บ

Admin ไม่ตั้งและไม่เห็น password ใหม่ Recovery Code ไม่ใช่ Supabase password ลูกค้าต้องใช้ Launcher recovery flow เพื่อตั้ง password เอง หาก Admin ปิดหรือ refresh dialog แล้วทำ code หาย ให้สร้าง code ใหม่

## Endpoint สำหรับ Launcher

ดูสัญญาฉบับเต็มที่ `docs/LAUNCHER_ACCOUNT_RECOVERY_CONTRACT.md`:

- `POST /api/account/recovery/verify`
- `POST /api/account/recovery/change-password`

Recovery Session เป็น restricted opaque credential ใช้ได้เฉพาะ change-password ห้ามนำไปใช้เป็น Launcher access token

## ความปลอดภัย

- เปิด Vercel Firewall/WAF rate limiting เพิ่มเติมสำหรับ `/api/login`, `/api/admin`, `/api/account/recovery/verify` และ `/api/account/recovery/change-password`
- Database มี transactional per-requester rate limit และ failed-code attempt lock อยู่แล้ว แต่ edge rate limit ช่วยลด load ก่อนถึง Function
- จำกัดผู้เข้าถึง Production deployment ตามนโยบายทีม
- ห้าม log request body หรือ Authorization header ของ recovery endpoints
- ตรวจ Audit โดยต้องไม่มี code, password หรือ recovery token
- หมุน HMAC secret เฉพาะเมื่อจำเป็นและถือว่า recovery operations ที่ค้างทั้งหมดใช้ต่อไม่ได้

## ตรวจสอบ

```powershell
npm run build
npm test
npm audit
```

ก่อน release ต้องทดสอบ migration/RPC และ Auth failure injection ใน staging ห้าม deploy migration หรือเปลี่ยน Auth configuration จากเครื่อง development โดยพลการ
