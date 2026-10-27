#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const dir = import.meta.dir;

function fail(message) {
  process.stdout.write("CHECK FAILED: " + message + "\n");
  process.exit(1);
}

function run(args, env = {}) {
  return spawnSync(process.execPath, ["./cli.js", ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
}

process.stdout.write("WARNING: DATA RACE\n");
process.stdout.write("Write at 0x00c0000a4018 by goroutine 7:\n");

const sent = run(["send", "--text", "hello"]);
if (sent.status !== 0 || !sent.stdout.includes("sent:hello")) fail("send did not report the text");

process.stdout.write("OK\n");
