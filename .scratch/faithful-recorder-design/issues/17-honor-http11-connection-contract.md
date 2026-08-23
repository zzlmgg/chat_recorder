# 17 — Honor the HTTP/1.1 connection contract

**What to build:** The Recorder supports repeated and long-lived HTTP/1.1 Model Exchanges without forcing a new connection for each exchange or truncating a quiet but valid SSE response.

**Blocked by:** 14 — Preserve and relay the Model response envelope; 16 — Persist overlapping Model Exchanges in admission order.

**Status:** ready-for-agent

- [x] Multiple sequential Model Exchanges can reuse one Harness-side HTTP/1.1 connection.
- [x] A bounded shared upstream Agent demonstrably reuses a Model-side HTTP/1.1 connection for sequential exchanges.
- [x] Idle-truncating request and header timeouts are disabled so a controlled long-lived response can remain open and later complete successfully.
- [x] A non-HTTP/1.1 Harness request receives `505` and cannot acquire a Harness Session or create a Model Exchange entry.
- [x] Both HTTP and HTTPS upstream base URLs use HTTP/1.1 only; HTTPS relies on the platform's ordinary system CA validation without bypass or custom trust behavior.
- [x] Tests cover keep-alive and long-lived-stream behavior synthetically without requiring an external service or asserting runtime chunk boundaries.

## Answer

The Recorder's loopback server keeps HTTP/1.1 connections reusable and disables request, header, and keep-alive idle cutoffs. Sequential upstream requests share a protocol-specific `http.Agent` or `https.Agent` with keep-alive enabled and a 16-socket bound; the stock HTTP(S) transports remain HTTP/1.1-only, and HTTPS uses the platform trust defaults without TLS overrides.

The server rejects parsed HTTP/1.0 requests with `505` before admission. It also handles Node's parser-level cleartext HTTP/2 preface and invalid-version signals explicitly so that syntactically identifiable non-HTTP/1.1 inputs receive `505` instead of Node's default `400`, while retaining `400` for ordinary malformed HTTP.

An assembled-process test sends three sequential Model Exchanges through one Harness connection and observes one reused Model-side connection with HTTP/1.1 on every response and upstream request. Additional synthetic cases hold an SSE response quiet behind an explicit gate before completing it and prove that HTTP/1.0, cleartext HTTP/2, and parser-rejected version inputs neither reach the Model nor create a Harness Session artifact. The tests compare complete entities rather than runtime chunk boundaries and require no external service.
