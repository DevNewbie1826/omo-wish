// Class DOC — documentation that promises a flag the program does not have.
//
// Measured: 5 rows, none blocking, and the reason this probe reports only the
// mechanical half: a documented flag must exist in the help output. Whether the
// prose promise matches the behavior needs a reader, so it stays in the
// checklist pass.
//
// A pre-existing row is WARN, never FAIL: a documented flag that the diff did
// not introduce may have been written when the program still had the flag, and
// a stub help command cannot be asked to enumerate every historical flag. A
// flag the diff itself documents still FAILs when it is missing, so the probe
// keeps deciding the one defect the change can be blamed for.

import { readFileSync } from "node:fs";
import { sep } from "node:path";
import { assertRevision, gitLines, matchFiles, row, runCommand, isMain, probeCli } from "./lib.mjs";

export const name = "docs";
export const types = ["code"];
export const summary = "every documented flag exists in the help output";

export const usage = `config:
  "probes": { "docs": {
    "helpCmd": "bin --help", "docs": ["docs/**/*.md"], "known": ["--internal-flag"],
    "flagPattern": "--[a-z][a-z0-9-]{2,}", "base": "origin/main"
  } }

Every token matched by "flagPattern" in the changed docs must appear in the
output of "helpCmd" or in "known". A flag the diff itself documents and the
program lacks FAILs; a flag already documented at "base" is a pre-existing row
and only WARNs, because the declared help command is not required to list every
historical flag. "base" must be a revision, never an option, and when the
diff against it cannot be read (not a checkout, or no diff) the rows fall back
to the mechanical half: every absent flag FAILs. The help command runs once
through the same supervised runner as every other command (its own process
session, killed on timeout), with "helpTimeoutMs" (default: the run's
"timeoutMs"). A documented flag with a wrong description is not decided here;
that row goes to the checklist pass.`;

// The file set the diff against "base" changed, as relative paths; `null` when
// the diff cannot be read, in which case the caller falls back to the full set.
async function changedFiles(root, base) {
  const text = await gitLines(root, ["diff", "--name-only", `${assertRevision(base) ?? "origin/main"}...HEAD`]);
  return text === null ? null : text.split("\n").map((line) => line.trim()).filter(Boolean);
}

// The flags "base" already documented in the doc files the diff touched, so a
// row can tell a new promise from an old one it is not being blamed for.
async function preExistingFlags(root, base, changed, pattern) {
  const flags = new Set();
  for (const file of changed) {
    const rel = file.split(sep).join("/");
    const atBase = await gitLines(root, ["show", `${base}:${rel}`]);
    if (atBase !== null) for (const match of atBase.matchAll(pattern)) flags.add(match[0]);
  }
  return flags;
}

export async function run(config, ctx) {
  const cls = ctx.classFor("DOC");
  const base = assertRevision(config.base);
  const docs = matchFiles(ctx.root, config.docs ?? []);
  if (docs.length === 0) {
    return [row({ id: "docs", verdict: "SKIP", observable: "at least one changed doc is declared", cls, note: "no changed docs matched" })];
  }
  if (!config.helpCmd) {
    return [row({ id: "docs", verdict: "SKIP", observable: "a help command is declared", cls, note: "no help command; documented flags go to the checklist pass" })];
  }
  const help = await runCommand({ cmd: config.helpCmd, cwd: ctx.root, timeoutMs: config.helpTimeoutMs ?? ctx.timeoutMs });
  const helpText = `${help.stdout}\n${help.stderr}`;
  const known = new Set(config.known ?? []);
  const pattern = new RegExp(config.flagPattern ?? "--[a-z][a-z0-9-]{2,}", "g");
  // Diff-aware when "base" is declared: check only the doc files the diff
  // touched, and read each flagged file's "base" revision for the flags that
  // pre-date it. When the diff cannot be read (not a checkout, or the base
  // revision does not exist) the probe falls back to the full declared doc set
  // and every absent flag FAILs, so it never passes silently on a state it
  // cannot see. When the diff is readable and it touched no doc, the probe
  // has nothing new to judge and skips.
  let preExisting = null;
  let checkedFiles = docs;
  if (base !== undefined) {
    const changed = await changedFiles(ctx.root, base);
    if (changed !== null) {
      const changedSet = new Set(changed);
      checkedFiles = docs.filter((file) => changedSet.has(file.slice(ctx.root.length + 1).split(sep).join("/")));
      if (checkedFiles.length === 0) {
        return [row({
          id: "docs", verdict: "SKIP", observable: "at least one changed doc is declared", cls,
          note: `the diff against ${base} changed no doc matching the declared globs; the changed rows belong to the checklist pass`,
        })];
      }
      preExisting = await preExistingFlags(ctx.root, base, changed, pattern);
    }
  }
  const documented = new Set();
  for (const file of checkedFiles) {
    for (const match of readFileSync(file, "utf8").matchAll(pattern)) documented.add(match[0]);
  }
  if (documented.size === 0) {
    return [row({ id: "docs", verdict: "SKIP", observable: "a flag is documented in the changed docs", cls, note: "no flags documented in the changed docs" })];
  }
  const checks = [];
  for (const token of documented) {
    if (known.has(token)) {
      checks.push(row({
        id: `docs/${token}`, command: config.helpCmd,
        observable: "a documented flag is in the help output or the known list",
        verdict: "PASS", cls, note: "declared known in the sweep config",
      }));
      continue;
    }
    const present = helpText.includes(token);
    if (present) {
      checks.push(row({
        id: `docs/${token}`, command: config.helpCmd,
        observable: "a documented flag is in the help output or the known list",
        verdict: "PASS", cls, note: "documented flag exists in help output",
      }));
      continue;
    }
    // Absent from the help output: FAIL when the diff introduced the promise,
    // or when the diff side could not be read; WARN when the flag was already
    // documented at the base revision. When "base" is not declared there is no
    // pre-existing side to compare against, so an absent row stays a FAIL.
    const oldRow = preExisting?.has(token) ?? false;
    checks.push(row({
      id: `docs/${token}`, command: config.helpCmd,
      observable: "a documented flag is in the help output or the known list",
      verdict: oldRow ? "WARN" : "FAIL", cls,
      note: oldRow
        ? `pre-existing documented flag: already documented at ${base} but missing from the help output; the change is not blamed for it`
        : "documented flag does not exist in help output or the known list",
    }));
  }
  return checks;
}

if (isMain(import.meta.url)) await probeCli({ name, types, summary, usage, run });