#!/usr/bin/env node
// wish v2 — module M4: may a lane's receipt still be reused at this head?
//
// `references/ledger.md` §2/§14 and design §2.7 fix the rule:
//
//   (i)  the receipt's tree is the current tree                  -> VALID
//   (ii) otherwise, the changed paths (`git diff --name-only <receipt.head>..<head>`,
//        plus the base move's paths) and the changed files' referrers (the session's
//        `lsp_find_references` result, passed as --referrers) are intersected with the
//        receipt's scope; an empty intersection means the lane's ground did not move
//        -> VALID with the reason recorded, otherwise -> STALE and the lane re-runs.
//
// The several kinds keep their own anchor instead of a git tree:
//   - a `before` receipt is exempt: a pre-edit capture is deliberately old (§3, A §B3)
//   - a `research` receipt compares the frozen artifact sha256 carried in `head`
//   - a `design` receipt also carries `env_sha`, the surface/build artifact hash, so a
//     rebuilt surface makes it STALE (A §F M4)
//
// Receipts are read as JSON, or as the same object in flat YAML front matter for an
// `.md` report (§4.2). Every receipt is validated against M0's schema and against its
// own filename anchor before any reuse decision, so a malformed or foreign receipt
// can never come back VALID.
//
// Exit codes (§14): 0 VALID, 1 STALE, 2 usage, 3 unparseable or another run's receipt.

import { readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_CODES, validateReceipt, validateReceiptAgainstFilename } from "./lib/schema.mjs";

const USAGE = [
  "usage: reuse-check.mjs <receipt.json|receipt.md> --head <sha> [options]",
  "",
  "  --head <sha>              the head to judge against: a full 40-hex commit, or the",
  "                            64-hex artifact sha256 of a research receipt",
  "  --tree <id>               the tree of that head (default: git rev-parse <head>^{tree})",
  "  --repo <dir>              repository the git facts come from (default: cwd)",
  "  --referrers <file>        JSON array of files that import the changed files",
  "                            (the session's lsp_find_references result)",
  "  --base-impact <old>..<new>  paths the base move touched",
  "  --env-sha <64-hex>        current surface/build artifact hash for a design receipt",
  "  --unit <id>               treat a receipt from another unit as foreign (exit 3)",
  "  --evidence-root <dir>     treat a receipt outside this run's evidence root as foreign",
  "  --help                    print this usage",
  "",
  "Prints `VALID <reason>` (exit 0) or `STALE <reason>` (exit 1). Usage is exit 2; an",
  "unreadable, invalid or foreign receipt, or a git fact that cannot be computed, is",
  "exit 3. A `before` receipt is never STALE.",
].join("\n");

const HEAD40 = /^[0-9a-f]{40}$/;
const HEAD64 = /^[0-9a-f]{64}$/;
const TREE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_LISTED = 8;

function firstLine(text, limit = 200) {
  const line = String(text ?? "").split("\n").map((entry) => entry.trim()).find((entry) => entry !== "") ?? "";
  const clipped = line.length > limit ? `${line.slice(0, limit)}...` : line;
  return clipped.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "?");
}

function short(value) {
  return typeof value === "string" ? value.slice(0, 7) : "null";
}

// Only the first seven characters of a caller-supplied id reach the output, so a
// value pasted into the wrong flag is never echoed back in full.
function redact(text, values) {
  let out = String(text ?? "");
  for (const value of values) {
    if (typeof value === "string" && value.length > 7) out = out.split(value).join(value.slice(0, 7));
  }
  return out;
}

function runGit(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) {
    return { ok: false, status: null, stdout: "", stderr: String(result.error.code ?? "spawn failed") };
  }
  return { ok: result.status === 0, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function isRevision(value) {
  return typeof value === "string" && value.length > 0 && !/^[-\s]/.test(value) && !/[\s\x00]/.test(value);
}

// ---------------------------------------------------------------- front matter

// The `.md` receipt is "the same object in YAML front matter" (§4.2). This reads the
// flat subset a receipt needs — `key: scalar`, `key: null`, `key: [a, b]`, `key: []`
// — and refuses anything else instead of guessing.
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*):(?:[ \t]+(.*))?$/;

function unquote(raw, lineNumber) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) throw new Error(`front matter line ${lineNumber} has an unterminated quote`);
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`front matter line ${lineNumber} has an invalid quoted value`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) throw new Error(`front matter line ${lineNumber} has an unterminated quote`);
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function splitList(inner, lineNumber) {
  const items = [];
  let current = "";
  let quote = null;
  for (const character of inner) {
    if (quote !== null) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === ",") {
      items.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (quote !== null) throw new Error(`front matter line ${lineNumber} has an unterminated quote`);
  items.push(current);
  return items.map((item) => unquote(item, lineNumber));
}

export function parseFrontMatter(text) {
  const lines = String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] !== "---") throw new Error("a markdown receipt must open with a --- front matter line");
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new Error("the front matter is not closed by a --- line");
  const value = {};
  for (let index = 1; index < end; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const match = KEY_LINE.exec(line);
    if (!match) throw new Error(`front matter line ${index + 1} is not a flat key: value pair`);
    const key = match[1];
    if (Object.hasOwn(value, key)) throw new Error(`front matter repeats ${key}`);
    const raw = (match[2] ?? "").trim();
    if (raw === "") throw new Error(`front matter line ${index + 1} is outside the flat key: value subset (no inline value)`);
    if (raw === "null" || raw === "~") {
      value[key] = null;
    } else if (raw.startsWith("[")) {
      if (!raw.endsWith("]")) throw new Error(`front matter line ${index + 1} has an unterminated list`);
      const inner = raw.slice(1, -1).trim();
      value[key] = inner === "" ? [] : splitList(inner, index + 1);
    } else if (raw.startsWith("- ") || raw.startsWith("{") || raw.startsWith("|") || raw.startsWith(">")) {
      throw new Error(`front matter line ${index + 1} is outside the flat key: value subset`);
    } else {
      value[key] = unquote(raw, index + 1);
    }
  }
  return value;
}

// ---------------------------------------------------------------------- scope

function escapeRegex(character) {
  return /[.*+?^${}()|[\]\\]/.test(character) ? `\\${character}` : character;
}

export function globToRegExp(glob) {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*") {
      if (glob[index + 1] === "*") {
        index += 1;
        if (glob[index + 1] === "/") {
          index += 1;
          pattern += "(?:.*/)?";
        } else {
          pattern += ".*";
        }
      } else {
        pattern += "[^/]*";
      }
    } else if (character === "?") {
      pattern += "[^/]";
    } else {
      pattern += escapeRegex(character);
    }
  }
  return new RegExp(`^${pattern}$`);
}

export function normalizePath(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

// A scope entry is a path or a glob (§4). A plain path also covers everything under
// it, so `src/foo` covers `src/foo/bar.ts` but never `src/foobar.ts`.
export function scopeMatches(path, entry) {
  const candidate = normalizePath(path);
  const scope = normalizePath(entry).replace(/\/+$/, "");
  if (scope === "") return false;
  if (!/[*?[]/.test(scope)) {
    return candidate === scope || candidate.startsWith(`${scope}/`);
  }
  return globToRegExp(scope).test(candidate);
}

export function scopeHits(paths, scope) {
  const hits = new Set();
  for (const path of paths) {
    if (scope.some((entry) => scopeMatches(path, entry))) hits.add(normalizePath(path));
  }
  return [...hits].sort();
}

function list(values) {
  if (values.length <= MAX_LISTED) return values.join(", ");
  return `${values.slice(0, MAX_LISTED).join(", ")} (+${values.length - MAX_LISTED} more)`;
}

// A mixed run takes its primary type's identity form (ledger §2): a research primary
// carries the artifact sha256 in `head` and no git tree, even when the work is mixed.
function identityType(receipt) {
  return receipt.type === "mixed" ? receipt.primary : receipt.type;
}

// ------------------------------------------------------------------- decision

export function decideReuse({ receipt, head, tree, changed = [], referrers, envSha }) {
  if (receipt.kind === "before") {
    return { verdict: "VALID", reason: "a before receipt is exempt: a pre-edit capture is deliberately old" };
  }
  if (identityType(receipt) === "research") {
    const same = String(receipt.head).toLowerCase() === String(head).toLowerCase();
    return same
      ? { verdict: "VALID", reason: `artifact sha256 ${short(head)} unchanged` }
      : { verdict: "STALE", reason: `artifact sha256 changed: ${short(receipt.head)} -> ${short(head)}` };
  }
  if (receipt.env_sha !== undefined && receipt.env_sha !== null) {
    if (envSha === undefined || envSha === null) {
      return {
        verdict: "STALE",
        reason: `the receipt is bound to surface artifact ${short(receipt.env_sha)}; pass --env-sha to verify it`,
      };
    }
    if (String(envSha).toLowerCase() !== receipt.env_sha) {
      return {
        verdict: "STALE",
        reason: `surface artifact changed: ${short(receipt.env_sha)} -> ${short(String(envSha).toLowerCase())}`,
      };
    }
  }
  if (receipt.tree === tree) {
    return { verdict: "VALID", reason: `tree ${short(tree)} unchanged` };
  }
  const changedHits = scopeHits(changed, receipt.scope);
  if (changedHits.length > 0) {
    return { verdict: "STALE", reason: `changed files inside scope: ${list(changedHits)}` };
  }
  const referrerHits = scopeHits(referrers ?? [], receipt.scope);
  if (referrerHits.length > 0) {
    return {
      verdict: "STALE",
      reason: `changed files are referenced by files inside scope: ${list(referrerHits)}`,
    };
  }
  const referrerNote = referrers === undefined ? "no referrer list supplied" : `${referrers.length} referrers checked`;
  return {
    verdict: "VALID",
    reason: `no changed file falls inside scope (${changed.length} changed paths, ${referrerNote})`,
  };
}

// ---------------------------------------------------------------------- input

export function parseArgs(argv) {
  const options = { help: false, positional: [] };
  const flags = [
    "--head", "--tree", "--repo", "--referrers", "--base-impact",
    "--env-sha", "--unit", "--evidence-root",
  ];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (flags.includes(argument)) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} needs a value`);
      if (value.startsWith("-")) throw new Error(`${argument} needs a value, not the flag ${value}`);
      options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new Error(`unknown argument: ${argument}`);
    } else {
      options.positional.push(argument);
    }
  }
  return options;
}

function validateOptions(options) {
  if (options.positional.length !== 1) throw new Error("expected exactly one receipt path");
  const receiptPath = options.positional[0];
  if (options.head === undefined) throw new Error("missing --head");
  const head = options.head.toLowerCase();
  if (!HEAD40.test(head) && !HEAD64.test(head)) {
    throw new Error("--head must be a full 40-hex commit SHA or a 64-hex artifact sha256");
  }
  let tree = options.tree;
  if (tree !== undefined) {
    tree = tree.toLowerCase();
    if (!TREE.test(tree)) throw new Error("--tree must be a 40- or 64-hex tree id");
  }
  let envSha = options.envSha;
  if (envSha !== undefined) {
    envSha = envSha.toLowerCase();
    if (!HEAD64.test(envSha)) throw new Error("--env-sha must be a 64-hex sha256");
  }
  let baseImpact;
  if (options.baseImpact !== undefined) {
    const parts = options.baseImpact.split("..");
    if (parts.length !== 2 || !parts.every((entry) => isRevision(entry))) {
      throw new Error("--base-impact expects <old-base>..<new-base>");
    }
    baseImpact = { from: parts[0], to: parts[1] };
  }
  return {
    receiptPath,
    head,
    tree,
    envSha,
    baseImpact,
    repo: options.repo === undefined ? process.cwd() : options.repo,
    referrersPath: options.referrers,
    unit: options.unit,
    evidenceRoot: options.evidenceRoot,
  };
}

function readReceiptFile(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read the receipt: ${error.code ?? "read failed"}`);
  }
  if (path.endsWith(".md")) return { value: parseFrontMatter(raw), name: basename(path) };
  try {
    return { value: JSON.parse(raw), name: basename(path) };
  } catch {
    throw new Error("the receipt is not valid JSON");
  }
}

function readReferrers(path, repo) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read the referrer list: ${error.code ?? "read failed"}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("the referrer list is not valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string" || entry === "")) {
    throw new Error("the referrer list must be a JSON array of non-empty paths");
  }
  return parsed.map((entry) => repoRelative(repo, entry));
}

function repoRelative(repo, path) {
  const normalized = normalizePath(path);
  if (!isAbsolute(path)) return normalized;
  const rel = relative(resolve(repo), resolve(path));
  return rel === "" || rel.startsWith("..") ? normalized : normalizePath(rel);
}

function inside(root, file) {
  let rootPath;
  try {
    rootPath = realpathSync(resolve(root));
  } catch {
    throw new Error("the evidence root does not exist");
  }
  const filePath = realpathSync(resolve(file));
  const rel = relative(rootPath, filePath);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function treeOf(repo, head) {
  const result = runGit(repo, ["rev-parse", "--verify", `${head}^{tree}`]);
  if (!result.ok) return { ok: false, reason: `cannot resolve the tree of ${short(head)}: ${firstLine(redact(result.stderr, [head]))}` };
  const tree = result.stdout.trim();
  if (!TREE.test(tree)) return { ok: false, reason: `git printed no tree id for ${short(head)}` };
  return { ok: true, tree };
}

function changedFiles(repo, from, to) {
  // `-z` keeps git from quoting a path (a non-ASCII name would otherwise arrive as
  // "src-\355\225..." and never match a scope entry).
  const result = runGit(repo, ["diff", "--name-only", "-z", "--no-renames", `${from}..${to}`]);
  if (!result.ok) {
    return { ok: false, reason: `cannot diff ${short(from)}..${short(to)}: ${firstLine(redact(result.stderr, [from, to]))}` };
  }
  const files = result.stdout.split("\x00").filter((entry) => entry !== "");
  return { ok: true, files };
}

function main(argv) {
  let options;
  try {
    const parsed = parseArgs(argv);
    if (parsed.help) {
      console.log(USAGE);
      return EXIT_CODES.OK;
    }
    options = validateOptions(parsed);
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    return EXIT_CODES.USAGE;
  }

  let receipt;
  try {
    receipt = readReceiptFile(options.receiptPath);
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    return EXIT_CODES.STATE_MISMATCH;
  }

  const schema = validateReceipt(receipt.value);
  if (!schema.ok) {
    const [first] = schema.errors;
    console.error(`FAIL the receipt does not match the M0 contract: ${first.path} ${first.message}`);
    return EXIT_CODES.STATE_MISMATCH;
  }
  const anchor = validateReceiptAgainstFilename(receipt.value, receipt.name);
  if (!anchor.ok) {
    const [first] = anchor.errors;
    console.error(`FAIL the receipt filename disagrees with its body: ${first.path} ${first.message}`);
    return EXIT_CODES.STATE_MISMATCH;
  }

  const isResearch = identityType(receipt.value) === "research";
  if (isResearch && !HEAD64.test(options.head)) {
    console.error("FAIL a research receipt compares a 64-hex artifact sha256, not a commit SHA");
    return EXIT_CODES.USAGE;
  }
  if (!isResearch && !HEAD40.test(options.head)) {
    console.error("FAIL a commit receipt compares a full 40-hex commit SHA");
    return EXIT_CODES.USAGE;
  }
  if (options.unit !== undefined && options.unit !== receipt.value.unit) {
    console.error(`FAIL the receipt belongs to unit ${receipt.value.unit}, not ${options.unit}`);
    return EXIT_CODES.STATE_MISMATCH;
  }
  if (options.evidenceRoot !== undefined) {
    let contained;
    try {
      contained = inside(options.evidenceRoot, options.receiptPath);
    } catch (error) {
      console.error(`FAIL ${error.message}`);
      return EXIT_CODES.STATE_MISMATCH;
    }
    if (!contained) {
      console.error("FAIL the receipt is outside this run's evidence root");
      return EXIT_CODES.STATE_MISMATCH;
    }
  }

  let referrers;
  if (options.referrersPath !== undefined) {
    try {
      referrers = readReferrers(options.referrersPath, options.repo);
    } catch (error) {
      console.error(`FAIL ${error.message}`);
      return EXIT_CODES.STATE_MISMATCH;
    }
  }

  let tree = options.tree;
  let changed = [];
  // A before receipt is exempt, and its pre-edit head may be gone (squashed or
  // rebased away), so it never asks git for a fact it does not use.
  if (!isResearch && receipt.value.kind !== "before") {
    if (tree === undefined) {
      const resolved = treeOf(options.repo, options.head);
      if (!resolved.ok) {
        console.error(`FAIL ${resolved.reason}`);
        return EXIT_CODES.STATE_MISMATCH;
      }
      tree = resolved.tree;
    }
    if (tree !== receipt.value.tree) {
      const diff = changedFiles(options.repo, receipt.value.head, options.head);
      if (!diff.ok) {
        console.error(`FAIL ${diff.reason}`);
        return EXIT_CODES.STATE_MISMATCH;
      }
      changed = diff.files;
      if (options.baseImpact !== undefined) {
        const base = changedFiles(options.repo, options.baseImpact.from, options.baseImpact.to);
        if (!base.ok) {
          console.error(`FAIL ${base.reason}`);
          return EXIT_CODES.STATE_MISMATCH;
        }
        changed = [...new Set([...changed, ...base.files])].sort();
      }
    }
  }

  const decision = decideReuse({
    receipt: receipt.value,
    head: options.head,
    tree,
    changed,
    referrers,
    envSha: options.envSha,
  });
  if (decision.verdict === "VALID") {
    console.log(`VALID ${decision.reason}`);
    return EXIT_CODES.OK;
  }
  console.log(`STALE ${decision.reason}`);
  return EXIT_CODES.CHECK_FAILED;
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