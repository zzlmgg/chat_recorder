# 14 — Preserve and relay the Model response envelope

**What to build:** A Harness receives the Model's application-level HTTP response while an artifact consumer can recover the complete response envelope observed at Model ingress after upstream TLS termination.

**Blocked by:** 12 — Stream opaque Model Exchange entities byte-for-byte.

**Status:** ready-for-agent

- [ ] Recorded response metadata preserves the Model's HTTP version, numeric status, reason phrase, and ordered, duplicate-preserving header and trailer pairs with original field-name casing.
- [ ] Unknown end-to-end response fields and trailers reach the Harness without a closed allowlist or semantic transformation.
- [ ] Only hop-by-hop response fields and transfer details required by the Harness-side HTTP/1.1 hop may differ from the Model-ingress observation.
- [ ] Response metadata is finalized with the complete ordered trailer list before the admitted Model Exchange is considered complete.
- [ ] Assembled-process tests cover a non-default reason phrase, duplicate response fields, connection-nominated hop-by-hop fields, and response trailers while asserting the Harness-visible envelope.

