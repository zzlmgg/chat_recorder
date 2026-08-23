# 20 — Automate verified-stack live acceptance and operating flow

**What to build:** On a configured Linux host, a human can follow the decided Direct Model Profile and Recorder Profile workflow and run automated live acceptance for both supported Harness entrypoints without opening the VS Code UI or allowing the Recorder to manage cc-switch.

**Blocked by:** 19 — Replay both captured Harness fixtures end-to-end.

**Status:** resolved

- [x] Operator guidance keeps the Direct Model Profile independently selectable and creates the Recorder Profile by copying the complete effective configuration and changing only `ANTHROPIC_BASE_URL` to the Recorder listen base.
- [x] The operating flow explicitly keeps cc-switch local-routing takeover disabled, supplies the real upstream base URL and output root at Recorder launch, selects the Recorder Profile for capture, stops and drains the Recorder, and returns to the Direct Model Profile by human selection.
- [x] A configured live CLI scenario starts a fresh Recorder and Harness Session, runs the verified `sdk-cli` entrypoint non-interactively, observes normal streamed completion, and validates a complete session artifact.
- [x] A configured live VS Code scenario starts another fresh Recorder and Harness Session, runs the extension-shipped `claude-vscode` executable with the specified launcher environment and no UI automation, observes normal streamed completion, and validates a complete session artifact.
- [x] Live acceptance is explicitly opt-in, reports missing host configuration clearly, and never reads, edits, reconstructs, validates, or switches either cc-switch profile.
- [x] Compatibility reporting remains limited to the versions in the Verified table; recorded `User-Agent` values are passive provenance and a successful run does not automatically expand the compatibility claim.
- [x] Overall acceptance reports success only after the offline replay suite and both live entrypoint scenarios succeed; retained live artifacts are candidates for future fixtures, not independent byte truth.

## Answer

[The operating and live-acceptance guide](../../../docs/live-acceptance.md) now records the complete human-owned Direct Model Profile / Recorder Profile flow, including the one-field base-URL change, disabled cc-switch local-routing takeover, explicit Recorder launch inputs, normal drain, and human return to the Direct Model Profile. It also preserves the exact Verified table and explains that `User-Agent` output is passive provenance only.

`npm run acceptance` preflights an explicit live opt-in and the four required host paths/values, runs the complete offline replay/test suite, and only then drives `sdk-cli` and `claude-vscode` sequentially. Each scenario uses a fresh UUID Harness Session and Recorder, applies the specified launcher environment without UI or profile automation, stops and drains the Recorder, and validates a non-empty successful SSE recording plus the ordered five-file artifact for every admitted Model Exchange. `npm run acceptance:live` is available for live-only repetition but does not claim overall acceptance. Every run retains a new artifact directory as a future-fixture candidate rather than treating it as independent byte truth.
