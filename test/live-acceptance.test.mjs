import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { once } from "node:events";
import { listen, reservePort } from "../test-support/recorder-test-helpers.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const liveDriver = path.join(projectRoot, "scripts", "live-acceptance.mjs");
const fakeHarness = path.join(projectRoot, "test-support", "fake-live-harness.mjs");

test("live acceptance requires explicit opt-in and reports every missing host input", () => {
  const disabled = spawnSync(process.execPath, [liveDriver], {
    cwd: projectRoot,
    encoding: "utf8",
    env: withoutLiveConfiguration(process.env),
  });
  assert.equal(disabled.status, 1);
  assert.match(disabled.stderr, /Live acceptance is disabled.*RECORDER_LIVE_ACCEPTANCE=1/);

  const missing = spawnSync(process.execPath, [liveDriver], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...withoutLiveConfiguration(process.env),
      RECORDER_LIVE_ACCEPTANCE: "1",
    },
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /RECORDER_LIVE_UPSTREAM_BASE_URL/);
  assert.match(missing.stderr, /RECORDER_LIVE_OUTPUT_ROOT/);
  assert.match(missing.stderr, /RECORDER_LIVE_CLI_PATH/);
  assert.match(missing.stderr, /RECORDER_LIVE_VSCODE_PATH/);
});

test("live acceptance drives both verified Harness entrypoints through fresh Recorders", { timeout: 15_000 }, async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "recorder-live-acceptance-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const calls = [];
  const model = http.createServer(async (request, response) => {
    const bodyChunks = [];
    for await (const chunk of request) bodyChunks.push(chunk);
    calls.push({
      body: Buffer.concat(bodyChunks),
      target: request.url,
    });
    response.writeHead(200, "OK", [
      "Content-Type", "text/event-stream; charset=utf-8",
      "Cache-Control", "no-cache",
      "Connection", "close",
    ]);
    response.write("event: message_start\ndata: {\"type\":\"message_start\"}\n\n");
    setImmediate(() => response.end("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"));
  });
  await listen(model);
  t.after(() => model.close());

  const recorderPort = await reservePort();
  const harnessLog = path.join(temporaryRoot, "harness.jsonl");
  const child = spawn(process.execPath, [liveDriver], {
    cwd: projectRoot,
    env: {
      ...withoutLiveConfiguration(process.env),
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${recorderPort}/`,
      FAKE_HARNESS_LOG: harnessLog,
      RECORDER_LIVE_ACCEPTANCE: "1",
      RECORDER_LIVE_UPSTREAM_BASE_URL: `http://127.0.0.1:${model.address().port}/anthropic`,
      RECORDER_LIVE_OUTPUT_ROOT: path.join(temporaryRoot, "artifacts"),
      RECORDER_LIVE_CLI_PATH: fakeHarness,
      RECORDER_LIVE_VSCODE_PATH: fakeHarness,
      RECORDER_LIVE_LISTEN: `127.0.0.1:${recorderPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const { code, stdout, stderr } = await collectChild(child);

  assert.equal(code, 0, stderr);
  assert.match(stdout, /sdk-cli live acceptance passed/);
  assert.match(stdout, /claude-vscode live acceptance passed/);
  assert.match(stdout, /both Verified entrypoints passed/);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ target }) => target), [
    "/anthropic/v1/messages?beta=true",
    "/anthropic/v1/messages?beta=true",
  ]);

  const invocations = (await readFile(harnessLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(invocations.length, 2);
  assert.deepEqual(
    invocations.map(({ anthropicBaseUrl }) => anthropicBaseUrl),
    [`http://127.0.0.1:${recorderPort}/`, `http://127.0.0.1:${recorderPort}/`],
  );
  assert.deepEqual(invocations.map(({ entrypoint }) => entrypoint), ["sdk-cli", "claude-vscode"]);
  assert.equal(invocations[0].mcpConnectionNonblocking, undefined);
  assert.equal(invocations[0].tasksEnabled, undefined);
  assert.equal(invocations[1].mcpConnectionNonblocking, "true");
  assert.equal(invocations[1].tasksEnabled, "0");
  assert.notEqual(invocations[0].sessionId, invocations[1].sessionId);
  for (const invocation of invocations) {
    assert.match(invocation.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual(invocation.arguments.slice(0, 2), ["-p", "Reply with exactly OK."]);
    assert.deepEqual(invocation.arguments.slice(2), ["--session-id", invocation.sessionId]);
  }

  const acceptanceRuns = await readdir(path.join(temporaryRoot, "artifacts"));
  assert.equal(acceptanceRuns.length, 1);
  const runRoot = path.join(temporaryRoot, "artifacts", acceptanceRuns[0]);
  assert.deepEqual((await readdir(runRoot)).sort(), ["claude-vscode", "sdk-cli"]);
  for (const invocation of invocations) {
    const sessionRoot = path.join(runRoot, invocation.entrypoint, `session-${invocation.sessionId}`);
    const index = JSON.parse(await readFile(path.join(sessionRoot, "index.json"), "utf8"));
    assert.equal(index.artifact_version, 1);
    assert.equal(index.session_id, invocation.sessionId);
    assert.deepEqual(index.exchanges, ["exchange-000001"]);
    assert.deepEqual((await readdir(path.join(sessionRoot, "exchange-000001"))).sort(), [
      "request.body",
      "request.json",
      "response.body",
      "response.json",
      "upstream-request.json",
    ]);
  }
});

function withoutLiveConfiguration(environment) {
  const result = { ...environment };
  for (const name of Object.keys(result)) {
    if (name.startsWith("RECORDER_LIVE_") || name === "CLAUDE_CODE_ENTRYPOINT"
      || name === "MCP_CONNECTION_NONBLOCKING" || name === "CLAUDE_CODE_ENABLE_TASKS") {
      delete result[name];
    }
  }
  return result;
}

async function collectChild(child) {
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "exit");
  return { code, stdout, stderr };
}
