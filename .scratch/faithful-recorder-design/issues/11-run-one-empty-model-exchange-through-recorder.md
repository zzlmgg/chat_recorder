# 11 — Run one empty Model Exchange through the Recorder

**What to build:** A human can launch the zero-dependency Recorder with the decided command-line contract, send one eligible empty Model Exchange through its real listen socket to a controlled Model, receive the Model response, and inspect a complete schema-v1 recording for the acquired Harness Session.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] The executable requires an absolute HTTP(S) upstream base URL and an output root, defaults the listen socket to `127.0.0.1:4318`, accepts an explicit listen override, and rejects invalid or unsupported launch input without introducing another configuration layer.
- [x] Node.js 22 or newer can run the Recorder as ESM with no third-party runtime or test dependencies and no build step.
- [x] An assembled-process test sends an HTTP/1.1 empty `POST /v1/messages` carrying one usable session field through the real listen socket and observes the controlled Model's empty response.
- [x] The Model receives the request at the upstream base-path plus the Harness target, including its query, and the Harness receives the corresponding response.
- [x] The acquired Harness Session produces a schema-v1 session artifact containing one ordered Model Exchange, complete request/upstream-request/response metadata, and explicit zero-length request and response entity files.

## Answer

Implemented the zero-dependency Node.js 22 ESM Recorder as the four decided logical modules plus a composition entrypoint. The executable validates the three-option launch contract, proxies one eligible empty Messages exchange through the configured upstream base path, and writes the complete schema-v1 session artifact with explicit empty entity files.

The built-in `node:test` suite covers launch validation and the assembled process through real HTTP/1.1 listen and controlled-Model sockets.
