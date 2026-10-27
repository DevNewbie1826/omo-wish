import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(repo, "skills/wish/scripts/check-plan.mjs");
const roots = [];

afterAll(() => {
	for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const BASE_FILES = [
	"skills/wish/references/plan.md",
	"skills/wish/scripts/check-plan.mjs",
	"test/plan-check.test.js",
];

const BASE_PLAN = `# Plan: fixture

## IS rows (ideal state) and success criteria
- **IS-1** The checker exists and is runnable. Criterion: QA-1.
- **IS-2** The test proves the checker. Criterion: QA-2.

## COMPANION rows
- COMPANION: the README mirror <- IS-1 : the README copies the same step.

## Invariants (finite contract)
- INV1 A plan that satisfies every rule passes cleanly. : QA-1
- INV2 Every complaint names a plan line. : QA-2

## Wiring
- IS-1: entry point \`skills/wish/scripts/check-plan.mjs\`, consumer the plan author, owner \`skills/wish/references/plan.md\`.
- IS-2: entry point \`test/plan-check.test.js\`, consumer \`bun test\`, owner \`skills/wish/references/plan.md\`.

## QA scenarios
- **QA-1** (IS-1) run the checker -> PASS iff exit 0.
- **QA-2** (IS-2) run the test -> PASS iff exit 0.

## Risk list
- guard: INV1 : a complete plan is rejected -> node \`n-checker\` (complete case)
- guard: IS-2 : a complaint carries no line -> node \`n-checker\` (line case)

## Pinned rules
- Worktree pinned for every command.
- Commits serialized.
`;

function fixture(planText, files = BASE_FILES) {
	const dir = mkdtempSync(join(tmpdir(), "plan-check-"));
	roots.push(dir);
	for (const file of files) {
		mkdirSync(join(dir, dirname(file)), { recursive: true });
		writeFileSync(join(dir, file), "");
	}
	const plan = join(dir, "fixture.md");
	writeFileSync(plan, planText);
	return { dir, plan };
}

function mutate(from, to) {
	if (!BASE_PLAN.includes(from)) throw new Error(`fixture lost its anchor: ${from}`);
	return BASE_PLAN.replace(from, to);
}

function run(planText) {
	const { dir, plan } = fixture(planText);
	const result = spawnSync("node", [cli, plan, "--repo", dir], { encoding: "utf8" });
	return { code: result.status, out: result.stdout, err: result.stderr, plan, dir };
}

function lineOf(planText, needle) {
	const index = planText.split("\n").findIndex((line) => line.includes(needle));
	if (index === -1) throw new Error(`no line contains ${needle}`);
	return index + 1;
}

test("a complete plan passes with a counted PASS summary", () => {
	const result = run(BASE_PLAN);
	expect(result.err).toBe("");
	expect(result.code).toBe(0);
	expect(result.out).toBe(`PASS ${result.plan}: 2 IS rows, 2 QA scenarios, 2 guard rows, 1 COMPANION rows\n`);
});

test("an IS row that no QA scenario names is a complaint on that row", () => {
	const plan = mutate("- **IS-2** The test proves the checker. Criterion: QA-2.\n", "- **IS-2** The test proves the checker.\n")
		.replace("- **QA-2** (IS-2) run the test", "- **QA-2** run the test");
	const result = run(plan);
	expect(result.code).toBe(1);
	expect(result.err).toContain(`fixture.md:${lineOf(plan, "**IS-2**")}: IS-2 is not named by any QA scenario`);
});

test("one direction of the pairing is enough: an IS row naming its scenarios passes", () => {
	const plan = mutate("- **QA-1** (IS-1) run the checker", "- **QA-1** run the checker").replace("- **QA-2** (IS-2) run the test", "- **QA-2** run the test");
	const result = run(plan);
	expect(result.err).toBe("");
	expect(result.code).toBe(0);
});

test("a QA scenario that no IS row owns is a complaint on that scenario", () => {
	const plan = mutate(
		"- **QA-2** (IS-2) run the test -> PASS iff exit 0.",
		"- **QA-2** (IS-2) run the test -> PASS iff exit 0.\n- **QA-3** run an orphan scenario -> PASS iff exit 0.",
	);
	const result = run(plan);
	expect(result.code).toBe(1);
	expect(result.err).toContain(`fixture.md:${lineOf(plan, "**QA-3**")}: QA-3 is owned by no IS row`);
});

test("a guard row citing an undeclared invariant is a complaint on that row", () => {
	const plan = mutate("- guard: INV1 :", "- guard: INV9 :");
	const result = run(plan);
	expect(result.code).toBe(1);
	expect(result.err).toContain(`fixture.md:${lineOf(plan, "guard: INV9")}: guard row cites "INV9"`);
	expect(result.err).toContain("neither a listed INVARIANT nor an IS row");
});

test("a guard row without the reference separator is a complaint", () => {
	const plan = mutate("- guard: IS-2 : a complaint carries no line", "- guard: a complaint carries no line");
	const result = run(plan);
	expect(result.code).toBe(1);
	expect(result.err).toContain("guard row must read `guard: <INVARIANT or IS row>");
});

test("a COMPANION row without the arrow shape is a complaint", () => {
	const plan = mutate(
		"- COMPANION: the README mirror <- IS-1 : the README copies the same step.",
		"- COMPANION: the README mirror : the README copies the same step.",
	);
	const result = run(plan);
	expect(result.code).toBe(1);
	expect(result.err).toContain(`fixture.md:${lineOf(plan, "COMPANION: the README mirror :")}: COMPANION row must read`);
});

test("a COMPANION row naming an undeclared IS row is a complaint", () => {
	const plan = mutate("<- IS-1 : the README", "<- IS-7 : the README");
	const result = run(plan);
	expect(result.code).toBe(1);
	expect(result.err).toContain("COMPANION row targets IS-7, which is not a declared IS row");
});

test("a wiring path that neither exists nor is delivered is a complaint", () => {
	const plan = mutate("owner `skills/wish/references/plan.md`.\n- IS-2", "owner `skills/wish/references/missing.md`.\n- IS-2");
	const result = run(plan);
	expect(result.code).toBe(1);
	expect(result.err).toContain(
		`fixture.md:${lineOf(plan, "missing.md")}: wiring path "skills/wish/references/missing.md" does not exist`,
	);
});

test("a wiring path that an IS row delivers is accepted as a new file", () => {
	let plan = mutate(
		"owner `skills/wish/references/plan.md`.\n- IS-2",
		"owner `docs/experiments/new.md`.\n- IS-2",
	);
	plan = plan.replace("- **IS-1** The checker exists and is runnable.", "- **IS-1** `docs/experiments/new.md` exists and is runnable.");
	const result = run(plan);
	expect(result.err).toBe("");
	expect(result.code).toBe(0);
});

test("a state or lifetime row without transitions is a complaint", () => {
	const plan = mutate(
		"- **IS-2** The test proves the checker. Criterion: QA-2.",
		"- **IS-2** The test proves the checker. Criterion: QA-2.\n\n- high-risk (state/lifetime): IS-1 (round state) -> node `n-checker`",
	);
	const result = run(plan);
	expect(result.code).toBe(1);
	expect(result.err).toContain(`fixture.md:${lineOf(plan, "high-risk (state/lifetime): IS-1")}: IS-1 is flagged state/lifetime`);
});

test("the same state row passes when a Transitions section lists it", () => {
	const plan = mutate(
		"- **IS-2** The test proves the checker. Criterion: QA-2.",
		"- **IS-2** The test proves the checker. Criterion: QA-2.\n- high-risk (state/lifetime): IS-1 (round state) -> node `n-checker`\n\n## Transitions\n- IS-1: created at plan start, retired when the PR merges.",
	);
	const result = run(plan);
	expect(result.err).toBe("");
	expect(result.code).toBe(0);
});

test("each missing pinned rule is a complaint", () => {
	const noWorktree = run(mutate("- Worktree pinned for every command.\n", ""));
	expect(noWorktree.code).toBe(1);
	expect(noWorktree.err).toContain("missing pinned rule: every command pins the task worktree");
	const noCommit = run(mutate("- Commits serialized.\n", ""));
	expect(noCommit.code).toBe(1);
	expect(noCommit.err).toContain("missing pinned rule: commits are serialized");
});

test("rows inside a fenced block are documentation, not plan rows", () => {
	const plan = mutate(
		"## Risk list\n",
		"## Risk list\n```md\n- **IS-9** a fenced example\n- guard: NOWHERE : fenced\n- COMPANION: fenced : no arrow\n- high-risk (state/lifetime): IS-9\n```\n",
	);
	const result = run(plan);
	expect(result.err).toBe("");
	expect(result.code).toBe(0);
});

test("a plan without IS rows fails instead of passing silently", () => {
	const result = run("# Plan\n\n## Pinned rules\n- Worktree pinned for every command.\n- Commits serialized.\n");
	expect(result.code).toBe(1);
	expect(result.err).toContain("no IS rows found");
});

const TABLE_PLAN = `# Plan: table fixture

## IS rows

| ID | Deliverable | Production entry point | Consumer | Authoritative owner |
| --- | --- | --- | --- | --- |
| IS1 | the checker | \`skills/wish/scripts/check-plan.mjs\` | the plan author | the plan file |
| IS2 | the test | \`test/plan-check.test.js\` | \`bun test\` | the test file |

## QA scenarios

| ID | Pairing | Command | PASS observable |
| --- | --- | --- | --- |
| QA1 | IS1 happy path | run the CLI | exit 0 |
| QA2 | IS2 regression | run bun test | exit 0 |

## Risk list
- guard: INV1 : the CLI rejects a complete plan -> node n1
- no-test: the prose rows -> QA1

## Invariants (finite contract)
- INV1 A complete plan passes. : QA1

## Pinned rules
- Every command pins the worktree.
- Commits are serialized.
`;

const RANGE_PLAN = `# Plan: range fixture

## IS rows
- IS1 first property.
- IS2 second property.
- IS3 third property.

## Wiring
- IS1-IS2: entry point \`skills/wish/scripts/check-plan.mjs\`, consumer the author, owner \`skills/wish/references/plan.md\`.
- IS3: entry point \`test/plan-check.test.js\`, consumer \`bun test\`, owner \`skills/wish/references/plan.md\`.

## QA scenarios
- QA1 (IS1) run one -> PASS iff exit 0.
- QA2 (IS2) run two -> PASS iff exit 0.

IS-row to QA pairing: IS1-IS2 -> QA1, QA2; IS3 -> QA3.

- QA3 (IS3) run three -> PASS iff exit 0.

## Pinned rules
- Every command pins the task worktree.
- Commits are serialized.
`;

test("table-based IS and QA rows are read with their wiring columns", () => {
	const result = run(TABLE_PLAN);
	expect(result.err).toBe("");
	expect(result.code).toBe(0);
	expect(result.out).toContain("2 IS rows, 2 QA scenarios, 1 guard rows");
});

test("range ids cover every row they span, in wiring and in the pairing line", () => {
	const result = run(RANGE_PLAN);
	expect(result.err).toBe("");
	expect(result.code).toBe(0);
});

test("COMPANION: none is a sentinel, and a slash list of targets is read", () => {
	const none = run(mutate("- COMPANION: the README mirror <- IS-1 : the README copies the same step.", "- COMPANION: none."));
	expect(none.err).toBe("");
	expect(none.code).toBe(0);
	const list = run(
		mutate(
			"- COMPANION: the README mirror <- IS-1 : the README copies the same step.",
			"- COMPANION: both mirrors <- IS-1/IS-2 : both copies change.",
		),
	);
	expect(list.err).toBe("");
	expect(list.code).toBe(0);
});

test("pairing segments split only when a part holds several arrows", () => {
	const plan = RANGE_PLAN.replace("IS-row to QA pairing: IS1-IS2 -> QA1, QA2; IS3 -> QA3.", "IS-row to QA pairing: IS1-IS2 -> QA1; IS3 -> QA2, QA3.");
	const result = run(plan);
	expect(result.err).toBe("");
	expect(result.code).toBe(0);
});

test("missing arguments and unreadable plans exit 2", () => {
	const noArgs = spawnSync("node", [cli], { encoding: "utf8" });
	expect(noArgs.status).toBe(2);
	expect(noArgs.stderr).toContain("Usage: node check-plan.mjs <plan.md>");
	const missing = spawnSync("node", [cli, join(tmpdir(), "plan-check-does-not-exist.md")], { encoding: "utf8" });
	expect(missing.status).toBe(2);
	expect(missing.stderr).toContain("cannot read");
});