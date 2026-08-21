# Define single-session acquisition and lock lifecycle

Type: grilling
Status: resolved
Blocked by: 01, 10

## Question

What exact observable event acquires the first Harness Session, how is its `session_id` compared and represented in filenames, and what normal start/locked/manual-stop lifecycle constitutes one complete recording?

## Answer

Starting the Recorder script starts listening in an unlocked state. The first request whose headers have been completely received acquires the Harness Session lock when it is an in-scope `POST` to the supported `/v1/messages` path and contains exactly one non-empty `x-claude-code-session-id` field. The query string is preserved but does not affect this eligibility test. Auxiliary traffic such as `count_tokens`, unknown paths, and requests without a usable session header cannot acquire the lock. Acquisition happens at header completion, before the request entity or upstream response completes, so the acquiring Model Exchange is included in full.

HTTP field names are case-insensitive. For identity, remove optional whitespace surrounding the single field value and then treat the remaining `session_id` as an opaque, case-sensitive value compared exactly; do not parse it as a UUID or normalize its case. This avoids relying on the UUID-shaped values seen in the target-stack fixture as an undocumented format contract.

Where a filename needs to carry the identity, use a reversible component prefixed with `session-`: encode the `session_id` as UTF-8, leave ASCII `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-` unchanged, and percent-encode every other byte as uppercase `%HH`. Thus the UUID-shaped IDs observed in the fixture remain directly readable. The recording-artifact decision owns where this component appears in the eventual directory and file layout.

The normal lifecycle is intentionally simple:

1. The human starts the Recorder script; it listens unlocked.
2. The first eligible Model Exchange locks it to one Harness Session and is recorded completely.
3. While the script remains open, every Model Exchange carrying that same `session_id` is recorded in the same session folder. The lock is not released or rotated during the run.
4. When the human closes the Recorder script normally, it accepts no new Model Exchanges, lets any already-admitted exchange finish so the final complete interaction is written, retains all Model Exchanges already saved for the Harness Session, closes the recording, and exits. No additional completion-marker, publication, or persistent-lock protocol is required.

If no Harness Session was ever acquired, there is no session content to save. Crash behavior, forced termination, malformed traffic, and traffic for another `session_id` remain outside this effort's stated scope.
