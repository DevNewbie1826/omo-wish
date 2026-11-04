import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FINDINGS_COLUMNS } from "../skills/wish/scripts/lib/schema.mjs";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "../skills/wish/scripts/wish.mjs");
const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 60000 });
  if (result.error) throw result.error;
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function scene() {
  const dir = mkdtempSync(join(tmpdir(), "wish-planless-gate-"));
  dirs.push(dir);
  const work = join(dir, "work");
  const root = join(dir, "evidence");
  const plan = join(dir, "plan.md");
  mkdirSync(work);
  const git = (...args) => {
    const result = run("git", ["-C", work, ...args], dir);
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
  const cli = (...args) => run(process.execPath, [cliPath, ...args, "--root", root], dir);
  const init = cli("init", "--run-id", "w-test-20261104-0001", "--type", "code", "--tier", "M",
    "--plan", plan, "--worktree", work, "--branch", "fixture", "--fact", "fixture");
  expect(init.code).toBe(0);
  const events = [
    { event: "collect", sources: 1, elements: 1, report: join(root, "collect.md") },
    { event: "define", round: 0, ideal: 1, gaps: 0, report: join(root, "define.md") },
    { event: "plan", artifact: plan },
    { event: "plan_lint", verdict: "PASS", artifact: join(root, "receipts", "lint-plan-89abcde.json") },
    { event: "plan_review", verdict: "OKAY", artifact: join(root, "receipts", "plan_review-architect-0123456.md") },
    { event: "decide", count: 0, gates: [], recommended: [] },
    { event: "goal", artifact: "goal:test" },
    { event: "build", task: "node-1", head },
  ];
  for (const event of events) {
    const file = join(dir, "event.json");
    writeFileSync(file, JSON.stringify(event));
    const result = cli("ledger", "append", "--event", event.event, "--json", file);
    if (result.code !== 0) throw new Error(result.err);
  }
  expect(cli("freeze", "--head", head).code).toBe(0);
  mkdirSync(join(root, "receipts"), { recursive: true });
  const review = {
    kind: "lane", stage: "verify_lane", type: "code", unit: "u1", program_id: null,
    lane: "code-review", head, tree, scope: [plan],
    started_at: "2026-10-27T16:00:00Z", ended_at: "2026-10-27T16:01:00Z",
    status: "PASS", rows: [], artifacts: [], cleanup: [],
  };
  writeFileSync(join(root, "receipts", `verify_lane-code-review-${head.slice(0, 7)}.json`), JSON.stringify(review));
  return { cli, dir, root, plan, head };
}

function addBlocker(state) {
  const row = {
    id: "F1", round: "0", source: "ultrabrain", class: "C", severity: "HIGH",
    file_line: "src/a.mjs:4", blocking: "1", repro_cmd: "exit 1", head_found: state.head,
    status: "open", fixed_head: "-",
  };
  const file = join(state.dir, "findings.tsv");
  writeFileSync(file, [FINDINGS_COLUMNS.join("\t"), FINDINGS_COLUMNS.map((column) => row[column]).join("\t")].join("\n"));
  expect(state.cli("findings", "add", "--tsv", file).code).toBe(0);
}

test("dispatch passes from ledger identity when the plan is gone", () => {
  const state = scene();
  rmSync(state.plan);
  const result = state.cli("gate", "--round", "1");
  expect(result.code).toBe(0);
  expect(result.out).toMatch(/\bPASS\b/);
  const receipt = JSON.parse(readFileSync(join(state.root, "receipts", `gate-dispatch-${state.head.slice(0, 7)}.json`), "utf8"));
  expect(receipt.status).toBe("PASS");
  expect(receipt.scope).toEqual([state.plan]);
});

test("dispatch blocks a reproducing finding when the plan is gone", () => {
  const state = scene();
  addBlocker(state);
  rmSync(state.plan);
  const result = state.cli("gate", "--round", "1");
  expect(result.code).toBe(3);
  expect(result.out).toMatch(/\bBLOCKED\b/);
  const receipt = JSON.parse(readFileSync(join(state.root, "receipts", `gate-dispatch-${state.head.slice(0, 7)}.json`), "utf8"));
  expect(receipt.status).toBe("FAIL");
});

test("freeze check holds from ledger identity without writing", () => {
  const state = scene();
  rmSync(state.plan);
  const before = readFileSync(join(state.root, "ledger.jsonl"), "utf8");
  const result = state.cli("freeze", "--check");
  expect(result.code).toBe(0);
  expect(result.out).toContain(state.head.slice(0, 7));
  expect(readFileSync(join(state.root, "ledger.jsonl"), "utf8")).toBe(before);
});

test("freeze and pr-body fail closed when the plan is gone", () => {
  const state = scene();
  rmSync(state.plan);
  expect(state.cli("freeze").code).toBe(3);
  expect(state.cli("pr-body").code).toBe(3);
});

test("planful dispatch and freeze check retain their behavior", () => {
  const state = scene();
  expect(state.cli("freeze", "--check").code).toBe(0);
  addBlocker(state);
  const result = state.cli("gate", "--round", "1");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/\bBLOCKED\b/);
});

test("planful commands reject invalid plan front matter", () => {
  const state = scene();
  writeFileSync(state.plan, "invalid\n");
  expect(state.cli("gate", "--round", "1").code).toBe(3);
  expect(state.cli("freeze", "--check").code).toBe(3);
});
