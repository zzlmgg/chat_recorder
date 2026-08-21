# Design the lossless recording artifact

Type: prototype
Status: resolved
Blocked by: 01, 03, 04

## Question

What concrete session directory, index, and per-Model-Exchange request/response file layout preserves complete plaintext HTTP messages byte-for-byte, represents ordering and pairing without altering captured bytes, and visibly incorporates the locked `session_id` in its names?

## Answer

Use the concrete layout validated in the [lossless recording artifact prototype](../prototypes/lossless-recording-artifact/README.md):

```text
session-<reversibly-encoded-session_id>/
├── index.json
└── exchange-000001/
    ├── request.json
    ├── request.body
    ├── upstream-request.json
    ├── response.json
    └── response.body
```

The session directory name carries the locked `session_id` using the already-decided reversible `session-` encoding, while `index.json` retains the exact opaque value. Its `exchanges` array lists exchange-directory names in the order their complete Harness request headers were admitted. That order represents the Harness/Model conversation order; it deliberately does not represent network latency or a global timeline of overlapping transport events.

Each exchange directory is the pairing boundary: `request.json` and `request.body` are the Harness request, `response.json` and `response.body` are its Model response, and `upstream-request.json` makes the proxy's actual upstream request envelope auditable. The upstream request metadata references the same `request.body`, expressing the required entity-byte equality without duplicating or altering those bytes.

The request and response JSON files store their application-level HTTP start-line fields and ordered, duplicate-preserving header and trailer pairs. Their `.body` files always exist, including for an empty entity, and contain exactly the observed entity byte sequence without parsing or reserialization. Exact header-line whitespace, HTTP transfer framing, delivery chunks, timing, TLS, and TCP details remain outside the fidelity boundary.
