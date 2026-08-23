import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export class ArtifactSession {
  static create(outputRoot, sessionId) {
    const sessionRoot = path.join(outputRoot, encodeSessionComponent(sessionId));
    return new ArtifactSession(sessionRoot, sessionId);
  }

  constructor(sessionRoot, sessionId) {
    this.sessionRoot = sessionRoot;
    this.sessionId = sessionId;
    this.exchanges = [];
    this.admissionQueue = mkdir(sessionRoot, { recursive: true });
  }

  admit(requestMetadata) {
    const name = `exchange-${String(this.exchanges.length + 1).padStart(6, "0")}`;
    const exchangeRoot = path.join(this.sessionRoot, name);
    this.exchanges.push(name);

    const ready = this.admissionQueue.then(async () => {
      await mkdir(exchangeRoot);
      await Promise.all([
        this.writeIndex(),
        writeJson(path.join(exchangeRoot, "request.json"), requestMetadata),
      ]);
      return new ExchangeArtifact(exchangeRoot);
    });
    this.admissionQueue = ready.then(() => undefined);
    return ready;
  }

  writeIndex() {
    return writeJson(path.join(this.sessionRoot, "index.json"), {
      artifact_version: 1,
      session_id: this.sessionId,
      exchanges: this.exchanges,
    });
  }
}

class ExchangeArtifact {
  constructor(exchangeRoot) {
    this.exchangeRoot = exchangeRoot;
  }

  createRequestBodySink() {
    return createWriteStream(path.join(this.exchangeRoot, "request.body"), { flags: "wx" });
  }

  createResponseBodySink() {
    return createWriteStream(path.join(this.exchangeRoot, "response.body"), { flags: "wx" });
  }

  writeRequest(metadata) {
    return writeJson(path.join(this.exchangeRoot, "request.json"), metadata);
  }

  writeUpstreamRequest(metadata) {
    return writeJson(path.join(this.exchangeRoot, "upstream-request.json"), metadata);
  }

  writeResponse(metadata) {
    return writeJson(path.join(this.exchangeRoot, "response.json"), metadata);
  }
}

function encodeSessionComponent(sessionId) {
  let encoded = "";
  for (const byte of Buffer.from(sessionId, "utf8")) {
    const safe =
      (byte >= 0x41 && byte <= 0x5a)
      || (byte >= 0x61 && byte <= 0x7a)
      || (byte >= 0x30 && byte <= 0x39)
      || byte === 0x2e
      || byte === 0x5f
      || byte === 0x2d;
    encoded += safe ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return `session-${encoded}`;
}

function writeJson(file, value) {
  return writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
