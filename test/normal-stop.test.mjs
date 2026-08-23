import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setImmediate as yieldTurn, setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import {
  listen,
  rawFieldPairs,
  readJson,
  reservePort,
  waitForOutput,
} from "../test-support/recorder-test-helpers.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("normal stop closes admission and drains every admitted Model Exchange before exit", { timeout: 10_000 }, async (t) => {
  const fixture = await startRecorderFixture(t);
  const completed = await sendModelExchange(fixture.recorderPort, 1);
  assert.deepEqual(completed.entity, responseEntity(1));

  const persistentExchange = await openPersistentExchange(fixture.recorderPort, 2);
  await fixture.waitForModelResponseStart(2);
  const finalExchange = sendModelExchange(fixture.recorderPort, 3, {
    requestTrailers: [["X-Request-Final", "request-finished"]],
  });
  await fixture.waitForModelResponseStart(3);
  await waitForIndexLength(fixture.sessionRoot, 3);

  fixture.recorder.kill("SIGINT");
  await waitForListenerToClose(fixture.recorderPort);
  persistentExchange.sendLaterRequest(4);
  await yieldTurn();
  assert.equal(fixture.recorder.exitCode, null, "the Recorder exited with admitted responses incomplete");

  fixture.completeModelResponse(2);
  await fixture.waitForModelResponseCompletion(2);
  await yieldTurn();
  assert.equal(fixture.recorder.exitCode, null, "the Recorder exited before every admitted exchange completed");

  fixture.completeModelResponse(3);
  const [finalResponse, persistentBytes, [exitCode, signal]] = await Promise.all([
    finalExchange,
    persistentExchange.response,
    fixture.recorderExit,
  ]);
  assert.equal(exitCode, 0, `Recorder exited via ${signal ?? "an error"}`);
  assert.deepEqual(finalResponse.entity, responseEntity(3));
  assert.deepEqual(finalResponse.trailers, [["X-Model-Final", "response-3-finished"]]);
  assert.match(persistentBytes.toString("latin1"), /HTTP\/1\.1 503 Service Unavailable/);
  assert.ok(
    persistentBytes.includes(responseEntity(2)),
    "the admitted response was not complete before the persistent connection closed",
  );

  assert.deepEqual(fixture.modelRequests.map(({ sequence }) => sequence), [1, 2, 3]);
  assert.deepEqual(await readJson(path.join(fixture.sessionRoot, "index.json")), {
    artifact_version: 1,
    session_id: "normal-stop-session",
    exchanges: ["exchange-000001", "exchange-000002", "exchange-000003"],
  });
  assert.deepEqual((await readdir(fixture.sessionRoot)).sort(), [
    "exchange-000001",
    "exchange-000002",
    "exchange-000003",
    "index.json",
  ]);

  for (const sequence of [1, 2, 3]) {
    const exchangeRoot = path.join(
      fixture.sessionRoot,
      `exchange-${String(sequence).padStart(6, "0")}`,
    );
    assert.deepEqual((await readdir(exchangeRoot)).sort(), [
      "request.body",
      "request.json",
      "response.body",
      "response.json",
      "upstream-request.json",
    ]);
    assert.deepEqual(await readFile(path.join(exchangeRoot, "request.body")), requestEntity(sequence));
    assert.deepEqual(await readFile(path.join(exchangeRoot, "response.body")), responseEntity(sequence));
  }

  const finalExchangeRoot = path.join(fixture.sessionRoot, "exchange-000003");
  assert.deepEqual(
    (await readJson(path.join(finalExchangeRoot, "request.json"))).trailers,
    [["X-Request-Final", "request-finished"]],
  );
  assert.deepEqual(
    (await readJson(path.join(finalExchangeRoot, "upstream-request.json"))).trailers,
    [["X-Request-Final", "request-finished"]],
  );
  assert.deepEqual(
    (await readJson(path.join(finalExchangeRoot, "response.json"))).trailers,
    [["X-Model-Final", "response-3-finished"]],
  );
});

test("normal stop before Harness Session acquisition leaves no session artifact", async (t) => {
  const fixture = await startRecorderFixture(t, "recorder-normal-stop-unacquired-");

  fixture.recorder.kill("SIGTERM");
  const [exitCode, signal] = await fixture.recorderExit;

  assert.equal(exitCode, 0, `Recorder exited via ${signal ?? "an error"}`);
  assert.deepEqual(await readdir(fixture.outputRoot), []);
  assert.deepEqual(fixture.modelRequests, []);
});

async function startRecorderFixture(t, outputPrefix = "recorder-normal-stop-") {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), outputPrefix));
  const exchangeGates = new Map([
    [2, createExchangeGate()],
    [3, createExchangeGate()],
  ]);
  const modelRequests = [];
  const model = http.createServer((request, response) => {
    const sequence = Number(new URL(request.url, "http://model.invalid").searchParams.get("sequence"));
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.once("end", async () => {
      modelRequests.push({
        sequence,
        entity: Buffer.concat(chunks),
        trailers: rawFieldPairs(request.rawTrailers),
      });

      if (sequence === 1 || sequence === 4) {
        response.sendDate = false;
        response.writeHead(220 + sequence, `Model Response ${sequence}`, [
          "Content-Length", String(responseEntity(sequence).length),
          "Connection", sequence === 1 ? "close" : "keep-alive",
        ]);
        response.end(responseEntity(sequence));
        return;
      }

      const gate = exchangeGates.get(sequence);
      response.sendDate = false;
      if (sequence === 2) {
        response.writeHead(222, "Model Response 2", [
          "Content-Type", "application/octet-stream",
          "Content-Length", String(responseEntity(2).length),
          "Connection", "keep-alive",
        ]);
      } else {
        response.writeHead(223, "Model Response 3", [
          "Content-Type", "application/octet-stream",
          "Trailer", "X-Model-Final",
          "Transfer-Encoding", "chunked",
          "Connection", "close",
        ]);
      }
      response.write(responsePrefix(sequence));
      gate.responseStarted.resolve();
      await gate.mayComplete.promise;
      if (sequence === 3) response.addTrailers([["X-Model-Final", "response-3-finished"]]);
      response.end(responseRemainder(sequence), gate.responseComplete.resolve);
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
    recorder,
    recorderExit,
    recorderPort,
    sessionRoot: path.join(outputRoot, "session-normal-stop-session"),
    completeModelResponse(sequence) {
      exchangeGates.get(sequence).mayComplete.resolve();
    },
    waitForModelResponseCompletion(sequence) {
      return exchangeGates.get(sequence).responseComplete.promise;
    },
    waitForModelResponseStart(sequence) {
      return exchangeGates.get(sequence).responseStarted.promise;
    },
  };
}

function createExchangeGate() {
  return {
    mayComplete: Promise.withResolvers(),
    responseComplete: Promise.withResolvers(),
    responseStarted: Promise.withResolvers(),
  };
}

function sendModelExchange(port, sequence, { requestTrailers = [] } = {}) {
  return new Promise((resolve, reject) => {
    const hasTrailers = requestTrailers.length > 0;
    const headers = [
      ["Host", `127.0.0.1:${port}`],
      ["X-Claude-Code-Session-Id", "normal-stop-session"],
      ["Content-Type", "application/octet-stream"],
      ...(hasTrailers
        ? [["Trailer", "X-Request-Final"], ["Transfer-Encoding", "chunked"]]
        : [["Content-Length", String(requestEntity(sequence).length)]]),
      ["Connection", "close"],
    ];
    const request = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: `/v1/messages?sequence=${sequence}`,
      agent: false,
      headers,
    });
    request.once("error", reject);
    request.once("response", (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => {
        resolve({
          entity: Buffer.concat(chunks),
          status: response.statusCode,
          trailers: rawFieldPairs(response.rawTrailers),
        });
      });
    });
    request.write(requestEntity(sequence));
    if (hasTrailers) request.addTrailers(requestTrailers);
    request.end();
  });
}

async function openPersistentExchange(port, sequence) {
  const response = Promise.withResolvers();
  const chunks = [];
  const socket = net.createConnection({ host: "127.0.0.1", port });
  socket.on("data", (chunk) => chunks.push(chunk));
  socket.once("error", response.reject);
  socket.once("end", () => response.resolve(Buffer.concat(chunks)));
  await once(socket, "connect");
  socket.write(rawHarnessRequest(port, sequence, "keep-alive", requestEntity(sequence)));

  return {
    response: response.promise,
    sendLaterRequest(laterSequence) {
      socket.write(rawHarnessRequest(port, laterSequence, "close", Buffer.alloc(0)));
    },
  };
}

function rawHarnessRequest(port, sequence, connection, entity) {
  return Buffer.concat([
    Buffer.from([
      `POST /v1/messages?sequence=${sequence} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      "X-Claude-Code-Session-Id: normal-stop-session",
      "Content-Type: application/octet-stream",
      `Content-Length: ${entity.length}`,
      `Connection: ${connection}`,
      "",
      "",
    ].join("\r\n"), "latin1"),
    entity,
  ]);
}

async function waitForListenerToClose(port) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const outcome = await new Promise((resolve) => {
      socket.once("connect", () => resolve("connected"));
      socket.once("error", (error) => resolve(error.code));
    });
    socket.destroy();
    if (outcome === "ECONNREFUSED") return;
    await delay(10);
  }
  throw new Error("Recorder did not close its listening boundary during normal stop");
}

async function waitForIndexLength(sessionRoot, expectedLength) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      const index = await readJson(path.join(sessionRoot, "index.json"));
      if (index.exchanges.length === expectedLength) return;
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    await delay(10);
  }
  throw new Error(`Recorder did not index ${expectedLength} admitted Model Exchanges`);
}

function requestEntity(sequence) {
  return Buffer.from(`request-entity-${sequence}`);
}

function responsePrefix(sequence) {
  return Buffer.from(`response-prefix-${sequence}:`);
}

function responseRemainder(sequence) {
  return Buffer.from(`response-remainder-${sequence}`);
}

function responseEntity(sequence) {
  return Buffer.concat([responsePrefix(sequence), responseRemainder(sequence)]);
}
