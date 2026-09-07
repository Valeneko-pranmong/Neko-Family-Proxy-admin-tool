# Software update production runtime contract

## Runtime and protected configuration

Deploy the Admin API on Vercel Node 24. The protected runtime variables are `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON`, and `DISTRIBUTION_CAPABILITIES_JSON`. Values remain outside Git and must never be printed, logged, or read back. Malformed required production configuration fails closed. Absent required production configuration fails closed. Provider errors and details remain generic.

## Exact trusted active-release parser contract

`SOFTWARE_UPDATE_ACTIVE_RELEASE_JSON`, when nonempty, is one JSON value with a maximum of 131072 characters. An absent value or a value whose string form trims to empty is the explicit no-release state; it is not a valid configured release. A configured value must be an object whose exact top-level keys are `channel`, `envelope`, `components`, with `channel` exactly `beta`. Parsing rejects duplicate keys before object construction and rejects trailing or additional JSON values.

The envelope exact keys are `envelope_version`, `key_id`, `payload_b64`, `signature_b64`. `envelope_version` must be `1`. `key_id` must match `[A-Za-z0-9._-]{1,64}`. Both `payload_b64` and `signature_b64` must be nonempty canonical standard base64 whose decode and re-encode round-trip is identical and whose padding is the required standard padding where applicable. `signature_b64` has a decoded maximum of 4096 bytes. `payload_b64` has a decoded maximum of 65536 bytes. The decoded payload must be strict valid UTF-8 without BOM. It must contain exactly one JSON value, and duplicate-key rejection applies at every object depth.

The complete record shape is:

```
{
  "channel": "beta",
  "components": {
    "launcher": {
      "artifact_id": "<matches [A-Za-z0-9._-]{1,96}>",
      "format": "raw-pe-v1",
      "distribution": "public-launcher",
      "sha256": "<matches [0-9a-f]{64}>",
      "size": "<integer 1..134217728>",
      "public_url": "<absolute HTTPS URL>"
    },
    "core": {
      "artifact_id": "<matches [A-Za-z0-9._-]{1,96}>",
      "format": "zip-core-v1",
      "distribution": "controlled-core",
      "sha256": "<matches [0-9a-f]{64}>",
      "size": "<integer 1..1073741824>",
      "storage": {
        "bucket": "<matches [A-Za-z0-9][A-Za-z0-9._-]{0,62}>",
        "object": "<safe immutable object identifier>"
      }
    }
  },
  "envelope": {
    "envelope_version": 1,
    "key_id": "<matches [A-Za-z0-9._-]{1,64}>",
    "payload_b64": "<canonical standard base64>",
    "signature_b64": "<canonical standard base64>"
  }
}
```

The launcher exact keys are `artifact_id`, `format`, `distribution`, `sha256`, `size`, `public_url`. The core exact keys are `artifact_id`, `format`, `distribution`, `sha256`, `size`, `storage`; the storage exact keys are `bucket`, `object`. No additional or missing key is accepted. Every `artifact_id` matches `[A-Za-z0-9._-]{1,96}`. Every `sha256` matches lowercase `[0-9a-f]{64}`. Launcher size is an integer in 1..134217728; Core size is an integer in 1..1073741824. The exact pairs are `raw-pe-v1` with `public-launcher`, then `zip-core-v1` with `controlled-core`. Launcher `artifact_id` must differ from Core `artifact_id`.

Launcher `public_url` must be an absolute HTTPS URL with a hostname, no userinfo, no query, and no fragment. Core has no `public_url`; Launcher has no `storage`.

The bucket grammar is `[A-Za-z0-9][A-Za-z0-9._-]{0,62}`. The object total length is 1..512 ASCII characters and is slash-delimited into nonempty segments. Each object segment matches `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`; reject empty, dot `.`, and dotdot `..` segments. Consequently leading/trailing slash, `//`, backslash, percent escapes, controls, whitespace, query, and fragment are rejected. Bucket and object are immutable trusted identifiers, never caller-selected paths.

## Exact decoded release-v2 payload and trusted agreement

The decoded release-v2 payload has exact keys `schema_version`, `channel`, `release_sequence`, `release_id`, `mandatory`, `minimum_supported_sequence`, `updater_protocol`, `components`:

```
{
  "schema_version": 2,
  "channel": "beta",
  "release_sequence": "<integer >= 1>",
  "release_id": "<matches [A-Za-z0-9._-]{1,96}>",
  "mandatory": "<boolean>",
  "minimum_supported_sequence": "<integer >= 1 and <= release_sequence>",
  "updater_protocol": {
    "minimum": "<integer >= 1>",
    "maximum": "<integer >= minimum>"
  },
  "components": {
    "launcher": "<payload component>",
    "core": "<payload component>"
  }
}
```

`schema_version` must be `2` and `channel` must be `beta`. `release_sequence` must be an integer >= 1. `release_id` must match `[A-Za-z0-9._-]{1,96}`. `mandatory` must be boolean. `minimum_supported_sequence` must be an integer >= 1 and <= `release_sequence`. `updater_protocol` has exact keys `minimum`, `maximum`; both are integer values, `minimum` is >= 1, and `maximum` is >= `minimum`. Payload `components` has exact keys `launcher`, `core`.

Each payload component (`launcher` and `core`) has exact keys `version`, `artifact_id`, `artifact_sha256`, `artifact_size`, `installed_identity_sha256`, `artifact_format`. `version` is a string with length 1..64. `installed_identity_sha256` matches `[0-9a-f]{64}`. Each payload component must exactly agree with its trusted record component: `artifact_id` equals record `artifact_id`; `artifact_sha256` equals record `sha256`; `artifact_size` equals record `size`; and `artifact_format` equals record `format`.

Ownership and distribution are fixed by the trusted record component key: `launcher` means `public-launcher`, and `core` means `controlled-core`. The signed payload does not add a `distribution` field and cannot select ownership, location, or weaker access. Classification and location never derive from decoded bytes. Any decoding, duplicate, schema, component, mapping, or trusted-record agreement failure rejects the entire record as `SOFTWARE_UPDATE_RECORD_INVALID`. Server-side Ed25519 verification is deliberately not performed; client signature verification remains mandatory.

## Exact distribution capability parser and authorization contract

`DISTRIBUTION_CAPABILITIES_JSON` text has a maximum of 1048576 characters. It must be a JSON array of 1..1024 entries with duplicate-key rejection before object construction at every depth. Missing, empty, malformed, non-array, or out-of-bound configuration fails closed as `SOFTWARE_UPDATE_RECORD_INVALID`.

Each capability entry has exactly six keys `credential_sha256`, `channel`, `artifact_ids`, `expires_at`, `enabled`, `revoked`:

```
{
  "credential_sha256": "<matches [0-9a-f]{64}>",
  "channel": "beta",
  "artifact_ids": ["<matches [A-Za-z0-9._-]{1,96}>"],
  "expires_at": "<YYYY-MM-DDTHH:mm:ssZ>",
  "enabled": true,
  "revoked": false
}
```

`credential_sha256` matches lowercase `[0-9a-f]{64}`. Capability `channel` matches `[A-Za-z0-9._-]{1,64}`; the production endpoint eligibility value is exactly `beta`. `artifact_ids` is an array of 1..64 unique entries, and every artifact ID matches `[A-Za-z0-9._-]{1,96}`. `expires_at` has exact grammar `YYYY-MM-DDTHH:mm:ssZ` and must pass parse then round-trip to the identical UTC-seconds value (equivalently the parsed ISO form differs only by inserted `.000`). `enabled` is boolean and `revoked` is boolean. One malformed entry invalidates the whole registry rather than being skipped.

The Authorization header is exactly NekoDistribution followed by exactly one ASCII space and one token: one scheme, one space, one token, and no leading/trailing whitespace, padding, second token, or second value. The token matches `[A-Za-z0-9_-]{43}` and is canonical unpadded base64url: decoding produces exactly 32 bytes and re-encoding must produce the identical token.

After validating the injected clock, capability eligibility requires `expires_at > now`, `enabled === true`, `revoked === false`, channel exactly `beta`, and requested Core scope present in `artifact_ids`, plus a matching digest. Compute SHA256 over the decoded token bytes, decode each configured lowercase digest to 32 bytes, and use `crypto.timingSafeEqual` to compare 32-byte digests. Missing header is 401. A malformed header or no eligible match is `DISTRIBUTION_CAPABILITY_INVALID` (403). The raw token, digest, registry, storage identity, signed URL, and service key never appear in responses or logs.

Capabilities are generated outside Git and delivered through the licensed channel. Rotation creates a new token and digest before removing or revoking the old entry. Revocation sets `revoked:true`, so new grants fail immediately. A prior signed URL retains access for at most 120 seconds.

## Private immutable Core storage and grants

The Core Supabase Storage bucket and exact versioned object are private and immutable. Service-role signing only is permitted through the existing client configured by `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. There is no anonymous Core access, no public bucket, no CDN, no alternate public origin, and no static/public Core fallback. Signed access is GET-only for the exact trusted object; caller input never chooses bucket or object.

The exact Core signed-URL TTL is 120 seconds. A valid Core request authorizes the capability before calling the signer exactly once with trusted `bucket`, trusted `object`, and `120`. Grant `expires_at` is request time plus exactly 120 seconds. Launcher remains anonymous and signer-free, returning only its trusted query-free public HTTPS URL with the same response-expiry calculation. Invalid record, clock, authorization, signer failure, or unsafe provider URL produces no grant.

## Failure and safe rollback order

All parsing and authorization are fail-closed. Requests and startup paths that encounter malformed or absent required production configuration fail closed. Responses and logs expose no protected value, provider detail, capability, digest, registry, service key, storage identity, or signed URL.

Safe rollback order is: stop activation or new grants; set the affected capability to `revoked:true`; restore the last reviewed protected configuration and deployment; verify configuration-name and deployment-identity metadata without reading values; repeat anonymous-denial and signed-expiry proof; then re-enable only after approval. Never make Core public as rollback.

## Mandatory hosted-provider proof

The proof inputs must identify the same Owner-approved immutable Core through its anonymous and signed paths. Obtain a signed URL whose lifetime is no more than 120 seconds and run exactly:

```
NEKO_SOFTWARE_UPDATE_PROVIDER_PROOF=1 \
NEKO_SOFTWARE_UPDATE_PROOF_ANONYMOUS_URL='<external HTTPS URL>' \
NEKO_SOFTWARE_UPDATE_PROOF_SIGNED_URL='<external HTTPS URL>' \
NEKO_SOFTWARE_UPDATE_PROOF_EXPIRES_AT='<external UTC timestamp>' \
node scripts/verify-software-update-provider.mjs
```

The proof performs GET only, follows no redirects, uses bounded timeout/body reads, and uses no service-role key. It must prove direct anonymous denial, signed success before expiry, and denial of the same URL after expiry. It prints named checks only and never prints URLs or query tokens.

Fake/local tests are NOT hosted proof. Live proof is mandatory before deploy. Production deployment has NOT yet occurred, and this document makes no deployment or production-readiness claim. No production value, secret, capability, digest, bucket name, object identity, or signed URL belongs in this document or Git.
