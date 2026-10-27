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
  linkSync,
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
  const labelFlag = (flag) => {
    const at = initExtra.indexOf(flag);
    return at >= 0 ? initExtra[at + 1] : null;
  };
  return {
    box, repo, root: box.root, plan: box.plan, runId, tier, type, unit,
    primary: labelFlag("--primary"), secondary: labelFlag("--secondary"),
  };
}

function append(state, body) {
  const file = join(state.box.dir, `event-${Date.now()}-${Math.round(Math.random() * 1e6)}.json`);
  // A mixed run's events must name both types (the frozen schema says so).
  const labelled = state.type === "mixed" && state.primary && state.secondary
    ? { ...body, primary: body.primary ?? state.primary, secondary: body.secondary ?? state.secondary }
    : body;
  writeFileSync(file, JSON.stringify(labelled));
  return cli(["ledger", "append", "--event", labelled.event, "--json", file, "--root", state.root]);
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
    if (result.code !== 0) throw new Error(step.event + ": " + result.err);
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

  test("a capture in receipts/ is an artifact, not a stale receipt", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    writeFileSync(join(state.root, "receipts", "tests-abcdef0.log"), "log\n");
    const reported = status(state);
    expect(reported.code).toBe(0);
    expect(reported.json.stale_receipts).toEqual([]);
    expect(reported.json.valid_receipts).toHaveLength(4);
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
    const out = join(state.root, "body.md");
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
  test("a live holder blocks the mutation, is left in place, and releases it", () => {
    const state = scene();
    // The holder is this process: a live ticket numbered ahead of the CLI's.
    const queue = join(state.root, "lock.queue");
    mkdirSync(queue, { recursive: true });
    const held = join(queue, `000000000001-${process.pid}-holder.ticket`);
    writeFileSync(held, JSON.stringify({ pid: process.pid }));
    const result = append(state, { event: "discover", artifact: join(state.root, "receipts", "a.md") });
    expect(result.code).toBe(3);
    expect(result.err).toContain("still queued");
    expect(existsSync(held)).toBe(true);
    rmSync(held);
    expect(append(state, { event: "discover", artifact: join(state.root, "receipts", "a.md") }).code).toBe(0);
  });

  test("a ticket left by a dead process is swept", async () => {
    const state = scene();
    const dead = Bun.spawn(["true"]);
    const pid = dead.pid;
    await dead.exited;
    const queue = join(state.root, "lock.queue");
    mkdirSync(queue, { recursive: true });
    const stale = join(queue, `000000000001-${pid}-gone.ticket`);
    writeFileSync(stale, JSON.stringify({ pid }));
    expect(append(state, { event: "discover", artifact: join(state.root, "receipts", "a.md") }).code).toBe(0);
    expect(existsSync(stale)).toBe(false);
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
    expect(cli(["gaps", "set", "--id", "G1", "--status", "open", "--root", state.root]).code).toBe(0);
    const rows = JSON.parse(cli(["gaps", "list", "--json", "--root", state.root]).out);
    expect(rows[0].status).toBe("open");
    expect(rows[0].fixed_head).toBe("-");
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
    // A dead contender's ticket: the queue must sweep it and still admit all eight.
    mkdirSync(join(state.root, "lock.queue"), { recursive: true });
    writeFileSync(join(state.root, "lock.queue", `000000000001-${deadPid}-gone.ticket`), JSON.stringify({ pid: deadPid }));
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
    expect(existsSync(join(state.root, "lock.queue", `000000000001-${deadPid}-gone.ticket`))).toBe(false);
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

describe("robustness review blockers", () => {
  test("no lock artifact except `lock` can wedge acquisition", () => {
    const state = scene();
    writeFileSync(join(state.root, "lock.takeover"), JSON.stringify({ pid: 999999 }));
    writeFileSync(join(state.root, "lock.dead.1.2"), "leftover");
    expect(append(state, { event: "discover", artifact: join(state.root, "receipts", "a.md") }).code).toBe(0);
    expect(existsSync(join(state.root, "lock"))).toBe(false);
  });

  test("the gate records its event when a row moves under it", () => {
    const state = scene();
    upToBuild(state);
    const fix = `${process.execPath} ${CLI} findings set --id F1 --status fixed --fixed-head ${state.repo.head} --root ${state.root}`;
    expect(addFindings(state, [findingRow({ repro_cmd: `${fix}; exit 1` })]).code).toBe(0);
    const result = cli(["gate", "--round", "2", "--root", state.root]);
    expect(result.code).toBe(1);
    const gateEvent = ledgerEvents(state).filter((event) => event.event === "gate").pop();
    expect(gateEvent).toBeDefined();
    expect(gateEvent.gate_status).toBe("open");
    expect(gateEvent.note).toContain("skipped");
    const row = JSON.parse(cli(["findings", "list", "--json", "--root", state.root]).out)[0];
    expect(row.status).toBe("fixed");
  });

  test("a JSON parse failure never echoes the submitted bytes", () => {
    const state = scene();
    const marker = "CANARY_9d1f";
    const bad = cli(["ledger", "append", "--event", "resume", "--json", "-", "--root", state.root], { input: marker });
    expect(bad.code).toBe(2);
    expect(bad.err).not.toContain(marker);
    const nullBody = cli(["ledger", "append", "--event", "resume", "--json", "-", "--root", state.root], { input: "null" });
    expect(nullBody.code).toBe(2);
    expect(nullBody.err).not.toContain("internal error");
  });

  test("a seven-hex head is a usage error on every verb that takes one", () => {
    const state = scene();
    for (const args of [
      ["status", "--head", HEAD.slice(0, 7), "--root", state.root],
      ["gate", "--head", HEAD.slice(0, 7), "--round", "2", "--root", state.root],
      ["gate", "--head", HEAD.slice(0, 7), "--round", "2", "--dry-run", "--root", state.root],
      ["freeze", "--head", HEAD.slice(0, 7), "--root", state.root],
    ]) {
      expect(cli(args).code).toBe(2);
    }
  });

  test("a CRLF plan survives init byte for byte", () => {
    const box = sandbox();
    const repo = makeRepo(box);
    const plan = "---\r\nwish:\r\n  run_id: w-crlf-20261027-1900\r\n  tier: M\r\n  type: code\r\n  unit: u1\r\n  program_id: null\r\n"
      + `  worktree: ${repo.dir}\r\n  branch: fixture\r\n  pr: null\r\n  frozen_head: null\r\n  round: 0\r\n---\r\n\r\n# Body\r\nA\r\nB\r\n`;
    writeFileSync(box.plan, plan);
    const result = cli(["init", "--run-id", "w-crlf-20261027-1900", "--type", "code", "--tier", "M", "--plan", box.plan,
      "--root", box.root, "--unit", "u1", "--worktree", repo.dir, "--branch", "fixture", "--fact", "f"]);
    expect(result.code).toBe(0);
    expect(readFileSync(box.plan, "utf8")).toBe(plan);
  });

  test("a malformed or non-file before/after receipt is stale, never valid", () => {
    const state = scene();
    const dir = join(state.root, "receipts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "before-G1-aaaaaaa.md"), "no front matter\n");
    mkdirSync(join(dir, "after-G1-aaaaaaa.json"), { recursive: true });
    const reported = status(state);
    expect(reported.code).toBe(0);
    expect(reported.json.stale_receipts).toContain("before-G1-aaaaaaa.md");
    expect(reported.json.stale_receipts).toContain("after-G1-aaaaaaa.json");
    expect(reported.json.valid_receipts).toEqual([]);
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

void 0;
// ---------------------------------------------------------------------------
// Final review round 1: each test below reproduces one finding of the REVISE
// verdict on 1026664 and fails on the code that produced it.
// ---------------------------------------------------------------------------

describe("final review round 1", () => {
  test("a rejected event name never echoes the submitted value", () => {
    const state = scene();
    const body = join(state.box.dir, "secret-event.json");
    const canary = "CANARY_" + "9f3a2b7c1d";
    writeFileSync(body, JSON.stringify({
      event: canary, type: "code", unit: "u1", program_id: null, plan: state.plan,
      session_id: "se-1", started_at: "2026-10-27T16:03:00Z", head: state.repo.head, task: "node-1",
    }));
    const result = cli(["ledger", "append", "--event", "build", "--json", body, "--root", state.root]);
    expect(result.code).toBe(2);
    expect(result.err).not.toContain(canary);
    expect(result.out).not.toContain(canary);
  });

  test("a ledger line that will not parse is reported without its bytes", () => {
    const state = scene();
    const canary = "CANARY_" + "5c8e1f04aa";
    writeFileSync(join(state.root, "ledger.jsonl"), JSON.stringify({ event: "intake" }) + "\n" + canary + "\n");
    const result = status(state);
    expect(result.code).toBe(3);
    expect(result.err).toContain("ledger.jsonl:2");
    expect(result.err).not.toContain(canary);
  });

  test("a mixed run writes labeled events and receipts the frozen schema accepts", () => {
    const state = scene({ type: "mixed", initExtra: ["--primary", "code", "--secondary", "design"] });
    const labels = { primary: "code", secondary: "design" };
    append(state, {
      event: "discover", type: "mixed", unit: "u1", program_id: null, plan: state.plan, session_id: "se-1",
      started_at: "2026-10-27T16:02:00Z", artifact: join(state.root, "receipts", "discover-explore-0123456.md"),
      ...labels,
    });
    append(state, { event: "plan", type: "mixed", unit: "u1", program_id: null, plan: state.plan, session_id: "se-1", started_at: "2026-10-27T16:02:00Z", artifact: state.plan, ...labels });
    // The gate writes a receipt for a mixed run: without the labels the frozen
    // schema rejects it and the verb exits 1 after changing state.
    const added = addFindings(state, [findingRow({ repro_cmd: "exit 0" })]);
    expect(added.code).toBe(0);
    const gate = cli(["gate", "--round", "2", "--root", state.root]);
    expect(gate.code).toBe(0);
    const receipt = JSON.parse(readFileSync(join(state.root, "receipts", `gate-dispatch-${state.repo.head.slice(0, 7)}.json`), "utf8"));
    expect(receipt.primary).toBe("code");
    expect(receipt.secondary).toBe("design");
    expect(validateReceipt(receipt).errors).toEqual([]);
    const gateEvent = ledgerEvents(state).filter((event) => event.event === "gate").pop();
    expect(gateEvent.primary).toBe("code");
    expect(gateEvent.secondary).toBe("design");
    expect(status(state).code).toBe(0);
  });

  test("an empty dispatch table still writes its receipt", () => {
    const state = scene();
    upToBuild(state);
    const gate = cli(["gate", "--round", "1", "--root", state.root]);
    if (gate.code !== 0) throw new Error("gate stderr: " + gate.err);
    expect(gate.code).toBe(0);
    const file = join(state.root, "receipts", `gate-dispatch-${state.repo.head.slice(0, 7)}.json`);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).rows).toEqual([]);
  });

  test("freezing an ancestor head records that commit's own tree", () => {
    const state = scene();
    const older = state.repo.head;
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    const newer = commitFile(state.repo, "third.txt", "three\n");
    const frozen = cli(["freeze", "--root", state.root, "--head", older]);
    if (frozen.code !== 0) throw new Error("freeze stderr: " + frozen.err);
    expect(frozen.code).toBe(0);
    const event = ledgerEvents(state).filter((e) => e.event === "freeze").pop();
    expect(event.head).toBe(older);
    expect(event.tree).toBe(state.repo.tree);
    expect(event.tree).not.toBe(newer.tree);
    // A commit landed after the freeze, so --check must refuse: that is the verb.
    expect(cli(["freeze", "--root", state.root, "--check"]).code).toBe(3);
  });

  test("typed receipts satisfy the lane they certify", () => {
    const typedReceipt = (state, kind, name = `${kind}-${state.repo.head.slice(0, 7)}.json`) => {
      const body = {
        kind, stage: "verify_lane", type: state.type, unit: "u1", program_id: null,
        ...(kind === "vqa-capture" ? { lane: "capture", pass: "capture" } : {}),
        ...(kind === "lint" ? { lane: "lint", name: "heading-order" } : {}),
        head: state.repo.head, tree: state.repo.tree, scope: ["skills/wish/**"],
        started_at: "2026-10-27T16:00:00Z", ended_at: "2026-10-27T16:01:00Z", status: "PASS",
        rows: [{ id: kind + "-r", command: "check", observable: "it holds", verdict: "PASS", artifact: null }],
        artifacts: [], cleanup: [],
      };
      expect(validateReceipt(body).errors).toEqual([]);
      // A lint receipt's name is <lint-name>-<tree7>: the contract's grammar decides.
      writeFileSync(join(state.root, "receipts", name), JSON.stringify(body));
    };
    // The lane only becomes relevant once a verify_lane receipt or event exists, so
    // one ordinary lane receipt is written first: without it the "after" assertion
    // would pass on the old code too, which is exactly the vacuity to avoid.
    const design = scene({ type: "design" });
    upToBuild(design);
    mkdirSync(join(design.root, "receipts"), { recursive: true });
    lane(design, { lane: "draft-guard", type: "design" });
    const before = status(design);
    expect(before.code).toBe(0);
    expect(before.json.blocking).toContain("receipt-missing:capture");
    typedReceipt(design, "vqa-capture");
    const designView = status(design);
    expect(designView.code).toBe(0);
    expect(designView.json.blocking).not.toContain("receipt-missing:capture");

    const audit = scene({ type: "audit" });
    upToBuild(audit);
    mkdirSync(join(audit.root, "receipts"), { recursive: true });
    lane(audit, { lane: "spot", type: "audit" });
    expect(status(audit).json.blocking).toContain("receipt-missing:lint");
    typedReceipt(audit, "lint", `lint-heading-order-${audit.repo.tree.slice(0, 7)}.json`);
    const auditView = status(audit);
    expect(auditView.code).toBe(0);
    expect(auditView.json.blocking).not.toContain("receipt-missing:lint");
  });

  test("an earlier high-risk flag is not retracted by a later unrelated row", () => {
    const state = scene();
    upToBuild(state);
    // A later high-risk row is recorded on its own event; the earlier flag stays.
    expect(append(state, {
      event: "build", type: "code", unit: "u1", program_id: null, plan: state.plan, session_id: "senpi:se-1",
      started_at: "2026-10-27T16:03:00Z", head: state.repo.head, task: "node-2",
      adversarial_classes: [{ name: "contract change", applicable: true, observable: "the gate exits 3" }],
    }).code).toBe(0);
    expect(append(state, {
      event: "build", type: "code", unit: "u1", program_id: null, plan: state.plan, session_id: "senpi:se-1",
      started_at: "2026-10-27T16:04:00Z", head: state.repo.head, task: "node-3",
      adversarial_classes: [{ name: "docs only", applicable: false, observable: "none" }],
    }).code).toBe(0);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    const view = status(state);
    expect(view.code).toBe(0);
    expect(view.json.blocking).toContain("receipt-missing:adversarial");
  });

  test("init keeps a custom unit when --unit is omitted on the second call", () => {
    const state = scene({ unit: "v2m1" });
    const again = cli([
      "init", "--run-id", state.runId, "--type", "code", "--tier", "M", "--plan", state.plan,
      "--root", state.root, "--fact", "one fact from the tier triage",
    ]);
    expect(again.code).toBe(0);
    expect(ledgerEvents(state).filter((event) => event.event === "intake").length).toBe(1);
  });

  test("a program id that reads as YAML null round-trips as a string", () => {
    const box = sandbox();
    const repo = makeRepo(box);
    writePlan(box.plan, { runId: "w-run-20261027-1600", tier: "M", type: "code", unit: "u1", worktree: repo.dir });
    const result = cli([
      "init", "--run-id", "w-run-20261027-1600", "--type", "code", "--tier", "M", "--plan", box.plan,
      "--root", box.root, "--unit", "u1", "--worktree", repo.dir, "--program", "null", "--fact", "f",
    ]);
    expect(result.code).toBe(0);
    expect(readFileSync(box.plan, "utf8")).toContain('program_id: "null"');
    expect(ledgerEvents({ root: box.root }).at(0).program_id).toBe("null");
  });

  test("a row whose command backgrounds a child is judged by the shell's exit", { timeout: 40_000 }, () => {
    const state = scene();
    upToBuild(state);
    addFindings(state, [findingRow({ repro_cmd: "sleep 30 & exit 0" })]);
    const started = Date.now();
    const gate = cli(["gate", "--round", "2", "--root", state.root]);
    expect(gate.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(20_000);
    const receipt = JSON.parse(readFileSync(join(state.root, "receipts", `gate-dispatch-${state.repo.head.slice(0, 7)}.json`), "utf8"));
    expect(receipt.rows[0].verdict).toBe("PASS");
  });

  test("a fix head on a row that is not fixed is normalized, not a false conflict", () => {
    const state = scene();
    upToBuild(state);
    expect(addFindings(state, [findingRow()]).code).toBe(0);
    const moved = cli(["findings", "set", "--root", state.root, "--id", "F1", "--status", "open", "--fixed-head", state.repo.head]);
    expect(moved.code).toBe(0);
    const view = cli(["findings", "list", "--json", "--root", state.root]);
    const row = JSON.parse(view.out).find((entry) => entry.id === "F1");
    expect(row.status).toBe("open");
    expect(row.fixed_head).toBe("-");
  });

  test("pr-body --out refuses to overwrite run state", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    expect(cli(["freeze", "--root", state.root]).code).toBe(0);
    const before = readFileSync(join(state.root, "ledger.jsonl"), "utf8");
    const result = cli(["pr-body", "--root", state.root, "--out", join(state.root, "ledger.jsonl")]);
    expect(result.code).toBe(2);
    expect(readFileSync(join(state.root, "ledger.jsonl"), "utf8")).toBe(before);
  });

  test("a body without a pull request names no number at all", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    expect(cli(["freeze", "--root", state.root]).code).toBe(0);
    const out = join(state.root, "body.md");
    expect(cli(["pr-body", "--root", state.root, "--out", out]).code).toBe(0);
    const body = readFileSync(out, "utf8");
    expect(body).not.toContain("#null");
    expect(body).not.toContain("#-");
    expect(body).toContain("PR: none");
  });
});

// Round 2 of the final review: the delta's own regressions, guarded here.
describe("final review round 2", () => {
  test("a second unit in the same root cannot take the first unit's labels", () => {
    // The live break: with a research-primary sibling in the root, the first unit's
    // findings table was parsed with the sibling's class union and refused its own rows.
    const state = scene({ type: "mixed", initExtra: ["--primary", "code", "--secondary", "design"] });
    const plan2 = join(state.box.dir, "plan2.md");
    writePlan(plan2, { runId: "w-run-20261027-1900", tier: "M", type: "mixed", unit: "u2", worktree: state.repo.dir });
    expect(cli([
      "init", "--run-id", "w-run-20261027-1900", "--type", "mixed", "--tier", "M", "--plan", plan2,
      "--root", state.root, "--unit", "u2", "--worktree", state.repo.dir,
      "--primary", "research", "--secondary", "design", "--fact", "one fact from the tier triage",
    ]).code).toBe(0);
    // A code class belongs to u1's union and must still be accepted after u2 exists.
    const file = join(state.box.dir, "findings-u1.tsv");
    writeFileSync(file, [FINDINGS_COLUMNS.join("\t"),
      ["F-SEC", "1", "ultrabrain", "SEC", "HIGH", "src/a.mjs:4", "1", "exit 3", state.repo.head, "open", "-"].join("\t")].join("\n"));
    // --plan names the acting unit: a shared root holds more than one plan.
    const added = cli(["findings", "add", "--tsv", file, "--root", state.root, "--plan", state.plan]);
    if (added.code !== 0) throw new Error("findings add: " + added.err);
    expect(added.code).toBe(0);
    const view = cli(["status", "--json", "--root", state.root, "--plan", state.plan]);
    if (view.code !== 0) throw new Error("status: " + view.err);
    expect(JSON.parse(view.out).blocking.some((entry) => entry.startsWith("findings:"))).toBe(true);
  });

  test("a verb that cannot tell two units apart asks for --plan", () => {
    const state = scene({ type: "mixed", initExtra: ["--primary", "code", "--secondary", "design"] });
    const plan2 = join(state.box.dir, "plan2.md");
    writePlan(plan2, { runId: "w-run-20261027-1900", tier: "M", type: "mixed", unit: "u2", worktree: state.repo.dir });
    expect(cli([
      "init", "--run-id", "w-run-20261027-1900", "--type", "mixed", "--tier", "M", "--plan", plan2,
      "--root", state.root, "--unit", "u2", "--worktree", state.repo.dir,
      "--primary", "research", "--secondary", "design", "--fact", "one fact from the tier triage",
    ]).code).toBe(0);
    const ambiguous = cli(["status", "--json", "--root", state.root]);
    expect(ambiguous.code).toBe(2);
    expect(ambiguous.err).toContain("--plan");
    expect(cli(["status", "--json", "--root", state.root, "--plan", state.plan]).code).toBe(0);
  });

  test("a second unit in the same root reads its own labels", () => {
    // A shared root can hold units whose labels differ, so a lookup must not borrow a
    // sibling's: the research-primary unit's identity follows its own intake event.
    const state = scene({ type: "mixed", initExtra: ["--primary", "code", "--secondary", "design"] });
    const plan2 = join(state.box.dir, "plan2.md");
    writePlan(plan2, { runId: "w-run-20261027-1900", tier: "M", type: "mixed", unit: "u2", worktree: state.repo.dir });
    const second = cli([
      "init", "--run-id", "w-run-20261027-1900", "--type", "mixed", "--tier", "M", "--plan", plan2,
      "--root", state.root, "--unit", "u2", "--worktree", state.repo.dir,
      "--primary", "research", "--secondary", "design", "--fact", "one fact from the tier triage",
    ]);
    expect(second.code).toBe(0);
    const sha = "a".repeat(64);
    const frozen = cli(["freeze", "--root", state.root, "--plan", plan2, "--head", sha]);
    if (frozen.code !== 0) throw new Error("freeze stderr: " + frozen.err);
    const event = ledgerEvents(state).filter((entry) => entry.event === "freeze" && entry.unit === "u2").pop();
    expect(event.head).toBe(sha);
    expect(event.tree).toBe(null);
    // The code/design unit still takes a commit sha, so the two identities coexist.
    expect(cli(["freeze", "--root", state.root, "--plan", state.plan, "--head", state.repo.head]).code).toBe(0);
    const first = ledgerEvents(state).filter((entry) => entry.event === "freeze" && entry.unit === "u1").pop();
    expect(first.head).toBe(state.repo.head);
    expect(first.tree).toBe(state.repo.tree);
  });


  test("a typed receipt alone advances the unit past build", () => {
    const audit = scene({ type: "audit" });
    upToBuild(audit);
    mkdirSync(join(audit.root, "receipts"), { recursive: true });
    expect(status(audit).json.stage).toBe("build");
    const body = {
      kind: "lint", stage: "verify_lane", type: "audit", unit: "u1", program_id: null, lane: "lint",
      name: "heading-order", head: audit.repo.head, tree: audit.repo.tree, scope: ["skills/wish/**"],
      started_at: "2026-10-27T16:00:00Z", ended_at: "2026-10-27T16:01:00Z", status: "PASS",
      rows: [{ id: "r", command: "check", observable: "it holds", verdict: "PASS", artifact: null }],
      artifacts: [], cleanup: [],
    };
    expect(validateReceipt(body).errors).toEqual([]);
    writeFileSync(join(audit.root, "receipts", `lint-heading-order-${audit.repo.tree.slice(0, 7)}.json`), JSON.stringify(body));
    expect(status(audit).json.stage).toBe("verify_lane");
  });


  test("importing the module installs no signal handler", () => {
    const script = `import "${CLI}"; console.log(JSON.stringify(process.eventNames().filter((n) => ["SIGINT", "SIGTERM", "SIGHUP"].includes(n))));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 30_000 });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual([]);
  });


  test("pr-body --out refuses to overwrite a lane receipt", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    expect(cli(["freeze", "--root", state.root]).code).toBe(0);
    const receipt = join(state.root, "receipts", `verify_lane-tests-${state.repo.head.slice(0, 7)}.json`);
    const before = readFileSync(receipt, "utf8");
    expect(cli(["pr-body", "--root", state.root, "--out", receipt]).code).toBe(2);
    expect(readFileSync(receipt, "utf8")).toBe(before);
  });
});

describe("final review round 2 (second pass)", () => {
  test("pr-body --out stays inside the evidence root, symlinks included", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    expect(cli(["freeze", "--root", state.root]).code).toBe(0);
    const product = join(state.box.dir, "product.md");
    writeFileSync(product, "the product's own file\n");
    const outside = cli(["pr-body", "--root", state.root, "--out", product]);
    expect(outside.code).toBe(2);
    expect(readFileSync(product, "utf8")).toBe("the product's own file\n");
    // A symlink inside the root that points outside it is the same write.
    const link = join(state.root, "body.md");
    symlinkSync(product, link);
    expect(cli(["pr-body", "--root", state.root, "--out", link]).code).toBe(2);
    expect(readFileSync(product, "utf8")).toBe("the product's own file\n");
    const inside = cli(["pr-body", "--root", state.root, "--out", join(state.root, "body-real.md")]);
    if (inside.code !== 0) throw new Error("inside stderr: " + inside.err + " root=" + state.root);
    expect(inside.code).toBe(0);
  });

  test("the dispatch gate refuses a head that is not the checkout", () => {
    const state = scene();
    upToBuild(state);
    const older = state.repo.head;
    commitFile(state.repo, "third.txt", "three\n");
    expect(addFindings(state, [findingRow({ repro_cmd: "exit 0" })]).code).toBe(0);
    const result = cli(["gate", "--round", "2", "--root", state.root, "--head", older]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("runs the current worktree");
  });

  test("a sibling's dispatch gate neither blocks nor clears this unit's", () => {
    const state = scene();
    const built = upToBuild(state);
    void built;
    // u1's own gate is open: a row still reproduces.
    expect(addFindings(state, [findingRow({ repro_cmd: "exit 1" })]).code).toBe(0);
    expect(cli(["gate", "--round", "2", "--root", state.root]).code).toBe(1);
    const plan2 = join(state.box.dir, "plan2.md");
    writePlan(plan2, { runId: "w-run-20261027-1900", tier: "M", type: "code", unit: "u2", worktree: state.repo.dir });
    expect(cli([
      "init", "--run-id", "w-run-20261027-1900", "--type", "code", "--tier", "M", "--plan", plan2,
      "--root", state.root, "--unit", "u2", "--worktree", state.repo.dir, "--fact", "one fact from the tier triage",
    ]).code).toBe(0);
    const closeSibling = join(state.box.dir, "sibling-gate.json");
    writeFileSync(closeSibling, JSON.stringify({
      event: "gate", type: "code", unit: "u2", program_id: null, plan: plan2, session_id: "senpi:s",
      started_at: "2026-10-27T16:05:00Z", gate_id: "dispatch", gate_status: "resolved",
    }));
    const closed = cli(["ledger", "append", "--event", "gate", "--json", closeSibling, "--root", state.root, "--plan", plan2]);
    if (closed.code !== 0) throw new Error("append: " + closed.err);
    expect(closed.code).toBe(0);
    const view = cli(["status", "--json", "--root", state.root, "--plan", state.plan]);
    if (view.code !== 0) throw new Error("status: " + view.err);
    expect(view.code).toBe(0);
    expect(JSON.parse(view.out).blocking).toContain("gate:dispatch open");
  });

  test("a failing mixed gate row moves the finding to not-fixed", () => {
    const state = scene({ type: "mixed", initExtra: ["--primary", "code", "--secondary", "design"] });
    upToBuild(state);
    expect(addFindings(state, [findingRow({ repro_cmd: "exit 1" })]).code).toBe(0);
    expect(cli(["gate", "--round", "2", "--root", state.root]).code).toBe(1);
    const rows = JSON.parse(cli(["findings", "list", "--json", "--root", state.root]).out);
    expect(rows.find((row) => row.id === "F1").status).toBe("not-fixed");
  });

  test("a program id with a quote round-trips through the front matter", () => {
    const box = sandbox();
    const repo = makeRepo(box);
    writePlan(box.plan, { runId: "w-run-20261027-1600", tier: "M", type: "code", unit: "u1", worktree: repo.dir });
    const odd = ' a"b ';
    const result = cli([
      "init", "--run-id", "w-run-20261027-1600", "--type", "code", "--tier", "M", "--plan", box.plan,
      "--root", box.root, "--unit", "u1", "--worktree", repo.dir, "--program", odd, "--fact", "f",
    ]);
    if (result.code !== 0) throw new Error("init: " + result.err);
    expect(result.code).toBe(0);
    expect(ledgerEvents({ root: box.root }).at(0).program_id).toBe(odd);
  });
});

describe("final review round 3", () => {
  test("a live chooser holds the queue closed", () => {
    const state = scene();
    const queue = join(state.root, "lock.queue");
    mkdirSync(queue, { recursive: true });
    // A peer that announced a choice and has not published yet: entering now could
    // be leapfrogged by the smaller number it is about to write.
    const choosing = join(queue, `${process.pid + 0}-peer.choosing`);
    writeFileSync(choosing, JSON.stringify({ pid: process.pid }));
    const blocked = append(state, { event: "discover", artifact: join(state.root, "receipts", "a.md") });
    expect(blocked.code).toBe(3);
    expect(blocked.err).toMatch(/chooser|still queued/);
    expect(existsSync(choosing)).toBe(true);
    rmSync(choosing);
    expect(append(state, { event: "discover", artifact: join(state.root, "receipts", "a.md") }).code).toBe(0);
  });

  test("a symlinked alias of the root cannot reach the ledger", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    expect(cli(["freeze", "--root", state.root]).code).toBe(0);
    const before = readFileSync(join(state.root, "ledger.jsonl"), "utf8");
    const alias = join(state.box.dir, "alias");
    symlinkSync(state.root, alias);
    const direct = cli(["pr-body", "--root", alias, "--out", join(alias, "ledger.jsonl")]);
    expect(direct.code).toBe(2);
    expect(readFileSync(join(state.root, "ledger.jsonl"), "utf8")).toBe(before);
  });
});

describe("final review round 3 (hard links)", () => {
  test("a hard link inside the root cannot reach the ledger", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    expect(cli(["freeze", "--root", state.root]).code).toBe(0);
    const before = readFileSync(join(state.root, "ledger.jsonl"), "utf8");
    const hard = join(state.root, "innocent.md");
    linkSync(join(state.root, "ledger.jsonl"), hard);
    const result = cli(["pr-body", "--root", state.root, "--out", hard]);
    expect(result.code).toBe(2);
    expect(readFileSync(join(state.root, "ledger.jsonl"), "utf8")).toBe(before);
  });

test("a hard link to a lane receipt cannot be overwritten", () => {
    const state = scene();
    upToBuild(state);
    const receipt = lane(state, { lane: "tests" });
    ["qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    expect(cli(["freeze", "--root", state.root]).code).toBe(0);
    const target = join(state.root, "receipts", receipt.name);
    const before = readFileSync(target, "utf8");
    const hard = join(state.root, "innocent-receipt.md");
    linkSync(target, hard);
    const result = cli(["pr-body", "--root", state.root, "--out", hard]);
    expect(result.code).toBe(2);
    expect(readFileSync(target, "utf8")).toBe(before);
  });

  test("an --out path that cannot be written is a usage error", () => {
    const state = scene();
    upToBuild(state);
    ["tests", "qa", "sweep", "code-review"].forEach((name) => lane(state, { lane: name }));
    expect(cli(["freeze", "--root", state.root]).code).toBe(0);
    const result = cli(["pr-body", "--root", state.root, "--out", join(state.root, "missing", "body.md")]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("not a writable path");
  });
});
