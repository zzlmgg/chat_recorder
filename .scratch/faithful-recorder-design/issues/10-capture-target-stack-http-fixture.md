# Capture the target-stack HTTP fixture

Type: task
Status: resolved
Blocked by: 01, 02

## Question

Run the installed Claude Code CLI and VS Code extension through a diagnostic Recorder route to capture the exact request methods, paths, headers—including `x-claude-code-session-id`—bodies, upstream response headers, and SSE byte/chunk behavior produced by the actual cc-switch and DeepSeek V4 Flash configuration, so the observation and fidelity decisions rely on measured target-stack facts rather than protocol assumptions.

## Answer

[Target-stack HTTP fixture](../fixtures/target-stack-http/README.md) records two successful Model Exchanges from the installed Claude Code `2.1.238` client binary: one with the CLI `sdk-cli` entrypoint and one with the official VS Code extension's `claude-vscode` entrypoint. The current cc-switch `3.15.0` `DeepSeek` provider remained unedited; its real auth and model configuration was used with only a per-process base-URL override to the one-shot diagnostic listener. Credential values are excluded from the fixture.

Both surfaces sent HTTP/1.1 `POST /v1/messages?beta=true` with distinct, correctly propagated `X-Claude-Code-Session-Id` values, `Authorization: Bearer …`, `model: deepseek-v4-flash`, `stream: true`, and the same open-list beta/version/runtime headers. The ordered header pairs and exact JSON entity bytes are retained. The measured surface differences were the session ID, User-Agent entrypoint, the system billing attribution entrypoint, and presence of `thinking.display: omitted` only on the CLI request.

DeepSeek received `/anthropic/v1/messages?beta=true` and returned HTTP/1.1 `200 OK`, `text/event-stream; charset=utf-8`, and `Transfer-Encoding: chunked`. The exact SSE entity bytes, response headers, event indexes, and application-visible delivery boundaries are retained for both responses. The observed streams used LF record delimiters and included `ping`, thinking, text, and terminal message events. Delivery chunks could aggregate multiple whole SSE records, so SSE record boundaries and delivery boundaries are separate fidelity dimensions. Raw HTTP chunk-size lines, TLS records, and TCP segmentation are not represented; Node's HTTP parser exposes entity-byte deliveries at the intended Recorder implementation seam.

The VS Code evidence uses the byte-identical native executable shipped by the installed official extension and the launch environment established by its extension code. It covers the extension-owned model client/entrypoint, while deliberately not claiming to capture UI-to-extension-host IPC.
