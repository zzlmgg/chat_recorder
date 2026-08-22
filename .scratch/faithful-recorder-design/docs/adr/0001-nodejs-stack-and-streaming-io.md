# Node.js zero-dependency stack with tee-on-read streaming for the Recorder

The standalone Linux Recorder is a two-sided application-HTTP reverse proxy that must observe every ordered header and trailer field with its original name and forward entity bodies bit-for-bit while streaming. We implement it in Node.js (`engines >=22`) with zero third-party dependencies, a hand-rolled two-hop proxy loop on the stock `http`/`https` modules, and tee-on-read streaming writes, because only Node's HTTP parser exposes `rawHeaders`/`rawTrailers` — original names, order, and duplicates — without any added parsing, and the captured target-stack fixture already proved this exact seam byte-identical. See the [Choose implementation stack and streaming I/O](../issues/07-choose-implementation-stack-and-streaming-io.md) ticket for the full resolution.

## Status

accepted

## Considered Options

- **Go**: would deliver a static binary, but `net/http` canonicalizes header names and loses cross-field order, failing the observation requirement without an extra parser dependency, and its transport auto-decompresses responses.
- **Rust (hyper/httparse)**: preserves the required header fidelity, but the implementation effort conflicts with the small-and-inspectable goal for a greenfield single-process tool.
- **Python**: standard library is a poor fit for a bidirectional streaming proxy, and the host's 3.10 is old.

## Consequences

- The Recorder requires a Node.js runtime (>=22) on the host rather than a compiled single binary; this is acceptable for the standalone tool's deployment shape.
- Framework reverse proxies (`httputil.ReverseProxy` and peers) are deliberately excluded: they normalize and reserialize envelopes the Recorder must observe unchanged.
- Upstream keep-alive behavior was not exercised by the captured fixture and must be covered by the later verification contract.
