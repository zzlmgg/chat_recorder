# Faithful Claude Code Model-Exchange Recorder

Status: ready-for-agent

## Problem Statement

A human who uses Claude Code through either its CLI or its VS Code extension, with DeepSeek V4 Flash selected through cc-switch, needs a trustworthy record of the model traffic for one Claude Code session. The human-facing transcript is not sufficient: it omits request metadata, system content, tool schemas, thinking data, streaming events, response headers, and the exact entity bytes exchanged with the Model.

The recording path must not change the effective model configuration, credentials, request or response meaning, or streaming behavior. It must preserve the complete application-level HTTP Model Exchanges emitted by the two sources at the boundary: the Harness request as received by the Recorder, and the Model response as received by the Recorder after upstream TLS termination. It must also make the proxy-created upstream request envelope auditable.

The existing Direct Model Profile must remain independently selectable. Recording must use a separate Recorder Profile and a standalone Linux process, with cc-switch acting only as a control-plane profile selector. The Recorder must acquire one Harness Session from the stable `x-claude-code-session-id` request header, retain that lock until a normal human stop, and record every admitted Model Exchange for that Harness Session in deterministic request order.

The repository is greenfield. There is no implementation, package definition, build system, or test suite to preserve. The specification therefore must define the runtime, protocol, artifact, compatibility, and acceptance contracts precisely enough for a later implementation agent to build and verify the Recorder without reopening the ten resolved design decisions.

## Solution

Build a small, standalone, zero-dependency Node.js Recorder for Linux. The Recorder listens on a configurable HTTP/1.1 socket, receives Claude Code traffic from the selected Recorder Profile, and creates a second HTTP/1.1 connection to a configured DeepSeek-compatible upstream base URL. It captures each source-side application HTTP message while teeing the request and response entities onward as opaque byte streams under backpressure.

The human keeps the existing Direct Model Profile and creates a separate Recorder Profile by copying the complete effective Direct Model Profile and changing only `ANTHROPIC_BASE_URL` to the Recorder's loopback URL. The human supplies the real upstream base URL and output root when starting the Recorder. Credentials are not separately configured: the Recorder forwards the authentication field received from the Harness as an ordinary end-to-end request field.

The Recorder begins unlocked. The first eligible `POST /v1/messages` request with exactly one non-empty `x-claude-code-session-id` field acquires the lock at request-header completion and is recorded in full. Later eligible requests with the exact same opaque session identity are recorded in the same session directory. Auxiliary traffic cannot acquire the lock and does not become a recorded Model Exchange. A normal stop closes admission, drains every already-admitted Model Exchange to completion, finalizes the artifact, and exits.

The recording artifact is a versioned, session-named directory. It contains an ordered index and one directory per Model Exchange. Each exchange stores the exact request and response entity bytes in opaque files; source HTTP metadata as ordered, duplicate-preserving field pairs; and the actual upstream request metadata, including every permitted routing and hop-by-hop difference. JSON and SSE are never parsed, normalized, regenerated, redacted, decompressed, or recompressed.

Correctness is established in two automated layers. Byte-level replay tests exercise the assembled Recorder through its real listen socket against a controlled upstream and compare both forwarded streams and stored artifacts to the captured target-stack fixture. Live acceptance then drives the real Claude Code CLI and the extension-shipped `claude-vscode` entrypoint without opening the VS Code UI. The feature is accepted only when the replay suite passes and both live entrypoints complete with a valid recording.

## User Stories

1. As a human operator, I want to retain my Direct Model Profile as an independently selectable route, so that I can use Claude Code without the Recorder whenever I choose.
2. As a human operator, I want a distinct Recorder Profile, so that entering and leaving the recording route is an explicit profile-selection action.
3. As a human operator, I want the Recorder Profile to preserve the Direct Model Profile's effective credential, model, role-model, subagent, and metadata settings, so that recording does not silently change which Model the Harness uses.
4. As a human operator, I want only the Recorder Profile's base URL to differ from the Direct Model Profile, so that the route change is narrow and reviewable.
5. As a human operator, I want cc-switch local-routing takeover disabled while recording, so that the data path contains only the Harness, Recorder, and Model.
6. As a human operator, I want the Recorder to leave both cc-switch profiles untouched, so that stopping the Recorder cannot corrupt or reconstruct my provider configuration.
7. As a human operator, I want to switch back to the Direct Model Profile without a Recorder-side profile operation, so that restoration remains under my control.
8. As a human operator, I want to supply the upstream base URL explicitly at launch, so that the Recorder never guesses or reads my Direct Model Profile.
9. As a human operator, I want the upstream base URL to support a path prefix, so that gateways such as the DeepSeek Anthropic-compatible endpoint route correctly.
10. As a human operator, I want to choose the output root at launch, so that the recording is stored in a location I control.
11. As a human operator, I want a loopback listen address by default, so that ordinary recording does not require exposing a network listener.
12. As a human operator, I want to override the listen socket explicitly, so that I can resolve local port conflicts without changing the rest of the contract.
13. As a human operator, I want one CLI invocation and no secondary configuration layer, so that the effective runtime configuration is visible and reproducible.
14. As a human operator, I want the Recorder to reuse the Harness's authentication header unchanged, so that I do not manage a second copy or translation of the Model credential.
15. As a Claude Code CLI user, I want my Messages requests and streamed responses to pass through the Recorder, so that recording does not change the CLI experience.
16. As a Claude Code VS Code extension user, I want the extension-owned model client to pass through the same Recorder, so that both supported Harness entrypoints produce the same artifact shape.
17. As a Harness user, I want the Recorder to begin listening before a Harness Session is selected, so that the first eligible Model Exchange can define the recording automatically.
18. As a Harness user, I want only an in-scope Messages request with a usable session field to acquire the lock, so that warm-up, discovery, token-counting, and unrelated traffic do not select the recording.
19. As a Harness user, I want lock acquisition to occur after request headers are complete but before the request body or Model response completes, so that the acquiring Model Exchange is included in full.
20. As a Harness user, I want the session header name compared case-insensitively, so that valid HTTP field casing does not affect acquisition.
21. As a Harness user, I want optional whitespace around the sole session field value removed for identity comparison, so that HTTP field syntax does not create a false identity difference.
22. As a Harness user, I want the remaining session identity treated as opaque and case-sensitive, so that the Recorder does not depend on an undocumented UUID format.
23. As a Harness user, I want requests with a missing, empty, or duplicated session field to be ineligible, so that lock ownership is unambiguous.
24. As a Harness user, I want the Messages query string preserved but ignored for admission, so that `?beta=true` and future query details do not change which path represents a Model Exchange.
25. As a Harness user, I want every eligible request for the locked Harness Session recorded until normal stop, so that the artifact covers the whole selected session run.
26. As a Harness user, I want concurrent or overlapping Model Exchanges ordered by request-header admission, so that the artifact has one deterministic conversation order independent of network latency.
27. As a human operator, I want the lock to remain fixed for the process lifetime, so that one run cannot silently rotate into another Harness Session.
28. As a human operator, I want a normal stop to prevent new Model Exchanges from being admitted, so that the recording has a clear operational endpoint.
29. As a human operator, I want a normal stop to let already-admitted Model Exchanges finish, so that the last accepted interaction is not deliberately truncated.
30. As a human operator, I want all already-saved exchanges retained after normal stop, so that closing the Recorder does not discard a valid recording.
31. As a human operator, I want no session artifact when no Harness Session was acquired, so that an unused run does not look like a completed recording.
32. As an artifact consumer, I want the session directory name to contain a reversible representation of the exact session identity, so that I can associate the artifact with its Harness Session without relying only on file contents.
33. As an artifact consumer, I want the exact opaque session identity repeated in the index, so that percent-encoded filenames are not the sole identity source.
34. As an artifact consumer, I want a version number in the index, so that future artifact readers can distinguish schema generations.
35. As an artifact consumer, I want an ordered exchange list, so that I can traverse the Harness Session in admission order without inferring order from timestamps.
36. As an artifact consumer, I want one directory to pair each Harness request, actual upstream request, and Model response, so that the two sides of a Model Exchange cannot be confused.
37. As an artifact consumer, I want exact request entity bytes stored separately from metadata, so that arbitrary binary or evolving JSON content is preserved without transformation.
38. As an artifact consumer, I want exact response entity bytes stored separately from metadata, so that SSE and non-SSE bodies remain byte-recoverable.
39. As an artifact consumer, I want body files to exist for zero-length entities, so that absence of content is explicit rather than confused with a missing file.
40. As an artifact consumer, I want request method, request target, and HTTP version recorded, so that the source request start line can be reconstructed at the application-message level.
41. As an artifact consumer, I want response status, reason, and HTTP version recorded, so that the source response start line can be reconstructed at the application-message level.
42. As an artifact consumer, I want headers and trailers stored as ordered name/value pairs, so that original casing, cross-field order, and duplicates are retained.
43. As an artifact consumer, I want the upstream request target and fields recorded separately, so that base-path mapping, `Host` replacement, and hop-by-hop changes are auditable.
44. As an artifact consumer, I want the upstream request metadata to refer to the same request body file, so that byte equality is explicit without duplicating content.
45. As an artifact consumer, I want credentials and private context captured without redaction, so that the artifact is faithful even though it must consequently be treated as sensitive.
46. As a Harness user, I want request bytes forwarded to the Model exactly as received, so that recording cannot change the request entity.
47. As a Harness user, I want response bytes forwarded from the Model exactly as received, so that recording cannot change the response entity.
48. As a Harness user, I want forwarding to begin before an entity is complete, so that long requests and SSE responses are not buffered as whole bodies.
49. As a Harness user, I want slow storage or sockets handled with backpressure, so that fidelity does not depend on unbounded in-memory buffering.
50. As a Harness user, I want JSON, SSE, and future unknown body fields or events treated as opaque bytes, so that protocol evolution does not require Recorder parsing changes.
51. As a Harness user, I want content encodings left untouched, so that the Recorder never decompresses or recompresses Model Exchange entities.
52. As a Harness user, I want end-to-end fields forwarded as an open list, so that new Claude Code headers and trailers continue through without an allowlist update.
53. As a Harness user, I want only routing, connection, transfer-framing, and TLS differences required by the second HTTP hop, so that proxy effects remain narrow.
54. As a Harness user, I want HTTP/1.1 keep-alive on both hops, so that multiple Model Exchanges do not require a new connection each time.
55. As a Harness user, I want long-lived SSE streams exempt from idle-truncating server timeouts, so that the Recorder does not terminate a quiet but valid response.
56. As a system administrator, I want upstream TLS to use normal system CA validation, so that recording does not weaken server authentication.
57. As a maintainer, I want Node.js 22 or newer and no third-party runtime packages, so that the Recorder remains small, inspectable, and reproducible.
58. As a maintainer, I want logical responsibilities separated between launch parsing, server lifecycle, exchange forwarding, artifact persistence, and composition, so that each concern remains understandable without a framework.
59. As a maintainer, I want the real captured CLI and VS Code fixture to be test truth, so that fidelity claims are grounded in measured target-stack bytes.
60. As a maintainer, I want automated assertions for both forwarding directions and stored entities, so that a test cannot pass by validating only the artifact or only the relay.
61. As a maintainer, I want streaming verified by observing initial response bytes before upstream completion, so that a whole-response buffer cannot satisfy acceptance.
62. As a maintainer, I want synthetic keep-alive and empty-entity scenarios, so that requirements absent from the captured fixture are still covered.
63. As a maintainer, I want normal-stop semantics exercised while an exchange is in flight, so that shutdown correctness is externally demonstrated.
64. As a maintainer, I want runtime delivery chunk boundaries excluded from equality assertions, so that harmless stream splitting or coalescing does not produce false failures.
65. As a maintainer, I want live acceptance for both supported entrypoints, so that fixture replay alone does not substitute for compatibility with the installed stack.
66. As a maintainer, I want the VS Code acceptance scenario to use the extension-shipped executable and its launcher environment without automating the UI, so that the tested boundary matches the model client while remaining fully automated.
67. As a maintainer, I want compatibility claims restricted to versions actually measured, so that a passing implementation does not imply unsupported future-version guarantees.
68. As an artifact consumer, I want the recorded `User-Agent` left verbatim, so that client-version provenance remains passively recoverable without runtime version logic.

## Implementation Decisions

### Product and topology boundary

- The deliverable is a standalone Linux **Recorder** whose only data-plane topology is `Harness -> Recorder -> Model`.
- **Harness**, **Model**, **Model Exchange**, **Harness Session**, **Recorder**, **Direct Model Profile**, and **Recorder Profile** retain the meanings defined by the project domain glossary. In particular, a Model Exchange is an application-level request/response pair, not a human conversation turn and not a set of TCP or runtime chunks.
- cc-switch is a control-plane profile selector only. Its local-routing takeover mode must be disabled during recording; its proxy must not be another data-plane hop.
- The existing Direct Model Profile remains separately selectable. The Recorder never reads, edits, reconstructs, validates, or switches either profile.
- The human creates a distinctly named Recorder Profile by copying the complete effective Direct Model Profile and changing only `env.ANTHROPIC_BASE_URL` to `http://127.0.0.1:4318`, or to the explicit listen socket if the default is overridden.
- The copy includes the exact credential field and value (`ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`), fallback and role-model mappings, subagent model, all other effective Claude settings, `meta.apiFormat`, and `meta.apiKeyField`. The working profile is copied; it is not recreated from a cc-switch preset.
- “Direct Model Profile remains unchanged” means the Recorder neither performs nor prescribes a mutation. cc-switch normal-mode outgoing-profile backfill may still rewrite its own stored provider row; byte-for-byte persistence of cc-switch storage is not a Recorder guarantee.
- Selecting the Recorder Profile routes both supported Harness entrypoints to the Recorder when no higher-precedence Claude or VS Code setting overrides it. Selecting the Direct Model Profile restores the direct data path without consulting the Recorder.

### Runtime and launch contract

- The runtime is Node.js with `engines >=22`, ESM modules, built-in `http` and `https`, built-in filesystem primitives, and the built-in `node:test` runner. There are zero third-party runtime or test dependencies and no compilation/build step.
- The executable contract is:

  ```text
  recorder \
    --upstream-base-url <absolute-base-url> \
    --output-root <directory> \
    [--listen 127.0.0.1:4318]
  ```

- `--upstream-base-url` is required. It is an absolute `http` or `https` base URL, may include a path prefix, and names the Claude-compatible gateway base rather than the complete `/v1/messages` endpoint.
- `--output-root` is required. It names the parent directory under which the session artifact directory is created.
- `--listen` is optional and defaults to `127.0.0.1:4318`. The default Recorder Profile base URL is therefore `http://127.0.0.1:4318`.
- No configuration file, environment-variable override layer, credential option, profile identifier, profile-management command, or cc-switch integration is part of the runtime contract.
- The human manually copies the Direct Model Profile's effective `ANTHROPIC_BASE_URL` into `--upstream-base-url`. The Recorder does not discover that value.
- The Recorder receives no separate upstream credential. It forwards the source-emitted authentication field and value with the other end-to-end fields.

### Application-HTTP seam and fidelity boundary

- The Recorder is a two-sided streaming application-level HTTP reverse proxy. It terminates the Harness's loopback HTTP/1.1 connection and separately terminates its HTTP/1.1 connection, including TLS where applicable, to the Model.
- Harness ingress is the authoritative source observation for the request. The capture includes HTTP version, method, original request target, every ordered request header and trailer field with original name and value, and the exact request entity byte sequence.
- Model ingress after upstream TLS termination is the authoritative source observation for the response. The capture includes HTTP version, status, reason phrase, every ordered response header and trailer field with original name and value, and the exact response entity byte sequence.
- Headers and trailers are represented as arrays of two-element `[name, value]` pairs. They are not converted to maps. Original name casing, cross-field order, repeated names, and repeated values must remain observable.
- Entity bodies are opaque ordered byte sequences. The Recorder must not parse or regenerate Messages JSON, parse or regenerate SSE, normalize line endings or delimiters, redact fields, inject content, decode or re-encode text, decompress or recompress content, or buffer an entire body before forwarding it.
- Credentials, system prompts, messages, tool inputs and outputs, thinking content, custom fields, and any other source-emitted application data are inside the fidelity boundary and are recorded without redaction.
- Exact HTTP header-line whitespace, transfer framing and chunk-size lines, runtime delivery boundaries, timing, TLS records, TCP segmentation, and packet boundaries are outside the fidelity boundary.
- Runtime chunk splitting and coalescing are permitted. Only the concatenated entity sequence is required to be equal.
- The concatenated request entity bytes received from the Harness, written to the artifact, and sent upstream must be bit-for-bit identical.
- The concatenated response entity bytes received from the Model, written to the artifact, and sent to the Harness must be bit-for-bit identical.
- The Recorder treats request fields, response fields, Messages body fields, and SSE event types as open lists. Compatibility must not depend on a closed header, JSON, or SSE schema.

### Routing and forwarding contract

- The incoming request method and query are preserved. The upstream request target is formed by joining the configured upstream base path with the Harness request target's path and preserving the Harness query.
- Example: upstream base `https://api.deepseek.com/anthropic` plus Harness target `/v1/messages?beta=true` produces upstream target `/anthropic/v1/messages?beta=true`.
- The source Harness target remains in `request.json`; the joined target actually used for the second hop is stored in `upstream-request.json`.
- Request entities and response entities are forwarded without semantic transformation.
- End-to-end request and response fields, including authentication and unknown future fields, are forwarded as an open ordered list.
- The only permitted envelope changes are the closed category required to form the second hop: replace the request `Host` for the upstream authority; join the upstream base path; and manage hop-by-hop fields, connection state, transfer framing, and TLS.
- Hop-by-hop fields include standard connection-specific fields and any field nominated by `Connection`. Source metadata is captured before those fields are removed or changed, and the actual upstream request metadata records the result after routing-envelope decisions.
- No model, credential, Anthropic beta, Messages body, SSE event, content encoding, or application field translation is permitted.
- Auxiliary requests such as token counting, warm-up, discovery, unknown paths, or requests without a usable session field cannot acquire the Harness Session and do not create Model Exchange artifact entries. Their presence must not be confused with admission order.
- Behavior for a competing eligible request carrying another session identity after the lock is acquired is deliberately outside this specification; the operating contract prevents concurrent alternative Harness Sessions during one run.

### Harness Session acquisition and lifecycle

- Starting the process creates an unlocked listening Recorder.
- A request is eligible to acquire or match the lock only when all of the following are true:

  1. Its headers have completed.
  2. Its method is `POST`.
  3. Its request path is exactly `/v1/messages`; the query is retained but ignored by this path test.
  4. Its raw fields contain exactly one case-insensitive `x-claude-code-session-id` field.
  5. Removing optional surrounding whitespace from that single value leaves a non-empty identity.

- The first eligible request acquires the lock synchronously at header completion. Exchange numbering and index admission occur at this point, before the entity or response finishes.
- The normalized-for-HTTP-boundaries value is otherwise opaque. It is compared exactly and case-sensitively. It is not parsed as a UUID, lowercased, case-folded, structurally validated, or derived from a body.
- The acquiring request is included as the first Model Exchange. Every later eligible request with exactly the same session identity is admitted into the same artifact while the process remains open.
- Exchange order is request-header admission order. It is not response-completion order, wall-clock order across all network events, or SSE event order.
- The lock is never released, rotated, or persisted for reuse by another process. One process run can produce at most one Harness Session artifact.
- A normal human stop changes the Recorder from accepting to draining: no new Model Exchange may be admitted, every already-admitted Model Exchange may finish through both forwarding and artifact sinks, and the process exits after those exchanges are finalized.
- A normal stop does not delete previously completed entries. It creates no separate completion marker, publication transaction, or persistent lock file.
- If the Recorder is stopped normally before any acquisition, it produces no session content.
- Forced termination, crashes, malformed input, stalled peers, upstream/network failure, disk failure, and recovery from partial artifacts are outside scope.

### Reversible session component

- Whenever the session identity is used in a filename component, prefix it with `session-` and encode it reversibly as follows:

  1. Encode the opaque identity as UTF-8 bytes.
  2. Leave ASCII `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-` unchanged.
  3. Percent-encode every other byte as uppercase `%HH`.

- A UUID-shaped identity remains human-readable, for example `session-a11f5b03-c280-4dc6-8c52-f0967d48948e`.
- The percent encoding is a filename representation only. Identity comparison uses the opaque header value after surrounding optional whitespace is removed.

### Artifact contract

- The artifact schema version is `1`.
- The concrete shape comes from the reviewed lossless-recording-artifact prototype:

  ```text
  session-<reversibly-encoded-session_id>/
  ├── index.json
  └── exchange-000001/
      ├── request.json
      ├── request.body
      ├── upstream-request.json
      ├── response.json
      └── response.body
  ```

- Exchange directories use monotonically increasing, zero-padded admission numbers beginning at `exchange-000001`.
- `index.json` contains:

  - `artifact_version`: integer `1`;
  - `session_id`: the exact opaque identity after removal of surrounding optional whitespace; and
  - `exchanges`: exchange-directory names in admission order.

- `request.json` represents the application-level Harness request and contains:

  - `http_version`;
  - `method`;
  - `target`, preserving the original Harness request target;
  - ordered, duplicate-preserving `headers` pairs;
  - ordered, duplicate-preserving `trailers` pairs; and
  - `entity_file: "request.body"`.

- `response.json` represents the application-level Model response and contains:

  - `http_version`;
  - numeric `status`;
  - `reason`;
  - ordered, duplicate-preserving `headers` pairs;
  - ordered, duplicate-preserving `trailers` pairs; and
  - `entity_file: "response.body"`.

- `upstream-request.json` represents the application-level request actually emitted toward the Model and contains:

  - the actual upstream HTTP version;
  - method;
  - joined upstream target;
  - ordered headers after routing and hop-by-hop handling;
  - ordered trailers actually forwarded upstream; and
  - `entity_file: "request.body"`.

- `request.body` always exists and contains only the exact source request entity bytes. `response.body` always exists and contains only the exact source response entity bytes. Both files exist even when their entity length is zero.
- The upstream request metadata refers to `request.body`; no second body copy is written.
- The exchange directory is the pairing boundary. Metadata or body files from different exchange numbers must never be paired.
- The index entry is assigned when request headers are admitted. Source trailer metadata becomes final only after the corresponding source entity ends; metadata persisted earlier in the exchange lifecycle must be finalized with the complete trailer list before a normally drained exchange is complete.
- The artifact stores no raw transfer framing, delivery-chunk log, timing, TCP/TLS data, human-facing transcript, derived JSON, derived SSE index, redacted view, or completion marker.

### Streaming and connection behavior

- Each direction uses tee-on-read streaming. As source bytes arrive, they are offered to both the next network hop and the corresponding body file without waiting for the complete entity.
- Fan-out obeys backpressure from the slowest sink. The implementation may pause source reads until both destinations can continue; it may not solve backpressure by accumulating an unbounded complete body in memory.
- The first response bytes must be relayed to the Harness before the Model response entity completes.
- Both hops are HTTP/1.1. The loopback server rejects a non-HTTP/1.1 request with status `505`. The upstream `http`/`https` client must not negotiate HTTP/2.
- Connections use keep-alive on both sides. Upstream requests share an Agent with a bounded, reasonable socket pool so sequential Model Exchanges can reuse a connection.
- Idle-truncating server request and header timeouts are disabled for valid long-lived SSE operation.
- Upstream HTTPS uses the platform's system CA verification without bypass or custom trust behavior.
- Request and response trailers are forwarded with the relevant HTTP/1.1 trailer mechanism before ending the destination stream, and the source-ordered trailer pairs are retained in metadata.
- Trigger-based persistence follows the exchange lifecycle: admission establishes the directory, request metadata, body sink, and index entry; Model response headers establish response and actual upstream-envelope metadata; entity completion finalizes bodies and trailers. The normal-stop drain waits for all admitted exchange finalization.

### Logical module boundaries

- A launch-contract module parses only the three decided CLI options and produces validated runtime values.
- A server-lifecycle module owns the loopback HTTP/1.1 listener, unlocked/locked/draining state, admission, normal stop, and upstream Agent lifetime.
- A Model-Exchange module owns one paired two-hop request/response flow, source-sided observations, permitted envelope changes, trailers, teeing, and backpressure.
- An artifact module owns reversible session naming, schema-versioned metadata, body sinks, exchange numbering, index order, and finalization.
- A composition entrypoint wires these responsibilities and starts the process.
- These are logical responsibility boundaries, not permission to normalize message data between modules. Raw ordered field pairs and opaque byte streams remain intact across internal calls.
- The accepted ADR requiring Node.js, zero dependencies, the stock HTTP stack, and tee-on-read streaming is binding. Framework reverse proxies and semantic protocol middleware are excluded.

### Compatibility contract

- Compatibility has two tiers only: versions in the Verified table and everything else. No floor, range, inferred family, or future version is claimed.
- The following stack was measured on Linux on 2026-08-21:

  | Component | Verified value |
  | --- | --- |
  | Claude Code CLI entrypoint | `2.1.238` (`sdk-cli`) |
  | Claude Code VS Code extension entrypoint | `2.1.238` (`claude-vscode`) |
  | VS Code host | `1.116.0` |
  | cc-switch | `3.15.0` |
  | DeepSeek endpoint | `https://api.deepseek.com/anthropic` |
  | Model observed in request | `deepseek-v4-flash` |

- The Recorder contains no client-version or cc-switch-version parsing, allowlist, warning, feature gate, or refusal logic.
- Admission remains based only on the request contract and session field. The recorded verbatim `User-Agent` is passive provenance and may be inspected later; `x-stainless-*` fields are not compatibility signals.
- The target-stack fixture establishes that both entrypoints emitted HTTP/1.1 `POST /v1/messages?beta=true`, carried distinct stable session fields, and received incrementally delivered DeepSeek SSE with byte-identical upstream/relay response hashes at the selected seam.
- The VS Code evidence covers the model client executable shipped by the official extension and its `claude-vscode` launch environment. It does not cover VS Code webview or extension-host UI IPC.

### Human operating sequence

1. Preserve the existing Direct Model Profile.
2. Copy its complete effective provider configuration into a distinctly named Recorder Profile and change only its `ANTHROPIC_BASE_URL` to the Recorder listen base.
3. Confirm cc-switch local-routing takeover is disabled.
4. Start the Recorder with the Direct route's upstream base URL and the chosen output root.
5. Select the Recorder Profile.
6. Start or resume the one Harness Session intended for capture, ensuring no alternative Harness Session uses the same Recorder process.
7. Use either supported Harness entrypoint normally while the Recorder remains open.
8. Stop the Recorder normally and allow admitted Model Exchanges to drain.
9. Select the Direct Model Profile when direct routing is desired again.

## Testing Decisions

### Test philosophy and seams

- Tests assert externally visible behavior, not internal call order or implementation details. A refactor that preserves HTTP behavior, artifact bytes, ordering, and lifecycle must not require test rewrites.
- The primary automated seam is the highest practical one: the assembled Recorder observed through its real listen socket, a controlled mock Model endpoint, its process lifecycle, and a temporary output root. A harness-side driver supplies requests and reads responses. This one seam covers admission, routing, forwarding, streaming, shutdown, and persistence together.
- Internal modules may have small focused tests only where they express a stable public contract, but internal mocks are not substitutes for the assembled Recorder tests. Reversible session naming and launch validation should preferably be asserted through process/output behavior when practical.
- The second seam is live compatibility with the installed Harness and Model stack. It proves entrypoint integration and streaming completion, not byte truth.
- There is no existing repository test suite to imitate. Prior art consists of the target-stack diagnostic capture, its manifest and byte fixtures, and the reviewed lossless-artifact prototype. The implementation should turn those assets into repeatable `node:test` scenarios.

### Layer 1: byte-level fixture replay

- Run with `node --test` and no external services or credentials.
- Use both captured surfaces: CLI `sdk-cli` and VS Code extension `claude-vscode`.
- The harness-side driver sends each captured request through the Recorder's actual listen socket. Secret-redacted control/header values in the source fixture are replaced with deterministic synthetic test values while the captured body bytes and non-secret source field ordering remain authoritative.
- The mock Model receives the forwarded request and returns the captured status, ordered response fields, trailers, and exact response entity. It emits the response entity under deliberate slow chunking so the test can observe streaming.
- Manifest SHA-256 values validate fixture integrity before replay.
- Request fidelity assertions prove all three sequences are identical to the replay truth:

  1. entity bytes supplied by the harness-side driver;
  2. concatenated entity bytes received by the mock Model; and
  3. bytes in `request.body`.

- Response fidelity assertions prove all three sequences are identical to the replay truth:

  1. entity bytes emitted by the mock Model;
  2. concatenated entity bytes received by the harness-side driver; and
  3. bytes in `response.body`.

- The mock Model also asserts the actual forwarded request method, joined target, end-to-end headers, and trailers. The harness-side driver asserts the actual relayed response status, reason, end-to-end headers, and trailers. Both sides allow only the specified routing and hop-by-hop differences.
- Metadata assertions prove `request.json` and `response.json` preserve source start-line fields plus ordered, duplicate-preserving headers and trailers. Tests include duplicate fields and trailers even though the live fixture's captured trailer lists are empty.
- Upstream audit assertions prove `upstream-request.json` reports the joined base-path target, upstream `Host`, actual HTTP version, forwarded end-to-end fields, forwarded trailers, and the complete set of hop-by-hop/routing differences. It must refer to the same `request.body`.
- Artifact assertions prove exact session-component encoding, `artifact_version: 1`, exact `session_id`, monotonically numbered exchange directories, required file presence, and index order.
- Admission-order tests overlap multiple same-session Model Exchanges and deliberately complete their responses out of order. `index.json` must retain request-header admission order.
- Eligibility tests send auxiliary traffic before the first Messages request, including a count-tokens-style request without a usable session field. It must neither acquire the lock nor create an exchange directory.
- Session-field tests cover field-name casing, surrounding optional whitespace, empty values, duplicate raw fields, exact case-sensitive identity comparison, and an opaque non-UUID identity requiring UTF-8 percent encoding.
- Streaming tests hold the mock response open after emitting an initial prefix. The harness must receive that prefix before the response entity completes. No wall-clock threshold is asserted.
- Backpressure tests use a deliberately slow destination and verify complete equality without assuming source chunk boundaries are preserved.
- A synthetic keep-alive test sends several consecutive exchanges through one harness connection while the mock Model observes upstream connection reuse. This covers behavior absent from the captured fixture, whose upstream responses used `Connection: close`.
- A synthetic zero-length-entity test proves the required body file exists and has length zero.
- HTTP-version behavior is tested by sending a non-HTTP/1.1 request and asserting `505`, with no Model Exchange admission.
- Normal-stop testing starts an exchange, initiates the supported normal stop while its response remains incomplete, and then completes the response. The harness receives the complete response, the artifact finalizes, no later request is admitted, and previously saved exchanges remain present.
- A no-acquisition normal-stop test proves that no session artifact is produced.
- Delivery boundaries, timing, raw chunk sizes, TLS records, and TCP segmentation are never equality assertions. The fixture's delivery-chunk records remain diagnostic documentation only.
- Layer 1 passes only when every byte, metadata, ordering, eligibility, streaming, keep-alive, empty-entity, HTTP-version, and normal-stop assertion succeeds.

### Layer 2: live target-stack acceptance

- Layer 2 runs only on a configured Linux host with the Verified stack, valid DeepSeek access, cc-switch Recorder Profile selected, and local paths to the installed client entrypoints. The drive is automated and non-interactive.
- Each scenario starts with a fresh Recorder process and a fresh Harness Session so that the intended session is the first eligible identity observed.
- CLI scenario: run `claude -p "<prompt>"` non-interactively with the Recorder Profile routing the process to the Recorder listen base.
- VS Code entrypoint scenario: run the byte-identical native executable shipped in the installed official extension with `CLAUDE_CODE_ENTRYPOINT=claude-vscode`, `MCP_CONNECTION_NONBLOCKING=true`, and `CLAUDE_CODE_ENABLE_TASKS=0`.
- No VS Code window, webview, or extension-host UI automation is required.
- For each scenario, assert that the client exits normally after receiving the streamed response and that the output root contains a well-formed session directory, ordered index, and complete files for every admitted exchange.
- Live artifacts are retained as candidates for future fixtures. They do not independently prove byte equality because no third source of live byte truth exists.
- A successful run does not automatically expand the Verified table. Compatibility claims change only through an explicit specification update backed by reviewed evidence.
- Overall acceptance requires Layer 1 entirely green followed by successful live recordings for both entrypoints.

## Out of Scope

- Security and privacy design, including redaction, secret scrubbing, access control, encryption, artifact permissions, secure deletion, and retention policy.
- Failure and recovery behavior, including process crashes, forced termination, malformed traffic, stalled connections, DNS/TLS/network errors, upstream unavailability, disk exhaustion, write failures, artifact collisions, and repair of interrupted metadata or body files.
- A policy for concurrent or alternative session identities after the first lock. The human operating contract prevents that situation.
- Lock rotation, automatic session rollover, multi-session capture in one run, or persistent lock recovery.
- macOS and Windows support, packaging, or acceptance testing.
- Generalization to Harnesses other than Claude Code or Models other than the configured DeepSeek V4 Flash endpoint.
- Compatibility claims for versions not listed in the Verified table, including older header-less Claude Code versions and future versions.
- Runtime compatibility detection, version gating, warnings, refusal, or automatic fixture promotion.
- Editing, replacing, cloning, validating, selecting, or automatically managing either cc-switch profile.
- Starting or stopping the Recorder from cc-switch, or running cc-switch's own proxy in the recording data path.
- A separate Recorder authentication scheme or substitution of upstream credentials.
- Human-facing transcript capture, conversation reconstruction, viewers, search, analysis, replay, export, dashboards, a Web UI, or semantic SSE/JSON indexes.
- Exact header-line whitespace, transfer framing, delivery-chunk boundaries, timing fidelity, HTTP chunk-size lines, TLS records, TCP segmentation, and packet capture.
- HTTP/2 on either hop.
- VS Code webview, UI, and extension-host IPC automation; acceptance stops at the extension-shipped model client entrypoint.
- Implementing the Recorder in this specification-publishing change. Code, package scaffolding, and tests begin only after human review of this spec.

## Further Notes

- This specification synthesizes all ten resolved design tickets. It does not reopen their decisions or add a second configuration/profile-management product around the Recorder.
- The accepted Node.js/streaming ADR is consistent with this specification and introduces no conflict requiring an ADR revision.
- The target-stack fixture contains exact request and response bodies with private target-stack context. Its credential values are redacted, but it must still remain a local, non-public test asset.
- Production recordings are more sensitive than the fixture because fidelity explicitly includes credentials and all private request/response content. That is intentional; protection and redaction are separate, out-of-scope work.
- The critical review checkpoint is the testing seam: one assembled-Recorder boundary for deterministic byte/lifecycle behavior, plus one real-stack compatibility boundary for the two Harness entrypoints. This keeps the test contract high-level while still separating byte truth from live compatibility.
- Other review checkpoints are the exact artifact schema, first-eligible-session admission rule, normal-stop drain semantics, and the intentionally narrow list of permitted second-hop differences.
- No implementation code was added as part of publishing this spec.
