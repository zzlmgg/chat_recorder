# 19 — Replay both captured Harness fixtures end-to-end

**What to build:** Maintainers can run an offline byte-level acceptance suite that replays the captured CLI and `claude-vscode` Model Exchanges through the assembled Recorder and proves forwarding, recording, streaming, and envelope fidelity against measured target-stack truth.

**Blocked by:** 18 — Drain admitted Model Exchanges on normal stop.

**Status:** ready-for-agent

- [ ] The suite validates every fixture payload against its manifest SHA-256 before replay.
- [ ] Both the `sdk-cli` and `claude-vscode` surfaces are replayed through the Recorder's real listen socket against a controlled Model, with redacted credential values replaced by deterministic synthetic values.
- [ ] Request assertions compare the fixture entity, Model-received entity, and recorded entity byte-for-byte; response assertions compare the Model-emitted entity, Harness-received entity, and recorded entity byte-for-byte.
- [ ] Assertions cover source request and response metadata, actual upstream request metadata, the joined base-path target, end-to-end fields, and the complete permitted set of routing and hop-by-hop differences.
- [ ] The controlled Model emits captured SSE entities incrementally, and the Harness observes an initial prefix before completion.
- [ ] Fixture delivery chunks, timing, transfer framing, TLS records, and TCP segmentation remain diagnostic evidence and are not equality assertions.
- [ ] The full replay suite runs with the built-in test runner and requires no external services, live credentials, or third-party packages.

