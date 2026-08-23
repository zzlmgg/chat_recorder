#!/usr/bin/env node

import { appendFile } from "node:fs/promises";
import http from "node:http";

const arguments_ = process.argv.slice(2);
const promptIndex = arguments_.indexOf("-p");
const sessionIndex = arguments_.indexOf("--session-id");
if (promptIndex === -1 || sessionIndex === -1) {
  throw new Error("the live driver must invoke the Harness non-interactively with a fresh session ID");
}

const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT;
const sessionId = arguments_[sessionIndex + 1];
const baseUrl = new URL(process.env.ANTHROPIC_BASE_URL);
const body = Buffer.from(JSON.stringify({
  model: "deepseek-v4-flash",
  messages: [{ role: "user", content: arguments_[promptIndex + 1] }],
  stream: true,
}));

await appendFile(process.env.FAKE_HARNESS_LOG, `${JSON.stringify({
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,
  arguments: arguments_,
  entrypoint,
  mcpConnectionNonblocking: process.env.MCP_CONNECTION_NONBLOCKING,
  tasksEnabled: process.env.CLAUDE_CODE_ENABLE_TASKS,
  sessionId,
})}\n`);

const response = await new Promise((resolve, reject) => {
  const request = http.request({
    protocol: baseUrl.protocol,
    hostname: baseUrl.hostname,
    port: baseUrl.port,
    method: "POST",
    path: "/v1/messages?beta=true",
    headers: [
      ["Host", baseUrl.host],
      ["X-Claude-Code-Session-Id", sessionId],
      ["User-Agent", `claude-cli/2.1.238 (external, ${entrypoint})`],
      ["Authorization", "Bearer synthetic-live-token"],
      ["Content-Type", "application/json"],
      ["Content-Length", String(body.length)],
      ["Connection", "close"],
    ],
  }, resolve);
  request.once("error", reject);
  request.end(body);
});

if (response.statusCode !== 200) {
  throw new Error(`unexpected Model status relayed by Recorder: ${response.statusCode}`);
}
if (!String(response.headers["content-type"]).startsWith("text/event-stream")) {
  throw new Error("the live response was not an SSE stream");
}
for await (const _chunk of response) {
  // Reading the complete response models normal Harness completion.
}

process.stdout.write("OK\n");
