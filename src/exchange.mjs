import http from "node:http";
import https from "node:https";
import { finished } from "node:stream/promises";

const standardHopByHopFields = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function forwardModelExchange({
  harnessRequest,
  harnessResponse,
  upstreamBaseUrl,
  upstreamAgent,
  artifact,
  requestMetadata,
}) {
  const target = joinTarget(upstreamBaseUrl.pathname, harnessRequest.url);
  const upstreamHeaders = buildUpstreamHeaders(rawFieldPairs(harnessRequest.rawHeaders), upstreamBaseUrl.host);
  const transport = upstreamBaseUrl.protocol === "http:" ? http : https;

  return new Promise((resolve, reject) => {
    const upstreamRequest = transport.request({
      protocol: upstreamBaseUrl.protocol,
      hostname: upstreamBaseUrl.hostname,
      port: upstreamBaseUrl.port || undefined,
      method: harnessRequest.method,
      path: target,
      headers: headerObject(upstreamHeaders),
      agent: upstreamAgent,
    });

    const requestBodySink = artifact?.createRequestBodySink();
    const requestEntity = relayEntity(harnessRequest, upstreamRequest, requestBodySink);
    const finalizedRequest = requestEntity.then(async (trailers) => {
      if (!artifact) return;
      await Promise.all([
        artifact.writeRequest({ ...requestMetadata, trailers }),
        artifact.writeUpstreamRequest({
          http_version: "1.1",
          method: harnessRequest.method,
          target,
          headers: upstreamHeaders,
          trailers,
          entity_file: "request.body",
        }),
      ]);
    });

    upstreamRequest.once("error", reject);
    upstreamRequest.once("response", (modelResponse) => {
      const responseHeaders = rawFieldPairs(modelResponse.rawHeaders);
      const relayedHeaders = withoutHopByHopFields(responseHeaders);
      harnessResponse.sendDate = false;
      harnessResponse.writeHead(
        modelResponse.statusCode,
        modelResponse.statusMessage,
        flatten(relayedHeaders),
      );

      const responseBodySink = artifact?.createResponseBodySink();
      const responseEntity = relayEntity(modelResponse, harnessResponse, responseBodySink);
      const finalizedResponse = responseEntity.then(async (trailers) => {
        if (!artifact) return;
        await artifact.writeResponse({
          http_version: modelResponse.httpVersion,
          status: modelResponse.statusCode,
          reason: modelResponse.statusMessage,
          headers: responseHeaders,
          trailers,
          entity_file: "response.body",
        });
      });

      Promise.all([finalizedRequest, finalizedResponse]).then(() => resolve(), reject);
    });
  });
}

function relayEntity(source, destination, fileSink) {
  const fileFinished = fileSink ? finished(fileSink) : Promise.resolve();
  source.pipe(destination, { end: false });
  if (fileSink) source.pipe(fileSink);

  return new Promise((resolve, reject) => {
    source.once("error", reject);
    destination.once("error", reject);
    fileSink?.once("error", reject);
    source.once("end", () => {
      const trailers = rawFieldPairs(source.rawTrailers);
      if (trailers.length > 0) destination.addTrailers(headerObject(trailers));
      destination.end();
      fileFinished.then(() => resolve(trailers), reject);
    });
  });
}

function joinTarget(basePath, harnessTarget) {
  const prefix = basePath === "/" ? "" : basePath.replace(/\/+$/, "");
  return `${prefix}${harnessTarget.startsWith("/") ? harnessTarget : `/${harnessTarget}`}`;
}

function buildUpstreamHeaders(sourceHeaders, upstreamHost) {
  const excluded = new Set([...standardHopByHopFields, ...connectionNominatedFields(sourceHeaders)]);
  const result = [];
  let replacedHost = false;
  for (const [name, value] of sourceHeaders) {
    const lowerName = name.toLowerCase();
    if (lowerName === "host") {
      if (!replacedHost) result.push(["Host", upstreamHost]);
      replacedHost = true;
    } else if (!excluded.has(lowerName)) {
      result.push([name, value]);
    }
  }
  if (!replacedHost) result.unshift(["Host", upstreamHost]);
  result.push(["Connection", "keep-alive"]);
  return result;
}

function withoutHopByHopFields(sourceHeaders) {
  const excluded = new Set([...standardHopByHopFields, ...connectionNominatedFields(sourceHeaders)]);
  return sourceHeaders.filter(([name]) => !excluded.has(name.toLowerCase()));
}

function connectionNominatedFields(sourceHeaders) {
  const fields = new Set();
  for (const [name, value] of sourceHeaders) {
    if (name.toLowerCase() !== "connection") continue;
    for (const token of value.split(",")) fields.add(token.trim().toLowerCase());
  }
  return fields;
}

function headerObject(headerPairs) {
  const headers = Object.create(null);
  for (const [name, value] of headerPairs) {
    const existingName = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    if (!existingName) headers[name] = value;
    else if (Array.isArray(headers[existingName])) headers[existingName].push(value);
    else headers[existingName] = [headers[existingName], value];
  }
  return headers;
}

function flatten(headerPairs) {
  return headerPairs.flatMap(([name, value]) => [name, value]);
}

export function rawFieldPairs(rawFields = []) {
  const result = [];
  for (let index = 0; index < rawFields.length; index += 2) {
    result.push([rawFields[index], rawFields[index + 1]]);
  }
  return result;
}
