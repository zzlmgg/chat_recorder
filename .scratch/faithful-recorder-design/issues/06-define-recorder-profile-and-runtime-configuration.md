# Define Recorder Profile and runtime configuration contract

Type: grilling
Status: resolved
Blocked by: 02, 03

## Question

What settings belong in the separately created Recorder Profile, what upstream endpoint and credentials must the Recorder receive at launch, and what CLI/configuration contract keeps the existing Direct Model Profile untouched?

## Answer

Keep cc-switch as the profile selector but out of the recording data path. The existing **Direct Model Profile** remains the independently selectable direct route and is never read, edited, reconstructed, or managed by the Recorder. The human separately creates a distinctly named **Recorder Profile** by copying the Direct Model Profile's complete effective provider configuration and metadata, changing only `env.ANTHROPIC_BASE_URL` to `http://127.0.0.1:4318`.

The copied fields include the credential value and its exact selected field (`ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`), fallback and role-model mappings, subagent model, other effective Claude settings, `meta.apiFormat`, and `meta.apiKeyField`. Copy the working profile rather than recreating it from a cc-switch preset. Do not place Recorder-private settings in either cc-switch profile.

Use cc-switch in normal profile-switching mode with its local-routing takeover disabled. During recording, cc-switch remains a control-plane tool that selects the Recorder Profile; the data path is exactly `Harness -> Recorder -> Model`, with no cc-switch proxy in front of the Recorder. Switching back to the Direct Model Profile restores `Harness -> Model` without a Recorder operation against either profile.

The Recorder does not receive a separate upstream credential at launch. It forwards the Harness's end-to-end authentication header and value unchanged on each request, along with the other end-to-end fields already covered by the forwarding-seam decision. This keeps the Recorder Profile equal to the Direct Model Profile except for its base URL and avoids adding credential substitution to the permitted upstream-envelope differences.

The complete minimal runtime contract is one CLI invocation:

```text
recorder \
  --upstream-base-url <absolute-base-url> \
  --output-root <directory> \
  [--listen 127.0.0.1:4318]
```

- `--upstream-base-url` is required and is copied manually from the Direct Model Profile's effective `ANTHROPIC_BASE_URL`. It is an absolute `http` or `https` Claude gateway base URL, may include a path prefix, and is not a complete `/v1/messages` endpoint. The Recorder maps a request upstream by joining this base path with the Harness request target's path while preserving its query; for example, base `https://api.deepseek.com/anthropic` plus `/v1/messages?beta=true` addresses `https://api.deepseek.com/anthropic/v1/messages?beta=true`.
- `--output-root` is required and names the parent under which the already-decided `session-<reversibly-encoded-session_id>/` artifact directory is created.
- `--listen` is optional and defaults to the loopback socket `127.0.0.1:4318`; the Recorder Profile uses the corresponding base URL `http://127.0.0.1:4318`.

There is no configuration file, environment-variable override layer, credential option, profile-management option, or cc-switch integration in this contract. Start the Recorder with the Direct route's upstream base URL, then select the Recorder Profile; stopping and switching profiles remain explicit human operations.

Here, keeping the Direct Model Profile "unchanged" means this design performs and prescribes no mutation of that profile. cc-switch's own normal-mode outgoing-profile backfill may rewrite its stored record when the human switches profiles, so byte-for-byte immutability of cc-switch's storage is not a guarantee the standalone Recorder can make.
