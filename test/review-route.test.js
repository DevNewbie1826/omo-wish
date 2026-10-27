import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideRoute, parseNameStatusZ } from "../skills/wish/scripts/review-route.mjs";

const fixtures = [];

afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

const route = (paths, options) =>
  decideRoute(paths.map((path) => ({ status: "M", paths: [path] })), options).route;

test("test-only diffs route to the code reviewer", () => {
  for (const path of [
    "test/a.ts",
    "tests/deep/b.ts",
    "src/c.spec.tsx",
    "src/d.test.ts",
    "__tests__/e.ts",
    "pkg/foo_test.go",
    "e2e/login.ts",
    "testdata/x.json",
    "src/__snapshots__/a.snap",
    "test_helpers.py",
    "WidgetTest.java",
  ]) {
    expect(route([path])).toBe("code-reviewer");
  }
});

test("docs-allowlist diffs route to the code reviewer", () => {
  for (const path of [
    "docs/guide.md",
    "doc/deep/a.rst",
    "documentation/setup.mdx",
    "README.md",
    "README.ko.md",
    "CHANGELOG",
    "LICENSE",
    "CONTRIBUTING.md",
  ]) {
    expect(route([path])).toBe("code-reviewer");
  }
});

test("CI-only diffs route to the code reviewer", () => {
  for (const path of [
    ".github/workflows/ci.yml",
    ".circleci/config.yml",
    "Jenkinsfile",
    ".gitlab-ci.yml",
    "ci/build.sh",
    ".github/dependabot.yml",
    "renovate.json",
  ]) {
    expect(route([path])).toBe("code-reviewer");
  }
});

test("one production path forces the ultrabrain route", () => {
  for (const path of [
    "src/app.ts",
    "package.json",
    "requirements.txt",
    "Makefile",
    "bun.lock",
    "data.bin",
  ]) {
    expect(route(["docs/a.md", "test/a.test.ts", path])).toBe("ultrabrain");
  }
});

test("a docs-extension file outside the allowlist is production", () => {
  for (const path of [
    "notes/design.md",
    "packages/foo/README.md",
    ".github/ISSUE_TEMPLATE/bug.md",
    "skills/wish/SKILL.md",
    "prompts/wish.md",
  ]) {
    expect(route([path])).toBe("ultrabrain");
  }
});

test("an empty or unclassifiable diff falls back to ultrabrain", () => {
  expect(route([])).toBe("ultrabrain");
  expect(route(["weird-no-extension"])).toBe("ultrabrain");
});

test("a declared product root wins over test, CI, and docs", () => {
  const options = { productRoots: ["docs/runtime", "skills"] };
  expect(route(["docs/runtime/template.md"], options)).toBe("ultrabrain");
  expect(route(["skills/wish/SKILL.md"], options)).toBe("ultrabrain");
  expect(route(["docs/guide.md"], options)).toBe("code-reviewer");
});

test("renames and deletions classify every path", () => {
  const renameWithProductionSource = parseNameStatusZ("R100\0src/a.ts\0test/a.test.ts\0");
  expect(decideRoute(renameWithProductionSource).route).toBe("ultrabrain");
  const deletedTest = parseNameStatusZ("D\0test/c.test.ts\0");
  expect(decideRoute(deletedTest).route).toBe("code-reviewer");
  const deletedProduction = parseNameStatusZ("D\0src/d.ts\0");
  expect(decideRoute(deletedProduction).route).toBe("ultrabrain");
});

function git(dir, ...args) {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "route-test",
      GIT_AUTHOR_EMAIL: "route@test",
      GIT_COMMITTER_NAME: "route-test",
      GIT_COMMITTER_EMAIL: "route@test",
    },
  });
}

function commit(dir, file, content) {
  mkdirSync(join(dir, ...file.split("/").slice(0, -1)), { recursive: true });
  writeFileSync(join(dir, file), content);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", file);
}

test("the CLI classifies a real base...head diff", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-route-"));
  fixtures.push(dir);
  const cli = join(import.meta.dir, "..", "skills", "wish", "scripts", "review-route.mjs");
  git(dir, "init", "-q", "-b", "main");
  commit(dir, "README.md", "# base\n");

  git(dir, "checkout", "-q", "-b", "docs");
  commit(dir, "docs/guide.md", "# guide\n");
  const docs = execFileSync(process.execPath, [cli, "--base", "main", "--head", "docs", "--repo", dir], { encoding: "utf8" });
  expect(docs).toContain("REVIEW ROUTE: code-reviewer");
  expect(docs).toContain("table version:");

  git(dir, "checkout", "-q", "main");
  git(dir, "checkout", "-q", "-b", "prod");
  commit(dir, "src/app.ts", "export const x = 1;\n");
  const prod = execFileSync(process.execPath, [cli, "--base", "main", "--head", "prod", "--repo", dir], { encoding: "utf8" });
  expect(prod).toContain("REVIEW ROUTE: ultrabrain");
});

test("a usage error exits 2", () => {
  const cli = join(import.meta.dir, "..", "skills", "wish", "scripts", "review-route.mjs");
  const result = Bun.spawnSync([process.execPath, cli], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("usage: review-route.mjs");
});