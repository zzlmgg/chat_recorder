import http from "node:http";
import https from "node:https";
import { ArtifactSession } from "./artifact.mjs";
import { forwardModelExchange, rawFieldPairs } from "./exchange.mjs";

export async function startRecorder({ upstreamBaseUrl, outputRoot, listen }) {
  const upstreamAgent = upstreamBaseUrl.protocol === "http:"
    ? new http.Agent({ keepAlive: true, maxSockets: 16 })
    : new https.Agent({ keepAlive: true, maxSockets: 16 });
  const activeExchanges = new Set();
  let state = "accepting";
  let lockedSessionId;
  let artifactSession;

  const server = http.createServer((request, response) => {
    if (request.httpVersion !== "1.1") {
      response.writeHead(505);
      response.end();
      return;
    }

    const candidateSessionId = eligibleSessionId(request);
    if (state === "accepting" && lockedSessionId === undefined && candidateSessionId !== undefined) {
      lockedSessionId = candidateSessionId;
      artifactSession = ArtifactSession.create(outputRoot, candidateSessionId);
    }
    const admitted =
      state === "accepting"
      && candidateSessionId !== undefined
      && candidateSessionId === lockedSessionId;
    const requestMetadata = {
      http_version: request.httpVersion,
      method: request.method,
      target: request.url,
      headers: rawFieldPairs(request.rawHeaders),
      trailers: [],
      entity_file: "request.body",
    };
    const artifactPromise = admitted
      ? artifactSession.admit(requestMetadata)
      : undefined;

    const completion = handleRequest({
      request,
      response,
      artifactPromise,
      upstreamBaseUrl,
      upstreamAgent,
      requestMetadata,
    });
    activeExchanges.add(completion);
    completion.finally(() => activeExchanges.delete(completion));
  });

  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 0;
  server.on("clientError", (error, socket) => {
    if (error.code === "ECONNRESET" || !socket.writable) return;

    const status = isUnsupportedHttpVersion(error)
      ? "505 HTTP Version Not Supported"
      : "400 Bad Request";
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listen.port, listen.host, resolve);
  });

  return {
    address: `http://${listen.host}:${listen.port}`,
    async stop() {
      if (state === "draining") return;
      state = "draining";
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await Promise.all(activeExchanges);
      upstreamAgent.destroy();
    },
  };
}

function isUnsupportedHttpVersion(error) {
  if (error.code === "HPE_PAUSED_H2_UPGRADE") return true;
  if (error.code !== "HPE_INVALID_VERSION") return false;

  const startLine = error.rawPacket?.toString("latin1").split("\r\n", 1)[0];
  const versionToken = startLine?.split(" ").at(-1);
  return /^HTTP\/\d+\.\d+$/.test(versionToken ?? "");
}

async function handleRequest({
  request,
  response,
  artifactPromise,
  upstreamBaseUrl,
  upstreamAgent,
  requestMetadata,
}) {
  const artifact = artifactPromise
    ? await artifactPromise
    : undefined;

  await forwardModelExchange({
    harnessRequest: request,
    harnessResponse: response,
    upstreamBaseUrl,
    upstreamAgent,
    artifact,
    requestMetadata,
  });
}

function eligibleSessionId(request) {
  if (request.method !== "POST" || request.url.split("?", 1)[0] !== "/v1/messages") return undefined;

  const values = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === "x-claude-code-session-id") {
      values.push(request.rawHeaders[index + 1]);
    }
  }
  if (values.length !== 1) return undefined;

  const sessionId = values[0].replace(/^[ \t]+|[ \t]+$/g, "");
  return sessionId || undefined;
}
