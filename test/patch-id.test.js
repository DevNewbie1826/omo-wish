import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isRevision, patchIdOfDiff } from "../skills/wish/scripts/patch-id.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/wish/scripts/patch-id.mjs");
const fixture = mkdtempSync(join(tmpdir(), "wish-patch-id-test-"));
const repo = join(fixture, "repo");

let base;
let patchHead;
let otherBase;
let otherHead;
let whitespaceHead;

function git(...args) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(message) {
  git("add", "-A");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

function run(args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", cwd: fixture });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function argsFor({ oldBase, oldHead, newBase, newHead, interdiff }) {
  const args = ["--old-base", oldBase, "--verdict-head", oldHead, "--new-base", newBase, "--new-head", newHead, "--repo", repo];
  if (interdiff !== undefined) args.push("--interdiff", interdiff);
  return args;
}

beforeAll(() => {
  mkdirSync(repo, { recursive: true });
  git("init", "-q");
  git("config", "user.email", "m4@example.invalid");
  git("config", "user.name", "M4");
  writeFileSync(join(repo, "f.txt"), "alpha\nomega\n");
  writeFileSync(join(repo, "g.txt"), "1\n");
  base = commit("base");

  git("checkout", "-q", "-b", "patch");
  writeFileSync(join(repo, "f.txt"), "alpha\nbeta\nomega\n");
  patchHead = commit("add beta");

  git("checkout", "-q", "-b", "rebased", base);
  writeFileSync(join(repo, "extra.txt"), "unrelated\n");
  otherBase = commit("an unrelated base commit");
  writeFileSync(join(repo, "f.txt"), "alpha\nbeta\nomega\n");
  otherHead = commit("add beta on a new base");

  git("checkout", "-q", "-b", "spaced", base);
  writeFileSync(join(repo, "f.txt"), "alpha\n beta \nomega\n");
  whitespaceHead = commit("add beta with whitespace");
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe("patch-id CLI", () => {
  test("the same patch on two different bases has one patch id", () => {
    expect(otherBase).not.toBe(base);
    expect(otherHead).not.toBe(patchHead);
    const result = run(argsFor({ oldBase: base, oldHead: patchHead, newBase: otherBase, newHead: otherHead }));
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^SAME [0-9a-f]{40}\n$/);
  });

  test("a whitespace-only change is DIFFERENT under --verbatim", () => {
    const stable = spawnSync(
      "bash",
      ["-c", `git -C "${repo}" diff ${base}...${patchHead} | git -C "${repo}" patch-id | cut -d" " -f1`],
      { encoding: "utf8" },
    ).stdout.trim();
    const spacedStable = spawnSync(
      "bash",
      ["-c", `git -C "${repo}" diff ${base}...${whitespaceHead} | git -C "${repo}" patch-id | cut -d" " -f1`],
      { encoding: "utf8" },
    ).stdout.trim();
    expect(spacedStable).toBe(stable);

    const result = run(argsFor({ oldBase: base, oldHead: patchHead, newBase: base, newHead: whitespaceHead }));
    expect(result.code).toBe(1);
    const [first, second] = result.stdout.trim().split(/\s+/).slice(1);
    expect(first).not.toBe(second);
  });

  test("--interdiff writes the difference between the two base-to-head diffs", () => {
    const interdiff = join(fixture, "delta.patch");
    const result = run(argsFor({
      oldBase: base, oldHead: patchHead, newBase: base, newHead: whitespaceHead, interdiff,
    }));
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(`INTERDIFF ${interdiff}`);
    const written = readFileSync(interdiff, "utf8");
    expect(written.length).toBeGreaterThan(0);
    expect(written).toContain("a/old.patch");
    expect(written).toContain("+ beta");
    expect(written).not.toContain(fixture);
  });

  test("--interdiff on an unchanged patch writes an empty delta", () => {
    const interdiff = join(fixture, "empty-delta.patch");
    const result = run(argsFor({
      oldBase: base, oldHead: patchHead, newBase: otherBase, newHead: otherHead, interdiff,
    }));
    expect(result.code).toBe(0);
    expect(readFileSync(interdiff, "utf8")).toBe("");
  });

  test("an unwritable interdiff path exits 3", () => {
    const result = run(argsFor({
      oldBase: base,
      oldHead: patchHead,
      newBase: base,
      newHead: whitespaceHead,
      interdiff: join(fixture, "no-such-dir", "x.patch"),
    }));
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("cannot write the interdiff");
  });

  test("a revision that cannot be diffed exits 3", () => {
    const result = run(argsFor({ oldBase: "0123456", oldHead: patchHead, newBase: otherBase, newHead: otherHead }));
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("FAIL");
  });

  test("an empty patch exits 3: there is nothing to compare", () => {
    const result = run(argsFor({ oldBase: base, oldHead: base, newBase: otherBase, newHead: otherHead }));
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("empty patch");
  });

  test("usage mistakes exit 2", () => {
    expect(run(["--old-base", base]).code).toBe(2);
    expect(run(["--old-base", "--verdict-head", patchHead]).code).toBe(2);
    expect(run(["--old-base", base, "--verdict-head", patchHead, "--new-base", otherBase, "--new-head", otherHead, "--nope"]).code).toBe(2);
  });

  test("--help exits 0", () => {
    const result = run(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("usage: patch-id.mjs");
    expect(result.stdout).toContain("SAME");
  });
});

describe("patch-id helpers", () => {
  test("a revision may not look like a flag or contain whitespace", () => {
    expect(isRevision("HEAD~1")).toBe(true);
    expect(isRevision("origin/main")).toBe(true);
    expect(isRevision("--output=/tmp/x")).toBe(false);
    expect(isRevision("-x")).toBe(false);
    expect(isRevision("HEAD main")).toBe(false);
    expect(isRevision("")).toBe(false);
  });

  test("the same diff text always hashes to the same id", () => {
    const diff = `diff --git a/f.txt b/f.txt\nindex 1111111..2222222 100644\n--- a/f.txt\n+++ b/f.txt\n@@ -1 +1,2 @@\n alpha\n+beta\n`;
    const first = patchIdOfDiff(diff, repo);
    const second = patchIdOfDiff(diff, repo);
    expect(first.ok).toBe(true);
    expect(first.patchId).toBe(second.patchId);
    const changed = patchIdOfDiff(diff.replace("+beta", "+gamma"), repo);
    expect(changed.patchId).not.toBe(first.patchId);
  });

  test("a diff text that is not a patch has no id", () => {
    expect(patchIdOfDiff("", repo).ok).toBe(false);
  });
});