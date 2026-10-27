// wish v2 - module M1: the state machine and CLI, exercised as a process.
//
// Every test drives the shipped entry point (`skills/wish/scripts/wish.mjs`)
// exactly as a session does - argv in, exit code and stdout out - because the
// exit code IS the contract (references/ledger.md §14) and an in-process call
// could not prove it. The fixtures under `test/fixtures/ledger/` are the M0
// contract's own machine-checked examples plus a plan template.

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLI_VERBS,
  FINDINGS_COLUMNS,
  GAPS_COLUMNS,
  formatProgressLine,
  parseFindingsTsv,
  parseGapsTsv,
  parseGatesMarkdown,
  parseProgressLine,
  validateReceipt,
  validateStatusJson,
} from "../skills/wish/scripts/lib/schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "skills", "wish", "scripts", "wish.mjs");
const LIB = join(HERE, "..", "skills", "wish", "scripts", "lib");
const FIXTURES = join(HERE, "fixtures", "ledger");

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "1111111111111111111111111111111111111111";
const TREE = "89abcdef0123456789abcdef0123456789abcdef";

const sandboxes = [];

afterEach(() => {
  while (sandboxes.length > 0) {
    const dir = sandboxes.pop();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // a leftover temp dir must never fail a test run
    }
  }
});

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "wish-cli-"));
  sandboxes.push(dir);
  return { dir, root: join(dir, "er"), plan: join(dir, "plan.md"), work: join(dir, "work") };
}

function cli(args, { cwd, env, input } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: cwd ?? HERE,
    timeout: 60_000,
    input,
    env: { ...process.env, ...env },
  });
  return { code: result.status, out: result.stdout ?? "", err: result.stderr ?? "", signal: result.signal };
}

function git(dir, args) {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function makeRepo(box, workName = "work") {
  const dir = join(box.dir, workName);
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "wish@example.invalid"]);
  git(dir, ["config", "user.name", "wish test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "README.md"), "one\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "one"]);
  writeFileSync(join(dir, "second.txt"), "two\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "two"]);
  return { dir, head: git(dir, ["rev-parse", "HEAD"]), tree: git(dir, ["rev-parse", "HEAD^{tree}"]) };
}

function commitFile(repo, name, content, message = "change") {
  writeFileSync(join(repo.dir, name), content);
  git(repo.dir, ["add", "-A"]);
  git(repo.dir, ["commit", "-q", "-m", message]);
  return { head: git(repo.dir, ["rev-parse", "HEAD"]), tree: git(repo.dir, ["rev-parse", "HEAD^{tree}"]) };
}

function planText({ runId, tier, type, unit, worktree, program = "null" }) {
  const template = readFileSync(join(FIXTURES, "plan-template.md"), "utf8");
  const lines = template.split("\n");
  const close = lines.indexOf("---", 1);
  const body = lines.slice(close + 1).join("\n");
  const front = [
    "---", "wish:",
    `  run_id: ${runId}`,
    `  tier: ${tier}`,
    `  type: ${type}`,
    `  unit: ${unit}`,
    `  program_id: ${program}`,
    `  worktree: ${worktree}`,
    "  branch: fixture",
    "  pr: null",
    "  frozen_head: null",
    "  round: 0",
    "---",
  ].join("\n");
  return `${front}\n${body}`;
}

function writePlan(path, options) {
  writeFileSync(path, planText(options));
}

function scene({ tier = "M", type = "code", unit = "u1", runId = "w-run-20261027-1600", initExtra = [], workName = "work" } = {}) {
  const box = sandbox();
  const repo = makeRepo(box, workName);
  writePlan(box.plan, { runId, tier, type, unit, worktree: repo.dir });
  const result = cli([
    "init", "--run-id", runId, "--type", type, "--tier", tier, "--plan", box.plan,
    "--root", box.root, "--unit", unit, "--worktree", repo.dir, "--branch", "fixture",
    "--fact", "one fact from the tier triage", ...initExtra,
  ]);
  expect(result.code).toBe(0);
  return { box, repo, root: box.root, plan: box.plan, runId, tier, type, unit };
}

function append(state, body) {
  const file = join(state.box.dir, `event-${Date.now()}-${Math.round(Math.random() * 1e6)}.json`);
  writeFileSync(file, JSON.stringify(body));
  return cli(["ledger", "append", "--event", body.event, "--json", file, "--root", state.root]);
}

function ledgerEvents(state) {
  const text = readFileSync(join(state.root, "ledger.jsonl"), "utf8");
  return text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
}

function status(state, extra = []) {
  const result = cli(["status", "--json", "--root", state.root, ...extra]);
  if (result.code !== 0) return { ...result, json: null };
  return { ...result, json: JSON.parse(result.out) };
}

function lane(state, { lane: name, status: verdict = "PASS", head, tree, unit, stage = "verify_lane", type = "code", rows }) {
  const dir = join(state.root, "receipts");
  mkdirSync(dir, { recursive: true });
  const body = {
    kind: "lane",
    stage,
    type,
    unit: unit ?? state.unit,
    program_id: null,
    lane: name,
    head: head ?? state.repo.head,
    tree: tree ?? state.repo.tree,
    scope: ["skills/wish/scripts/**"],
    started_at: "2026-10-27T16:00:00Z",
    ended_at: "2026-10-27T16:01:00Z",
    status: verdict,
    rows: rows ?? [{ id: `${name}-row`, command: "bun test", observable: "the suite is green", verdict: "PASS", artifact: null }],
    artifacts: [],
    cleanup: [],
  };
  const checked = validateReceipt(body);
  expect(checked.errors).toEqual([]);
  const file = join(dir, `${stage}-${name}-${String(body.head).slice(0, 7)}.json`);
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return { name: `${stage}-${name}-${String(body.head).slice(0, 7)}.json`, body, file };
}

function laneMarkdown(state, { lane: name = "architect", stage = "plan_review", status: verdict = "PASS" } = {}) {
  const dir = join(state.root, "receipts");
  mkdirSync(dir, { recursive: true });
  const text = [
    "---",
    "kind: lane",
    `stage: ${stage}`,
    "type: code",
    `unit: ${state.unit}`,
    "program_id: null",
    `lane: ${name}`,
    `head: ${state.repo.head}`,
    `tree: ${state.repo.tree}`,
    `scope: ${state.plan}`,
    "started_at: 2026-10-27T16:00:00Z",
    "ended_at: 2026-10-27T16:02:00Z",
    `status: ${verdict}`,
    "---",
    "",
    "OKAY: prose lane report.",
    "",
  ].join("\n");
  const file = join(dir, `${stage}-${name}-${state.repo.head.slice(0, 7)}.md`);
  writeFileSync(file, text);
  return { name: `${stage}-${name}-${state.repo.head.slice(0, 7)}.md`, file };
}

function addFindings(state, rows) {
  const file = join(state.box.dir, `findings-${Date.now()}.tsv`);
  writeFileSync(file, [FINDINGS_COLUMNS.join("\t"), ...rows.map((row) => FINDINGS_COLUMNS.map((column) => row[column]).join("\t"))].join("\n"));
  return cli(["findings", "add", "--tsv", file, "--root", state.root]);
}

function findingRow(overrides = {}) {
  return {
    id: "F1", round: "1", source: "ultrabrain", class: "C", severity: "HIGH",
    file_line: "src/a.mjs:4", blocking: "1", repro_cmd: "exit 3", head_found: HEAD,
    status: "open", fixed_head: "-", ...overrides,
  };
}

function addGaps(state, rows) {
  const file = join(state.box.dir, `gaps-${Date.now()}.tsv`);
  writeFileSync(file, [GAPS_COLUMNS.join("\t"), ...rows.map((row) => GAPS_COLUMNS.map((column) => row[column]).join("\t"))].join("\n"));
  return cli(["gaps", "add", "--tsv", file, "--root", state.root]);
}

function gapRow(overrides = {}) {
  return {
    id: "G1", area: "settings", surface: "/settings", rule: "skill:visual-qa:B1",
    current: "two primaries", ideal: "one primary", before_artifact: "/evidence/before-G1-89abcde.png",
    severity: "HIGH", kind: "defect", class: "B1", type: "design", unit: "u1",
    status: "planned", pr: "-", fixed_head: "-", ...overrides,
  };
}

// The build phase every status test needs: discover -> build, no lane receipts.
function upToBuild(state) {
  const steps = [
    { event: "discover", artifact: join(state.root, "receipts", "discover-explore-0123456.md") },
    { event: "plan", artifact: state.plan },
    { event: "plan_lint", verdict: "PASS", artifact: join(state.root, "receipts", "lint-plan-89abcde.json") },
    { event: "plan_review", verdict: "OKAY", artifact: join(state.root, "receipts", "plan_review-architect-0123456.md") },
    { event: "goal", artifact: "goal:w-run-u1" },
    { event: "build", task: "node-1", head: state.repo.head },
  ];
  for (const step of steps) {
    const result = append(state, step);
    expect(result.code).toBe(0);
  }
}

describe("help and usage contract", () => {
  test("every verb is listed and --help exits 0 on the verb and on the CLI", () => {
    const top = cli(["--help"]);
    expect(top.code).toBe(0);
    for (const verb of CLI_VERBS) {
      expect(top.out).toContain(verb);
      const one = cli([verb, "--help"]);
      expect(one.code).toBe(0);
      expect(one.out.length).toBeGreaterThan(20);
    }
    expect(CLI_VERBS.length).toBe(12);
  });

  test("runs its verbs when invoked through a symlink", () => {
    const box = sandbox();
    const link = join(box.dir, "wish-link.mjs");
    symlinkSync(CLI, link);
    for (const runtime of [process.execPath, "node"]) {
      const result = spawnSync(runtime, [link, "--help"], { encoding: "utf8" });
      if (result.error) throw result.error;
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("resume-plan");
    }
  });

  test("an unknown verb and an unknown flag are usage errors, never check failures", () => {
    expect(cli(["nope"]).code).toBe(2);
    const box = sandbox();
    expect(cli(["status", "--wat", "--root", box.root]).code).toBe(2);
  });

  test("no evidence root is a usage error, not a crash", () => {
    const result = cli(["status"], { env: { WISH_EVIDENCE_ROOT: "" } });
    expect(result.code).toBe(2);
    expect(result.err).toContain("--root");
  });
});

describe("init", () => {
  test("writes the front matter, creates the root and appends intake", () => {
    const state = scene();
    const front = readFileSync(state.plan, "utf8");
    expect(front.startsWith("---\nwish:\n")).toBe(true);
    expect(front).toContain(`  worktree: ${state.repo.dir}`);
    const events = ledgerEvents(state);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ event: "intake", stage: "intake", tier: "M", type: "code", unit: "u1" });
    expect(Array.isArray(events[0].facts)).toBe(true);
    expect(existsSync(state.root)).toBe(true);
    const reported = status(state);
    expect(reported.code).toBe(0);
    expect(validateStatusJson(reported.json).errors).toEqual([]);
    expect(reported.json.stage).toBe("intake");
    expect(reported.json.next).toBe("discover");
    expect(reported.json.blocking).toEqual([]);
  });

  test("is idempotent for the same run and refuses a second run on the same plan", () => {
    const state = scene();
    const again = cli([
      "init", "--run-id", state.runId, "--type", "code", "--tier", "M", "--plan", state.plan,
      "--root", state.root, "--unit", "u1", "--worktree", state.repo.dir, "--fact", "again",
    ]);
    expect(again.code).toBe(0);
    expect(ledgerEvents(state).length).toBe(1);
    const differentTier = cli([
      "init", "--run-id", state.runId, "--type", "code", "--tier", "S", "--plan", state.plan,
      "--root", state.root, "--unit", "u1", "--worktree", state.repo.dir, "--fact", "again",
    ]);
    expect(differentTier.code).toBe(0);
    expect(readFileSync(state.plan, "utf8")).toContain("  tier: M");
    const other = cli([
      "init", "--run-id", "w-other-20261027-1600", "--type", "code", "--tier", "M", "--plan", state.plan,
      "--root", join(state.box.dir, "er2"), "--unit", "u1", "--worktree", state.repo.dir, "--fact", "other",
    ]);
    expect(other.code).toBe(3);
    expect(other.err).toContain("another run");
  });

  test("rejects malformed arguments as usage and a mixed run without labels", () => {
    const box = sandbox();
    const repo = makeRepo(box);
    writePlan(box.plan, { runId: "w-run-20261027-1600", tier: "M", type: "code", unit: "u1", worktree: repo.dir });
    const bad = [
      ["--run-id", "nope", "--type", "code", "--tier", "M"],
      ["--run-id", "w-run-20261027-1600", "--type", "nope", "--tier", "M"],
      ["--run-id", "w-run-20261027-1600", "--type", "code", "--tier", "X"],
      ["--run-id", "w-run-20261027-1600", "--type", "mixed", "--tier", "M"],
    ];
    for (const args of bad) {
      expect(cli(["init", ...args, "--plan", box.plan, "--root", box.root, "--worktree", repo.dir, "--fact", "f"]).code).toBe(2);
    }
    expect(cli(["init", "--run-id", "w-run-20261027-1600", "--type", "code", "--tier", "M", "--plan", box.plan, "--root", box.root, "--worktree", repo.dir]).code).toBe(2);
    const mixed = cli([
      "init", "--run-id", "w-run-20261027-1600", "--type", "mixed", "--tier", "M", "--plan", box.plan,
      "--root", box.root, "--worktree", repo.dir, "--primary", "code", "--secondary", "design", "--fact", "f",
    ]);
    expect(mixed.code).toBe(0);
    expect(ledgerEvents({ root: box.root, box })[0]).toMatchObject({ type: "mixed", primary: "code", secondary: "design" });
  });
});

describe("status", () => {
  test("reports the M0 shape once the verify lanes pass", () => {
    const state = scene();
    upToBuild(state);
    const names = ["tests", "qa", "sweep", "code-review"].map((name) => lane(state, { lane: name }).name);
    const reported = status(state);
    expect(reported.code).toBe(0);
    expect(validateStatusJson(reported.json).errors).toEqual([]);
    expect(reported.json.stage).toBe("verify_lane");
    expect(reported.json.next).toBe("triage");
    expect(reported.json.blocking).toEqual([]);
    expect(new Set(reported.json.valid_receipts)).toEqual(new Set(names));
    expect(reported.json.stale_receipts).toEqual([]);
    expect(reported.json.head).toBe(state.repo.head);
    expect(reported.json.tree).toBe(state.repo.tree);
  });

  test("a stale receipt blocks, and a recorded reuse VALID at the new head clears it", () => {
    const state = scene();
    upToBuild(state);
    const tested = lane(state, { lane: "tests" });
    ["qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    const moved = commitFile(state.repo, "later.txt", "later\n");
    const blocked = status(state);
    expect(blocked.code).toBe(0);
    expect(blocked.json.stage).toBe("verify_lane");
    expect(blocked.json.next).toBe("triage");
    expect(blocked.json.blocking).toContain(`receipt:${tested.name}`);
    expect(blocked.json.stale_receipts).toContain(tested.name);

    const reused = append(state, {
      event: "reuse",
      head: moved.head,
      tree: moved.tree,
      reuse: { receipt: tested.name, verdict: "VALID", reason: "the changed file is outside the lane scope" },
    });
    expect(reused.code).toBe(0);
    const cleared = status(state, ["--head", moved.head]);
    expect(cleared.code).toBe(0);
    expect(cleared.json.blocking).not.toContain(`receipt:${tested.name}`);
  });

  test("WARN never blocks and SKIP never satisfies a required lane", () => {
    const state = scene();
    upToBuild(state);
    lane(state, { lane: "tests", status: "WARN" });
    lane(state, { lane: "qa", status: "WARN" });
    const skipped = lane(state, { lane: "sweep", status: "SKIP" });
    lane(state, { lane: "code-review", status: "PASS" });
    const reported = status(state);
    expect(reported.code).toBe(0);
    expect(reported.json.blocking).toEqual([`receipt-skip:${skipped.name}`]);
    expect(reported.json.valid_receipts).toContain(skipped.name);
  });

  test("an adversarial lane is required only when the plan flags a high-risk row", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    expect(status(state).json.blocking).toEqual([]);
    const flagged = append(state, {
      event: "plan",
      artifact: state.plan,
      adversarial_classes: [{ name: "state", applicable: true, observable: "no orphan child" }],
    });
    expect(flagged.code).toBe(0);
    expect(status(state).json.blocking).toContain("receipt-missing:adversarial");
  });

  test("--progress prints one line the M0 grammar reads back", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    append(state, { event: "pr_open", pr: 51, head: state.repo.head });
    const result = cli(["status", "--progress", "--root", state.root]);
    expect(result.code).toBe(0);
    const line = result.out.trim();
    const parsed = parseProgressLine(line);
    expect(parsed.ok).toBe(true);
    expect(formatProgressLine(parsed.value)).toBe(line);
    expect(parsed.value.prs_open).toBe(1);
    expect(line).toContain("gaps n/a");
  });

  test("status never mutates state", () => {
    const state = scene();
    upToBuild(state);
    lane(state, { lane: "tests" });
    const before = snapshotDir(state.root);
    expect(status(state).code).toBe(0);
    cli(["status", "--progress", "--root", state.root]);
    expect(snapshotDir(state.root)).toEqual(before);
  });

  test("an unreadable ledger is a state mismatch, not a wrong report", () => {
    const state = scene();
    writeFileSync(join(state.root, "ledger.jsonl"), `${JSON.stringify(ledgerEvents(state)[0])}\nnot json\n`);
    const result = status(state);
    expect(result.code).toBe(3);
    expect(result.err).toContain("not a JSON event");
  });

  test("a head that no longer contains the frozen head is a state mismatch", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    expect(cli(["freeze", "--root", state.root]).code).toBe(0);
    const frozen = state.repo.head;
    git(state.repo.dir, ["reset", "--hard", `${frozen}~1`]);
    const result = status(state);
    expect(result.code).toBe(3);
    expect(result.err).toContain("no longer contains");
  });

  test("a .md lane receipt is judged by its front matter", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    const md = laneMarkdown(state, { lane: "architect", stage: "plan_review" });
    const reported = status(state);
    expect(reported.code).toBe(0);
    expect(reported.json.valid_receipts).toContain(md.name);
  });

  test("boundary: a header-only findings table is zero rows, not an error", () => {
    const state = scene();
    writeFileSync(join(state.root, "findings.tsv"), `${FINDINGS_COLUMNS.join("\t")}\n`);
    upToBuild(state);
    const reported = status(state);
    expect(reported.code).toBe(0);
    expect(reported.json.blocking).toEqual([]);
  });
});

describe("ledger append", () => {
  test("fills the plan context and appends the event", () => {
    const state = scene();
    const result = append(state, { event: "discover", artifact: join(state.root, "receipts", "discover-a.md") });
    expect(result.code).toBe(0);
    const appended = JSON.parse(result.out);
    expect(appended).toMatchObject({ event: "discover", stage: "discover", type: "code", unit: "u1", plan: state.plan });
    expect(appended.session_id.startsWith("senpi:")).toBe(true);
    expect(ledgerEvents(state).length).toBe(2);
  });

  test("a schema failure exits 1 and appends nothing", () => {
    const state = scene();
    const result = append(state, { event: "build", task: "node-1" });
    expect(result.code).toBe(1);
    expect(result.err).toContain("head");
    expect(ledgerEvents(state).length).toBe(1);
  });

  test("out-of-order rounds are a state mismatch", () => {
    const state = scene();
    expect(append(state, { event: "round", round: 1, verdict: "APPROVED", head: state.repo.head }).code).toBe(0);
    const second = append(state, { event: "round", round: 2, verdict: "REVISE", head: state.repo.head });
    expect(second.code).toBe(3);
    expect(second.err).toContain("no round may follow");
  });

  test("an event for a unit without intake is out of order", () => {
    const box = sandbox();
    const repo = makeRepo(box);
    writePlan(box.plan, { runId: "w-run-20261027-1600", tier: "M", type: "code", unit: "u1", worktree: repo.dir });
    mkdirSync(box.root, { recursive: true });
    writeFileSync(join(box.root, "ledger.jsonl"), `${JSON.stringify({
      event: "discover", stage: "discover", type: "code", unit: "u1", program_id: null,
      plan: box.plan, session_id: "senpi:test", started_at: "2026-10-27T16:00:00Z",
      artifact: join(box.root, "receipts", "discover-a.md"),
    })}\n`);
    const body = join(box.dir, "plan-event.json");
    writeFileSync(body, JSON.stringify({ event: "plan", artifact: box.plan }));
    const result = cli(["ledger", "append", "--event", "plan", "--json", body, "--root", box.root, "--plan", box.plan]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("no intake");
  });

  test("a malformed --json body is a usage error", () => {
    const state = scene();
    const file = join(state.box.dir, "broken.json");
    writeFileSync(file, "{not json");
    expect(cli(["ledger", "append", "--event", "plan", "--json", file, "--root", state.root]).code).toBe(2);
  });

  test("INV5: the ledger is append-only across every verb", () => {
    const state = scene();
    upToBuild(state);
    const before = readFileSync(join(state.root, "ledger.jsonl"));
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    status(state);
    cli(["freeze", "--root", state.root]);
    const after = readFileSync(join(state.root, "ledger.jsonl"));
    expect(after.subarray(0, before.length).equals(before)).toBe(true);
    expect(after.length).toBeGreaterThan(before.length);
  });
});

describe("findings", () => {
  test("add creates the table, rejects a duplicate id and a foreign class", () => {
    const state = scene();
    expect(addFindings(state, [findingRow()]).code).toBe(0);
    const table = readFileSync(join(state.root, "findings.tsv"), "utf8");
    expect(parseFindingsTsv(table, { type: "code" }).ok).toBe(true);
    expect(addFindings(state, [findingRow()]).code).toBe(1);
    const foreign = addFindings(state, [findingRow({ id: "F2", class: "A1" })]);
    expect(foreign.code).toBe(1);
    expect(foreign.err).toContain("class");
  });

  test("set follows the transition table and refuses an illegal move", () => {
    const state = scene();
    expect(addFindings(state, [findingRow()]).code).toBe(0);
    expect(cli(["findings", "set", "--id", "F1", "--status", "fixed", "--root", state.root]).code).toBe(1);
    expect(cli(["findings", "set", "--id", "F1", "--status", "fixed", "--fixed-head", HEAD.slice(0, 7), "--root", state.root]).code).toBe(1);
    const fixed = cli(["findings", "set", "--id", "F1", "--status", "fixed", "--fixed-head", OTHER, "--root", state.root]);
    expect(fixed.code).toBe(0);
    expect(JSON.parse(fixed.out).fixed_head).toBe(OTHER);
    const illegalMove = cli(["findings", "set", "--id", "F1", "--status", "no-command", "--root", state.root]);
    expect(illegalMove.code).toBe(1);
    expect(illegalMove.err).toContain("may not move from fixed to no-command");
    expect(cli(["findings", "set", "--id", "F1", "--status", "note", "--blocking", "1", "--root", state.root]).code).toBe(1);
    expect(cli(["findings", "set", "--id", "nope", "--status", "open", "--root", state.root]).code).toBe(3);
  });
});

describe("gaps", () => {
  test("add and set enforce the register rules and list round-trips", () => {
    const state = scene();
    const added = addGaps(state, [gapRow(), gapRow({ id: "G2", kind: "taste", severity: "LOW", class: "C2" })]);
    expect(added.code).toBe(0);
    const table = readFileSync(join(state.root, "gaps.tsv"), "utf8");
    expect(parseGapsTsv(table).ok).toBe(true);
    expect(cli(["gaps", "set", "--id", "G1", "--status", "fixed", "--root", state.root]).code).toBe(1);
    const fixed = cli(["gaps", "set", "--id", "G1", "--status", "fixed", "--fixed-head", OTHER, "--pr", "51", "--root", state.root]);
    expect(fixed.code).toBe(0);
    expect(JSON.parse(fixed.out)).toMatchObject({ status: "fixed", fixed_head: OTHER, pr: "51" });
    const listed = cli(["gaps", "list", "--json", "--root", state.root]);
    expect(listed.code).toBe(0);
    expect(JSON.parse(listed.out).length).toBe(2);
    expect(cli(["gaps", "set", "--id", "nope", "--status", "open", "--root", state.root]).code).toBe(3);
    expect(addGaps(state, [gapRow()]).code).toBe(1);
  });
});

describe("gates", () => {
  test("add and resolve write the M0 gates shape", () => {
    const state = scene();
    const added = cli([
      "gate", "add", "--id", "G1", "--question", "Keep the legacy button?",
      "--options", "keep both|replace now", "--default", "keep both", "--root", state.root,
    ]);
    expect(added.code).toBe(0);
    const parsed = parseGatesMarkdown(readFileSync(join(state.root, "gates.md"), "utf8"));
    expect(parsed.ok).toBe(true);
    expect(parsed.gates).toHaveLength(1);
    expect(parsed.gates[0]).toMatchObject({ id: "G1", status: "open", default: "keep both" });
    expect(cli(["gate", "add", "--id", "G1", "--question", "q", "--options", "a|b", "--default", "a", "--root", state.root]).code).toBe(1);
    expect(cli(["gate", "add", "--id", "G2", "--question", "q", "--options", "a|b", "--default", "c", "--root", state.root]).code).toBe(2);
    expect(cli(["gate", "resolve", "--id", "G1", "--answer", "keep both for one release", "--root", state.root]).code).toBe(0);
    expect(cli(["gate", "resolve", "--id", "G1", "--answer", "again", "--root", state.root]).code).toBe(1);
    expect(cli(["gate", "resolve", "--id", "nope", "--answer", "x", "--root", state.root]).code).toBe(3);
    const open = status(state);
    expect(open.json.blocking).not.toContain("gate:G1 open");
  });

  test("an open gate blocks and shows up in the PROGRESS line", () => {
    const state = scene();
    expect(cli(["gate", "add", "--id", "G7", "--question", "Ship it?", "--options", "yes|no", "--default", "no", "--root", state.root]).code).toBe(0);
    const reported = status(state);
    expect(reported.json.blocking).toContain("gate:G7 open");
    const line = cli(["status", "--progress", "--root", state.root]).out.trim();
    expect(parseProgressLine(line).value.waiting).toBe("gate G7");
  });

  test("the dispatch gate fails when a blocker still reproduces and marks it not-fixed", () => {
    const state = scene();
    upToBuild(state);
    expect(addFindings(state, [findingRow({ repro_cmd: "exit 3" })]).code).toBe(0);
    const result = cli(["gate", "--round", "2", "--root", state.root]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("BLOCKED");
    const listed = JSON.parse(cli(["findings", "list", "--json", "--root", state.root]).out);
    expect(listed[0].status).toBe("not-fixed");
    const receipt = readdirSync(join(state.root, "receipts")).find((name) => name.startsWith("gate-dispatch-"));
    expect(receipt).toBeDefined();
    const body = JSON.parse(readFileSync(join(state.root, "receipts", receipt), "utf8"));
    expect(validateReceipt(body).errors).toEqual([]);
    expect(body.rows[0]).toMatchObject({ id: "F1", verdict: "FAIL" });
    const gateEvent = ledgerEvents(state).filter((event) => event.event === "gate").pop();
    expect(gateEvent).toMatchObject({ gate_id: "dispatch", gate_status: "open" });
    expect(status(state).json.blocking).toContain("gate:dispatch open");
  });

  test("the dispatch gate passes when nothing reproduces", () => {
    const state = scene();
    upToBuild(state);
    expect(addFindings(state, [findingRow({ repro_cmd: "exit 0" })]).code).toBe(0);
    const result = cli(["gate", "--round", "2", "--root", state.root]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("PASS");
    const gateEvent = ledgerEvents(state).filter((event) => event.event === "gate").pop();
    expect(gateEvent).toMatchObject({ gate_id: "dispatch", gate_status: "resolved" });
  });

  test("a row with no command is unprovable, never a pass", () => {
    const state = scene();
    upToBuild(state);
    expect(addFindings(state, [findingRow({ repro_cmd: "no command", status: "open" })]).code).toBe(0);
    const result = cli(["gate", "--round", "2", "--root", state.root]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("INVALID");
    const listed = JSON.parse(cli(["findings", "list", "--json", "--root", state.root]).out);
    expect(listed[0].status).toBe("no-command");
  });

  test("a hanging row is killed with its process group and recorded as a timeout", async () => {
    const state = scene();
    upToBuild(state);
    const command = "echo $$ > pids.txt; sleep 30 & echo $! >> pids.txt; wait";
    expect(addFindings(state, [findingRow({ repro_cmd: command })]).code).toBe(0);
    const started = Date.now();
    const result = cli(["gate", "--round", "2", "--timeout", "1", "--root", state.root]);
    const elapsed = Date.now() - started;
    expect(result.code).toBe(1);
    expect(elapsed).toBeLessThan(15_000);
    const receipt = readdirSync(join(state.root, "receipts")).find((name) => name.startsWith("gate-dispatch-"));
    const body = JSON.parse(readFileSync(join(state.root, "receipts", receipt), "utf8"));
    expect(body.rows[0].verdict).toBe("INVALID");
    expect(body.rows[0].note).toContain("timeout");
    const pids = readFileSync(join(state.repo.dir, "pids.txt"), "utf8").trim().split("\n").map(Number);
    expect(pids.length).toBe(2);
    for (const pid of pids) expect(await gone(pid)).toBe(true);
  });

  test("a dry run executes nothing", () => {
    const state = scene();
    upToBuild(state);
    expect(addFindings(state, [findingRow({ repro_cmd: "touch marker.txt" })]).code).toBe(0);
    const out = cli(["gate", "--round", "2", "--dry-run", "--root", state.root]);
    expect(out.code).toBe(0);
    expect(out.out).toContain("dry run");
    expect(existsSync(join(state.repo.dir, "marker.txt"))).toBe(false);
    const receipts = existsSync(join(state.root, "receipts")) ? readdirSync(join(state.root, "receipts")) : [];
    expect(receipts.some((name) => name.startsWith("gate-dispatch-"))).toBe(false);
    expect(ledgerEvents(state).some((event) => event.event === "gate")).toBe(false);
  });

  test("a row that prints a token never leaks it into the receipt or the error", () => {
    const state = scene();
    upToBuild(state);
    const canary = "CANARY_7f3a9c";
    expect(addFindings(state, [findingRow({ repro_cmd: "printf '%s' \"$GH_TOKEN\"; exit 2" })]).code).toBe(0);
    const result = cli(["gate", "--round", "2", "--root", state.root], { env: { GH_TOKEN: canary } });
    expect(result.code).toBe(1);
    const receipt = readdirSync(join(state.root, "receipts")).find((name) => name.startsWith("gate-dispatch-"));
    const raw = readFileSync(join(state.root, "receipts", receipt), "utf8");
    expect(raw).not.toContain(canary);
    expect(result.out).not.toContain(canary);
    expect(result.err).not.toContain(canary);
  });
});

describe("freeze and pr-body", () => {
  test("freeze records head, tree and pr, and --check proves nothing landed after it", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    const frozen = cli(["freeze", "--pr", "51", "--root", state.root]);
    expect(frozen.code).toBe(0);
    const front = readFileSync(state.plan, "utf8");
    expect(front).toContain(`  frozen_head: ${state.repo.head}`);
    expect(front).toContain("  pr: 51");
    expect(cli(["freeze", "--check", "--root", state.root]).code).toBe(0);

    writeFileSync(join(state.repo.dir, "dirty.txt"), "uncommitted\n");
    const dirty = cli(["freeze", "--check", "--root", state.root]);
    expect(dirty.code).toBe(1);
    expect(dirty.err).toContain("uncommitted");

    commitFile(state.repo, "dirty.txt", "uncommitted\n", "land it");
    const moved = cli(["freeze", "--check", "--root", state.root]);
    expect(moved.code).toBe(3);
    expect(moved.err).toContain("head moved");
  });

  test("freeze refuses a dirty worktree and a verdict on another head", () => {
    const state = scene();
    upToBuild(state);
    writeFileSync(join(state.repo.dir, "dirty.txt"), "x\n");
    expect(cli(["freeze", "--root", state.root]).code).toBe(1);
    git(state.repo.dir, ["checkout", "--", "."]);
    rmSync(join(state.repo.dir, "dirty.txt"), { force: true });
    expect(cli(["freeze", "--root", state.root]).code).toBe(0);
    expect(append(state, { event: "round", round: 1, verdict: "APPROVED", head: OTHER }).code).toBe(0);
    const checked = cli(["freeze", "--check", "--root", state.root]);
    expect(checked.code).toBe(1);
    expect(checked.err).toContain("judged");
  });

  test("pr-body carries the before/after table, the evidence root and the findings", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    expect(cli(["freeze", "--pr", "51", "--root", state.root]).code).toBe(0);
    expect(addFindings(state, [findingRow({ repro_cmd: "bun test", status: "open" })]).code).toBe(0);
    expect(addGaps(state, [gapRow()]).code).toBe(0);
    writeFileSync(join(state.root, "receipts", `before-G1-${state.repo.tree.slice(0, 7)}.png`), "png");
    const out = join(state.box.dir, "body.md");
    const result = cli(["pr-body", "--out", out, "--root", state.root]);
    expect(result.code).toBe(0);
    const body = readFileSync(out, "utf8");
    expect(body).toContain("## Before / After");
    expect(body).toContain("| G1 |");
    expect(body).toContain(state.root);
    expect(body).toContain("| F1 |");
    expect(body).toContain(state.repo.head);
  });

  test("pr-body exits 3 without a freeze or without a paired before capture", () => {
    const state = scene();
    upToBuild(state);
    expect(cli(["pr-body", "--root", state.root]).code).toBe(3);
    expect(cli(["freeze", "--root", state.root]).code).toBe(0);
    expect(addGaps(state, [gapRow()]).code).toBe(0);
    const unpaird = cli(["pr-body", "--root", state.root]);
    expect(unpaird.code).toBe(3);
    expect(unpaird.err).toContain("G1");
  });
});

describe("switch", () => {
  test("records one approach switch per REVISE after the third and never caps the rounds", () => {
    const state = scene();
    upToBuild(state);
    for (const round of [1, 2, 3]) {
      expect(append(state, { event: "round", round, verdict: "REVISE", head: state.repo.head }).code).toBe(0);
    }
    const first = cli(["switch", "record", "--round", "3", "--kind", "premise", "--premise", "the classifier", "--new-approach", "delete it", "--root", state.root]);
    expect(first.code).toBe(0);
    const repeated = cli(["switch", "record", "--round", "3", "--kind", "premise", "--premise", "again", "--new-approach", "again", "--root", state.root]);
    expect(repeated.code).toBe(1);
    expect(repeated.err).toContain("repeats");
    const missing = cli(["switch", "record", "--round", "9", "--kind", "family", "--premise", "p", "--new-approach", "n", "--root", state.root]);
    expect(missing.code).toBe(3);
    expect(missing.err).toContain("no REVISE");
    expect(cli(["switch", "record", "--round", "3", "--kind", "guess", "--premise", "p", "--new-approach", "n", "--root", state.root]).code).toBe(2);
  });

  test("a third REVISE without a switch keeps the next stage at switch", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    expect(cli(["freeze", "--root", state.root]).code).toBe(0);
    for (const round of [1, 2, 3]) {
      expect(append(state, { event: "round", round, verdict: "REVISE", head: state.repo.head }).code).toBe(0);
    }
    const reported = status(state);
    expect(reported.json.round).toBe(3);
    expect(reported.json.next).toBe("switch");
    expect(reported.json.blocking).toContain("round:3 needs an approach switch");
    expect(reported.json.units[0].switches).toBe(0);
  });
});

describe("resume-plan", () => {
  test("names the first invalid stage and the actions that clear it", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    const result = cli(["resume-plan", "--root", state.root]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("first invalid stage: triage");
    commitFile(state.repo, "later.txt", "later\n");
    const stale = cli(["resume-plan", "--root", state.root]);
    expect(stale.out).toContain("first invalid stage: verify_lane");
    expect(stale.out).toContain("re-run the stale lane receipt");
  });

  test("a missing ledger is a state mismatch", () => {
    const box = sandbox();
    mkdirSync(box.root, { recursive: true });
    expect(cli(["resume-plan", "--root", box.root]).code).toBe(3);
  });
});

describe("module-owned verbs", () => {
  test("exit 3 and name the missing script instead of pretending to work", () => {
    for (const verb of ["reuse-check", "metrics"]) {
      const result = cli([verb, "--root", join(sandbox().root)]);
      expect(result.code).toBe(3);
      expect(result.err).toContain(`${verb}.mjs`);
    }
  });

  test("pass argv through unchanged and propagate the child's exit code", () => {
    const box = sandbox();
    const scripts = join(box.dir, "scripts");
    mkdirSync(join(scripts, "lib"), { recursive: true });
    copyFileSync(CLI, join(scripts, "wish.mjs"));
    copyFileSync(join(LIB, "store.mjs"), join(scripts, "lib", "store.mjs"));
    copyFileSync(join(LIB, "schema.mjs"), join(scripts, "lib", "schema.mjs"));
    writeFileSync(join(scripts, "reuse-check.mjs"), "console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = 3;\n");
    const result = spawnSync(process.execPath, [join(scripts, "wish.mjs"), "reuse-check", "receipt.json", "--head", HEAD], { encoding: "utf8" });
    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout.trim())).toEqual(["receipt.json", "--head", HEAD]);
  });
});

describe("lock and concurrency", () => {
  test("a live holder refuses the mutation with a state mismatch and is left in place", () => {
    const state = scene();
    writeFileSync(join(state.root, "lock"), JSON.stringify({ pid: process.pid }));
    const result = append(state, { event: "discover", artifact: join(state.root, "receipts", "a.md") });
    expect(result.code).toBe(3);
    expect(result.err).toContain("another wish process holds");
    expect(existsSync(join(state.root, "lock"))).toBe(true);
    rmSync(join(state.root, "lock"));
    expect(append(state, { event: "discover", artifact: join(state.root, "receipts", "a.md") }).code).toBe(0);
  });

  test("a lock left by a dead process is taken over", async () => {
    const state = scene();
    const dead = Bun.spawn(["true"]);
    const pid = dead.pid;
    await dead.exited;
    writeFileSync(join(state.root, "lock"), JSON.stringify({ pid }));
    expect(append(state, { event: "discover", artifact: join(state.root, "receipts", "a.md") }).code).toBe(0);
    expect(existsSync(join(state.root, "lock"))).toBe(false);
  });

  test("two concurrent appends both land, exactly once each", async () => {
    const state = scene();
    const before = ledgerEvents(state).length;
    const files = ["a", "b"].map((name) => {
      const file = join(state.box.dir, `race-${name}.json`);
      writeFileSync(file, JSON.stringify({ event: "discover", artifact: join(state.root, "receipts", `${name}.md`) }));
      return file;
    });
    const runs = files.map((file) => Bun.spawn([process.execPath, CLI, "ledger", "append", "--event", "discover", "--json", file, "--root", state.root], { stdout: "pipe", stderr: "pipe" }));
    const codes = await Promise.all(runs.map((run) => run.exited));
    expect(codes).toEqual([0, 0]);
    const after = ledgerEvents(state);
    expect(after.length).toBe(before + 2);
    const artifacts = after.slice(before).map((event) => event.artifact);
    expect(new Set(artifacts).size).toBe(2);
  });

  test("INV2: the CLI never writes inside the product worktree", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    status(state);
    cli(["freeze", "--root", state.root]);
    cli(["gate", "add", "--id", "G1", "--question", "q", "--options", "a|b", "--default", "a", "--root", state.root]);
    expect(git(state.repo.dir, ["status", "--porcelain"])).toBe("");
  });
});

describe("boundary inputs", () => {
  test("a 4096-byte question is accepted and a newline is folded", () => {
    const state = scene();
    const question = "q".repeat(4096);
    expect(cli(["gate", "add", "--id", "G1", "--question", question, "--options", "a|b", "--default", "a", "--root", state.root]).code).toBe(0);
    const parsed = parseGatesMarkdown(readFileSync(join(state.root, "gates.md"), "utf8"));
    expect(parsed.ok).toBe(true);
    expect(parsed.gates[0].question.length).toBe(4096);
  });

  test("an empty --tsv is usage, a seven-hex --head is usage, a seven-hex fixed head is a check failure", () => {
    const state = scene();
    upToBuild(state);
    const empty = join(state.box.dir, "empty.tsv");
    writeFileSync(empty, "");
    expect(cli(["findings", "add", "--tsv", empty, "--root", state.root]).code).toBe(2);
    expect(cli(["status", "--head", HEAD.slice(0, 7), "--root", state.root]).code).toBe(2);
    expect(addFindings(state, [findingRow()]).code).toBe(0);
    expect(cli(["findings", "set", "--id", "F1", "--status", "fixed", "--fixed-head", HEAD.slice(0, 7), "--root", state.root]).code).toBe(1);
  });

  test("a finding in a non-ASCII file is accepted and round-trips", () => {
    const state = scene();
    const row = findingRow({ file_line: "src/한글.mjs:12" });
    expect(addFindings(state, [row]).code).toBe(0);
    const table = readFileSync(join(state.root, "findings.tsv"), "utf8");
    expect(parseFindingsTsv(table, { type: "code" }).ok).toBe(true);
    expect(table).toContain("src/한글.mjs:12");
  });

  test("a missing plan file is a state mismatch, never a silent empty status", () => {
    const state = scene();
    rmSync(state.plan);
    const result = status(state);
    expect(result.code).toBe(3);
    expect(result.err).toContain("does not exist");
  });
});

describe("status derivation against the contract's own example", () => {
  test("replays the inputs of the section 11 example", () => {
    const state = scene();
    upToBuild(state);
    const staleQa = lane(state, { lane: "qa" });
    const moved = commitFile(state.repo, "later.txt", "later\n");
    ["tests", "sweep", "code-review"].forEach((name) => lane(state, { lane: name, head: moved.head, tree: moved.tree }));
    expect(addFindings(state, [findingRow(), findingRow({ id: "F2", class: "T" })]).code).toBe(0);
    const reported = status(state);
    expect(reported.code).toBe(0);
    expect(reported.json.stage).toBe("verify_lane");
    expect(reported.json.next).toBe("triage");
    expect(reported.json.blocking).toContain(`receipt:${staleQa.name}`);
    expect(reported.json.blocking).toContain("findings:2 open");
    expect(reported.json.stale_receipts).toEqual([staleQa.name]);
    expect(reported.json.tree).toBe(moved.tree);
  });

  test("init --program records the program on the front matter and the intake event", () => {
    const state = scene({ initExtra: ["--program", "p1"] });
    expect(readFileSync(state.plan, "utf8")).toContain("  program_id: p1");
    expect(ledgerEvents(state)[0].program_id).toBe("p1");
    expect(status(state).json.units[0].id).toBe("u1");
  });

  test("the plan body after the front matter is preserved byte for byte", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    expect(cli(["freeze", "--root", state.root]).code).toBe(0);
    const templateLines = readFileSync(join(FIXTURES, "plan-template.md"), "utf8").split("\n");
    const expectedBody = templateLines.slice(templateLines.indexOf("---", 1) + 1).join("\n");
    const afterLines = readFileSync(state.plan, "utf8").split("\n");
    const body = afterLines.slice(afterLines.indexOf("---", 1) + 1).join("\n");
    expect(body).toBe(expectedBody);
  });

  test("an illegal gap transition exits 3 and leaves the row alone", () => {
    const state = scene();
    expect(addGaps(state, [gapRow()]).code).toBe(0);
    expect(cli(["gaps", "set", "--id", "G1", "--status", "fixed", "--fixed-head", OTHER, "--pr", "51", "--root", state.root]).code).toBe(0);
    const illegal = cli(["gaps", "set", "--id", "G1", "--status", "planned", "--root", state.root]);
    expect(illegal.code).toBe(3);
    const rows = JSON.parse(cli(["gaps", "list", "--json", "--root", state.root]).out);
    expect(rows[0].status).toBe("fixed");
  });

  test("a mixed run takes its primary type's identity form", () => {
    const state = scene({ type: "mixed", initExtra: ["--primary", "research", "--secondary", "code"] });
    const reported = status(state);
    expect(reported.code).toBe(0);
    expect(reported.json.type).toBe("mixed");
    expect(reported.json.tree).toBe(null);
    expect(validateStatusJson(reported.json).errors).toEqual([]);
  });

  test("a research run freezes the artifact sha256 and judges receipts by head", () => {
    const sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const state = scene({ type: "research" });
    const dir = join(state.root, "receipts");
    mkdirSync(dir, { recursive: true });
    const body = {
      kind: "claim-gate", type: "research", unit: state.unit, program_id: null, lane: "claim-gate",
      head: sha, tree: null, scope: ["report.html"], started_at: "2026-10-27T19:00:00Z",
      ended_at: "2026-10-27T19:01:00Z", status: "PASS",
      rows: [{ id: "C1", command: "node report-tools.mjs check", observable: "claim C1 is sourced", verdict: "PASS", artifact: null }],
      artifacts: [], cleanup: [],
    };
    expect(validateReceipt(body).errors).toEqual([]);
    const name = `claim-gate-${sha.slice(0, 7)}.json`;
    writeFileSync(join(dir, name), JSON.stringify(body, null, 2));
    const reported = status(state, ["--head", sha]);
    expect(reported.code).toBe(0);
    expect(reported.json.tree).toBe(null);
    expect(reported.json.valid_receipts).toContain(name);
    expect(cli(["freeze", "--head", sha, "--root", state.root]).code).toBe(0);
    expect(readFileSync(state.plan, "utf8")).toContain(`  frozen_head: ${sha}`);
    expect(cli(["freeze", "--check", "--head", sha, "--root", state.root]).code).toBe(0);
  });

  test("a worktree path with shell metacharacters is never interpolated", () => {
    const state = scene({ workName: "wo;rk $(touch pwned) `touch pwned2`" });
    upToBuild(state);
    expect(addFindings(state, [findingRow({ repro_cmd: "exit 0" })]).code).toBe(0);
    expect(cli(["gate", "--round", "2", "--root", state.root]).code).toBe(0);
    expect(existsSync(join(state.box.dir, "pwned"))).toBe(false);
    expect(existsSync(join(state.box.dir, "pwned2"))).toBe(false);
  });
});

describe("review blockers", () => {
  test("concurrent findings adds all land: the lock is exclusive", async () => {
    const state = scene();
    const expected = [];
    for (let round = 0; round < 4; round += 1) {
      const runs = Array.from({ length: 8 }, (_, index) => {
        const id = `F${round}x${index}`;
        expected.push(id);
        const file = join(state.box.dir, `add-${id}.tsv`);
        writeFileSync(file, [FINDINGS_COLUMNS.join("\t"),
          FINDINGS_COLUMNS.map((column) => findingRow({ id, repro_cmd: "exit 0" })[column]).join("\t")].join("\n"));
        return Bun.spawn([process.execPath, CLI, "findings", "add", "--tsv", file, "--root", state.root], { stdout: "pipe", stderr: "pipe" });
      });
      const codes = await Promise.all(runs.map((run) => run.exited));
      expect(codes).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    }
    const rows = JSON.parse(cli(["findings", "list", "--json", "--root", state.root]).out);
    expect(rows.map((row) => row.id).sort()).toEqual(expected.sort());
  });

  test("a dead lock is reclaimed without losing any concurrent write", async () => {
    const state = scene();
    const dead = Bun.spawn(["true"]);
    const deadPid = dead.pid;
    await dead.exited;
    writeFileSync(join(state.root, "lock"), JSON.stringify({ pid: deadPid, started_at: "2026-10-27T19:00:00Z" }));
    const runs = Array.from({ length: 8 }, (_, index) => {
      const file = join(state.box.dir, `dead-${index}.tsv`);
      writeFileSync(file, [FINDINGS_COLUMNS.join("\t"),
        FINDINGS_COLUMNS.map((column) => findingRow({ id: `D${index}`, repro_cmd: "exit 0" })[column]).join("\t")].join("\n"));
      return Bun.spawn([process.execPath, CLI, "findings", "add", "--tsv", file, "--root", state.root], { stdout: "pipe", stderr: "pipe" });
    });
    const codes = await Promise.all(runs.map((run) => run.exited));
    expect(codes).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    const rows = JSON.parse(cli(["findings", "list", "--json", "--root", state.root]).out);
    expect(rows.map((row) => row.id).sort()).toEqual(["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"]);
    expect(existsSync(join(state.root, "lock"))).toBe(false);
  });

  test("a mixed run reads its findings table with the union of both class sets", () => {
    const state = scene({ type: "mixed", initExtra: ["--primary", "design", "--secondary", "code"] });
    expect(addFindings(state, [findingRow({ class: "A1" })]).code).toBe(0);
    expect(addFindings(state, [findingRow({ id: "F2", class: "S" })]).code).toBe(0);
    expect(addFindings(state, [findingRow({ id: "F3", class: "untraceable_number" })]).code).toBe(1);
    const reported = status(state);
    expect(reported.code).toBe(0);
    expect(reported.json.blocking).toContain("findings:2 open");
    expect(cli(["gate", "--round", "2", "--dry-run", "--root", state.root]).code).toBe(0);
  });

  test("a passing gate row leaves no grandchild behind", async () => {
    const state = scene();
    upToBuild(state);
    expect(addFindings(state, [findingRow({ repro_cmd: "sleep 30 >/dev/null 2>&1 & echo $! > bg.txt; exit 0" })]).code).toBe(0);
    const result = cli(["gate", "--round", "2", "--timeout", "5", "--root", state.root]);
    expect(result.code).toBe(0);
    const pid = Number(readFileSync(join(state.repo.dir, "bg.txt"), "utf8").trim());
    expect(Number.isInteger(pid)).toBe(true);
    expect(await gone(pid)).toBe(true);
  });

  test("another unit's cleanup does not mark this unit done", () => {
    const state = scene();
    expect(append(state, { event: "intake", unit: "u2", type: "code", tier: "M", facts: ["second unit"] }).code).toBe(0);
    expect(append(state, { event: "cleanup", unit: "u2", cleanup: ["branch deleted (exit 0)"] }).code).toBe(0);
    const reported = status(state);
    expect(reported.code).toBe(0);
    expect(reported.json.stage).toBe("intake");
    expect(reported.json.units.find((unit) => unit.id === "u1").stage).toBe("intake");
    expect(reported.json.units.find((unit) => unit.id === "u2").stage).toBe("done");
    expect(reported.json.progress.units_done).toBe(1);
  });

  test("more than twenty pending rows is refused, never truncated", () => {
    const state = scene();
    const rows = Array.from({ length: 21 }, (_, index) => findingRow({ id: `F${index + 1}`, repro_cmd: "exit 0" }));
    expect(addFindings(state, rows).code).toBe(0);
    const result = cli(["gate", "--round", "2", "--root", state.root]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("capped at 20 rows");
    expect(existsSync(join(state.root, "receipts"))).toBe(false);
  });

  test("the contract's own example files are accepted", () => {
    const state = scene();
    writeFileSync(join(state.root, "ledger.jsonl"), readFileSync(join(FIXTURES, "ledger-m0.jsonl"), "utf8"));
    const replayed = cli(["status", "--json", "--plan", state.plan, "--root", state.root]);
    expect(replayed.code).toBe(0);
    expect(JSON.parse(replayed.out).stage).toBe("done");
    expect(JSON.parse(replayed.out).next).toBe("done");

    expect(cli(["findings", "add", "--tsv", join(FIXTURES, "findings-three.tsv"), "--plan", state.plan, "--root", state.root]).code).toBe(0);
    expect(cli(["gaps", "add", "--tsv", join(FIXTURES, "gaps-two.tsv"), "--plan", state.plan, "--root", state.root]).code).toBe(0);
    mkdirSync(join(state.root, "receipts"), { recursive: true });
    copyFileSync(join(FIXTURES, "receipts", "verify_lane-sweep-0123456.json"), join(state.root, "receipts", "verify_lane-sweep-0123456.json"));
    copyFileSync(join(FIXTURES, "receipts", "before-G1-89abcde.json"), join(state.root, "receipts", "before-G1-89abcde.json"));
    const withReceipts = cli(["status", "--json", "--plan", state.plan, "--root", state.root]);
    expect(withReceipts.code).toBe(0);
    expect(JSON.parse(withReceipts.out).stale_receipts).toContain("verify_lane-sweep-0123456.json");
  });

  test("an all-digit head stays a string in the front matter", () => {
    const state = scene();
    const digits = "1".repeat(40);
    writeFileSync(state.plan, readFileSync(state.plan, "utf8").replace("  frozen_head: null", `  frozen_head: ${digits}`));
    const again = cli(["init", "--run-id", state.runId, "--type", "code", "--tier", "M", "--plan", state.plan,
      "--root", state.root, "--unit", "u1", "--worktree", state.repo.dir, "--fact", "f"]);
    expect(again.code).toBe(0);
    expect(readFileSync(state.plan, "utf8")).toContain(`  frozen_head: ${digits}`);
  });

  test("init refuses a different unit on the same plan", () => {
    const state = scene();
    const other = cli(["init", "--run-id", state.runId, "--type", "code", "--tier", "M", "--plan", state.plan,
      "--root", state.root, "--unit", "u2", "--worktree", state.repo.dir, "--fact", "f"]);
    expect(other.code).toBe(3);
    expect(other.err).toContain("belongs to unit u1");
  });

  test("freeze --check refuses to answer when the worktree is gone", () => {
    const state = scene();
    writeFileSync(state.plan, readFileSync(state.plan, "utf8")
      .replace("  frozen_head: null", `  frozen_head: ${HEAD}`)
      .replace(state.repo.dir, "/nonexistent/wish-worktree"));
    const result = cli(["freeze", "--check", "--root", state.root]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("cannot observe the worktree");
  });
});

function snapshotDir(dir) {
  const entries = {};
  const walk = (current) => {
    for (const name of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, name.name);
      const key = full.slice(dir.length);
      if (name.isDirectory()) walk(full);
      else entries[key] = readFileSync(full).toString("base64");
    }
  };
  walk(dir);
  return entries;
}

// Bounded wait for a killed process: the kernel reaps it asynchronously, so the
// assertion polls without a fixed sleep and fails loudly at the deadline.
async function gone(pid) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

void GAPS_COLUMNS;