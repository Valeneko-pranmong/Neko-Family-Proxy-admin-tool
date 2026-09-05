# Contributing to Neko Control Room

Thank you for your interest in contributing to Neko Control Room! This document outlines our development guidelines, security standards, and workflow practices.

---

## Code of Conduct

All contributors and maintainers are expected to maintain a respectful, constructive, and inclusive environment.

---

## Development Workflow

### Prerequisites
* **Node.js**: `24.x` (enforced via `.engines` in `package.json`)
* **npm**: `10.x` or later
* Git

### Local Environment Setup

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Build the standalone bundle:
   ```bash
   npm run build
   ```

3. Run the automated test suite:
   ```bash
   npm test
   ```
   All 103 tests must pass before submitting any changes.

---

## Architecture & Security Rules

To protect our users and infrastructure, every contribution must follow these non-negotiable principles:

1. **Strict Secret Hygiene**
   * Never commit real secrets, private keys, service tokens, passwords, recovery codes, or production URLs/IPs.
   * Documentation and tests must only use generic placeholders (e.g., `https://your-project.supabase.co`, `test-secret-value-at-least-32-bytes`).
   * Never expose server secrets (`SUPABASE_SECRET_KEY`, `ADMIN_SESSION_SECRET`, `ACCOUNT_RECOVERY_HMAC_SECRET`, `SERVER_METRICS_INGEST_SECRET`) to client-side bundles or public endpoints.

2. **Runtime Config v1 Invariants**
   * The endpoint `/api/runtime-config` (GET and POST) requires an Admin session; unauthenticated requests must be rejected with `401 Unauthorized`.
   * POST requests to `/api/runtime-config` must additionally enforce same-origin mutation checks.
   * Authorized requests must only return safe metadata (`config_version`, `endpoint_id`, `published_at`).
   * Connection credentials, cryptographic ciphers, and routing targets must stay strictly server-side.

3. **Public API Sanitization**
   * Unauthenticated endpoints such as `/api/proxy/status` must return sanitized aggregate metrics.
   * Never expose internal hostnames, interface addresses, or private server identifiers in public payloads.

4. **Testing Standards**
   * Any new feature or bug fix must be accompanied by automated tests under `tests/` executable via `npm test` (`node --test`).
   * Ensure tests run self-contained and clean up any spawned processes or mocks.

---

## Pull Request Process

1. **Branch Naming**: Use descriptive branch names:
   * `feat/short-description`
   * `fix/short-description`
   * `docs/short-description`
2. **Commit Hygiene**: Write concise, conventional commit messages (`feat: ...`, `fix: ...`, `docs: ...`).
3. **Template**: Fill out all sections of `.github/PULL_REQUEST_TEMPLATE.md`.
4. **Verification**: Confirm `npm run build` and `npm test` both succeed cleanly.
