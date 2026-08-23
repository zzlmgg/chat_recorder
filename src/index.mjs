#!/usr/bin/env node

import { parseLaunchArguments } from "./cli.mjs";
import { startRecorder } from "./server.mjs";

try {
  const configuration = parseLaunchArguments(process.argv.slice(2));
  const recorder = await startRecorder(configuration);
  process.stdout.write(`Recorder listening on ${recorder.address}\n`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await recorder.stop();
      process.exitCode = 0;
    } catch (error) {
      process.stderr.write(`Recorder failed to stop: ${error.message}\n`);
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} catch (error) {
  process.stderr.write(`Recorder launch failed: ${error.message}\n`);
  process.exitCode = 1;
}
