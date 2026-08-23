import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { parseLaunchArguments } from "../src/cli.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("the launch contract applies the default listen socket and accepts an explicit override", () => {
  const defaults = parseLaunchArguments([
    "--upstream-base-url", "https://model.example/anthropic",
    "--output-root", "recordings",
  ]);
  assert.equal(defaults.upstreamBaseUrl.href, "https://model.example/anthropic");
  assert.equal(defaults.outputRoot, path.join(projectRoot, "recordings"));
  assert.deepEqual(defaults.listen, { host: "127.0.0.1", port: 4318 });

  const overridden = parseLaunchArguments([
    "--listen", "localhost:9431",
    "--output-root", "/tmp/recordings",
    "--upstream-base-url", "http://model.example/gateway/",
  ]);
  assert.equal(overridden.upstreamBaseUrl.href, "http://model.example/gateway/");
  assert.equal(overridden.outputRoot, "/tmp/recordings");
  assert.deepEqual(overridden.listen, { host: "localhost", port: 9431 });
});

test("the launch contract rejects missing, invalid, and unsupported input", () => {
  const validRequired = [
    "--upstream-base-url", "https://model.example/anthropic",
    "--output-root", "/tmp/recordings",
  ];

  assert.throws(() => parseLaunchArguments([]), /--upstream-base-url/);
  assert.throws(
    () => parseLaunchArguments(["--upstream-base-url", "https://model.example"]),
    /--output-root/,
  );
  assert.throws(
    () => parseLaunchArguments(["--upstream-base-url", "model.example", "--output-root", "/tmp"]),
    /absolute HTTP\(S\) URL/,
  );
  assert.throws(
    () => parseLaunchArguments(["--upstream-base-url", "ftp://model.example", "--output-root", "/tmp"]),
    /absolute HTTP\(S\) URL/,
  );
  assert.throws(
    () => parseLaunchArguments(["--upstream-base-url", "https://model.example/v1/messages", "--output-root", "/tmp"]),
    /gateway base URL/,
  );
  assert.throws(() => parseLaunchArguments([...validRequired, "--config", "recorder.json"]), /Unsupported option/);
  assert.throws(() => parseLaunchArguments([...validRequired, "--listen", "127.0.0.1"]), /host:port/);
  assert.throws(() => parseLaunchArguments([...validRequired, "--listen", "127.0.0.1:0"]), /between 1 and 65535/);
  assert.throws(
    () => parseLaunchArguments([...validRequired, "--output-root", "/tmp/other"]),
    /only be supplied once/,
  );
});

test("the executable reports invalid launch input and exits unsuccessfully", () => {
  const result = spawnSync(process.execPath, ["src/index.mjs", "--output-root", "/tmp/recordings"], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Recorder launch failed: Required option missing: --upstream-base-url/m);
});

test("the package declares the zero-dependency Node.js ESM runtime", async () => {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));

  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.engines.node, ">=22");
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
  assert.equal(packageJson.bin.recorder, "./src/index.mjs");
  assert.equal(packageJson.scripts.test, "node --test");
});
