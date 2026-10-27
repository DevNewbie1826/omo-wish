// Class S — a data race the changed packages report.
//
// Measured: 10 cancellation and handler-lifetime rows, 7 blocking. The probe
// runs the project's own race detector once; it does not build one.

import { crashIn, row, runCommand, isMain, probeCli } from "./lib.mjs";

export const name = "race";
export const types = ["code"];
export const summary = "the project's race detector reports nothing";

export const usage = `config:
  "probes": { "race": { "cmd": "go test -race ./internal/...", "pattern": "DATA RACE" } }

One command, run once. FAIL means the output carries the race marker, a crash
marker, a timeout, or a non-zero exit. "pattern" defaults to "DATA RACE".`;

export async function run(config, ctx) {
  const cls = ctx.classFor("S");
  if (!config.cmd) {
    return [row({ id: "race", verdict: "SKIP", observable: "a race command is declared", cls, note: "no race command declared" })];
  }
  const result = await runCommand({ cmd: config.cmd, cwd: ctx.root, timeoutMs: config.timeoutMs ?? ctx.timeoutMs });
  const marker = config.pattern ?? "DATA RACE";
  const output = `${result.stdout}\n${result.stderr}`;
  const found = output.includes(marker);
  const crash = crashIn(output);
  const ok = !result.timedOut && !found && !crash && result.code === 0;
  return [row({
    id: "race",
    command: config.cmd,
    observable: `exit 0 and no "${marker}" or crash marker in the output`,
    verdict: ok ? "PASS" : "FAIL",
    cls,
    note: result.timedOut
      ? `timed out after ${result.ms} ms`
      : found
        ? `race marker "${marker}" reported`
        : crash
          ? `crash marker ${crash.join(", ")}`
          : `exit ${result.code} in ${result.ms} ms with no race diagnostic`,
  })];
}

if (isMain(import.meta.url)) await probeCli({ name, types, summary, usage, run });