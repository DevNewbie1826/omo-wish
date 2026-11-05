import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvent, withLock } from "../skills/wish/scripts/lib/store.mjs";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "../skills/wish/scripts/wish.mjs");
const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function scene() {
  const dir = mkdtempSync(join(tmpdir(), "wish-planless-round-"));
  dirs.push(dir);
  const work = join(dir, "work");
  const root = join(dir, "evidence");
  const plan = join(dir, "plan.md");
  mkdirSync(work);
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: dir, encoding: "utf8", timeout: 60000 });
    if (result.error) throw result.error;
    return { code: result.status, out: result.stdout, err: result.stderr };
  };
  const git = (...args) => {
    const result = run("git", ["-C", work, ...args]);
    if (result.code !== 0) throw new Error(result.err);
    return result.out.trim();
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "wish@example.invalid");
  git("config", "user.name", "wish test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(work, "file"), "content\n");
  git("add", "file");
  git("commit", "-q", "-m", "initial");
  const head = git("rev-parse", "HEAD");
  const tree = git("rev-parse", "HEAD^{tree}");
  const cli = (...args) => run(process.execPath, [cliPath, ...args, "--root", root]);
  const init = cli("init", "--run-id", "w-test-20261104-0001", "--type", "code", "--tier", "M",
    "--plan", plan, "--worktree", work, "--branch", "fixture", "--fact", "fixture");
  expect(init.code).toBe(0);
  const append = (event) => {
    const file = join(dir, "event.json");
    writeFileSync(file, JSON.stringify(event));
    return cli("ledger", "append", "--event", event.event, "--json", file);
  };
  // Setup events go through the library call the `ledger append` verb wraps,
  // with the same envelope that verb builds, so a fixture costs file writes
  // instead of one process spawn per event. Assertion paths keep the spawned
  // `append`.
  const appendFast = (event) => {
    const session = process.env.SENPI_SESSION_ID ?? process.env.WISH_SESSION_ID ?? "senpi:wish-cli";
    const envelope = { type: "code", unit: "u1", program_id: null, plan, session_id: session, ...event, event: event.event };
    withLock(root, () => appendEvent(root, envelope, { plan }));
  };
  for (const event of [
    { event: "collect", sources: 1, elements: 1, report: join(root, "collect.md") },
    { event: "define", round: 0, ideal: 1, gaps: 0, report: join(root, "define.md") },
    { event: "plan", artifact: plan },
    { event: "plan_lint", verdict: "PASS", artifact: join(root, "receipts", "lint-plan-89abcde.json") },
    { event: "plan_review", verdict: "OKAY", artifact: join(root, "receipts", "plan_review-architect-0123456.md") },
    { event: "decide", count: 0, gates: [], recommended: [] },
    { event: "goal", artifact: "goal:test" },
    { event: "build", task: "node-1", head },
  ]) {
    appendFast(event);
  }
  expect(cli("freeze", "--head", head).code).toBe(0);
  mkdirSync(join(root, "receipts"), { recursive: true });
  writeFileSync(join(root, "receipts", `verify_lane-code-review-${head.slice(0, 7)}.json`), JSON.stringify({
    kind: "lane", stage: "verify_lane", type: "code", unit: "u1", program_id: null,
    lane: "code-review", head, tree, scope: [plan],
    started_at: "2026-10-27T16:00:00Z", ended_at: "2026-10-27T16:01:00Z",
    status: "PASS", rows: [], artifacts: [], cleanup: [],
  }));
  return { cli, append, appendFast, plan, head, root, work, git };
}

function latestScene() {
  const state = scene();
  state.appendFast({ event: "pr_open", pr: 11, head: state.head });
  state.appendFast({ event: "round", round: 1, verdict: "REVISE", head: state.head });
  writeFileSync(join(state.work, "file"), "second commit\n");
  state.git("add", "file");
  state.git("commit", "-q", "-m", "second");
  const head = state.git("rev-parse", "HEAD");
  const tree = state.git("rev-parse", "HEAD^{tree}");
  expect(state.cli("freeze", "--head", head).code).toBe(0);
  state.appendFast({ event: "pr_open", pr: 22, head });
  writeFileSync(join(state.root, "receipts", `verify_lane-code-review-${head.slice(0, 7)}.json`), JSON.stringify({
    kind: "lane", stage: "verify_lane", type: "code", unit: "u1", program_id: null,
    lane: "code-review", head, tree, scope: [state.plan],
    started_at: "2026-10-27T16:00:00Z", ended_at: "2026-10-27T16:01:00Z",
    status: "PASS", rows: [], artifacts: [], cleanup: [],
  }));
  return { ...state, latestHead: head, latestTree: tree };
}

test("round append succeeds after dispatch when the plan is absent", () => {
  const state = scene();
  rmSync(state.plan);
  const gate = state.cli("gate", "--round", "1");
  expect(gate.code).toBe(0);
  expect(gate.out).toMatch(/\bPASS\b/);
  const round = state.append({ event: "round", round: 1, verdict: "APPROVED", head: state.head });
  expect(round.code).toBe(0);
  expect(JSON.parse(readFileSync(join(state.root, "ledger.jsonl"), "utf8").trim().split("\n").at(-1)))
    .toMatchObject({ event: "round", round: 1, head: state.head });
});

test("round append enforces the plan frozen head when the plan exists", () => {
  const state = scene();
  const other = "b".repeat(40);
  writeFileSync(state.plan, readFileSync(state.plan, "utf8").replace(`frozen_head: ${state.head}`, `frozen_head: ${other}`));
  const before = readFileSync(join(state.root, "ledger.jsonl"), "utf8");
  const round = state.append({ event: "round", round: 1, verdict: "APPROVED", head: state.head });
  expect(round.code).toBe(3);
  expect(round.err).toContain(`code-review missing at ${other.slice(0, 7)}`);
  expect(readFileSync(join(state.root, "ledger.jsonl"), "utf8")).toBe(before);
});

test("status uses the latest PR and round after multiple records", () => {
  const state = latestScene();
  rmSync(state.plan);
  expect(state.append({ event: "round", round: 2, verdict: "APPROVED", head: state.latestHead }).code).toBe(0);
  const result = state.cli("status", "--json");
  expect(result.code).toBe(0);
  expect(JSON.parse(result.out).units.find((unit) => unit.id === "u1")).toMatchObject({ pr: 22, round: 2 });
});

test("pr-body renders the latest freeze head and tree", () => {
  const state = latestScene();
  const result = state.cli("pr-body");
  expect(result.code).toBe(0);
  expect(result.out).toContain(`Frozen head: ${state.latestHead}  tree: ${state.latestTree}`);
});

test("planless round append uses the latest freeze review", () => {
  const state = latestScene();
  rmSync(join(state.root, "receipts", `verify_lane-code-review-${state.head.slice(0, 7)}.json`));
  rmSync(state.plan);
  const result = state.append({ event: "round", round: 2, verdict: "APPROVED", head: state.latestHead });
  expect(result.code).toBe(0);
  expect(JSON.parse(readFileSync(join(state.root, "ledger.jsonl"), "utf8").trim().split("\n").at(-1)))
    .toMatchObject({ event: "round", round: 2, head: state.latestHead });
});
