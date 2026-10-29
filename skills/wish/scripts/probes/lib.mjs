// wish v2 M3 — shared machinery for the probe modules.
//
// Everything here exists so the runner stays a thin dispatcher and every probe
// module stays one class of check:
//   - process execution with a session kill (the 2026-10-27 outage class),
//   - a bounded worker pool (never more than 8 processes),
//   - file globbing and git line reading,
//   - the row shape of the M0 receipt contract (`references/ledger.md` §4).
//
// The class strings are M0's: `classValid` is imported, never re-declared, so a
// row cannot carry a class the contract rejects.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { classValid, PRIMARY_TYPES } from "../lib/schema.mjs";

// D §2.5: one command, at most five minutes, never retried.
export const COMMAND_CAP_MS = 300000;
export const MAX_PARALLEL = 8;

// D §2.5 caps the whole defect-class sweep at ten minutes; M0's lane name
// default is `sweep`.
export const SWEEP_BUDGET_MS = 600000;
export const DEFAULT_LANE = "sweep";

export function sweepBudget(value) {
  return Math.max(1, Math.min(Number(value) || SWEEP_BUDGET_MS, SWEEP_BUDGET_MS));
}

export const CRASH_PATTERNS = [
  "panic:",
  "runtime error:",
  "Traceback (most recent call last)",
  "SIGSEGV",
  "slice bounds out of range",
  "RangeError",
  "TypeError",
];

const SKIP_DIRS = new Set([".git", "node_modules", ".omo", "dist", "build", ".next", "target"]);

// POSIX single-quote quoting. Every value this module substitutes into a
// shell command goes through here, so a path can never expand as `$VAR`,
// split on whitespace, or end the argument.
export function q(value) {
  return `'${String(value).split("'").join(`'\\''`)}'`;
}

export function gitLines(root, args) {
  return runCommand({ cmd: ["git", "-C", root, ...args].map(q).join(" "), cwd: root, timeoutMs: 60000 })
    .then((result) => (result.code === 0 ? result.stdout : null));
}

// A revision is not an option: `-- --output=<path>` would let a config turn a diff
// into a write outside the receipt and scratch boundary (INV4).
export function assertRevision(base) {
  if (base !== undefined && base !== null && String(base).startsWith("-")) {
    throw new Error(`a base must be a revision, not an option: ${base}`);
  }
  return base;
}

export function clampMs(value, fallback) {
  return Math.max(1, Math.min(Number(value) || fallback, COMMAND_CAP_MS));
}

// `head` and `tree` for the M0 receipt; `null` when the root is not a checkout.
export async function gitFacts(root) {
  const head = await gitLines(root, ["rev-parse", "HEAD"]);
  const tree = await gitLines(root, ["rev-parse", "HEAD^{tree}"]);
  const trim = (value) => (value ? value.trim() : null);
  return { head: trim(head), tree: trim(tree) };
}

export function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*" && glob[i + 2] === "/") {
        out += "(?:[^/]+/)*";
        i += 2;
      } else if (glob[i + 1] === "*") {
        out += ".*";
        i += 1;
      } else out += "[^/]*";
    } else if (ch === "?") out += "[^/]";
    else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${out}$`);
}

export function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile()) acc.push(full);
  }
  return acc;
}

export function matchFiles(root, globs) {
  const regexes = (globs ?? []).map(globToRegExp);
  if (regexes.length === 0) return [];
  return walk(root).filter((file) => {
    const rel = file.slice(root.length + 1).split(sep).join("/");
    return regexes.some((regex) => regex.test(rel));
  });
}

// Every process started for one command shares the session the command's shell
// leads, so a background job that the shell moved into its own process group is
// still in that session.
export function sessionMembers(sessionId) {
  const members = [];
  try {
    for (const name of readdirSync("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      let stat;
      try {
        stat = readFileSync(`/proc/${name}/stat`, "utf8");
      } catch {
        continue;
      }
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      // A zombie is already dead; it holds no pipe and must not read as a survivor.
      if (fields[0] !== "Z" && Number(fields[3]) === sessionId) members.push(Number(name));
    }
    return members;
  } catch {
    const listed = spawnSync("/bin/sh", ["-c", "ps -A -o sess= -o pid= -o stat= 2>/dev/null"], { encoding: "utf8" });
    for (const line of (listed.stdout ?? "").split("\n")) {
      const [session, pid, state] = line.trim().split(/\s+/);
      if (Number(session) === sessionId && Number(pid) > 0 && !String(state ?? "").startsWith("Z")) members.push(Number(pid));
    }
    return members;
  }
}

export function killSession(sessionId) {
  try {
    process.kill(-sessionId, "SIGKILL");
  } catch {
    /* the group is already gone */
  }
  for (const pid of sessionMembers(sessionId)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

// Runs one command to completion. Resolves; never throws for a non-zero exit.
export function runCommand({ cmd, cwd, stdin, timeoutMs = COMMAND_CAP_MS, env = {} }) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const budget = Math.max(1, Math.min(Number(timeoutMs) || COMMAND_CAP_MS, COMMAND_CAP_MS));
    const child = spawn("/bin/sh", ["-c", cmd], {
      cwd,
      detached: true,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out = [];
    const err = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killSession(child.pid);
    }, budget);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ code: -1, signal: null, stdout: "", stderr: String(error), timedOut, ms: Date.now() - started, budget, session: child.pid });
    });
    child.on("exit", () => {
      killSession(child.pid);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({
        code: code ?? -1,
        signal,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        timedOut,
        ms: Date.now() - started,
        budget,
        session: child.pid,
      });
    });
    child.stdin.on("error", () => {});
    if (stdin === undefined || stdin === null) child.stdin.end();
    else child.stdin.end(stdin);
  });
}

export async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export function crashIn(text) {
  const hits = CRASH_PATTERNS.filter((pattern) => text.includes(pattern));
  return hits.length > 0 ? hits : null;
}

// The run context every probe receives. `classFor` is the only way a probe
// names a class, so a row can never carry one the run type does not own.
export function ctxFor({ root, type = "code", primary = null, secondary = null, timeoutMs, parallel }) {
  const types = type === "mixed"
    ? [primary, secondary].filter((entry) => PRIMARY_TYPES.includes(entry))
    : [type];
  const cleanups = [];
  const oneLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const ctx = {
    root: resolve(root),
    type,
    primary,
    secondary,
    types,
    timeoutMs: Math.max(1, Math.min(Number(timeoutMs) || COMMAND_CAP_MS, COMMAND_CAP_MS)),
    parallel: Math.max(1, Math.min(Number(parallel) || 4, MAX_PARALLEL)),
    cleanupReceipts: cleanups,
    applies: (probe) => types.some((entry) => probe.types.includes(entry)),
    classFor: (candidate) => (types.some((entry) => classValid(entry, candidate)) ? candidate : null),
    oneLine,
    cleanup: (dir) => {
      rmSync(dir, { recursive: true, force: true });
      cleanups.push(`rm -rf ${dir} (exit 0)`);
    },
  };
  return ctx;
}

// One row of the M0 receipt (§4): `id`, the literal command, the single binary
// observation that decided it, the verdict, and the defect class.
export function row({ id, verdict, observable, command = "no command", cls = null, note = null, artifact = null }) {
  if (!observable) throw new Error(`row ${id} has no observable`);
  const built = { id, command, observable, verdict, artifact };
  if (cls) built.class = cls;
  if (note) built.note = String(note).replace(/\s+/g, " ").trim().slice(0, 300);
  return built;
}

// FAIL outranks everything; a WARN memo is never hidden by a PASS sibling.
export function summarise(rows) {
  const has = (verdict) => rows.some((entry) => entry.verdict === verdict);
  if (has("FAIL")) return "FAIL";
  if (has("WARN")) return "WARN";
  if (has("INVALID")) return "INVALID";
  if (has("PASS")) return "PASS";
  return "SKIP";
}

// The receipt status (M0 §4.1) plus the process exit code (M0 §14). PASS means
// every row passed, so an INVALID row can never read as PASS: it makes the lane
// a memo (WARN), which never blocks and never exits 1.
export function receiptStatus(rows) {
  const has = (verdict) => rows.some((entry) => entry.verdict === verdict);
  if (has("FAIL")) return { status: "FAIL", exit: 1 };
  if (has("WARN") || has("INVALID")) return { status: "WARN", exit: 0 };
  if (has("PASS")) return { status: "PASS", exit: 0 };
  return { status: "SKIP", exit: 0 };
}

// Added lines of the reviewed diff, per file, with their new-file line numbers.
// Git is called with an argv array, never through a shell, so a path can never
// be re-parsed.
export async function addedLines({ root, base, paths }) {
  const args = ["diff", "-U0", "--no-color", `${assertRevision(base) ?? "origin/main"}...HEAD`];
  if (paths && paths.length > 0) args.push("--", ...paths);
  const diff = await gitLines(root, args);
  if (diff === null) return [];
  const candidates = [];
  let file = null;
  let newLine = 1;
  for (const line of diff.split("\n")) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header) {
      file = header[1];
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!file) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      candidates.push({ file, line: newLine, text: line.slice(1) });
      newLine += 1;
    } else if (!line.startsWith("-")) {
      newLine += 1;
    }
  }
  return candidates;
}

export const DEFAULT_TEST_GLOBS = ["**/*_test.go", "**/*.test.js", "**/*.test.ts", "**/test/**", "**/tests/**"];

// What a probe may mutate or scan: source files. Prose and data are excluded by
// default for two measured reasons: mutating a documentation line demands a test
// that pins prose (which the flow forbids), and scanning a test file reports its
// fixture needles as production defects.
export const DEFAULT_CODE_EXTENSIONS = Object.freeze([
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "mts", "cts", "py", "go", "rs", "rb", "java", "kt", "kts",
  "swift", "c", "h", "cc", "cpp", "hpp", "cs", "php", "sh", "bash", "zsh", "sql", "css", "scss",
  "less", "html", "vue", "svelte", "astro", "lua", "ex", "exs", "erl", "hs", "ml", "scala", "clj",
  "dart", "zig", "nim", "pl", "r", "jl", "tf", "rego", "sol",
]);

export function isCodeFile(file, extensions = DEFAULT_CODE_EXTENSIONS) {
  const name = String(file);
  const dot = name.lastIndexOf(".");
  return dot !== -1 && extensions.includes(name.slice(dot + 1).toLowerCase());
}

// A candidate must be a line whose deletion a test can observe, so a line whose
// whole text is comment is never one. A marker test cannot decide that: a block
// comment's body lines carry no marker of their own, which is how a comment line
// became a SURVIVED mutation the lane had to fail on. The table below names, per
// extension, the line markers, the block delimiters and the quotes whose content
// is code. An extension outside it has no comment opinion: the caller keeps the
// line rather than guessing, because dropping a real statement would let a
// surviving mutation escape.
const C_LIKE = Object.freeze({ line: ["//"], block: [["/*", "*/"]], quotes: ['"', "'", "`"] });
const HASH_LINE = Object.freeze({ line: ["#"], block: [], quotes: ['"', "'"] });

const COMMENT_SYNTAX = Object.freeze({
  js: C_LIKE, mjs: C_LIKE, cjs: C_LIKE, jsx: C_LIKE, ts: C_LIKE, tsx: C_LIKE, mts: C_LIKE, cts: C_LIKE,
  go: C_LIKE, c: C_LIKE, h: C_LIKE, cc: C_LIKE, cpp: C_LIKE, cxx: C_LIKE, hpp: C_LIKE, hh: C_LIKE, cs: C_LIKE, java: C_LIKE,
  kt: C_LIKE, kts: C_LIKE, swift: C_LIKE, rs: C_LIKE, scala: C_LIKE, dart: C_LIKE, zig: C_LIKE,
  php: C_LIKE, css: C_LIKE, scss: C_LIKE, less: C_LIKE, sol: C_LIKE, vue: C_LIKE, svelte: C_LIKE,
  py: HASH_LINE, rb: HASH_LINE, sh: HASH_LINE, bash: HASH_LINE, zsh: HASH_LINE, r: HASH_LINE,
  pl: HASH_LINE, jl: HASH_LINE, rego: HASH_LINE, ex: HASH_LINE, exs: HASH_LINE,
  tf: Object.freeze({ line: ["#"], block: [["/*", "*/"]], quotes: ['"'] }),
  nim: Object.freeze({ line: ["#"], block: [["#[", "]#"]], quotes: ['"'] }),
  erl: Object.freeze({ line: ["%"], block: [], quotes: ['"'] }),
  hs: Object.freeze({ line: ["--"], block: [["{-", "-}"]], quotes: ['"'] }),
  lua: Object.freeze({ line: ["--"], block: [["--[[", "]]"]], quotes: ['"', "'"] }),
  sql: Object.freeze({ line: ["--"], block: [["/*", "*/"]], quotes: ["'", '"'] }),
  ml: Object.freeze({ line: [], block: [["(*", "*)"]], quotes: ['"'] }),
  mli: Object.freeze({ line: [], block: [["(*", "*)"]], quotes: ['"'] }),
  clj: Object.freeze({ line: [";"], block: [], quotes: ['"'] }),
  html: Object.freeze({ line: [], block: [["<!--", "-->"]], quotes: [] }),
  astro: Object.freeze({ line: [], block: [["<!--", "-->"]], quotes: [] }),
});

// Whether this module knows a comment syntax for the extension. Exported so a test can
// hold the table and the compiled-extension set equal: a compiled extension outside the
// table would fall back to the marker test and the block-comment symptom would return.
export function hasCommentSyntax(extension) {
  return Object.hasOwn(COMMENT_SYNTAX, String(extension).toLowerCase());
}

export function extensionOf(file) {
  const name = String(file);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

// The 1-based lines of a file that carry no code: blank lines and lines whose only
// content is comment. A string literal counts as code, so a line is never dropped
// for containing one. `null` means this module has no syntax for the extension.
export function commentOnlyLines(source, file) {
  const syntax = COMMENT_SYNTAX[extensionOf(file)];
  if (!syntax) return null;
  const only = new Set();
  let block = null;
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    let rest = lines[index];
    let code = false;
    while (rest.length > 0) {
      if (block !== null) {
        const at = rest.indexOf(block);
        if (at === -1) {
          rest = "";
          break;
        }
        rest = rest.slice(at + block.length);
        block = null;
        continue;
      }
      const pair = syntax.block.find(([open]) => rest.startsWith(open));
      if (pair) {
        block = pair[1];
        rest = rest.slice(pair[0].length);
        continue;
      }
      if (syntax.line.some((marker) => rest.startsWith(marker))) {
        rest = "";
        break;
      }
      const head = rest[0];
      if (syntax.quotes.includes(head)) {
        code = true;
        let cursor = 1;
        while (cursor < rest.length && rest[cursor] !== head) cursor += rest[cursor] === "\\" ? 2 : 1;
        rest = rest.slice(cursor + 1);
        continue;
      }
      if (!/\s/.test(head)) code = true;
      rest = rest.slice(1);
    }
    if (!code) only.add(index + 1);
  }
  return only;
}

function isNoise(candidate, testGlobs) {
  if (testGlobs.some((glob) => glob.test(candidate.file))) return true;
  const text = candidate.text;
  if (text === undefined) return false;
  if (!text.trim()) return true;
  if (/^\s*(import|from|#include|package|using)\b/.test(text)) return true;
  if (/^\s*(\/\/|#|\*|\/\*)/.test(text)) return true;
  if (/^\s*[)}\]],?\s*$/.test(text)) return true;
  if (/[({[,]\s*$/.test(text)) return true;
  return false;
}

// The candidate lines a mutation or an error scan may look at: added production
// source lines, with declaration, comment, import and continuation noise dropped.
// With `root`, a candidate's own file answers the comment question, so a block
// comment's body is dropped even when the diff carried no marker for it and a
// declared candidate is judged by the same rule as a diff-derived one.
export function productionLines(raw, { testGlobs = DEFAULT_TEST_GLOBS, codeExtensions = DEFAULT_CODE_EXTENSIONS, root = null } = {}) {
  const globs = testGlobs.map(globToRegExp);
  const sources = new Map();
  const indexes = new Map();
  const sourceOf = (file) => {
    if (root === null) return null;
    if (sources.has(file)) return sources.get(file);
    const base = resolve(root);
    const target = resolve(base, file);
    let source = null;
    // The read is contained to the root even through a link: a file that resolves
    // outside the checkout is not the candidate's own text, so the comment question
    // stays unanswered and the line is kept rather than silently dropped.
    if (target.startsWith(`${base}${sep}`) && existsSync(target)) {
      try {
        const real = realpathSync(target);
        if (real.startsWith(`${realpathSync(base)}${sep}`)) source = readFileSync(real, "utf8");
      } catch {
        source = null;
      }
    }
    sources.set(file, source);
    return source;
  };
  const isCommentOnly = (candidate) => {
    if (!indexes.has(candidate.file)) {
      const source = sourceOf(candidate.file);
      indexes.set(candidate.file, source === null ? null : commentOnlyLines(source, candidate.file));
    }
    return indexes.get(candidate.file)?.has(candidate.line) ?? false;
  };
  return raw.filter((candidate) => isCodeFile(candidate.file, codeExtensions)
    && !isNoise(candidate, globs)
    && !isCommentOnly(candidate));
}

// The probe's work list: production lines, capped at `max`.
export function selectCandidates(raw, { testGlobs = DEFAULT_TEST_GLOBS, codeExtensions = DEFAULT_CODE_EXTENSIONS, max = 12, root = null } = {}) {
  return productionLines(raw, { testGlobs, codeExtensions, root }).slice(0, max);
}

export function lineBody(ctx, entry) {
  if (entry.text !== undefined) return entry.text;
  const file = resolve(ctx.root, entry.file);
  return file.startsWith(`${ctx.root}${sep}`) && existsSync(file)
    ? (readFileSync(file, "utf8").split("\n")[entry.line - 1] ?? "")
    : "";
}

export function isMain(metaUrl) {
  const entry = process.argv[1];
  return Boolean(entry) && resolve(entry) === fileURLToPath(metaUrl);
}

const PROBE_USAGE = `  --config <path>   sweep config (default .wish-sweep.json; probes.<name> is used)
  --root <dir>      project root the commands run in (default .)
  --help            print this message`;

// A probe module is also a command, so one class can be re-run alone while the
// session is fixing it. `--help` exits 0 and never runs a command.
export async function probeCli(probe) {
  const argv = process.argv.slice(2);
  const opts = { config: ".wish-sweep.json", root: "." };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${probe.name}: ${probe.summary}\n\nusage: <bun> ${probe.file ?? "probe"} [options]\n${PROBE_USAGE}\n\n${probe.usage}\n`);
      process.exit(0);
    } else if (arg === "--config" && argv[i + 1] !== undefined) opts.config = argv[++i];
    else if (arg === "--root" && argv[i + 1] !== undefined) opts.root = argv[++i];
    else {
      process.stderr.write(`${probe.name}: unknown or incomplete argument: ${arg}\n`);
      process.exit(2);
    }
  }
  const root = resolve(opts.root);
  const path = resolve(root, opts.config);
  let document;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    process.stderr.write(`${probe.name}: cannot read ${path}: ${error?.message ?? error}\n`);
    process.exit(2);
  }
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    process.stderr.write(`${probe.name}: config must be a JSON object: ${path}\n`);
    process.exit(2);
  }
  const config = document.probes?.[probe.name];
  const ctx = ctxFor({ root, type: document.type ?? "code", primary: document.primary, secondary: document.secondary, timeoutMs: document.timeoutMs, parallel: document.parallel });
  let rows;
  if (config === undefined) rows = [row({ id: probe.name, verdict: "SKIP", observable: "the probe is not configured", note: `probes.${probe.name} is absent` })];
  else if (!ctx.applies(probe)) rows = [row({ id: probe.name, verdict: "SKIP", observable: "the probe does not apply to this work type", note: `types: ${probe.types.join(",")}; run type: ${ctx.type}` })];
  else rows = await probe.run(config, ctx);
  for (const entry of rows) {
    const detail = entry.note ? `: ${entry.note}` : "";
    process.stdout.write(`${entry.verdict.padEnd(7)} ${entry.id}${detail}\n`);
  }
  const { status, exit } = receiptStatus(rows);
  process.stdout.write(`${probe.name}: ${status}, ${rows.length} row(s)\n`);
  process.exit(exit);
}