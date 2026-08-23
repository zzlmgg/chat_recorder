# 19 — Replay both captured Harness fixtures end-to-end

**What to build:** Maintainers can run an offline byte-level acceptance suite that replays the captured CLI and `claude-vscode` Model Exchanges through the assembled Recorder and proves forwarding, recording, streaming, and envelope fidelity against measured target-stack truth.

**Blocked by:** 18 — Drain admitted Model Exchanges on normal stop.

**Status:** resolved

- [x] The suite validates every fixture payload against its manifest SHA-256 before replay.
- [x] Both the `sdk-cli` and `claude-vscode` surfaces are replayed through the Recorder's real listen socket against a controlled Model, with redacted credential values replaced by deterministic synthetic values.
- [x] Request assertions compare the fixture entity, Model-received entity, and recorded entity byte-for-byte; response assertions compare the Model-emitted entity, Harness-received entity, and recorded entity byte-for-byte.
- [x] Assertions cover source request and response metadata, actual upstream request metadata, the joined base-path target, end-to-end fields, and the complete permitted set of routing and hop-by-hop differences.
- [x] The controlled Model emits captured SSE entities incrementally, and the Harness observes an initial prefix before completion.
- [x] Fixture delivery chunks, timing, transfer framing, TLS records, and TCP segmentation remain diagnostic evidence and are not equality assertions.
- [x] The full replay suite runs with the built-in test runner and requires no external services, live credentials, or third-party packages.

## Answer

The built-in `node:test` suite now replays both manifest-listed target-stack captures through separate assembled Recorder processes and controlled loopback Models. Before either replay begins, it verifies every capture metadata file and request/response entity against the SHA-256 values in `manifest.json`, then replaces the redacted authorization and probe values with deterministic 42-byte synthetic values.

Each replay proves the fixture request bytes equal both the Model-received and recorded bytes, and that the captured Model response bytes equal both the Harness-received and recorded bytes. It also checks the complete source request and Model response metadata, the actual upstream envelope and joined `/anthropic/v1/messages?beta=true` target, artifact schema and file set, and the exact HTTP routing and hop-by-hop changes. The Model gates completion after an arbitrary 257-byte SSE prefix so the Harness must observe streaming before completion without treating captured delivery boundaries, timings, transfer chunks, TLS records, or TCP segmentation as equality truth.
