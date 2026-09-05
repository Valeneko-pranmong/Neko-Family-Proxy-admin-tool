## Description

<!-- Provide a clear, concise summary of the changes proposed in this pull request. -->

## Changes Proposed

-
-

## Security & Architectural Checklist

- [ ] **No Secret Leaks:** No production credentials, tokens, recovery codes, private endpoints, or real IDs are included or logged.
- [ ] **Runtime Config v1 Invariants:** Unauthenticated access returns `401 Unauthorized`; authorized access returns safe metadata only (`config_version`, `endpoint_id`, `published_at`).
- [ ] **Public API Hygiene:** Unauthenticated responses (e.g. `/api/proxy/status`) return strictly sanitized, aggregate data with no internal hostnames.
- [ ] **Server Boundary Enforced:** Database authority (`SUPABASE_SECRET_KEY`) remains isolated to trusted serverless endpoints and is never exposed to client bundles.

## Verification & Testing

- [ ] Ran `npm run build` cleanly without bundle warnings or errors.
- [ ] Ran `npm test` with all tests passing (103/103 tests passing).
- [ ] Added or updated test coverage under `tests/` for new features or bug fixes.
