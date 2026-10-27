// Class CFG — a config schema that accepts what it must reject, or rejects
// what it must accept.
//
// Measured: 1 row, blocking. Each declared case writes a document to a scratch
// file and runs the program against it.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { q, row, runCommand, isMain, probeCli } from "./lib.mjs";

export const name = "config";
export const types = ["code"];
export const summary = "declared accept cases exit 0 and reject cases do not";

export const usage = `config:
  "probes": { "config": { "cases": [
    { "name": "known-key", "cmd": "bin config --file {tmp}", "file": { "text": "hi" }, "expect": "accept" },
    { "name": "unknown-key", "cmd": "bin config --file {tmp}",
      "file": { "text": "hi", "typo": 1 }, "expect": "reject" }
  ] } }

"file" is written to a scratch file; "{tmp}" in "cmd" is replaced by its quoted
path. "expect" is "accept" (the run must exit 0) or "reject" (it must not).
FAIL means the program did the opposite. The scratch directory is removed and
its removal is recorded in the receipt's cleanup.`;

// A case name only labels the output and names the scratch file, and it may carry
// path or shell characters. It is reduced to a safe stem, so a case name can never
// steer a write outside the scratch directory.
function stem(name) {
  return String(name).replace(/[^A-Za-z0-9._-]/g, "_").split("..").join("_").slice(0, 60) || "case";
}

export async function run(config, ctx) {
  const cls = ctx.classFor("CFG");
  const cases = config.cases ?? [];
  if (cases.length === 0) {
    return [row({ id: "config", verdict: "SKIP", observable: "a config case is declared", cls, note: "no config cases declared" })];
  }
  const scratch = mkdtempSync(join(tmpdir(), "wish-sweep-config-"));
  const checks = [];
  try {
    for (const testCase of cases) {
      let cmd = testCase.cmd;
      if (testCase.file !== undefined) {
        const file = join(scratch, `${stem(testCase.name)}.json`);
        writeFileSync(file, typeof testCase.file === "string" ? testCase.file : JSON.stringify(testCase.file, null, 2));
        cmd = cmd.split("{tmp}").join(q(file));
      }
      const result = await runCommand({ cmd, cwd: ctx.root, timeoutMs: testCase.timeoutMs ?? ctx.timeoutMs });
      const accepted = result.code === 0;
      const expected = testCase.expect ?? "accept";
      const ok = expected === "accept" ? accepted : !accepted;
      checks.push(row({
        id: `config/${testCase.name}`,
        command: cmd,
        observable: `the program ${expected}s this document`,
        verdict: ok ? "PASS" : "FAIL",
        cls,
        note: `expected ${expected}, got ${accepted ? "accept" : `reject (exit ${result.code})`}`,
      }));
    }
  } finally {
    ctx.cleanup(scratch);
  }
  return checks;
}

if (isMain(import.meta.url)) await probeCli({ name, types, summary, usage, run });