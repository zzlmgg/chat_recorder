import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("the Harness request envelope is preserved separately from the actual upstream envelope", async (t) => {
  const requestEntity = Buffer.from("opaque request entity\n");
  const modelRequest = Promise.withResolvers();
  const model = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.once("error", modelRequest.reject);
    request.once("end", () => {
      modelRequest.resolve({
        httpVersion: request.httpVersion,
        method: request.method,
        target: request.url,
        headers: rawFieldPairs(request.rawHeaders),
        trailers: rawFieldPairs(request.rawTrailers),
        entity: Buffer.concat(chunks),
      });
      response.sendDate = false;
      response.writeHead(200, "Audited", ["Content-Length", "0", "Connection", "close"]);
      response.end();
    });
  });
  await listen(model);

  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "recorder-request-envelope-"));
  const recorderPort = await reservePort();
  const modelAuthority = `127.0.0.1:${model.address().port}`;
  const recorderAuthority = `127.0.0.1:${recorderPort}`;
  const recorder = spawn(
    process.execPath,
    [
      "src/index.mjs",
      "--upstream-base-url", `http://${modelAuthority}/gateway/anthropic/`,
      "--output-root", outputRoot,
      "--listen", recorderAuthority,
    ],
    { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  const recorderExit = once(recorder, "exit");
  t.after(async () => {
    if (recorder.exitCode === null) recorder.kill("SIGKILL");
    await recorderExit;
    if (model.listening) {
      await new Promise((resolve, reject) => {
        model.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await rm(outputRoot, { recursive: true, force: true });
  });
  await waitForOutput(recorder, `Recorder listening on http://${recorderAuthority}`);

  const sourceHeaders = [
    ["hOSt", recorderAuthority],
    ["X-Claude-Code-Session-Id", "request-envelope-001"],
    ["Authorization", "Bearer synthetic-token"],
    ["X-Future-Field", "future-value"],
    ["X-Duplicate", "first"],
    ["x-DUPLICATE", "second"],
    ["Connection", "keep-alive, X-Remove-Me"],
    ["X-Remove-Me", "must-not-cross-hop"],
    ["Keep-Alive", "timeout=5"],
    ["Trailer", "X-Request-Trailer, x-request-trailer, X-Remove-Me"],
    ["Transfer-Encoding", "chunked"],
  ];
  const sourceTrailers = [
    ["X-Request-Trailer", "first-trailer"],
    ["x-request-trailer", "second-trailer"],
    ["X-Remove-Me", "must-not-cross-hop"],
  ];
  await sendHarnessRequest({
    port: recorderPort,
    headers: sourceHeaders,
    trailers: sourceTrailers,
    entity: requestEntity,
  });

  const expectedUpstreamHeaders = [
    ["Host", modelAuthority],
    ["X-Claude-Code-Session-Id", "request-envelope-001"],
    ["Authorization", "Bearer synthetic-token"],
    ["X-Future-Field", "future-value"],
    ["X-Duplicate", "first"],
    ["x-DUPLICATE", "second"],
    ["Connection", "keep-alive"],
    ["Transfer-Encoding", "chunked"],
  ];
  const expectedUpstreamTrailers = sourceTrailers.slice(0, 2);
  assert.deepEqual(await modelRequest.promise, {
    httpVersion: "1.1",
    method: "POST",
    target: "/gateway/anthropic/v1/messages?beta=true",
    headers: expectedUpstreamHeaders,
    trailers: expectedUpstreamTrailers,
    entity: requestEntity,
  });

  recorder.kill("SIGINT");
  const [exitCode, signal] = await recorderExit;
  assert.equal(exitCode, 0, `Recorder exited via ${signal ?? "an error"}`);

  const exchangeRoot = path.join(
    outputRoot,
    "session-request-envelope-001",
    "exchange-000001",
  );
  assert.deepEqual(await readJson(path.join(exchangeRoot, "request.json")), {
    http_version: "1.1",
    method: "POST",
    target: "/v1/messages?beta=true",
    headers: sourceHeaders,
    trailers: sourceTrailers,
    entity_file: "request.body",
  });
  assert.deepEqual(await readJson(path.join(exchangeRoot, "upstream-request.json")), {
    http_version: "1.1",
    method: "POST",
    target: "/gateway/anthropic/v1/messages?beta=true",
    headers: expectedUpstreamHeaders,
    trailers: expectedUpstreamTrailers,
    entity_file: "request.body",
  });
  assert.deepEqual(await readFile(path.join(exchangeRoot, "request.body")), requestEntity);
  assert.deepEqual((await readdir(exchangeRoot)).sort(), [
    "request.body",
    "request.json",
    "response.body",
    "response.json",
    "upstream-request.json",
  ]);
});

function sendHarnessRequest({ port, headers, trailers, entity }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/v1/messages?beta=true",
      agent: false,
      headers,
    });
    request.once("error", reject);
    request.once("response", (response) => {
      response.resume();
      response.once("error", reject);
      response.once("end", resolve);
    });
    request.write(entity);
    request.addTrailers(trailers);
    request.end();
  });
}

function rawFieldPairs(rawFields) {
  const result = [];
  for (let index = 0; index < rawFields.length; index += 2) {
    result.push([rawFields[index], rawFields[index + 1]]);
  }
  return result;
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
}

async function reservePort() {
  const server = http.createServer();
  await listen(server);
  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function waitForOutput(child, expected) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const onStdout = (chunk) => {
      stdout += chunk;
      if (stdout.includes(expected)) {
        cleanup();
        resolve();
      }
    };
    const onStderr = (chunk) => {
      stderr += chunk;
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Recorder exited before listening (${code ?? signal}): ${stderr}`));
    };
    const cleanup = () => {
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
  });
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
