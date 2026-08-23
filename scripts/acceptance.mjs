#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { readLiveConfiguration, runLiveAcceptance } from "./live-acceptance.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

try {
  const configuration = await readLiveConfiguration();
  await runOfflineAcceptance();
  process.stdout.write("Offline replay and test suite passed; starting live acceptance.\n");
  await runLiveAcceptance(configuration);
  process.stdout.write("Overall acceptance passed: offline suite, sdk-cli, and claude-vscode all succeeded.\n");
} catch (error) {
  process.stderr.write(`Overall acceptance failed: ${error.message}\n`);
  process.exitCode = 1;
}

async function runOfflineAcceptance() {
  const child = spawn(process.execPath, ["--test"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
  const { code, signal } = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
  });
  if (code !== 0) {
    throw new Error(`offline replay and test suite exited ${code ?? signal}`);
  }
}
