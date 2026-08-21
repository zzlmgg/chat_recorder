# Recorder

This context names the participants and boundary of a faithful recording of Claude Code model traffic.

## Language

**Harness**:
Claude Code, used through either its CLI or its VS Code extension, as the participant that conducts a session and communicates with a Model.
_Avoid_: Hardness

**Model**:
The DeepSeek V4 Flash model selected for the Harness through cc-switch configuration.

**Model Exchange**:
One complete application-level model API request emitted by the Harness together with the corresponding complete application-level response emitted by the Model, including all source-emitted fields and the exact entity byte sequence. Wire syntax, transfer framing, and runtime delivery boundaries are not Model Exchange content.
_Avoid_: User turn, conversation turn

**Harness Session**:
One Claude Code session identified at the model API boundary by its stable `x-claude-code-session-id` request header.
_Avoid_: Recorder session

**Recorder**:
A passive observer that locks onto the first Harness Session observed after startup and records its Model Exchanges without changing their content or format; the lock lasts until the human stops the Recorder.

**Direct Model Profile**:
The existing cc-switch configuration that routes the Harness directly to the Model without using the Recorder.
_Avoid_: Original configuration

**Recorder Profile**:
A separate cc-switch configuration that routes the Harness through the Recorder while leaving the Direct Model Profile unchanged and available.
