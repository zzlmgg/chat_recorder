# 16 — Persist overlapping Model Exchanges in admission order

**What to build:** A Harness Session can contain sequential or overlapping Model Exchanges whose artifact order remains deterministic from request-header admission, regardless of response latency.

**Blocked by:** 15 — Acquire one Harness Session from eligible Messages traffic.

**Status:** ready-for-agent

- [x] Every admitted Model Exchange receives a monotonically increasing, zero-padded exchange number when its request headers are admitted.
- [x] The session index lists exchange directories in admission order even when responses complete in a different order.
- [x] Each exchange directory remains the exclusive pairing boundary for its Harness request, actual upstream request, Model response, and two entity files.
- [x] Several sequential requests carrying the locked identity remain in one schema-v1 Harness Session artifact without releasing or rotating the lock.
- [x] An assembled-process test overlaps multiple requests, deliberately completes their responses out of order, and verifies both index order and per-exchange request/response pairing.

## Answer

The assembled Recorder test admits three same-session Model Exchanges while all Model responses remain held open, proving that request-header admission has already assigned `exchange-000001` through `exchange-000003` in the schema-v1 index. The controlled Model then completes responses in the deliberate order 2, 3, 1, after which a fourth request proves the Harness Session lock and numbering continue without rotation.

The finalized artifact retains admission order and contains exactly one complete request/upstream-request/response pairing with its two entity files in each exchange directory. Unique request targets, response statuses and reasons, and entity bytes make any cross-exchange pairing error observable.
