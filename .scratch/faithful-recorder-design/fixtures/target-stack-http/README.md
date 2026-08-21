# Target-stack HTTP fixture

Captured on 2026-08-21 against the installed target stack:

- Claude Code CLI `2.1.238`;
- official `anthropic.claude-code` VS Code extension `2.1.238`;
- cc-switch `3.15.0` with its current `DeepSeek` Claude provider; and
- `https://api.deepseek.com/anthropic`, model `deepseek-v4-flash`.

The cc-switch provider and live `~/.claude/settings.json` were not edited. Each client received an additional command-line settings layer which changed only `ANTHROPIC_BASE_URL` to the one-shot listener and added the test-only `X-Recorder-Probe` control header. The listener removed that control header before forwarding to DeepSeek. All authentication and model values came from the current cc-switch provider.

## Surface boundary

The CLI capture ran the installed `~/.local/bin/claude` executable.

The VS Code capture ran the native Claude executable shipped inside the installed official extension. It used the launcher environment established by the extension code: `CLAUDE_CODE_ENTRYPOINT=claude-vscode`, `MCP_CONNECTION_NONBLOCKING=true`, and `CLAUDE_CODE_ENABLE_TASKS=0`. The executable is byte-identical to the installed CLI (`SHA-256 0933b286cf94e1b2504b35ac165ab76b8f822735d53371c56393988c23040d58`). The VS Code extension host and webview were not automated; this fixture covers the extension-owned model client and its extension entrypoint, not UI-to-extension-host IPC.

## Artifact layout

Each surface has one captured Model Exchange:

- `capture.json` records ordered incoming header pairs with credential values redacted, request and response hashes, exact upstream response headers, application-visible delivery chunk offsets/timings/hashes, and an SSE record index.
- `request-body.bin` is the exact incoming JSON entity body.
- `response-body.bin` is the exact SSE entity body received from DeepSeek and relayed to the Harness.
- `diagnostic-recorder.mjs` is the one-shot capture program. It binds only to loopback, requires a control header, strips that header before forwarding, and stops accepting connections after the first inference response.

Credential values are deliberately absent from `capture.json`; exact request-body and response-body bytes are retained. The bodies contain target-stack metadata such as a pseudonymous device ID and the Claude system prompt, so this local fixture should not be treated as a public sample.

## Observed request facts

| Fact | CLI | VS Code extension entrypoint |
| --- | --- | --- |
| Incoming protocol | HTTP/1.1 | HTTP/1.1 |
| Method and target | `POST /v1/messages?beta=true` | `POST /v1/messages?beta=true` |
| Session header | `a11f5b03-c280-4dc6-8c52-f0967d48948e` | `b6b67440-03af-4f1d-abcf-6e779f95de6f` |
| User-Agent | `claude-cli/2.1.238 (external, sdk-cli)` | `claude-cli/2.1.238 (external, claude-vscode)` |
| Request bytes | 7,210 | 7,196 |
| Request SHA-256 | `e52f890dba0f731d3d65badcd3cc0194239be7e0fa2b1dbb4e972843580dfa29` | `869e01feb2ff688e50148834da60dca9a696aecb4d7b984d443276229f16ee8d` |
| Incoming body delivery | one 7,210-byte delivery | one 7,196-byte delivery |

Both requests carried an `Authorization: Bearer …` header sourced from `ANTHROPIC_AUTH_TOKEN`; the stored value is redacted while its total serialized value length is retained. The complete ordered header lists are in the two `capture.json` files. Besides `Host`, `Content-Length`, session ID, User-Agent, and the test-only control header value, the observed header names and values matched across the two surfaces. Notably, both sent `x-app: cli`, the same eight-value `anthropic-beta` list, `anthropic-version: 2023-06-01`, `Accept-Encoding: gzip, deflate, br, zstd`, and Stainless runtime metadata.

Both request bodies used `model: deepseek-v4-flash`, `max_tokens: 32000`, `stream: true`, adaptive thinking, maximum effort, one user message, three system blocks, and zero tools. Their top-level keys were `context_management`, `max_tokens`, `messages`, `metadata`, `model`, `output_config`, `stream`, `system`, `thinking`, and `tools`.

Only three semantic body differences were observed:

- `metadata.user_id` embedded the surface's distinct session ID;
- the first system block's billing attribution used `cc_entrypoint=sdk-cli` versus `cc_entrypoint=claude-vscode`; and
- the CLI body included `thinking.display: omitted`, while the extension-entrypoint body omitted that member.

## Observed response and SSE facts

| Fact | CLI | VS Code extension entrypoint |
| --- | --- | --- |
| Upstream target | `https://api.deepseek.com/anthropic/v1/messages?beta=true` | same |
| Negotiated protocol | HTTP/1.1 | HTTP/1.1 |
| Status | `200 OK` | `200 OK` |
| Response bytes | 2,771 | 5,067 |
| Response SHA-256 | `8126326c9877314c5e69cbc969bd70e4c47309a5fb5135972d9d73c0de2b3676` | `e23761aba5248cedbb1820e1780640de3ed12869fa5ec8b865a565f9435d31ad` |
| First body delivery | 559.164 ms, 535 bytes | 436.615 ms, 535 bytes |
| Complete response | 1,454.045 ms | 1,483.109 ms |
| Application-visible delivery chunks | 7, from 126 to 851 bytes | 11, from 126 to 836 bytes |
| SSE records | 21 | 39 |

Both responses advertised `Content-Type: text/event-stream; charset=utf-8`, `Transfer-Encoding: chunked`, `Cache-Control: no-cache`, and no content encoding. DeepSeek used LF-delimited SSE records. Each stream contained `message_start`, a thinking block, a text block containing `OK`, `message_delta`, `message_stop`, and one `ping` record.

In these two observations every application-visible delivery boundary fell on an SSE record boundary, but deliveries were not one-record-per-chunk: the first 535-byte delivery contained `message_start`, `content_block_start`, and `ping`, and later deliveries also aggregated records. The fixture therefore preserves the response entity bytes and the observed delivery boundaries separately. Node's HTTP parser removed HTTP chunk-size framing; `delivery_chunks` describes the byte deliveries visible at the Recorder implementation seam, not TCP segmentation or raw chunk-size lines.

The relay wrote exactly the bytes received in each upstream delivery. For both captures, the recorded upstream response-body hash and relay hash are identical.

## Probe accounting

Three DeepSeek inference calls were made under the human-approved limit of ten. The first call went directly to DeepSeek because the cc-switch user settings overrode the initial process environment; it produced no fixture. The second and third calls produced the CLI and extension-entrypoint fixtures above. No retries reached the Recorder (`X-Stainless-Retry-Count: 0` in both captured requests).

