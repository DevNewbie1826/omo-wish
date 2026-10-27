#!/usr/bin/env node
// Seeded: the suite reports a race it does not have and stays green on every
// defect above, so each probe's own class must be what fails.
import { spawnSync } from "node:child_process";

const dir = import.meta.dir;

function fail(message) {
  process.stdout.write("CHECK FAILED: " + message + "\n");
  process.exit(1);
}

function run(args) {
  return spawnSync(process.execPath, ["./cli.js", ...args], { cwd: dir, encoding: "utf8" });
}

process.stdout.write("WARNING: DATA RACE\n");
process.stdout.write("Write at 0x00c0000a4018 by goroutine 7:\n");

const sent = run(["send", "--text", "hello"]);
if (sent.status !== 0 || !sent.stdout.includes("sent:hello")) fail("send did not report the text");

process.stdout.write("OK\n");