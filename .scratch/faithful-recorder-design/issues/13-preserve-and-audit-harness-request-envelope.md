# 13 — Preserve and audit the Harness request envelope

**What to build:** An artifact consumer can distinguish the request exactly as observed from the Harness from the request envelope actually sent to the Model, including every permitted routing and connection-level difference.

**Blocked by:** 12 — Stream opaque Model Exchange entities byte-for-byte.

**Status:** ready-for-agent

- [x] Recorded Harness request metadata preserves the source HTTP version, method, original target, and ordered, duplicate-preserving header and trailer pairs with original field-name casing.
- [x] The actual upstream target joins the configured base path with the Harness path while preserving the Harness query, without changing the source target stored in the artifact.
- [x] Authentication and unknown end-to-end request fields and trailers are forwarded as an open ordered list rather than through an application-field allowlist.
- [x] The upstream `Host` names the configured authority, and standard hop-by-hop fields plus fields nominated by `Connection` are handled only as required for the second HTTP hop.
- [x] Upstream-request metadata records the actual method, target, HTTP version, forwarded fields, and trailers, and refers to the exact stored Harness request entity rather than creating a second body copy.
- [x] Assembled-process tests cover duplicate fields, trailers, a prefixed upstream base URL, a query-bearing Messages target, authentication, and connection-nominated hop-by-hop fields.

## Answer

The assembled Recorder now carries request headers and trailers as raw ordered pairs through the second HTTP hop, preserving duplicate field-name casing while filtering standard and `Connection`-nominated hop-by-hop fields. Its upstream audit metadata records the same explicit `Host`, keep-alive, transfer-framing, end-to-end field, and forwarded-trailer envelope that the controlled Model observes, while continuing to refer to the single stored Harness request entity.

An assembled-process test covers a prefixed upstream base URL, query-bearing Messages target, authentication and unknown fields, mixed-casing duplicates, request trailers, and connection-nominated removal. It separately verifies the source Harness metadata, controlled Model observation, upstream-request metadata, and one-copy artifact layout.
