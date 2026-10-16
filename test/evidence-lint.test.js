import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lint = process.env.EVIDENCE_LINT || join(repo, "skills/wish/scripts/evidence-lint.mjs");
const fixtures = [];

afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

function sh(cwd, argv) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, encoding: "utf8" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${argv.join(" ")} exited ${r.status}: ${r.stderr}`);
  return r.stdout.trim();
}

const gitRepo = mkdtempSync(join(tmpdir(), "evidence-lint-repo-"));
fixtures.push(gitRepo);
sh(gitRepo, ["git", "init", "-q"]);
sh(gitRepo, ["git", "config", "user.email", "lint@example.invalid"]);
sh(gitRepo, ["git", "config", "user.name", "evidence lint test"]);
writeFileSync(join(gitRepo, "committed.txt"), "committed\n");
sh(gitRepo, ["git", "add", "committed.txt"]);
sh(gitRepo, ["git", "commit", "-q", "-m", "init"]);
const commitHex = sh(gitRepo, ["git", "rev-parse", "HEAD"]);
const blobHex = sh(gitRepo, ["git", "hash-object", "-w", "committed.txt"]);
sh(gitRepo, ["git", "commit", "-q", "--allow-empty", "-m", "second"]);
const uncapturedCommitHex = sh(gitRepo, ["git", "rev-parse", "HEAD"]);

const tick = (text) => "`" + text + "`";

function makeRoot(prefix = "evidence-lint-root-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtures.push(dir);
  return dir;
}

function reportBody(root) {
  return [
    "# fixture report",
    "",
    "- relative path: " + tick("captures/run.txt"),
    "- absolute path: " + tick(join(root, "captures", "run.txt")),
    "- skill path: " + tick("references/planning.md"),
    "- commit: " + tick(commitHex),
    "- bare citation: " + tick("captures/run.txt:1"),
    "- quoted citation: " + tick("captures/run.txt:1") + ' "commit"',
    "- range citation: " + tick("captures/run.txt:1-2") + ' "EXIT=0"',
    "- comparator: " + tick("captures/qa-1.txt"),
    "",
  ];
}

function cleanRoot() {
  const root = makeRoot();
  mkdirSync(join(root, "captures"));
  mkdirSync(join(root, "notes"));
  writeFileSync(join(root, "captures", "run.txt"), `commit ${commitHex}\nEXIT=0\n`);
  writeFileSync(join(root, "captures", "qa-1.txt"), "VERDICT: PASS\n");
  writeFileSync(join(root, "captures", "qa-1-control.txt"), "VERDICT: FAIL\nEXIT=1\n");
  writeFileSync(join(root, "report.md"), reportBody(root).join("\n"));
  writeFileSync(
    join(root, "notes", "extra.md"),
    ["# notes", "", "- capture: " + tick("captures/run.txt"), ""].join("\n"),
  );
  return root;
}

function reportLines(root) {
  return readFileSync(join(root, "report.md"), "utf8").split("\n");
}

function citationLine(root, token) {
  return reportLines(root).findIndex((text) => text.includes(tick(token))) + 1;
}

function appendReport(root, line) {
  const number = reportLines(root).length;
  writeFileSync(join(root, "report.md"), reportLines(root).join("\n") + line + "\n");
  return number;
}

function run(root) {
  const r = spawnSync("node", [lint, root, "--repo", gitRepo], { encoding: "utf8" });
  if (r.error) throw r.error;
  return r;
}

const lastLine = (r) => r.stdout.trimEnd().split("\n").at(-1);

test("fixture: a clean root using every pinned form passes with one SCAN line per markdown file", () => {
  const r = run(cleanRoot());
  expect(r.status).toBe(0);
  expect(r.stderr).toBe("");
  const lines = r.stdout.trimEnd().split("\n");
  expect(lines.filter((line) => line.startsWith("SCAN "))).toEqual([
    "SCAN notes/extra.md",
    "SCAN report.md",
  ]);
  expect(lastLine(r)).toBe("PASS evidence-lint");
});

test("control: 1 a cited path that does not exist is a cited-paths finding", () => {
  const root = cleanRoot();
  const line = appendReport(root, "- missing: " + tick("captures/nope.txt"));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(`FAIL cited-paths report.md:${line}`);
  expect(r.stdout).toContain("captures/nope.txt");
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

test("control: 2a a forty-hex blob hash is a hex-commits finding", () => {
  const root = cleanRoot();
  writeFileSync(join(root, "captures", "blob.txt"), blobHex + "\n");
  const line = appendReport(root, "- blob: " + tick(blobHex));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(`FAIL hex-commits report.md:${line} ${blobHex}: not a commit (blob)`);
  expect(r.stdout).not.toContain("absent from captures");
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

test("control: 2b a commit hex absent from every capture is a hex-commits finding", () => {
  const root = cleanRoot();
  const line = appendReport(root, "- uncaptured: " + tick(uncapturedCommitHex));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(`FAIL hex-commits report.md:${line}`);
  expect(r.stdout).toContain(uncapturedCommitHex);
  expect(r.stdout).toContain("absent from captures");
});

test("control: 3a a quoted fragment absent from the cited line is a file-line-citations finding", () => {
  const root = cleanRoot();
  const line = appendReport(root, "- wrong fragment: " + tick("captures/run.txt:1") + ' "no-such-fragment"');
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(`FAIL file-line-citations report.md:${line}`);
  expect(r.stdout).toContain("no-such-fragment");
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

test("control: 3b a citation past the last line is a file-line-citations finding", () => {
  const root = cleanRoot();
  const line = appendReport(root, "- past the end: " + tick("captures/run.txt:99"));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(`FAIL file-line-citations report.md:${line}`);
  expect(r.stdout).toContain("captures/run.txt:99");
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

test("control: 4a a cited qa capture with no control sibling is a comparator-controls finding", () => {
  const root = cleanRoot();
  const line = citationLine(root, "captures/qa-1.txt");
  rmSync(join(root, "captures", "qa-1-control.txt"));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(`FAIL comparator-controls report.md:${line}`);
  expect(r.stdout).toContain("captures/qa-1.txt");
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

test("control: 4b a control sibling whose first line is not VERDICT: FAIL is a comparator-controls finding", () => {
  const root = cleanRoot();
  const line = citationLine(root, "captures/qa-1.txt");
  writeFileSync(join(root, "captures", "qa-1-control.txt"), "VERDICT: PASS\nEXIT=0\n");
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(`FAIL comparator-controls report.md:${line}`);
  expect(r.stdout).toContain('"VERDICT: PASS"');
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

test("control: 5a a root with no markdown file is a root finding", () => {
  const r = run(makeRoot());
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("FAIL root");
  expect(r.stdout).not.toContain("PASS evidence-lint");
});

test("control: 5b a missing root is a root finding", () => {
  const root = makeRoot();
  rmSync(root, { recursive: true, force: true });
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("FAIL root");
  expect(r.stdout).not.toContain("PASS evidence-lint");
});

test("boundary: CRLF line endings still resolve citations and quoted fragments", () => {
  const root = makeRoot();
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, "data", "crlf.txt"), "alpha\r\nbeta\r\n");
  writeFileSync(
    join(root, "crlf.md"),
    "# crlf\r\n\r\n- capture: " + tick("data/crlf.txt") + "\r\n- quoted: " + tick("data/crlf.txt:2") + ' "beta"\r\n',
  );
  const r = run(root);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("SCAN crlf.md");
  expect(lastLine(r)).toBe("PASS evidence-lint");
});

test("boundary: a unicode directory name does not break the scan", () => {
  const root = makeRoot("evidence-lint-\uD55C\uAE00-");
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, "data", "captures.txt"), "line one\n");
  writeFileSync(join(root, "report.md"), "- cite: " + tick("data/captures.txt:1") + "\n");
  const r = run(root);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("SCAN report.md");
  expect(lastLine(r)).toBe("PASS evidence-lint");
});

test("boundary: an empty markdown file is scanned and passes", () => {
  const root = makeRoot();
  writeFileSync(join(root, "empty.md"), "");
  const r = run(root);
  expect(r.status).toBe(0);
  expect(r.stdout.trimEnd().split("\n")).toEqual(["SCAN empty.md", "PASS evidence-lint"]);
});

test("boundary: a twenty-thousand-character line is scanned and passes", () => {
  const root = makeRoot();
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, "data", "captures.txt"), "line one\n");
  const citation = tick("data/captures.txt:1");
  const line = "x".repeat(20000 - citation.length - 1) + " " + citation;
  expect(line.length).toBe(20000);
  writeFileSync(join(root, "report.md"), line + "\n");
  const r = run(root);
  expect(r.status).toBe(0);
  expect(lastLine(r)).toBe("PASS evidence-lint");
});

test("boundary: a citation of the last line passes", () => {
  const root = makeRoot();
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, "data", "last.txt"), "alpha\nbeta");
  writeFileSync(join(root, "report.md"), "- last: " + tick("data/last.txt:2") + "\n");
  const r = run(root);
  expect(r.status).toBe(0);
  expect(lastLine(r)).toBe("PASS evidence-lint");
});

test("boundary: a line zero citation is a file-line-citations finding", () => {
  const root = makeRoot();
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, "data", "captures.txt"), "line one\n");
  writeFileSync(join(root, "report.md"), "- zero: " + tick("data/captures.txt:0") + "\n");
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("FAIL file-line-citations report.md:1");
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

test("meta: the control suite fails when the lint script is a constant pass", () => {
  const stubDir = makeRoot("evidence-lint-stub-");
  const stub = join(stubDir, "constant-pass.mjs");
  writeFileSync(stub, 'console.log("PASS evidence-lint");\nprocess.exitCode = 0;\n');
  const r = spawnSync("bun", ["test", "test/evidence-lint.test.js", "-t", "control:"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, EVIDENCE_LINT: stub },
  });
  if (r.error) throw r.error;
  const output = r.stdout + r.stderr;
  expect(output).toContain("control:");
  expect(r.status).not.toBe(0);
});

// --- appended for plan section T2: archive skip, archive citations, --evidence-root ---

function runArgs(args) {
  const r = spawnSync("node", [lint, ...args], { encoding: "utf8" });
  if (r.error) throw r.error;
  return r;
}

// Appended cases keep the existing node:fs import line byte-identical, so symlinks
// are created through the platform's ln.
function symlink(target, linkPath) {
  const r = spawnSync("ln", ["-s", target, linkPath], { encoding: "utf8" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`ln -s ${target} ${linkPath} exited ${r.status}: ${r.stderr}`);
  return linkPath;
}

function makeCleanRootAt(dir) {
  mkdirSync(join(dir, "captures"), { recursive: true });
  mkdirSync(join(dir, "notes"), { recursive: true });
  writeFileSync(join(dir, "captures", "run.txt"), `commit ${commitHex}\nEXIT=0\n`);
  writeFileSync(join(dir, "captures", "qa-1.txt"), "VERDICT: PASS\n");
  writeFileSync(join(dir, "captures", "qa-1-control.txt"), "VERDICT: FAIL\nEXIT=1\n");
  writeFileSync(join(dir, "report.md"), reportBody(dir).join("\n"));
  writeFileSync(
    join(dir, "notes", "extra.md"),
    ["# notes", "", "- capture: " + tick("captures/run.txt"), ""].join("\n"),
  );
  return dir;
}

function archivedCopyRoot() {
  const root = cleanRoot();
  mkdirSync(join(root, "archive"));
  writeFileSync(join(root, "archive", "old.md"), "# archived pre-fix copy\n\n- stale: " + tick("captures/gone.txt") + "\n");
  writeFileSync(join(root, "archive", "old.txt"), "archived capture\n");
  return root;
}

test("fixture: an archived pre-fix copy is skipped and listed, and does not fail the lint", () => {
  const r = run(archivedCopyRoot());
  expect(r.status).toBe(0);
  expect(r.stdout.trimEnd().split("\n")).toEqual([
    "SCAN notes/extra.md",
    "SCAN report.md",
    "SKIP archive/old.md",
    "SKIP archive/old.txt",
    "PASS evidence-lint",
  ]);
});

test("control: 6a a live file citing the archived copy is an archive-citations finding", () => {
  const root = archivedCopyRoot();
  const line = appendReport(root, "- archived copy: " + tick("archive/old.txt"));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(`FAIL archive-citations report.md:${line} cites an archived copy: archive/old.txt`);
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

test("control: 6b the same unresolved token in a live file is a cited-paths finding", () => {
  const root = archivedCopyRoot();
  const line = appendReport(root, "- stale live: " + tick("captures/gone.txt"));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(`FAIL cited-paths report.md:${line} unresolved path: captures/gone.txt`);
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

test("control: 6c directories whose names only resemble archive are still scanned", () => {
  for (const name of ["archived", "archive-old", "Archive", "notes/archive"]) {
    const root = cleanRoot();
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, "old.md"), "- stale: " + tick("captures/gone.txt") + "\n");
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`FAIL cited-paths ${name}/old.md:1 unresolved path: captures/gone.txt`);
    expect(r.stdout).not.toContain("SKIP ");
    expect(r.stdout).not.toContain("archive-citations");
    expect(r.stdout).not.toContain("PASS evidence-lint");
    expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
  }
});

test("boundary: a citation of a look-alike archive directory is not an archive-citations finding", () => {
  const root = cleanRoot();
  mkdirSync(join(root, "archive-old"));
  writeFileSync(join(root, "archive-old", "old.txt"), "look-alike capture\n");
  appendReport(root, "- look-alike: " + tick("archive-old/old.txt"));
  const r = run(root);
  expect(r.status).toBe(0);
  expect(r.stdout).not.toContain("SKIP ");
  expect(r.stdout).not.toContain("archive-citations");
  expect(lastLine(r)).toBe("PASS evidence-lint");
});

test("control: 6d a commit hex held only by an archived capture is absent from captures", () => {
  const root = cleanRoot();
  mkdirSync(join(root, "archive"));
  writeFileSync(join(root, "archive", "old.txt"), uncapturedCommitHex + "\n");
  const line = appendReport(root, "- uncaptured: " + tick(uncapturedCommitHex));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(`FAIL hex-commits report.md:${line} ${uncapturedCommitHex}: absent from captures`);
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

test("control: 5c a root whose only markdown file is archived is a root finding", () => {
  const root = makeRoot();
  mkdirSync(join(root, "archive"));
  writeFileSync(join(root, "archive", "old.md"), "# archived only\n");
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("FAIL root no markdown files under:");
  expect(r.stdout).not.toContain("PASS evidence-lint");
});

test("control: 7a a scanned root outside the evidence root is a root finding", () => {
  const evidence = makeRoot();
  const root = cleanRoot();
  const r = runArgs([root, "--repo", gitRepo, "--evidence-root", evidence]);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(`FAIL root outside evidence root: ${root}`);
  expect(r.stdout).not.toContain("SCAN ");
});

test("control: 7b a missing evidence root path is a root finding", () => {
  const root = cleanRoot();
  const evidence = join(makeRoot(), "nope");
  const r = runArgs([root, "--repo", gitRepo, "--evidence-root", evidence]);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(`FAIL root evidence root missing: ${evidence}`);
  expect(r.stdout).not.toContain("SCAN ");
});

test("control: 7c a sibling whose name only extends the evidence root is outside", () => {
  const base = makeRoot();
  const evidence = join(base, "evidence");
  const root = join(base, "evidence-x");
  mkdirSync(evidence);
  makeCleanRootAt(root);
  const r = runArgs([root, "--repo", gitRepo, "--evidence-root", evidence]);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(`FAIL root outside evidence root: ${root}`);
  expect(r.stdout).not.toContain("SCAN ");
});

test("boundary: the evidence root itself passes as the scanned root", () => {
  const root = makeCleanRootAt(makeRoot());
  const r = runArgs([root, "--repo", gitRepo, "--evidence-root", root]);
  expect(r.status).toBe(0);
  expect(lastLine(r)).toBe("PASS evidence-lint");
});

test("boundary: a scanned root reached through a symlink inside the evidence root passes", () => {
  const evidence = makeRoot();
  const real = makeCleanRootAt(join(evidence, "run"));
  const link = symlink(real, join(makeRoot(), "run-link"));
  const r = runArgs([link, "--repo", gitRepo, "--evidence-root", evidence]);
  expect(r.status).toBe(0);
  expect(lastLine(r)).toBe("PASS evidence-lint");
});

test("boundary: an evidence root that is a regular file is a root finding", () => {
  const root = cleanRoot();
  const evidence = join(makeRoot(), "evidence.txt");
  writeFileSync(evidence, "not a directory\n");
  const r = runArgs([root, "--repo", gitRepo, "--evidence-root", evidence]);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(`FAIL root evidence root not a directory: ${evidence}`);
  expect(r.stdout).not.toContain("SCAN ");
});

test("boundary: an archived copy cited through a symlinked root path is still an archive-citations finding", () => {
  const root = archivedCopyRoot();
  const link = symlink(root, join(makeRoot(), "root-link"));
  const line = appendReport(root, "- archived via link: " + tick(join(link, "archive", "old.txt")));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(`FAIL archive-citations report.md:${line} cites an archived copy:`);
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

test("boundary: an evidence root option with no value is a usage error", () => {
  const r = runArgs([cleanRoot(), "--repo", gitRepo, "--evidence-root"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("usage: node");
  expect(r.stdout).toBe("");
});

// --- appended for plan section T2b (Plan amendment A1): the symlinked archive and the dot-dot name ---

test("control: 6e an archive entry that is a symbolic link is a root finding", () => {
  const root = cleanRoot();
  const target = makeRoot("evidence-lint-archive-target-");
  writeFileSync(join(target, "old.md"), "# archived pre-fix copy\n\n- stale: " + tick("captures/gone.txt") + "\n");
  const link = symlink(target, join(root, "archive"));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).not.toContain("SCAN ");
  expect(r.stdout).not.toContain("SKIP ");
  expect(lastLine(r)).toBe(`FAIL root archive is a symbolic link: ${link}`);
});

test("boundary: a scanned root whose own name begins with two dots is inside the evidence root", () => {
  const evidence = makeRoot();
  const root = makeCleanRootAt(join(evidence, "..x"));
  const r = runArgs([root, "--repo", gitRepo, "--evidence-root", evidence]);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("SCAN report.md");
  expect(lastLine(r)).toBe("PASS evidence-lint");
});

// --- appended for plan section T2c (Plan amendment A2): the parent directory of the evidence root ---

test("control: 7d a scanned root that is the parent of the evidence root is outside", () => {
  const base = makeRoot();
  const evidence = join(base, "evidence");
  mkdirSync(evidence);
  const root = makeCleanRootAt(base);
  const r = runArgs([root, "--repo", gitRepo, "--evidence-root", evidence]);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(`FAIL root outside evidence root: ${root}`);
  expect(r.stdout).not.toContain("SCAN ");
});

// --- appended for fix1 (synthesis items 1-3): the archive inventory, the exact archive entry, identity containment ---

// The case-variant cases below create each entry under its exact name and branch on whether
// this volume folds case: on a case-insensitive volume the two spellings are the same
// directory, on a case-sensitive one the differently spelled path does not exist, so the case
// asserts the base-equivalent outcome there. Nothing is skipped either way.
function pathExists(target) {
  const code = "import('node:fs').then((fs) => process.exit(fs.existsSync(process.argv[1]) ? 0 : 1))";
  return spawnSync("node", ["-e", code, target], { encoding: "utf8" }).status === 0;
}

function fsIsCaseInsensitive() {
  const dir = makeRoot("evidence-lint-caseprobe-");
  mkdirSync(join(dir, "CaseProbe-AbC"));
  return pathExists(join(dir, "caseprobe-abc"));
}

function archivedFile(root, relativePath, body = "archived capture\n") {
  const full = join(root, "archive", relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  return full;
}

function lookAlikeArchiveLink(spelling, target) {
  const root = cleanRoot();
  symlink(target, join(root, spelling));
  return root;
}

function archiveTargetDir(name, body) {
  const dir = makeRoot("evidence-lint-archive-target-");
  writeFileSync(join(dir, name), body);
  return dir;
}

test("control: 8a a regular file under archive/.git is listed as SKIP", () => {
  const root = cleanRoot();
  archivedFile(root, ".git/old.txt");
  archivedFile(root, "node_modules/old.txt");
  archivedFile(root, "plain.txt");
  const r = run(root);
  expect(r.status).toBe(0);
  expect(r.stdout.trimEnd().split("\n")).toEqual([
    "SCAN notes/extra.md",
    "SCAN report.md",
    "SKIP archive/.git/old.txt",
    "SKIP archive/node_modules/old.txt",
    "SKIP archive/plain.txt",
    "PASS evidence-lint",
  ]);
});

test("control: 8b a regular file under archive/node_modules alone is listed as SKIP", () => {
  const root = cleanRoot();
  archivedFile(root, "node_modules/old.txt");
  const r = run(root);
  expect(r.status).toBe(0);
  expect(r.stdout.trimEnd().split("\n")).toEqual([
    "SCAN notes/extra.md",
    "SCAN report.md",
    "SKIP archive/node_modules/old.txt",
    "PASS evidence-lint",
  ]);
});

test("control: 8c excluded names nested with each other and with ordinary directories are all listed", () => {
  const root = cleanRoot();
  for (const name of [
    ".git/node_modules/a.txt",
    "node_modules/.git/b.txt",
    "sub/.git/c.txt",
    "sub/node_modules/d.txt",
    "x/y/.git/e.txt",
    "keep.txt",
  ]) {
    archivedFile(root, name);
  }
  const r = run(root);
  expect(r.status).toBe(0);
  expect(r.stdout.trimEnd().split("\n")).toEqual([
    "SCAN notes/extra.md",
    "SCAN report.md",
    "SKIP archive/.git/node_modules/a.txt",
    "SKIP archive/keep.txt",
    "SKIP archive/node_modules/.git/b.txt",
    "SKIP archive/sub/.git/c.txt",
    "SKIP archive/sub/node_modules/d.txt",
    "SKIP archive/x/y/.git/e.txt",
    "PASS evidence-lint",
  ]);
});

test("control: 8d a symlinked file inside archive is listed as SKIP and a citation of it is an archive-citations finding", () => {
  const root = cleanRoot();
  const target = join(makeRoot("evidence-lint-archive-target-"), "outside.txt");
  writeFileSync(target, "outside copy\n");
  mkdirSync(join(root, "archive"));
  symlink(target, join(root, "archive", "link.txt"));
  const line = appendReport(root, "- linked copy: " + tick("archive/link.txt"));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("SKIP archive/link.txt");
  expect(r.stdout).toContain(`FAIL archive-citations report.md:${line} cites an archived copy: archive/link.txt`);
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

test("control: 8e a symlinked directory inside archive is listed as SKIP and a citation through it is an archive-citations finding", () => {
  const root = cleanRoot();
  const outside = makeRoot("evidence-lint-archive-target-");
  writeFileSync(join(outside, "secret.txt"), "outside copy\n");
  mkdirSync(join(root, "archive"));
  symlink(outside, join(root, "archive", "linkdir"));
  const line = appendReport(root, "- linked dir: " + tick("archive/linkdir/secret.txt"));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("SKIP archive/linkdir");
  expect(r.stdout).toContain(`FAIL archive-citations report.md:${line} cites an archived copy: archive/linkdir/secret.txt`);
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

test("control: 8f the review countercheck - a live citation of archive/node_modules/old.txt still fails", () => {
  const root = cleanRoot();
  archivedFile(root, ".git/old.txt");
  archivedFile(root, "node_modules/old.txt");
  const line = appendReport(root, "- excluded name: " + tick("archive/node_modules/old.txt"));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("SKIP archive/node_modules/old.txt");
  expect(r.stdout).toContain(`FAIL archive-citations report.md:${line} cites an archived copy: archive/node_modules/old.txt`);
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

test("control: 9a a look-alike archive symlink spelling is not the archive", () => {
  for (const spelling of ["Archive", "ARCHIVE", "aRchive"]) {
    const target = archiveTargetDir("old.md", "# archived pre-fix copy\n\n- stale: " + tick("captures/gone.txt") + "\n");
    const root = lookAlikeArchiveLink(spelling, target);
    const r = run(root);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("archive is a symbolic link");
    expect(r.stdout).not.toContain("SKIP ");
    expect(lastLine(r)).toBe("PASS evidence-lint");
  }
});

test("control: 9b a dangling, file-targeted, or inside-root look-alike archive symlink is not the archive", () => {
  const dangling = lookAlikeArchiveLink("Archive", join(cleanRoot(), "captures", "nope.txt"));
  const toFile = lookAlikeArchiveLink("ARCHIVE", join(cleanRoot(), "captures", "run.txt"));
  const insideRoot = (() => {
    const root = cleanRoot();
    symlink(join(root, "notes"), join(root, "aRchive"));
    return root;
  })();
  for (const root of [dangling, toFile, insideRoot]) {
    const r = run(root);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("archive is a symbolic link");
    expect(r.stdout).not.toContain("SKIP ");
    expect(lastLine(r)).toBe("PASS evidence-lint");
  }
});

test("boundary: a lowercase archive symlink to a file or a dangling one is still a root finding", () => {
  for (const target of ["captures/run.txt", "captures/gone.txt"]) {
    const root = cleanRoot();
    const link = symlink(join(root, target), join(root, "archive"));
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("SCAN ");
    expect(r.stdout).not.toContain("SKIP ");
    expect(lastLine(r)).toBe(`FAIL root archive is a symbolic link: ${link}`);
  }
});

test("control: 9c a case-variant spelling of the evidence root that is the same directory passes", () => {
  const base = makeRoot();
  const evidence = join(base, "evi");
  const root = makeCleanRootAt(join(evidence, "run"));
  const spelled = join(base, "EVI");
  const r = runArgs([root, "--repo", gitRepo, "--evidence-root", spelled]);
  if (fsIsCaseInsensitive()) {
    expect(r.status).toBe(0);
    expect(lastLine(r)).toBe("PASS evidence-lint");
  } else {
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`FAIL root evidence root missing: ${spelled}`);
  }
});

test("control: 9d a scanned root whose ancestor is spelled with a different case than the evidence root passes", () => {
  const base = makeRoot();
  const evidence = join(base, "c4evi");
  mkdirSync(evidence);
  const root = makeCleanRootAt(join(base, "C4EVI", "run"));
  const r = runArgs([root, "--repo", gitRepo, "--evidence-root", evidence]);
  if (fsIsCaseInsensitive()) {
    expect(r.status).toBe(0);
    expect(lastLine(r)).toBe("PASS evidence-lint");
  } else {
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`FAIL root outside evidence root: ${root}`);
  }
});

test("boundary: an archived copy cited from a root spelled with a case variant is still an archive-citations finding", () => {
  const base = makeRoot();
  const root = join(base, "C6EVI", "run");
  mkdirSync(join(root, "archive"), { recursive: true });
  writeFileSync(join(root, "archive", "old.txt"), "archived capture\n");
  writeFileSync(join(root, "report.md"), "- archived copy: " + tick("archive/old.txt") + "\n");
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("SKIP archive/old.txt");
  expect(r.stdout).toContain("FAIL archive-citations report.md:1 cites an archived copy: archive/old.txt");
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

// --- appended for fix1 attempt 3: a case-variant spelling of the archived symlink ---

// The exact lowercase archive directory holds linkdir as a symbolic link to an outside
// directory, and the live report cites that directory spelled with a capital A. On a volume that
// folds case the two spellings are the same directory, so the citation is archived and must be a
// finding; on a case-sensitive volume the differently spelled path does not exist, so the same
// citation is the base-equivalent cited-paths finding. Nothing is skipped either way.
test("control: 8g a case-variant spelling of a symlinked directory inside archive is an archive-citations finding", () => {
  const root = cleanRoot();
  const outside = makeRoot("evidence-lint-archive-target-");
  writeFileSync(join(outside, "secret.txt"), "outside copy\n");
  mkdirSync(join(root, "archive"));
  symlink(outside, join(root, "archive", "linkdir"));
  const line = appendReport(root, "- case-variant linked dir: " + tick("Archive/linkdir/secret.txt"));
  const r = run(root);
  expect(r.status).toBe(1);
  if (fsIsCaseInsensitive()) {
    expect(r.stdout).toContain("SKIP archive/linkdir");
    expect(r.stdout).toContain(
      `FAIL archive-citations report.md:${line} cites an archived copy: Archive/linkdir/secret.txt`,
    );
  } else {
    expect(r.stdout).toContain(`FAIL cited-paths report.md:${line} unresolved path: Archive/linkdir/secret.txt`);
  }
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

// --- appended for fix1 attempt 4: the absolute root alias, the symlinked root, and dot-dot segments ---

// The first two cases reach an outside file through a symbolic link inside archive.
// Archive traversal history must survive both a case alias and a symbolic link to the root.
// The third case has a missing intermediate component: the OS cannot resolve it, so
// R7 supersedes the former lexical archive verdict with a cited-paths finding.

test("control: 8h an absolute citation through a case alias of the scanned root is an archive-citations finding", () => {
  const base = makeRoot();
  const root = makeCleanRootAt(join(base, "root"));
  mkdirSync(join(root, "archive"));
  const outside = makeRoot("evidence-lint-archive-target-");
  writeFileSync(join(outside, "secret.txt"), "outside copy\n");
  symlink(outside, join(root, "archive", "linkdir"));
  const alias = join(base, "ROOT");
  const line = appendReport(root, "- archived via the root alias: " + tick(join(alias, "archive", "linkdir", "secret.txt")));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("SKIP archive/linkdir");
  if (fsIsCaseInsensitive()) {
    expect(r.stdout).toContain(`FAIL archive-citations report.md:${line} cites an archived copy:`);
  } else {
    expect(r.stdout).toContain(`FAIL cited-paths report.md:${line} unresolved path:`);
  }
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

test("control: 8i an absolute citation through a symlinked path to the scanned root is an archive-citations finding", () => {
  const root = cleanRoot();
  mkdirSync(join(root, "archive"));
  const outside = makeRoot("evidence-lint-archive-target-");
  writeFileSync(join(outside, "secret.txt"), "outside copy\n");
  symlink(outside, join(root, "archive", "linkdir"));
  const link = symlink(root, join(makeRoot("evidence-lint-root-alias-"), "root-link"));
  const line = appendReport(root, "- archived via the root link: " + tick(join(link, "archive", "linkdir", "secret.txt")));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("SKIP archive/linkdir");
  expect(r.stdout).toContain(`FAIL archive-citations report.md:${line} cites an archived copy:`);
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

test("control: 8j an absolute citation with a missing intermediate is a cited-paths finding", () => {
  const root = cleanRoot();
  mkdirSync(join(root, "archive"));
  const outside = makeRoot("evidence-lint-archive-target-");
  writeFileSync(join(outside, "secret.txt"), "outside copy\n");
  symlink(outside, join(root, "archive", "linkdir"));
  const line = appendReport(root, "- archived through a dot-dot segment: " + tick(root + "/archive/missing/../linkdir/secret.txt"));
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("SKIP archive/linkdir");
  expect(r.stdout).toContain(`FAIL cited-paths report.md:${line} unresolved path:`);
  expect(r.stdout).not.toContain("PASS evidence-lint");
  expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
});

// --- appended for R7: the OS resolves links before parent components ---

import { statSync } from "node:fs";

function r7WrongFile(depth = 0, parents = 1) {
  const home = makeRoot("evidence-lint-r7-");
  const root = home + "/root";
  const outside = home + "/outside";
  const container = root + "/d".repeat(depth);
  mkdirSync(container, { recursive: true });
  mkdirSync(outside + "/s".repeat(parents), { recursive: true });
  writeFileSync(root + "/d".repeat(Math.max(0, depth - parents + 1)) + "/secret.txt", "lexical-only\nsecond");
  writeFileSync(outside + "/secret.txt", "physical-only");
  symlink(outside + "/s".repeat(parents), container + "/link");
  return { home, root, outside, raw: container + "/link" + "/..".repeat(parents) + "/secret.txt" };
}

for (const relative of [false, true]) for (const depth of [0, 1, 3]) {
  test(`R7 citation: reads the physical file after a link and parent, relative=${relative}, depth=${depth}`, () => {
    const f = r7WrongFile(depth);
    expect(readFileSync(f.raw, "utf8")).toBe("physical-only");
    const token = relative ? f.raw.slice(f.root.length + 1) : f.raw;
    writeFileSync(f.root + "/report.md", tick(token + ":1") + ' "physical-only"\n');
    const r = run(f.root);
    expect(r.status).toBe(0);
    expect(lastLine(r)).toBe("PASS evidence-lint");
  });
}

for (const n of [2, 5]) {
  test(`R7 citation: applies ${n} parents to the directory reached by the link`, () => {
    const f = r7WrongFile(n, n);
    expect(readFileSync(f.raw, "utf8")).toBe("physical-only");
    writeFileSync(f.root + "/report.md", tick(f.raw + ":1") + ' "physical-only"\n');
    expect(run(f.root).status).toBe(0);
  });
}

for (const kind of ["missing", "dangling", "file", "cycle"]) for (const archive of [false, true]) {
  test(`R7 citation: invalid ${kind} intermediate remains cited-paths, archive=${archive}`, () => {
    const root = makeRoot("evidence-lint-r7-invalid-");
    const base = root + (archive ? "/archive" : "");
    mkdirSync(base, { recursive: true });
    writeFileSync(base + "/secret.txt", "lexical decoy\n");
    if (kind === "dangling") symlink("absent", base + "/bad");
    if (kind === "cycle") symlink("bad", base + "/bad");
    if (kind === "file") writeFileSync(base + "/bad", "not a directory\n");
    const raw = base + "/bad/../secret.txt";
    expect(() => statSync(raw)).toThrow();
    writeFileSync(root + "/report.md", tick(raw) + "\n");
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FAIL cited-paths report.md:1");
    expect(r.stdout).not.toContain("FAIL archive-citations");
    expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
  });
}

test("R7 citation: rejects lexical quote and out-of-range physical line", () => {
  const f = r7WrongFile();
  writeFileSync(f.root + "/report.md", tick(f.raw + ":1") + ' "lexical-only"\n' + tick(f.raw + ":2") + "\n");
  const r = run(f.root);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("quoted fragment missing");
  expect(r.stdout).toContain("outside 1-1");
  expect(lastLine(r)).toBe("FAIL evidence-lint 2 finding(s)");
});

for (const baseKind of ["repo", "skill"]) {
  test(`R7 citation: preserves raw paths at the ${baseKind} fallback base`, () => {
    const f = r7WrongFile();
    const script = baseKind === "skill" ? f.root + "/scripts/evidence-lint.mjs" : lint;
    if (baseKind === "skill") {
      mkdirSync(f.root + "/scripts");
      writeFileSync(script, readFileSync(lint));
    }
    const scan = makeRoot("evidence-lint-r7-fallback-");
    for (const token of ["link/../secret.txt:1", "missing/../secret.txt"]) {
      writeFileSync(scan + "/report.md", tick(token) + (token.startsWith("link") ? ' "physical-only"\n' : "\n"));
      const r = spawnSync("node", [script, scan, "--repo", baseKind === "repo" ? f.root : gitRepo], { encoding: "utf8" });
      expect(r.error).toBeUndefined();
      expect(r.status).toBe(token.startsWith("link") ? 0 : 1);
      if (!token.startsWith("link")) expect(r.stdout).toContain("FAIL cited-paths");
    }
  });
}

for (const mode of ["final-inside", "leave-parent", "target-expansion", "chain-exit"]) {
  test(`R7 archive: remembers directories traversed by ${mode}`, () => {
    const root = makeRoot("evidence-lint-r7-archive-");
    const outside = makeRoot("evidence-lint-r7-outside-");
    mkdirSync(root + "/archive/sub", { recursive: true });
    writeFileSync(root + "/archive/secret.txt", "archived\n");
    writeFileSync(root + "/secret.txt", "live\n");
    writeFileSync(outside + "/secret.txt", "outside\n");
    let raw;
    if (mode === "final-inside") { symlink(root + "/archive/sub", root + "/link"); raw = root + "/link/../secret.txt"; }
    if (mode === "leave-parent") raw = root + "/archive/sub/../../secret.txt";
    if (mode === "target-expansion") { symlink("archive/sub/../../secret.txt", root + "/entry.txt"); raw = root + "/entry.txt"; }
    if (mode === "chain-exit") {
      symlink(outside, root + "/archive/exit");
      symlink("archive/exit", root + "/hop");
      symlink("hop", root + "/start");
      raw = root + "/start/secret.txt";
    }
    expect(statSync(raw).isFile()).toBe(true);
    writeFileSync(root + "/report.md", tick(raw) + "\n");
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FAIL archive-citations report.md:1");
    expect(lastLine(r)).toBe("FAIL evidence-lint 1 finding(s)");
  });
}

for (const arg of ["root", "evidence"]) for (const inside of [false, true]) {
  test(`R7 containment: ${arg} symlink-parent uses physical ancestry, inside=${inside}`, () => {
    const home = makeRoot("evidence-lint-r7-containment-");
    const E = home + "/E", outside = home + "/outside";
    mkdirSync(E + "/sub", { recursive: true });
    mkdirSync(outside + "/sub", { recursive: true });
    mkdirSync(E + "/run"); mkdirSync(outside + "/run");
    writeFileSync(E + "/run/report.md", "# inside\n");
    writeFileSync(outside + "/run/report.md", "# outside\n");
    const owner = inside ? outside : E;
    symlink((inside ? E : outside) + "/sub", owner + "/link");
    const root = arg === "root" ? owner + "/link/../run" : E + "/run";
    const evidence = arg === "evidence" ? owner + "/link/.." : E;
    expect(statSync(root).isDirectory()).toBe(true);
    expect(statSync(evidence).isDirectory()).toBe(true);
    const r = runArgs([root, "--repo", gitRepo, "--evidence-root", evidence]);
    expect(r.status).toBe(inside ? 0 : 1);
    expect(r.stderr).toBe("");
    if (!inside) expect(r.stdout).toContain("FAIL root outside evidence root:");
  });
}

for (const mode of ["physical-defect", "lexical-defect", "physical-only", "inventory"]) {
  test(`R7 scan: raw root selects physical files and inventory, ${mode}`, () => {
    const home = makeRoot("evidence-lint-r7-scan-");
    mkdirSync(home + "/E/run", { recursive: true });
    mkdirSync(home + "/outside/sub", { recursive: true });
    mkdirSync(home + "/outside/run");
    symlink(home + "/outside/sub", home + "/E/link");
    const physical = home + "/outside/run", lexical = home + "/E/run";
    writeFileSync(physical + "/report.md", mode === "physical-defect" ? tick("missing/live.txt") + "\n" : "# physical\n");
    if (mode !== "physical-only") writeFileSync(lexical + "/report.md", mode === "lexical-defect" ? tick("missing/live.txt") + "\n" : "# lexical\n");
    if (mode === "inventory") {
      mkdirSync(physical + "/archive"); mkdirSync(lexical + "/archive");
      writeFileSync(physical + "/archive/physical.txt", "physical archive\n");
      writeFileSync(lexical + "/archive/decoy.txt", "lexical archive\n");
    }
    const raw = home + "/E/link/../run";
    expect(readFileSync(raw + "/report.md", "utf8")).toBe(readFileSync(physical + "/report.md", "utf8"));
    const r = run(raw);
    expect(r.status).toBe(mode === "physical-defect" ? 1 : 0);
    expect(r.stderr).toBe("");
    if (mode === "physical-defect") expect(r.stdout).toContain("FAIL cited-paths report.md:1");
    if (mode === "inventory") {
      expect(r.stdout).toContain("SKIP archive/physical.txt");
      expect(r.stdout).not.toContain("archive/decoy.txt");
    }
  });
}

test("R7 comparator: reads the control sibling from the physical directory after link-parent", () => {
  const f = r7WrongFile();
  for (const dir of [f.root, f.outside]) writeFileSync(dir + "/qa-1.txt", "VERDICT: PASS\n");
  writeFileSync(f.root + "/qa-1-control.txt", "VERDICT: PASS\n");
  writeFileSync(f.outside + "/qa-1-control.txt", "VERDICT: FAIL\n");
  const raw = f.root + "/link/../qa-1.txt";
  expect(readFileSync(f.root + "/link/../qa-1-control.txt", "utf8")).toBe("VERDICT: FAIL\n");
  writeFileSync(f.root + "/report.md", tick(raw) + "\n");
  const r = run(f.root);
  expect(r.status).toBe(0);
  expect(lastLine(r)).toBe("PASS evidence-lint");
});
