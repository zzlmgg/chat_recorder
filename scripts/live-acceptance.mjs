#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseLaunchArguments } from "../src/cli.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const requiredEnvironment = [
  "RECORDER_LIVE_UPSTREAM_BASE_URL",
  "RECORDER_LIVE_OUTPUT_ROOT",
  "RECORDER_LIVE_CLI_PATH",
  "RECORDER_LIVE_VSCODE_PATH",
];
const requiredExchangeFiles = [
  "request.body",
  "request.json",
  "response.body",
  "response.json",
  "upstream-request.json",
];
const defaultPrompt = "Reply with exactly OK.";

export async function readLiveConfiguration(environment = process.env) {
  if (environment.RECORDER_LIVE_ACCEPTANCE !== "1") {
    throw new Error(
      "Live acceptance is disabled. Set RECORDER_LIVE_ACCEPTANCE=1 to opt in explicitly.",
    );
  }

  const missing = requiredEnvironment.filter((name) => !environment[name]);
  if (missing.length > 0) {
    throw new Error(`Missing live acceptance host configuration:\n${missing.map((name) => `- ${name}`).join("\n")}`);
  }
  if (process.platform !== "linux") {
    throw new Error(`Live acceptance requires Linux; this host reports ${process.platform}.`);
  }

  const listen = environment.RECORDER_LIVE_LISTEN ?? "127.0.0.1:4318";
  const launch = parseLaunchArguments([
    "--upstream-base-url", environment.RECORDER_LIVE_UPSTREAM_BASE_URL,
    "--output-root", environment.RECORDER_LIVE_OUTPUT_ROOT,
    "--listen", listen,
  ]);
  for (const name of ["RECORDER_LIVE_CLI_PATH", "RECORDER_LIVE_VSCODE_PATH"]) {
    const executable = environment[name];
    if (!path.isAbsolute(executable)) {
      throw new Error(`${name} must be an absolute path to the installed executable.`);
    }
    try {
      await access(executable, constants.X_OK);
    } catch {
      throw new Error(`${name} is not an executable file: ${executable}`);
    }
  }

  return {
    cliPath: environment.RECORDER_LIVE_CLI_PATH,
    environment: { ...environment },
    listen,
    listenBaseUrl: `http://${listen}`,
    outputRoot: launch.outputRoot,
    prompt: environment.RECORDER_LIVE_PROMPT ?? defaultPrompt,
    upstreamBaseUrl: launch.upstreamBaseUrl.href,
    vscodePath: environment.RECORDER_LIVE_VSCODE_PATH,
  };
}

export async function runLiveAcceptance(configuration, output = process.stdout) {
  await mkdir(configuration.outputRoot, { recursive: true });
  const runRoot = await mkdtemp(path.join(configuration.outputRoot, "live-acceptance-"));
  const scenarios = [
    {
      entrypoint: "sdk-cli",
      executable: configuration.cliPath,
      launcherEnvironment: { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" },
    },
    {
      entrypoint: "claude-vscode",
      executable: configuration.vscodePath,
      launcherEnvironment: {
        CLAUDE_CODE_ENTRYPOINT: "claude-vscode",
        MCP_CONNECTION_NONBLOCKING: "true",
        CLAUDE_CODE_ENABLE_TASKS: "0",
      },
    },
  ];

  output.write(`Live artifacts will be retained at ${runRoot}\n`);
  for (const scenario of scenarios) {
    const result = await runScenario({ configuration, output, runRoot, scenario });
    output.write(
      `${scenario.entrypoint} live acceptance passed; recorded User-Agent provenance: ${result.userAgents.join(", ")}\n`,
    );
  }
  output.write("Live acceptance for both Verified entrypoints passed.\n");
  output.write("The retained artifacts are fixture candidates, not independent byte truth.\n");

  return runRoot;
}

async function runScenario({ configuration, output, runRoot, scenario }) {
  const scenarioRoot = path.join(runRoot, scenario.entrypoint);
  await mkdir(scenarioRoot);
  const sessionId = randomUUID();
  output.write(`Starting fresh ${scenario.entrypoint} Recorder and Harness Session ${sessionId}.\n`);

  const recorder = await startRecorderProcess(configuration, scenarioRoot);
  let harnessFailure;
  try {
    await runHarness({ configuration, output, scenario, sessionId });
  } catch (error) {
    harnessFailure = error;
  }

  try {
    await stopRecorderProcess(recorder);
  } catch (error) {
    if (harnessFailure) {
      throw new Error(`${harnessFailure.message}; Recorder drain also failed: ${error.message}`);
    }
    throw error;
  }
  if (harnessFailure) throw harnessFailure;

  return validateSessionArtifact(scenarioRoot, sessionId);
}

async function startRecorderProcess(configuration, outputRoot) {
  const child = spawn(process.execPath, [
    path.join(projectRoot, "src", "index.mjs"),
    "--upstream-base-url", configuration.upstreamBaseUrl,
    "--output-root", outputRoot,
    "--listen", configuration.listen,
  ], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tracked = trackChild(child);
  await waitForRecorder(tracked, `Recorder listening on ${configuration.listenBaseUrl}`);
  return tracked;
}

async function runHarness({ configuration, output, scenario, sessionId }) {
  const environment = harnessEnvironment(configuration.environment, scenario.launcherEnvironment);
  const child = spawn(scenario.executable, [
    "-p", configuration.prompt,
    "--session-id", sessionId,
  ], {
    cwd: process.cwd(),
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tracked = trackChild(child, output);
  const result = await withTimeout(
    tracked.completion,
    10 * 60_000,
    `${scenario.entrypoint} did not complete within ten minutes`,
    () => child.kill("SIGTERM"),
  );
  if (result.code !== 0) {
    throw new Error(
      `${scenario.entrypoint} exited ${result.code ?? result.signal}: ${tracked.stderr.trim()}`,
    );
  }
  if (tracked.stdoutBytes === 0) {
    throw new Error(`${scenario.entrypoint} exited normally without a completed response on stdout.`);
  }
}

function harnessEnvironment(base, additions) {
  const environment = { ...base };
  delete environment.CLAUDE_CODE_ENTRYPOINT;
  delete environment.MCP_CONNECTION_NONBLOCKING;
  delete environment.CLAUDE_CODE_ENABLE_TASKS;
  return Object.assign(environment, additions);
}

function trackChild(child, output) {
  let stderr = "";
  let stdout = "";
  let stdoutBytes = 0;
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    stdoutBytes += chunk.length;
    output?.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    output?.write(chunk);
  });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return {
    child,
    completion,
    get stderr() { return stderr; },
    get stdout() { return stdout; },
    get stdoutBytes() { return stdoutBytes; },
  };
}

async function waitForRecorder(tracked, expected) {
  if (tracked.stdout.includes(expected)) return;

  await withTimeout(new Promise((resolve, reject) => {
    const onData = () => {
      if (!tracked.stdout.includes(expected)) return;
      cleanup();
      resolve();
    };
    const onComplete = ({ code, signal }) => {
      cleanup();
      reject(new Error(
        `Recorder exited before listening (${code ?? signal}): ${tracked.stderr.trim()}`,
      ));
    };
    const cleanup = () => {
      tracked.child.stdout.off("data", onData);
    };
    tracked.child.stdout.on("data", onData);
    tracked.completion.then(onComplete, reject);
  }), 10_000, "Recorder did not begin listening within ten seconds", () => {
    tracked.child.kill("SIGTERM");
  });
}

async function stopRecorderProcess(tracked) {
  if (tracked.child.exitCode === null && tracked.child.signalCode === null) {
    tracked.child.kill("SIGINT");
  }
  const result = await withTimeout(
    tracked.completion,
    30_000,
    "Recorder did not finish draining within thirty seconds",
    () => tracked.child.kill("SIGTERM"),
  );
  if (result.code !== 0) {
    throw new Error(`Recorder exited ${result.code ?? result.signal}: ${tracked.stderr.trim()}`);
  }
}

async function validateSessionArtifact(outputRoot, sessionId) {
  const sessionDirectory = `session-${sessionId}`;
  const outputEntries = await readdir(outputRoot);
  requireCondition(
    outputEntries.length === 1 && outputEntries[0] === sessionDirectory,
    `expected exactly ${sessionDirectory}, found ${outputEntries.join(", ") || "nothing"}`,
  );

  const sessionRoot = path.join(outputRoot, sessionDirectory);
  const index = await readJson(path.join(sessionRoot, "index.json"));
  requireCondition(index.artifact_version === 1, "index.json does not use artifact_version 1");
  requireCondition(index.session_id === sessionId, "index.json does not retain the fresh Harness Session ID");
  requireCondition(Array.isArray(index.exchanges) && index.exchanges.length > 0, "index.json contains no Model Exchanges");
  const sessionEntries = (await readdir(sessionRoot)).sort();
  const indexedEntries = ["index.json", ...index.exchanges].sort();
  requireCondition(
    JSON.stringify(sessionEntries) === JSON.stringify(indexedEntries),
    "session contents do not match the exchanges listed in index.json",
  );

  const userAgents = new Set();
  for (let indexPosition = 0; indexPosition < index.exchanges.length; indexPosition += 1) {
    const exchangeName = index.exchanges[indexPosition];
    const expectedName = `exchange-${String(indexPosition + 1).padStart(6, "0")}`;
    requireCondition(exchangeName === expectedName, `index.json exchange order is not complete at ${expectedName}`);
    const exchangeRoot = path.join(sessionRoot, exchangeName);
    const exchangeFiles = (await readdir(exchangeRoot)).sort();
    requireCondition(
      JSON.stringify(exchangeFiles) === JSON.stringify(requiredExchangeFiles),
      `${exchangeName} does not contain the complete five-file artifact`,
    );

    const [request, upstreamRequest, response, requestBody, responseBody] = await Promise.all([
      readJson(path.join(exchangeRoot, "request.json")),
      readJson(path.join(exchangeRoot, "upstream-request.json")),
      readJson(path.join(exchangeRoot, "response.json")),
      stat(path.join(exchangeRoot, "request.body")),
      stat(path.join(exchangeRoot, "response.body")),
    ]);
    validateRequestMetadata(request, `${exchangeName}/request.json`);
    validateRequestMetadata(upstreamRequest, `${exchangeName}/upstream-request.json`);
    validateResponseMetadata(response, `${exchangeName}/response.json`);
    requireCondition(requestBody.isFile() && requestBody.size > 0, `${exchangeName}/request.body is not a non-empty file`);
    requireCondition(responseBody.isFile() && responseBody.size > 0, `${exchangeName}/response.body is not a non-empty file`);
    requireCondition(
      Number.isInteger(response.status) && response.status >= 200 && response.status < 300,
      `${exchangeName} did not record a successful Model response`,
    );
    const contentType = fieldValues(response.headers, "content-type");
    requireCondition(
      contentType.length === 1 && contentType[0].toLowerCase().startsWith("text/event-stream"),
      `${exchangeName} did not record a streamed SSE response`,
    );
    for (const userAgent of fieldValues(request.headers, "user-agent")) userAgents.add(userAgent);
  }

  return { userAgents: [...userAgents] };
}

function validateRequestMetadata(metadata, label) {
  validateMetadata(metadata, "request.body", label);
  requireCondition(metadata.http_version === "1.1", `${label} does not record HTTP/1.1`);
  requireCondition(typeof metadata.method === "string" && metadata.method.length > 0, `${label} has no method`);
  requireCondition(typeof metadata.target === "string" && metadata.target.length > 0, `${label} has no target`);
}

function validateResponseMetadata(metadata, label) {
  validateMetadata(metadata, "response.body", label);
  requireCondition(metadata.http_version === "1.1", `${label} does not record HTTP/1.1`);
  requireCondition(typeof metadata.reason === "string", `${label} has no reason phrase`);
}

function validateMetadata(metadata, entityFile, label) {
  requireCondition(metadata && typeof metadata === "object", `${label} is not an object`);
  requireCondition(metadata.entity_file === entityFile, `${label} has the wrong entity_file`);
  requireCondition(isFieldPairList(metadata.headers), `${label} has invalid ordered headers`);
  requireCondition(isFieldPairList(metadata.trailers), `${label} has invalid ordered trailers`);
}

function isFieldPairList(value) {
  return Array.isArray(value)
    && value.every((pair) => Array.isArray(pair) && pair.length === 2
      && pair.every((part) => typeof part === "string"));
}

function fieldValues(pairs, name) {
  return pairs
    .filter(([fieldName]) => fieldName.toLowerCase() === name)
    .map(([, value]) => value);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read complete artifact metadata ${file}: ${error.message}`);
  }
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Live artifact validation failed: ${message}`);
}

async function withTimeout(promise, duration, message, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, duration);
    timer.unref();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  try {
    const configuration = await readLiveConfiguration();
    await runLiveAcceptance(configuration);
  } catch (error) {
    process.stderr.write(`Live acceptance failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
