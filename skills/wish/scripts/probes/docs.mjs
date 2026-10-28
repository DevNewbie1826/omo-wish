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
// repository toplevel; `null` when the diff cannot be read, in which case
// the caller falls back to the full set. `--no-relative` keeps the toplevel-
//relative form even when the checkout's configuration sets `diff.relative`,
// so the prefix arithmetic below stays valid; `-z` names one file per NUL-
// delimited entry, so a git-quoted (non-ASCII or special-character) path is
// never misparsed; `--no-renames` keeps a moved doc's old path in the list,
// so the base side of the move is still readable and its documented flags are
// not lost.
async function changedFiles(root, base, prefix) {
  const out = await runCommand({
    cmd: ["git", "-C", q(root), "diff", "-z", "--no-relative", "--no-renames", "--name-only", q(`${base}...HEAD`)].join(" "),
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

async function baseTreeMembership(root, baseCommit, changed, globs, prefix) {
  const regexes = (globs ?? []).map(globToRegExp);
  const out = await runCommand({
    cmd: ["git", "-C", q(root), "ls-tree", "-z", "--full-tree", "-r", q(baseCommit)].join(" "),
    cwd: root, timeoutMs: 60000,
  });
  // -z lists one entry per NUL-delimited record of "mode type sha0\tname",
  // where name is toplevel-relative. The declared doc globs are root-
  // relative, so strip the prefix off the name before the glob test; a
  // toplevel file whose name sits outside the prefix is not in this run.
  const membership = new Map();
  if (out.code === 0) {
    for (const entry of out.stdout.split("\0")) {
      if (!entry) continue;
      const tab = entry.indexOf("\t");
      if (tab === -1) continue;
      const meta = entry.slice(0, tab).split(" ");
      const toplevelName = entry.slice(tab + 1);
      if (meta.length !== 3 || meta[1] !== "blob") continue;
      const rootRel = prefix === "" ? toplevelName : (toplevelName.startsWith(`${prefix}/`) ? toplevelName.slice(prefix.length + 1) : null);
      if (rootRel === null) continue;
      // Record every tree entry whose name matches the declared doc globs;
      // a tree entry is the membership proof, so a path that is listed is
      // not "new" even when its blob later fails to read.
      if (regexes.some((regex) => regex.test(rootRel))) {
        membership.set(toplevelName, { blobSha: meta[2] });
      }
    }
  }
  const gitPathOf = (rel) => (prefix === "" ? rel : `${prefix}/${rel}`);
  const result = [];
  for (const rel of changed) {
    const entry = membership.get(gitPathOf(rel));
    result.push({ rel, knownAtBase: entry !== undefined, blobSha: entry?.blobSha ?? null });
  }
  return out.code === 0 ? result : null;
}
// The flags the merge base already documented in the doc files the diff
// touched, so a row can tell a new promise from an old one it is not being
// blamed for. Only the declared doc globs are read at the base: a comment in
// a code file is not a documentation promise. A path the diff moved into for
// the first time is genuinely new, not a failure. A path the base tree lists
// but whose blob cannot be read is a failure: the caller must fall back to
// the full set rather than judge with a partial view.
async function preExistingFlags(root, baseCommit, changed, globs, pattern, prefix) {
  const flags = new Set();
  const membership = await baseTreeMembership(root, baseCommit, changed, globs, prefix);
  if (membership === null) return { flags, error: true };
  const regexes = (globs ?? []).map(globToRegExp);
  const gitPathOf = (rel) => (prefix === "" ? rel : `${prefix}/${rel}`);
  for (const entry of membership) {
    if (!regexes.some((regex) => regex.test(entry.rel))) continue;
    const gitPath = gitPathOf(entry.rel);
    if (entry.blobSha === null) {
      // Not listed in the base tree: the diff introduced this file, so
      // there is nothing pre-existing to exempt. No blob read is needed.
      continue;
    }
    const atBase = await gitLines(root, ["show", `${baseCommit}:${gitPath}`]);
    if (atBase !== null) {
      for (const match of atBase.matchAll(pattern)) flags.add(match[0]);
      continue;
    }
    // The base tree lists the path but its blob cannot be read: the
    // pre-existing side is only half-known, and half is not enough to
    // downgrade a row to WARN.
    return { flags, error: true };
  }
  return { flags, error: false };
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
        const side = await preExistingFlags(ctx.root, baseCommit, changed, globs, pattern, prefix);
        if (side.error) {
          // One base entry exists but could not be read: the pre-existing
          // view is partial, so the probe keeps the full declared doc set and
          // drops every pre-existing exemption instead of judging half-known.
          preExisting = new Set();
          checkedFiles = docs;
        } else {
          preExisting = side.flags;
        }
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
