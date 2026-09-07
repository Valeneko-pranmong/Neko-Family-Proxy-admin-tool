# Software Update Admin Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all seven blocking Sol findings for the Admin software-update control plane with a closed trusted active-release model, strict scoped distribution capabilities, private Supabase Storage Core grants of at most 120 seconds, and executable production-provider proof, while preserving the public manifest and anonymous Launcher path.

**Architecture:** `SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON` is the sole server-side ownership and object-location authority. Its exact `components.launcher` and `components.core` keys classify artifacts; decoded envelope bytes can only confirm exact release-v2 agreement and can never grant a less-protected classification. Launcher remains a query-free public HTTPS object and may receive an anonymous short-lived grant response. Core has only a private Supabase Storage `{bucket, object}` identity and requires a canonical, scoped, unexpired, enabled, non-revoked `NekoDistribution` capability before the server calls an injected Supabase signer. The server does not verify Ed25519 because the Owner Gate threat model accepts trusted server configuration plus strict payload agreement; the Launcher remains responsible for signature verification.

**Tech Stack:** Vercel Node.js 24.x, ECMAScript modules, Node `node:test`, Node `crypto`, `@supabase/supabase-js` 2.110.8, Supabase private Storage, npm 11.

**Spec / Authority:** `E:\Github\Project manager\OWNER_GATE_2_PRODUCTION_PACKAGE.md` is the Owner Gate #2 authority. The release payload agreement contract is the canonical release-v2 schema in the approved Phase 3 design, with the Admin-owned distribution mapping frozen below. The seven Critical/Important Sol readiness findings supplied with this plan are blocking acceptance criteria. If these sources disagree, stop and obtain Owner resolution; do not weaken a closed validation rule.

---

## Frozen Contracts

### Trusted active-release record

`SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON` is absent/empty only for the explicit no-release state. Otherwise it must be one bounded JSON object with exact keys `channel`, `envelope`, and `components`:

```text
{
  "channel": "beta",
  "envelope": {
    "envelope_version": 1,
    "key_id": "<ASCII [A-Za-z0-9._-]{1,64}>",
    "payload_b64": "<canonical standard base64 with padding>",
    "signature_b64": "<canonical standard base64 with padding>"
  },
  "components": {
    "launcher": {
      "artifact_id": "<ASCII [A-Za-z0-9._-]{1,96}>",
      "format": "raw-pe-v1",
      "distribution": "public-launcher",
      "sha256": "<lowercase hex64>",
      "size": "<integer 1..134217728>",
      "public_url": "<HTTPS URL without userinfo, query, or hash>"
    },
    "core": {
      "artifact_id": "<ASCII [A-Za-z0-9._-]{1,96}>",
      "format": "zip-core-v1",
      "distribution": "controlled-core",
      "sha256": "<lowercase hex64>",
      "size": "<integer 1..1073741824>",
      "storage": {
        "bucket": "<immutable safe bucket identifier>",
        "object": "<immutable safe object path>"
      }
    }
  }
}
```

The component keys and every nested key set are exact. Launcher must not contain `storage`; Core must not contain `public_url`. Artifact IDs must differ. Freeze bucket grammar as `[A-Za-z0-9][A-Za-z0-9._-]{0,62}`. Freeze object grammar as 1..512 ASCII characters split by `/` into nonempty `[A-Za-z0-9][A-Za-z0-9._-]{0,127}` segments; reject leading/trailing slash, `//`, `.`, `..`, backslash, percent escapes, controls, whitespace, query, and fragment. These are identifiers, not caller-controlled paths. Production values stay external to Git.

Envelope decoding is strict and bounded: canonical standard base64 round-trip, valid UTF-8 without BOM, one JSON value, duplicate-key rejection before object construction, and closed canonical release-v2 schema. Require `schema_version: 2`, `channel: "beta"`, exact `launcher`/`core` components, release integer/string/boolean/protocol fields and closed key sets from release-v2. For agreement, map payload `artifact_id` to record `artifact_id`, payload `artifact_sha256` to record `sha256`, payload `artifact_size` to record `size`, and payload `artifact_format` to record `format`; map payload component ownership to the fixed distribution implied by its closed key (`launcher` = `public-launcher`, `core` = `controlled-core`) and require that value to equal record `distribution`. The canonical release-v2 payload does not add a new signed `distribution` field. Any decode, duplicate, schema, component, mapping, or agreement failure rejects the entire active record as `SOFTWARE_UPDATE_RECORD_INVALID`. Classification and location always come from the trusted record component key, never decoded bytes. Ed25519 verification is deliberately not added server-side in this gate.

### Distribution capability

The only accepted header is exactly `Authorization: NekoDistribution <token>`: one scheme, one ASCII space, one token, no leading/trailing whitespace or second value. `<token>` must match `[A-Za-z0-9_-]{43}`, decode as base64url without padding to exactly 32 bytes, and round-trip to the identical canonical 43-character token.

`DISTRIBUTION_CAPABILITIES_JSON` is a bounded JSON array of 1..1024 exact entries, with no duplicate keys:

```text
{
  "credential_sha256": "<lowercase hex64>",
  "channel": "beta",
  "artifact_ids": ["<unique artifact_id>", "<up to 64 entries>"],
  "expires_at": "<UTC RFC3339 seconds, YYYY-MM-DDTHH:mm:ssZ>",
  "enabled": true,
  "revoked": false
}
```

Every entry must be valid; malformed entries fail the whole registry closed rather than being skipped. `artifact_ids` is nonempty, unique, and explicit. Expiry is mandatory, strictly later than injected `now`, and compared only after validating `now`. Hash the decoded 32 token bytes with SHA-256, decode each configured digest to 32 bytes, and compare equal-length bytes with `crypto.timingSafeEqual`. Authorization additionally requires exact channel and artifact scope. Missing/malformed registry is a server configuration error; missing header is 401; syntactically invalid, unknown, expired, disabled, revoked, channel-mismatched, or out-of-scope capability is 403. Raw token, digest, registry, service key, storage identity, and signed URL never appear in errors or logs.

### Grant and signer interface

Freeze `CORE_SIGNED_URL_TTL_SECONDS = 120`. Add this interface in `server/supabase.mjs` rather than adding a provider or dependency:

```text
export async function createPrivateStorageSignedGetUrl(bucket, object, ttlSeconds)
```

It calls `supabaseAdmin.storage.from(bucket).createSignedUrl(object, ttlSeconds)` only after validating `ttlSeconds` as integer `1..120`; rejects provider errors generically; and accepts only a returned absolute HTTPS URL with a host and no userinfo or fragment. It must not log the URL, provider detail, or service key.

Freeze the provider seam as:

```text
export async function getArtifactGrant(
  artifactId,
  env = process.env,
  now = new Date(),
  authHeader = null,
  signCoreUrl = createPrivateStorageSignedGetUrl,
)
```

The function validates the complete active record first. For trusted Launcher, it returns `public_url` anonymously with `expires_at = now + 120 seconds` and never invokes the signer or capability parser. For trusted Core, it validates capability authorization first, then invokes `signCoreUrl` exactly once with only the trusted record's `storage.bucket`, `storage.object`, and `120`; caller input can never select storage. It returns the validated signed URL and `expires_at = now + 120 seconds`, derived from the exact request time and requested provider TTL rather than a provider query value. Invalid clock, record, authorization, or provider output produces no successful grant. `api/index.mjs` continues awaiting this interface and forwards only the request's Authorization value.

---

## Global Constraints and Execution Contract

- Work from `E:\Github\worktrees\Neko-Family-Proxy-admin-tool-software-update` on `feature/software-update-phase2-control-plane`; before implementation confirm HEAD descends from `151acf19e0458a4a999ed0550f14719a9dbff495` and the worktree contains no unrelated changes.
- Tasks A-D perform no production provisioning, environment mutation, storage upload, bucket/policy change, deploy, merge, tag, release, production signing, or live capability creation. Test fixtures use synthetic values only.
- Do not add a storage provider or dependency. Use existing `@supabase/supabase-js` 2.110.8 and the existing service-role client sourced from `SUPABASE_URL` / `SUPABASE_SECRET_KEY`.
- Do not put production bucket names, object identities, active records, capabilities, capability digests, keys, service keys, or signed URLs in Git, command lines, test output, errors, or logs. Runtime environment variable names are not secrets and may be documented.
- Keep the public manifest endpoint, anonymous Launcher grants, and existing request body `{artifact_id}`. Do not add UI, migrations, broad refactors, public endpoints, or Minor-only work.
- Each implementation task uses tests-first: commit tests, run the named focused command and capture an assertion-level RED, implement minimum production behavior, run focused GREEN, run `npm test`, then obtain an independent Sol review with Critical=0 and Important=0 before its production commit. Import/collection/configuration failures are not a valid RED.
- Canonical repository test command is `npm test`; it builds standalone output then runs all tracked Node tests. Separate closure gates are `npm run build`, `npm audit --audit-level=moderate`, syntax checks, and `git diff --check`. The repository has no dedicated lint, typecheck, browser E2E, or CI workflow script; do not report absent gates as passing.
- If a test fails, the provider proof fails, required external values are absent, or Sol reports any Critical/Important issue, stop. Do not waive, deploy, or claim production readiness.

---

## Task A — Closed Trusted Active Release and Fail-Closed Agreement

**Files:**
- Modify tests: `tests/software-update.test.mjs`
- Modify implementation: `server/software-update.mjs`
- Preserve route behavior; do not modify: `api/index.mjs`

- [ ] **A1 — Safety baseline.** Run `git status --short`, `git rev-parse HEAD`, `git merge-base --is-ancestor 151acf19e0458a4a999ed0550f14719a9dbff495 HEAD`, and `git branch --show-current`. Stop on unrelated changes, wrong branch, or false ancestry. Run `node --test tests/software-update.test.mjs` and record the baseline summary.
- [ ] **A2 — Replace unsafe fixtures with the frozen closed record.** In `tests/software-update.test.mjs`, create synthetic valid launcher/core component metadata and a canonical release-v2 payload whose `artifact_id`, `artifact_sha256`, `artifact_size`, and `artifact_format` agree with the record. Keep the envelope opaque in manifest responses.
- [ ] **A3 — Add active-record negative tests.** Table-test missing/extra top-level and nested fields; wrong component keys; duplicate artifact IDs; uppercase/wrong-length SHA; zero, negative, fractional, boolean, and over-limit sizes; wrong format/distribution; Launcher storage or Core public URL; unsafe Launcher URLs; unsafe bucket/object identifiers; malformed/noncanonical base64; invalid UTF-8/BOM; duplicate payload keys; trailing JSON; v1/wrong channel/wrong components; and each metadata disagreement. Assert whole-record rejection for both manifest and grant and assert no sensitive value is retained.
- [ ] **A4 — Prove classification cannot fail open.** Add tests where malformed payload bytes, missing Core payload metadata, swapped launcher/core IDs, and payload-derived claims attempt to make trusted Core public. Assert `SOFTWARE_UPDATE_RECORD_INVALID`, never a Launcher grant, and verify classification is the trusted component key when all agreement checks pass.
- [ ] **A5 — Commit tests only.** Run `git add tests/software-update.test.mjs && git commit -m "test(update): specify trusted active release agreement"`.
- [ ] **A6 — Prove genuine RED.** Run `node --test tests/software-update.test.mjs`; require assertion failures demonstrating the old `artifacts` URL map and fail-open payload classification violate the new contract.
- [ ] **A7 — Implement the minimum parser.** In `server/software-update.mjs`, replace `artifacts` parsing with exact `components`, add strict bounded envelope/payload decoding including duplicate-key rejection, validate all frozen metadata and release-v2 agreement, and return an internal immutable normalized record. Keep manifest output as a clone of the envelope only. Do not add Ed25519 verification.
- [ ] **A8 — Prove focused GREEN and regression.** Run `node --test tests/software-update.test.mjs`, then `npm test`, then `git diff --check`.
- [ ] **A9 — Independent Sol blocker review.** Review only Task A's diff for findings 1, 2, and the active-record portion of 6. Require Critical=0 and Important=0.
- [ ] **A10 — Commit implementation.** Run `git add server/software-update.mjs && git commit -m "fix(update): trust closed active release ownership"`.

---

## Task B — Canonical Scoped Capability Registry

**Files:**
- Modify tests: `tests/software-update.test.mjs`
- Modify implementation: `server/software-update.mjs`

- [ ] **B1 — Add token grammar tests.** Cover absent header; wrong/case-changed scheme; multiple spaces/tokens/headers; whitespace; padded, 42/44-character, invalid-alphabet, and noncanonical base64url; and decoded lengths other than 32 bytes. Assert Launcher never requires or parses a capability.
- [ ] **B2 — Add exact-registry tests.** Cover absent/empty/non-array/oversized registry; empty array; non-object entry; duplicate keys; missing/extra fields; uppercase/malformed digest; wrong channel; empty/duplicate/oversized/invalid artifact scope; malformed/non-UTC/fractional/past/equal expiry; invalid clock; non-boolean or wrong `enabled`/`revoked`; and one malformed entry beside one valid entry. Every malformed registry must fail closed, not skip.
- [ ] **B3 — Add authorization behavior tests.** Use deterministic synthetic 32-byte tokens and injected time. Prove exact token + beta + explicit Core artifact scope + future expiry + `enabled:true` + `revoked:false` succeeds; unknown digest, expired, disabled, revoked, channel mismatch, and out-of-scope fail. Spy on `crypto.timingSafeEqual` through a focused injectable/internal seam if direct observation is otherwise brittle; assert byte comparison and ensure raw token/digest/sentinels are absent from all safe error representations.
- [ ] **B4 — Commit tests only.** Run `git add tests/software-update.test.mjs && git commit -m "test(update): specify strict distribution capabilities"`.
- [ ] **B5 — Prove genuine RED.** Run `node --test tests/software-update.test.mjs`; require assertion failures against permissive token and registry behavior.
- [ ] **B6 — Implement strict authorization.** In `server/software-update.mjs`, add canonical token decoding, exact bounded registry parsing with duplicate-key rejection, strict timestamp checks, exact scope/channel/revocation checks, and SHA-256 byte comparison through `crypto.timingSafeEqual`. Parse no registry for Launcher; parse and authorize before any Core signer call.
- [ ] **B7 — Prove focused GREEN and regression.** Run `node --test tests/software-update.test.mjs`, then `npm test`, then `git diff --check`.
- [ ] **B8 — Independent Sol blocker review.** Review only Task B's diff for finding 3 and its negative-test coverage under finding 6. Require Critical=0 and Important=0.
- [ ] **B9 — Commit implementation.** Run `git add server/software-update.mjs && git commit -m "fix(update): enforce scoped distribution capabilities"`.

---

## Task C — Private Supabase Core Signer and HTTP Integration

**Files:**
- Modify tests: `tests/software-update.test.mjs`
- Modify tests: `tests/vercel-api.test.mjs`
- Modify implementation: `server/supabase.mjs`
- Modify implementation: `server/software-update.mjs`
- Modify route only if dependency injection requires it: `api/index.mjs`

- [ ] **C1 — Add signer unit-contract tests.** In `tests/software-update.test.mjs`, inject a signer spy and prove trusted Core calls it exactly once with exact configured bucket/object and TTL `120`, only after full record and capability validation. Prove Launcher, unknown IDs, malformed records, and every auth failure call it zero times. Reject signer throw/error, non-string URL, HTTP URL, userinfo, missing host, or fragment with a generic safe error that retains no provider detail, bucket/object, service key, token, digest, or URL.
- [ ] **C2 — Add Supabase wrapper tests.** Use a focused injected/mock Storage client seam in `server/supabase.mjs` rather than network. Assert `.storage.from(bucket).createSignedUrl(object, 120)` exact call order/arguments, TTL range rejection, accepted Supabase `{data:{signedUrl},error:null}` shape, generic provider-error translation, and no logging of sensitive values.
- [ ] **C3 — Replace unsafe grant expectations.** Assert both Launcher and Core responses have exact keys `url`/`expires_at` and expiry exactly `now + 120 seconds`; Launcher URL is trusted `public_url`; Core URL is provider signed. Remove all ten-minute/static-Core assertions.
- [ ] **C4 — Extend HTTP integration.** In `tests/vercel-api.test.mjs`, update the active-record fixture, release-v2 payload, and fake Supabase server/client seam. Prove manifest stays public; anonymous Launcher grant succeeds for 120 seconds without signer use; anonymous Core is 401; malformed/invalid/revoked Core authorization is denied before Storage; valid Core authorization returns a synthetic HTTPS signed URL; Authorization is forwarded only to grant authorization logic and never exposed in response/logging. Preserve exact `{artifact_id}` body validation and existing no-secret response assertions.
- [ ] **C5 — Commit tests only.** Run `git add tests/software-update.test.mjs tests/vercel-api.test.mjs && git commit -m "test(update): specify private core signed grants"`.
- [ ] **C6 — Prove genuine RED.** Run `node --test tests/software-update.test.mjs tests/vercel-api.test.mjs`; require assertion failures for absent Storage signing, static Core URL, and ten-minute expiry.
- [ ] **C7 — Implement the Supabase signer.** Export `createPrivateStorageSignedGetUrl` from `server/supabase.mjs` using the existing `supabaseAdmin`; implement exact TTL and signed URL validation with generic errors and no logs. Do not add dependencies or create another client.
- [ ] **C8 — Make grants asynchronous.** In `server/software-update.mjs`, import the wrapper, freeze TTL at 120, implement the injectable signer signature, authorize Core before signing, and compute expiry from the exact injected `now` and TTL. Keep Launcher anonymous and signer-free. `api/index.mjs` already awaits the result; modify it only if a test-only composition seam is strictly necessary, without changing public routes.
- [ ] **C9 — Prove focused GREEN and regression.** Run `node --test tests/software-update.test.mjs tests/vercel-api.test.mjs`, then `npm test`, then `git diff --check`.
- [ ] **C10 — Independent Sol blocker review.** Review only Task C's diff for findings 4, 5's application-side portion, and 6. Require Critical=0 and Important=0, including proof that caller input cannot choose bucket/object and no Core static/public fallback remains.
- [ ] **C11 — Commit implementation.** Run `git add server/supabase.mjs server/software-update.mjs api/index.mjs && git commit -m "feat(update): issue private supabase core grants"`; omit `api/index.mjs` from `git add` if unchanged.

---

## Task D — Opt-In Provider Proof and Runtime Contract

**Files:**
- Create: `scripts/verify-software-update-provider.mjs`
- Create: `tests/software-update-provider.test.mjs`
- Create: `docs/current/software-update-production-runtime.md`
- Modify scripts only if required to expose an explicit opt-in command: `package.json`

**Opt-in interface:** The harness is skipped unless `NEKO_SOFTWARE_UPDATE_PROVIDER_PROOF=1`. It reads external `NEKO_SOFTWARE_UPDATE_PROOF_ANONYMOUS_URL`, `NEKO_SOFTWARE_UPDATE_PROOF_SIGNED_URL`, and `NEKO_SOFTWARE_UPDATE_PROOF_EXPIRES_AT`; these are runtime proof inputs and must never be committed or printed. The URLs must identify the same Owner-approved immutable Core object through anonymous and signed access paths. The harness performs GET only, uses no service-role key, disables redirect following, applies bounded timeout/body reads, and emits only named pass/fail checks.

- [ ] **D1 — Write static/offline harness tests first.** In `tests/software-update-provider.test.mjs`, spawn the harness with no opt-in and assert an explicit skip with zero network. Start a local HTTP fixture and opt in with synthetic values to prove: anonymous GET must return 401/403/404; signed GET succeeds before expiry; redirect is rejected; body is bounded; after `expires_at` plus a bounded clock allowance the same signed URL returns 401/403/404; and output contains none of the URLs/query tokens. Use short synthetic expiry locally so the test remains bounded.
- [ ] **D2 — Add runtime-document assertions.** Test that `docs/current/software-update-production-runtime.md` names `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON`, and `DISTRIBUTION_CAPABILITIES_JSON`; reproduces the exact schemas and 120-second rule; requires private Core bucket/object and no anonymous/CDN origin; defines rotation/revocation; and says malformed/absent required production configuration fails closed and live proof is mandatory before deploy. Assert it does not contain fixture or production secret values.
- [ ] **D3 — Commit tests only.** Run `git add tests/software-update-provider.test.mjs && git commit -m "test(update): specify provider readiness proof"`.
- [ ] **D4 — Prove genuine RED.** Run `node --test tests/software-update-provider.test.mjs`; require assertion-level failures for the absent harness/docs behavior, not merely module-not-found collection failure. Seed the test with an executable placeholder path only if needed to obtain assertion-level RED, then keep that placeholder in the tests-only commit without implementing proof behavior.
- [ ] **D5 — Implement the proof harness.** Create `scripts/verify-software-update-provider.mjs` with the exact opt-in interface, no default internet access, GET-only behavior, `redirect:"manual"`, bounded `AbortSignal.timeout`, bounded streamed response consumption, expiry wait, generic output, and nonzero exit on any proof failure. A successful pre-expiry signed GET plus post-expiry denial and direct anonymous denial are all mandatory.
- [ ] **D6 — Document production runtime.** Create `docs/current/software-update-production-runtime.md` with the frozen active-record and registry contracts; Vercel Node 24; existing Supabase service-role environment contract; private bucket/RLS/policy expectation; immutable Core object and no alternate public origin; exact 120-second TTL; capability generation outside Git, scope, expiry, rotation, immediate new-grant revocation, and residual signed-URL lifetime; fail-closed startup/request behavior; safe rollback order; and the exact opt-in proof command. State clearly that local/fake tests are not hosted proof and production deployment is not yet performed.
- [ ] **D7 — Expose one explicit command if useful.** If adding a package script, use exact name `verify:software-update-provider` with value `node scripts/verify-software-update-provider.mjs`; do not fold live proof into `npm test` or make default tests access the network.
- [ ] **D8 — Prove focused GREEN and regression.** Run `node --test tests/software-update-provider.test.mjs`, `npm test`, `npm run build`, `npm audit --audit-level=moderate`, `node --check scripts/verify-software-update-provider.mjs server/software-update.mjs server/supabase.mjs api/index.mjs tests/software-update.test.mjs tests/software-update-provider.test.mjs tests/vercel-api.test.mjs`, and `git diff --check`. Run `npm run verify:software-update-provider` without opt-in if the script was added and require explicit skip with no network.
- [ ] **D9 — Independent Sol blocker review.** Review Task D plus the cumulative A-D tree for finding 5's provider-proof portion and finding 7. Require Critical=0 and Important=0. Confirm no production values, network-by-default tests, deployment claim, or secret-bearing output.
- [ ] **D10 — Commit implementation/docs.** Run `git add scripts/verify-software-update-provider.mjs docs/current/software-update-production-runtime.md package.json && git commit -m "docs(update): add provider readiness gate"`; omit `package.json` if unchanged.

Tasks A-D end here with engineering evidence only. They do not deploy or mutate production.

---

## Task E — Final Regression, C0/I0 Review, Push, and Explicit Production Gate

### E1 — Local closure and review

- [ ] Confirm `git status --short` contains only expected generated-output behavior and no uncommitted source changes. Run `npm test` twice; the second run proves generated standalone output is current. Report authoritative Node test summary counts, not grep-derived counts.
- [ ] Run `npm run build`, `npm audit --audit-level=moderate`, syntax-check every tracked `.mjs`/`.js` with `git ls-files -z '*.mjs' '*.js' | xargs -0 -n1 node --check`, and run `git diff --check`.
- [ ] Run focused suites separately: `node --test tests/software-update.test.mjs tests/software-update-provider.test.mjs tests/vercel-api.test.mjs`.
- [ ] Perform an independent Sol readiness review against all seven supplied findings, the frozen contracts in this plan, and `E:\Github\Project manager\OWNER_GATE_2_PRODUCTION_PACKAGE.md`. Require a written Critical=0 / Important=0 result. Minor findings do not authorize scope expansion unless they invalidate a blocking contract.
- [ ] If review changes are needed, repeat the relevant task's tests-first cycle and narrow commits; then rerun all E1 gates. Do not proceed with any Critical or Important finding.

### E2 — Commit and push engineering readiness

- [ ] Confirm the planned commit sequence contains independently reviewable tests and implementation commits and no production values: `git log --oneline 151acf19e0458a4a999ed0550f14719a9dbff495..HEAD` and `git diff --stat 151acf19e0458a4a999ed0550f14719a9dbff495..HEAD`.
- [ ] If final review evidence required a documentation-only adjustment, commit only that adjustment with `git add docs/current/software-update-production-runtime.md docs/superpowers/plans/2026-09-07-software-update-admin-production-readiness.md && git commit -m "docs(update): close production readiness review"`.
- [ ] Fetch without merging: `git fetch origin`. Require `git rev-list --left-right --count origin/main...HEAD` to show zero behind before push; if not, stop for an explicit integration decision rather than rebasing or merging automatically.
- [ ] Push only this feature branch: `git push -u origin feature/software-update-phase2-control-plane`. Do not merge, tag, release, or deploy. Verify the exact remote branch afterward with `git rev-parse HEAD` and `git ls-remote --heads origin refs/heads/feature/software-update-phase2-control-plane`; hashes must match.

### E3 — Owner-supplied production prerequisites

Do not begin provisioning until C0/I0 and the verified push are complete. Obtain values privately; never paste them into Git, review text, shell history, or logs.

- [ ] Owner-approved immutable Launcher `artifact_id`, `sha256`, `size`, `format=raw-pe-v1`, `distribution=public-launcher`, and query-free HTTPS `public_url` match candidate evidence.
- [ ] Owner-approved immutable Core `artifact_id`, `sha256`, `size`, `format=zip-core-v1`, `distribution=controlled-core`, private Supabase bucket, immutable object path/version, and canonical Core identity match Owner Gate #2 authority.
- [ ] Owner-approved signed release-v2 envelope agrees exactly with both trusted component records, and client production public-key/keyset provisioning is separately complete. Admin does not replace client signature verification.
- [ ] Owner-approved 32-byte capability exists through the licensed delivery path, and only its lowercase SHA-256 digest is supplied privately for server registry configuration with exact beta channel, explicit Core artifact scope, future UTC-seconds expiry, `enabled:true`, and `revoked:false`.
- [ ] Supabase Storage policy evidence shows the Core bucket/object is private, service-role signing is permitted, direct anonymous access is denied, no public bucket/CDN/alternate object URL exists, signed access is GET-only for the exact immutable object, and no overwrite can change that object identity.
- [ ] Vercel production environment authority supplies `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON`, and `DISTRIBUTION_CAPABILITIES_JSON` through protected settings. Validate the exact JSON offline with the production parser before any deployment; malformed or absent values stop the gate.

If any external value or evidence is absent, inconsistent, mutable, public, or unapproved, STOP. Engineering readiness remains valid but production deployment is not authorized.

### E4 — Explicit production provisioning/deployment checklist

These steps are a later Owner-authorized operation, not engineering Tasks A-D. Execute them only after E3 is complete and the Owner explicitly authorizes Admin enforcement deployment.

- [ ] Record the Owner authorization reference and exact reviewed feature commit without recording secrets.
- [ ] Privately upload/stage the approved immutable Core object in the approved private bucket; verify object hash/size/version through provider metadata and a downloaded authenticated copy without exposing its URL.
- [ ] Verify direct anonymous GET denial before deploy using the exact Core anonymous object path and no credentials. Any 2xx/3xx is a blocker.
- [ ] Configure the protected active-release and capability-registry environment values, setting every field explicitly; do not rely on provider defaults.
- [ ] Deploy only the reviewed commit to the approved private production Admin project. Do not merge, tag, release, activate a release, or provision the client capability as part of this deploy unless separately authorized in Owner Gate order.
- [ ] Read back deployment identity and protected setting metadata (names/version/presence only, never values) and verify they point to the intended project and reviewed commit.
- [ ] Obtain a signed URL through the deployed grant endpoint using the privately held capability. Run `NEKO_SOFTWARE_UPDATE_PROVIDER_PROOF=1` with the three external proof inputs and `npm run verify:software-update-provider` (or `node scripts/verify-software-update-provider.mjs` if no package script). Require anonymous denial, signed GET success before expiry, and denial after exact expiry; retain only secret-free pass/fail evidence.
- [ ] Verify public manifest remains anonymous and exactly returns the approved envelope; anonymous Launcher grant succeeds with 120-second response expiry; Core without capability is 401; malformed/unknown/out-of-scope/expired/disabled/revoked capabilities are denied; and provider/service details are absent from responses/logs.
- [ ] Exercise registry revocation by changing the approved entry to `revoked:true`, read back configuration metadata, verify new Core grants fail immediately, and verify any prior signed URL becomes unusable no later than its 120-second expiry. Restore/rotate only with explicit Owner authorization and a new reviewed registry value.
- [ ] Obtain a post-deploy Sol review of actual secret-free runtime evidence. Require Critical=0 and Important=0 before marking Admin enforcement ready for the next Owner Gate step.
- [ ] Hand control back to the ordered Owner checklist in `OWNER_GATE_2_PRODUCTION_PACKAGE.md`: Admin deployment alone does not authorize active-release activation, client capability provisioning, installer build, Gate #3, merge, tag, or publication.

---

## Final Acceptance / STOP

- [ ] All seven original findings are closed by tests, implementation, documentation, and—only after authorization—real provider evidence.
- [ ] Active-record ownership is closed and classification cannot derive from untrusted payload bytes.
- [ ] Core has no public URL or anonymous alternate origin; every grant is exact-object, capability-authorized, Supabase-signed, and expires in at most 120 seconds.
- [ ] Capability parsing, registry validation, scope, expiry, enabled/revoked state, and constant-time digest comparison fail closed.
- [ ] Default tests perform no internet access; provider proof is explicit, executable, and secret-safe.
- [ ] Full regression and final independent review are Critical=0 / Important=0.
- [ ] No claim of production deployment is made until E3/E4 have real Owner-supplied values, explicit deployment authorization, deployed-commit readback, and passing provider proof.
- [ ] STOP before merge, tag, release, active-release activation, installer build, or Gate #3 unless separately authorized by the Owner.
