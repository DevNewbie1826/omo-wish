// Class T — a test that passes when the code is wrong.
//
// Measured: 8 guard-removal rows, 1 blocking, and the vacuous-guard tail behind
// the #63 REVISE chain. The probe deletes one added production line in a
// throwaway copy and requires the declared suite to fail.

import { chmodSync, cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
copy of the tree and the suite is re-run. The copy leaves node_modules out and
borrows a read-only copy of the repository's install, made once per run, so a
guard that imports a package still compiles, a mutant cannot write through into
the install, and an INVALID row means the mutation, not a missing dependency:
  PASS    the suite failed with a test-failure marker (the mutation was killed)
  FAIL    the suite stayed green (SURVIVED: nothing tests this line)
  INVALID the mutation did not compile, or the run failed without a failure
          marker; INVALID is never a kill.
"candidates" replaces the diff-derived list (fixtures, or a diff already merged).
Only added production source lines are candidates: prose and test files are never
mutated, because a doc line would demand a test that pins prose and a test line
would demand a test of its own fixtures. "testGlobs" and "codeExtensions"
override that filter. At most 12 production lines are probed whatever "max"
says (a lower "max" is honoured: tier S declares 3); the rest are reported as
one WARN row so an unprobed line can never read as covered.`;

const SKIP_DIRS = new Set([".git", "node_modules", ".omo", "dist", "build", ".next", "target"]);

// A guard that imports a package cannot compile without the installed tree, so the
// copy reuses it — through a read-only copy made once per run, never through a link
// to the repository's own install. A writable share lets the suite write into the
// install through the copy: that corrupts the repository and can fail a test for a
// reason the mutation did not cause, which the probe would then count as a kill.
function sealTree(target, directoryMode, fileMode) {
  let outside = 0;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const full = join(target, entry.name);
    // chmod follows a link; a link is either refused by prepareInstall or shipped as a
    // real file above, so nothing here may follow one.
    if (entry.isSymbolicLink()) {
      outside += 1;
      continue;
    }
    if (entry.isDirectory()) {
      outside += sealTree(full, directoryMode, fileMode);
      chmodSync(full, directoryMode);
      continue;
    }
    // A binstub stays executable: the copy is read-only, not inert.
    const executable = (statSync(full).mode & 0o111) !== 0;
    chmodSync(full, executable ? fileMode | 0o111 : fileMode);
  }
  return outside;
}

function prepareInstall(root) {
  const source = join(root, "node_modules");
  if (!existsSync(source)) return { path: null };
  const scratch = mkdtempSync(join(tmpdir(), "wish-sweep-install-"));
  const copy = join(scratch, "node_modules");
  try {
    // Dereferenced: a package manager that links its store into node_modules would
    // otherwise leave the copy pointing at a writable tree outside it.
    cpSync(source, copy, { recursive: true, dereference: true });
    const outside = sealTree(copy, 0o555, 0o444);
    chmodSync(copy, 0o555);
    if (outside > 0) {
      releaseInstall({ scratch });
      return { error: "the install has links the copy could not make read-only; the mutation row is refused" };
    }
    return { path: copy, scratch };
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true });
    return { error: `the copy could not prepare a read-only node_modules: ${error?.code ?? error}` };
  }
}

function releaseInstall(install) {
  if (!install?.scratch) return;
  try {
    sealTree(install.scratch, 0o755, 0o644);
    chmodSync(install.scratch, 0o755);
  } catch {
    // a mode that cannot be restored must not hide the scratch removal below
  }
  rmSync(install.scratch, { recursive: true, force: true });
}

function linkInstalledModules(install, tree) {
  if (!install?.path || existsSync(join(tree, "node_modules"))) return null;
  try {
    symlinkSync(install.path, join(tree, "node_modules"), "dir");
    return null;
  } catch (error) {
    return `the copy could not reuse node_modules: ${error?.code ?? error}`;
  }
}

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
  const production = productionLines(raw, { testGlobs: config.testGlobs, codeExtensions: config.codeExtensions });
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
  const install = prepareInstall(ctx.root);
  if (install.error) return [...checks, row({ id: "mutation", command: config.testCmd, observable: "the copy reuses a read-only install", verdict: "INVALID", cls, note: install.error })];
  let results;
  results = await mapPool(candidates, Math.min(8, ctx.parallel), async (candidate) => {
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
      const linkError = linkInstalledModules(install, tree);
      if (linkError) return row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: linkError });
      const target = resolve(tree, candidate.file);
      if (!target.startsWith(`${tree}${sep}`)) {
        return row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "candidate path escapes the throwaway copy; nothing was written" });
      }
      if (!existsSync(target)) return row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "file not found in the copy" });
      if (lstatSync(target).isSymbolicLink()) {
        return row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "candidate is a symlink, so writing it would edit its target outside the copy" });
      }
      if (!insideCopy(tree, target)) {
        return row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "candidate resolves outside the throwaway copy through a linked directory; nothing was written" });
      }
      const lines = readFileSync(target, "utf8").split("\n");
      const index = candidate.line - 1;
      if (lines[index] === undefined) return row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "line no longer exists" });
      lines[index] = "";
      const mutated = lines.join("\n");
      if (!parses(mutated, candidate.file)) {
        return row({ id, command: config.testCmd, observable, verdict: "INVALID", cls, note: "mutation did not parse, so it is not counted as killed" });
      }
      writeFileSync(target, mutated);
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
  }).finally(() => releaseInstall(install));
  return [...checks, ...results];
}

if (isMain(import.meta.url)) await probeCli({ name, types, summary, usage, run });