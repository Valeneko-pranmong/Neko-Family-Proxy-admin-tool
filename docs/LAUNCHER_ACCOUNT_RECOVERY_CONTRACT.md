# Launcher Account Recovery Contract

This contract replaces the old Admin-assisted temporary-password flow. A Recovery Code is never a Supabase password and a Recovery Session is never a normal Launcher session.

## 1. Verify Recovery Code

`POST /api/account/recovery/verify`

```json
{
  "username": "customer_username",
  "recovery_code": "ABCD-EFGH-JKLM-NPQR"
}
```

Success `200`:

```json
{
  "ok": true,
  "recovery_session_id": "uuid",
  "recovery_session": "opaque-token",
  "scope": "change_password",
  "expires_at": "RFC3339 timestamp"
}
```

Store the opaque token in process memory only. Do not put it in normal Launcher auth/session storage, logs, URLs, analytics, or crash reports. It expires after 10 minutes and can authorize only the password-change endpoint.

Expected errors:

- `400 Recovery code is invalid or expired`: malformed, incorrect, expired, used, superseded, locked, unknown username, or rate limited. The shared message intentionally avoids account enumeration.
- `413 Request body too large`
- `503/502`: recovery service is temporarily unavailable; show a retry action without exposing the raw backend error.

The code is consumed when verification succeeds, so it cannot create another Recovery Session.

## 2. Change Password

`POST /api/account/recovery/change-password`

Header:

```text
Authorization: Bearer <recovery_session>
Content-Type: application/json
```

Body:

```json
{
  "new_password": "user-chosen password"
}
```

Password policy:

- 12–128 characters
- at least one uppercase letter
- at least one lowercase letter
- at least one number
- at least one non-alphanumeric symbol

Success `200`:

```json
{
  "ok": true,
  "completed": true,
  "state": "completed"
}
```

Expected errors:

- `400`: password policy failure
- `401`: missing, invalid, expired, completed, or revoked Recovery Session
- `409/503`: another update is in progress; retry the same token and same password
- `503 Password recovery is temporarily unavailable; retry the same request`: Auth update failed; retry the same token and password
- `503 Password was updated but recovery finalization is pending; retry the same request`: Auth may already be updated; retry **the same token and exactly the same password**. Do not start a new recovery operation.

The backend binds the first attempted password via a server-side HMAC fingerprint. A retry using a different password is rejected. Replaying the same password is idempotent even when the prior Supabase Auth response was ambiguous.

After success:

1. the Recovery Session is permanently completed and invalid;
2. all previous Launcher sessions for the account are revoked;
3. the Launcher must discard the Recovery Session;
4. return to the normal login screen;
5. the user signs in normally with the new password, creating a regular Launcher session through the existing flow.

## Security boundary

Recovery Session credentials must never be accepted by Launcher Core, installation registration, coupon/license APIs, normal login/session RPCs, or privileged Admin operations. Only this Web API calls Supabase Auth Admin APIs with the server-side service-role credential.
