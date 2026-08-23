import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { mkdtemp } from "node:fs/promises";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("one empty Model Exchange passes through the assembled Recorder and is recorded", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "recorder-empty-exchange-"));
  const modelRequests = [];
  const model = http.createServer((request, response) => {
    modelRequests.push({
      method: request.method,
      target: request.url,
      headers: pairs(request.rawHeaders),
    });

    response.sendDate = false;
    response.writeHead(200, "Empty Model Response", [
      "Content-Length", "0",
      "X-Controlled-Model", "true",
      "Connection", "close",
    ]);
    response.end();
  });
  await listen(model);
  t.after(() => model.close());

  const modelAddress = model.address();
  const recorderPort = await reservePort();
  const recorder = spawn(
    process.execPath,
    [
      "src/index.mjs",
      "--upstream-base-url",
      `http://127.0.0.1:${modelAddress.port}/anthropic`,
      "--output-root",
      outputRoot,
      "--listen",
      `127.0.0.1:${recorderPort}`,
    ],
    {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(() => {
    if (recorder.exitCode === null) recorder.kill("SIGKILL");
  });

  await waitForOutput(recorder, `Recorder listening on http://127.0.0.1:${recorderPort}`);

  const harnessResponse = await sendEmptyExchange(recorderPort);

  assert.deepEqual(harnessResponse, {
    status: 200,
    reason: "Empty Model Response",
    body: Buffer.alloc(0),
  });
  assert.deepEqual(modelRequests, [
    {
      method: "POST",
      target: "/anthropic/v1/messages?beta=true",
      headers: [
        ["Host", `127.0.0.1:${modelAddress.port}`],
        ["X-Claude-Code-Session-Id", "session-empty-001"],
        ["Authorization", "Bearer synthetic-token"],
        ["Content-Length", "0"],
        ["Connection", "keep-alive"],
      ],
    },
  ]);

  recorder.kill("SIGINT");
  const [exitCode, signal] = await once(recorder, "exit");
  assert.equal(exitCode, 0, `Recorder exited via ${signal ?? "an error"}`);

  const sessionRoot = path.join(outputRoot, "session-session-empty-001");
  const exchangeRoot = path.join(sessionRoot, "exchange-000001");

  assert.deepEqual(await readJson(path.join(sessionRoot, "index.json")), {
    artifact_version: 1,
    session_id: "session-empty-001",
    exchanges: ["exchange-000001"],
  });
  assert.deepEqual(await readJson(path.join(exchangeRoot, "request.json")), {
    http_version: "1.1",
    method: "POST",
    target: "/v1/messages?beta=true",
    headers: [
      ["Host", `127.0.0.1:${recorderPort}`],
      ["X-Claude-Code-Session-Id", "session-empty-001"],
      ["Authorization", "Bearer synthetic-token"],
      ["Content-Length", "0"],
      ["Connection", "close"],
    ],
    trailers: [],
    entity_file: "request.body",
  });
  assert.deepEqual(await readJson(path.join(exchangeRoot, "upstream-request.json")), {
    http_version: "1.1",
    method: "POST",
    target: "/anthropic/v1/messages?beta=true",
    headers: [
      ["Host", `127.0.0.1:${modelAddress.port}`],
      ["X-Claude-Code-Session-Id", "session-empty-001"],
      ["Authorization", "Bearer synthetic-token"],
      ["Content-Length", "0"],
      ["Connection", "keep-alive"],
    ],
    trailers: [],
    entity_file: "request.body",
  });
  assert.deepEqual(await readJson(path.join(exchangeRoot, "response.json")), {
    http_version: "1.1",
    status: 200,
    reason: "Empty Model Response",
    headers: [
      ["Content-Length", "0"],
      ["X-Controlled-Model", "true"],
      ["Connection", "close"],
    ],
    trailers: [],
    entity_file: "response.body",
  });
  assert.equal((await stat(path.join(exchangeRoot, "request.body"))).size, 0);
  assert.equal((await stat(path.join(exchangeRoot, "response.body"))).size, 0);
});

function pairs(rawFields) {
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
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
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

function sendEmptyExchange(port) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/v1/messages?beta=true",
      agent: false,
      headers: [
        ["Host", `127.0.0.1:${port}`],
        ["X-Claude-Code-Session-Id", "session-empty-001"],
        ["Authorization", "Bearer synthetic-token"],
        ["Content-Length", "0"],
        ["Connection", "close"],
      ],
    });
    request.once("error", reject);
    request.once("response", (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => {
        resolve({
          status: response.statusCode,
          reason: response.statusMessage,
          body: Buffer.concat(chunks),
        });
      });
    });
    request.end();
  });
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
