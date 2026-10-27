// Class T — a test that passes when the code is wrong.
//
// Measured: 8 guard-removal rows, 1 blocking, and the vacuous-guard tail behind
// the #63 REVISE chain. The probe deletes one added production line in a
// throwaway copy and requires the declared suite to fail.

import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { addedLines, mapPool, productionLines, row, runCommand, isMain, probeCli } from "./lib.mjs";

export const name = "mutation";
export const types = ["code"];
export const summary = "every probed line is killed when removed";

export const usage = `config:
  "probes": { "mutation": {
    "testCmd": "go test ./internal/...", "failMarker": "--- FAIL:", "max": 12,
    "base": "origin/main", "paths": ["internal/**"],
    "candidates": [{ "file": "src/a.js", "line": 12 }]
  } }

The suite must be green first. Each candidate line is then deleted in its own
copy of the tree and the suite is re-run:
  PASS    the suite failed with a test-failure marker (the mutation was killed)
  FAIL    the suite stayed green (SURVIVED: nothing tests this line)
  INVALID the mutation did not compile, or the run failed without a failure
          marker; INVALID is never a kill.
"candidates" replaces the diff-derived list (fixtures, or a diff already merged).
Only added production source lines are candidates: prose and test files are never
mutated, because a doc line would demand a test that pins prose and a test line
would demand a test of its own fixtures. "testGlobs" and "codeExtensions"
override that filter. At most "max" lines are probed; the rest are reported as
one WARN row so an unprobed line can never read as covered.`;

const SKIP_DIRS = new Set([".git", "node_modules", ".omo", "dist", "build", ".next", "target"]);

export async function run(config, ctx) {
  const cls = ctx.classFor("T");
  if (!config.testCmd) {
    return [row({ id: "mutation", verdict: "SKIP", observable: "a test command is declared", cls, note: "no test command declared" })];
  }
  const baseline = await runCommand({ cmd: config.testCmd, cwd: ctx.root, timeoutMs: config.timeoutMs ?? ctx.timeoutMs });
  const checks = [row({
    id: "mutation/baseline",
    command: config.testCmd,
    observable: "the declared suite is green before any line is removed",
    verdict: baseline.code === 0 ? "PASS" : "FAIL",
    cls,
    note: baseline.code === 0 ? `suite green in ${baseline.ms} ms` : `suite is not green before mutating (exit ${baseline.code})`,
  })];
  if (baseline.code !== 0) return checks;

  const raw = config.candidates?.length
    ? config.candidates
    : addedLines({ root: ctx.root, base: config.base, paths: config.paths });
  const production = productionLines(raw, { testGlobs: config.testGlobs, codeExtensions: config.codeExtensions });
  const candidates = production.slice(0, config.max ?? 12);
  if (candidates.length === 0) {
    return [...checks, row({ id: "mutation", verdict: "SKIP", observable: "one added production line is a candidate", cls, note: "no candidate production lines in the diff" })];
  }
  if (production.length > candidates.length) {
    checks.push(row({
      id: "mutation/limit",
      command: config.testCmd,
      observable: "every added production line is probed or reported",
      verdict: "WARN",
      cls,
      note: `${candidates.length} of ${production.length} added production lines probed; the rest are unprobed and belong to the checklist pass`,
    }));
  }

  const failMarker = new RegExp(config.failMarker ?? "--- FAIL:|^FAIL\\b|✗|\\(fail\\)|AssertionError|not ok \\d+", "m");
  const compileError = new RegExp(config.compileErrorPattern ?? "build failed|setup failed|syntax error|Cannot find module|error TS\\d+|undefined reference", "m");
  const results = await mapPool(candidates, Math.min(8, ctx.parallel), async (candidate) => {
    const id = `mutation/${candidate.file}:${candidate.line}`;
    const observable = "removing this line makes the declared suite fail";
    const scratch = mkdtempSync(join(tmpdir(), "wish-sweep-mutant-"));
    const tree = join(scratch, "tree");
    try {
      cpSync(ctx.root, tree, {
        recursive: true,
        filter: (src) => {
          if (src === ctx.root) return true;
          const first = src.slice(ctx.root.length + 1).split(sep)[0];
          return !SKIP_DIRS.has(first);
        },
      });
      const target = resolve(tree, candidate.file);
      if (!target.startsWith(`${tree}${sep}`)) {
        return row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "candidate path escapes the throwaway copy; nothing was written" });
      }
      if (!existsSync(target)) return row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "file not found in the copy" });
      const lines = readFileSync(target, "utf8").split("\n");
      const index = candidate.line - 1;
      if (lines[index] === undefined) return row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "line no longer exists" });
      lines[index] = "";
      writeFileSync(target, lines.join("\n"));
      const result = await runCommand({ cmd: config.testCmd, cwd: tree, timeoutMs: config.timeoutMs ?? ctx.timeoutMs });
      const output = `${result.stdout}\n${result.stderr}`;
      if (compileError.test(output)) {
        return row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "mutation did not compile; not counted as killed" });
      }
      if (result.code === 0) return row({ id, command: config.testCmd, observable, verdict: "FAIL", cls, note: "SURVIVED: the suite stayed green with this line removed" });
      if (failMarker.test(output)) return row({ id, command: config.testCmd, observable, verdict: "PASS", cls, note: `killed (exit ${result.code})` });
      return row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: `failed without a test-failure marker (exit ${result.code})` });
    } finally {
      ctx.cleanup(scratch);
    }
  });
  return [...checks, ...results];
}

if (isMain(import.meta.url)) await probeCli({ name, types, summary, usage, run });