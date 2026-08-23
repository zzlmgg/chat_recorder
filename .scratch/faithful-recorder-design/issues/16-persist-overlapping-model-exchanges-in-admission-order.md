# 16 — Persist overlapping Model Exchanges in admission order

**What to build:** A Harness Session can contain sequential or overlapping Model Exchanges whose artifact order remains deterministic from request-header admission, regardless of response latency.

**Blocked by:** 15 — Acquire one Harness Session from eligible Messages traffic.

**Status:** ready-for-agent

- [ ] Every admitted Model Exchange receives a monotonically increasing, zero-padded exchange number when its request headers are admitted.
- [ ] The session index lists exchange directories in admission order even when responses complete in a different order.
- [ ] Each exchange directory remains the exclusive pairing boundary for its Harness request, actual upstream request, Model response, and two entity files.
- [ ] Several sequential requests carrying the locked identity remain in one schema-v1 Harness Session artifact without releasing or rotating the lock.
- [ ] An assembled-process test overlaps multiple requests, deliberately completes their responses out of order, and verifies both index order and per-exchange request/response pairing.

