import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..");

const doc = (rel) => readFileSync(join(repo, rel), "utf8");

function lineContaining(text, needle, label = JSON.stringify(needle)) {
  const hits = text.split("\n").filter((line) => line.includes(needle));
  assert.equal(hits.length, 1, `${label}: expected exactly one line containing the anchor, found ${hits.length}`);
  return hits[0];
}

function lineMatching(text, pattern, label) {
  const hits = text.split("\n").filter((line) => pattern.test(line));
  assert.equal(hits.length, 1, `${label}: expected exactly one matching line, found ${hits.length}`);
  return hits[0];
}

function lineHas(line, needle, label) {
  assert.ok(line.includes(needle), `${label}: expected line to contain ${JSON.stringify(needle)}; got: ${line}`);
}

function lineLacks(line, needle, label) {
  assert.ok(!line.includes(needle), `${label}: expected line NOT to contain ${JSON.stringify(needle)}; got: ${line}`);
}

function docHas(text, needle, label) {
  assert.ok(text.includes(needle), `${label}: expected document to contain ${JSON.stringify(needle)}`);
}

function docLacks(text, needle, label) {
  assert.ok(!text.includes(needle), `${label}: expected document NOT to contain ${JSON.stringify(needle)}`);
}

test("issue110-06-checkpoint-signature", () => {
  const line = lineContaining(doc("skills/wish/playbooks/code.md"), "agentToolkit.checkpoint");
  lineHas(line, 'agentToolkit.checkpoint({goalId, status:"complete", evidence, qualityGateJson})', "checkpoint signature");
  lineLacks(line, 'op:"complete"', "checkpoint signature");
});

test("issue110-17-default-branch-plan-name", () => {
  const line = lineContaining(doc("skills/wish/SKILL.md"), "The default branch is the one that always exists");
  lineHas(line, ".omo/plans/wish-<slug>.md", "default branch plan name");
  lineLacks(line, ".omo/plans/<slug>.md", "default branch plan name");
});

test("issue110-12a-skill-adversarial-condition", () => {
  const line = lineMatching(
    doc("skills/wish/SKILL.md"),
    /^\| `code` \|.*playbooks\/code\.md/,
    "code work-type row",
  );
  lineHas(line, "tier L or a high-risk plan row", "code work-type adversarial condition");
});

test("issue110-12b-ledger-adversarial-condition", () => {
  const line = lineMatching(
    doc("skills/wish/references/ledger.md"),
    /^\| `code` \|.*tests/,
    "code required-lanes row",
  );
  lineHas(line, "tier L or a high-risk plan row", "code required-lanes adversarial condition");
});

test("issue110-16-no-ghost-branch", () => {
  docLacks(doc("skills/wish/references/plan-format.md"), "exp/o3", "plan-format ghost branch");
});

test("issue110-14-near-miss-example", () => {
  docLacks(doc("skills/wish/references/plan-format.md"), "`limits:`", "plan-format backticked limits example");
});

test("issue110-13-verdict-artifact-name", () => {
  const line = lineContaining(doc("skills/wish/references/ledger.md"), '"event":"verdict"');
  assert.match(line, /final-r4-0123456\.md/, `verdict artifact: expected line to name final-r4-0123456.md; got: ${line}`);
  lineLacks(line, "verdict-ultrabrain", "verdict artifact");
});

test("issue110-02-commit-convention", () => {
  const text = doc("skills/wish/references/prompts.md");
  docLacks(text, "Conventional", "commit convention");
  const line = lineContaining(text, "With no stronger local convention");
  lineHas(line, "follow the loaded skill", "commit convention");
});

test("issue110-10-per-surface-kind-widths", () => {
  const text = doc("skills/wish/playbooks/design.md");
  const line = lineContaining(text, "The before matrix is");
  lineHas(line, "390", "before matrix widths");
  docHas(text, "column counts", "before matrix widths");
  docHas(text, "page size", "before matrix widths");
});

test("issue110-01-before-any-ui-row", () => {
  const before = lineContaining(doc("skills/wish/playbooks/design.md"), "4. BEFORE");
  lineHas(before, "edits existing UI", "design BEFORE step");
  lineLacks(before, "skip: no defect row", "design BEFORE step");

  const row = lineMatching(doc("skills/wish/SKILL.md"), /^\| 3 \| `before` \|/, "stage 3 before row");
  lineHas(row, "edits existing UI", "stage 3 before row");
});

test("issue110-11-cap-precedence", () => {
  const text = doc("skills/wish/playbooks/design.md");
  docHas(text, "overrides `visual-qa`'s bounded-round cap", "design cap precedence");
  docHas(text, "the register, not a round count, closes the unit", "design cap precedence");
  assert.ok(
    text.split("\n")[0].startsWith("# design:"),
    `design cap precedence: H1 must remain line 1; got: ${text.split("\n")[0]}`,
  );
  const step11 = lineContaining(text, "extended-budget rule overrides", "cap precedence sentence");
  lineHas(step11, "Each writes its own receipt:", "cap precedence location");
});

test("issue110-04-review-work-scope", () => {
  const line = lineMatching(
    doc("skills/wish/SKILL.md"),
    /^\| `verify_lane`.*`round`.*\|/,
    "verify_lane skills-to-read row",
  );
  lineHas(line, "worktree", "review-work scope");
  lineHas(line, "freshness", "review-work scope");
  assert.ok(
    !line.trimEnd().endsWith("| `review-work` |"),
    `review-work scope: expected more than the bare pointer row; got: ${line}`,
  );
});

// [guard slot 13] issue110-15 plan-format no-test pairing goes here.
test("issue110-15-no-test-pairing", () => {
  const line = lineContaining(doc("skills/wish/references/plan-format.md"), "no-test: the usage text");
  lineHas(line, "empty-input claim is prose : QA-1", "no-test pairing");
});
