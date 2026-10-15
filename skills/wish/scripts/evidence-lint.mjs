// Evidence lint for wish run evidence directories.
// Usage: node <skill-dir>/scripts/evidence-lint.mjs <root> [--repo <path>] [--evidence-root <path>]
// Checks, in order: cited-paths, hex-commits, file-line-citations, comparator-controls, archive-citations.
// Imports are limited to node:fs, node:path, node:url, node:child_process; it writes only stdout.

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
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

// The archive inventory is a listing, not a scan: it descends every directory (the .git and
// node_modules exclusions and the extension filters belong to the live walk) and lists every
// regular file, plus every symbolic link, which is listed as it is and never followed.
function walkArchive(dir) {
  const found = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() || entry.isSymbolicLink()) found.push(full);
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

// The identity of two stats: the same directory entry, whatever spelling or link reached it.
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;

// Containment by filesystem identity, shared by the --evidence-root check and the
// archive-citations check: every prefix of `path`, from the path itself up to the filesystem
// root, is compared with `stat` by (dev, ino). A prefix IS the ancestor directory, so no spelling
// ever decides the answer - a different case, a `./` or `../` segment, a duplicated separator,
// or an aliasing symlink all reach the same directory entry. `path` is taken as given: the caller
// chooses the lexical resolution (path.resolve, which normalizes the spelling textually and never
// follows a symlink) or the physical one (realpathSync).
function hitsIdentity(stat, path) {
  let current = resolve(path);
  for (;;) {
    if (sameFile(statSync(current), stat)) return true;
    const up = dirname(current);
    if (up === current) return false;
    current = up;
  }
}

// The --evidence-root containment test: the scanned root is inside the evidence root when their
// physical paths share a directory entry. realpath does not normalize case on a case-insensitive
// volume, so a shared ancestor spelled with a different case would fail a literal string test
// while being the very same directory; the inode identity does not care.
function isWithin(parentPath, childPath) {
  return hitsIdentity(statSync(realpathSync(parentPath)), realpathSync(childPath));
}

// The archived-copy test: a citation is an archived copy when the archive directory lies on its
// lexical path or on its physical path, and no spelling is compared on either. The lexical walk
// catches every spelling of a path that runs through the archive - a case alias of the scanned
// root or of one of its ancestors, `./` and `../` segments, duplicated separators, or a
// symlinked directory inside the archive that points outside it (the prefix naming the link is
// the archived entry itself, while realpath leaves the archive). The physical walk catches a
// path that reaches the archive through a link somewhere above it.
function citesArchive(archivePath, childPath) {
  const archiveStat = statSync(archivePath);
  return hitsIdentity(archiveStat, childPath) || hitsIdentity(archiveStat, realpathSync(childPath));
}

// The archive entry is the directory entry named exactly "archive" directly under the scanned
// root. The name is read from the directory itself, so a look-alike spelling (Archive, ARCHIVE)
// is not mistaken for it on a case-insensitive volume; look-alike names, nested archive
// directories, and an entry that is a regular file are handled as in base.
function rootArchiveEntry(rootPath) {
  try {
    return readdirSync(rootPath, { withFileTypes: true }).find((entry) => entry.name === ARCHIVE_DIR_NAME) ?? null;
  } catch {
    return null;
  }
}

const splitLines = (text) => text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));

function rootProblem(path, archiveEntry) {
  if (!existsSync(path)) return `missing: ${path}`;
  if (!statSync(path).isDirectory()) return `not a directory: ${path}`;
  // L2b: a symlinked archive entry hides its files from both the SKIP listing and the
  // archive-citations check, so the lint fails closed before any scan. The rejection applies
  // only to the entry named exactly "archive"; a regular file of that name is not an archive
  // and stays ignored, as in base.
  if (archiveEntry !== null && isSymlink(join(path, archiveEntry.name))) {
    return `archive is a symbolic link: ${join(path, archiveEntry.name)}`;
  }
  if (walk(path, MARKDOWN_EXTENSIONS, { skipRootArchive: true }).length === 0) return `no markdown files under: ${path}`;
  return null;
}

const { root, repo, evidenceRoot } = parseArgs(process.argv.slice(2));

const archiveEntry = rootArchiveEntry(root);

const problem = rootProblem(root, archiveEntry);
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
  if (!isWithin(evidenceRoot, root)) {
    console.log(`FAIL root outside evidence root: ${root}`);
    process.exit(1);
  }
}

const archiveDir = archiveEntry !== null && archiveEntry.isDirectory() ? join(root, archiveEntry.name) : null;

const mdFiles = walk(root, MARKDOWN_EXTENSIONS, { skipRootArchive: true });
for (const md of mdFiles) console.log(`SCAN ${relative(root, md)}`);

if (archiveDir !== null) {
  for (const file of walkArchive(archiveDir)) {
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

// The token is resolved the same way for both spellings: path.resolve normalizes `.` and `..`
// segments and duplicated separators textually, so the spelling of a citation never decides
// whether it is seen at all (an absolute token used to be stat-ed as written, which made a `..`
// segment after a component that does not exist unresolvable). Symlinks are not followed here.
function resolveToken(path) {
  if (isAbsolute(path)) {
    const target = resolve(path);
    return isFile(target) ? target : null;
  }
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
  for (const md of mdFiles) {
    for (const { n, text } of numberedLines(md)) {
      for (const token of pathTokens(text)) {
        const resolved = resolveToken(token.path);
        if (resolved === null) continue;
        if (citesArchive(archiveDir, resolved)) {
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
