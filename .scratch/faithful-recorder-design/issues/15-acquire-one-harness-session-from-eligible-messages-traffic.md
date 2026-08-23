# 15 — Acquire one Harness Session from eligible Messages traffic

**What to build:** The Recorder starts unlocked and automatically selects exactly one Harness Session from the first eligible Messages request, while auxiliary or ambiguous traffic cannot select or rotate the recording.

**Blocked by:** 13 — Preserve and audit the Harness request envelope.

**Status:** ready-for-agent

- [ ] Lock acquisition occurs synchronously at completed request headers for the first `POST` whose path is exactly `/v1/messages` and whose raw fields contain exactly one non-empty case-insensitive `x-claude-code-session-id` field.
- [ ] The request query is preserved but ignored for eligibility, and the acquiring Model Exchange is admitted before its entity or response completes.
- [ ] Missing, empty, or duplicated session fields, non-POST methods, other paths, and auxiliary traffic neither acquire the lock nor create Model Exchange entries.
- [ ] Surrounding optional whitespace is removed for identity, after which the value remains opaque and case-sensitive without UUID validation or case folding.
- [ ] Session directory naming reversibly percent-encodes UTF-8 bytes using the specified safe character set, while the index retains the exact normalized identity.
- [ ] Later eligible requests with the exact locked identity are admitted to the same artifact; any other identity cannot rotate the lock or enter that artifact.
- [ ] Tests exercise field-name casing, optional whitespace, duplicate raw fields, exact case sensitivity, a non-UUID Unicode identity, and auxiliary traffic before acquisition.

