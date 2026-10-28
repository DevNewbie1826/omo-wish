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

import { readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { assertRevision, globToRegExp, gitLines, matchFiles, q, row, runCommand, isMain, probeCli } from "./lib.mjs";

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
program lacks FAILs; a flag already documented at the merge base of "base"
and HEAD is a pre-existing row and only WARNs, because the declared help
command is not required to list every historical flag. "base" must be a
revision, never an option, and it defaults to "origin/main" like the other
diff-aware probes, so a sweep config that omits the key still gets the diff
scoping that keeps pre-existing flags from failing the run. When the diff
against the base cannot be read (not a checkout, or the base revision does
not exist) the probe falls back to the full declared doc set and every
absent flag FAILs, so it never passes silently on a state it cannot see.
The help command runs once through the same supervised runner as every other
command (its own process session, killed on timeout), with "helpTimeoutMs"
(default: the run's "timeoutMs"). A documented flag with a wrong description
is not decided here; that row goes to the checklist pass.`;

// Paths git names are relative to the repository toplevel, but a sweep root
// may be the toplevel or a subdirectory of it, and either side can reach the
// checkout through a symlink. Canonicalizing both with realpath before the
// containment check keeps a symlink alias from reading as "outside" the
// repository and falling back to the full set. `null` when the root is not
// inside a repository the diff can be read from.
async function toplevelPrefix(root) {
  const out = await gitLines(root, ["rev-parse", "--show-toplevel"]);
  const toplevel = out?.trim() ?? null;
  if (toplevel === null) return null;
  let topResolved;
  try {
    topResolved = resolve(realpathSync(toplevel));
  } catch {
    topResolved = resolve(toplevel);
  }
  let rootResolved;
  try {
    rootResolved = resolve(realpathSync(root));
  } catch {
    rootResolved = resolve(root);
  }
  if (rootResolved === topResolved) return "";
  if (!rootResolved.startsWith(`${topResolved}${sep}`)) return null;
  return rootResolved.slice(topResolved.length + 1).split(sep).join("/");
}

// The file set the diff against "base" changed, as paths relative to the
// root; `null` when the diff cannot be read, in which case the caller falls
// back to the full set. `-z` names one file per NUL-delimited entry, so a
// git-quoted (non-ASCII or special-character) path is never misparsed;
// `--no-renames` keeps a moved doc's old path in the list, so the base side
// of the move is still readable and its documented flags are not lost.
async function changedFiles(root, base, prefix) {
  const out = await runCommand({
    cmd: ["git", "-C", q(root), "diff", "-z", "--no-renames", "--name-only", q(`${base}...HEAD`)].join(" "),
    cwd: root, timeoutMs: 60000,
  });
  if (out.code !== 0) return null;
  const files = out.stdout.split("\0").filter(Boolean);
  if (prefix === "") return files;
  // Only the root's own files are judged: a changed doc outside the prefix
  // (for example a sibling of a nested root) is not part of this run and must
  // not select an unchanged file that happens to share a name.
  const inside = files.filter((rel) => rel.startsWith(`${prefix}/`));
  return inside.map((rel) => rel.slice(prefix.length + 1));
}

// The commit both diff sides actually compare against: `base...HEAD` diffs
// the merge base, so the base-side file reads use the same commit, and a
// flag upstream documented after the fork is never mistaken for one the
// diff introduced. `null` when the merge base cannot be resolved.
async function mergeBase(root, base) {
  const out = await gitLines(root, ["merge-base", base, "HEAD"]);
  const commit = out?.trim();
  return commit && /^[0-9a-f]{40}$/.test(commit) ? commit : null;
}

// The flags the merge base already documented in the doc files the diff
// touched, so a row can tell a new promise from an old one it is not being
// blamed for. Only the declared doc globs are read at the base: a comment in
// a code file is not a documentation promise. The path git shows is the same
// root-relative path the diff named, so a nested root keeps working.
async function preExistingFlags(root, baseCommit, changed, globs, pattern, prefix) {
  const flags = new Set();
  const regexes = (globs ?? []).map(globToRegExp);
  for (const rel of changed.filter((candidate) => regexes.some((regex) => regex.test(candidate)))) {
    const gitPath = prefix === "" ? rel : `${prefix}/${rel}`;
    const atBase = await gitLines(root, ["show", `${baseCommit}:${gitPath}`]);
    if (atBase !== null) for (const match of atBase.matchAll(pattern)) flags.add(match[0]);
  }
  return flags;
}

export async function run(config, ctx) {
  const cls = ctx.classFor("DOC");
  // The diff-aware siblings (mutation, errors, draft-guard) all default to
  // "origin/main"; the docs probe keeps that default so a config that omits
  // the key still gets the scoping that fixes the pre-existing-flag defect.
  const base = assertRevision(config.base) ?? "origin/main";
  const globs = config.docs ?? [];
  const docs = matchFiles(ctx.root, globs);
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
  const prefix = await toplevelPrefix(ctx.root);
  // Diff-aware: check only the doc files the diff touched, and read each
  // flagged file's merge-base revision for the flags that pre-date it. When
  // the diff cannot be read the probe falls back to the full declared doc set
  // and every absent flag FAILs, so it never passes silently on a state it
  // cannot see. When the diff is readable and it touched no doc, the probe
  // has nothing new to judge and skips.
  let preExisting = null;
  let checkedFiles = docs;
  if (prefix !== null) {
    const changed = await changedFiles(ctx.root, base, prefix);
    if (changed !== null) {
      const changedSet = new Set(changed);
      const relOf = (file) => {
        const rel = file.slice(ctx.root.length + 1);
        const norm = rel.split(sep).join("/");
        return norm === "" ? "." : norm;
      };
      checkedFiles = docs.filter((file) => changedSet.has(relOf(file)));
      if (checkedFiles.length === 0) {
        return [row({
          id: "docs", verdict: "SKIP", observable: "at least one changed doc is declared", cls,
          note: `the diff against ${base} changed no doc matching the declared globs; the changed rows belong to the checklist pass`,
        })];
      }
      const baseCommit = await mergeBase(ctx.root, base);
      if (baseCommit === null) {
        // The diff read but the base side cannot be resolved: the probe
        // cannot see the pre-existing side, so it judges nothing it is not
        // sure of and falls back to the full set with every absent flag
        // FAILing.
        preExisting = new Set();
        checkedFiles = docs;
      } else {
        preExisting = await preExistingFlags(ctx.root, baseCommit, changed, globs, pattern, prefix);
      }
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
    // or when the base side could not be resolved; WARN when the flag was
    // already documented at the merge base of base and HEAD.
    const oldRow = preExisting?.has(token) ?? false;
    checks.push(row({
      id: `docs/${token}`, command: config.helpCmd,
      observable: "a documented flag is in the help output or the known list",
      verdict: oldRow ? "WARN" : "FAIL", cls,
      note: oldRow
        ? `pre-existing documented flag: already documented at the merge base of ${base} and HEAD but missing from the help output; the change is not blamed for it`
        : "documented flag does not exist in help output or the known list",
    }));
  }
  return checks;
}

if (isMain(import.meta.url)) await probeCli({ name, types, summary, usage, run });
