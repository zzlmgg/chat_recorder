# Establish Claude Code transport and session facts

Type: research
Status: resolved

## Question

For current Claude Code CLI and VS Code clients using an Anthropic-compatible model endpoint, what exact HTTP request/response protocol crosses the configured base URL, how are streaming responses represented, and where—if anywhere—is a stable Claude Code `session_id` observable without relying on the human-facing transcript?

## Answer

Current Claude Code clients routed with `ANTHROPIC_BASE_URL` use the Anthropic Messages API (`POST /v1/messages?beta=true`, with optional token-count traffic) and require incremental SSE responses. Since Claude Code 2.1.86, model API requests carry the stable, case-insensitive `x-claude-code-session-id` header, documented specifically for aggregating all requests from one Claude Code session; resume keeps the session ID and fork/clear creates a new one. CLI and VS Code use the same underlying Claude Code process/engine, though VS Code gateway variables should be supplied through its extension setting. Exact raw wire details, complete evolving header/body fields, and DeepSeek/cc-switch compatibility still require a target-version live probe. See [Claude Code transport and session facts](../research/claude-code-transport-and-session.md).
