import http from "node:http";
import https from "node:https";
import { ArtifactSession } from "./artifact.mjs";
import { forwardModelExchange } from "./exchange.mjs";

export async function startRecorder({ upstreamBaseUrl, outputRoot, listen }) {
  const upstreamAgent = upstreamBaseUrl.protocol === "http:"
    ? new http.Agent({ keepAlive: true, maxSockets: 16 })
    : new https.Agent({ keepAlive: true, maxSockets: 16 });
  const activeExchanges = new Set();
  let state = "accepting";
  let lockedSessionId;
  let artifactSessionPromise;

  const server = http.createServer((request, response) => {
    if (request.httpVersion !== "1.1") {
      response.writeHead(505);
      response.end();
      return;
    }

    const candidateSessionId = eligibleSessionId(request);
    if (state === "accepting" && lockedSessionId === undefined && candidateSessionId !== undefined) {
      lockedSessionId = candidateSessionId;
      artifactSessionPromise = ArtifactSession.create(outputRoot, candidateSessionId);
    }
    const admitted =
      state === "accepting"
      && candidateSessionId !== undefined
      && candidateSessionId === lockedSessionId;

    const completion = handleRequest({
      request,
      response,
      admitted,
      artifactSessionPromise,
      upstreamBaseUrl,
      upstreamAgent,
    });
    activeExchanges.add(completion);
    completion.finally(() => activeExchanges.delete(completion));
  });

  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 0;

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

async function handleRequest({
  request,
  response,
  admitted,
  artifactSessionPromise,
  upstreamBaseUrl,
  upstreamAgent,
}) {
  const requestMetadata = {
    http_version: request.httpVersion,
    method: request.method,
    target: request.url,
    headers: pairs(request.rawHeaders),
    trailers: [],
    entity_file: "request.body",
  };
  const artifact = admitted
    ? await (await artifactSessionPromise).admit(requestMetadata)
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

  const sessionId = values[0].trim();
  return sessionId || undefined;
}

function pairs(rawFields) {
  const result = [];
  for (let index = 0; index < rawFields.length; index += 2) {
    result.push([rawFields[index], rawFields[index + 1]]);
  }
  return result;
}
