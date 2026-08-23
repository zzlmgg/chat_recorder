import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("the first eligible Messages headers acquire an opaque Harness Session", async (t) => {
  const fixture = await startRecorderFixture(t);
  const identity = "\u00a0S\u00e9ance/\u00df?%\u00a0";
  const expectedSessionDirectory = "session-%C2%A0S%C3%A9ance%2F%C3%9F%3F%25%C2%A0";
  const pending = sendRawHarnessRequest({
    port: fixture.recorderPort,
    method: "POST",
    target: "/v1/messages?beta=true",
    headers: [
      ["Host", `127.0.0.1:${fixture.recorderPort}`],
      ["x-cLaUdE-CoDe-SeSsIoN-Id", ` \t${identity}\t `],
      ["Content-Length", "5"],
      ["Connection", "close"],
    ],
    holdEntity: true,
  });

  const sessionDirectory = await waitForSessionDirectory(fixture.outputRoot);
  assert.equal(sessionDirectory, expectedSessionDirectory);
  assert.deepEqual(
    await readJson(path.join(fixture.outputRoot, sessionDirectory, "index.json")),
    {
      artifact_version: 1,
      session_id: identity,
      exchanges: ["exchange-000001"],
    },
  );

  pending.request.write("hello");
  assert.equal(await pending.response, 204);
  await fixture.stopRecorder();

  const exchangeRoot = path.join(
    fixture.outputRoot,
    expectedSessionDirectory,
    "exchange-000001",
  );
  const requestMetadata = await readJson(path.join(exchangeRoot, "request.json"));
  assert.equal(requestMetadata.target, "/v1/messages?beta=true");
  assert.deepEqual(fixture.modelRequests.map(({ target }) => target), [
    "/anthropic/v1/messages?beta=true",
  ]);
});

test("auxiliary and ambiguous traffic cannot acquire a Harness Session", async (t) => {
  const fixture = await startRecorderFixture(t);
  const authority = `127.0.0.1:${fixture.recorderPort}`;
  const ineligibleRequests = [
    {
      method: "POST",
      target: "/v1/messages/count_tokens",
      headers: requestHeaders(authority, [["X-Claude-Code-Session-Id", "count-tokens"]]),
    },
    {
      method: "GET",
      target: "/v1/messages",
      headers: requestHeaders(authority, [["X-Claude-Code-Session-Id", "wrong-method"]]),
    },
    {
      method: "POST",
      target: "/other",
      headers: requestHeaders(authority, [["X-Claude-Code-Session-Id", "wrong-path"]]),
    },
    {
      method: "POST",
      target: "/v1/messages",
      headers: requestHeaders(authority),
    },
    {
      method: "POST",
      target: "/v1/messages",
      headers: requestHeaders(authority, [["X-Claude-Code-Session-Id", " \t "]]),
    },
    {
      method: "POST",
      target: "/v1/messages",
      headers: requestHeaders(authority, [
        ["X-Claude-Code-Session-Id", "duplicate-first"],
        ["x-claude-code-session-id", "duplicate-second"],
      ]),
    },
  ];

  for (const request of ineligibleRequests) {
    const pending = sendHarnessRequest({ port: fixture.recorderPort, ...request });
    assert.equal(await pending.response, 204);
  }
  assert.deepEqual(await readdir(fixture.outputRoot), []);

  const acquiring = sendHarnessRequest({
    port: fixture.recorderPort,
    method: "POST",
    target: "/v1/messages",
    headers: requestHeaders(authority, [["X-Claude-Code-Session-Id", "selected-session"]]),
  });
  assert.equal(await acquiring.response, 204);
  await fixture.stopRecorder();

  assert.deepEqual(await readdir(fixture.outputRoot), ["session-selected-session"]);
  assert.deepEqual(
    await readJson(path.join(fixture.outputRoot, "session-selected-session", "index.json")),
    {
      artifact_version: 1,
      session_id: "selected-session",
      exchanges: ["exchange-000001"],
    },
  );
  assert.equal(fixture.modelRequests.length, ineligibleRequests.length + 1);
});

test("the lock admits later exact identities without rotating to another identity", async (t) => {
  const fixture = await startRecorderFixture(t);
  const authority = `127.0.0.1:${fixture.recorderPort}`;
  const identities = ["Case-Sensitive", "case-sensitive", "Case-Sensitive"];

  for (const [index, identity] of identities.entries()) {
    const pending = sendHarnessRequest({
      port: fixture.recorderPort,
      method: "POST",
      target: `/v1/messages?sequence=${index + 1}`,
      headers: requestHeaders(authority, [["X-Claude-Code-Session-Id", identity]]),
    });
    assert.equal(await pending.response, 204);
  }
  await fixture.stopRecorder();

  assert.deepEqual(await readdir(fixture.outputRoot), ["session-Case-Sensitive"]);
  const sessionRoot = path.join(fixture.outputRoot, "session-Case-Sensitive");
  assert.deepEqual(await readJson(path.join(sessionRoot, "index.json")), {
    artifact_version: 1,
    session_id: "Case-Sensitive",
    exchanges: ["exchange-000001", "exchange-000002"],
  });
  assert.equal(
    (await readJson(path.join(sessionRoot, "exchange-000001", "request.json"))).target,
    "/v1/messages?sequence=1",
  );
  assert.equal(
    (await readJson(path.join(sessionRoot, "exchange-000002", "request.json"))).target,
    "/v1/messages?sequence=3",
  );
  assert.deepEqual(fixture.modelRequests.map(({ target }) => target), [
    "/anthropic/v1/messages?sequence=1",
    "/anthropic/v1/messages?sequence=2",
    "/anthropic/v1/messages?sequence=3",
  ]);
});

async function startRecorderFixture(t) {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "recorder-session-acquisition-"));
  const modelRequests = [];
  const model = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.once("end", () => {
      modelRequests.push({
        method: request.method,
        target: request.url,
        headers: rawFieldPairs(request.rawHeaders),
        entity: Buffer.concat(chunks),
      });
      response.sendDate = false;
      response.writeHead(204, "Recorded", ["Connection", "close"]);
      response.end();
    });
  });
  await listen(model);

  const recorderPort = await reservePort();
  const recorder = spawn(
    process.execPath,
    [
      "src/index.mjs",
      "--upstream-base-url", `http://127.0.0.1:${model.address().port}/anthropic`,
      "--output-root", outputRoot,
      "--listen", `127.0.0.1:${recorderPort}`,
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
  await waitForOutput(recorder, `Recorder listening on http://127.0.0.1:${recorderPort}`);

  return {
    modelRequests,
    outputRoot,
    recorderPort,
    async stopRecorder() {
      recorder.kill("SIGINT");
      const [exitCode, signal] = await recorderExit;
      assert.equal(exitCode, 0, `Recorder exited via ${signal ?? "an error"}`);
    },
  };
}

function sendHarnessRequest({ port, method, target, headers, holdEntity = false }) {
  const response = Promise.withResolvers();
  const request = http.request({
    host: "127.0.0.1",
    port,
    method,
    path: target,
    agent: false,
    headers,
  });
  request.once("error", response.reject);
  request.once("response", (incoming) => {
    incoming.resume();
    incoming.once("error", response.reject);
    incoming.once("end", () => response.resolve(incoming.statusCode));
  });
  if (holdEntity) request.flushHeaders();
  else request.end();
  return { request, response: response.promise };
}

function requestHeaders(authority, sessionFields = []) {
  return [
    ["Host", authority],
    ...sessionFields,
    ["Content-Length", "0"],
    ["Connection", "close"],
  ];
}

function sendRawHarnessRequest({ port, method, target, headers }) {
  const response = Promise.withResolvers();
  const chunks = [];
  const request = net.createConnection({ host: "127.0.0.1", port });
  request.once("connect", () => {
    const startAndHeaders = [
      `${method} ${target} HTTP/1.1`,
      ...headers.map(([name, value]) => `${name}: ${value}`),
      "",
      "",
    ].join("\r\n");
    request.write(Buffer.from(startAndHeaders, "latin1"));
  });
  request.on("data", (chunk) => chunks.push(chunk));
  request.once("error", response.reject);
  request.once("end", () => {
    const statusLine = Buffer.concat(chunks).toString("latin1").split("\r\n", 1)[0];
    response.resolve(Number(statusLine.split(" ", 3)[1]));
  });
  return { request, response: response.promise };
}

async function waitForSessionDirectory(outputRoot) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const entries = await readdir(outputRoot);
    if (entries.length > 0) return entries[0];
    await delay(10);
  }
  throw new Error("Recorder did not acquire a Harness Session");
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
