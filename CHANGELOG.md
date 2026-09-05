# Changelog

All notable changes to the Neko Control Room project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

## 2026-09-05 — Control-plane baseline

 ### Added
- **Runtime Config v1 Control Plane**: Added administrative control plane endpoint (`GET /api/runtime-config`, `POST /api/runtime-config`) backed by PostgreSQL RPC functions.
   - Admin session and origin checks: GET and POST require an Admin session; POST additionally enforces same-origin mutation checks.
   - Safe metadata boundary: returns only sanitized fields (`config_version`, `endpoint_id`, `published_at`) to authorized operators while keeping raw credentials, ciphers, and routing targets confidential on the server.
   - Strict authentication: returns `401 Unauthorized` for unauthenticated requests.
- **Production Vercel Path**: Single-origin architecture deploying administrative dashboard and backend API serverless functions (`api/` and `server/`) on Vercel.
- **Public Proxy Status Endpoint**: Added `/api/proxy/status` returning `200 OK` with load classifications (`light`, `moderate`, `heavy`, `full`) and sanitized aggregate telemetry.
- **Automated Test Suite**: Comprehensive test suite with 103/103 passing native Node.js tests (`node --test`) on Node 24.
- **Community & Governance Standards**: Added public documentation including `SECURITY.md`, `CONTRIBUTING.md`, issue templates, and pull request guidelines.
