# Set supported-version and client compatibility contract

Type: grilling
Status: resolved
Blocked by: 01, 02, 03

## Question

How should the specification state and detect compatibility across Claude Code CLI, the Claude Code VS Code extension, cc-switch, and the configured DeepSeek V4 Flash endpoint on Linux without claiming unverified future-version support?

## Answer

Two tiers, as simple as possible: the specification lists only a short **Verified** table (measured 2026-08-21 on Linux), and anything not listed is explicitly not claimed — no version floors, ranges, or future-version statements for any component.

Verified:

- Claude Code CLI and VS Code extension: **2.1.238** (`sdk-cli` and `claude-vscode` entrypoints)
- VS Code host: **1.116.0**
- cc-switch: **3.15.0**
- DeepSeek endpoint: **https://api.deepseek.com/anthropic** (`deepseek-v4-flash`)

The Recorder itself has no version logic at all: admission depends only on the session header (ticket 04), not on any version, and there is no version parsing, warning, or refusal of any traffic. The only runtime "detection" is passive provenance — the client version is recoverable from the recorded request metadata's verbatim `User-Agent`; `x-stainless-*` fields are not a compatibility signal. This adds no acceptance burden to the verification contract (ticket 09).
