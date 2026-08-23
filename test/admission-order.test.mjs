import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
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
  const admitted = [];
  for (const sequence of [1, 2, 3]) {
    admitted.push(fixture.sendExchange(sequence));
    await fixture.modelReceived[sequence - 1].promise;
  }

  assert.deepEqual(await readJson(path.join(fixture.sessionRoot, "index.json")), {
    artifact_version: 1,
    session_id: "admission-order-session",
    exchanges: ["exchange-000001", "exchange-000002", "exchange-000003"],
  });

  const harnessCompletionOrder = [];
  for (const sequence of [2, 3, 1]) {
    fixture.modelMayRespond[sequence - 1].resolve();
    const response = await admitted[sequence - 1];
    harnessCompletionOrder.push(sequence);
    assert.equal(response.status, 210 + sequence);
    assert.deepEqual(response.entity, responseEntity(sequence));
  }
  assert.deepEqual(harnessCompletionOrder, [2, 3, 1]);

  const laterResponse = await fixture.sendExchange(4);
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
    [1, 2, 3, 4].map((sequence) => ({ sequence, entity: requestEntity(sequence) })),
  );
});

async function startRecorderFixture(t) {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "recorder-admission-order-"));
  const modelReceived = [0, 1, 2].map(() => Promise.withResolvers());
  const modelMayRespond = [0, 1, 2].map(() => Promise.withResolvers());
  const modelRequests = [];
  const modelResponseCompletionOrder = [];
  const model = http.createServer((request, response) => {
    const sequence = Number(new URL(request.url, "http://model.invalid").searchParams.get("admission"));
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.once("end", async () => {
      modelRequests.push({ sequence, entity: Buffer.concat(chunks) });
      if (sequence <= 3) {
        modelReceived[sequence - 1].resolve();
        await modelMayRespond[sequence - 1].promise;
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
    modelMayRespond,
    modelReceived,
    modelRequests,
    modelResponseCompletionOrder,
    outputRoot,
    sessionRoot: path.join(outputRoot, "session-admission-order-session"),
    sendExchange(sequence) {
      return sendHarnessRequest(recorderPort, sequence);
    },
    async stopRecorder() {
      recorder.kill("SIGINT");
      const [exitCode, signal] = await recorderExit;
      assert.equal(exitCode, 0, `Recorder exited via ${signal ?? "an error"}`);
    },
  };
}

function sendHarnessRequest(port, sequence) {
  return new Promise((resolve, reject) => {
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
    request.once("error", reject);
    request.once("response", (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => {
        resolve({ status: response.statusCode, entity: Buffer.concat(chunks) });
      });
    });
    request.end(requestEntity(sequence));
  });
}

function requestEntity(sequence) {
  return Buffer.from(`request-entity-${sequence}`);
}

function responseEntity(sequence) {
  return Buffer.from(`response-entity-${sequence}`);
}
