# Claude Code transport and session facts

Research date: 2026-08-21  
Local Claude Code inspected: `2.1.238 (Claude Code)`  
Scope: Claude Code CLI and the Claude Code VS Code extension when configured with `ANTHROPIC_BASE_URL`, which selects the Anthropic Messages API format. DeepSeek-specific compatibility and cc-switch profile behavior are outside this ticket.

## Bottom line

- Current Claude Code exposes a stable session correlation value to an Anthropic-format gateway in the case-insensitive HTTP request header `x-claude-code-session-id`. Anthropic describes it as a unique identifier for the current Claude Code session and explicitly says gateways can use it to aggregate every request from that session without parsing bodies. It was added in Claude Code `2.1.86` on 2026-03-27. [Gateway protocol: request headers](https://code.claude.com/docs/en/llm-gateway-protocol#request-headers), [Claude Code 2.1.86 changelog](https://code.claude.com/docs/en/changelog#2-1-86)
- Resuming reopens a conversation under the same session ID; forking creates a new session ID. `/clear` starts a new session. Therefore the header is the documented endpoint-visible session identity, not a heuristic extracted from human-facing content. [How Claude Code works: resume or fork sessions](https://code.claude.com/docs/en/how-claude-code-works#resume-or-fork-sessions), [Manage sessions](https://code.claude.com/docs/en/sessions)
- With `ANTHROPIC_BASE_URL`, inference uses Anthropic Messages semantics and posts to `/v1/messages?beta=true`; token counting may use `/v1/messages/count_tokens`. Model responses are streamed as server-sent events (SSE), including pings, and a gateway must relay them incrementally. [Gateway protocol: API formats and streaming](https://code.claude.com/docs/en/llm-gateway-protocol#api-formats)
- The protocol is deliberately an open contract. Claude Code adds beta capabilities, headers, and JSON fields over time, so no fixed allowlist is an exact description of all traffic across versions. Exact HTTP version, wire header order/casing, transfer encoding, compression, and the precise field set emitted by the installed build/configuration require a live probe. [Gateway protocol: forward as open lists](https://code.claude.com/docs/en/llm-gateway-protocol#forward-as-open-lists)

## Documented facts

### CLI and VS Code use the same transport configuration

Anthropic says Claude Code uses the same underlying engine across local surfaces. For the VS Code extension, `claudeCode.environmentVariables` is the reliable place to set `ANTHROPIC_BASE_URL` and the gateway credential; the extension launches a bundled Claude process, and `~/.claude/settings.json` is shared with the CLI. Thus a VS Code panel conversation is not a separate browser-to-model protocol: the spawned Claude Code process is the API client. [Platforms and integrations](https://code.claude.com/docs/en/platforms), [Connect Claude Code to a gateway: VS Code](https://code.claude.com/docs/en/llm-gateway-connect#vs-code-extension), [VS Code settings](https://code.claude.com/docs/en/ide-integrations#configure-settings)

This conclusion applies when both surfaces actually receive the same recorder base URL. The official VS Code guidance warns that settings inherited by the spawned process do not satisfy the extension's own login check as reliably as `claudeCode.environmentVariables` does.

### Requests that can reach an `ANTHROPIC_BASE_URL`

| Traffic | Documented request target | Meaning |
| --- | --- | --- |
| Inference | `POST /v1/messages?beta=true` | A Harness-to-Model exchange. The gateway protocol says inference responses must stream. |
| Token counting | `POST /v1/messages/count_tokens` (optional endpoint) | Auxiliary Claude Code traffic. If absent, Claude Code falls back to counting through the inference endpoint. |
| Connection warm-up | `HEAD /api/hello` | Best-effort startup traffic, not a model exchange. It can be absent when an HTTP proxy or client certificate is configured. |
| Model discovery | `GET /v1/models?limit=1000` | Optional startup traffic only when `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`; discovery is off by default. |

The endpoint and startup-traffic facts are in Anthropic's [gateway protocol reference](https://code.claude.com/docs/en/llm-gateway-protocol#api-formats). Model discovery details, including the exact query, are in [Gateway protocol: model discovery](https://code.claude.com/docs/en/llm-gateway-protocol#model-discovery).

Two qualifications matter:

1. The protocol reference guarantees the token-counting **path**, not a fixed query string. The current official beta TypeScript SDK posts token counting to `/v1/messages/count_tokens?beta=true`; whether a particular Claude Code request uses that query is a live-probe item. [Official Anthropic TypeScript SDK beta Messages implementation](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/beta/messages/messages.ts)
2. Some Claude Code traffic deliberately bypasses `ANTHROPIC_BASE_URL`. The official protocol names the fast-mode availability check and WebFetch domain-safety check as direct calls to `api.anthropic.com`. They are not Harness-to-Model Messages exchanges and will not appear at a recorder placed only on `ANTHROPIC_BASE_URL`. [Gateway protocol: optional endpoints and startup traffic](https://code.claude.com/docs/en/llm-gateway-protocol#optional-endpoints-and-startup-traffic)

### Observable request headers

Anthropic documents the following Claude Code API headers. Header names are case-insensitive on the wire.

| Header | Documented meaning |
| --- | --- |
| `Authorization` and/or `x-api-key` | Gateway credential. `ANTHROPIC_AUTH_TOKEN` maps to `Authorization: Bearer ...`; `ANTHROPIC_API_KEY` maps to `x-api-key`; `apiKeyHelper` can populate both. |
| `anthropic-version` | API version; currently `2023-06-01`. |
| `anthropic-beta` | Comma-separated capabilities. The set changes with Claude Code versions and must be treated as open. |
| `x-claude-code-session-id` | Unique identifier for the current Claude Code session; intended for aggregating all requests from one session. |
| `x-claude-code-agent-id` | Present only for a spawned subagent request. |
| `x-claude-code-parent-agent-id` | Present only for a nested agent request. |
| User-configured custom headers | Values configured through `ANTHROPIC_CUSTOM_HEADERS`. |

Sources: [Gateway protocol: request headers](https://code.claude.com/docs/en/llm-gateway-protocol#request-headers) and [gateway credential-to-header mapping](https://code.claude.com/docs/en/llm-gateway-connect#how-the-credential-variable-maps-to-a-header).

This is not an exhaustive raw HTTP header list. Standard HTTP and SDK/runtime headers such as `Host`, `Content-Type`, `Accept`, `User-Agent`, connection/transfer fields, and possible SDK diagnostic headers are not fixed by the Claude Code gateway contract. A listener can observe whichever of them arrive, but their exact presence, spelling, order, and values are implementation/version facts to measure rather than protocol guarantees.

### Observable request body

The request entity is Anthropic Messages JSON. The base API schema requires `model`, `max_tokens`, and `messages`; `messages` contains alternating `user`/`assistant` entries whose `content` can be strings or typed content-block arrays. The API schema also permits `system`, `tools`, `tool_choice`, `thinking`, `metadata`, `output_config`, `stop_sequences`, `service_tier`, cache-control fields, and `stream`, among other evolving beta fields. [Messages request schema](https://platform.claude.com/docs/en/api/messages/create), [official OpenAPI-generated Python request type](https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/types/message_create_params.py)

Claude Code-specific documentation adds these facts:

- Inference is streamed, which semantically corresponds to `stream: true` in the Messages request.
- Claude Code prepends a client-version/conversation-fingerprint attribution block as the first entry of the `system` array unless configured otherwise. Since `2.1.181`, this block is stable for a conversation when routed through a custom base URL.
- Depending on model capabilities and Claude Code version/configuration, bodies can contain fields such as `thinking`, `context_management`, `output_config`, and tool schema fields including `strict` and `defer_loading`, paired where applicable with `anthropic-beta` capabilities.
- Anthropic explicitly tells gateways to treat body fields as an open list and preserve them; the current exact body cannot be specified safely as a closed schema.

Sources: [Gateway protocol: system prompt attribution](https://code.claude.com/docs/en/llm-gateway-protocol#system-prompt-attribution-block), [feature pass-through](https://code.claude.com/docs/en/llm-gateway-protocol#feature-pass-through), and [forward as open lists](https://code.claude.com/docs/en/llm-gateway-protocol#forward-as-open-lists).

No official current source says a Claude Code session ID must occur in the Messages JSON body. The documented correlation mechanism is the request header `x-claude-code-session-id`.

At the configured base-URL server, all application-level request data delivered to that server is observable: method and request target, request headers, and the JSON entity body. If the base URL is HTTPS, these are available after that server terminates TLS; encrypted TLS records on the incoming connection are a different representation. A forwarding proxy then creates a second HTTP message toward its upstream. Anthropic's contract requires selected fields to be forwarded unchanged, sometimes byte-for-byte, but it does not claim the two HTTP messages have identical header serialization, HTTP version, transfer framing, or TLS records. Those distinctions are part of the live-probe boundary, not documented Claude Code semantics.

### Streaming response encoding

Claude Code expects the response to arrive incrementally as SSE and counts bytes as the gateway relays them, including `ping` events and SSE comment lines. Buffering a complete response stalls the client; a silent stream is aborted after 300 seconds by default on an `ANTHROPIC_BASE_URL` connection. [Gateway protocol: streaming](https://code.claude.com/docs/en/llm-gateway-protocol#streaming)

Each SSE record has a named `event:` field and a `data:` field containing JSON whose `type` matches the event name. The documented normal flow is:

1. `message_start`
2. For each content block: `content_block_start`, zero or more `content_block_delta`, then `content_block_stop`
3. One or more `message_delta`
4. `message_stop`

Any number of `ping` events may be interspersed. An `error` can occur inside an already-successful HTTP stream. Future unknown event types are allowed. Content deltas include text, partial JSON strings for tool input, thinking deltas, and signatures. [Anthropic streaming Messages event contract](https://platform.claude.com/docs/en/build-with-claude/streaming#event-types)

The SSE bytes are the Model-to-Harness response content as delivered by the endpoint. Reconstructing a single final JSON Message from those events is a transformation performed by an SDK; it is not the byte representation that crossed the connection.

The base-URL server can likewise observe the response status, response headers, and each response-body byte it receives from upstream before relaying it. Anthropic does not publish a closed list or exact serialization of response headers for Claude Code. Errors can arrive either as ordinary non-streaming HTTP error responses or as `event: error` after an SSE stream has already begun. Claude Code's recovery logic matches some upstream error wording, so the gateway protocol directs gateways to forward error response bodies unmodified. [Gateway protocol: automatic retry and error forwarding](https://code.claude.com/docs/en/llm-gateway-protocol#automatic-retry-and-error-forwarding)

### Session identity and lifecycle

The strongest current evidence is first-party documentation, not transcript inference:

- The gateway protocol calls `x-claude-code-session-id` a unique identifier for the current session and says it groups all requests from that session.
- The `2.1.86` changelog says the header was added specifically so proxies can aggregate requests by session without parsing bodies.
- Claude Code's session docs say resume reuses the same session ID, while fork/branch creates a new ID; `/clear` starts a new session.
- Subagents do not require a different top-level session key: they carry the same session header plus optional agent and parent-agent headers.

Accordingly, for current supported Claude Code builds (at least `2.1.86` onward), the stable session ID is observable at the configured model base URL. Older clients before `2.1.86` do not have this documented header and need a different, explicitly version-scoped mechanism.

## First-party implementation evidence

The official Anthropic TypeScript SDK's beta Messages implementation provides implementation-level corroboration of the documented path and encoding behavior:

- `create()` removes beta-list and user-profile convenience parameters from the JSON object, maps them to headers, and posts the remaining body to `/v1/messages?beta=true`; it passes the request's `stream` value into the HTTP client.
- `countTokens()` posts to `/v1/messages/count_tokens?beta=true` and adds the token-counting beta header.

Source: [Anthropic TypeScript SDK `beta/messages/messages.ts`](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/beta/messages/messages.ts).

This source is evidence for the official SDK transport, not proof that every current Claude Code code path populates every SDK field. The shipped Claude Code implementation is distributed as a bundled native executable rather than readable source in the public `anthropics/claude-code` repository. A local string inspection of the installed official `2.1.238` binary found the constants `X-Claude-Code-Session-Id`, `/v1/messages?beta=true`, `/v1/messages/count_tokens`, and `/v1/messages/count_tokens?beta=true`; string presence corroborates the docs but does not prove runtime control flow or exact emitted bytes.

## Unresolved facts that need a live probe

The following cannot be established exactly from the public contract and should remain explicit unknowns until measured with the actual Claude Code + cc-switch + DeepSeek profile:

1. **Raw wire representation:** HTTP/1.1 versus HTTP/2, TLS use, header casing/order, `Content-Length` versus chunked transfer, content encoding, connection reuse, TCP segmentation, and whether a runtime decompresses/re-encodes data. The application protocol is documented; these wire details are not.
2. **Complete per-build headers and JSON fields:** Anthropic intentionally defines them as open lists. Capture at least one CLI request and one VS Code request from the exact Claude Code version selected for support.
3. **Header coverage on non-inference calls:** Verify whether `x-claude-code-session-id` is present on count-token, model-discovery, and warm-up requests in the target build. Its presence on model API requests is documented; startup timing may precede creation of a session.
4. **Token-count query form:** Verify whether target-build requests use `/v1/messages/count_tokens`, `/v1/messages/count_tokens?beta=true`, both under different code paths, or omit token counting because the endpoint/profile does not support it.
5. **DeepSeek compatibility behavior:** Anthropic documents the Claude endpoint contract but explicitly does not support routing Claude Code to non-Claude models. A DeepSeek-compatible endpoint may accept, reject, drop, or translate beta headers/body fields and may emit SSE variants. Its actual status headers, event bytes, keep-alives, and error bodies require capture. [Other LLM gateways](https://code.claude.com/docs/en/llm-gateway)
6. **cc-switch URL composition:** Confirm the exact base URL seen by Claude Code and whether cc-switch includes a path prefix. That determines the concrete request target at the recorder but is not a Claude Code transport fact.

These unknowns do not undermine the documented session-correlation result. They bound what an eventual fidelity claim can say without an empirical compatibility matrix.
