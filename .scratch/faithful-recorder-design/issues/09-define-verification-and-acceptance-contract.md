# Define end-to-end verification and acceptance contract

Type: grilling
Status: open
Blocked by: 03, 04, 05, 06, 07, 08

## Question

What automated fixtures and live acceptance scenarios prove that every Model Exchange for the locked Harness Session is recorded in order with byte-identical plaintext HTTP content while Claude Code CLI and VS Code still receive the Model's streamed responses?

## Note from 07

The stack decision (Node.js ≥22, zero dependencies, `node:test`, fixture replay) makes automated acceptance feasible. Upstream keep-alive was not exercised by the captured target-stack fixture and should be covered by this contract.
