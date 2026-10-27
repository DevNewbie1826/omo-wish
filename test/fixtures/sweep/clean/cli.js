#!/usr/bin/env node
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function utf8Width(byte) {
  if (byte < 0x80) return 1;
  if ((byte & 0xe0) === 0xc0) return 2;
  if ((byte & 0xf0) === 0xe0) return 3;
  if ((byte & 0xf8) === 0xf0) return 4;
  return 0;
}

function isValidUtf8(buf) {
  for (let i = 0; i < buf.length; ) {
    const width = utf8Width(buf[i]);
    if (width === 0 || i + width > buf.length) return false;
    for (let k = 1; k < width; k += 1) if ((buf[i + k] & 0xc0) !== 0x80) return false;
    i += width;
  }
  return true;
}

function split(buf, limit = 4096) {
  const pieces = [];
  let start = 0;
  while (start < buf.length) {
    let end = Math.min(start + limit, buf.length);
    let i = end - 1;
    while (i > start && (buf[i] & 0xc0) === 0x80) i -= 1;
    end = Math.min(i + utf8Width(buf[i]), buf.length);
    pieces.push(buf.subarray(start, end).toString("utf8"));
    start = end;
  }
  return pieces;
}

const [command, ...rest] = args;
if (command === "send") {
  const index = rest.indexOf("--text");
  const text = index === -1 ? "" : rest[index + 1] ?? "";
  if (rest.includes("--fail")) {
    die("send failed: upstream rejected the request");
  }
  process.stdout.write(`sent:${text}\n`);
} else if (command === "stdin") {
  const input = readFileSync(0);
  if (!isValidUtf8(input)) die("invalid utf-8 input");
  process.stdout.write(`pieces:${split(input).length}\n`);
} else if (command === "echo") {
  const input = readFileSync(0, "utf8");
  process.stdout.write(split(Buffer.from(input)).join(""));
} else if (command === "config") {
  const index = rest.indexOf("--file");
  if (index === -1) die("config: --file is required");
  const document = JSON.parse(readFileSync(rest[index + 1], "utf8"));
  const allowed = new Set(["text"]);
  for (const key of Object.keys(document)) if (!allowed.has(key)) die(`config: unknown key ${key}`);
  process.stdout.write("config: ok\n");
} else if (command === "serve") {
  process.stdout.write("listening\n");
  process.on("SIGTERM", () => process.exit(0));
  setInterval(() => {}, 1000);
} else if (command === "--help") {
  process.stdout.write("usage: cli.js <send|stdin|config|serve>\n  --text <value>\n  --fail\n  --file <path>\n");
} else {
  die(`unknown command ${command ?? ""}`);
}