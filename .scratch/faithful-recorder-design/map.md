# Design a Faithful Claude Code Model-Exchange Recorder

Label: wayfinder:map

## Destination

Reach an implementation-ready technical specification for a standalone Linux Recorder that transparently forwards and losslessly records every Model Exchange between Claude Code and DeepSeek V4 Flash for the first observed Harness Session, across both the CLI and VS Code extension.

## Notes

- Use `grilling` and `domain-modeling` for design decisions, `research` for external facts, and `prototype` when the recording artifact needs a concrete example.
- The Recorder observes complete application-level HTTP messages: all source-emitted fields and exact entity byte sequences are inside the fidelity boundary; wire syntax, HTTP transfer framing, runtime delivery chunks, and TCP/TLS framing are outside it.
- cc-switch has two independent choices: the unchanged Direct Model Profile and a separately created Recorder Profile. The Recorder never reads or edits cc-switch configuration.
- Claude Code 2.1.86+ exposes the stable Harness Session identity in the `x-claude-code-session-id` model-request header.
- The Recorder locks onto the first observed `session_id`, records only that Harness Session, and keeps the lock until the human stops it.
- The record may be a session directory containing multiple files, with names carrying a `session_id` feature.
- Repository state is greenfield: there is no implementation, build system, test suite, or prior architecture to preserve.

## Decisions so far

- [Establish Claude Code transport and session facts](issues/01-establish-claude-code-transport-and-session-facts.md) — Claude Code uses Anthropic Messages with incremental SSE and exposes a stable session header; exact raw HTTP and DeepSeek behavior require a target-stack probe.
- [Establish cc-switch dual-profile routing facts](issues/02-establish-cc-switch-dual-profile-routing-facts.md) — independent provider records support direct and Recorder routes, while upstream Recorder configuration and cc-switch backfill behavior require an explicit contract and local verification.
- [Capture the target-stack HTTP fixture](issues/10-capture-target-stack-http-fixture.md) — measured CLI and VS Code extension-entrypoint exchanges confirm the session header, exact open-list request/body shape, and DeepSeek's incrementally delivered SSE bytes and headers.
- [Choose the Recorder's observation and forwarding seam](issues/03-choose-observation-and-forwarding-seam.md) — use a two-sided streaming application-HTTP proxy seam that records each source's complete message and forwards opaque request/response entity bytes bit-for-bit, permitting only auditable routing and hop-by-hop envelope changes.
- [Define single-session acquisition and lock lifecycle](issues/04-define-single-session-lock-lifecycle.md) — the first eligible Messages request locks an opaque session identity; the script records that Harness Session until normal manual stop preserves the final admitted exchange and closes the recording.
- [Design the lossless recording artifact](issues/05-design-lossless-recording-artifact.md) — a session-named directory indexes request-ordered exchange folders, each pairing byte-exact request/response entities with ordered HTTP metadata and the auditable upstream request envelope.
- [Define Recorder Profile and runtime configuration contract](issues/06-define-recorder-profile-and-runtime-configuration.md) — clone the effective Direct settings into a separately selected loopback profile, run the Recorder as the sole data-plane proxy, and configure only its upstream base, output root, and optional listen socket at launch.
- [Choose implementation stack and streaming I/O](issues/07-choose-implementation-stack-and-streaming-io.md) — Node.js ≥22, zero dependencies, hand-rolled two-hop proxy on stock http/https with raw-header-preserving observation, tee-on-read streaming writes, HTTP/1.1 keep-alive both hops; small module split with node:test.
- [Set supported-version and client compatibility contract](issues/08-set-version-and-client-compatibility-contract.md) — two-tier claim: a short Verified table measured 2026-08-21 (Claude Code 2.1.238 both entrypoints, VS Code 1.116.0, cc-switch 3.15.0, DeepSeek endpoint), nothing else claimed; the Recorder has no version logic — admission stays header-only (04), client version is passively recoverable from the recorded User-Agent.

## Not yet specified

## Out of scope

- Security and privacy design, including redaction, secret handling, access control, encryption, and retention policy.
- Failure behavior and recovery, including crashes, network or upstream failures, malformed traffic, disk exhaustion, and interrupted writes.
- Concurrent or alternative `session_id` behavior while the Recorder is running; the human prevents this operationally.
- macOS and Windows support or acceptance testing.
- Human-facing conversation capture, viewers, search, analysis, replay, export, dashboards, or a Web UI.
- Generalization to Harnesses other than Claude Code or Models other than the configured DeepSeek V4 Flash endpoint.
- Editing, replacing, or automatically managing either cc-switch profile.
- Implementing the Recorder; this effort resolves the technical design that implementation will follow.
