# Project Context — Neko Control Room

Updated: 2026-09-12

## Purpose
This repository is the Web Admin / Control Room tier for Neko Family Proxy. It hosts the operator UI and trusted server-side API logic on Vercel, backed by Supabase/Postgres.

## Canonical repository state
- Repository: `Valeneko-pranmong/Neko-Family-Proxy-admin-tool`
- Canonical branch: `main`
- Canonical `main` should be verified against live `origin/main` before work; documentation/maintenance commits may advance it without changing production behavior.

## Responsibilities
- Admin authentication/session handling.
- Public sanitized proxy status.
- Server metrics ingestion/query.
- Customer account recovery workflows.
- Runtime Config v1 operator publication/metadata.
- Vercel same-origin web UI/API deployment.

## Security boundary
Real service/database/admin secrets belong only in the deployment environment. Never commit or document actual values for Supabase service-role authority, admin session secrets, recovery HMAC secrets, telemetry ingest secrets, or equivalent credentials.

Public endpoints must remain sanitized. Browser-visible code must not receive server-only credentials or secret-bearing runtime configuration.

## Related projects
- `E:\Github\Neko-Family-Proxy` — Windows Launcher/client.
- `E:\Github\NekoProxyCore` — low-level Core/driver/runtime.
- `E:\Github\Neko-Core AWS` — production server/infrastructure.
- `E:\Github\Project manager` — cross-project control/handoff.

## Current cross-project concern
The Launcher public v5.1.0 release is intentionally installer-only, so automatic update payload distribution must move away from public GitHub Release assets. If Control Room/backend storage becomes part of that architecture, preserve server-side secret isolation, immutable/version-bound object identity and signed-manifest verification; storage must not become a new trust authority by itself.

## Build/test
Use repository `package.json`/README as current command authority. At cleanup time the documented flow is `npm install`, `npm run build`, `npm test`.

## Read next
1. `README.md`
2. `HANDOFF.md`
3. `docs/current/` for active contracts/runbooks
4. `E:\Github\Project manager\projects\ADMIN.md`
5. cross-project current handoff when release/update work is involved.

Verify live Vercel/Supabase state before production operations; repository state alone is not deployment proof.
