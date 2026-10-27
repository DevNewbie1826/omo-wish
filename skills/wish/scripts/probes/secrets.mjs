// Class SEC — a credential or token must never reach output that is stored.
//
// Measured in the eleven independent review rounds behind PR #47: 8 rows, 7 of
// them blocking. The probe puts a canary in the environment of every declared
// error path and then reads the command's stdout, its stderr, and every log the
// run wrote.

import { readFileSync, statSync } from "node:fs";
import { matchFiles, runCommand, row, isMain, probeCli } from "./lib.mjs";

export const name = "secrets";
export const types = ["code"];
export const summary = "a canary credential never reaches stdio or a log";

export const usage = `config:
  "probes": { "secrets": {
    "canary": "<fresh random token>",
    "env": { "TEST_API_TOKEN": "<the same token>" },
    "commands": [{ "name": "send-refusal", "cmd": "bin send --fail" }],
    "logs": ["*.log", "logs/*.log"]
  } }

A command is run once with the canary in its environment. FAIL means the canary
is in the command's stdout or stderr, or in a log file the run touched. Only
files under --root that match "logs" and were written during this run are read.`;

export async function run(config, ctx) {
  const cls = ctx.classFor("SEC");
  const canary = config.canary;
  if (!canary) {
    return [row({
      id: "secrets", verdict: "SKIP", observable: "a canary credential is configured", cls,
      note: "no canary: this class belongs to the checklist pass",
    })];
  }
  const checks = [];
  const startedAt = Date.now();
  for (const command of config.commands ?? []) {
    const result = await runCommand({
      cmd: command.cmd,
      cwd: ctx.root,
      stdin: command.stdin,
      timeoutMs: command.timeoutMs ?? ctx.timeoutMs,
      env: { ...(config.env ?? {}), ...(command.env ?? {}) },
    });
    const leaked = `${result.stdout}\n${result.stderr}`.includes(canary);
    checks.push(row({
      id: `secrets/${command.name}`,
      command: command.cmd,
      observable: "the canary appears in neither stdout nor stderr",
      verdict: leaked ? "FAIL" : "PASS",
      cls,
      note: leaked ? `canary reached the command output (exit ${result.code})` : `no canary in output (exit ${result.code}, ${result.ms} ms)`,
    }));
  }
  for (const file of matchFiles(ctx.root, config.logs ?? [])) {
    if (statSync(file).mtimeMs < startedAt - 1000) continue;
    const body = readFileSync(file, "utf8");
    const leaked = body.includes(canary);
    checks.push(row({
      id: `secrets/log:${file.slice(ctx.root.length + 1)}`,
      command: "no command",
      observable: "the canary appears in no log file this run wrote",
      verdict: leaked ? "FAIL" : "PASS",
      cls,
      note: leaked ? "canary written to a log file: redact before formatting or persisting" : "log is clean",
    }));
  }
  if (checks.length === 0) {
    return [row({ id: "secrets", verdict: "SKIP", observable: "a command or a log glob is declared", cls, note: "no command or log declared" })];
  }
  return checks;
}

if (isMain(import.meta.url)) await probeCli({ name, types, summary, usage, run });