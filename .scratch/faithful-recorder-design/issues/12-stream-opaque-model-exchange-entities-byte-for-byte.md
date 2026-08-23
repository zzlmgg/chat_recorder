# 12 — Stream opaque Model Exchange entities byte-for-byte

**What to build:** A Harness can send an arbitrary request entity and consume an incrementally emitted Model response while the Recorder stores both source entity sequences exactly, without waiting for either complete entity or interpreting its content.

**Blocked by:** 11 — Run one empty Model Exchange through the Recorder.

**Status:** ready-for-agent

- [ ] For a non-empty request, the concatenated bytes supplied by the Harness, received by the Model, and stored in the recording are bit-for-bit identical.
- [ ] For a non-empty response, the concatenated bytes emitted by the Model, received by the Harness, and stored in the recording are bit-for-bit identical.
- [ ] A controlled Model can hold a response open after emitting a prefix, and the Harness observes that prefix before the Model completes the entity without relying on a wall-clock threshold.
- [ ] Deliberately slow network or storage destinations apply backpressure without losing, duplicating, reordering, or whole-entity buffering the source bytes.
- [ ] Binary data, unknown JSON or SSE content, line endings, delimiters, and content encodings pass through and are recorded as opaque bytes without parsing, redaction, decompression, or regeneration.

