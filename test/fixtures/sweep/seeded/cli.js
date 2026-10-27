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
  return 3;
}

function split(buf, limit = 4096) {
  const pieces = [];
  let start = 0;
  while (start < buf.length) {
    let end = Math.min(start + limit, buf.length);
    let i = end - 1;
    while (i > start && (buf[i] & 0xc0) === 0x80) i -= 1;
    end = i + utf8Width(buf[i]);
    if (end > buf.length) throw new RangeError(`slice bounds out of range [:${end}] with length ${buf.length}`);
    pieces.push(buf.subarray(start, end).toString("utf8"));
    start = end;
  }
  return pieces;
}

const token = process.env.TEST_API_TOKEN ?? "";

const [command, ...rest] = args;
if (command === "send") {
  const index = rest.indexOf("--text");
  const text = index === -1 ? "" : rest[index + 1] ?? "";
  if (rest.includes("--fail")) {
    die(`send failed: upstream rejected the request (token=${token})`);
  }
  process.stdout.write(`sent:${text}\n`);
} else if (command === "stdin") {
  const input = readFileSync(0);
  process.stdout.write(`pieces:${split(input).length}\n`);
} else if (command === "config") {
  const index = rest.indexOf("--file");
  if (index === -1) die("config: --file is required");
  const document = JSON.parse(readFileSync(rest[index + 1], "utf8"));
  process.stdout.write(`config: ok ${Object.keys(document).length}\n`);
} else if (command === "serve") {
  process.stdout.write("listening\n");
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
} else if (command === "--help") {
  process.stdout.write("usage: cli.js <send|stdin|config|serve>\n  --text <value>\n  --fail\n  --file <path>\n");
} else {
  die(`unknown command ${command ?? ""}`);
}