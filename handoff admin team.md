# Handoff สำหรับทีม Admin Tool: Admin-assisted Password Reset

อัปเดต: 29 กรกฎาคม 2026
Repository: `D:\Neko-Family-Proxy admin tool`

สถานะล่าสุด: implement, test และ deploy production แล้ว โค้ด server ปัจจุบันอยู่
ใน `server/` และ Vercel entry point อยู่ที่ `api/index.mjs`

## เป้าหมาย

เพิ่มความสามารถให้แอดมินตั้งรหัสผ่านชั่วคราวสำหรับลูกค้าที่จำรหัสผ่านไม่ได้
โดยรักษา Auth user ID, License, อุปกรณ์ และประวัติเดิมไว้

งานนี้ใช้แทนระบบส่ง Reset Password ทางอีเมล

ไม่ต้องเพิ่ม Send Email Hook, SMTP, Resend หรือหน้า reset email

## Workflow ที่ต้องรองรับ

1. ลูกค้าติดต่อแอดมินพร้อม Username
2. แอดมินตรวจสอบตัวตนตามกระบวนการของทีม
3. แอดมินเปิดหน้าสมาชิกและเลือกบัญชีลูกค้า
4. แอดมินกด “ตั้งรหัสผ่านใหม่”
5. UI ให้พิมพ์ Username เพื่อยืนยัน
6. Admin API ตรวจ admin session อีกครั้ง
7. Admin API ตรวจว่า target มีอยู่และเป็น role `customer`
8. Admin API ยกเลิก Launcher sessions ของ target
9. Server สร้างรหัสชั่วคราวแบบสุ่ม
10. Server เรียก Supabase Auth Admin API เพื่อเปลี่ยน password
11. Server บันทึก audit event โดยไม่มี plaintext password
12. API ส่งรหัสชั่วคราวกลับมาเพียงครั้งเดียว
13. UI แสดงรหัสพร้อมปุ่ม Copy และเตือนว่าเรียกดูย้อนหลังไม่ได้
14. แอดมินส่งรหัสให้ลูกค้าผ่านช่องทางส่วนตัว

## ข้อกำหนดสำคัญ

- ใช้ `supabase.auth.admin.updateUserById(userId, { password })`
- คำสั่ง Auth Admin ต้องรันใน Node.js server เท่านั้น
- ใช้ `SUPABASE_SECRET_KEY` จาก environment ฝั่ง server
- ห้ามส่ง secret key ไป standalone HTML หรือ browser
- Browser ส่งเพียง `userId` และ Username ที่ใช้ยืนยัน
- ใน v1 ให้ server เป็นผู้สร้าง password ห้ามรับ password ที่แอดมินตั้งเอง
- ห้าม reset บัญชีที่ role เป็น `admin`
- ห้าม reset บัญชีแอดมินที่กำลัง Login
- ห้ามใช้การลบ Auth user เป็นส่วนหนึ่งของ password reset

Dependency `@supabase/supabase-js` มีอยู่แล้วใน `package.json`

## ไฟล์ที่คาดว่าจะต้องแก้

- `admin-api/src/supabase.mjs`
- `admin-api/src/routes/admin.mjs`
- `api/index.mjs`
- `standalone/src/sections/render.js`
- `standalone/src/main.js`
- `tests/admin-api.test.mjs`
- `README.md`
- `LOCAL_ADMIN_GUIDE_TH.md`

## Backend Design

### Supabase admin client

สร้าง client สำหรับ server ด้วย:

- Supabase URL
- Supabase secret key
- `autoRefreshToken: false`
- `persistSession: false`

เพิ่ม helper ที่ทำหน้าที่เฉพาะ:

```text
updateAuthUserPassword(userId, password)
```

helper ต้องเรียก Auth Admin API และส่ง error แบบไม่แนบรหัสผ่านหรือ secret

### Admin action

เพิ่ม action:

```json
{
  "action": "reset_user_password",
  "userId": "target-auth-user-id",
  "confirmUsername": "target_username"
}
```

Response สำเร็จ:

```json
{
  "ok": true,
  "temporaryPassword": "shown-once"
}
```

response ต้องมี `Cache-Control: no-store` ซึ่ง API ปัจจุบันตั้งไว้แล้ว

### Validation

ก่อนทำคำสั่ง:

1. ตรวจ admin session ด้วยกลไกเดิม
2. query `profiles` ด้วย `userId`
3. target ต้องมีอยู่
4. `confirmUsername` ต้องตรงกับ Username จริงแบบ normalize แล้ว
5. target ต้องเป็น `customer`
6. target ต้องไม่ใช่ actor
7. จำกัดขนาด input และปฏิเสธ UUID/Username ที่ไม่ถูกต้อง

### การสร้างรหัสชั่วคราว

ใช้ Node.js `node:crypto` และ CSPRNG

ข้อกำหนด:

- อย่างน้อย 16 ตัวอักษร
- มี uppercase, lowercase, ตัวเลข และสัญลักษณ์
- หลีกเลี่ยงตัวที่อ่านสับสนได้ถ้าไม่ลด entropy มากเกินไป
- สุ่มและ shuffle ด้วย cryptographic random
- ห้ามใช้ `Math.random()`
- ห้ามเขียน password ลง console, audit, error หรือฐานข้อมูล

### ลำดับคำสั่ง

Auth Admin API และ Postgres update ไม่ได้อยู่ใน transaction เดียวกัน ให้ใช้
ลำดับที่ลดผลกระทบเมื่อบางขั้นล้มเหลว:

1. validate actor และ target
2. สร้าง temporary password ใน memory
3. revoke `public.launcher_sessions` ที่ยัง active ของ target
4. เปลี่ยน Auth password
5. บันทึก audit event
6. ส่ง temporary password กลับ

ถ้า session revoke ล้มเหลว ห้ามเปลี่ยน password

ถ้า Auth update ล้มเหลว ให้คืน error และไม่เปิดเผย temporary password
บัญชีเดิมยังใช้ password เดิมได้ และสามารถ Login เพื่อ claim session ใหม่

ถ้า audit ล้มเหลวหลังเปลี่ยน password ให้ตอบ failure ที่อธิบายว่า password
ถูกเปลี่ยนแล้วแต่ audit ไม่สมบูรณ์ ห้าม retry แบบเงียบ เพราะ retry จะสร้าง
password ใหม่อีกครั้ง

ทีมอาจเลือกทำ audit แบบ transactional RPC ก่อน/หลัง Auth update แต่ต้อง
บันทึก failure state ให้แอดมินเห็นชัด

## Audit

เพิ่ม event type ใหม่ในฐานข้อมูล:

```text
admin_password_reset
```

metadata ที่อนุญาต:

- `target_user_id`
- `target_username`
- `sessions_revoked`
- timestamp ใช้ `created_at` ของตาราง

ห้ามบันทึก:

- temporary password
- password hash
- Supabase secret
- Auth token
- admin session cookie

ต้องประสาน repository หลักเพื่อสร้าง migration ที่เพิ่มค่าใน
`audit_events_event_type_check`

## Frontend Design

ในหน้าสมาชิก:

- เพิ่มปุ่ม “ตั้งรหัสผ่านใหม่” เฉพาะ row ของ role `customer`
- ปุ่มใช้ danger/warning styling
- เปิด confirmation dialog
- ให้พิมพ์ Username เพื่อยืนยัน
- ระบุชัดว่า session เดิมจะถูกยกเลิก

เมื่อสำเร็จ:

- แสดง temporary password ใน dialog ที่ปิดแล้วเรียกดูย้อนหลังไม่ได้
- มีปุ่ม Copy
- ไม่บันทึกลง `localStorage`, `sessionStorage` หรือ coupon archive
- ล้างค่าจาก DOM/state เมื่อปิด dialog
- ไม่รวม password ใน toast หรือ URL

## สิ่งที่ไม่ต้องทำ

- ไม่ลบ Auth user
- ไม่ลบ Profile หรือ License
- ไม่สร้างคูปองชดเชย
- ไม่แก้วันหมดอายุ License
- ไม่เพิ่ม recovery email
- ไม่ส่งอีเมล
- ไม่สร้าง public RPC สำหรับเปลี่ยน password
- ไม่เปิดสิทธิ์ Auth Admin ให้ client

## Tests ที่ต้องมี

### API

- request ที่ไม่มี admin session ได้ `401`
- session ของ user ที่ไม่ใช่ active admin ถูกปฏิเสธ
- target ไม่มีอยู่ถูกปฏิเสธ
- Username ยืนยันไม่ตรงถูกปฏิเสธ
- actor reset ตัวเองไม่ได้
- target admin ถูกปฏิเสธ
- generated password ผ่านข้อกำหนดความยาวและ character classes
- session revoke เกิดก่อน Auth update
- session revoke ล้มเหลวแล้ว Auth update ไม่ถูกเรียก
- Auth update ล้มเหลวแล้วไม่คืน temporary password
- success คืน temporary password เพียง response ปัจจุบัน
- audit ไม่มี plaintext password
- secret key ไม่ปรากฏใน response หรือ frontend bundle

### UI

- ปุ่มแสดงเฉพาะ customer
- ต้องพิมพ์ Username ตรงก่อน submit
- ปุ่มถูก disable ขณะ request ทำงาน
- แสดง password และ Copy ได้เมื่อสำเร็จ
- ปิด dialog แล้ว password หายจาก DOM/state
- error ไม่แสดง Supabase response ภายในหรือ secret

### End-to-end

1. สร้าง disposable customer และเติม License
2. จด user ID และ `valid_until`
3. Login ด้วย password เดิม
4. Admin reset password
5. ตรวจว่า Launcher session เดิมถูก revoke
6. ตรวจว่า password เดิม Login ไม่ได้
7. Login ด้วย temporary password
8. ตรวจ user ID และ `valid_until` เท่าเดิม
9. เปลี่ยน password จาก Launcher
10. ตรวจ temporary password ใช้ไม่ได้
11. ตรวจ audit event และ logs ว่าไม่มี password
12. ลบ disposable test data

## Definition of Done

- `npm test` ผ่าน
- standalone build ผ่าน
- Admin authentication/RBAC regression ผ่าน
- reset password ทำงานกับ disposable user
- user ID และ License ไม่เปลี่ยน
- session เดิมหยุดทำงาน
- ไม่มี secret/password ใน browser bundle, logs หรือ audit
- เอกสารการใช้งานภาษาไทยอัปเดต
- deployment ID และผล end-to-end test ส่งกลับทีมหลักเพื่อลง `log.md`
