# คู่มือ Neko Control Room บน Vercel

ระบบนี้ให้บริการผ่าน Vercel เท่านั้น ไม่มี Local Admin API และไม่ต้องเปิด port
หรือรัน PowerShell launcher บนเครื่องผู้ดูแล

## ตั้งค่า Vercel

1. เชื่อม repository นี้กับ Vercel project
2. ตั้ง Environment Variables สำหรับ Production และ Preview ตามความเหมาะสม:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=ใส่ Supabase Secret Key
ADMIN_SESSION_SECRET=ค่าสุ่มลับอย่างน้อย 32 bytes
```

3. หากต้องการเปลี่ยนอายุ session ให้กำหนด `ADMIN_SESSION_TTL_MS`
   ระหว่าง `300000` ถึง `86400000`
4. Deploy แล้วเปิด URL ของ Vercel
5. Login ด้วย Username/Password ของ Supabase user ที่มี
   `public.profiles.role = admin` และ `status = active`

Vercel Function จะเก็บ secret ไว้ฝั่ง server เท่านั้น ส่วนเบราว์เซอร์ได้รับ
signed session cookie ที่เป็น `Secure`, `HttpOnly` และ `SameSite=Strict`

## ตั้งรหัสผ่านใหม่ให้ลูกค้า

1. ตรวจสอบตัวตนของลูกค้าตามกระบวนการของทีม
2. เข้าเมนู **สมาชิก**
3. กด **ตั้งรหัสผ่านใหม่** ที่บัญชี `customer`
4. พิมพ์ Username ให้ตรงเพื่อยืนยัน
5. ระบบจะยกเลิก Launcher session เดิมและสร้างรหัสผ่านชั่วคราว
6. กด **คัดลอก** แล้วส่งให้ลูกค้าผ่านช่องทางส่วนตัว
7. ปิด dialog เพื่อให้รหัสผ่านถูกล้างออกจากหน้าเว็บ

หากระบบแจ้งว่ารหัสผ่านถูกเปลี่ยนแล้วแต่ Audit ล้มเหลว **ห้ามกดซ้ำ**
ให้ติดต่อผู้ดูแลฐานข้อมูล เพราะการกดซ้ำจะสร้างรหัสใหม่อีกครั้ง

## ข้อกำหนดฐานข้อมูล

repository ฐานข้อมูลหลักต้องเพิ่ม `admin_password_reset` เป็นค่าที่อนุญาตใน
`public.audit_events` constraint `audit_events_event_type_check`

## ความปลอดภัยสำหรับระบบบนอินเทอร์เน็ต

- เปิด Vercel Firewall rate limiting สำหรับ `/api/login` และ `/api/admin`
- จำกัดสิทธิ์ผู้ที่เข้าถึง Production deployment ตามนโยบายของทีม
- หมุน `ADMIN_SESSION_SECRET` เมื่อสงสัยว่ารั่ว ซึ่งจะทำให้ session เดิมหมดผล
- ห้ามเปิดเผย `.env.local`, Supabase Secret Key หรือ admin session cookie
- ตรวจ Runtime Logs และ Audit เป็นประจำ โดยต้องไม่มี plaintext password

## คำสั่งตรวจสอบ

```powershell
npm run build
npm test
```

E2E กับ disposable user ต้องมี `SUPABASE_PUBLISHABLE_KEY` เพิ่มใน environment:

```powershell
npm run test:e2e:password-reset
```
