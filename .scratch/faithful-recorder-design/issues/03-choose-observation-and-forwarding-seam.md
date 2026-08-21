# Choose the Recorder's observation and forwarding seam

Type: grilling
Status: resolved
Blocked by: 01, 02, 10

## Question

At which concrete protocol seam should the Recorder terminate, observe, preserve, and forward traffic so that it captures complete plaintext HTTP Model Exchanges from both Claude Code clients without parsing or reserializing their headers or bodies?

## Answer

Choose a two-sided, streaming **application-level HTTP reverse-proxy seam**: terminate the Harness's loopback HTTP/1.1 connection at an HTTP message interface, establish and terminate the separate TLS/HTTP/1.1 connection to the Model, and observe each source's application message before any content codec or semantic parser.

The two authoritative observations are deliberately source-sided:

- On Harness ingress, capture the HTTP version, method, original request target, every ordered header and trailer field with its original name and value, and the exact request entity byte sequence. Record every value without redaction, including credentials and any private context.
- On Model ingress, after upstream TLS termination, capture the HTTP version, status, reason, every ordered header and trailer field with its original name and value, and the exact response entity byte sequence.
- Also expose the upstream request metadata so the later artifact can make every proxy-induced difference from the Harness request auditable rather than silently treating the proxy's reconstruction as what the Harness emitted.

Forward both entity bodies as opaque, ordered byte streams. The Recorder must never parse or regenerate JSON or SSE, decompress or recompress content, normalize delimiters, redact values, inject inference content, or wait for a complete body before forwarding. The concatenated request entity bytes sent upstream must be bit-for-bit identical to those received from the Harness; the concatenated response entity bytes sent to the Harness must be bit-for-bit identical to those received from the Model. Backpressure may split or coalesce runtime delivery chunks, because chunk boundaries and timing are not message content.

The only permitted differences are the closed set required to create the second HTTP hop: map the request target onto the configured upstream base-path, replace `Host`, and manage hop-by-hop headers, HTTP transfer framing, connections, and TLS. Preserve the method and forward all end-to-end header and trailer fields as an open list without semantic transformation. The later verification contract must prove body equality in both directions and enumerate the observed routing-envelope differences.

This decision refines “without parsing or reserializing headers or bodies”: entity bodies may not be parsed or reserialized; an HTTP stack may parse and serialize the transport envelope, while the Recorder separately preserves every source-emitted application header/trailer field. Exact header-line whitespace, HTTP chunk-size lines, TLS records, TCP segmentation, and application delivery boundaries are outside the fidelity boundary.

The target-stack fixture already exercises this seam successfully: its upstream and relayed SSE entity hashes match for both the CLI and VS Code extension entrypoints. A raw-socket HTTP framer or transparent TLS MITM would add substantial protocol and trust complexity without preserving more of the inference-bearing content required here; TLS pass-through cannot observe the session header or plaintext content at all.
