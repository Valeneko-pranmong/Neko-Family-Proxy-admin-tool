# Handoff — Neko Control Room

Updated: 2026-09-12

## Current state
- Canonical branch: `main`
- Canonical SHA: `ac2d713e05b46cf14915cf2c51140441bf797cf8`
- Repository root is maintained as the canonical work surface; old feature worktrees were removed during workspace cleanup while branch refs were preserved.

## Production role
This project is the Web Admin/control plane. It runs on Vercel and uses Supabase/Postgres for trusted state. Repository state is not proof of live deployment state.

## Sensitive boundary
Do not print/copy/commit deployment secret values. Keep service-role, admin-session, recovery-HMAC and telemetry-ingest secrets server-side only.

## Current cross-project next work
Launcher v5.1.0 is installer-only and automatic update distribution is currently unavailable. The next system architecture task is a separate signed update backend/storage channel. If this project is selected as part of that channel, do not weaken immutable object identity, signed manifest verification, rollback retention or secret isolation.

Detailed cross-project handoff:
`E:\Github\Project manager\current\NEXT_WORK_AUTO_UPDATE_BACKEND_HANDOFF.md`

## First checks for a new maintainer
1. `git status --short --branch`
2. compare `HEAD` with `origin/main`
3. run the repository test/build commands before a deployment change
4. verify Vercel deployment/environment and Supabase migrations/live state separately
5. read `docs/current/` before modifying runtime-config/account-recovery contracts

## Avoid
- treating `docs/archive/` as a current contract
- exposing secret-bearing runtime configuration to browser/public APIs
- changing old production-applied migrations in place
- assuming a local successful build means production is deployed
