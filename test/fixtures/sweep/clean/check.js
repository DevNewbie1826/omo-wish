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

const sent = run(["send", "--text", "hello"]);
if (sent.status !== 0 || !sent.stdout.includes("sent:hello")) fail("send did not report the text");

const refused = run(["send", "--text", "hello", "--fail"]);
if (refused.status !== 1) fail("--fail did not exit 1");

const leak = run(["send", "--fail"], { TEST_API_TOKEN: "CHECKCANARY" });
if (`${leak.stdout}${leak.stderr}`.includes("CHECKCANARY")) fail("the credential leaked into the failure message");

const invalid = spawnSync(process.execPath, ["./cli.js", "stdin"], { cwd: dir, input: Buffer.from([0xff, 0x62]), encoding: "utf8" });
if (invalid.status !== 1) fail("invalid utf-8 was not rejected");

process.stdout.write("OK\n");
