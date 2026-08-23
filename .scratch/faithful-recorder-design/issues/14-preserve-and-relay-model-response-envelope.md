# 14 — Preserve and relay the Model response envelope

**What to build:** A Harness receives the Model's application-level HTTP response while an artifact consumer can recover the complete response envelope observed at Model ingress after upstream TLS termination.

**Blocked by:** 12 — Stream opaque Model Exchange entities byte-for-byte.

**Status:** resolved

- [x] Recorded response metadata preserves the Model's HTTP version, numeric status, reason phrase, and ordered, duplicate-preserving header and trailer pairs with original field-name casing.
- [x] Unknown end-to-end response fields and trailers reach the Harness without a closed allowlist or semantic transformation.
- [x] Only hop-by-hop response fields and transfer details required by the Harness-side HTTP/1.1 hop may differ from the Model-ingress observation.
- [x] Response metadata is finalized with the complete ordered trailer list before the admitted Model Exchange is considered complete.
- [x] Assembled-process tests cover a non-default reason phrase, duplicate response fields, connection-nominated hop-by-hop fields, and response trailers while asserting the Harness-visible envelope.

## Answer

The assembled Recorder now applies the Model response's closed hop-by-hop field set to both headers and trailers before relaying them across the Harness-side hop. Source response metadata remains independent and lossless, retaining the Model's HTTP version, numeric status, reason phrase, raw ordered headers, and complete raw ordered trailers after entity completion.

An assembled-process test covers a custom status reason, unknown and mixed-casing duplicate response fields, connection-nominated removal, ordered duplicate response trailers, the exact Harness-visible envelope, and the finalized response artifact.
