# Choose implementation stack and streaming I/O design

Type: grilling
Status: resolved
Blocked by: 03, 05, 06

## Question

Which implementation language, HTTP/TLS libraries, and streaming I/O strategy best preserve the decided protocol bytes and response streaming behavior while keeping the greenfield standalone Recorder small and inspectable?

## Answer

Implement the Recorder in **Node.js with zero third-party dependencies**, `engines >=22` (the host already runs v22.14.0), ESM modules, and the built-in `node:test` runner. Node is the only candidate that satisfies the observation requirement with nothing added: its HTTP parser exposes `rawHeaders`/`rawTrailers`, preserving every header and trailer field's original name, original order, and duplicates, and the captured fixture already exercised this exact seam (its upstream and relayed SSE entity hashes matched). Go's `net/http` canonicalizes header names and loses cross-field order, failing the observation requirement without an extra parser dependency, and its transport auto-decompresses responses; Rust (hyper/httparse) preserves the fields but costs far more implementation effort against the small-and-inspectable goal; Python's standard library is a poor fit for a bidirectional streaming proxy and the host's 3.10 is old.

The proxy is a **hand-rolled two-hop application-HTTP loop on the stock `http` and `https` modules** — explicitly not a framework reverse proxy, which would normalize and reserialize the very envelopes the Recorder must observe unchanged. Modules split small for inspectability and unit-test seams: `cli.mjs` (hand-rolled parsing of the decided launch contract), `server.mjs` (loopback hop), `exchange.mjs` (per-Model-Exchange proxy and tee), `artifact.mjs` (artifact writes), `index.mjs` (assembly). No build step; `node --test` for unit tests.

Streaming I/O is **tee-on-read**: each hop forwards before the body completes, and entity bytes are appended to the exchange's `.body` file the moment they arrive from the source socket, so the recorded bytes are the forwarded byte sequence bit-for-bit by construction. Fan-out pipes give backpressure to the slowest sink; no hop ever buffers a whole body, and runtime chunk splits or coalesces are permitted as before. Metadata writes are trigger-based per the artifact decision: the `request` event is admission (create the exchange directory, write `request.json`, append to `index.json`), response headers arrive (write `response.json` and `upstream-request.json`, including the negotiated protocol and the actual upstream request envelope), and response end finalizes the exchange.

Both hops are forced HTTP/1.1 (the loopback server rejects anything else with 505; the Node `https` client is HTTP/1.1-only and never negotiates h2), keep-alive on both sides (shared upstream Agent with a reasonable `maxSockets`), with idle-truncating server timeouts (`requestTimeout`, `headersTimeout`) disabled so long-lived SSE streams are never killed. Upstream TLS uses system CA validation unchanged, and trailers are forwarded on both hops via `addTrailers()` before `end()`.

For the later verification contract: upstream keep-alive behavior was not exercised by the captured fixture and should be covered there; `node:test` plus fixture replay give the automated acceptance that ticket needs.
