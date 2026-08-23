import path from "node:path";

const optionNames = new Set(["--upstream-base-url", "--output-root", "--listen"]);

export function parseLaunchArguments(arguments_) {
  const values = new Map();

  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const value = arguments_[index + 1];

    if (!optionNames.has(option)) throw new Error(`Unsupported option: ${option}`);
    if (values.has(option)) throw new Error(`Option may only be supplied once: ${option}`);
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
    values.set(option, value);
  }

  const upstreamValue = required(values, "--upstream-base-url");
  const outputValue = required(values, "--output-root");
  const upstreamBaseUrl = parseUpstreamBaseUrl(upstreamValue);
  const listen = parseListenAddress(values.get("--listen") ?? "127.0.0.1:4318");

  return {
    upstreamBaseUrl,
    outputRoot: path.resolve(outputValue),
    listen,
  };
}

function required(values, option) {
  const value = values.get(option);
  if (!value) throw new Error(`Required option missing: ${option}`);
  return value;
}

function parseUpstreamBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--upstream-base-url must be an absolute HTTP(S) URL");
  }

  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    throw new Error("--upstream-base-url must be an absolute HTTP(S) URL");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("--upstream-base-url supports an authority and path prefix only");
  }
  if (/\/v1\/messages\/?$/.test(url.pathname)) {
    throw new Error("--upstream-base-url must name the gateway base URL, not the complete /v1/messages endpoint");
  }
  return url;
}

function parseListenAddress(value) {
  const match = /^([^:]+):(\d+)$/.exec(value);
  if (!match) throw new Error("--listen must use the form host:port");

  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("--listen port must be between 1 and 65535");
  }

  return { host: match[1], port };
}
