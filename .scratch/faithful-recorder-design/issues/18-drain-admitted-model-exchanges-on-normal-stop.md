# 18 — Drain admitted Model Exchanges on normal stop

**What to build:** A human can stop the Recorder normally and know that admission has closed while every already-admitted Model Exchange is allowed to finish forwarding and artifact finalization before the process exits.

**Blocked by:** 17 — Honor the HTTP/1.1 connection contract.

**Status:** ready-for-agent

- [ ] The supported normal-stop path closes the listening boundary so no new Model Exchange can be admitted.
- [ ] If normal stop begins while a Model response remains incomplete, the Harness still receives the complete response and all request, response, trailer, and body artifact data is finalized before exit.
- [ ] Multiple already-admitted Model Exchanges are all drained before the upstream Agent and remaining process resources close.
- [ ] Previously completed and saved exchanges remain present after normal stop, with no completion marker or persistent lock added to the artifact.
- [ ] Stopping before Harness Session acquisition creates no session artifact.
- [ ] Assembled-process tests exercise in-flight shutdown, rejection of later admission, retention of prior exchanges, deterministic process exit, and the no-acquisition case.

