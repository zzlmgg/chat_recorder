# 12 — Stream opaque Model Exchange entities byte-for-byte

**What to build:** A Harness can send an arbitrary request entity and consume an incrementally emitted Model response while the Recorder stores both source entity sequences exactly, without waiting for either complete entity or interpreting its content.

**Blocked by:** 11 — Run one empty Model Exchange through the Recorder.

**Status:** resolved

- [x] For a non-empty request, the concatenated bytes supplied by the Harness, received by the Model, and stored in the recording are bit-for-bit identical.
- [x] For a non-empty response, the concatenated bytes emitted by the Model, received by the Harness, and stored in the recording are bit-for-bit identical.
- [x] A controlled Model can hold a response open after emitting a prefix, and the Harness observes that prefix before the Model completes the entity without relying on a wall-clock threshold.
- [x] Deliberately slow network or storage destinations apply backpressure without losing, duplicating, reordering, or whole-entity buffering the source bytes.
- [x] Binary data, unknown JSON or SSE content, line endings, delimiters, and content encodings pass through and are recorded as opaque bytes without parsing, redaction, decompression, or regeneration.

## Answer

Added assembled-process coverage for non-empty opaque Model Exchanges through the Recorder's real HTTP/1.1 listen socket and a controlled Model. Event gates prove that request and response prefixes reach both their network destination and artifact body file before their source entity completes, without timing-based streaming assertions.

The same public seam now drives multi-megabyte patterned binary entities through deliberately paused consumers in both directions, observes writable backpressure, and compares the Harness, Model, and recorded byte sequences exactly. The fixtures also cover unknown JSON/SSE-like content, mixed line endings and delimiters, invalid text bytes, and an unrecognized content encoding. The existing tee-on-read relay satisfied these scenarios without a production-code change.
