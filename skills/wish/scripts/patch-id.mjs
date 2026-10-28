#!/usr/bin/env node
// wish v2 — module M4: is the patch a verdict covers still the patch under review?
//
// A verdict covers a patch, not a commit: `references/ledger.md` §2 defines the
// `patch_id`, and `playbooks/revise.md` step 9 (FINAL REVIEW, NEW REVIEWER) is the
// step a changed patch takes. When the head moved only by a rebase, the command
// below decides it —
//
//   git diff <old-base>...<verdict-head> | git patch-id --verbatim
//   git diff <new-base>...<new-head>    | git patch-id --verbatim
//
// `--verbatim` hashes whitespace, so a whitespace change counts as a change. Equal
// ids keep the verdict; unequal ids mean the patch changed and it gets the delta
// review, whose input is the difference between the two base-to-head diffs
// (`--interdiff <path>` writes exactly that).
//
// The two diffs are taken with fixed prefixes, no external driver, no textconv and
// no color, so a clone's `diff.noprefix` or a textconv filter cannot change the id.
//
// Exit codes: 0 SAME, 1 DIFFERENT, 2 usage, 3 cannot compute (bad revision, git
// failure, or an empty patch — there is nothing to compare).

import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_CODES } from "./lib/schema.mjs";

const USAGE = [
  "usage: patch-id.mjs --old-base <rev> --verdict-head <rev> --new-base <rev> --new-head <rev>",
  "                     [--repo <dir>] [--interdiff <path>] [--help]",
  "",
  "Prints `SAME <patch-id>` (exit 0) or `DIFFERENT <old-id> <new-id>` (exit 1).",
  "Exit 2 is usage; exit 3 means a patch or a git fact could not be computed.",
].join("\n");

const PATCH_ID = /^[0-9a-f]{40}$/;

// A revision reaches git as one argv element, never through a shell. Rejecting a
// leading dash keeps it from being read as an option, and whitespace can only be a
// caller mistake.
export function isRevision(value) {
  return typeof value === "string" && value.length > 0 && !/^[-\s]/.test(value) && !/[\s\x00]/.test(value);
}

function firstLine(text, limit = 200) {
  const line = String(text ?? "").split("\n").map((entry) => entry.trim()).find((entry) => entry !== "") ?? "";
  const clipped = line.length > limit ? `${line.slice(0, limit)}...` : line;
  return clipped.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "?");
}

// Only the first seven characters of a caller-supplied revision reach the output,
// so a value pasted into the wrong flag is never echoed back in full.
function redact(text, values) {
  let out = String(text ?? "");
  for (const value of values) {
    if (typeof value === "string" && value.length > 7) out = out.split(value).join(value.slice(0, 7));
  }
  return out;
}

function runGit(repo, args, { input } = {}) {
  const result = spawnSync("git", ["-C", repo, ...args], {
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    return { ok: false, status: null, stdout: "", stderr: String(result.error.code ?? "spawn failed") };
  }
  return { ok: result.status === 0, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const DIFF_FLAGS = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

// The base-to-head diff and its verbatim patch id. `diff` is kept so the caller can
// compute the interdiff without running git twice.
export function patchIdFor({ repo, base, head }) {
  const diff = runGit(repo, ["diff", ...DIFF_FLAGS, `${base}...${head}`]);
  if (!diff.ok) {
    return { ok: false, reason: `cannot diff ${base.slice(0, 7)}...${head.slice(0, 7)}: ${firstLine(redact(diff.stderr, [base, head]))}` };
  }
  if (diff.stdout.trim() === "") {
    return { ok: false, reason: `empty patch: ${base}...${head} has no changes to compare` };
  }
  const hashed = patchIdOfDiff(diff.stdout, repo);
  if (!hashed.ok) return hashed;
  return { ok: true, patchId: hashed.patchId, diff: diff.stdout };
}

// The id of a patch whose text is supplied directly (used by callers that already
// hold the diff, e.g. a lane comparing its own captured patch).
export function patchIdOfDiff(diffText, repo = process.cwd()) {
  const hashed = runGit(repo, ["patch-id", "--verbatim"], { input: String(diffText ?? "") });
  if (!hashed.ok) return { ok: false, reason: `git patch-id failed: ${firstLine(hashed.stderr)}` };
  const [patchId] = hashed.stdout.trim().split(/\s+/);
  if (!PATCH_ID.test(patchId ?? "")) return { ok: false, reason: "git patch-id printed no patch id" };
  return { ok: true, patchId };
}

export function comparePatchIds({ repo, oldBase, oldHead, newBase, newHead, interdiffPath }) {
  const oldSide = patchIdFor({ repo, base: oldBase, head: oldHead });
  if (!oldSide.ok) return { ok: false, reason: `old: ${oldSide.reason}` };
  const newSide = patchIdFor({ repo, base: newBase, head: newHead });
  if (!newSide.ok) return { ok: false, reason: `new: ${newSide.reason}` };
  const same = oldSide.patchId === newSide.patchId;
  const result = { ok: true, same, old: oldSide, new: newSide };
  if (interdiffPath !== undefined) {
    const written = writeInterdiff(oldSide.diff, newSide.diff, interdiffPath);
    if (!written.ok) return { ok: false, reason: written.reason };
    result.interdiffPath = written.path;
    result.interdiffBytes = written.bytes;
  }
  return result;
}

// The difference between the two base-to-head diffs: a patch of the two patches.
// Both are written under fixed names inside a private temp dir, so the emitted
// headers (`a/old.patch`, `b/new.patch`) are stable and no temp path leaks out.
export function writeInterdiff(oldDiff, newDiff, target) {
  let directory;
  try {
    directory = mkdtempSync(join(tmpdir(), "wish-patch-id-"));
  } catch (error) {
    return { ok: false, reason: `cannot create the interdiff workspace: ${error.code ?? "mkdir failed"}` };
  }
  try {
    try {
      writeFileSync(join(directory, "old.patch"), oldDiff);
      writeFileSync(join(directory, "new.patch"), newDiff);
    } catch (error) {
      return { ok: false, reason: `cannot write the interdiff workspace: ${error.code ?? "write failed"}` };
    }
    const compared = runGit(directory, ["diff", "--no-color", "--no-ext-diff", "--no-index", "--", "old.patch", "new.patch"]);
    if (!compared.ok && compared.status !== 1) {
      return { ok: false, reason: `cannot build the interdiff: ${firstLine(compared.stderr)}` };
    }
    try {
      writeFileSync(target, compared.stdout);
    } catch (error) {
      return { ok: false, reason: `cannot write the interdiff: ${error.code ?? "write failed"}` };
    }
    return { ok: true, path: resolve(target), bytes: Buffer.byteLength(compared.stdout) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function parseArgs(argv) {
  const options = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (["--old-base", "--verdict-head", "--new-base", "--new-head", "--repo", "--interdiff"].includes(argument)) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} needs a value`);
      if (value.startsWith("-")) throw new Error(`${argument} needs a value, not the flag ${value}`);
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

function validateOptions(options) {
  for (const flag of ["old-base", "verdict-head", "new-base", "new-head"]) {
    const value = options[flag];
    if (value === undefined) throw new Error(`${USAGE.split("\n")[0]}\nmissing --${flag}`);
    if (!isRevision(value)) throw new Error(`--${flag} is not a revision (no leading dash, no whitespace)`);
  }
  return {
    repo: options.repo === undefined ? process.cwd() : options.repo,
    oldBase: options["old-base"],
    oldHead: options["verdict-head"],
    newBase: options["new-base"],
    newHead: options["new-head"],
    interdiffPath: options.interdiff,
  };
}

function main(argv) {
  let options;
  let input;
  try {
    options = parseArgs(argv);
    if (options.help) {
      console.log(USAGE);
      return EXIT_CODES.OK;
    }
    input = validateOptions(options);
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    return EXIT_CODES.USAGE;
  }
  const result = comparePatchIds(input);
  if (!result.ok) {
    console.error(`FAIL ${result.reason}`);
    return EXIT_CODES.STATE_MISMATCH;
  }
  if (result.same) {
    console.log(`SAME ${result.old.patchId}`);
  } else {
    console.log(`DIFFERENT ${result.old.patchId} ${result.new.patchId}`);
  }
  if (result.interdiffPath !== undefined) {
    console.log(`INTERDIFF ${result.interdiffPath} ${result.interdiffBytes} bytes`);
  }
  return result.same ? EXIT_CODES.OK : EXIT_CODES.CHECK_FAILED;
}

function invokedDirectly() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (invokedDirectly()) process.exitCode = main(process.argv.slice(2));