import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  listen,
  rawFieldPairs,
  readJson,
  reservePort,
  waitForOutput,
} from "./support/recorder-test-helpers.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("the Model response envelope is preserved and relayed across only the required hop changes", async (t) => {
  const responseEntity = Buffer.from("event: message\r\ndata: {\"future\":true}\r\n\r\n");
  const sourceHeaders = [
    ["cOnTeNt-TyPe", "text/event-stream"],
    ["X-Future-Response", "future-value"],
    ["X-Duplicate", "first"],
    ["x-DUPLICATE", "second"],
    ["Connection", "keep-alive, X-Remove-Me"],
    ["X-Remove-Me", "must-not-cross-hop"],
    ["Keep-Alive", "timeout=5"],
    ["Trailer", "X-Future-Trailer, x-future-trailer, X-Remove-Me"],
    ["Transfer-Encoding", "chunked"],
  ];
  const sourceTrailers = [
    ["X-Future-Trailer", "first-trailer"],
    ["x-future-trailer", "second-trailer"],
    ["X-Remove-Me", "must-not-cross-hop"],
  ];
  const model = http.createServer((request, response) => {
    request.resume();
    request.once("end", () => {
      response.sendDate = false;
      response.writeHead(299, "Model Envelope Preserved", sourceHeaders.flat());
      response.write(responseEntity);
      response.addTrailers(sourceTrailers);
      response.end();
    });
  });
  await listen(model);

  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "recorder-response-envelope-"));
  const recorderPort = await reservePort();
  const recorderAuthority = `127.0.0.1:${recorderPort}`;
  const recorder = spawn(
    process.execPath,
    [
      "src/index.mjs",
      "--upstream-base-url", `http://127.0.0.1:${model.address().port}/anthropic`,
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

  const harnessResponse = await sendHarnessRequest(recorderPort);
  assert.deepEqual(harnessResponse, {
    httpVersion: "1.1",
    status: 299,
    reason: "Model Envelope Preserved",
    headers: [
      ["cOnTeNt-TyPe", "text/event-stream"],
      ["X-Future-Response", "future-value"],
      ["X-Duplicate", "first"],
      ["x-DUPLICATE", "second"],
      ["Connection", "close"],
      ["Transfer-Encoding", "chunked"],
    ],
    trailers: sourceTrailers.slice(0, 2),
    entity: responseEntity,
  });

  recorder.kill("SIGINT");
  const [exitCode, signal] = await recorderExit;
  assert.equal(exitCode, 0, `Recorder exited via ${signal ?? "an error"}`);

  const exchangeRoot = path.join(
    outputRoot,
    "session-response-envelope-001",
    "exchange-000001",
  );
  assert.deepEqual(await readJson(path.join(exchangeRoot, "response.json")), {
    http_version: "1.1",
    status: 299,
    reason: "Model Envelope Preserved",
    headers: sourceHeaders,
    trailers: sourceTrailers,
    entity_file: "response.body",
  });
  assert.deepEqual(await readFile(path.join(exchangeRoot, "response.body")), responseEntity);
});

function sendHarnessRequest(port) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/v1/messages?beta=true",
      agent: false,
      headers: [
        ["Host", `127.0.0.1:${port}`],
        ["X-Claude-Code-Session-Id", "response-envelope-001"],
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
          httpVersion: response.httpVersion,
          status: response.statusCode,
          reason: response.statusMessage,
          headers: rawFieldPairs(response.rawHeaders),
          trailers: rawFieldPairs(response.rawTrailers),
          entity: Buffer.concat(chunks),
        });
      });
    });
    request.end();
  });
}
