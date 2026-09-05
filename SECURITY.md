# Security Policy

## Supported Scope

Security updates and critical patches are actively applied to the current `main` / production control plane on Node 24.

---

## Security Architecture & Threat Model

Neko Control Room operates under a strict **Zero-Trust Client** security design:

1. **Confidential Server Boundary**
   * All database operations using administrative privileges (`SUPABASE_SECRET_KEY`) execute exclusively in trusted Vercel Serverless Functions (`api/` and `server/`).
   * No backend credentials, API service tokens, or private encryption keys are ever passed to client-side bundles or web responses.

2. **Runtime Config v1 Isolation**
   * The endpoint `/api/runtime-config` (GET and POST) requires an Admin session; unauthenticated requests fail immediately with `401 Unauthorized`.
   * POST requests to `/api/runtime-config` additionally enforce same-origin mutation checks.
   * Authorized requests expose only sanitized operational metadata (`config_version`, `endpoint_id`, `published_at`).
   * Proxy authority, upstream server credentials, cryptographic ciphers, and routing targets remain confined to the server-side database and are never leaked to client browsers.

3. **Account Recovery Defense-in-Depth**
   * Recovery codes are generated with high entropy, limited to a 5-minute lifespan, and enforce single-use semantics.
   * Plaintext recovery codes are never stored in the database; only cryptographic HMAC verifiers signed by `ACCOUNT_RECOVERY_HMAC_SECRET` are persisted.
   * Successful completion revokes all pre-existing client sessions.

4. **Telemetry Ingest & Public Status Privacy**
   * Edge telemetry from monitoring agents is authenticated via pre-shared high-entropy Bearer tokens (`SERVER_METRICS_INGEST_SECRET`).
   * Public health data served at `/api/proxy/status` is rigorously scrubbed: only coarse aggregate health indicators and load classifications are returned. Hostnames, internal IP addresses, and customer usage data are strictly excluded.

---

## Reporting a Vulnerability

We appreciate the security community's efforts to improve the security of Neko Family Proxy.

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

If you discover a security issue or vulnerability:

1. **Draft a Private Report**: Include detailed reproduction steps, potential impact, and affected components or endpoints.
2. **Submit via GitHub Security Advisory**: Use the **Security** tab of the repository to submit a private vulnerability advisory.
3. **Alternative Contact**: If GitHub Private Vulnerability Reporting is unavailable, coordinate directly with the core maintenance team through official operator communication channels.

### What to Include
* Description of the vulnerability and attack vector
* Affected endpoints, code paths, or configuration settings
* Proof of concept (PoC) or reproducible curl/script commands (using placeholder credentials)
* Assessment of impact on data confidentiality, integrity, or service availability

### Response & Coordination
Reports are triaged through private coordination channels. Remediations will be developed and verified privately before coordinated disclosure.
