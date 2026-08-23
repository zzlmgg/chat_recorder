# Operating and live-acceptance guide

This guide covers the human-controlled Direct Model Profile / Recorder Profile workflow and the automated acceptance of the two Verified Harness entrypoints. The Recorder and its acceptance driver never read, edit, reconstruct, validate, or switch a cc-switch profile.

Recording artifacts contain credentials and private Harness context without redaction. Choose and protect the output root accordingly.

## Prepare the two profiles

Keep the working **Direct Model Profile** independently selectable. Create a distinctly named **Recorder Profile** by copying the Direct Model Profile's complete effective provider configuration. Change only `env.ANTHROPIC_BASE_URL`, setting it to the Recorder listen base (`http://127.0.0.1:4318` by default).

The copy includes the exact credential field and value (`ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`), fallback and role-model mappings, subagent model, every other effective Claude setting, `meta.apiFormat`, and `meta.apiKeyField`. Copy the working profile; do not recreate it from a cc-switch preset.

Keep cc-switch's local-routing takeover disabled whenever recording. cc-switch is only the human-operated profile selector; the data path must remain:

```text
Harness -> Recorder -> Model
```

The Recorder cannot confirm these profile preconditions because inspecting cc-switch would violate its operating boundary.

## Record an ordinary Harness Session

1. Confirm that the Direct Model Profile remains available and local-routing takeover is disabled.
2. Start the Recorder with the real Direct route base URL and the chosen output root:

   ```bash
   node src/index.mjs \
     --upstream-base-url https://api.deepseek.com/anthropic \
     --output-root /absolute/path/to/recordings
   ```

3. Select the Recorder Profile in cc-switch.
4. Start or resume the one Harness Session intended for this Recorder process, then use Claude Code through the CLI or VS Code extension normally.
5. Send `SIGINT` with `Ctrl+C` (or send `SIGTERM`) to stop. The Recorder closes admission, drains every already-admitted Model Exchange, finalizes the artifacts, and then exits.
6. Select the Direct Model Profile yourself when direct routing is wanted again.

If `--listen host:port` is supplied, set the Recorder Profile's only changed field, `ANTHROPIC_BASE_URL`, to the corresponding `http://host:port` base.

## Configure live acceptance

Live acceptance is deliberately excluded from `npm test`: it contacts the real Model and can incur inference cost. It runs only when `RECORDER_LIVE_ACCEPTANCE=1` is set and reports every missing required host value before starting a Recorder.

On a configured Linux host, select the Recorder Profile, confirm local-routing takeover is disabled, and provide:

```bash
export RECORDER_LIVE_ACCEPTANCE=1
export RECORDER_LIVE_UPSTREAM_BASE_URL=https://api.deepseek.com/anthropic
export RECORDER_LIVE_OUTPUT_ROOT=/absolute/path/to/live-recordings
export RECORDER_LIVE_CLI_PATH=/absolute/path/to/the/installed/claude
export RECORDER_LIVE_VSCODE_PATH=/absolute/path/to/the/extension-shipped/claude

npm run acceptance
```

The two executable variables must be absolute paths. `RECORDER_LIVE_VSCODE_PATH` must identify the native executable shipped by the installed official extension, not a wrapper that opens VS Code.

Optional inputs are:

| Variable | Default | Purpose |
| --- | --- | --- |
| `RECORDER_LIVE_LISTEN` | `127.0.0.1:4318` | Recorder listen socket; the selected Recorder Profile must use the matching base. |
| `RECORDER_LIVE_PROMPT` | `Reply with exactly OK.` | Non-interactive prompt sent to each fresh Harness Session. |

`npm run acceptance` first runs the complete offline `node:test` suite, including both captured-fixture replays. Only after it passes does the driver run, in order:

1. a fresh Recorder and UUID-backed Harness Session using the installed CLI with the `sdk-cli` entrypoint and `-p`;
2. another fresh Recorder and Harness Session using the extension-shipped executable with `CLAUDE_CODE_ENTRYPOINT=claude-vscode`, `MCP_CONNECTION_NONBLOCKING=true`, and `CLAUDE_CODE_ENABLE_TASKS=0`.

No VS Code window, webview, extension-host UI automation, or cc-switch automation is involved. For each scenario, success requires a normal client exit with response output, a successful recorded SSE response, and a complete session artifact containing an ordered index and all five files for every admitted Model Exchange. Each Recorder receives a normal stop and drains before validation.

`npm run acceptance:live` runs only the two live scenarios. It is useful after the offline suite is already known green, but it is not the overall acceptance result.

Each invocation retains its artifacts under a new `live-acceptance-*` directory inside `RECORDER_LIVE_OUTPUT_ROOT`. These artifacts can be reviewed as future fixture candidates. They are not independent byte truth; byte fidelity remains established by the three-way offline fixture replay.

## Verified compatibility claim

The compatibility claim is limited to the stack measured on Linux on 2026-08-21:

| Component | Verified value |
| --- | --- |
| Claude Code CLI entrypoint | `2.1.238` (`sdk-cli`) |
| Claude Code VS Code extension entrypoint | `2.1.238` (`claude-vscode`) |
| VS Code host | `1.116.0` |
| cc-switch | `3.15.0` |
| DeepSeek endpoint | `https://api.deepseek.com/anthropic` |
| Model observed in request | `deepseek-v4-flash` |

The driver reports recorded `User-Agent` values only as passive provenance. It performs no client or cc-switch version parsing, warning, allowlisting, or refusal. A successful run on any other version does not expand this table; changing the compatibility claim requires an explicit specification update backed by reviewed evidence.
