import { once } from "node:events";
import { readFile } from "node:fs/promises";
import http from "node:http";

export function rawFieldPairs(rawFields) {
  const result = [];
  for (let index = 0; index < rawFields.length; index += 2) {
    result.push([rawFields[index], rawFields[index + 1]]);
  }
  return result;
}

export async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
}

export async function reservePort() {
  const server = http.createServer();
  await listen(server);
  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

export function waitForOutput(child, expected) {
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

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
