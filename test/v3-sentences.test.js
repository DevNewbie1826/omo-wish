// wish v3 - unit u6: the four carried passages, pinned as shipped-word sentinels.
//
// The passages are the requester's own words. The constants below are this
// test's copy of them; a changed character in either the constant or the file
// that owns it fails, which is the point of the gate.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const PASSAGES = Object.freeze({
  a: "Implement it, and also include, strictly, a device that confirms the implementation was done.",
  b: "In addition, fix it, and also include, strictly, a device that confirms the fix was made.",
  c: "Proceed with ulw-plan, and make the plan include the following: fix this; also include, strictly, a device that confirms the fix was made; and verify the visual QA conditions specifically and in detail, with not a single one omitted.",
  d: "After that, don't ask the requester. Proceed exactly as written in this content with mass-ulw, ulw-loop, and ulw-execute, at maximum parallelism, verifying rigorously. Deliver the work as several pull requests, include the before/after directly inside each pull request, and make the improvements clearly visible. As you proceed, report status to the requester very frequently, every time, saying how much of the whole work is done and which parts are done.",
});

const LABEL = /^\(([a-d])\) (.*)$/;
const STEP = /^- \[ \] (\d+)\. ([A-Z][A-Z-]*):/;

const PLAN_FORMAT = "skills/wish/references/plan-format.md";
const PROMPTS = "skills/wish/references/prompts.md";
const CODE_PLAYBOOK = "skills/wish/playbooks/code.md";
const DESIGN_PLAYBOOK = "skills/wish/playbooks/design.md";

function linesOf(file) {
  return readFileSync(join(ROOT, file), "utf8").split("\n");
}

function sentenceOf(line) {
  const trimmed = line.trim();
  const labelled = LABEL.exec(trimmed);
  return labelled ? labelled[2] : trimmed;
}

function copiesOf(file, passage) {
  return linesOf(file).filter((line) => sentenceOf(line) === passage);
}

function planSentences() {
  const lines = linesOf(PLAN_FORMAT);
  const start = lines.findIndex((line, index) => LABEL.test(line.trim())
    && lines[index + 1]?.startsWith("(b) ") && lines[index + 2]?.startsWith("(c) "));
  expect(start).toBeGreaterThanOrEqual(0);
  return lines.slice(start, start + 3).map(sentenceOf);
}

function executionSentence() {
  const lines = linesOf(PROMPTS);
  const anchor = lines.findIndex((line) => line.startsWith("The execution step restates the requester's base sentence"));
  expect(anchor).toBeGreaterThanOrEqual(0);
  const heading = lines.slice(0, anchor).reverse().find((line) => line.startsWith("### "));
  expect(heading.startsWith("### 2.8 ")).toBe(true);
  const fence = lines.findIndex((line, index) => index > anchor && line.trim() === "```");
  expect(fence).toBeGreaterThan(anchor);
  return lines[fence + 1];
}

function promptsPlanSentences() {
  const lines = linesOf(PROMPTS);
  const anchor = lines.findIndex((line) => line.startsWith("The plan carries these sentences verbatim"));
  expect(anchor).toBeGreaterThanOrEqual(0);
  const heading = lines.slice(0, anchor).reverse().find((line) => line.startsWith("### "));
  expect(heading.startsWith("### 4.1 ")).toBe(true);
  const open = lines.findIndex((line, index) => index > anchor && line.trim() === "```");
  expect(open).toBeGreaterThan(anchor);
  const close = lines.findIndex((line, index) => index > open && line.trim() === "```");
  expect(close).toBeGreaterThan(open);
  return lines.slice(open + 1, close).map((line) => line.trim()).filter((line) => line !== "");
}

function stepsOf(file) {
  const lines = linesOf(file);
  const marks = [];
  lines.forEach((line, index) => {
    const step = STEP.exec(line);
    if (step) marks.push({ number: step[1], name: step[2], start: index });
  });
  return marks.map((mark, index) => ({
    ...mark,
    body: lines.slice(mark.start, index + 1 < marks.length ? marks[index + 1].start : lines.length),
  }));
}

function stepNamed(file, name) {
  const found = stepsOf(file).filter((step) => step.name === name);
  expect(found).toHaveLength(1);
  return found[0].body;
}

function countIn(body, passage) {
  return body.filter((line) => sentenceOf(line) === passage).length;
}

describe("carried passages", () => {
  test("plan-format carries (a), (b) and (c) exactly once inside its labelled block", () => {
    expect(copiesOf(PLAN_FORMAT, PASSAGES.a)).toHaveLength(1);
    expect(copiesOf(PLAN_FORMAT, PASSAGES.b)).toHaveLength(1);
    expect(copiesOf(PLAN_FORMAT, PASSAGES.c)).toHaveLength(1);
    expect(planSentences()).toEqual([PASSAGES.a, PASSAGES.b, PASSAGES.c]);
  });

  test("prompts carries (d) exactly once", () => {
    expect(copiesOf(PROMPTS, PASSAGES.d)).toHaveLength(1);
  });

  test("prompts carries (a), (b) and (c) in the plan-review step", () => {
    expect(promptsPlanSentences()).toEqual([PASSAGES.a, PASSAGES.b, PASSAGES.c]);
    // (a) and (b) appear twice: once in the plan-review step and once as the
    // build-node RE-EMPHASIS the owner asked for at the implementation step.
    expect(copiesOf(PROMPTS, PASSAGES.a)).toHaveLength(2);
    expect(copiesOf(PROMPTS, PASSAGES.b)).toHaveLength(2);
    expect(copiesOf(PROMPTS, PASSAGES.c)).toHaveLength(1);
  });

  test("the build-node prompt re-emphasizes (a) and (b) verbatim", () => {
    const lines = linesOf(PROMPTS);
    const start = lines.findIndex((line) => line.startsWith("### 2.1 "));
    const end = lines.findIndex((line) => line.startsWith("### 2.2 "));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const section = lines.slice(start, end);
    expect(section.filter((line) => sentenceOf(line) === PASSAGES.a)).toHaveLength(1);
    expect(section.filter((line) => sentenceOf(line) === PASSAGES.b)).toHaveLength(1);
    expect(section.some((line) => line.includes("RE-EMPHASIS (owner)"))).toBe(true);
  });

  test("the design playbook carries (c) in PLAN, its owning step", () => {
    expect(copiesOf(DESIGN_PLAYBOOK, PASSAGES.c)).toHaveLength(1);
    expect(countIn(stepNamed(DESIGN_PLAYBOOK, "PLAN"), PASSAGES.c)).toBe(1);
    expect(countIn(stepNamed(DESIGN_PLAYBOOK, "BUILD"), PASSAGES.c)).toBe(0);
  });

  test("the code playbook carries (a), (b) and (c) in PLAN and (d) in BUILD", () => {
    const plan = stepNamed(CODE_PLAYBOOK, "PLAN");
    expect(countIn(plan, PASSAGES.a)).toBe(1);
    expect(countIn(plan, PASSAGES.b)).toBe(1);
    expect(countIn(plan, PASSAGES.c)).toBe(1);
    expect(countIn(plan, PASSAGES.d)).toBe(0);
    const build = stepNamed(CODE_PLAYBOOK, "BUILD");
    expect(countIn(build, PASSAGES.d)).toBe(1);
    expect(countIn(build, PASSAGES.a)).toBe(0);
    expect(countIn(build, PASSAGES.b)).toBe(0);
    expect(countIn(build, PASSAGES.c)).toBe(0);
  });

  test("this test's copies equal the shipped sentences byte for byte", () => {
    expect([...planSentences(), executionSentence()])
      .toEqual([PASSAGES.a, PASSAGES.b, PASSAGES.c, PASSAGES.d]);
  });

  test("the execution sentence travels with the same bytes into the code playbook", () => {
    expect(copiesOf(CODE_PLAYBOOK, executionSentence())).toHaveLength(1);
  });
});