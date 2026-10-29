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
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
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

// Whether a line carries code is decided in one of three ways, and the choice is a
// property of the language, not of a guess:
//
//   1. the language's own parser, where one is installed here (Bun for js/ts/jsx, python3
//      for py, cc for C). The file is compiled with the line removed and the line is
//      dropped only when the result is identical. This is exact, because no hand-written
//      rule can know where a JSX attribute, an f-string or a heredoc ends.
//   2. a scanner, for a language whose lexical grammar is closed and small: Go, whose only
//      comment forms are // and /* */, whose only multi-line literal is a backtick string,
//      and whose quotes never span lines.
//   3. a heuristic, for every other language. Its exclusions are reported to the caller as
//      unverified, so a lane that dropped one may read WARN but never PASS.
const SCANNED_LANGUAGES = new Set(["go"]);

export function commentPolicy(file) {
  const extension = extensionOf(file);
  if (SCANNED_LANGUAGES.has(extension)) return "scanner";
  if (hasOracle(file)) return "oracle";
  return "heuristic";
}

// A candidate must be a line whose deletion a test can observe, so a line whose
// whole text is comment is never one. A marker test cannot decide that: a block
// comment's body lines carry no marker of their own, which is how a comment line
// became a SURVIVED mutation the lane had to fail on. The table below names, per
// extension, the line markers, the block delimiters and the quotes whose content
// is code. An extension outside it has no comment opinion: the caller keeps the
// line rather than guessing, because dropping a real statement would let a
// surviving mutation escape.
const C_LIKE = Object.freeze({ line: ["//"], block: [["/*", "*/"]], quotes: ['"', "'", "`"], template: "`", interpolates: true });
// Rust, Swift, Scala, Kotlin and Dart nest block comments: an inner close does not end
// the outer comment, so the scanner counts depth for them only. In C and JavaScript a
// nested opener is plain text and the first close ends the comment.
const C_NESTED = Object.freeze({ ...C_LIKE, nested: true });
// A Go raw string is a backtick literal where a backslash is data, not an escape.
const C_RAW = Object.freeze({ ...C_LIKE, rawTemplate: true, interpolates: false });
const HASH_LINE = Object.freeze({ line: ["#"], block: [], quotes: ['"', "'"] });

const COMMENT_SYNTAX = Object.freeze({
  js: C_LIKE, mjs: C_LIKE, cjs: C_LIKE, jsx: C_LIKE, ts: C_LIKE, tsx: C_LIKE, mts: C_LIKE, cts: C_LIKE,
  go: C_RAW, c: C_LIKE, h: C_LIKE, cc: C_LIKE, cpp: C_LIKE, cxx: C_LIKE, hpp: C_LIKE, hh: C_LIKE, cs: C_LIKE, java: C_LIKE,
  kt: C_NESTED, kts: C_NESTED, swift: C_NESTED, rs: C_NESTED, scala: C_NESTED, dart: C_NESTED, zig: C_LIKE,
  php: C_LIKE, css: C_LIKE, scss: C_LIKE, less: C_LIKE, sol: C_LIKE, vue: C_LIKE, svelte: C_LIKE,
  py: HASH_LINE, rb: HASH_LINE, sh: HASH_LINE, bash: HASH_LINE, zsh: HASH_LINE, r: HASH_LINE,
  pl: HASH_LINE, jl: HASH_LINE, rego: HASH_LINE, ex: HASH_LINE, exs: HASH_LINE,
  tf: Object.freeze({ line: ["#"], block: [["/*", "*/"]], quotes: ['"'] }),
  nim: Object.freeze({ line: ["#"], block: [["#[", "]#"]], quotes: ['"'], nested: true }),
  erl: Object.freeze({ line: ["%"], block: [], quotes: ['"'] }),
  hs: Object.freeze({ line: ["--"], block: [["{-", "-}"]], quotes: ['"'], nested: true }),
  lua: Object.freeze({ line: ["--"], block: [["--[[", "]]"]], quotes: ['"', "'"] }),
  sql: Object.freeze({ line: ["--"], block: [["/*", "*/"]], quotes: ["'", '"'] }),
  ml: Object.freeze({ line: [], block: [["(*", "*)"]], quotes: ['"'], nested: true }),
  mli: Object.freeze({ line: [], block: [["(*", "*)"]], quotes: ['"'], nested: true }),
  clj: Object.freeze({ line: [";"], block: [], quotes: ['"'] }),
  html: Object.freeze({ line: [], block: [["<!--", "-->"]], quotes: [] }),
  astro: Object.freeze({ line: [], block: [["<!--", "-->"]], quotes: [] }),
});


export function extensionOf(file) {
  const name = String(file);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

// The 1-based lines of a file that carry no code. This is a character scanner, not a
// parser, and every rule below exists because its absence produced a wrong verdict: a
// string that spans lines (a template, or a quote continued by a backslash) must not let
// a /* open a comment; an expression inside a template is code again; a block comment
// opened after a non-space character stays on its line, so a /* inside a regular
// expression cannot swallow the lines below it; nested block comments count depth in the
// languages that nest them; an opener that never closes is read as code; and lines are
// counted on newline only, like git, so a stray CR cannot shift the numbering. When
// unsure it keeps the line, because a dropped candidate lets a surviving mutation escape
// the lane. `null` means this module has no syntax for the extension.
function endsAValue(prefix) {
  const trimmed = prefix.replace(/\s+$/, "");
  return /[A-Za-z0-9_)\]}"'\`;,]$/.test(trimmed);
}

export function commentOnlyLines(source, file) {
  const syntax = COMMENT_SYNTAX[extensionOf(file)];
  if (!syntax) return null;
  const [openDelim, closeDelim] = syntax.block[0] ?? [null, null];
  const template = syntax.template ?? null;
  const text = String(source ?? "");
  const lineCount = text.split("\n").length;
  const isCode = new Array(lineCount + 2).fill(false);
  let mode = "code";
  let line = 1;
  let atLineStart = true;
  let blockDepth = 0;
  let blockOpenedAt = 0;
  let blockCarries = true;
  let exprDepth = 0;
  let templateOpenedAt = 0;

  const newline = () => {
    line += 1;
    atLineStart = true;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (mode === "line-comment") {
      if (ch === "\n") {
        mode = "code";
        newline();
      }
      continue;
    }

    if (mode === "block") {
      if (syntax.nested && openDelim !== null && text.startsWith(openDelim, i)) {
        blockDepth += 1;
        i += openDelim.length - 1;
        continue;
      }
      if (closeDelim !== null && text.startsWith(closeDelim, i)) {
        blockDepth -= 1;
        i += closeDelim.length - 1;
        if (blockDepth === 0) mode = "code";
        continue;
      }
      if (ch === "\n") {
        if (!blockCarries) {
          mode = "code";
          blockDepth = 0;
          blockOpenedAt = 0;
        }
        newline();
      }
      continue;
    }

    if (mode === "template") {
      isCode[line] = true;
      if (ch === "\\" && syntax.rawTemplate !== true) {
        if (text[i + 1] === "\n") newline();
        i += 1;
        continue;
      }
      if (ch === template) {
        mode = "code";
        continue;
      }
      // Only a JavaScript template interpolates. In a Go raw string the sequence is data,
      // and reading it as an expression would end the string early and drop real code below.
      if (syntax.interpolates === true && ch === "$" && text[i + 1] === "{") {
        mode = "code";
        exprDepth = 1;
        atLineStart = false;
        i += 1;
        continue;
      }
      if (ch === "\n") newline();
      continue;
    }

    if (ch === "\n") {
      newline();
      continue;
    }
    if (exprDepth > 0) {
      if (ch === "{") exprDepth += 1;
      if (ch === "}") {
        exprDepth -= 1;
        if (exprDepth === 0) {
          mode = "template";
          continue;
        }
      }
    }
    if (openDelim !== null && text.startsWith(openDelim, i)) {
      blockDepth = 1;
      blockOpenedAt = line;
      blockCarries = atLineStart || endsAValue(text.slice(0, i));
      mode = "block";
      i += openDelim.length - 1;
      continue;
    }
    // A slash where a value is expected opens a regular expression, not a division: its
    // content is code and must not be read as a comment or as a template.
    if (ch === "/" && text[i + 1] !== "/" && text[i + 1] !== "*" && !endsAValue(text.slice(0, i))) {
      isCode[line] = true;
      atLineStart = false;
      let cursor = i + 1;
      let inClass = false;
      let closed = false;
      while (cursor < text.length) {
        const inner = text[cursor];
        if (inner === "\\") {
          cursor += 2;
          continue;
        }
        if (inner === "\n") break;
        if (inner === "[") inClass = true;
        else if (inner === "]") inClass = false;
        else if (inner === "/" && !inClass) {
          closed = true;
          break;
        }
        cursor += 1;
      }
      if (closed) {
        i = cursor;
        continue;
      }
    }
    // A block opener is tested before a line marker, because a language may spell its
    // block opener with the same first character ("#[" in Nim, "{-" is not "#" but "#[" is).
    const marker = syntax.line.find((candidate) => text.startsWith(candidate, i));
    if (marker !== undefined) {
      mode = "line-comment";
      i += marker.length - 1;
      continue;
    }
    if (syntax.quotes.includes(ch)) {
      isCode[line] = true;
      atLineStart = false;
      if (ch === template) {
        mode = "template";
        templateOpenedAt = line;
        continue;
      }
      let cursor = i + 1;
      let closed = false;
      while (cursor < text.length) {
        const inner = text[cursor];
        if (inner === "\\") {
          if (text[cursor + 1] === "\n") {
            newline();
            cursor += 2;
            continue;
          }
          cursor += 2;
          continue;
        }
        if (inner === ch) {
          closed = true;
          break;
        }
        if (inner === "\n") break;
        cursor += 1;
      }
      if (closed) {
        i = cursor;
        continue;
      }
      i = cursor - 1;
      continue;
    }
    if (!/\s/.test(ch)) {
      isCode[line] = true;
      atLineStart = false;
    }
  }

  if (mode === "block" && blockOpenedAt > 0) {
    for (let index = blockOpenedAt + 1; index <= lineCount; index += 1) isCode[index] = true;
  }
  // A template that never closes is a backtick that was never a template: a Go raw string
  // whose close the scanner skipped, or a backtick inside a regular expression. Its body is
  // code, so nothing below it can be lost.
  if (mode === "template" && templateOpenedAt > 0) {
    for (let index = templateOpenedAt; index <= lineCount; index += 1) isCode[index] = true;
  }

  const only = new Set();
  for (let index = 1; index <= lineCount; index += 1) if (!isCode[index]) only.add(index);
  return only;
}

const BUN_LOADERS = Object.freeze({ js: "js", mjs: "js", cjs: "js", jsx: "jsx", ts: "ts", mts: "ts", cts: "ts", tsx: "tsx" });
const C_FAMILY = new Set(["c", "h", "cc", "cpp", "cxx", "hpp", "hh"]);

function bunCompiled(source, file) {
  let emitted;
  try {
    emitted = new Bun.Transpiler({ loader: BUN_LOADERS[extensionOf(file)] }).transformSync(source);
  } catch {
    return null;
  }
  // The transpiler keeps "/*!" and "//!" legal comments in its output, so deleting one
  // would otherwise read as a change to the program. They are removed here, and only
  // where they really are comments: the same text inside a template literal is part of
  // that string, and stripping it would make a code line compare equal to its deletion.
  return stripLegalComments(emitted);
}

// Removes a preserved legal comment from a program's text, and nothing else. A quote or a
// template switches the scan to string mode, where a "/*!" is data; the scan stays in that
// mode until the closing delimiter, so a template's contents are never stripped even where
// they interpolate. A legal comment it does not remove is only a noise candidate, while one
// removed inside a string would drop a line that carries code.
function stripLegalComments(text) {
  let out = "";
  let index = 0;
  let quote = null;
  while (index < text.length) {
    const char = text[index];
    if (quote !== null) {
      out += char;
      if (char === "\\") {
        out += text[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    const block = text.startsWith("/*!", index);
    const bang = text.startsWith("//!", index);
    if (!block && !bang) {
      out += char;
      index += 1;
      continue;
    }
    const close = block ? text.indexOf("*/", index + 3) : text.indexOf("\n", index);
    if (close === -1) {
      out += char;
      index += 1;
      continue;
    }
    const after = block ? close + 2 : close;
    // A comment that stood alone on its line takes the line with it, so the deletion of a
    // banner leaves no blank line behind; a trailing comment leaves the code before it.
    const lineStart = out.lastIndexOf("\n") + 1;
    const alone = out.slice(lineStart).trim() === "";
    const newline = text[after] === "\n" ? after + 1 : after;
    if (alone && text[newline] !== undefined) {
      out = out.slice(0, lineStart);
      index = newline;
    } else {
      index = after;
    }
  }
  // A blank line at either end of the file is whitespace no program can observe, and the
  // transpiler emits one where a comment-only file used to be. Trimming it keeps the
  // comparison about the code; both ends are outside any string by construction.
  return out.replace(/^\n+/, "").replace(/\n+$/, "");
}

function pythonCompiled(source, dir) {
  const path = join(dir, "probe.py");
  writeFileSync(path, source);
  const run = spawnSync("python3", ["-c", "import ast,sys\ntry:\n    print(ast.dump(ast.parse(open(sys.argv[1], encoding='utf-8').read())))\nexcept SyntaxError:\n    sys.exit(3)", path], { encoding: "utf8" });
  return run.status === 0 ? run.stdout : null;
}

function cCompiled(source, dir, extension) {
  const path = join(dir, `probe.${extension}`);
  writeFileSync(path, source);
  const isCpp = ["cpp", "cxx", "hpp", "hh", "cc"].includes(extension);
  const args = ["-x", isCpp ? "c++" : "c"];
  if (isCpp) args.push("-std=c++17");
  args.push("-fpreprocessed", "-dD", "-E", "-P", path);
  const run = spawnSync("cc", args, { encoding: "utf8" });
  return run.status === 0 && !run.stderr.trim() ? run.stdout : null;
}

// Whether deleting this line changes the program the language's own front-end sees. This is
// the candidate question stated as a measurement instead of as a guess: a hand-written
// scanner cannot know where a raw string, a heredoc or a JSX attribute ends, so three
// review rounds each found a new shape it read as a comment and dropped a real statement.
//
// `true`  every proposal for the line leaves the program identical, so it carries no code;
// `false` some proposal changes the program, so the line carries code and stays a candidate;
// `null`  the front-end refused every proposal, so nothing is proven and the line is kept.
//
// A proposal replaces the line with a code-free line. A lone block delimiter is proposed as
// well as the empty line, because deleting "/*" or "*/" alone leaves a file that does not
// parse, which would read as "cannot decide" for every delimiter of every block comment.
export function hasOracle(file) {
  const extension = extensionOf(file);
  return C_FAMILY.has(extension) || extension === "py" || BUN_LOADERS[extension] !== undefined;
}

// A proposal is one way to make the line carry no code, and a proposal only has to be
// code-free to be sound: if the program still comes out identical, the line carried nothing.
// Removing the line is the first proposal, because blanking a blank line is a no-op and a
// blank line inside a template literal is part of that string.
const BLOCK_SYNTAX = Object.freeze({
  js: ["/*", "*/"], mjs: ["/*", "*/"], cjs: ["/*", "*/"], jsx: ["/*", "*/"], ts: ["/*", "*/"],
  tsx: ["/*", "*/"], mts: ["/*", "*/"], cts: ["/*", "*/"],
  c: ["/*", "*/"], h: ["/*", "*/"], cc: ["/*", "*/"], cpp: ["/*", "*/"], cxx: ["/*", "*/"],
  hpp: ["/*", "*/"], hh: ["/*", "*/"],
});

function proposalsFor(file) {
  const extension = extensionOf(file);
  const ladder = [null, "", "*/", "/*"];
  return ["jsx", "tsx"].includes(extension) ? [...ladder, "*/}"] : ladder;
}

// A delimiter line cannot be decided by blanking it alone: replacing "/*" leaves the closing
// "*/" of its block behind, and the file stops compiling. The whole comment region is
// therefore proposed as code-free, which is still a proposal — it only drops the line when
// the program comes out identical.
function regionProposal(lines, line, file) {
  const syntax = BLOCK_SYNTAX[extensionOf(file)];
  if (!syntax) return null;
  const [open, close] = syntax;
  const text = lines[line - 1] ?? "";
  const trimmed = text.trim();
  if (trimmed.startsWith(open)) {
    for (let index = line - 1; index < lines.length; index += 1) {
      if (index > line - 1 && (lines[index] ?? "").includes(close)) {
        return lines.filter((_, at) => at < line - 1 || at > index);
      }
    }
    return null;
  }
  if (trimmed.endsWith(close)) {
    for (let index = line - 1; index >= 0; index -= 1) {
      if (index < line - 1 && (lines[index] ?? "").includes(open)) {
        return lines.filter((_, at) => at < index || at > line - 1);
      }
    }
  }
  return null;
}

// The scratch directories this process has open. Counting the entries of the temp directory
// instead would make the assertion depend on every other process on the machine, and a suite
// run twice at once would then fail for a reason that has nothing to do with a leak.
const LIVE_SCRATCH = new Set();

export function liveScratch() {
  return LIVE_SCRATCH.size;
}

export function carriesNoCode(source, file) {
  const text = String(source ?? "");
  const extension = extensionOf(file);
  const isC = C_FAMILY.has(extension);
  const isPy = extension === "py";
  if (!hasOracle(file)) return () => null;
  const dir = mkdtempSync(join(tmpdir(), "wish-lines-"));
  LIVE_SCRATCH.add(dir);
  const compile = (candidate) => (isC
    ? cCompiled(candidate, dir, extension)
    : isPy
      ? pythonCompiled(candidate, dir)
      : bunCompiled(candidate, file));
  const lines = text.split("\n");
  const original = compile(text);
  const proposals = proposalsFor(file);
  const cache = new Map();
  const judge = (line) => {
    if (cache.has(line)) return cache.get(line);
    let verdict = null;
    // A blank line is not assumed inert: inside a template literal it is part of the string,
    // and deleting it changes the program. Only the front-end decides.
    if (original !== null && line >= 1 && line <= lines.length) {
      // One rung that leaves the program identical is proof, and no later rung can overturn
      // it: the rungs are alternatives, so a rung that differs is not evidence the line
      // carries code. Reading "any rung differs" as decisive made every C comment opener
      // read as code, because replacing "/* note" with "" leaves a stray "*/" token.
      let decided = false;
      let equal = false;
      for (const proposal of proposals) {
        const copy = proposal === null
          ? lines.filter((_, index) => index !== line - 1)
          : lines.map((entry, index) => (index === line - 1 ? proposal : entry));
        const candidate = copy.join("\n");
        // A proposal that leaves the source untouched proves nothing. For a blank line the empty
        // proposal is exactly that no-op, so this is what stops a blank line inside a template
        // literal from reading as inert.
        if (candidate === text) continue;
        const mutated = compile(candidate);
        if (mutated === null) continue;
        decided = true;
        if (mutated === original) {
          equal = true;
          break;
        }
      }
      if (!equal) {
        const region = regionProposal(lines, line, file);
        if (region !== null) {
          const mutated = compile(region.join("\n"));
          if (mutated !== null) {
            decided = true;
            equal = mutated === original;
          }
        }
      }
      verdict = equal ? true : (decided ? false : null);
    }
    cache.set(line, verdict);
    return verdict;
  };
  judge.dispose = () => {
    LIVE_SCRATCH.delete(dir);
    rmSync(dir, { recursive: true, force: true });
  };
  return judge;
}

function isNoise(candidate, testGlobs) {
  if (testGlobs.some((glob) => glob.test(candidate.file))) return true;
  const text = candidate.text;
  if (text === undefined) return false;
  if (!text.trim()) return true;
  if (/^\s*(import|from|#include|package|using)\b/.test(text)) return true;
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
  const judges = new Map();
  const judgeDisposers = [];
  const sourceOf = (file) => {
    if (root === null) return null;
    if (sources.has(file)) return sources.get(file);
    const base = resolve(root);
    const target = resolve(base, file);
    let source = null;
    // The read is contained to the root even through a link: a file that resolves outside
    // the checkout is not the candidate's own text, so the question stays unanswered and
    // the line is kept rather than silently dropped.
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
  const judgeFor = (file) => {
    if (!judges.has(file)) {
      const source = sourceOf(file);
      const policy = commentPolicy(file);
      if (source === null) judges.set(file, () => null);
      else if (policy === "oracle") {
        const judge = carriesNoCode(source, file);
        judgeDisposers.push(judge.dispose);
        judges.set(file, judge);
      }
      else {
        // The scanner answers Go, whose grammar is closed, and it answers a language with no
        // front-end here as a heuristic whose exclusions are reported as unverified.
        const only = commentOnlyLines(source, file);
        judges.set(file, (line) => (only === null ? null : only.has(line)));
      }
    }
    return judges.get(file);
  };
  const kept = raw.filter((candidate) => {
    if (!isCodeFile(candidate.file, codeExtensions)) return false;
    if (isNoise(candidate, globs)) return false;
    return judgeFor(candidate.file)(candidate.line) !== true;
  });
  // A lane may not read PASS while it dropped a line no front-end proved inert, so every
  // heuristic exclusion of a language with no front-end is reported to the caller.
  const unverified = [];
  for (const candidate of raw) {
    if (!isCodeFile(candidate.file, codeExtensions) || isNoise(candidate, globs)) continue;
    if (commentPolicy(candidate.file) !== "heuristic") continue;
    if (judgeFor(candidate.file)(candidate.line) === true) unverified.push({ file: candidate.file, line: candidate.line });
  }
  Object.defineProperty(kept, "unverified", { value: unverified, enumerable: false });
  Object.defineProperty(kept, "dispose", { value: () => judgeDisposers.forEach((fn) => fn()), enumerable: false });
  return kept;
}

export function lineBody(ctx, entry) {
  if (entry.text !== undefined) return entry.text;
  const file = resolve(ctx.root, entry.file);
  if (!file.startsWith(`${ctx.root}${sep}`) || !existsSync(file)) return "";
  // The read is contained even through a link: a file that resolves outside the root is
  // not this candidate's own text, so the line reads as empty rather than reaching out.
  let real;
  try {
    real = realpathSync(file);
  } catch {
    return "";
  }
  let base;
  try {
    base = realpathSync(ctx.root);
  } catch {
    return "";
  }
  if (!real.startsWith(`${base}${sep}`)) return "";
  return readFileSync(real, "utf8").split("\n")[entry.line - 1] ?? "";
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