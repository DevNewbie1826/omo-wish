import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lintPlan } from "../skills/wish/scripts/check-plan.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) => readFileSync(join(repo, "test/fixtures/plans", name), "utf8");
const CODE = fixture("code-plan.md");

const TASK_ROW = "- [ ] 2. n-test: cover the empty input and the single-token input";
const FINAL_ROW = "- [ ] F1. n-verify: run the suite and QA-1 on the real command";

function mutate(text, from, to) {
  if (!text.includes(from)) throw new Error("fixture lost its anchor: " + from);
  return text.replace(from, to);
}

function lineOf(text, needle) {
  const index = text.split("\n").findIndex((line) => line.includes(needle));
  if (index === -1) throw new Error("no line contains " + needle);
  return index + 1;
}

function messagesAt(result, line) {
  return result.problems.filter((problem) => problem.line === line).map((problem) => problem.message);
}

function expectClean(text) {
  const result = lintPlan(text);
  expect(result.problems).toEqual([]);
  return result;
}

function expectMalformedRow(text, needle, label) {
  const result = lintPlan(text);
  const line = lineOf(text, needle);
  const atLine = result.problems.filter((problem) => problem.line === line);
  expect({ label, ok: result.ok, messages: atLine.map((problem) => problem.message) }).not.toEqual({ label, ok: true, messages: [] });
  const malformed = atLine.find((problem) => problem.message.includes("malformed row"));
  expect({ label, found: Boolean(malformed) }).toEqual({ label, found: true });
  expect({ label, rule: malformed.rule }).toEqual({ label, rule: "PL16" });
}

test("blocked acceptance: a [~] task row lints clean", () => {
  const plan = mutate(CODE, "- [ ] 2. n-test:", "- [~] 2. n-test:");
  expectClean(plan);
});

test("blocked acceptance: a [~] final row lints clean", () => {
  const plan = mutate(CODE, "- [ ] F1. n-verify:", "- [~] F1. n-verify:");
  expectClean(plan);
});

test("blocked acceptance: the three checkbox states still lint clean", () => {
  for (const state of [" ", "x", "X"]) {
    const plan = mutate(CODE, "- [ ] 2. n-test:", `- [${state}] 2. n-test:`);
    expectClean(plan);
  }
});

test("blocked acceptance: a [~] task row is still counted", () => {
  const plan = mutate(CODE, "- [ ] 2. n-test:", "- [~] 2. n-test:");
  const result = expectClean(plan);
  expect(result.counts.tasks).toBe(3);
});

test("blocked rows: a [~] row outside ## Todos is still a task row", () => {
  const plan = mutate(CODE, "## Risk list\n", "## Risk list\n\n- [~] 3. n-late: never runs\n");
  const result = lintPlan(plan);
  const line = lineOf(plan, "n-late");
  const messages = messagesAt(result, line).join(" | ");
  expect(messages).toContain("a task row outside ## Todos");
  expect(messages).not.toContain("malformed row");
});

test("blocked rows: a [~] row still answers the duplicate-number rule", () => {
  const plan = mutate(CODE, "- [ ] 2. n-test:", "- [~] 1. n-test:");
  const result = lintPlan(plan);
  const line = lineOf(plan, "n-test:");
  const messages = messagesAt(result, line).join(" | ");
  expect(messages).toContain("duplicate task row number 1");
  expect(messages).not.toContain("malformed row");
});

test("blocked rows: a tab after the [~] checkbox is still a row", () => {
  const plan = mutate(CODE, "- [ ] 2. n-test:", "- [~]\t2. n-test:");
  const result = lintPlan(plan);
  expect(result.problems).toEqual([]);
  expect(result.counts.tasks).toBe(3);
});

const brokenTaskStates = [
  ["~~", "- [~~] 2. n-test: cover the empty input and the single-token input"],
  ["-", "- [-] 2. n-test: cover the empty input and the single-token input"],
  ["_", "- [_] 2. n-test: cover the empty input and the single-token input"],
  ["x~", "- [x~] 2. n-test: cover the empty input and the single-token input"],
];

for (const [state, row] of brokenTaskStates) {
  test(`blocked malformed: task checkbox state [${state}] is a malformed row`, () => {
    expectMalformedRow(mutate(CODE, TASK_ROW, row), row, state);
  });
}

test("blocked malformed: final checkbox state [~~] is a malformed row", () => {
  const row = "- [~~] F1. n-verify: run the suite and QA-1 on the real command";
  expectMalformedRow(mutate(CODE, FINAL_ROW, row), row, "~~ final");
});
