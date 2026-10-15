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
