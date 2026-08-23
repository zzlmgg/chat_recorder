# 17 — Honor the HTTP/1.1 connection contract

**What to build:** The Recorder supports repeated and long-lived HTTP/1.1 Model Exchanges without forcing a new connection for each exchange or truncating a quiet but valid SSE response.

**Blocked by:** 14 — Preserve and relay the Model response envelope; 16 — Persist overlapping Model Exchanges in admission order.

**Status:** ready-for-agent

- [ ] Multiple sequential Model Exchanges can reuse one Harness-side HTTP/1.1 connection.
- [ ] A bounded shared upstream Agent demonstrably reuses a Model-side HTTP/1.1 connection for sequential exchanges.
- [ ] Idle-truncating request and header timeouts are disabled so a controlled long-lived response can remain open and later complete successfully.
- [ ] A non-HTTP/1.1 Harness request receives `505` and cannot acquire a Harness Session or create a Model Exchange entry.
- [ ] Both HTTP and HTTPS upstream base URLs use HTTP/1.1 only; HTTPS relies on the platform's ordinary system CA validation without bypass or custom trust behavior.
- [ ] Tests cover keep-alive and long-lived-stream behavior synthetically without requiring an external service or asserting runtime chunk boundaries.

