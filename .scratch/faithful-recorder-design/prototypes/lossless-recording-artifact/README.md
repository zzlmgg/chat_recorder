# Lossless recording artifact prototype

This is a deliberately minimal, synthetic one-Model-Exchange recording for review. It proposes this shape:

```text
session-a11f5b03-c280-4dc6-8c52-f0967d48948e/
├── index.json
└── exchange-000001/
    ├── request.json
    ├── request.body
    ├── upstream-request.json
    ├── response.json
    └── response.body
```

- The session directory name carries the reversibly encoded locked `session_id`; `index.json` also retains its exact value.
- The ordered `exchanges` array defines Harness/Model conversation order. An exchange's position is assigned when its complete Harness request headers are admitted; it does not encode network latency or a global transport-event timeline.
- One exchange directory pairs its Harness request, actual upstream request metadata, and Model response without embedding capture metadata into any entity bytes.
- `request.json` and `response.json` preserve the application-level HTTP start-line fields plus ordered, duplicate-preserving header and trailer fields. Exact header-line whitespace and HTTP transfer framing are outside the fidelity boundary.
- `request.body` and `response.body` are opaque files containing exactly the observed entity bytes. They exist even for a zero-length entity.
- `upstream-request.json` records the application-level request actually emitted to the Model. Its `entity_file` refers to the same `request.body`, expressing the required byte equality without storing a second copy.
