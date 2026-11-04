import { TIERS, WORK_TYPES, PRIMARY_TYPES, LEDGER_EVENTS, RECEIPT_STATUSES, ROW_VERDICTS, RECEIPT_KINDS, GAP_STATUSES, SWITCH_KINDS, ROUND_VERDICTS, STAGE_NAMES } from "./constants.mjs";
import { T, isStr, fail, RUN_ID } from "./primitives.mjs";
import { LEDGER_COMMON_SPEC, PROGRESS_VALUES_SPEC } from "./specs.mjs";
export const LEDGER_EVENT_EXTRAS = {
  intake: {
    tier: T.enumOf(TIERS), facts: T.arr(T.str, 1),
    // The identity keys a planless read derives the run from (§9.3): optional on
    // intake, rejected as unknown on every other event. run_id is the run's own
    // w-<slug>-<yyyymmdd>-<hhmm>, so it faces the same shape as the front matter.
    run_id: T.opt((v, p, e) => {
      if (!isStr(v) || !RUN_ID.test(v)) fail(e, p, "expected w-<slug>-<yyyymmdd>-<hhmm>");
    }),
    worktree: T.opt(T.str),
    branch: T.opt(T.str),
  },
  collect: { sources: T.opt(T.int(0)), elements: T.opt(T.int(0)), report: T.opt(T.str) },
  define: { round: T.opt(T.int(0)), ideal: T.opt(T.int(0)), gaps: T.opt(T.int(0)), report: T.opt(T.str) },
  before: { gap_id: T.gap, artifact: T.str },
  plan: { artifact: T.str, round: T.opt(T.int(0)) },
  plan_review: { verdict: T.enumOf(["OKAY", "BLOCKERS"]) },
  plan_lint: { verdict: T.opt(T.enumOf([...ROUND_VERDICTS, ...RECEIPT_STATUSES])), round: T.opt(T.int(0)) },
  decide: { count: T.opt(T.int(0)), gates: T.opt(T.arr(T.str)), recommended: T.opt(T.arr(T.str)), parked: T.opt(T.str) },
  goal: { artifact: T.str },
  build: { task: T.str },
  verify_lane: { lane: T.kebab, verdict: T.enumOf(RECEIPT_STATUSES) },
  triage: {},
  fix: { round: T.int(0) },
  reuse: { reuse: T.obj({ receipt: T.str, verdict: T.enumOf(["VALID", "STALE"]), reason: T.str }) },
  freeze: { tree: T.nullable(T.str), pr: T.nullable(T.int(1)) },
  pr_open: { pr: T.int(1) },
  gate: { gate_id: T.str, gate_status: T.enumOf(["open", "resolved"]) },
  round: { round: T.int(1), verdict: T.enumOf(ROUND_VERDICTS) },
  verdict: { round: T.int(1), verdict: T.enumOf(ROUND_VERDICTS), artifact: T.str },
  switch: {
    round: T.int(1), kind: T.enumOf(SWITCH_KINDS), premise: T.str, new_approach: T.str,
  },
  progress: { progress: T.obj(PROGRESS_VALUES_SPEC) },
  merge: { sha: T.hex40, merged_at: T.iso, pr: T.int(1) },
  post_merge: {},
  checkpoint: { checkpoint_op: T.enumOf(["open", "complete", "blocked"]) },
  cleanup: { cleanup: T.arr(T.str, 1) },
  resume: { note: T.str },
};
const LEDGER_OPTIONAL = [
  "head", "tree", "ended_at", "duration_s", "commands", "artifact", "cleanup", "attempt",
  "checkpoint_opened_at", "category", "agent", "model_family", "verdict", "round", "reuse",
  "tier", "gate_id", "gate_status", "checkpoint_op", "pr", "sha", "merged_at", "note",
  "primary", "secondary", "facts", "progress", "gap_id", "gap_status", "kind", "premise",
  "new_approach", "rules_total", "lane", "task", "adversarial_classes",
  "sources", "elements", "report", "ideal", "gaps", "count", "gates", "recommended", "parked",
  "prior_repeat",
];
export const LEDGER_KEYS = [...new Set([...Object.keys(LEDGER_COMMON_SPEC), ...LEDGER_OPTIONAL])];
const ADVERSARIAL_SPEC = { name: T.str, applicable: T.bool, observable: T.str };
export const LEDGER_OPTIONAL_SPEC = {
  commands: T.arr(T.str), artifact: T.nullable(T.str), cleanup: T.arr(T.str), attempt: T.int(1),
  checkpoint_opened_at: T.iso, category: T.str, agent: T.str, model_family: T.str,
  verdict: T.enumOf([...ROUND_VERDICTS, ...RECEIPT_STATUSES, "OKAY", "BLOCKERS"]), round: T.int(0),
  reuse: T.obj({ receipt: T.str, verdict: T.enumOf(["VALID", "STALE"]), reason: T.str }),
  tier: T.enumOf(TIERS), gate_id: T.str, gate_status: T.enumOf(["open", "resolved"]),
  checkpoint_op: T.enumOf(["open", "complete", "blocked"]), pr: T.nullable(T.int(1)),
  sha: T.hex40, merged_at: T.iso, note: T.str, primary: T.str, secondary: T.str,
  facts: T.arr(T.str), progress: T.obj(PROGRESS_VALUES_SPEC), gap_id: T.gap,
  gap_status: T.enumOf(GAP_STATUSES), kind: T.enumOf(SWITCH_KINDS), premise: T.str,
  new_approach: T.str, rules_total: T.int(0), lane: T.kebab, task: T.str,
  adversarial_classes: T.arr(T.obj(ADVERSARIAL_SPEC)),
  sources: T.int(0), elements: T.int(0), report: T.str, ideal: T.int(0), gaps: T.int(0),
  // §9.4: the ledger's own repeat decision, never a caller's.
  prior_repeat: T.bool,
  count: T.int(0), gates: T.arr(T.str), recommended: T.arr(T.str), parked: T.str,
  ended_at: T.iso,
  duration_s: (v, p, e) => { if (!(typeof v === "number" && v >= 0)) fail(e, p, "expected a number >= 0"); },
};
export const HEAD_REQUIRED = ["build", "verify_lane", "fix", "reuse", "freeze", "pr_open", "round", "verdict", "merge", "post_merge"];
export const TREE_REQUIRED = ["verify_lane", "post_merge"];
