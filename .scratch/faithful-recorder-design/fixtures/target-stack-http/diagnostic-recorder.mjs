#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";

const listenHost = process.env.LISTEN_HOST ?? "127.0.0.1";
const listenPort = Number(process.env.LISTEN_PORT ?? "18765");
const upstreamBase = new URL(process.env.UPSTREAM_BASE ?? "https://api.deepseek.com/anthropic");
const captureRoot = path.resolve(process.env.CAPTURE_ROOT ?? "./capture");
const surface = process.env.SURFACE ?? "unknown";
const probeToken = process.env.PROBE_TOKEN;

if (!probeToken) throw new Error("PROBE_TOKEN is required");

fs.mkdirSync(captureRoot, { recursive: true });

let sequence = 0;

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function headerPairs(rawHeaders, redact = false) {
  const pairs = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    let value = rawHeaders[index + 1];
    if (redact && /^(authorization|proxy-authorization|x-api-key|x-recorder-probe|cookie|set-cookie)$/i.test(name)) {
      const scheme = /^\s*([^\s]+)\s+/.exec(value)?.[1];
      value = scheme
        ? `${scheme} <redacted:${Buffer.byteLength(value)} bytes total>`
        : `<redacted:${Buffer.byteLength(value)} bytes>`;
    }
    pairs.push([name, value]);
  }
  return pairs;
}

function outgoingHeaders(rawHeaders) {
  const result = {};
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const lower = name.toLowerCase();
    const value = rawHeaders[index + 1];
    if (["host", "connection", "proxy-connection", "transfer-encoding", "x-recorder-probe"].includes(lower)) continue;
    if (result[name] === undefined) result[name] = value;
    else if (Array.isArray(result[name])) result[name].push(value);
    else result[name] = [result[name], value];
  }
  result.Host = upstreamBase.host;
  result.Connection = "close";
  return result;
}

function downstreamRawHeaders(rawHeaders) {
  const excluded = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]);
  const result = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (!excluded.has(rawHeaders[index].toLowerCase())) {
      result.push(rawHeaders[index], rawHeaders[index + 1]);
    }
  }
  return result;
}

function upstreamTarget(incomingTarget) {
  const prefix = upstreamBase.pathname.replace(/\/$/, "");
  return `${prefix}${incomingTarget.startsWith("/") ? incomingTarget : `/${incomingTarget}`}`;
}

function safeName(target) {
  return target
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "root";
}

function sseIndex(body) {
  const records = [];
  let cursor = 0;
  while (cursor < body.length) {
    const lfBoundary = body.indexOf("\n\n", cursor, "utf8");
    const crlfBoundary = body.indexOf("\r\n\r\n", cursor, "utf8");
    let end = -1;
    let delimiterLength = 0;
    if (lfBoundary !== -1 && (crlfBoundary === -1 || lfBoundary < crlfBoundary)) {
      end = lfBoundary;
      delimiterLength = 2;
    } else if (crlfBoundary !== -1) {
      end = crlfBoundary;
      delimiterLength = 4;
    }
    if (end === -1) end = body.length;
    const recordEnd = Math.min(body.length, end + delimiterLength);
    const bytes = body.subarray(cursor, recordEnd);
    const text = bytes.toString("utf8");
    const event = /(?:^|\r?\n)event:\s*([^\r\n]+)/.exec(text)?.[1] ?? null;
    const dataText = [...text.matchAll(/(?:^|\r?\n)data:\s*([^\r\n]*)/g)].map((match) => match[1]).join("\n");
    let dataType = null;
    if (dataText) {
      try { dataType = JSON.parse(dataText).type ?? null; } catch {}
    }
    records.push({
      offset: cursor,
      length: bytes.length,
      sha256: sha256(bytes),
      event,
      data_type: dataType,
      delimiter: delimiterLength === 4 ? "crlf" : delimiterLength === 2 ? "lf" : null,
    });
    if (recordEnd === cursor) break;
    cursor = recordEnd;
  }
  return records;
}

function writeCapture(directory, metadata, requestBody, responseBody) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "request-body.bin"), requestBody);
  fs.writeFileSync(path.join(directory, "response-body.bin"), responseBody);
  fs.writeFileSync(path.join(directory, "capture.json"), `${JSON.stringify(metadata, null, 2)}\n`);
}

const server = http.createServer((request, response) => {
  if (request.headers["x-recorder-probe"] !== probeToken) {
    response.writeHead(403, { "content-type": "text/plain", connection: "close" });
    response.end("probe token required\n");
    return;
  }

  const requestStartedAt = new Date().toISOString();
  const monotonicStart = process.hrtime.bigint();
  const ordinal = sequence++;
  const directory = path.join(
    captureRoot,
    `${String(ordinal).padStart(3, "0")}-${request.method.toLowerCase()}-${safeName(request.url)}`,
  );
  const requestChunks = [];
  const requestChunkIndex = [];

  request.on("data", (chunk) => {
    const bytes = Buffer.from(chunk);
    requestChunks.push(bytes);
    requestChunkIndex.push({
      offset: requestChunks.reduce((total, value) => total + value.length, 0) - bytes.length,
      length: bytes.length,
      elapsed_us: Number((process.hrtime.bigint() - monotonicStart) / 1000n),
      sha256: sha256(bytes),
    });
  });

  request.on("end", () => {
    const requestBody = Buffer.concat(requestChunks);
    const responseChunks = [];
    const responseChunkIndex = [];
    const target = upstreamTarget(request.url);
    const transport = upstreamBase.protocol === "http:" ? http : https;
    const upstreamRequest = transport.request({
      protocol: upstreamBase.protocol,
      hostname: upstreamBase.hostname,
      port: upstreamBase.port || undefined,
      method: request.method,
      path: target,
      headers: outgoingHeaders(request.rawHeaders),
      agent: false,
    }, (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.statusMessage,
        [...downstreamRawHeaders(upstreamResponse.rawHeaders), "Connection", "close"],
      );

      upstreamResponse.on("data", (chunk) => {
        const bytes = Buffer.from(chunk);
        const offset = responseChunks.reduce((total, value) => total + value.length, 0);
        responseChunks.push(bytes);
        responseChunkIndex.push({
          offset,
          length: bytes.length,
          elapsed_us: Number((process.hrtime.bigint() - monotonicStart) / 1000n),
          sha256: sha256(bytes),
        });
        if (!response.write(bytes)) upstreamResponse.pause();
      });

      response.on("drain", () => upstreamResponse.resume());

      upstreamResponse.on("end", () => {
        const responseBody = Buffer.concat(responseChunks);
        response.end();
        const contentType = upstreamResponse.headers["content-type"] ?? "";
        const metadata = {
          fixture_schema: 1,
          surface,
          request_started_at: requestStartedAt,
          duration_us: Number((process.hrtime.bigint() - monotonicStart) / 1000n),
          request: {
            http_version: request.httpVersion,
            method: request.method,
            target: request.url,
            raw_headers_redacted: headerPairs(request.rawHeaders, true),
            trailers_redacted: headerPairs(request.rawTrailers, true),
            body_length: requestBody.length,
            body_sha256: sha256(requestBody),
            delivery_chunks: requestChunkIndex,
          },
          upstream: {
            origin: upstreamBase.origin,
            target,
            negotiated_protocol: upstreamResponse.socket.alpnProtocol || `http/${upstreamResponse.httpVersion}`,
            status_code: upstreamResponse.statusCode,
            status_message: upstreamResponse.statusMessage,
            raw_headers: headerPairs(upstreamResponse.rawHeaders),
            trailers: headerPairs(upstreamResponse.rawTrailers),
            body_length: responseBody.length,
            body_sha256: sha256(responseBody),
            delivery_chunks: responseChunkIndex,
            sse_records: /^text\/event-stream\b/i.test(contentType) ? sseIndex(responseBody) : [],
          },
          relay: {
            response_body_sha256: sha256(responseBody),
            write_boundaries_match_upstream_delivery_chunks: true,
          },
        };
        writeCapture(directory, metadata, requestBody, responseBody);
        process.stdout.write(`CAPTURED ${surface} ${request.method} ${request.url} ${upstreamResponse.statusCode} ${requestBody.length} ${responseBody.length}\n`);
        if (request.method === "POST" && /^\/v1\/messages(?:\?|$)/.test(request.url)) server.close();
      });
    });

    upstreamRequest.on("error", (error) => {
      const responseBody = Buffer.from(JSON.stringify({ error: error.message }));
      response.writeHead(502, { "content-type": "application/json", "content-length": responseBody.length });
      response.end(responseBody);
      const metadata = {
        fixture_schema: 1,
        surface,
        request_started_at: requestStartedAt,
        duration_us: Number((process.hrtime.bigint() - monotonicStart) / 1000n),
        request: {
          http_version: request.httpVersion,
          method: request.method,
          target: request.url,
          raw_headers_redacted: headerPairs(request.rawHeaders, true),
          body_length: requestBody.length,
          body_sha256: sha256(requestBody),
          delivery_chunks: requestChunkIndex,
        },
        upstream: { origin: upstreamBase.origin, target, error: error.message },
      };
      writeCapture(directory, metadata, requestBody, responseBody);
      process.stderr.write(`UPSTREAM_ERROR ${surface} ${request.method} ${request.url} ${error.message}\n`);
    });

    upstreamRequest.end(requestBody);
  });
});

server.listen(listenPort, listenHost, () => {
  process.stdout.write(`LISTENING http://${listenHost}:${listenPort} -> ${upstreamBase.href} surface=${surface}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
