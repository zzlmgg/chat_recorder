# Establish cc-switch dual-profile routing facts

Type: research
Status: resolved

## Question

Using current first-party cc-switch documentation or source, how can two independent Claude provider profiles represent the unchanged direct DeepSeek route and a localhost Recorder route, and which endpoint, authentication, model, and environment settings are selected or emitted when switching between them?

## Answer

[Research: cc-switch dual-profile routing facts](../research/cc-switch-dual-profile-routing.md) — cc-switch can retain two independent Claude provider records; in normal mode selection writes the chosen provider's effective endpoint/auth/model env to `~/.claude/settings.json`, whereas takeover mode keeps Claude pointed at cc-switch's own proxy. A Recorder record can mirror the working DeepSeek record with only its base URL changed to localhost, but cc-switch supplies no separate Recorder-upstream field and its outgoing-provider backfill means stored-profile byte immutability requires a local probe.
