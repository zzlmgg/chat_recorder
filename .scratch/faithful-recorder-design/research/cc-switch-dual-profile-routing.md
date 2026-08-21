# cc-switch dual-profile routing facts

Research date: 2026-08-21  
cc-switch source inspected: `v3.20.0`, commit [`0b5da510168914b251481654a568c3ffacd62cf4`](https://github.com/farion1231/cc-switch/tree/0b5da510168914b251481654a568c3ffacd62cf4)  
Scope: facts needed to keep one selectable direct DeepSeek Claude provider and add a second selectable localhost Recorder provider. Recorder internals and the final topology decision are outside this ticket.

## Bottom line

- cc-switch can store the two Claude providers as independent records. A provider row is keyed by `(id, app_type)` and has its own `settings_config`; only one Claude provider is selected as current. [cc-switch provider schema](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src-tauri/src/database/schema.rs#L25-L43)
- In **normal (non-takeover) mode**, selecting a Claude provider makes cc-switch select that record and write its effective `settingsConfig` to `~/.claude/settings.json`. The Claude endpoint, credential field, fallback model, role-model mappings, subagent model, and other provider-specific environment values are therefore selected together. [normal switch flow](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src-tauri/src/services/provider/mod.rs#L4931-L5032), [current selection and live write](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src-tauri/src/services/provider/mod.rs#L5182-L5195), [Claude live writer](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src-tauri/src/services/provider/live.rs#L1241-L1248)
- The requested pair can be represented by leaving the existing direct DeepSeek provider in place and adding a second custom Claude provider whose `settingsConfig` is the same effective DeepSeek configuration except that `env.ANTHROPIC_BASE_URL` is the Recorder's localhost base URL. This is a structural capability statement, not a recommendation of a concrete port or credential-handling design.
- That localhost provider produces `Claude Code -> Recorder` only when cc-switch's own **local-routing takeover is off**. In takeover mode, Claude Code's live base URL remains cc-switch's proxy URL and provider selection only hot-switches cc-switch's internal upstream target. [takeover branch](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src-tauri/src/services/provider/mod.rs#L4982-L5028), [takeover live fields](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src-tauri/src/services/proxy.rs#L486-L566)
- Separate rows do **not** imply byte-for-byte immutability of the stored direct profile. Before a normal switch to another provider, cc-switch reads the current Claude live settings and backfills them into the provider being switched away from. [outgoing-provider backfill](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src-tauri/src/services/provider/mod.rs#L5067-L5110) Thus cc-switch preserves the selectable direct route, but current source does not promise that the original provider record is never rewritten.

## How the two providers are represented

The following is a symbolic representation. `<existing ...>` means "copy the value from the currently working direct provider"; no source can infer those local values.

| Provider record | Direct DeepSeek | Recorder |
| --- | --- | --- |
| `name` | Existing name, e.g. `DeepSeek` | A distinct name, e.g. `Recorder` |
| `settingsConfig.env.ANTHROPIC_BASE_URL` | Existing direct DeepSeek base URL | `http://127.0.0.1:<recorder-port>` or another actual Recorder base URL |
| Auth env field | Existing one of `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` | Same field and, if the Recorder expects pass-through client authentication, the same value |
| `ANTHROPIC_MODEL` | Existing fallback model value | Same value |
| `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS,FABLE}_MODEL` and corresponding names | Existing mappings that are present | Same values |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Existing value if present | Same value |
| Other `settingsConfig` keys and env | Existing values | Same values unless a later design decision deliberately changes them |
| `meta.apiFormat` | `anthropic` or omitted (the default) for a native Anthropic Messages endpoint | `anthropic` or omitted if the Recorder exposes the native Anthropic Messages contract |
| `meta.apiKeyField` | Omitted for the default `ANTHROPIC_AUTH_TOKEN`; set to `ANTHROPIC_API_KEY` only when that non-default field is selected | Mirrors the auth field represented in `settingsConfig.env` |

The cc-switch custom form writes its Endpoint field to `env.ANTHROPIC_BASE_URL`. [base URL form state](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src/components/providers/forms/hooks/useBaseUrlState.ts#L86-L100) It defaults the Claude auth-field selector to `ANTHROPIC_AUTH_TOKEN`, infers `ANTHROPIC_API_KEY` when that is what an imported provider contains, and renames the env key when the selector is changed. [auth-field form behavior](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src/components/providers/forms/ProviderForm.tsx#L475-L483), [auth-field rename](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src/components/providers/forms/ProviderForm.tsx#L550-L571) The model form similarly writes each model control into its corresponding env key and removes a key when its value is blank. [model env writer](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src/components/providers/forms/hooks/useModelState.ts#L178-L219)

cc-switch's common-config feature does not collapse these routing values across providers. Its extraction logic explicitly excludes the base URL, fallback and role-model keys, subagent model, context-window overrides, and every key classified as a credential. [Claude provider-specific exclusions](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src-tauri/src/services/provider/mod.rs#L5633-L5684) A selected provider may still receive shared non-provider settings through the common-config merge before it is written live. [effective settings merge](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src-tauri/src/services/provider/live.rs#L673-L753)

### Why the current direct provider must be copied, not reconstructed from the preset

The current cc-switch `v3.20.0` built-in DeepSeek preset is not an "all Flash" profile. It uses `https://api.deepseek.com/anthropic` and `ANTHROPIC_AUTH_TOKEN`, but sets `ANTHROPIC_MODEL`, Sonnet, and Opus to `deepseek-v4-pro`, while Haiku is `deepseek-v4-flash`. [current cc-switch DeepSeek preset](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src/config/claudeProviderPresets.ts#L873-L890)

DeepSeek's own current Claude Code guide publishes the same base URL/auth family and shows a mixed Pro/Flash mapping, including `CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash`. It also documents server-side mapping of Claude-prefixed model names: Opus names map to Pro, while Haiku and Sonnet names map to Flash. [DeepSeek Claude Code integration](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code)

Therefore the repository's preset cannot establish what the user's already-working `deepseek-v4-flash` profile actually sends. The direct and Recorder rows must be compared against the existing local provider's full effective model env, not merely given the same display name or recreated from the current preset.

## What selection emits to Claude Code

### Normal mode

For Claude, the current implementation:

1. backfills the outgoing live configuration into the outgoing provider;
2. marks the target provider current in local settings and the database;
3. builds the target's effective settings by optionally merging common config;
4. removes only cc-switch-internal top-level fields such as `apiFormat`/`api_format` and OpenRouter compatibility markers; and
5. writes the resulting JSON as `~/.claude/settings.json`.

Sources: [backfill](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src-tauri/src/services/provider/mod.rs#L5067-L5110), [live sanitization](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src-tauri/src/services/provider/live.rs#L168-L178), and [live write](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src-tauri/src/services/provider/live.rs#L1241-L1248). cc-switch's user manual also describes provider selection as changing `~/.claude/settings.json` and says Claude Code hot-reloads the change. [switch manual](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/docs/user-manual/en/2-providers/2.2-switch.md#L53-L91)

The resulting client behavior is defined by Claude Code:

- `ANTHROPIC_BASE_URL` changes where API requests go; it does not itself select a model. [Claude Code model configuration](https://code.claude.com/docs/en/model-config)
- `ANTHROPIC_AUTH_TOKEN` is sent as `Authorization: Bearer <value>`. `ANTHROPIC_API_KEY` is sent as `X-Api-Key`; in interactive mode an API key can require one-time approval before it overrides a subscription. [Claude Code environment variables](https://code.claude.com/docs/en/env-vars)
- `ANTHROPIC_MODEL` is the environment-level initial/fallback model setting. Session `/model` and startup `--model` have higher priority. The default Opus/Sonnet/Haiku variables control what those aliases resolve to, and `CLAUDE_CODE_SUBAGENT_MODEL` controls subagents. [Claude Code model precedence and mappings](https://code.claude.com/docs/en/model-config)
- A native Anthropic gateway must expose at least `POST /v1/messages` and optionally `/v1/messages/count_tokens`; the base URL is a gateway root/prefix, not the full Messages URL. [Claude Code gateway protocol](https://code.claude.com/docs/en/llm-gateway-protocol#api-formats)

Consequently, with the symbolic pair above and no higher-priority override, selecting Direct makes Claude Code address the DeepSeek base; selecting Recorder makes it address localhost while retaining the same auth-header family and model selection env. The actual request body's `model` is still the authoritative per-exchange value.

Claude Code's VS Code extension and CLI share `~/.claude/settings.json`, so the user-level cc-switch write is visible to both. The extension also has a separate `claudeCode.environmentVariables` setting; cc-switch does not edit that VS Code setting. [Claude Code VS Code settings](https://code.claude.com/docs/en/vs-code#configure-settings) Project, local, managed, and command-line settings can have higher priority than user settings. [Claude Code settings precedence](https://code.claude.com/docs/en/settings#settings-precedence)

### cc-switch local-routing takeover mode

Takeover is materially different from the two direct profiles above:

- cc-switch rewrites live `ANTHROPIC_BASE_URL` to its own proxy (default `http://127.0.0.1:15721`) and replaces credentials with a proxy placeholder; actual provider credentials are held/injected by cc-switch.
- Selecting another provider hot-switches cc-switch's internal current target while the client endpoint remains local to cc-switch.
- Anthropic Messages can be passed through semantically; OpenAI Chat/Responses providers are protocol-converted. Thus takeover can put an additional transforming/data-plane component between Claude Code and any standalone Recorder.

Sources: [cc-switch proxy configuration changes and conversions](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/docs/user-manual/en/4-proxy/4.1-service.md#L112-L165) and [takeover mutation source](https://github.com/farion1231/cc-switch/blob/0b5da510168914b251481654a568c3ffacd62cf4/src-tauri/src/services/proxy.rs#L486-L566).

## What cc-switch does not represent or guarantee

1. **No normal-provider field carries both hops.** A normal Claude provider emits one `ANTHROPIC_BASE_URL`. If that URL is localhost, the incoming request does not also tell the Recorder the original DeepSeek origin. cc-switch does not emit a separate `RECORDER_UPSTREAM_URL`, so the Recorder's upstream origin must come from some independent runtime/configuration decision.
2. **No separate client and upstream credentials.** A normal profile has one selected Claude credential env field. cc-switch cannot tell Claude Code to authenticate to the Recorder with one value while separately handing a different DeepSeek credential to the Recorder. Reusing/forwarding the incoming credential or independently configuring upstream authentication belongs outside cc-switch.
3. **No Recorder process lifecycle.** Selecting a localhost provider neither starts the Recorder nor verifies that it is listening or that it implements all Claude Code gateway paths and streaming behavior.
4. **No session binding.** cc-switch selects a provider/application route; it does not select or lock a Claude session ID. Session identification is an HTTP fact handled at the gateway/Recorder seam.
5. **No absolute model lock.** Base URL and stored model mappings do not prevent a higher-priority `--model`, in-session `/model`, higher-precedence settings, or DeepSeek's own server-side Claude-name mapping from changing the request model.
6. **No byte-level immutability promise for the direct provider.** Normal switching backfills outgoing live state into the outgoing provider. Independent records keep the direct route selectable but do not make that stored JSON write-once.
7. **No proof that both harness surfaces use the cc-switch file.** VS Code-specific environment variables, process environment, managed/project/local settings, a custom Claude config directory, and already-running client behavior can change the effective route.

## Facts that require a live/local probe

The following should remain unknown until inspected on the target machine without publishing credential values:

1. Installed cc-switch version/commit and whether its behavior matches `v3.20.0`.
2. Whether Claude local-routing takeover is enabled, including whether stale takeover backup/live markers cause cc-switch to take the hot-switch path even when the proxy UI appears stopped.
3. The current direct provider's exact `settingsConfig`, `meta.apiFormat`, `meta.apiKeyField`, common-config enablement, custom endpoint selection, and configured Claude config directory.
4. The direct provider's effective, secret-redacted `~/.claude/settings.json`: exact base URL/path prefix, which one auth field is present, all model/role/subagent mappings, context markers, and any other provider-owned env.
5. Whether the current DeepSeek route is the official `https://api.deepseek.com/anthropic` endpoint, an aggregator, or another compatible endpoint.
6. The Recorder's actual listen origin/path and whether `POST <base>/v1/messages` (plus any auxiliary paths in scope) reaches it.
7. Whether CLI and VS Code use the same effective base/auth/model settings. Check VS Code's `claudeCode.environmentVariables`, shell/process variables, all Claude settings scopes, and `/status`; do not assume the shared user file wins.
8. Whether the installed Claude Code/extension hot-reloads a provider switch inside an already-running session, despite the cc-switch manual's general claim.
9. Before/after secret-redacted snapshots of the direct provider row when switching away and back, to measure the backfill effect and establish whether the user's meaning of "unchanged" is satisfied.
10. A real request through each profile showing the observed destination, auth-header name (not value), request `model`, and `x-claude-code-session-id`. This is the only conclusive end-to-end check that selection emitted the intended route.

## Bounded conclusion for later decision tickets

Current first-party evidence supports two separately selectable Claude provider records and identifies the exact field-level delta that distinguishes their client destinations. It does not establish the user's local direct profile values, a concrete Recorder port/upstream configuration, or a byte-immutability guarantee for the existing provider. Those are deliberately left for local probing and subsequent design decisions.
