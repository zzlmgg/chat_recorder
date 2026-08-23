import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { test } from "node:test";
import {
  listen,
  reservePort,
  waitForOutput,
} from "../test-support/recorder-test-helpers.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("sequential Model Exchanges reuse the Harness and Model HTTP/1.1 connections", async (t) => {
  const modelSockets = new Set();
  const modelHttpVersions = [];
  const model = http.createServer((request, response) => {
    modelSockets.add(request.socket);
    modelHttpVersions.push(request.httpVersion);
    request.resume();
    request.once("end", () => {
      response.sendDate = false;
      response.writeHead(204, "Reusable", ["Content-Length", "0"]);
      response.end();
    });
  });
  const fixture = await startRecorderFixture(t, model, "recorder-http11-keep-alive-");
  const harnessAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => harnessAgent.destroy());
  const harnessSockets = [];

  for (const sequence of [1, 2, 3]) {
    const result = await sendHarnessExchange({
      port: fixture.recorderPort,
      agent: harnessAgent,
      sessionId: "keep-alive-session",
      target: `/v1/messages?sequence=${sequence}`,
    });
    harnessSockets.push(result.socket);
    assert.equal(result.status, 204);
    assert.equal(result.httpVersion, "1.1");
  }

  assert.equal(new Set(harnessSockets).size, 1, "the Harness-side connection was not reused");
  assert.equal(modelSockets.size, 1, "the shared upstream Agent did not reuse its connection");
  assert.deepEqual(modelHttpVersions, ["1.1", "1.1", "1.1"]);

  harnessAgent.destroy();
  await fixture.stopRecorder();
});

test("a quiet SSE response remains open and later completes", async (t) => {
  const responsePrefix = Buffer.from("event: message_start\ndata: {\"open\":true}\n\n");
  const responseRemainder = Buffer.from("event: message_stop\ndata: {\"done\":true}\n\n");
  const modelMayComplete = Promise.withResolvers();
  let modelResponseComplete = false;
  const model = http.createServer((request, response) => {
    request.resume();
    request.once("end", async () => {
      response.sendDate = false;
      response.writeHead(200, "Long Lived", [
        "Content-Type", "text/event-stream",
        "Connection", "keep-alive",
      ]);
      response.write(responsePrefix);
      await modelMayComplete.promise;
      response.end(responseRemainder, () => {
        modelResponseComplete = true;
      });
    });
  });
  const fixture = await startRecorderFixture(t, model, "recorder-http11-long-lived-");
  const responseStarted = Promise.withResolvers();
  const responseComplete = Promise.withResolvers();
  const responseChunks = [];
  let responseBytes = 0;
  const request = http.request({
    host: "127.0.0.1",
    port: fixture.recorderPort,
    method: "POST",
    path: "/v1/messages",
    agent: false,
    headers: [
      ["Host", `127.0.0.1:${fixture.recorderPort}`],
      ["X-Claude-Code-Session-Id", "long-lived-session"],
      ["Content-Length", "0"],
      ["Connection", "close"],
    ],
  });
  request.once("error", responseComplete.reject);
  request.once("response", (response) => {
    response.on("data", (chunk) => {
      responseChunks.push(chunk);
      responseBytes += chunk.length;
      if (responseBytes >= responsePrefix.length) responseStarted.resolve();
    });
    response.once("error", responseComplete.reject);
    response.once("end", responseComplete.resolve);
  });
  request.end();

  await responseStarted.promise;
  await yieldTurn();
  assert.equal(modelResponseComplete, false);

  modelMayComplete.resolve();
  await responseComplete.promise;
  assert.deepEqual(Buffer.concat(responseChunks), Buffer.concat([responsePrefix, responseRemainder]));

  await fixture.stopRecorder();
});

test("non-HTTP/1.1 Harness requests receive 505 before Harness Session acquisition", async (t) => {
  let modelRequestCount = 0;
  const model = http.createServer((request, response) => {
    modelRequestCount += 1;
    request.resume();
    request.once("end", () => {
      response.sendDate = false;
      response.writeHead(204, "Unexpected", ["Content-Length", "0"]);
      response.end();
    });
  });
  const fixture = await startRecorderFixture(t, model, "recorder-http11-version-");

  const http10Status = await sendRawHarnessRequest(fixture.recorderPort, [
    "POST /v1/messages HTTP/1.0",
    `Host: 127.0.0.1:${fixture.recorderPort}`,
    "X-Claude-Code-Session-Id: must-not-acquire-http10",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n"));
  assert.equal(http10Status, 505);

  const http2Status = await sendRawHarnessRequest(
    fixture.recorderPort,
    "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n",
  );
  assert.equal(http2Status, 505);

  const invalidVersionStatus = await sendRawHarnessRequest(fixture.recorderPort, [
    "POST /v1/messages HTTP/1.2",
    `Host: 127.0.0.1:${fixture.recorderPort}`,
    "X-Claude-Code-Session-Id: must-not-acquire-http12",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n"));
  assert.equal(invalidVersionStatus, 505);

  const malformedVersionStatus = await sendRawHarnessRequest(fixture.recorderPort, [
    "POST /v1/messages HTTP/1.X",
    `Host: 127.0.0.1:${fixture.recorderPort}`,
    "X-Claude-Code-Session-Id: must-not-acquire-malformed",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n"));
  assert.equal(malformedVersionStatus, 400);
  assert.equal(modelRequestCount, 0);
  assert.deepEqual(await readdir(fixture.outputRoot), []);

  await fixture.stopRecorder();
});

async function startRecorderFixture(t, model, outputPrefix) {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), outputPrefix));
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
    outputRoot,
    recorderPort,
    async stopRecorder() {
      recorder.kill("SIGINT");
      const [exitCode, signal] = await recorderExit;
      assert.equal(exitCode, 0, `Recorder exited via ${signal ?? "an error"}`);
    },
  };
}

function sendHarnessExchange({ port, agent, sessionId, target }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: target,
      agent,
      headers: [
        ["Host", `127.0.0.1:${port}`],
        ["X-Claude-Code-Session-Id", sessionId],
        ["Content-Length", "0"],
      ],
    });
    let socket;
    request.once("socket", (assignedSocket) => {
      socket = assignedSocket;
    });
    request.once("error", reject);
    request.once("response", (response) => {
      response.resume();
      response.once("error", reject);
      response.once("end", () => {
        resolve({
          socket,
          httpVersion: response.httpVersion,
          status: response.statusCode,
        });
      });
    });
    request.end();
  });
}

function sendRawHarnessRequest(port, bytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.end(bytes);
    });
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.once("error", reject);
    socket.once("end", () => {
      const statusLine = Buffer.concat(chunks).toString("latin1").split("\r\n", 1)[0];
      resolve(Number(statusLine.split(" ", 3)[1]));
    });
  });
}
