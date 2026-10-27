import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileScope,
  decideReuse,
  globToRegExp,
  parseFrontMatter,
  scopeHits,
  scopeMatches,
} from "../skills/wish/scripts/reuse-check.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/wish/scripts/reuse-check.mjs");
const fixture = mkdtempSync(join(tmpdir(), "wish-reuse-check-test-"));
const repo = join(fixture, "repo");
const evidence = join(fixture, "evidence");
const outside = join(fixture, "outside");

let c0;
let c1;
let c2;
let c3;
let c4;
let c5;
let tree0;

const ARTIFACT_A = "a1".repeat(32);
const ARTIFACT_B = "b2".repeat(32);
const ENV_A = "c3".repeat(32);
const ENV_B = "d4".repeat(32);

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
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function receipt(overrides = {}) {
  return {
    kind: "lane",
    stage: "verify_lane",
    type: "code",
    unit: "u1",
    program_id: null,
    lane: "tests",
    head: c0,
    tree: tree0,
    scope: ["src/**"],
    started_at: "2026-10-27T16:00:00Z",
    ended_at: "2026-10-27T16:01:00Z",
    status: "PASS",
    rows: [{ id: "r1", command: "bun test", observable: "the suite is green", verdict: "PASS", artifact: null }],
    artifacts: [],
    cleanup: [],
    ...overrides,
  };
}

function writeReceipt(directory, name, value) {
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(value, null, 2));
  return path;
}

function laneName(stage, lane, head) {
  return `${stage}-${lane}-${head.slice(0, 7)}.json`;
}

beforeAll(() => {
  mkdirSync(repo, { recursive: true });
  mkdirSync(evidence, { recursive: true });
  mkdirSync(outside, { recursive: true });
  git("init", "-q");
  git("config", "user.email", "m4@example.invalid");
  git("config", "user.name", "M4");
  for (const [path, text] of [
    ["src/a.ts", "export const a = 1;\n"],
    ["src/b.ts", "export const b = 1;\n"],
    ["src/z.ts", "export const z = 1;\n"],
    ["test/a.test.ts", "import { a } from '../src/a';\n"],
    ["docs/readme.md", "intro\n"],
    ["docs/new\nline.md", "newline\n"],
    ["src/한글.ts", "export const k = 1;\n"],
  ]) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  c0 = commit("base");
  tree0 = git("rev-parse", `${c0}^{tree}`);

  writeFileSync(join(repo, "src/a.ts"), "export const a = 2;\n");
  c1 = commit("change a");

  writeFileSync(join(repo, "docs/readme.md"), "intro\nmore\n");
  c2 = commit("change docs");

  writeFileSync(join(repo, "src/z.ts"), "export const z = 2;\n");
  c3 = commit("change z");

  writeFileSync(join(repo, "src/b.ts"), "export const b = 2;\n");
  c4 = commit("change b");

  writeFileSync(join(repo, "src/한글.ts"), "export const k = 2;\n");
  c5 = commit("change a non-ascii path");
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe("reuse-check CLI", () => {
  test("an unchanged tree is VALID", () => {
    const path = writeReceipt(evidence, laneName("verify_lane", "tests", c0), receipt());
    const result = run([path, "--head", c0, "--repo", repo]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("VALID tree");
  });

  test("a changed file inside the scope is STALE", () => {
    const path = writeReceipt(evidence, laneName("verify_lane", "tests", c0), receipt());
    const result = run([path, "--head", c1, "--repo", repo]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("STALE changed files inside scope: src/a.ts");
  });

  test("a change outside the scope is VALID and says what it compared", () => {
    const path = writeReceipt(evidence, laneName("verify_lane", "tests", c1), receipt({ head: c1, tree: git("rev-parse", `${c1}^{tree}`) }));
    const result = run([path, "--head", c2, "--repo", repo]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("VALID no changed file falls inside scope (1 changed paths, no referrer list supplied)");
  });

  test("a referrer inside the scope makes an otherwise untouched lane STALE", () => {
    const path = writeReceipt(evidence, laneName("verify_lane", "tests", c2), receipt({ head: c2, tree: git("rev-parse", `${c2}^{tree}`), scope: ["test/**"] }));
    const referrers = join(evidence, "referrers.json");
    writeFileSync(referrers, JSON.stringify([join(repo, "test/a.test.ts")]));
    const stale = run([path, "--head", c3, "--repo", repo, "--referrers", referrers]);
    expect(stale.code).toBe(1);
    expect(stale.stdout).toContain("referenced by files inside scope: test/a.test.ts");
    const empty = join(evidence, "no-referrers.json");
    writeFileSync(empty, "[]");
    const valid = run([path, "--head", c3, "--repo", repo, "--referrers", empty]);
    expect(valid.code).toBe(0);
    expect(valid.stdout).toContain("0 referrers checked");
  });

  test("a root-directory scope covers every changed path", () => {
    const path = writeReceipt(evidence, laneName("verify_lane", "root", c0), receipt({ lane: "root", scope: ["."] }));
    const result = run([path, "--head", c5, "--repo", repo]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("STALE changed files inside scope:");
  });

  test("a referrer whose path contains a newline is still matched", () => {
    const path = writeReceipt(evidence, laneName("verify_lane", "docs", c4), receipt({
      lane: "docs",
      head: c4,
      tree: git("rev-parse", `${c4}^{tree}`),
      scope: ["docs/**"],
    }));
    const referrers = join(evidence, "referrers-newline.json");
    writeFileSync(referrers, JSON.stringify(["docs/new\nline.md"]));
    const result = run([path, "--head", c5, "--repo", repo, "--referrers", referrers]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("referenced by files inside scope: docs/new\nline.md");
  });

  test("a design receipt without a surface artifact hash is never reusable", () => {
    const path = writeReceipt(evidence, laneName("verify_lane", "capture-plain", c0), receipt({
      type: "design",
      lane: "capture-plain",
      env_sha: undefined,
    }));
    const result = run([path, "--head", c0, "--repo", repo, "--env-sha", ENV_A]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("records no env_sha to verify");
  });

  test("a bracket-class scope matches the files it names", () => {
    const path = writeReceipt(evidence, laneName("verify_lane", "bracket", c3), receipt({
      lane: "bracket",
      head: c3,
      tree: git("rev-parse", `${c3}^{tree}`),
      scope: ["src/[ab].ts"],
    }));
    const result = run([path, "--head", c4, "--repo", repo]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("src/b.ts");
  });

  test("a scope that only parses before normalization exits 3 without a stack trace", () => {
    const path = writeReceipt(evidence, laneName("verify_lane", "normalized", c0), receipt({
      lane: "normalized",
      scope: ["[A-\\]*"],
    }));
    const result = run([path, "--head", c0, "--repo", repo]);
    expect(result.code).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toStartWith("FAIL ");
    expect(result.stderr).not.toContain("SyntaxError");
    expect(result.stderr).not.toContain("    at ");
    expect(() => compileScope(["[A-\\]*"])).toThrow();
  });

  test("an unterminated bracket class in a scope is a state failure", () => {
    const path = writeReceipt(evidence, laneName("verify_lane", "badscope", c0), receipt({
      lane: "badscope",
      scope: ["src/[ab.ts"],
    }));
    const result = run([path, "--head", c0, "--repo", repo]);
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("unterminated bracket class");
  });

  test("a changed non-ASCII path inside the scope is still a hit", () => {
    const path = writeReceipt(evidence, laneName("verify_lane", "unicode", c4), receipt({ head: c4, tree: git("rev-parse", `${c4}^{tree}`), lane: "unicode" }));
    const result = run([path, "--head", c5, "--repo", repo]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("src/한글.ts");
  });

  test("the changed files are listed in a stable order", () => {
    const path = writeReceipt(evidence, laneName("verify_lane", "tests", c1), receipt({ head: c1, tree: git("rev-parse", `${c1}^{tree}`) }));
    const result = run([path, "--head", c4, "--repo", repo]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("changed files inside scope: src/b.ts, src/z.ts");
  });

  test("a mixed run takes its primary type's identity form", () => {
    const researchHead = writeReceipt(evidence, `claim-gate-${ARTIFACT_A.slice(0, 7)}.json`, {
      kind: "claim-gate",
      type: "mixed",
      primary: "research",
      secondary: "code",
      unit: "u9",
      program_id: null,
      lane: "claim-gate",
      head: ARTIFACT_A,
      tree: null,
      scope: ["report.html"],
      started_at: "2026-10-27T16:30:00Z",
      ended_at: "2026-10-27T16:33:00Z",
      status: "PASS",
      rows: [],
      artifacts: [],
      cleanup: [],
    });
    const same = run([researchHead, "--head", ARTIFACT_A, "--repo", repo]);
    expect(same.code).toBe(0);
    expect(same.stdout).toContain("VALID artifact sha256");
    const changed = run([researchHead, "--head", ARTIFACT_B, "--repo", repo]);
    expect(changed.code).toBe(1);

    const commitHead = writeReceipt(evidence, laneName("verify_lane", "mixed", c0), receipt({
      type: "mixed",
      primary: "code",
      secondary: "design",
      lane: "mixed",
    }));
    const tree = run([commitHead, "--head", c0, "--repo", repo]);
    expect(tree.code).toBe(0);
    expect(tree.stdout).toContain("VALID tree");
  });

  test("a before receipt is exempt even when its head is gone", () => {
    const path = writeReceipt(evidence, `before-G1-${"8".repeat(40).slice(0, 7)}.json`, receipt({
      kind: "before",
      gap: "G1",
      head: "9".repeat(40),
      tree: "8".repeat(40),
    }));
    const result = run([path, "--head", c2, "--repo", repo]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("VALID a before receipt is exempt");
  });

  test("a research receipt compares the frozen artifact sha256", () => {
    const path = writeReceipt(evidence, `claim-gate-${ARTIFACT_A.slice(0, 7)}.json`, {
      kind: "claim-gate",
      type: "research",
      unit: "u3",
      program_id: null,
      lane: "claim-gate",
      head: ARTIFACT_A,
      tree: null,
      scope: ["report.html"],
      started_at: "2026-10-27T16:30:00Z",
      ended_at: "2026-10-27T16:33:00Z",
      status: "PASS",
      rows: [],
      artifacts: [],
      cleanup: [],
    });
    const same = run([path, "--head", ARTIFACT_A, "--repo", repo]);
    expect(same.code).toBe(0);
    expect(same.stdout).toContain("VALID artifact sha256");
    const changed = run([path, "--head", ARTIFACT_B, "--repo", repo]);
    expect(changed.code).toBe(1);
    expect(changed.stdout).toContain("STALE artifact sha256 changed");
  });

  test("a design receipt is also bound to the surface artifact hash", () => {
    const path = writeReceipt(evidence, laneName("verify_lane", "capture", c0), receipt({
      type: "design",
      lane: "capture",
      env_sha: ENV_A,
    }));
    const same = run([path, "--head", c0, "--repo", repo, "--env-sha", ENV_A]);
    expect(same.code).toBe(0);
    expect(same.stdout).toContain("VALID tree");
    const rebuilt = run([path, "--head", c0, "--repo", repo, "--env-sha", ENV_B]);
    expect(rebuilt.code).toBe(1);
    expect(rebuilt.stdout).toContain("STALE surface artifact changed");
    const unverified = run([path, "--head", c0, "--repo", repo]);
    expect(unverified.code).toBe(1);
    expect(unverified.stdout).toContain("pass --env-sha");
  });

  test("--base-impact adds the paths the base move touched", () => {
    const path = writeReceipt(evidence, laneName("verify_lane", "tests", c1), receipt({ head: c1, tree: git("rev-parse", `${c1}^{tree}`) }));
    const clean = run([path, "--head", c2, "--repo", repo]);
    expect(clean.code).toBe(0);
    const impacted = run([path, "--head", c2, "--repo", repo, "--base-impact", `${c0}..${c1}`]);
    expect(impacted.code).toBe(1);
    expect(impacted.stdout).toContain("src/a.ts");
  });

  test("--tree pins the tree instead of resolving it", () => {
    const path = writeReceipt(evidence, laneName("verify_lane", "tests", c0), receipt());
    const result = run([path, "--head", c1, "--repo", repo, "--tree", tree0]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("VALID tree");
  });

  test("a markdown receipt is read from its flat front matter", () => {
    const markdown = `---
kind: lane
stage: verify_lane
type: code
unit: u1
program_id: null
lane: tests
head: ${c0}
tree: ${tree0}
scope: [src/**, "test fixtures/**"]
started_at: "2026-10-27T16:00:00Z"
ended_at: 2026-10-27T16:01:00Z
status: PASS
rows: []
artifacts: []
cleanup: []
---

# tests lane

The suite was green at ${c0.slice(0, 7)}.
`;
    const path = join(evidence, laneName("verify_lane", "tests", c0).replace(/\.json$/, ".md"));
    writeFileSync(path, markdown);
    const result = run([path, "--head", c0, "--repo", repo]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("VALID tree");
  });

  test("an unreadable, invalid or foreign receipt exits 3", () => {
    expect(run([join(evidence, "absent.json"), "--head", c0, "--repo", repo]).code).toBe(3);
    const broken = join(evidence, laneName("verify_lane", "broken", c0));
    writeFileSync(broken, "{not json");
    expect(run([broken, "--head", c0, "--repo", repo]).code).toBe(3);
    const mismatched = writeReceipt(evidence, `verify_lane-tests-${"1".repeat(7)}.json`, receipt());
    expect(run([mismatched, "--head", c0, "--repo", repo]).code).toBe(3);
    const path = writeReceipt(evidence, laneName("verify_lane", "tests", c0), receipt());
    expect(run([path, "--head", c0, "--repo", repo, "--unit", "u2"]).code).toBe(3);
    const foreign = writeReceipt(outside, laneName("verify_lane", "tests", c0), receipt());
    expect(run([foreign, "--head", c0, "--repo", repo, "--evidence-root", evidence]).code).toBe(3);
    expect(run([path, "--head", c0, "--repo", repo, "--evidence-root", evidence]).code).toBe(0);
  });

  test("usage mistakes exit 2", () => {
    const path = writeReceipt(evidence, laneName("verify_lane", "tests", c0), receipt());
    expect(run([path, "--repo", repo]).code).toBe(2);
    expect(run([path, "--head", c0.slice(0, 7), "--repo", repo]).code).toBe(2);
    expect(run([path, "--head", c0, "--repo", repo, "--env-sha", "nope"]).code).toBe(2);
    expect(run([path, "--head", c0, "--repo", repo, "--base-impact", "one-rev"]).code).toBe(2);
    expect(run([path, "--head", ARTIFACT_A, "--repo", repo]).code).toBe(2);
    expect(run([path, "--head", c0, "--repo", repo, "--bogus"]).code).toBe(2);
    expect(run(["--head", c0]).code).toBe(2);
  });

  test("--help exits 0", () => {
    const result = run(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("usage: reuse-check.mjs");
    expect(result.stdout).toContain("VALID");
  });
});

describe("reuse-check helpers", () => {
  test("scope entries cover a path and its children, never a sibling prefix", () => {
    expect(scopeMatches("src/foo.ts", "src/foo.ts")).toBe(true);
    expect(scopeMatches("src/foo/bar.ts", "src/foo")).toBe(true);
    expect(scopeMatches("src/foobar.ts", "src/foo")).toBe(false);
    expect(scopeMatches("test/a.test.ts", "test/**")).toBe(true);
    expect(scopeMatches("test/deep/a.test.ts", "test/**")).toBe(true);
    expect(scopeMatches("tests/a.ts", "test/**")).toBe(false);
    expect(scopeMatches("src/a.ts", "src/*.ts")).toBe(true);
    expect(scopeMatches("src/deep/a.ts", "src/*.ts")).toBe(false);
    expect(scopeMatches("README.md", "*.md")).toBe(true);
    expect(scopeMatches("docs/x.md", "*.md")).toBe(false);
    expect(globToRegExp("src/**/x.ts").test("src/x.ts")).toBe(true);
    expect(globToRegExp("src/**/x.ts").test("src/a/b/x.ts")).toBe(true);
    expect(globToRegExp("docs/**").test("docs/new\nline.md")).toBe(true);
    expect(scopeMatches("anything/at/all.ts", ".")).toBe(true);
    expect(scopeMatches("skills/wish/scripts/check-verdict.mjs", "skills/wish/scripts/[cp]*.mjs")).toBe(true);
    expect(scopeMatches("skills/wish/scripts/readme.mjs", "skills/wish/scripts/[cp]*.mjs")).toBe(false);
    expect(globToRegExp("a[!b]c").test("adc")).toBe(true);
    expect(globToRegExp("a[!b]c").test("abc")).toBe(false);
    expect(scopeHits(["b", "a", "a"], compileScope(["**"]))).toEqual(["a", "b"]);
  });

  test("the decision order is before, research, surface hash, tree, changed paths, referrers", () => {
    const base = receipt();
    expect(decideReuse({ receipt: { ...base, kind: "before" }, head: c1, tree: tree0 }).verdict).toBe("VALID");
    expect(decideReuse({
      receipt: { ...base, type: "research", head: ARTIFACT_A, tree: null },
      head: ARTIFACT_B,
      tree: null,
    }).verdict).toBe("STALE");
    expect(decideReuse({ receipt: { ...base, env_sha: ENV_A }, head: c0, tree: tree0 }).verdict).toBe("STALE");
    expect(decideReuse({ receipt: base, head: c0, tree: tree0 }).verdict).toBe("VALID");
    expect(decideReuse({ receipt: base, head: c1, tree: "f".repeat(40), changed: ["src/a.ts"] }).verdict).toBe("STALE");
    expect(decideReuse({
      receipt: { ...base, scope: ["test/**"] },
      head: c1,
      tree: "f".repeat(40),
      changed: ["src/a.ts"],
      referrers: ["test/a.test.ts"],
    }).verdict).toBe("STALE");
  });

  test("the front matter reader accepts only the flat receipt subset", () => {
    expect(parseFrontMatter("---\nkind: lane\nprogram_id: null\nscope: [a, \"b c\"]\nrows: []\n---\nbody\n"))
      .toEqual({ kind: "lane", program_id: null, scope: ["a", "b c"], rows: [] });
    expect(() => parseFrontMatter("---\nkind: lane\n---\n")).not.toThrow();
    expect(() => parseFrontMatter("kind: lane\n---\n")).toThrow("must open with a --- front matter line");
    expect(() => parseFrontMatter("---\nkind: lane\n")).toThrow("not closed");
    expect(() => parseFrontMatter("---\nscope:\n  - a\n---\n")).toThrow("flat key: value");
    expect(() => parseFrontMatter("---\nscope: [a, b\n---\n")).toThrow("unterminated list");
    expect(() => parseFrontMatter("---\nkind: lane\nkind: other\n---\n")).toThrow("repeats kind");
  });
});