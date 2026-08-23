# 18 — Drain admitted Model Exchanges on normal stop

**What to build:** A human can stop the Recorder normally and know that admission has closed while every already-admitted Model Exchange is allowed to finish forwarding and artifact finalization before the process exits.

**Blocked by:** 17 — Honor the HTTP/1.1 connection contract.

**Status:** resolved

- [x] The supported normal-stop path closes the listening boundary so no new Model Exchange can be admitted.
- [x] If normal stop begins while a Model response remains incomplete, the Harness still receives the complete response and all request, response, trailer, and body artifact data is finalized before exit.
- [x] Multiple already-admitted Model Exchanges are all drained before the upstream Agent and remaining process resources close.
- [x] Previously completed and saved exchanges remain present after normal stop, with no completion marker or persistent lock added to the artifact.
- [x] Stopping before Harness Session acquisition creates no session artifact.
- [x] Assembled-process tests exercise in-flight shutdown, rejection of later admission, retention of prior exchanges, deterministic process exit, and the no-acquisition case.

## Answer

`SIGINT` and `SIGTERM` move the Recorder into draining state before closing its listening boundary. Requests that arrive afterward on an already-open HTTP/1.1 connection receive a local `503 Service Unavailable` with connection close, so the stop boundary cannot forward an unrecorded Model Exchange. Requests admitted before that transition keep their upstream connection, Harness response, and artifact sinks alive until the complete exchange has finalized; only then is the shared upstream Agent destroyed and the process allowed to exit.

Assembled-process coverage completes and saves one earlier exchange, holds two admitted Model responses open across normal stop, attempts a later request over an existing Harness connection, and releases the admitted responses independently. It proves the process remains alive until both complete, the Harness receives the full bodies and trailers, all five exchange files are finalized in admission order, the earlier exchange remains, the later request never reaches the Model or index, and no completion or lock file appears. A separate `SIGTERM` scenario proves stopping before Harness Session acquisition leaves the output root empty.
