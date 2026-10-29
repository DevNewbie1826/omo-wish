// Class T — a test that passes when the code is wrong.
//
// Measured: 8 guard-removal rows, 1 blocking, and the vacuous-guard tail behind
// the #63 REVISE chain. The probe deletes one added production line in a
// throwaway copy and requires the declared suite to fail.

import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { addedLines, extensionOf, mapPool, productionLines, row, runCommand, isMain, probeCli } from "./lib.mjs";

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
  INVALID the run failed without a failure marker, or the mutant did not parse in a
          language whose loader this probe can check; INVALID is never a kill.
          In a compiled language a deletion that cannot build is not a candidate at
          all: it is reported once per file as mutation/noncandidate/<file> (SKIP)
          naming every line, so no row asks for a kill no test could ever give.
"candidates" replaces the diff-derived list (fixtures, or a diff already merged).
Only added production source lines are candidates: prose, comment-only lines and
test files are never mutated, because a doc or comment line would demand a test
that pins prose and a test line would demand a test of its own fixtures.
"testGlobs" and "codeExtensions" override that filter. At most 12 production lines
are probed whatever "max" says (a lower "max" is honoured: tier S declares 3); the
rest are reported as one WARN row so an unprobed line can never read as covered.`;

// A language whose build refuses a broken deletion: removing a declaration, a
// brace-owning statement or a used variable is a compile error, not a mutation a
// test can observe. Reported as a non-candidate, never as a row to kill.
const COMPILED_EXTENSIONS = new Set([
  "go", "c", "h", "cc", "cpp", "cxx", "hpp", "hh", "rs", "java", "kt", "kts", "cs", "swift",
  "scala", "ml", "mli", "hs", "zig", "nim", "dart", "ex", "exs", "erl", "sol",
]);

function isCompiled(file) {
  return COMPILED_EXTENSIONS.has(extensionOf(file));
}

const SKIP_DIRS = new Set([".git", "node_modules", ".omo", "dist", "build", ".next", "target"]);

function insideCopy(tree, target) {
  try {
    return realpathSync(target).startsWith(`${realpathSync(tree)}${sep}`);
  } catch {
    return false;
  }
}

// A mutant that does not parse is not a kill: the suite would fail for the syntax,
// not for the behavior. Bun's transpiler answers it in-process; elsewhere the
// output markers decide.
function parses(source, file) {
  if (typeof Bun === "undefined") return true;
  const extension = String(file).slice(String(file).lastIndexOf(".") + 1);
  const loaders = { js: "js", mjs: "js", cjs: "js", jsx: "jsx", ts: "ts", mts: "ts", cts: "ts", tsx: "tsx" };
  const loader = loaders[extension];
  if (!loader) return true;
  try {
    new Bun.Transpiler({ loader }).scan(source);
    return true;
  } catch {
    return false;
  }
}

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
    : await addedLines({ root: ctx.root, base: config.base, paths: config.paths });
  const production = productionLines(raw, { testGlobs: config.testGlobs, codeExtensions: config.codeExtensions, root: ctx.root });
  const cap = Math.max(1, Math.min(Number(config.max) || 12, 12));
  const candidates = production.slice(0, cap);
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
  const compileError = new RegExp(config.compileErrorPattern ?? "BuildMessage|build failed|setup failed|syntax error|SyntaxError|Cannot find module|error TS\\d+|undefined reference|^error: (?:Unexpected|Expected)", "m");
  const results = await mapPool(candidates, Math.min(8, ctx.parallel), async (candidate) => {
    const id = `mutation/${candidate.file}:${candidate.line}`;
    const observable = "removing this line makes the declared suite fail";
    const nonCandidate = (reason) => ({ nonCandidate: { file: candidate.file, line: candidate.line, reason } });
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
        return { row: row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "candidate path escapes the throwaway copy; nothing was written" }) };
      }
      if (!existsSync(target)) return { row: row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "file not found in the copy" }) };
      if (lstatSync(target).isSymbolicLink()) {
        return { row: row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "candidate is a symlink, so writing it would edit its target outside the copy" }) };
      }
      if (!insideCopy(tree, target)) {
        return { row: row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "candidate resolves outside the throwaway copy through a linked directory; nothing was written" }) };
      }
      const lines = readFileSync(target, "utf8").split("\n");
      const index = candidate.line - 1;
      if (lines[index] === undefined) return { row: row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "line no longer exists" }) };
      lines[index] = "";
      const mutated = lines.join("\n");
      if (!parses(mutated, candidate.file)) {
        // Only a language whose loader this probe can check reaches this branch, and
        // none of them is compiled, so a parse failure is always the INVALID row.
        return { row: row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "mutation did not parse, so it is not counted as killed" }) };
      }
      writeFileSync(target, mutated);
      const result = await runCommand({ cmd: config.testCmd, cwd: tree, timeoutMs: config.timeoutMs ?? ctx.timeoutMs });
      const output = `${result.stdout}\n${result.stderr}`;
      if (compileError.test(output)) {
        if (isCompiled(candidate.file)) return nonCandidate("deleting it does not build");
        return { row: row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "mutation did not compile; not counted as killed" }) };
      }
      if (result.code === 0) return { row: row({ id, command: config.testCmd, observable, verdict: "FAIL", cls, note: "SURVIVED: the suite stayed green with this line removed" }) };
      if (failMarker.test(output)) return { row: row({ id, command: config.testCmd, observable, verdict: "PASS", cls, note: `killed (exit ${result.code})` }) };
      return { row: row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: `failed without a test-failure marker (exit ${result.code})` }) };
    } finally {
      ctx.cleanup(scratch);
    }
  });
  const probed = results.filter((entry) => entry.row);
  const skipped = nonCandidateRows(results);
  // A non-candidate makes no claim, so a run where every candidate was one has
  // proved nothing: it must not read as PASS. WARN is the documented "unproven,
  // belongs to the checklist pass" verdict, and it never blocks a stage.
  if (probed.length === 0 && skipped.length > 0) {
    checks.push(row({
      id: "mutation/unprobed",
      command: config.testCmd,
      observable: "at least one candidate line can be probed",
      verdict: "WARN",
      cls,
      note: "every candidate's deletion cannot be built, so no line was probed",
    }));
  }
  return [...checks, ...probed.map((entry) => entry.row), ...skipped];
}

// One row per file, never one per line: a build that refuses a deletion is a
// property of the line's shape, not a claim about a test, so the session reads
// the lines once and looks at the candidates that could be probed.
function nonCandidateRows(results) {
  const byFile = new Map();
  for (const entry of results) {
    if (!entry.nonCandidate) continue;
    const { file, line, reason } = entry.nonCandidate;
    if (!byFile.has(file)) byFile.set(file, { reasons: new Set(), lines: [] });
    const group = byFile.get(file);
    group.reasons.add(reason);
    group.lines.push(line);
  }
  return [...byFile.entries()].map(([file, group]) => {
    const lines = group.lines.slice().sort((left, right) => left - right);
    const listed = lines.join(",");
    return row({
      id: `mutation/noncandidate/${file}`,
      command: "no command",
      observable: "a line whose deletion cannot be observed by a test is not a candidate to kill",
      verdict: "SKIP",
      note: `${lines.length} line(s) ${[...group.reasons].join(" and ")}: ${listed}`,
    });
  });
}

if (isMain(import.meta.url)) await probeCli({ name, types, summary, usage, run });