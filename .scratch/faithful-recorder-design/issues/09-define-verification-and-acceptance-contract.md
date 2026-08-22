# Define end-to-end verification and acceptance contract

Type: grilling
Status: resolved
Blocked by: 03, 04, 05, 06, 07, 08

## Question

What automated fixtures and live acceptance scenarios prove that every Model Exchange for the locked Harness Session is recorded in order with byte-identical plaintext HTTP content while Claude Code CLI and VS Code still receive the Model's streamed responses?

## Note from 07

The stack decision (Node.js ≥22, zero dependencies, `node:test`, fixture replay) makes automated acceptance feasible. Upstream keep-alive was not exercised by the captured target-stack fixture and should be covered by this contract.

## Answer

Two layers, both fully automated — no human interaction is required anywhere.

**Layer 1: automated byte-level replay tests** (`node:test` against the captured fixture)

- Truth is the target-stack fixture (ticket 10): the exact request/response entity bytes captured from both entrypoints, with `manifest.json` hashes as assertions.
- Two test-side facilities: a harness-side driver that replays the captured request bytes into the Recorder's listen socket, and a mock upstream that receives the forwarded request and replays the captured response bytes with controlled slow chunking.
- Byte fidelity (per ticket 03, both directions): the entity bytes the Recorder receives from the harness must equal the bytes it forwards upstream, bit for bit; the entity bytes it receives from the mock upstream must equal the bytes it relays back to the harness. Same assertion on the artifacts: `request.body` / `response.body` equal the captured bytes, and `request.json` / `response.json` preserve start-line fields plus ordered, duplicate-preserving headers and trailers exactly as captured. `upstream-request.json` must enumerate the routing-envelope differences (host, joined upstream target, hop-by-hop changes).
- Ordering (per tickets 04/05): `index.json` lists exchanges in admission order; a count_tokens-style auxiliary request (no usable session header) neither locks the session nor produces an exchange directory.
- Streaming still works (per tickets 03/07): the mock upstream sends the response in slow chunks; the harness side must receive its first bytes before the response entity completes. No wall-clock latency assertions.
- Normal-stop semantics (per ticket 04): after the stop signal, no new requests are recorded, an already-admitted incomplete exchange is written to completion, and everything already saved is retained.
- Synthetic scenarios the captured fixture cannot provide: upstream keep-alive serving several consecutive exchanges on one connection (explicitly required by 07 — the fixture forced `Connection: close`), and a zero-length entity (per 05, `.body` must still exist). Delivery-chunk boundaries are deliberately NOT asserted (03 keeps them outside the fidelity boundary); the fixture's chunk records remain documentation only.
- Pass condition: every assertion above passes.

**Layer 2: live acceptance on the real stack (automated drive, no UI)**

- Scenario CLI: run `claude -p "<prompt>"` non-interactively with `ANTHROPIC_BASE_URL` pointed at the Recorder's listen socket (ticket 06 contract).
- Scenario VS Code entrypoint: no VS Code window is opened. Drive the byte-identical native executable shipped inside the installed extension with the launcher environment established by the extension code (`CLAUDE_CODE_ENTRYPOINT=claude-vscode`, `MCP_CONNECTION_NONBLOCKING=true`, `CLAUDE_CODE_ENABLE_TASKS=0`) — the exact method already proven by the ticket-10 capture. Both surfaces keep the cc-switch Recorder Profile selected.
- Each scenario starts from a fresh session (so the recorded session is the first observed one, per ticket 04's lock).
- Assertions: the client completes normally with the streamed response, and the artifact is well-formed (session-named directory, `index.json`, complete exchange files). No independent truth exists for live bytes — byte fidelity is proven entirely by Layer 1; the live capture is retained as a future fixture but does not auto-upgrade ticket 08's Verified table.
- Pass condition: Layer 1 all green, then both live scenarios run and are recorded.
