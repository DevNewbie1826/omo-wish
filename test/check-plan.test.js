import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lintPlan, parseArgs } from "../skills/wish/scripts/check-plan.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(repo, "skills/wish/scripts/check-plan.mjs");
const fixture = (name) => readFileSync(join(repo, "test/fixtures/plans", name), "utf8");
const registerText = () => fixture("register.tsv");
const CODE = fixture("code-plan.md");
const dirs = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempPlan(text) {
  const dir = mkdtempSync(join(tmpdir(), "wish-plan-"));
  dirs.push(dir);
  const path = join(dir, "plan.md");
  writeFileSync(path, text);
  return path;
}

function runCli(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function mutate(text, from, to) {
  if (!text.includes(from)) throw new Error("fixture lost its anchor: " + from);
  return text.replace(from, to);
}

function lineOf(text, needle) {
  const index = text.split("\n").findIndex((line) => line.includes(needle));
  if (index === -1) throw new Error("no line contains " + needle);
  return index + 1;
}

function expectProblem(text, needle, message, options) {
  const result = lintPlan(text, options);
  const line = lineOf(text, needle);
  const messages = result.problems.filter((problem) => problem.line === line).map((problem) => problem.message);
  expect({ ok: result.ok, messages }).not.toEqual({ ok: true, messages: [] });
  expect(messages.join(" | ")).toContain(message);
  return result;
}

function expectClean(text, options) {
  const result = lintPlan(text, options);
  expect(result.problems).toEqual([]);
  return result;
}

test("plan-format example lints clean", () => {
  const doc = readFileSync(join(repo, "skills/wish/references/plan-format.md"), "utf8").replace(/\r\n?/g, "\n").split("\n");
  const start = doc.findIndex((line) => line.trim() === "```md wish:plan");
  expect(start).toBeGreaterThan(-1);
  const end = doc.findIndex((line, index) => index > start && line.trim() === "```");
  expect(end).toBeGreaterThan(start);
  const example = doc.slice(start + 1, end).join("\n");
  const result = expectClean(example);
  expect(result.counts.is).toBe(1);
  expect(result.type).toBe("code");
});

test("front matter: a bad value lands on its key's line", () => {
  const plan = mutate(CODE, "  tier: S", "  tier: X");
  expectProblem(plan, "tier: X", "frontmatter.wish.tier");
});

test("front matter: a missing block is a complaint", () => {
  expectProblem(mutate(CODE, "wish:\n", ""), "run_id:", "a key appears before the wish: block");
  const bare = CODE.slice(CODE.indexOf("---", 4) + 3);
  expect(lintPlan(bare).problems[0]).toEqual({ line: 1, message: "no front matter: the file opens with --- and a wish: block" });
});

test("front matter: an unknown key is a complaint", () => {
  expectProblem(mutate(CODE, "  unit: u1", "  unit: u1\n  primary: code"), "primary: code", "unknown field");
});

test("task rows: an implementation row outside ## Todos never runs", () => {
  const plan = mutate(CODE, "## Risk list\n", "## Risk list\n\n- [ ] 3. n-late: a row appended outside the task section\n");
  expectProblem(plan, "n-late", "a task row outside ## Todos and ## Final verification wave would never run");
});

test("task rows: the final verification wave needs an F row", () => {
  const plan = mutate(CODE, "- [ ] F1. n-verify: run the suite and QA-1 on the real command\n", "");
  expectProblem(plan, "## Final verification wave", "holds no \"- [ ] F<n>. <title>\" row");
});

test("task rows: duplicate numbers are complaints", () => {
  const plan = mutate(CODE, "- [ ] 2. n-test:", "- [ ] 1. n-test:");
  expectProblem(plan, "1. n-test:", "duplicate task row number 1");
});

test("task rows: a fenced task row is documentation", () => {
  const plan = mutate(CODE, "## Risk list\n", "## Risk list\n\n```md\n- [ ] 9. n-fenced: never a row\n- LIMIT: fenced : fenced\n```\n");
  expectClean(plan);
});

test("contract rows: an IS row naming an undeclared QA scenario is a complaint", () => {
  expectProblem(mutate(CODE, "criterion: QA-2", "criterion: QA-7"), "criterion: QA-7", "names QA-7, which has no QA scenario");
});

test("contract rows: a QA scenario owned by no IS row is a complaint", () => {
  const plan = mutate(CODE, "## Risk list\n", "- QA-3: an orphan scenario ; pass when: exit 0 ; evidence: x ; run: y\n\n## Risk list\n");
  expectProblem(plan, "QA-3:", "QA-3 is owned by no IS row");
});

test("contract rows: QA fields must appear in order", () => {
  const plan = mutate(CODE, " ; evidence: <evidence-root>/qa1-empty.log ; run: printf '' | tokenizer -", " ; run: printf '' | tokenizer - ; evidence: <evidence-root>/qa1-empty.log");
  expectProblem(plan, "QA-1:", "must read");
});

test("contract rows: an empty QA command is a complaint", () => {
  expectProblem(mutate(CODE, " ; run: tokenizer test/fixtures/tokens.txt", " ; run: "), "QA-2:", "empty run field");
});

test("contract rows: a COMPANION row must target a declared IS row", () => {
  expectProblem(mutate(CODE, "<- IS-2 :", "<- IS-7 :"), "COMPANION: the usage text", "targets IS-7, which is not a declared IS row");
  expectProblem(mutate(CODE, "<- IS-2 : ", "<- the other row : "), "COMPANION: the usage text", "COMPANION must read");
});

test("contract rows: COMPANION none. excludes other companions", () => {
  const plan = mutate(CODE, "## Contract\n", "## Contract\n\n- COMPANION: none.\n");
  expectProblem(plan, "COMPANION: none.", "excludes other COMPANION rows");
  expectClean(mutate(CODE, "- COMPANION: the usage text of the sibling command <- IS-2 : the same one-line text change ships in this PR", "- COMPANION: none."));
});

test("contract rows: an INVARIANT row needs a property and a proof", () => {
  expectProblem(mutate(CODE, "INVARIANT INV1: a non-empty input yields the same tokens as before : QA-2", "INVARIANT INV1: a non-empty input yields the same tokens as before :"), "INVARIANT INV1:", "must read");
  expectProblem(mutate(CODE, "INVARIANT INV1:", "INVARIANT: INV1"), "INVARIANT: INV1", "malformed row");
});

test("contract rows: a duplicate invariant id is a complaint", () => {
  const plan = mutate(CODE, "- IS-1 DEVICE:", "- INVARIANT INV1: a second property : QA-2\n- IS-1 DEVICE:");
  expectProblem(plan, "a second property", "duplicate invariant INV1");
});

test("contract rows: a LIMIT row needs a reason", () => {
  expectProblem(mutate(CODE, " : the request covers whitespace-separated input only", " "), "LIMIT: tab-separated", "LIMIT must read");
});

test("contract rows: a SWITCH row needs both sides", () => {
  const plan = mutate(CODE, "## Risk list\n", "- SWITCH: the parser only needed another branch -> re-read the input contract\n\n## Risk list\n");
  expectClean(plan);
  expectProblem(mutate(CODE, "## Risk list\n", "- SWITCH: the parser only needed another branch\n\n## Risk list\n"), "SWITCH:", "SWITCH must read");
});

test("contract rows: a guard row cites a declared invariant and names a node", () => {
  expectProblem(mutate(CODE, "- guard: INV1 :", "- guard: INV9 :"), "guard: INV9", "neither a declared INVARIANT nor an IS row");
  expectProblem(mutate(CODE, "- guard: IS-1 : an empty input exits non-zero -> n-parse", "- guard: IS-1 : an empty input exits non-zero"), "guard: IS-1 : an empty input", "guard must read");
});

test("contract rows: a no-test row names a declared QA scenario", () => {
  expectProblem(mutate(CODE, "the usage text is prose : QA-2", "the usage text is prose : QA-9"), "no-test: the usage text", "names QA-9, which has no QA scenario");
});

test("contract rows: a malformed declared row is loud", () => {
  expectProblem(mutate(CODE, "- IS-2: the usage text", "- IS-2 the usage text"), "IS-2 the usage text", "malformed row");
});

test("contract rows: complaints are ordered by line", () => {
  const plan = mutate(CODE, "criterion: QA-2", "criterion: QA-7");
  const broken = mutate(plan, " : the request covers whitespace-separated input only", "");
  const lines = lintPlan(broken).problems.map((problem) => problem.line);
  expect(lines.length).toBeGreaterThan(1);
  expect(lines).toEqual([...lines].sort((a, b) => a - b));
});

test("contract rows: CRLF changes nothing", () => {
  expectClean(CODE.replace(/\n/g, "\r\n"));
});

test("device rows: every IS row needs one", () => {
  const plan = mutate(CODE, "- IS-1 DEVICE: guard INV1 -> n-test\n", "");
  expectProblem(plan, "IS-1:", "IS-1 has no DEVICE row");
});

test("device rows: a form from another type is a complaint", () => {
  expectProblem(mutate(CODE, "- IS-1 DEVICE: guard INV1 -> n-test", "- IS-1 DEVICE: vqa B1 @ 390 light pair settings-390-light"), "IS-1 DEVICE:", "does not match the code device grammar");
});

test("device rows: a research device must cite a declared CLAIM", () => {
  const plan = fixture("research-plan.md");
  expectProblem(mutate(plan, "claim C1 gate", "claim C2 gate"), "claim C2 gate", "cites claim C2, which no CLAIM: row declares");
});

test("device rows: HIGH-RISK is only on code and mixed plans", () => {
  const plan = mutate(fixture("design-plan.md"), "## Risk list\n", "- HIGH-RISK: IS-1 (state) -> n-build\n\n## Risk list\n");
  expectProblem(plan, "HIGH-RISK:", "runs no adversarial lane");
  expectProblem(mutate(CODE, "HIGH-RISK: IS-1 (state)", "HIGH-RISK: IS-1 (rounds)"), "HIGH-RISK:", "HIGH-RISK must read");
  expectProblem(mutate(CODE, "HIGH-RISK: IS-1 (state) -> n-parse", "HIGH-RISK: IS-1 (state) -> "), "HIGH-RISK:", "HIGH-RISK must read");
});

test("type rows: a design plan needs a SCREEN row", () => {
  const plan = fixture("design-plan.md").split("\n").filter((line) => !line.startsWith("- SCREEN: ")).join("\n");
  expectProblem(plan, "## Contract", "needs at least one SCREEN: row");
});

test("type rows: a foreign kind is a complaint", () => {
  expectProblem(mutate(CODE, "## Risk list\n", "- CLAIM: C1 : a claim on a code plan\n\n## Risk list\n"), "CLAIM: C1", "belongs to the research type");
});

test("type rows: SCREEN needs its four fields", () => {
  const plan = mutate(fixture("design-plan.md"), " ; left-out: a decorative badge", "");
  expectProblem(plan, "SCREEN:", "SCREEN must read");
});

test("register: every IS row cites its gap id", () => {
  const plan = fixture("register-plan.md");
  const options = { register: { path: "register.tsv", text: registerText() } };
  expectClean(plan, options);
  expectProblem(mutate(plan, " ; gap: G1", ""), "IS-1:", "must cite its register row", options);
});

test("register: an unknown gap id is a complaint", () => {
  const plan = mutate(fixture("register-plan.md"), "gap: G1", "gap: G5");
  expectProblem(plan, "gap: G5", "cites G5, which is not in register.tsv", { register: { path: "register.tsv", text: registerText() } });
});

test("register: a malformed register is reported", () => {
  const options = { register: { path: "register.tsv", text: "id\tarea\nG1\tx\n" } };
  const result = lintPlan(fixture("register-plan.md"), options);
  expect(result.ok).toBe(false);
  expect(result.problems.map((problem) => problem.message).join(" | ")).toContain("register.tsv: tsv.header");
});

test("cli: --help exits 0", () => {
  const result = runCli(["--help"]);
  expect(result.code).toBe(0);
  expect(result.out).toContain("Usage: check-plan.mjs <plan.md>");
});

test("cli: -- ends the flags so a dashed path is a plan", () => {
  expect(parseArgs(["--", "-plan.md"])).toEqual({ help: false, json: false, plan: "-plan.md", register: null });
  expect(() => parseArgs(["a.md", "b.md"])).toThrow("unexpected argument");
  expect(() => parseArgs(["--json", "--register", "--json"])).toThrow("--register needs");
  expect(() => parseArgs([])).toThrow("no plan file given");
});

test("cli: a usage mistake exits 2", () => {
  expect(runCli([]).code).toBe(2);
  expect(runCli(["--nope", "x.md"]).code).toBe(2);
  expect(runCli(["--register"]).code).toBe(2);
  expect(runCli(["a.md", "b.md"]).code).toBe(2);
  expect(runCli(["/no/such/plan.md"]).code).toBe(2);
});

test("cli: a clean plan exits 0 with the summary", () => {
  const result = runCli([join(repo, "test/fixtures/plans/code-plan.md")]);
  expect(result.code).toBe(0);
  expect(result.err).toBe("");
  expect(result.out).toBe("PASS " + join(repo, "test/fixtures/plans/code-plan.md") + ": 2 IS rows, 2 QA scenarios, 2 DEVICE rows, 2 guard rows, 1 COMPANION rows\n");
});

test("cli: a failing plan exits 1 and names file and line", () => {
  const plan = mutate(CODE, "criterion: QA-2", "criterion: QA-7");
  const path = tempPlan(plan);
  const result = runCli([path]);
  expect(result.code).toBe(1);
  expect(result.err).toContain(path + ":" + lineOf(plan, "criterion: QA-7") + ": ");
  expect(result.err).toContain("FAIL " + path + ": ");
  expect(result.out).toBe("");
});

test("cli: --json prints the counts", () => {
  const result = runCli(["--json", join(repo, "test/fixtures/plans/research-plan.md")]);
  expect(result.code).toBe(0);
  const parsed = JSON.parse(result.out);
  expect(parsed.ok).toBe(true);
  expect(parsed.type).toBe("research");
  expect(parsed.counts).toEqual({ is: 1, qa: 1, devices: 1, guards: 1, companions: 0, invariants: 1, limits: 1, switches: 0, highRisk: 0, typeRows: 2, tasks: 2 });
});

test("cli: an unreadable register exits 2", () => {
  const result = runCli([join(repo, "test/fixtures/plans/register-plan.md"), "--register", "/no/such/register.tsv"]);
  expect(result.code).toBe(2);
  expect(result.err).toContain("cannot read");
});

test("contract.md carries the reviewer rule verbatim", () => {
  const contract = readFileSync(join(repo, "skills/wish/references/contract.md"), "utf8").replace(/\r\n?/g, "\n");
  const rule = "Evidence problems are never a REVISE reason. Typos, number errors, and wording or format problems in evidence or reports do not cause REVISE. Write each one as a correction memo in your report; do not fix the evidence yourself and do not request a re-review for it. Only a problem in CODE can cause REVISE, and only inside the plan's finite contract: a listed invariant violated, shown by a failing test (or, for a behavior the plan marks no-test, by its failing QA scenario), or an IS or COMPANION row not delivered. Report every other finding as a note or a follow-up, never as a blocker; a known limit listed in the plan is not a finding. The plan review of step 3 judges the contract itself and keeps the blocker definition of references/plan.md, Step 3.";
  expect(contract.split(rule).length - 1).toBe(1);
  expect(contract).toContain("carries the following paragraph verbatim");
  expect(contract).toContain("is that unit's IS rows only");
  expect(contract).toContain("plan-reviewer");
  expect(contract).toContain("category: architect");
});