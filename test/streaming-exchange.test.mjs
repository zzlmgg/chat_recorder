import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setImmediate as yieldTurn, setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("an opaque Model Exchange streams and is recorded byte-for-byte", { timeout: 10_000 }, async (t) => {
  const requestPrefix = Buffer.from([0x00, 0xff, 0x7f, 0x80, 0x0d, 0x0a]);
  const requestRemainder = Buffer.from(
    "{\"unknown\":true}\r\n--future-delimiter--\r\nevent: request\ndata: [opaque]\n\n",
  );
  const expectedRequest = Buffer.concat([requestPrefix, requestRemainder]);
  const responsePrefix = Buffer.from("event: future\r\ndata: {\"prefix\":true}\r\n\r\n");
  const responseRemainder = Buffer.concat([
    Buffer.from("data: [binary-follows]\n\n"),
    Buffer.from([0x00, 0xfe, 0x81, 0x0a, 0x0d]),
  ]);
  const expectedResponse = Buffer.concat([responsePrefix, responseRemainder]);
  const modelSawRequestPrefix = Promise.withResolvers();
  const modelMayCompleteResponse = Promise.withResolvers();
  const modelRequestComplete = Promise.withResolvers();
  const modelRequestChunks = [];
  let modelRequestBytes = 0;
  let modelResponseComplete = false;
  let modelRequestHeaders;

  const model = http.createServer((request, response) => {
    modelRequestHeaders = rawHeaderPairs(request.rawHeaders);
    request.on("data", (chunk) => {
      modelRequestChunks.push(chunk);
      modelRequestBytes += chunk.length;
      if (modelRequestBytes >= requestPrefix.length) modelSawRequestPrefix.resolve();
    });
    request.once("error", modelRequestComplete.reject);
    request.once("end", async () => {
      response.sendDate = false;
      response.writeHead(200, "Opaque Model Response", [
        "Content-Type", "text/event-stream",
        "Content-Encoding", "x-opaque-test",
        "Content-Length", String(expectedResponse.length),
        "Connection", "close",
      ]);
      response.write(responsePrefix);
      await modelMayCompleteResponse.promise;
      response.end(responseRemainder, () => {
        modelResponseComplete = true;
        modelRequestComplete.resolve();
      });
    });
  });
  const fixture = await startRecorderFixture(t, {
    model,
    outputPrefix: "recorder-streaming-exchange-",
    sessionComponent: "session-opaque-stream-001",
  });
  const { exchangeRoot, recorderPort } = fixture;

  const harnessResponseStarted = Promise.withResolvers();
  const harnessResponseComplete = Promise.withResolvers();
  const harnessResponseChunks = [];
  let harnessResponseBytes = 0;
  let harnessResponseMetadata;
  const harnessRequest = http.request({
    host: "127.0.0.1",
    port: recorderPort,
    method: "POST",
    path: "/v1/messages?beta=true",
    agent: false,
    headers: [
      ["Host", `127.0.0.1:${recorderPort}`],
      ["X-Claude-Code-Session-Id", "opaque-stream-001"],
      ["Content-Type", "application/octet-stream"],
      ["Content-Encoding", "x-opaque-test"],
      ["Content-Length", String(expectedRequest.length)],
      ["Connection", "close"],
    ],
  });
  harnessRequest.once("error", harnessResponseComplete.reject);
  harnessRequest.once("response", (response) => {
    harnessResponseMetadata = {
      status: response.statusCode,
      reason: response.statusMessage,
      headers: rawHeaderPairs(response.rawHeaders),
    };
    response.on("data", (chunk) => {
      harnessResponseChunks.push(chunk);
      harnessResponseBytes += chunk.length;
      if (harnessResponseBytes >= responsePrefix.length) harnessResponseStarted.resolve();
    });
    response.once("error", harnessResponseComplete.reject);
    response.once("end", harnessResponseComplete.resolve);
  });

  harnessRequest.write(requestPrefix);
  await modelSawRequestPrefix.promise;
  assert.deepEqual(Buffer.concat(modelRequestChunks), requestPrefix);
  await waitForFileBytes(path.join(exchangeRoot, "request.body"), requestPrefix);

  harnessRequest.end(requestRemainder);
  await harnessResponseStarted.promise;
  assert.equal(modelResponseComplete, false);
  assert.deepEqual(Buffer.concat(harnessResponseChunks), responsePrefix);
  await waitForFileBytes(path.join(exchangeRoot, "response.body"), responsePrefix);

  modelMayCompleteResponse.resolve();
  await Promise.all([harnessResponseComplete.promise, modelRequestComplete.promise]);

  assert.deepEqual(Buffer.concat(modelRequestChunks), expectedRequest);
  assert.deepEqual(await readFile(path.join(exchangeRoot, "request.body")), expectedRequest);
  assert.deepEqual(Buffer.concat(harnessResponseChunks), expectedResponse);
  assert.deepEqual(await readFile(path.join(exchangeRoot, "response.body")), expectedResponse);
  assert.ok(modelRequestHeaders.some(
    ([name, value]) => name.toLowerCase() === "content-encoding" && value === "x-opaque-test",
  ));
  assert.deepEqual(harnessResponseMetadata, {
    status: 200,
    reason: "Opaque Model Response",
    headers: [
      ["Content-Type", "text/event-stream"],
      ["Content-Encoding", "x-opaque-test"],
      ["Content-Length", String(expectedResponse.length)],
      ["Connection", "close"],
    ],
  });

  await fixture.stopRecorder();
});

test("slow network consumers bound buffering without changing source bytes", { timeout: 20_000 }, async (t) => {
  const expectedRequest = patternedBytes(32 * 1024 * 1024, 17);
  const expectedResponse = patternedBytes(32 * 1024 * 1024, 93);
  const modelMayReadRequest = Promise.withResolvers();
  const modelSawRequest = Promise.withResolvers();
  const modelRequestChunks = [];
  const modelComplete = Promise.withResolvers();
  let modelResponseBackpressure = 0;
  let modelResponseWriteComplete = false;

  const model = http.createServer((request, response) => {
    request.pause();
    request.on("data", (chunk) => {
      modelRequestChunks.push(chunk);
    });
    request.once("error", modelComplete.reject);
    request.once("end", async () => {
      try {
        response.sendDate = false;
        response.writeHead(200, "Backpressured Model Response", [
          "Content-Type", "application/octet-stream",
          "Content-Length", String(expectedResponse.length),
          "Connection", "close",
        ]);
        modelResponseBackpressure = await writeChunks(response, expectedResponse);
        modelResponseWriteComplete = true;
        response.end(modelComplete.resolve);
      } catch (error) {
        modelComplete.reject(error);
      }
    });
    modelSawRequest.resolve();
    modelMayReadRequest.promise.then(() => request.resume(), modelComplete.reject);
  });
  const fixture = await startRecorderFixture(t, {
    model,
    outputPrefix: "recorder-backpressure-exchange-",
    sessionComponent: "session-backpressure-001",
  });
  const { exchangeRoot, recorderPort } = fixture;

  const harnessMayReadResponse = Promise.withResolvers();
  const harnessSawResponse = Promise.withResolvers();
  const harnessResponseComplete = Promise.withResolvers();
  const harnessResponseChunks = [];
  const harnessRequest = http.request({
    host: "127.0.0.1",
    port: recorderPort,
    method: "POST",
    path: "/v1/messages",
    agent: false,
    headers: [
      ["Host", `127.0.0.1:${recorderPort}`],
      ["X-Claude-Code-Session-Id", "backpressure-001"],
      ["Content-Type", "application/octet-stream"],
      ["Content-Length", String(expectedRequest.length)],
      ["Connection", "close"],
    ],
  });
  harnessRequest.once("error", harnessResponseComplete.reject);
  harnessRequest.once("response", (response) => {
    response.pause();
    response.on("data", (chunk) => {
      harnessResponseChunks.push(chunk);
    });
    response.once("error", harnessResponseComplete.reject);
    response.once("end", harnessResponseComplete.resolve);
    harnessSawResponse.resolve();
    harnessMayReadResponse.promise.then(() => response.resume(), harnessResponseComplete.reject);
  });

  let harnessRequestWriteComplete = false;
  const harnessRequestWrite = writeChunks(harnessRequest, expectedRequest).then((backpressureCount) => {
    harnessRequestWriteComplete = true;
    harnessRequest.end();
    return backpressureCount;
  });

  await modelSawRequest.promise;
  await delay(250);
  assert.equal(
    harnessRequestWriteComplete,
    false,
    "a Harness entity larger than the socket buffers must remain backpressured while the Model is paused",
  );
  assert.ok(
    (await stat(path.join(exchangeRoot, "request.body"))).size < expectedRequest.length,
    "the Recorder must not absorb the complete request while the Model is paused",
  );

  modelMayReadRequest.resolve();
  const harnessRequestBackpressure = await harnessRequestWrite;
  await harnessSawResponse.promise;
  await delay(250);
  assert.equal(
    modelResponseWriteComplete,
    false,
    "a Model entity larger than the socket buffers must remain backpressured while the Harness is paused",
  );
  assert.ok(
    (await stat(path.join(exchangeRoot, "response.body"))).size < expectedResponse.length,
    "the Recorder must not absorb the complete response while the Harness is paused",
  );

  harnessMayReadResponse.resolve();
  await Promise.all([harnessResponseComplete.promise, modelComplete.promise]);

  assert.ok(harnessRequestBackpressure > 0, "the slow Model must backpressure the Harness writer");
  assert.ok(modelResponseBackpressure > 0, "the slow Harness must backpressure the Model writer");
  assert.deepEqual(Buffer.concat(modelRequestChunks), expectedRequest);
  assert.deepEqual(await readFile(path.join(exchangeRoot, "request.body")), expectedRequest);
  assert.deepEqual(Buffer.concat(harnessResponseChunks), expectedResponse);
  assert.deepEqual(await readFile(path.join(exchangeRoot, "response.body")), expectedResponse);

  await fixture.stopRecorder();
});

function rawHeaderPairs(rawFields) {
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

async function startRecorderFixture(t, { model, outputPrefix, sessionComponent }) {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), outputPrefix));
  const recorderPort = await reservePort();
  await listen(model);
  const modelAddress = model.address();
  const { recorder, recorderExit } = await spawnRecorder({
    outputRoot,
    recorderPort,
    upstreamBaseUrl: `http://127.0.0.1:${modelAddress.port}/anthropic`,
  });

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

  return {
    exchangeRoot: path.join(outputRoot, sessionComponent, "exchange-000001"),
    recorderPort,
    async stopRecorder() {
      recorder.kill("SIGINT");
      const [exitCode, signal] = await recorderExit;
      assert.equal(exitCode, 0, `Recorder exited via ${signal ?? "an error"}`);
    },
  };
}

async function spawnRecorder({ outputRoot, recorderPort, upstreamBaseUrl }) {
  const recorder = spawn(
    process.execPath,
    [
      "src/index.mjs",
      "--upstream-base-url", upstreamBaseUrl,
      "--output-root", outputRoot,
      "--listen", `127.0.0.1:${recorderPort}`,
    ],
    {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const recorderExit = once(recorder, "exit");
  await waitForOutput(recorder, `Recorder listening on http://127.0.0.1:${recorderPort}`);
  return { recorder, recorderExit };
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

async function waitForFileBytes(file, expected) {
  while (true) {
    try {
      const actual = await readFile(file);
      if (actual.length >= expected.length) {
        assert.deepEqual(actual, expected);
        return;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await yieldTurn();
  }
}

function patternedBytes(length, offset) {
  const bytes = Buffer.allocUnsafe(length);
  for (let index = 0; index < length; index += 1) bytes[index] = (index + offset) % 256;
  return bytes;
}

async function writeChunks(destination, bytes) {
  let backpressureCount = 0;
  for (let offset = 0; offset < bytes.length; offset += 8 * 1024) {
    const chunk = bytes.subarray(offset, Math.min(offset + 8 * 1024, bytes.length));
    if (!destination.write(chunk)) {
      backpressureCount += 1;
      await once(destination, "drain");
    }
  }
  return backpressureCount;
}
