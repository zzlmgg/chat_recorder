import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  listen,
  rawFieldPairs,
  readJson,
  reservePort,
  waitForOutput,
} from "./recorder-test-helpers.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const fixtureRoot = path.join(
  projectRoot,
  ".scratch/faithful-recorder-design/fixtures/target-stack-http",
);
const syntheticAuthorization = `Bearer ${"fixture-auth-token".padEnd(35, "0")}`;
const syntheticProbe = "fixture-recorder-probe".padEnd(42, "0");

assert.equal(Buffer.byteLength(syntheticAuthorization), 42);
assert.equal(Buffer.byteLength(syntheticProbe), 42);

export async function replayCapturedFixture(t, entrypoint) {
  const fixture = await loadFixture(entrypoint);
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), `recorder-${entrypoint}-fixture-`));
  const modelRequest = Promise.withResolvers();
  const modelMayComplete = Promise.withResolvers();
  const modelCompleted = Promise.withResolvers();
  const responsePrefixLength = Math.min(257, fixture.responseEntity.length - 1);
  const responsePrefix = fixture.responseEntity.subarray(0, responsePrefixLength);
  let modelResponseComplete = false;

  const model = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.once("error", modelRequest.reject);
    request.once("end", async () => {
      modelRequest.resolve({
        httpVersion: request.httpVersion,
        method: request.method,
        target: request.url,
        headers: rawFieldPairs(request.rawHeaders),
        trailers: rawFieldPairs(request.rawTrailers),
        entity: Buffer.concat(chunks),
      });

      response.sendDate = false;
      response.writeHead(
        fixture.capture.upstream.status_code,
        fixture.capture.upstream.status_message,
        fixture.capture.upstream.raw_headers.flat(),
      );
      response.write(responsePrefix);
      await modelMayComplete.promise;
      response.end(fixture.responseEntity.subarray(responsePrefixLength), () => {
        modelResponseComplete = true;
        modelCompleted.resolve();
      });
    });
  });
  await listen(model);

  const recorderPort = await reservePort();
  const recorderAuthority = `127.0.0.1:${recorderPort}`;
  const modelAuthority = `127.0.0.1:${model.address().port}`;
  const recorder = spawn(
    process.execPath,
    [
      "src/index.mjs",
      "--upstream-base-url", `http://${modelAuthority}/anthropic`,
      "--output-root", outputRoot,
      "--listen", recorderAuthority,
    ],
    { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  const recorderExit = once(recorder, "exit");
  const harnessAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  t.after(async () => {
    modelMayComplete.resolve();
    harnessAgent.destroy();
    if (recorder.exitCode === null) recorder.kill("SIGKILL");
    await recorderExit;
    if (model.listening) {
      model.closeAllConnections();
      await new Promise((resolve, reject) => {
        model.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await rm(outputRoot, { recursive: true, force: true });
  });
  await waitForOutput(recorder, `Recorder listening on http://${recorderAuthority}`);

  const sourceRequestHeaders = rehydrateRequestHeaders(
    fixture.capture.request.raw_headers_redacted,
    recorderAuthority,
  );
  const harnessSawPrefix = Promise.withResolvers();
  const harnessResponseChunks = [];
  let harnessResponseBytes = 0;
  const harnessResponsePromise = sendHarnessRequest({
    recorderPort,
    method: fixture.capture.request.method,
    target: fixture.capture.request.target,
    headers: sourceRequestHeaders,
    entity: fixture.requestEntity,
    agent: harnessAgent,
    onResponseChunk(chunk) {
      harnessResponseChunks.push(chunk);
      harnessResponseBytes += chunk.length;
      if (harnessResponseBytes >= responsePrefixLength) harnessSawPrefix.resolve();
    },
  });

  await harnessSawPrefix.promise;
  assert.equal(
    modelResponseComplete,
    false,
    `${entrypoint} response completed before the Harness observed an initial SSE prefix`,
  );
  assert.deepEqual(Buffer.concat(harnessResponseChunks), responsePrefix);

  modelMayComplete.resolve();
  const [harnessResponse, observedModelRequest] = await Promise.all([
    harnessResponsePromise,
    modelRequest.promise,
    modelCompleted.promise,
  ]);

  recorder.kill("SIGINT");
  const [exitCode, signal] = await recorderExit;
  assert.equal(exitCode, 0, `Recorder exited via ${signal ?? "an error"}`);

  const expectedUpstreamHeaders = upstreamRequestHeaders(sourceRequestHeaders, modelAuthority);
  assert.deepEqual(observedModelRequest, {
    httpVersion: "1.1",
    method: fixture.capture.request.method,
    target: fixture.capture.upstream.target,
    headers: expectedUpstreamHeaders,
    trailers: fixture.capture.request.trailers_redacted,
    entity: fixture.requestEntity,
  });
  assert.deepEqual(harnessResponse, {
    httpVersion: "1.1",
    status: fixture.capture.upstream.status_code,
    reason: fixture.capture.upstream.status_message,
    headers: relayedResponseHeaders(fixture.capture.upstream.raw_headers),
    trailers: fixture.capture.upstream.trailers,
    entity: fixture.responseEntity,
  });

  const sessionRoot = path.join(outputRoot, `session-${fixture.manifestCapture.session_id}`);
  const exchangeRoot = path.join(sessionRoot, "exchange-000001");
  assert.deepEqual(await readJson(path.join(sessionRoot, "index.json")), {
    artifact_version: 1,
    session_id: fixture.manifestCapture.session_id,
    exchanges: ["exchange-000001"],
  });
  assert.deepEqual((await readdir(sessionRoot)).sort(), ["exchange-000001", "index.json"]);
  assert.deepEqual((await readdir(exchangeRoot)).sort(), [
    "request.body",
    "request.json",
    "response.body",
    "response.json",
    "upstream-request.json",
  ]);

  assert.deepEqual(await readJson(path.join(exchangeRoot, "request.json")), {
    http_version: fixture.capture.request.http_version,
    method: fixture.capture.request.method,
    target: fixture.capture.request.target,
    headers: sourceRequestHeaders,
    trailers: fixture.capture.request.trailers_redacted,
    entity_file: "request.body",
  });
  assert.deepEqual(await readJson(path.join(exchangeRoot, "upstream-request.json")), {
    http_version: "1.1",
    method: fixture.capture.request.method,
    target: fixture.capture.upstream.target,
    headers: expectedUpstreamHeaders,
    trailers: fixture.capture.request.trailers_redacted,
    entity_file: "request.body",
  });
  assert.deepEqual(await readJson(path.join(exchangeRoot, "response.json")), {
    http_version: "1.1",
    status: fixture.capture.upstream.status_code,
    reason: fixture.capture.upstream.status_message,
    headers: fixture.capture.upstream.raw_headers,
    trailers: fixture.capture.upstream.trailers,
    entity_file: "response.body",
  });

  assert.deepEqual(observedModelRequest.entity, fixture.requestEntity);
  assert.deepEqual(await readFile(path.join(exchangeRoot, "request.body")), fixture.requestEntity);
  assert.deepEqual(harnessResponse.entity, fixture.responseEntity);
  assert.deepEqual(await readFile(path.join(exchangeRoot, "response.body")), fixture.responseEntity);
}

async function loadFixture(entrypoint) {
  const manifest = JSON.parse(await readFile(path.join(fixtureRoot, "manifest.json"), "utf8"));
  const fixtures = await Promise.all(manifest.captures.map(async (manifestCapture) => {
    const captureBytes = await readVerifiedPayload(
      path.join(manifestCapture.directory, "capture.json"),
      manifestCapture.capture_json_sha256,
    );
    const requestEntity = await readVerifiedPayload(
      path.join(manifestCapture.directory, "request-body.bin"),
      manifestCapture.request_body_sha256,
    );
    const responseEntity = await readVerifiedPayload(
      path.join(manifestCapture.directory, "response-body.bin"),
      manifestCapture.response_body_sha256,
    );
    const capture = JSON.parse(captureBytes.toString("utf8"));

    assert.equal(capture.fixture_schema, manifest.fixture_schema);
    assert.equal(capture.surface, manifestCapture.surface);
    assert.equal(capture.request.body_length, requestEntity.length);
    assert.equal(capture.request.body_sha256, manifestCapture.request_body_sha256);
    assert.equal(capture.upstream.negotiated_protocol, "http/1.1");
    assert.equal(capture.upstream.body_length, responseEntity.length);
    assert.equal(capture.upstream.body_sha256, manifestCapture.response_body_sha256);
    assert.equal(capture.relay.response_body_sha256, manifestCapture.response_body_sha256);
    assert.deepEqual(
      capture.request.raw_headers_redacted
        .filter(([name]) => name.toLowerCase() === "x-claude-code-session-id")
        .map(([, value]) => value),
      [manifestCapture.session_id],
    );

    return { capture, manifestCapture, requestEntity, responseEntity };
  }));

  const fixture = fixtures.find(({ manifestCapture }) => manifestCapture.entrypoint === entrypoint);
  assert.ok(fixture, `manifest has no captured ${entrypoint} fixture`);
  return fixture;
}

async function readVerifiedPayload(relativeFile, expectedSha256) {
  const payload = await readFile(path.join(fixtureRoot, relativeFile));
  const actualSha256 = createHash("sha256").update(payload).digest("hex");
  assert.equal(actualSha256, expectedSha256, `${relativeFile} does not match its manifest SHA-256`);
  return payload;
}

function rehydrateRequestHeaders(redactedHeaders, recorderAuthority) {
  return redactedHeaders.map(([name, value]) => {
    switch (name.toLowerCase()) {
      case "authorization":
        assert.equal(value, "Bearer <redacted:42 bytes total>");
        return [name, syntheticAuthorization];
      case "x-recorder-probe":
        assert.equal(value, "<redacted:42 bytes>");
        return [name, syntheticProbe];
      case "host":
        return [name, recorderAuthority];
      default:
        assert.ok(!value.includes("<redacted"), `unhandled redacted ${name} fixture value`);
        return [name, value];
    }
  });
}

function upstreamRequestHeaders(sourceHeaders, modelAuthority) {
  const headers = [];
  let hasContentLength = false;
  for (const [name, value] of sourceHeaders) {
    const lowerName = name.toLowerCase();
    if (lowerName === "host") {
      headers.push(["Host", modelAuthority]);
    } else if (lowerName !== "connection") {
      headers.push([name, value]);
      if (lowerName === "content-length") hasContentLength = true;
    }
  }
  headers.push(["Connection", "keep-alive"]);
  if (!hasContentLength) headers.push(["Transfer-Encoding", "chunked"]);
  return headers;
}

function relayedResponseHeaders(sourceHeaders) {
  return [
    ...sourceHeaders.filter(
      ([name]) => name.toLowerCase() !== "connection" && name.toLowerCase() !== "transfer-encoding",
    ),
    ["Connection", "keep-alive"],
    ["Transfer-Encoding", "chunked"],
  ];
}

function sendHarnessRequest({ recorderPort, method, target, headers, entity, agent, onResponseChunk }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port: recorderPort,
      method,
      path: target,
      agent,
      headers,
    });
    request.once("error", reject);
    request.once("response", (response) => {
      const chunks = [];
      response.on("data", (chunk) => {
        chunks.push(chunk);
        onResponseChunk(chunk);
      });
      response.once("error", reject);
      response.once("end", () => {
        resolve({
          httpVersion: response.httpVersion,
          status: response.statusCode,
          reason: response.statusMessage,
          headers: rawFieldPairs(response.rawHeaders),
          trailers: rawFieldPairs(response.rawTrailers),
          entity: Buffer.concat(chunks),
        });
      });
    });
    request.end(entity);
  });
}
