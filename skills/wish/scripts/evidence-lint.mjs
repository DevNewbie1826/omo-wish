// Evidence lint for wish run evidence directories.
// Usage: node <skill-dir>/scripts/evidence-lint.mjs <root> [--repo <path>] [--evidence-root <path>]
// Checks, in order: cited-paths, hex-commits, file-line-citations, comparator-controls, archive-citations.
// Imports are limited to node:fs, node:path, node:url, node:child_process; it writes only stdout.

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIPPED_DIRS = new Set([".git", "node_modules"]);
const ARCHIVE_DIR_NAME = "archive";
const MARKDOWN_EXTENSIONS = [".md"];
const CAPTURE_EXTENSIONS = [".txt", ".log", ".json", ".jsonl"];
const PATH_EXTENSIONS = [".md", ".txt", ".json", ".jsonl", ".mjs", ".js", ".sh", ".diff", ".png", ".log"];
const PATH_EXCLUSIONS = /[\s<>*$]/;
const BACKTICK_SPAN = /`([^`\n]+)`/g;
const LINE_SUFFIX = /^(.+):(\d+)(?:-(\d+))?$/;
const HEX_RUN = /(?<![0-9A-Za-z])[0-9a-f]{40}(?![0-9A-Za-z])/g;
const QUOTED_FRAGMENT = /^\s*(?:[-\u2014:=]\s*)?"([^"]+)"/;

function usage() {
  process.stderr.write("usage: node <skill-dir>/scripts/evidence-lint.mjs <root> [--repo <path>] [--evidence-root <path>]\n");
  process.exit(2);
}

function parseArgs(argv) {
  let root = null;
  let repo = process.cwd();
  let evidenceRoot = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") {
      if (i + 1 >= argv.length) usage();
      repo = argv[i + 1];
      i += 1;
    } else if (arg === "--evidence-root") {
      if (i + 1 >= argv.length) usage();
      evidenceRoot = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--")) {
      usage();
    } else if (root === null) {
      root = arg;
    } else {
      usage();
    }
  }
  if (root === null) usage();
  return { root, repo, evidenceRoot };
}

function walk(dir, extensions, options = {}) {
  const found = [];
  const stack = [{ path: dir, depth: 0 }];
  while (stack.length > 0) {
    const { path: current, depth } = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (options.skipRootArchive && depth === 0 && entry.name === ARCHIVE_DIR_NAME) continue;
        if (!SKIPPED_DIRS.has(entry.name)) stack.push({ path: full, depth: depth + 1 });
      } else if (entry.isFile() && (options.anyExtension || extensions.some((ext) => entry.name.endsWith(ext)))) {
        found.push(full);
      }
    }
  }
  return found.sort();
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// lstat, so a dangling link counts too: what matters is the entry itself, not its target.
function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// Containment test shared by the --evidence-root check and the archive-citations check.
// Both arguments must already be resolved through realpath.
function isInside(parentReal, childReal) {
  const rel = relative(parentReal, childReal);
  if (rel === "") return true;
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}

// The archive directory is the entry named exactly "archive" directly under the scanned root.
// The name is matched as a directory entry string, so look-alike names (Archive, archived,
// archive-old) and nested archive directories are scanned as before.
function rootArchiveDir(rootPath) {
  try {
    const entry = readdirSync(rootPath, { withFileTypes: true }).find(
      (candidate) => candidate.isDirectory() && candidate.name === ARCHIVE_DIR_NAME,
    );
    return entry ? join(rootPath, entry.name) : null;
  } catch {
    return null;
  }
}

const splitLines = (text) => text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));

function rootProblem(path) {
  if (!existsSync(path)) return `missing: ${path}`;
  if (!statSync(path).isDirectory()) return `not a directory: ${path}`;
  // L2b: a symlinked archive entry hides its files from both the SKIP listing and the
  // archive-citations check, so the lint fails closed before any scan. A regular file named
  // archive is not an archive and stays ignored, as in base.
  const archive = join(path, ARCHIVE_DIR_NAME);
  if (isSymlink(archive)) return `archive is a symbolic link: ${archive}`;
  if (walk(path, MARKDOWN_EXTENSIONS, { skipRootArchive: true }).length === 0) return `no markdown files under: ${path}`;
  return null;
}

const { root, repo, evidenceRoot } = parseArgs(process.argv.slice(2));

const problem = rootProblem(root);
if (problem !== null) {
  console.log(`FAIL root ${problem}`);
  process.exit(1);
}

if (evidenceRoot !== null) {
  if (!existsSync(evidenceRoot)) {
    console.log(`FAIL root evidence root missing: ${evidenceRoot}`);
    process.exit(1);
  }
  if (!isDirectory(evidenceRoot)) {
    console.log(`FAIL root evidence root not a directory: ${evidenceRoot}`);
    process.exit(1);
  }
  if (!isInside(realpathSync(evidenceRoot), realpathSync(root))) {
    console.log(`FAIL root outside evidence root: ${root}`);
    process.exit(1);
  }
}

const archiveDir = rootArchiveDir(root);

const mdFiles = walk(root, MARKDOWN_EXTENSIONS, { skipRootArchive: true });
for (const md of mdFiles) console.log(`SCAN ${relative(root, md)}`);

if (archiveDir !== null) {
  for (const file of walk(archiveDir, [], { anyExtension: true })) {
    console.log(`SKIP ${relative(root, file)}`);
  }
}

const mdLines = new Map();
for (const md of mdFiles) mdLines.set(md, splitLines(readFileSync(md, "utf8")));

const display = (md) => relative(root, md);
const numberedLines = (md) => mdLines.get(md).map((text, index) => ({ n: index + 1, text }));

function pathTokens(lineText) {
  const tokens = [];
  for (const span of lineText.matchAll(BACKTICK_SPAN)) {
    const content = span[1];
    if (PATH_EXCLUSIONS.test(content)) continue;
    if (content.includes("://")) continue;
    if (!content.includes("/")) continue;
    const suffix = content.match(LINE_SUFFIX);
    const path = suffix ? suffix[1] : content;
    if (path.includes(":")) continue;
    if (!PATH_EXTENSIONS.some((ext) => path.endsWith(ext))) continue;
    tokens.push({
      raw: content,
      path,
      from: suffix ? Number(suffix[2]) : null,
      to: suffix ? Number(suffix[3] ?? suffix[2]) : null,
      after: lineText.slice(span.index + span[0].length),
    });
  }
  return tokens;
}

function resolveToken(path) {
  if (isAbsolute(path)) return isFile(path) ? path : null;
  for (const base of [root, repo, SKILL_DIR]) {
    const candidate = resolve(base, path);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function checkCitedPaths() {
  const findings = [];
  for (const md of mdFiles) {
    for (const { n, text } of numberedLines(md)) {
      for (const token of pathTokens(text)) {
        if (resolveToken(token.path) === null) {
          findings.push(`FAIL cited-paths ${display(md)}:${n} unresolved path: ${token.path}`);
        }
      }
    }
  }
  return findings;
}

function checkHexCommits() {
  const findings = [];
  const captured = new Set();
  for (const capture of walk(root, CAPTURE_EXTENSIONS, { skipRootArchive: true })) {
    for (const run of readFileSync(capture, "utf8").matchAll(HEX_RUN)) captured.add(run[0]);
  }
  for (const md of mdFiles) {
    for (const { n, text } of numberedLines(md)) {
      for (const run of text.matchAll(HEX_RUN)) {
        const hex = run[0];
        const type = spawnSync("git", ["-C", repo, "cat-file", "-t", hex], { encoding: "utf8" });
        const problems = [];
        if (type.error || type.status !== 0) problems.push("not an object in the repo");
        else if (type.stdout.trim() !== "commit") problems.push(`not a commit (${type.stdout.trim()})`);
        if (!captured.has(hex)) problems.push("absent from captures");
        if (problems.length > 0) {
          findings.push(`FAIL hex-commits ${display(md)}:${n} ${hex}: ${problems.join("; ")}`);
        }
      }
    }
  }
  return findings;
}

function checkFileLineCitations() {
  const findings = [];
  for (const md of mdFiles) {
    for (const { n, text } of numberedLines(md)) {
      for (const token of pathTokens(text)) {
        if (token.from === null) continue;
        const resolved = resolveToken(token.path);
        if (resolved === null) continue;
        const cited = splitLines(readFileSync(resolved, "utf8"));
        const last = cited.length;
        if (!(token.from >= 1 && token.from <= token.to && token.to <= last)) {
          findings.push(`FAIL file-line-citations ${display(md)}:${n} ${token.raw} outside 1-${last} of ${token.path}`);
          continue;
        }
        const range = cited.slice(token.from - 1, token.to);
        const quoted = token.after.match(QUOTED_FRAGMENT);
        if (quoted) {
          if (!range.join(" ").includes(quoted[1])) {
            findings.push(`FAIL file-line-citations ${display(md)}:${n} quoted fragment missing from ${token.path}:${token.from}-${token.to}: ${JSON.stringify(quoted[1])}`);
          }
        } else if (!range.some((line) => line.trim() !== "")) {
          findings.push(`FAIL file-line-citations ${display(md)}:${n} cited lines hold no text: ${token.path}:${token.from}-${token.to}`);
        }
      }
    }
  }
  return findings;
}

function checkComparatorControls() {
  const findings = [];
  for (const md of mdFiles) {
    for (const { n, text } of numberedLines(md)) {
      for (const token of pathTokens(text)) {
        const name = basename(token.path);
        if (!name.startsWith("qa-") || !name.endsWith(".txt") || name.includes("control")) continue;
        const resolved = resolveToken(token.path);
        if (resolved === null) continue;
        const control = join(dirname(resolved), `${name.slice(0, -".txt".length)}-control.txt`);
        if (!isFile(control)) {
          findings.push(`FAIL comparator-controls ${display(md)}:${n} missing control sibling: ${token.path}`);
          continue;
        }
        const first = splitLines(readFileSync(control, "utf8"))[0];
        if (first !== "VERDICT: FAIL") {
          findings.push(`FAIL comparator-controls ${display(md)}:${n} control first line is ${JSON.stringify(first)}: ${token.path}`);
        }
      }
    }
  }
  return findings;
}

function checkArchiveCitations() {
  const findings = [];
  if (archiveDir === null) return findings;
  const archiveReal = realpathSync(archiveDir);
  for (const md of mdFiles) {
    for (const { n, text } of numberedLines(md)) {
      for (const token of pathTokens(text)) {
        const resolved = resolveToken(token.path);
        if (resolved === null) continue;
        if (isInside(archiveReal, realpathSync(resolved))) {
          findings.push(`FAIL archive-citations ${display(md)}:${n} cites an archived copy: ${token.path}`);
        }
      }
    }
  }
  return findings;
}

const findings = [
  ...checkCitedPaths(),
  ...checkHexCommits(),
  ...checkFileLineCitations(),
  ...checkComparatorControls(),
  ...checkArchiveCitations(),
];

if (findings.length > 0) {
  for (const finding of findings) console.log(finding);
  console.log(`FAIL evidence-lint ${findings.length} finding(s)`);
  process.exitCode = 1;
} else {
  console.log("PASS evidence-lint");
  process.exitCode = 0;
}
