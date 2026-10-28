import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEvent, codeReviewAt, computeStatus, mergeFrontMatter, rootPaths, writeFrontMatter,
} from "../skills/wish/scripts/lib/store.mjs";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "1111111111111111111111111111111111111111";
const TREE = "89abcdef0123456789abcdef0123456789abcdef";
const AT = "2026-10-28T12:00:00Z";
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scene() {
  const root = mkdtempSync(join(tmpdir(), "stage-order-"));
  roots.push(root);
  const planPath = join(root, "plan.md");
  writeFrontMatter(planPath, {
    run_id: "w-order-20261028-1200", type: "code", tier: "M", unit: "u1", program_id: null,
    worktree: root, branch: "unit", pr: 1, frozen_head: HEAD, round: 0,
  });
  const state = { root, planPath };
  record(state, { event: "intake", tier: "M", facts: ["one unit"] });
  record(state, { event: "freeze", head: HEAD, tree: TREE, pr: 1 });
  record(state, { event: "pr_open", head: HEAD, pr: 1 });
  return state;
}

function record(state, input) {
  return appendEvent(state.root, {
    type: "code", unit: "u1", program_id: null, plan: state.planPath,
    session_id: "senpi:order-test", started_at: AT, ...input,
  });
}

function lane(state, name, patch = {}) {
  const body = {
    kind: "lane", stage: "verify_lane", type: "code", unit: "u1", program_id: null,
    lane: name, head: HEAD, tree: TREE, scope: ["src/**"], started_at: AT, ended_at: AT,
    status: "PASS", rows: [], artifacts: [], cleanup: [], ...patch,
  };
  const dir = rootPaths(state.root).receipts;
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${body.stage}-${name}-${body.head.slice(0, 7)}.json`);
  writeFileSync(file, JSON.stringify(body));
  return file;
}

function view(state) {
  return computeStatus({ root: state.root, planPath: state.planPath, head: HEAD, tree: TREE });
}

function cli(state, args, input) {
  const result = spawnSync(process.execPath, [
    join(import.meta.dir, "..", "skills", "wish", "scripts", "wish.mjs"),
    ...args, "--root", state.root,
  ], { cwd: process.cwd(), encoding: "utf8", input, timeout: 10_000 });
  if (result.error) throw result.error;
  return result;
}

function cliScene({ frozen = false, reviewed = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "round-order-"));
  roots.push(root);
  const state = { root, planPath: join(root, "plan.md") };
  const initialized = cli(state, [
    "init", "--plan", state.planPath, "--run-id", "w-order-20261028-1400",
    "--type", "code", "--tier", "M", "--worktree", process.cwd(), "--fact", "review order",
  ]);
  expect(initialized.status).toBe(0);
  const observed = cli(state, ["status", "--json"]);
  expect(observed.status).toBe(0);
  const { head, tree } = JSON.parse(observed.stdout);
  if (frozen) {
    record(state, { event: "freeze", head, tree, pr: 1 });
    mergeFrontMatter(state.planPath, { frozen_head: head });
  }
  if (reviewed) lane(state, "code-review", { head, tree });
  return { ...state, head, tree };
}

function roundEntries(state) {
  return [
    cli(state, ["ledger", "append", "--event", "round", "--json", "-"],
      JSON.stringify({ event: "round", round: 1, verdict: "REVISE", head: state.head })),
    cli(state, ["gate", "--round", "1"]),
  ];
}

test("round append refuses a code unit without a frozen head", () => {
  const state = cliScene();
  const result = cli(state, ["ledger", "append", "--event", "round", "--json", "-"],
    JSON.stringify({ event: "round", round: 1, verdict: "REVISE", head: state.head }));
  expect(result.status).toBe(3);
  expect(result.stderr).toContain("out of stage order: freeze missing before round");
  record(state, { event: "pr_open", head: state.head, pr: 1 });
  const status = cli(state, ["status", "--json"]);
  expect(JSON.parse(status.stdout).blocking).toContain("order:freeze missing before round");
  expect(cli(state, ["resume-plan"]).stdout).toContain("freeze the head, then run the code-review lane");
});

test("round dispatch refuses a code unit without a frozen head", () => {
  const state = cliScene();
  const result = cli(state, ["gate", "--round", "1"]);
  expect(result.status).toBe(3);
  expect(result.stderr).toContain("out of stage order: freeze missing before round");
});

test("both round entries refuse a frozen head without code review", () => {
  const state = cliScene({ frozen: true });
  const results = roundEntries(state);
  expect(results.map((result) => result.status)).toEqual([3, 3]);
  for (const result of results) {
    expect(result.stderr).toContain(`out of stage order: code-review missing at ${state.head.slice(0, 7)}`);
  }
});

test("both round entries accept code review at the frozen head", () => {
  const state = cliScene({ frozen: true, reviewed: true });
  const results = roundEntries(state);
  expect(results.map((result) => result.status)).toEqual([0, 0]);
});

test("round refuses without code review at the frozen head and accepts PASS or WARN", () => {
  for (const status of ["PASS", "WARN"]) {
    const state = scene();
    for (const name of ["tests", "qa", "sweep"]) lane(state, name);
    // Same-tree evidence and an explicit reuse verdict still lack review of HEAD.
    lane(state, "code-review", { head: OTHER });
    record(state, {
      event: "reuse", head: HEAD,
      reuse: { receipt: `verify_lane-code-review-${OTHER.slice(0, 7)}.json`, verdict: "VALID", reason: "same scope" },
    });
    const round = { event: "round", round: 1, verdict: "APPROVED", head: HEAD };
    const before = readFileSync(rootPaths(state.root).ledger, "utf8");
    expect(view(state).status.next).toBe("verify_lane");
    expect(view(state).status.blocking).toContain(`order:code-review missing at ${HEAD.slice(0, 7)}`);
    expect(() => record(state, round)).toThrow(`out of stage order: code-review missing at ${HEAD.slice(0, 7)}`);
    expect(readFileSync(rootPaths(state.root).ledger, "utf8")).toBe(before);
    for (const invalid of [
      { unit: "u2" }, { status: "FAIL" }, { status: "SKIP" },
      { tree: OTHER }, { scope: [] }, { stage: "plan_review" },
    ]) {
      const file = lane(state, "code-review", invalid);
      expect(() => record(state, round)).toThrow("out of stage order: code-review missing at");
      rmSync(file);
    }
    lane(state, "code-review", { status });
    const reviewed = view(state);
    expect(codeReviewAt(reviewed.receipts, "u1", HEAD)).toHaveLength(1);
    expect(reviewed.status.blocking).not.toContain(`order:code-review missing at ${HEAD.slice(0, 7)}`);
    expect(reviewed.status.next).toBe("round");
    expect(record(state, round)).toMatchObject({ event: "round", round: 1 });
  }
});

test("REVISE returns through define plan and plan_lint for its own round before lanes", () => {
  const state = scene();
  lane(state, "code-review");
  for (const event of [
    { event: "define", round: 0 },
    { event: "plan", round: 0, artifact: state.planPath },
    { event: "plan_lint", round: 0, verdict: "PASS" },
    { event: "intake", unit: "u2", tier: "M", facts: ["sibling"] },
    { event: "define", unit: "u2", round: 1 },
    { event: "plan", unit: "u2", round: 1, artifact: state.planPath },
    { event: "plan_lint", unit: "u2", round: 1, verdict: "PASS" },
  ]) record(state, event);
  record(state, { event: "round", round: 1, verdict: "REVISE", head: HEAD });
  expect(view(state).status.next).toBe("define");
  record(state, { event: "define", round: 1 });
  expect(view(state).status.next).toBe("plan");
  record(state, { event: "plan", round: 1, artifact: state.planPath });
  expect(view(state).status.next).toBe("plan_lint");
  record(state, { event: "plan_lint", round: 1, verdict: "PASS" });
  expect(view(state).status.next).toBe("verify_lane");
  for (const name of ["tests", "qa", "sweep"]) lane(state, name);
  expect(view(state).status.next).toBe("round");
  record(state, { event: "round", round: 2, verdict: "REVISE", head: HEAD });
  expect(view(state).status.next).toBe("define");
});
