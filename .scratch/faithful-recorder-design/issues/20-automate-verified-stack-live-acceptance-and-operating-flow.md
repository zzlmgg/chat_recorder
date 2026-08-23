# 20 — Automate verified-stack live acceptance and operating flow

**What to build:** On a configured Linux host, a human can follow the decided Direct Model Profile and Recorder Profile workflow and run automated live acceptance for both supported Harness entrypoints without opening the VS Code UI or allowing the Recorder to manage cc-switch.

**Blocked by:** 19 — Replay both captured Harness fixtures end-to-end.

**Status:** ready-for-agent

- [ ] Operator guidance keeps the Direct Model Profile independently selectable and creates the Recorder Profile by copying the complete effective configuration and changing only `ANTHROPIC_BASE_URL` to the Recorder listen base.
- [ ] The operating flow explicitly keeps cc-switch local-routing takeover disabled, supplies the real upstream base URL and output root at Recorder launch, selects the Recorder Profile for capture, stops and drains the Recorder, and returns to the Direct Model Profile by human selection.
- [ ] A configured live CLI scenario starts a fresh Recorder and Harness Session, runs the verified `sdk-cli` entrypoint non-interactively, observes normal streamed completion, and validates a complete session artifact.
- [ ] A configured live VS Code scenario starts another fresh Recorder and Harness Session, runs the extension-shipped `claude-vscode` executable with the specified launcher environment and no UI automation, observes normal streamed completion, and validates a complete session artifact.
- [ ] Live acceptance is explicitly opt-in, reports missing host configuration clearly, and never reads, edits, reconstructs, validates, or switches either cc-switch profile.
- [ ] Compatibility reporting remains limited to the versions in the Verified table; recorded `User-Agent` values are passive provenance and a successful run does not automatically expand the compatibility claim.
- [ ] Overall acceptance reports success only after the offline replay suite and both live entrypoint scenarios succeed; retained live artifacts are candidates for future fixtures, not independent byte truth.
