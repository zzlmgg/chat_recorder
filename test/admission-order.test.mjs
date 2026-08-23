import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import {
  listen,
  readJson,
  reservePort,
  waitForOutput,
} from "../test-support/recorder-test-helpers.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("overlapping Model Exchanges persist in request-header admission order", async (t) => {
  const fixture = await startRecorderFixture(t);
  const pendingHarnessExchanges = [];
  for (const sequence of [1, 2, 3]) {
    const pending = fixture.startExchange(sequence);
    pendingHarnessExchanges.push(pending);
    pending.request.flushHeaders();
    await waitForIndexLength(fixture.sessionRoot, sequence);
  }

  assert.deepEqual(await readJson(path.join(fixture.sessionRoot, "index.json")), {
    artifact_version: 1,
    session_id: "admission-order-session",
    exchanges: ["exchange-000001", "exchange-000002", "exchange-000003"],
  });

  for (const sequence of [3, 1, 2]) {
    pendingHarnessExchanges[sequence - 1].request.end(requestEntity(sequence));
    await fixture.exchangeGates[sequence - 1].requestComplete.promise;
  }

  const harnessCompletionOrder = [];
  for (const sequence of [2, 3, 1]) {
    fixture.exchangeGates[sequence - 1].mayRespond.resolve();
    const response = await pendingHarnessExchanges[sequence - 1].response;
    harnessCompletionOrder.push(sequence);
    assert.equal(response.status, 210 + sequence);
    assert.deepEqual(response.entity, responseEntity(sequence));
  }
  assert.deepEqual(harnessCompletionOrder, [2, 3, 1]);

  const laterExchange = fixture.startExchange(4);
  laterExchange.request.end(requestEntity(4));
  const laterResponse = await laterExchange.response;
  assert.equal(laterResponse.status, 214);
  assert.deepEqual(laterResponse.entity, responseEntity(4));

  await fixture.stopRecorder();

  const exchangeNames = [
    "exchange-000001",
    "exchange-000002",
    "exchange-000003",
    "exchange-000004",
  ];
  assert.deepEqual(await readJson(path.join(fixture.sessionRoot, "index.json")), {
    artifact_version: 1,
    session_id: "admission-order-session",
    exchanges: exchangeNames,
  });
  assert.deepEqual(
    (await readdir(fixture.outputRoot)).sort(),
    ["session-admission-order-session"],
  );
  assert.deepEqual((await readdir(fixture.sessionRoot)).sort(), [...exchangeNames, "index.json"]);
  assert.deepEqual(fixture.modelResponseCompletionOrder, [2, 3, 1, 4]);

  for (const [index, exchangeName] of exchangeNames.entries()) {
    const sequence = index + 1;
    const exchangeRoot = path.join(fixture.sessionRoot, exchangeName);
    assert.deepEqual((await readdir(exchangeRoot)).sort(), [
      "request.body",
      "request.json",
      "response.body",
      "response.json",
      "upstream-request.json",
    ]);
    assert.equal(
      (await readJson(path.join(exchangeRoot, "request.json"))).target,
      `/v1/messages?admission=${sequence}`,
    );
    assert.equal(
      (await readJson(path.join(exchangeRoot, "upstream-request.json"))).target,
      `/anthropic/v1/messages?admission=${sequence}`,
    );
    assert.deepEqual(
      await readFile(path.join(exchangeRoot, "request.body")),
      requestEntity(sequence),
    );
    const responseMetadata = await readJson(path.join(exchangeRoot, "response.json"));
    assert.equal(responseMetadata.status, 210 + sequence);
    assert.equal(responseMetadata.reason, `Model Response ${sequence}`);
    assert.deepEqual(
      await readFile(path.join(exchangeRoot, "response.body")),
      responseEntity(sequence),
    );
  }

  assert.deepEqual(
    fixture.modelRequests.map(({ sequence, entity }) => ({ sequence, entity })),
    [3, 1, 2, 4].map((sequence) => ({ sequence, entity: requestEntity(sequence) })),
  );
});

async function startRecorderFixture(t) {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "recorder-admission-order-"));
  const exchangeGates = [0, 1, 2].map(() => ({
    requestComplete: Promise.withResolvers(),
    mayRespond: Promise.withResolvers(),
  }));
  const modelRequests = [];
  const modelResponseCompletionOrder = [];
  const model = http.createServer((request, response) => {
    const sequence = Number(
      new URL(request.url, "http://model.invalid").searchParams.get("admission"),
    );
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.once("end", async () => {
      modelRequests.push({ sequence, entity: Buffer.concat(chunks) });
      if (sequence <= 3) {
        exchangeGates[sequence - 1].requestComplete.resolve();
        await exchangeGates[sequence - 1].mayRespond.promise;
      }
      response.sendDate = false;
      response.writeHead(210 + sequence, `Model Response ${sequence}`, [
        "Content-Type", "application/octet-stream",
        "Content-Length", String(responseEntity(sequence).length),
        "Connection", "close",
      ]);
      response.end(responseEntity(sequence), () => {
        modelResponseCompletionOrder.push(sequence);
      });
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
    exchangeGates,
    modelRequests,
    modelResponseCompletionOrder,
    outputRoot,
    sessionRoot: path.join(outputRoot, "session-admission-order-session"),
    startExchange(sequence) {
      return startHarnessExchange(recorderPort, sequence);
    },
    async stopRecorder() {
      recorder.kill("SIGINT");
      const [exitCode, signal] = await recorderExit;
      assert.equal(exitCode, 0, `Recorder exited via ${signal ?? "an error"}`);
    },
  };
}

function startHarnessExchange(port, sequence) {
  const responseResult = Promise.withResolvers();
  const request = http.request({
    host: "127.0.0.1",
    port,
    method: "POST",
    path: `/v1/messages?admission=${sequence}`,
    agent: false,
    headers: [
      ["Host", `127.0.0.1:${port}`],
      ["X-Claude-Code-Session-Id", "admission-order-session"],
      ["Content-Type", "application/octet-stream"],
      ["Content-Length", String(requestEntity(sequence).length)],
      ["Connection", "close"],
    ],
  });
  request.once("error", responseResult.reject);
  request.once("response", (response) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.once("error", responseResult.reject);
    response.once("end", () => {
      responseResult.resolve({ status: response.statusCode, entity: Buffer.concat(chunks) });
    });
  });
  return { request, response: responseResult.promise };
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

function responseEntity(sequence) {
  return Buffer.from(`response-entity-${sequence}`);
}
