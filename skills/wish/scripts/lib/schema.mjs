// wish v3 — the one machine contract for the CLI, the plan linter and their tests.
//
// Every shape below is stated in prose, with its source, in
// `references/ledger.md`; that file's examples are extracted and validated by
// `validateExamples` and by `test/schema.test.js`. Pure ESM: no I/O, no git,
// no imports — validation and derivation only. Git facts (HEAD, tree,
// patch-id) belong to the callers that read git; this file validates their
// shapes.

export const SCHEMA_VERSION = 2;

const isStr = (v) => typeof v === "string" && v.length > 0;
const isInt = (v, min) => Number.isInteger(v) && v >= min;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX7 = /^[0-9a-f]{7}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const GAP = /^G[1-9][0-9]*$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RULE_ID = /^[a-z][a-z0-9._-]*$/;
const GATE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const COUNT = /^(0|[1-9][0-9]*)$/;
const SESSION = /^senpi:.+$/;
const RUN_ID = /^w-[a-z0-9]+(?:-[a-z0-9]+)*-\d{8}-\d{4}$/;

// --------------------------------------------------------------- value sets

// D §2.3; never lowered after intake.
export const TIERS = Object.freeze(["S", "M", "L"]);

// A §C.1: one stage machine for every kind of work. `mixed` names a primary
// and a secondary type whose receipt and class sets are unioned.
export const WORK_TYPES = Object.freeze(["code", "design", "research", "audit", "mixed"]);
export const PRIMARY_TYPES = Object.freeze(["code", "design", "research", "audit"]);

// The current stage map plus side events; the legacy corpus stages are retired.
export const LEDGER_EVENTS = Object.freeze([
  "intake", "collect", "define", "before", "plan", "plan_lint",
  "plan_review", "decide", "goal", "build", "verify_lane", "triage", "fix", "reuse",
  "freeze", "pr_open", "gate", "round", "verdict", "switch", "progress",
  "merge", "post_merge", "checkpoint", "cleanup", "resume",
]);

// D §2.8: WARN is never blocking. INVALID exists only inside a lane's rows
// (a check that could not decide) and never as a receipt status.
export const RECEIPT_STATUSES = Object.freeze(["PASS", "FAIL", "WARN", "SKIP"]);
export const ROW_VERDICTS = Object.freeze([...RECEIPT_STATUSES, "INVALID"]);

// A §C.4 receipt kinds; `lane` is the D §4 `<stage>-<lane>-<head7>` family.
export const RECEIPT_KINDS = Object.freeze([
  "lane", "before", "after", "vqa-passA", "vqa-passB", "vqa-capture", "claim-gate", "lint",
]);

// D §2.8 column order; A §C.1 extends the `class` set per work type.
export const FINDINGS_COLUMNS = Object.freeze([
  "id", "round", "source", "class", "severity", "file_line", "blocking",
  "repro_cmd", "head_found", "status", "fixed_head",
]);
export const FINDINGS_SOURCES = Object.freeze([
  "code-review", "qa", "sweep", "ultrabrain", "architect", "adversarial",
]);
export const FINDINGS_SEVERITIES = Object.freeze(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export const FINDINGS_STATUSES = Object.freeze([
  "open", "fixed", "not-fixed", "no-command", "note", "owner",
]);

// A §B2/C.4 column order.
export const GAPS_COLUMNS = Object.freeze([
  "id", "area", "surface", "rule", "current", "ideal", "before_artifact",
  "severity", "kind", "class", "type", "unit", "status", "pr", "fixed_head",
]);
export const GAP_KINDS = Object.freeze(["defect", "taste"]);
export const GAP_STATUSES = Object.freeze([
  "open", "planned", "fixed", "accepted-limit", "out-of-scope",
]);

// A §C.6.1/2: a cap is an approach switch, never an exit to the owner.
export const SWITCH_KINDS = Object.freeze([
  "premise", "family", "strategy", "split", "rediscover",
]);
export const ROUND_VERDICTS = Object.freeze(["APPROVED", "REVISE"]);

// §9.4 rule 3: only a round that re-cites a class an earlier round's blocking rows
// already carry is a repeat and owes a switch kind. A round with no blocking row of
// its own answers null, and null keeps the obligation: a missing row never lifts it.
export function switchRepeats(findings, round) {
  const blocking = (findings ?? []).filter((row) => row && row.blocking === "1");
  const own = blocking.filter((row) => Number(row.round) === Number(round));
  if (own.length === 0) return null;
  const earlier = new Set(blocking
    .filter((row) => Number(row.round) < Number(round))
    .map((row) => row.class));
  return own.some((row) => earlier.has(row.class));
}

// A §C.1 verification lanes; `mixed` is the union of its two types.
// `adversarial` is required only for a plan that flags a high-risk row (D §2.3).
export const REQUIRED_RECEIPTS = Object.freeze({
  code: Object.freeze(["tests", "qa", "sweep", "code-review", "adversarial"]),
  design: Object.freeze(["draft-guard", "capture", "vqa-passA", "vqa-passB", "code-review", "qa"]),
  research: Object.freeze(["fact-verify", "claim-gate", "skeptic", "execution-verify", "delivery-gate"]),
  audit: Object.freeze(["lint", "spot", "register-schema"]),
  mixed: Object.freeze([]),
});
export const CONDITIONAL_RECEIPTS = Object.freeze({ adversarial: "high-risk" });

// A §C.1 last row / §B10: the same strings across M3's dictionary and M5's axes.
const CODE_CLASSES = ["S", "C", "D", "O", "T", "W", "SEC", "DOC", "CFG", "PANIC", "REGRESS"];
const VQA_ITEM_IDS = [
  "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12",
  "B1", "B2", "B3", "B4", "B5", "B6", "B7",
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8",
  "D1", "D2", "D3", "D4",
  "E1", "E2", "E3", "E4", "E5", "E6",
  "F1", "F2", "F3", "F4", "F5", "F6", "F7",
  "G1", "G2", "G3", "G4", "G5", "G6", "G7",
  "H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10", "H11",
  "I1", "I2", "I3", "I4", "I5",
  "J1", "J2",
];
const DRAFT_RULES = [
  "edge-stripe", "pseudo-bar", "inset-shadow-stripe", "gradient-stripe", "accent-outline",
  "promo-copy", "emoji-icon", "decorative-badge", "vanity-stat",
];
const RESEARCH_CLASSES = [
  "untraceable_number", "value_mismatch", "quote_not_verbatim", "unbound_sentence",
  "meaning_drift_confirmed", "meaning_drift_warn", "fidelity_unresolved",
  "subject_changed", "scope_widened", "hedge_dropped", "certainty_added",
  "causality_added", "direction_flipped", "population_changed",
  "evidence_grade_raised", "other",
  "claim_unresolved", "claim_refuted",
];
export const FINDINGS_CLASSES = Object.freeze({
  code: Object.freeze(CODE_CLASSES),
  design: Object.freeze([...VQA_ITEM_IDS, ...DRAFT_RULES, "taste"]),
  research: Object.freeze(RESEARCH_CLASSES),
  audit: null, // open set: the audited rule corpus' own ids (`RULE_ID`)
  mixed: null, // union of primary and secondary
});
export { VQA_ITEM_IDS, DRAFT_RULES };

// D §4: 0 ok, 1 check failed, 2 usage, 3 state mismatch.
export const EXIT_CODES = Object.freeze({ OK: 0, CHECK_FAILED: 1, USAGE: 2, STATE_MISMATCH: 3 });

// D §3 + A §F (M1): every verb the one entry point exposes.
export const CLI_VERBS = Object.freeze([
  "init", "status", "ledger", "findings", "gaps", "gate", "freeze", "pr-body",
  "switch", "resume-plan",
]);

// A §B7; `·` (U+00B7) separates the fields, `n/a` is the register-less form.
export const PROGRESS_PATTERN_SOURCE =
  "^PROGRESS: run (\\S+) · units (\\d+)/(\\d+) · gaps (?:n/a|(\\d+)/(\\d+)) · " +
  "prs (\\d+) merged (\\d+) open · wave (\\d+)/(\\d+) · round r(\\d+) on (#\\d+|none) · " +
  "switch (\\d+) · waiting (.+)$";
export const PROGRESS_PATTERN = new RegExp(PROGRESS_PATTERN_SOURCE);

// A §B4: one device per IS/GAP row; the form is fixed by the work type.
export const DEVICE_PATTERN_SOURCES = Object.freeze({
  code: [/^guard [A-Za-z0-9][A-Za-z0-9._-]* -> [A-Za-z0-9][A-Za-z0-9._-]*$/,
         /^qa .+ => .+$/],
  design: [/^vqa .+ @ .+ pair [A-Za-z0-9._-]+-[A-Za-z0-9._-]+-[0-9]+-(?:light|dark)$/],
  research: [/^claim C[1-9][0-9]* gate\(primary, domains>=[2-9][0-9]*, counter-search\)$/],
  audit: [/^lint .+ exit 0$/, /^spot [1-9][0-9]* rows reproduce$/],
});

const STAGE_NAMES = Object.freeze([...LEDGER_EVENTS, "done"]);
export { STAGE_NAMES };

// ------------------------------------------------------------------ helpers

function fail(errors, path, message) {
  errors.push({ path, message });
}

// Each type function pushes its own path-tagged error; object specs are data so
// a shape is one table, not a hand-written if-chain.
const T = {
  str: (v, p, e) => { if (!isStr(v)) fail(e, p, "expected a non-empty string"); },
  kebab: (v, p, e) => { if (!isStr(v) || !KEBAB.test(v)) fail(e, p, "expected lowercase kebab-case"); },
  gap: (v, p, e) => { if (!isStr(v) || !GAP.test(v)) fail(e, p, "expected a gap id G<n>, n >= 1"); },
  hex40: (v, p, e) => { if (!isStr(v) || !HEX40.test(v)) fail(e, p, "expected a full 40-hex commit SHA"); },
  hex64: (v, p, e) => { if (!isStr(v) || !HEX64.test(v)) fail(e, p, "expected a 64-hex sha256"); },
  hex: (v, p, e) => { if (!isStr(v) || !HEX.test(v)) fail(e, p, "expected a 40- or 64-hex id"); },
  iso: (v, p, e) => {
    if (!isStr(v) || !ISO.test(v) || Number.isNaN(Date.parse(v))) fail(e, p, "expected an ISO-8601 UTC timestamp with Z");
  },
  int: (min) => (v, p, e) => { if (!isInt(v, min)) fail(e, p, `expected an integer >= ${min}`); },
  bool: (v, p, e) => { if (typeof v !== "boolean") fail(e, p, "expected true or false"); },
  nullable: (fn) => (v, p, e) => { if (v !== null) fn(v, p, e); },
  opt: (fn) => {
    const wrapped = (v, p, e) => fn(v, p, e);
    wrapped.optional = true;
    return wrapped;
  },
  enumOf: (values) => (v, p, e) => {
    if (!values.includes(v)) fail(e, p, `expected one of ${values.join("|")}`);
  },
  arr: (fn, min = 0) => (v, p, e) => {
    if (!Array.isArray(v)) return fail(e, p, "expected an array");
    if (v.length < min) fail(e, p, `expected at least ${min} item(s)`);
    v.forEach((item, index) => fn(item, `${p}[${index}]`, e));
  },
  obj: (spec) => (v, p, e) => {
    if (!isObj(v)) return fail(e, p, "expected an object");
    Object.entries(spec).forEach(([key, fn]) => {
      if (!(key in v)) {
        if (!fn.optional) fail(e, `${p}.${key}`, "missing");
        return;
      }
      fn(v[key], `${p}.${key}`, e);
    });
  },
};

function rejectUnknown(value, allowed, path, errors) {
  if (!isObj(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(errors, `${path}.${key}`, "unknown field");
  }
}

const RECEIPT_ROW_SPEC = {
  id: T.str,
  command: T.str,
  observable: T.str,
  verdict: T.enumOf(ROW_VERDICTS),
  artifact: T.nullable(T.str),
  class: T.opt(T.str),
  note: T.opt(T.str),
};
const RECEIPT_SPEC = {
  kind: T.enumOf(RECEIPT_KINDS),
  type: T.enumOf(WORK_TYPES),
  unit: T.str,
  program_id: T.nullable(T.str),
  lane: T.kebab,
  head: T.str,
  tree: T.nullable(T.str),
  scope: T.arr(T.str, 1),
  started_at: T.iso,
  ended_at: T.iso,
  status: T.enumOf(RECEIPT_STATUSES),
  rows: T.arr(T.obj(RECEIPT_ROW_SPEC)),
  artifacts: T.arr(T.str),
  cleanup: T.arr(T.str),
};
const RECEIPT_KEYS = [
  ...Object.keys(RECEIPT_SPEC), "stage", "gap", "name", "pass", "note", "primary", "secondary", "env_sha",
];
const RECEIPT_OPTIONAL_SPEC = {
  note: T.opt(T.str),
  gap: T.opt(T.gap),
  name: T.opt(T.kebab),
  pass: T.opt(T.enumOf(["passA", "passB", "capture"])),
  stage: T.opt(T.enumOf(LEDGER_EVENTS)),
  primary: T.opt(T.enumOf(PRIMARY_TYPES)),
  secondary: T.opt(T.enumOf(PRIMARY_TYPES)),
  env_sha: T.opt(T.nullable(T.hex64)),
};

const UNIT_SPEC = { id: T.str, stage: T.enumOf(STAGE_NAMES), pr: T.nullable(T.int(1)), round: T.int(0), switches: T.int(0) };
const PROGRESS_VALUES_SPEC = {
  units_done: T.int(0), units_total: T.int(0),
  gaps_fixed: T.int(0), gaps_total: T.nullable(T.int(0)),
  prs_merged: T.int(0), prs_open: T.int(0),
  wave_k: T.int(1), wave_n: T.int(1), round: T.int(0), switch: T.int(0),
  waiting: T.str,
};
const STATUS_SPEC = {
  run_id: T.str, stage: T.enumOf(STAGE_NAMES), type: T.enumOf(WORK_TYPES), tier: T.enumOf(TIERS),
  head: T.nullable(T.hex), tree: T.nullable(T.hex), round: T.int(0),
  valid_receipts: T.arr(T.str), stale_receipts: T.arr(T.str), blocking: T.arr(T.str),
  next: T.enumOf(STAGE_NAMES), units: T.arr(T.obj(UNIT_SPEC), 1),
  wave: T.obj({ k: T.int(1), n: T.int(1) }),
  progress: T.obj(PROGRESS_VALUES_SPEC),
};
const FRONT_MATTER_SPEC = {
  run_id: T.str, tier: T.enumOf(TIERS), type: T.enumOf(WORK_TYPES),
  unit: T.nullable(T.str), program_id: T.nullable(T.str), worktree: T.str,
  branch: T.str, pr: T.nullable(T.int(1)), frozen_head: T.nullable(T.str), round: T.int(0),
};
const LEDGER_COMMON_SPEC = {
  event: T.enumOf(LEDGER_EVENTS), stage: T.enumOf(LEDGER_EVENTS), type: T.enumOf(WORK_TYPES),
  unit: T.str, program_id: T.nullable(T.str), plan: T.str, session_id: T.str, started_at: T.iso,
};
const LEDGER_EVENT_EXTRAS = {
  intake: { tier: T.enumOf(TIERS), facts: T.arr(T.str, 1) },
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
const LEDGER_KEYS = [...new Set([...Object.keys(LEDGER_COMMON_SPEC), ...LEDGER_OPTIONAL])];
const ADVERSARIAL_SPEC = { name: T.str, applicable: T.bool, observable: T.str };
const LEDGER_OPTIONAL_SPEC = {
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
const HEAD_REQUIRED = ["build", "verify_lane", "fix", "reuse", "freeze", "pr_open", "round", "verdict", "merge", "post_merge"];
const TREE_REQUIRED = ["verify_lane", "post_merge"];

// --------------------------------------------------------------- functions

export function headErrors(type, head) {
  const ok = type === "research" ? HEX64.test(head) : HEX40.test(head);
  return ok ? [] : [{ path: "head", message: type === "research"
    ? "research head is the frozen artifact sha256 (64 lowercase hex)"
    : "head is the full 40-hex commit SHA" }];
}

export function findingsClassesFor(type, { primary, secondary } = {}) {
  if (!WORK_TYPES.includes(type)) return [];
  if (type === "mixed") {
    const classes = [primary, secondary].filter((named) => PRIMARY_TYPES.includes(named));
    return [...new Set(classes.flatMap((named) => FINDINGS_CLASSES[named] ?? []))];
  }
  return FINDINGS_CLASSES[type] ?? [];
}

export function classValid(type, value, options = {}) {
  if (!isStr(value)) return false;
  if (type === "audit") return RULE_ID.test(value);
  if (type === "mixed") {
    const named = [options.primary, options.secondary].filter((entry) => PRIMARY_TYPES.includes(entry));
    return named.some((entry) => classValid(entry, value));
  }
  return findingsClassesFor(type).includes(value);
}

export function blockingStatus(status) {
  return status === "FAIL";
}

export function requiredReceiptsFor(type, { primary, secondary, highRisk = false } = {}) {
  const pick = (named) => (REQUIRED_RECEIPTS[named] ?? [])
    .filter((lane) => CONDITIONAL_RECEIPTS[lane] !== "high-risk" || highRisk);
  if (type === "mixed") return [...new Set([...pick(primary), ...pick(secondary)])];
  return [...pick(type)];
}

export function validateReceipt(value) {
  const errors = [];
  T.obj(RECEIPT_SPEC)(value, "receipt", errors);
  if (!isObj(value)) return { ok: false, errors };
  rejectUnknown(value, RECEIPT_KEYS, "receipt", errors);
  Object.entries(RECEIPT_OPTIONAL_SPEC).forEach(([key, fn]) => {
    if (key in value && value[key] !== undefined) fn(value[key], `receipt.${key}`, errors);
  });
  if (isStr(value.head)) errors.push(...headErrors(value.type === "mixed" ? value.primary : value.type, value.head));
  if (value.tree !== null && isStr(value.tree) && !HEX.test(value.tree)) {
    fail(errors, "receipt.tree", "expected null or a 40/64-hex git tree id");
  }
  if ((value.type === "mixed" ? value.primary : value.type) === "research" && value.tree !== null) {
    fail(errors, "receipt.tree", "research has no git tree; use null and the artifact sha256 in head");
  }
  if (isStr(value.started_at) && isStr(value.ended_at) && ISO.test(value.started_at) && ISO.test(value.ended_at)
      && Date.parse(value.ended_at) < Date.parse(value.started_at)) {
    fail(errors, "receipt.ended_at", "must not precede started_at");
  }
  if (value.type === "mixed" && !(PRIMARY_TYPES.includes(value.primary) && PRIMARY_TYPES.includes(value.secondary))) {
    fail(errors, "receipt.primary", "a mixed receipt names a primary and a secondary type");
  }
  if (value.kind === "lane" && !LEDGER_EVENTS.includes(value.stage)) {
    fail(errors, "receipt.stage", "a lane receipt names a ledger event as its stage");
  }
  if ((value.kind === "before" || value.kind === "after") && !GAP.test(value.gap ?? "")) {
    fail(errors, "receipt.gap", "a before/after receipt names the gap it pairs");
  }
  if (value.kind === "lint" && !(isStr(value.name) && KEBAB.test(value.name))) {
    fail(errors, "receipt.name", "a lint receipt names the lint in kebab-case");
  }
  if (String(value.kind).startsWith("vqa-")) {
    const expected = String(value.kind).slice(4);
    if (value.pass !== expected) fail(errors, "receipt.pass", `kind ${value.kind} requires pass ${expected}`);
  } else if (value.pass !== undefined) {
    fail(errors, "receipt.pass", "only a vqa receipt names a pass");
  }
  if (Array.isArray(value.rows)) {
    value.rows.forEach((row, index) => {
      if (isObj(row) && row.class !== undefined && !classValid(value.type, row.class, value)) {
        fail(errors, `receipt.rows[${index}].class`, `not a ${value.type} class`);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

const RECEIPT_NAME_PATTERNS = [
  { kind: "before", re: /^before-(G[1-9][0-9]*)-([0-9a-f]{7})\.(json|md|png|jpg|jpeg|webp|txt)$/ },
  { kind: "after", re: /^after-(G[1-9][0-9]*)-([0-9a-f]{7})\.(json|md|png|jpg|jpeg|webp|txt)$/ },
  { kind: "vqa", re: /^vqa-(passA|passB|capture)-([0-9a-f]{7})\.(json|md|png|jpg|jpeg|webp)$/ },
  { kind: "claim-gate", re: /^claim-gate-([0-9a-f]{7})\.json$/ },
  { kind: "lint", re: /^lint-([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9a-f]{7})\.json$/ },
];

export function parseReceiptFilename(name) {
  const errors = [];
  if (!isStr(name)) return { ok: false, errors: [{ path: "filename", message: "missing" }] };
  for (const { kind, re } of RECEIPT_NAME_PATTERNS) {
    const match = re.exec(name);
    if (!match) continue;
    if (kind === "vqa") return { ok: true, kind: `vqa-${match[1]}`, pass: match[1], head7: match[2], errors };
    if (kind === "lint") return { ok: true, kind, name: match[1], tree7: match[2], errors };
    if (kind === "claim-gate") return { ok: true, kind, sha7: match[1], errors };
    return { ok: true, kind, gap: match[1], tree7: match[2], errors };
  }
  const lane = /^([a-z][a-z0-9_]*)-([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9a-f]{7})\.(json|md)$/.exec(name);
  if (lane && LEDGER_EVENTS.includes(lane[1])) {
    return { ok: true, kind: "lane", stage: lane[1], lane: lane[2], head7: lane[3], errors };
  }
  fail(errors, "filename", "expected <stage>-<lane>-<head7>.json|md or a typed before/after/vqa/claim-gate/lint name");
  return { ok: false, errors };
}

export function validateReceiptAgainstFilename(receipt, name) {
  const parsed = parseReceiptFilename(name);
  const errors = [...parsed.errors];
  if (!parsed.ok || !isObj(receipt)) return { ok: false, errors };
  if (receipt.kind !== parsed.kind) fail(errors, "receipt.kind", `filename says ${parsed.kind}`);
  const anchor = receipt.head;
  if (parsed.head7 && !(isStr(anchor) && anchor.startsWith(parsed.head7))) {
    fail(errors, "receipt.head", `filename head7 ${parsed.head7} does not prefix the receipt head`);
  }
  if (parsed.sha7 && !(isStr(anchor) && anchor.startsWith(parsed.sha7))) {
    fail(errors, "receipt.head", `filename sha7 ${parsed.sha7} does not prefix the receipt head`);
  }
  if (parsed.pass && receipt.pass !== parsed.pass) fail(errors, "receipt.pass", `filename says ${parsed.pass}`);
  if (parsed.tree7 && !(isStr(receipt.tree) && receipt.tree.startsWith(parsed.tree7))) {
    fail(errors, "receipt.tree", `filename tree7 ${parsed.tree7} does not prefix the receipt tree`);
  }
  if (parsed.gap && receipt.gap !== parsed.gap) fail(errors, "receipt.gap", `filename says ${parsed.gap}`);
  if (parsed.stage && receipt.stage !== parsed.stage) fail(errors, "receipt.stage", `filename says ${parsed.stage}`);
  if (parsed.lane && receipt.lane !== parsed.lane) fail(errors, "receipt.lane", `filename says ${parsed.lane}`);
  if (parsed.kind === "lint" && receipt.name !== parsed.name) fail(errors, "receipt.name", `filename says ${parsed.name}`);
  return { ok: errors.length === 0, errors };
}

export function validateLedgerEvent(value) {
  const errors = [];
  T.obj(LEDGER_COMMON_SPEC)(value, "event", errors);
  if (!isObj(value)) return { ok: false, errors };
  rejectUnknown(value, LEDGER_KEYS, "event", errors);
  Object.entries(LEDGER_OPTIONAL_SPEC).forEach(([key, fn]) => {
    if (key in value && value[key] !== undefined) fn(value[key], `event.${key}`, errors);
  });
  if (!SESSION.test(String(value.session_id ?? ""))) fail(errors, "event.session_id", "expected senpi:<id>");
  if (value.stage !== undefined && value.stage !== value.event) {
    fail(errors, "event.stage", "equals event; the alias may not drift");
  }
  if (value.type === "mixed" && !(PRIMARY_TYPES.includes(value.primary) && PRIMARY_TYPES.includes(value.secondary))) {
    fail(errors, "event.primary", "a mixed event names a primary and a secondary type");
  }
  const extras = LEDGER_EVENT_EXTRAS[value.event] ?? {};
  Object.entries(extras).forEach(([key, fn]) => {
    if (!(key in value)) {
      if (!fn.optional) fail(errors, `event.${key}`, "missing");
      return;
    }
    fn(value[key], `event.${key}`, errors);
  });
  if (value.head !== undefined && value.head !== null && isStr(value.head)) {
    const identity = value.type === "mixed" ? value.primary : value.type;
    errors.push(...headErrors(identity, value.head).map((entry) => ({ ...entry, path: "event.head" })));
  }
  if (HEAD_REQUIRED.includes(value.event) && !isStr(value.head)) {
    fail(errors, "event.head", `${value.event} reports on a commit or artifact state`);
  }
  if (value.event === "freeze") {
    const wantsTree = (value.type === "mixed" ? value.primary : value.type) !== "research";
    if (wantsTree ? !isStr(value.tree) : value.tree !== null) {
      fail(errors, "event.tree", "freeze binds the git tree, or null for a research artifact");
    }
  }
  if (value.tree !== undefined && value.tree !== null && isStr(value.tree) && !HEX.test(value.tree)) {
    fail(errors, "event.tree", "expected null or a 40/64-hex git tree id");
  }
  if (TREE_REQUIRED.includes(value.event)) {
    if (value.tree === undefined) fail(errors, "event.tree", `${value.event} is bound to a tree`);
    else if (value.type !== "research" && value.tree === null) {
      fail(errors, "event.tree", `${value.event} is bound to the git tree`);
    }
  }
  if (JSON.stringify(value).includes('"[~]"') || value.terminal === true) {
    fail(errors, "event.terminal", value.event === "round"
      ? "a round has no terminal state: a cap triggers a switch, and review runs until APPROVED"
      : "no event carries a terminal marker; review ends at APPROVED");
  }
  return { ok: errors.length === 0, errors };
}

export function validateLedgerSequence(events) {
  const errors = [];
  if (!Array.isArray(events)) return { ok: false, errors: [{ path: "events", message: "expected an array" }] };
  if (!Array.isArray(events)) return { ok: false, errors: [{ path: "events", message: "expected an array" }] };
  events.forEach((event, index) => {
    if (!isObj(event)) return fail(errors, `events[${index}]`, "expected an object");
    const checked = validateLedgerEvent(event);
    checked.errors.forEach((entry) => fail(errors, `events[${index}]${entry.path.replace(/^event/, "")}`, entry.message));
  });
  const valid = events.filter(isObj);
  const roundsOf = (unit) => valid
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.unit === unit && event.event === "round");
  const units = [...new Set(valid.map((event) => event.unit))];
  for (const unit of units) {
    const rounds = roundsOf(unit);
    rounds.forEach(({ event }, index) => {
      if (event.round !== index + 1) fail(errors, `unit ${unit}`, `round ${event.round} out of order; expected ${index + 1}`);
    });
    rounds.forEach(({ event, index }) => {
      const after = valid.slice(index + 1);
      if (event.verdict === "APPROVED" && after.some((next) => next.unit === unit && next.event === "round")) {
        fail(errors, `unit ${unit} round ${event.round}`, "review runs until APPROVED; no round may follow it");
      }
      if (event.verdict === "REVISE" && event.round >= 3) {
        const nextRound = after.findIndex((next) => next.unit === unit && next.event === "round");
        const window = nextRound === -1 ? after : after.slice(0, nextRound);
        const switched = window.some((next) => next.unit === unit && next.event === "switch" && next.round === event.round);
        // §9.4 rule 3: the repeat decision is stamped on the round that follows, so a
        // replay never re-reads a findings table for a window that is already closed,
        // and an absent or true stamp keeps today's demand.
        const decided = nextRound === -1 ? undefined : after[nextRound].prior_repeat;
        if (!switched && decided !== false) fail(errors, `unit ${unit} round ${event.round}`, "a third REVISE requires an approach switch before review continues");
      }
    });
    const kinds = [];
    for (const item of valid.filter((other) => other.unit === unit && other.event === "switch")) {
      const target = rounds.find(({ event }) => event.round === item.round);
      if (!target || target.event.verdict !== "REVISE" || target.index > valid.indexOf(item)) {
        fail(errors, `unit ${unit} round ${item.round}`, "a switch follows a REVISE round");
      }
      if (item.kind === "split" && !isStr(item.program_id)) {
        fail(errors, `unit ${unit} round ${item.round}`, "split is program-mode only");
      }
      const applicable = SWITCH_KINDS.filter((kind) => kind !== "split" || isStr(item.program_id));
      const allUsed = applicable.every((kind) => kinds.includes(kind));
      if (kinds.includes(item.kind) && !allUsed) {
        fail(errors, `unit ${unit} round ${item.round}`, `switch kind ${item.kind} repeats before every applicable kind is used`);
      }
      kinds.push(item.kind);
    }
  }
  return { ok: errors.length === 0, errors };
}

function parseTsv(text, columns, rowCheck) {
  const errors = [];
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  if (lines[0] !== columns.join("\t")) {
    return { ok: false, rows: [], errors: [{ path: "tsv.header", message: `expected ${columns.join("\t")}` }] };
  }
  const rows = [];
  lines.slice(1).forEach((line, index) => {
    const cells = line.split("\t");
    const path = `row[${index + 1}]`;
    if (cells.length !== columns.length) {
      fail(errors, path, `expected ${columns.length} columns, got ${cells.length}`);
      return;
    }
    const row = Object.fromEntries(columns.map((column, i) => [column, cells[i]]));
    rowCheck(row, path, errors);
    rows.push(row);
  });
  if (rows.length === 0) fail(errors, "tsv", "at least one row is required");
  return { ok: errors.length === 0, rows, errors };
}

const HEX_OR_DASH = (v) => v === "-" || HEX.test(v);
const GAP_ID_LIKE = (value) => /^L[1-9][0-9]*$/.test(value) || /^skill:[a-z0-9-]+:[A-Za-z0-9._-]+$/.test(value);
const INT_OR_DASH = (v, min) => v === "-" || (/^[0-9]+$/.test(v) && Number(v) >= min);

export function parseFindingsTsv(text, { type, primary, secondary } = {}) {
  return parseTsv(text, FINDINGS_COLUMNS, (row, path, errors) => {
    if (!ID.test(row.id)) fail(errors, `${path}.id`, "expected [A-Za-z0-9][A-Za-z0-9._-]*");
    if (!COUNT.test(row.round)) fail(errors, `${path}.round`, "expected an integer >= 0");
    if (!FINDINGS_SOURCES.includes(row.source)) fail(errors, `${path}.source`, "unknown source");
    if (type !== undefined && !classValid(type, row.class, { primary, secondary })) fail(errors, `${path}.class`, `not a ${type} class`);
    if (!FINDINGS_SEVERITIES.includes(row.severity)) fail(errors, `${path}.severity`, "unknown severity");
    if (row.file_line !== "-" && !/^.+:[0-9]+$/.test(row.file_line)) fail(errors, `${path}.file_line`, "expected path:line or -");
    if (row.blocking !== "0" && row.blocking !== "1") fail(errors, `${path}.blocking`, "expected 0 or 1");
    if (!isStr(row.repro_cmd)) fail(errors, `${path}.repro_cmd`, "expected a one-line command or no command");
    if (row.head_found !== "no head" && !HEX.test(row.head_found)) fail(errors, `${path}.head_found`, "expected a head SHA or no head");
    if (!FINDINGS_STATUSES.includes(row.status)) fail(errors, `${path}.status`, "unknown status");
    if ((row.status === "note" || row.status === "owner") && row.blocking !== "0") {
      fail(errors, `${path}.blocking`, "a note or owner row never blocks");
    }
    if (row.status === "fixed" ? !HEX.test(row.fixed_head) : !HEX_OR_DASH(row.fixed_head)) {
      fail(errors, `${path}.fixed_head`, "a fixed row names its fix head; every other row writes -");
    }
  });
}

export function parseGapsTsv(text) {
  const seen = new Set();
  const parsed = parseTsv(text, GAPS_COLUMNS, (row, path, errors) => {
    if (!GAP.test(row.id)) fail(errors, `${path}.id`, "expected G<n>");
    if (seen.has(row.id)) fail(errors, `${path}.id`, "duplicate gap id");
    seen.add(row.id);
    for (const column of ["area", "surface", "current", "ideal"]) {
      if (!isStr(row[column])) fail(errors, `${path}.${column}`, "expected a non-empty value");
    }
    if (!(GAP_ID_LIKE(row.rule))) fail(errors, `${path}.rule`, "expected L<n> or skill:<skill>:<code>");
    if (!FINDINGS_SEVERITIES.includes(row.severity)) fail(errors, `${path}.severity`, "unknown severity");
    if (!GAP_KINDS.includes(row.kind)) fail(errors, `${path}.kind`, "expected defect or taste");
    if (!PRIMARY_TYPES.includes(row.type) || !classValid(row.type, row.class)) {
      fail(errors, `${path}.class`, `not a ${row.type} class`);
    }
    if (!isStr(row.unit)) fail(errors, `${path}.unit`, "expected the owning unit");
    if (!GAP_STATUSES.includes(row.status)) fail(errors, `${path}.status`, "unknown status");
    if (!INT_OR_DASH(row.pr, 1)) fail(errors, `${path}.pr`, "expected a PR number or -");
    if (!HEX_OR_DASH(row.fixed_head)) fail(errors, `${path}.fixed_head`, "expected a fix head or -");
    if (row.kind === "defect" && row.status !== "open" && row.before_artifact === "-") {
      fail(errors, `${path}.before_artifact`, "an edited defect row carries its pre-edit capture");
    }
    if (row.status === "fixed" && (row.fixed_head === "-" || row.before_artifact === "-")) {
      fail(errors, `${path}.status`, "fixed requires a before capture and a fix head");
    }
  });
  return parsed;
}

export function validateGapReceipts(rows, filenames) {
  const errors = [];
  const parsed = filenames.map((name) => ({ name, ...parseReceiptFilename(name) }));
  parsed.filter((entry) => !entry.ok).forEach((entry) => errors.push(...entry.errors));
  const before = parsed.filter((entry) => entry.ok && entry.kind === "before").map((entry) => entry.gap);
  const after = parsed.filter((entry) => entry.ok && entry.kind === "after").map((entry) => entry.gap);
  const known = new Set(rows.map((row) => row.id));
  for (const gap of [...before, ...after]) {
    if (!known.has(gap)) fail(errors, `receipt:${gap}`, "a before/after receipt names no gap row");
  }
  for (const row of rows) {
    if (row.kind !== "defect") continue;
    if (!before.includes(row.id)) fail(errors, `gap:${row.id}`, "a defect row needs its before receipt");
    if (row.status === "fixed" && !after.includes(row.id)) fail(errors, `gap:${row.id}`, "a fixed row needs its after receipt");
  }
  return { ok: errors.length === 0, errors };
}

export function parseLensRows(text) {
  const errors = [];
  const rows = [];
  const seen = new Set();
  String(text ?? "").replace(/\r\n?/g, "\n").split("\n").filter((line) => line.trim() !== "").forEach((line, index) => {
    const path = `lens[${index}]`;
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length !== 6) return fail(errors, path, "expected 6 fields: id | rule | source | scope | persona | surface");
    const [id, rule, source, scope, persona, surface] = cells;
    if (!/^L[1-9][0-9]*$/.test(id)) fail(errors, `${path}.id`, "expected L<n>");
    if (seen.has(id)) fail(errors, `${path}.id`, "duplicate lens id");
    seen.add(id);
    [rule, source, persona, surface].forEach((value, i) => {
      if (!isStr(value)) fail(errors, `${path}.field${i}`, "expected a non-empty value");
    });
    if (!["universal", "platform"].includes(scope)) fail(errors, `${path}.scope`, "expected universal or platform");
    rows.push({ id, rule, source, scope, persona, surface });
  });
  if (rows.length === 0) fail(errors, "lens", "at least one row is required");
  return { ok: errors.length === 0, rows, errors };
}

export function validateStatusJson(value) {
  const errors = [];
  T.obj(STATUS_SPEC)(value, "status", errors);
  rejectUnknown(value, Object.keys(STATUS_SPEC), "status", errors);
  if (isObj(value) && isStr(value.run_id) && !RUN_ID.test(value.run_id)) {
    fail(errors, "status.run_id", "expected w-<slug>-<yyyymmdd>-<hhmm>");
  }
  if (isObj(value) && isObj(value.progress)) {
    const p = value.progress;
    if (p.units_done > p.units_total) fail(errors, "status.progress.units_done", "exceeds units_total");
    if (p.gaps_total !== null && p.gaps_fixed > p.gaps_total) fail(errors, "status.progress.gaps_fixed", "exceeds gaps_total");
  }
  return { ok: errors.length === 0, errors };
}

export function validatePlanFrontMatter(value) {
  const errors = [];
  if (!isObj(value) || !isObj(value.wish)) {
    return { ok: false, errors: [{ path: "frontmatter.wish", message: "expected a wish: object" }] };
  }
  T.obj(FRONT_MATTER_SPEC)(value.wish, "frontmatter.wish", errors);
  rejectUnknown(value.wish, Object.keys(FRONT_MATTER_SPEC), "frontmatter.wish", errors);
  if (!errors.length) {
    if (!RUN_ID.test(value.wish.run_id)) fail(errors, "frontmatter.wish.run_id", "expected w-<slug>-<yyyymmdd>-<hhmm>");
    if (!/^(\/|[A-Za-z]:[\\/])/.test(value.wish.worktree)) fail(errors, "frontmatter.wish.worktree", "expected an absolute path");
    if (value.wish.frozen_head !== null && !(HEX40.test(value.wish.frozen_head) || HEX64.test(value.wish.frozen_head))) {
      fail(errors, "frontmatter.wish.frozen_head", "expected null, a 40-hex commit or a 64-hex artifact sha256");
    }
    if (value.wish.type === "mixed" && value.wish.unit === null) {
      fail(errors, "frontmatter.wish.unit", "a mixed plan names its unit");
    }
  }
  return { ok: errors.length === 0, errors };
}

export function parseProgressLine(line) {
  const match = PROGRESS_PATTERN.exec(String(line ?? ""));
  if (!match) return { ok: false, errors: [{ path: "progress", message: "does not match PROGRESS_PATTERN_SOURCE" }] };
  const [run_id, units_done, units_total] = [match[1], match[2], match[3]];
  const gaps = match[4] === undefined ? null : { fixed: Number(match[4]), total: Number(match[5]) };
  const value = {
    run_id,
    units_done: Number(units_done),
    units_total: Number(units_total),
    gaps_fixed: gaps ? gaps.fixed : null,
    gaps_total: gaps ? gaps.total : null,
    prs_merged: Number(match[6]),
    prs_open: Number(match[7]),
    wave_k: Number(match[8]),
    wave_n: Number(match[9]),
    round: Number(match[10]),
    pr: match[11] === "none" ? null : match[11],
    switch: Number(match[12]),
    waiting: match[13],
  };
  const errors = [];
  if (value.units_done > value.units_total) errors.push({ path: "units_done", message: "exceeds units_total" });
  if (gaps && gaps.fixed > gaps.total) errors.push({ path: "gaps_fixed", message: "exceeds gaps_total" });
  if (value.wave_k < 1 || value.wave_k > value.wave_n) errors.push({ path: "wave_k", message: "expected 1 <= k <= n" });
  return { ok: errors.length === 0, value, errors };
}

export function formatProgressLine(value) {
  const gaps = value.gaps_total === null || value.gaps_total === undefined
    ? "n/a"
    : `${value.gaps_fixed}/${value.gaps_total}`;
  return `PROGRESS: run ${value.run_id} · units ${value.units_done}/${value.units_total} · gaps ${gaps} · ` +
    `prs ${value.prs_merged} merged ${value.prs_open} open · wave ${value.wave_k}/${value.wave_n} · ` +
    `round r${value.round} on ${value.pr ?? "none"} · switch ${value.switch} · waiting ${value.waiting}`;
}

export function parseGatesMarkdown(text) {
  const errors = [];
  const raw = String(text ?? "").replace(/\r/g, "").trim();
  const prefix = "# Gates\n\n## ";
  if (raw === "") return { ok: true, gates: [], errors };
  if (!raw.startsWith(prefix)) return { ok: false, gates: [], errors: [{ path: "gates", message: "expected a # Gates heading" }] };
  const gates = [];
  const ids = new Set();
  raw.slice(prefix.length).split("\n\n## ").forEach((block, index) => {
    const lines = block.split("\n").filter((line) => line !== "");
    const id = lines.shift() ?? "";
    const fields = new Map();
    for (const line of lines) {
      const match = /^- ([^:]+): (.*)$/.exec(line);
      if (!match) return fail(errors, `gate[${index}]`, "malformed field line");
      fields.set(match[1], match[2]);
    }
    if (!id) fail(errors, `gate[${index}]`, "missing id");
    else if (!GATE_ID.test(id)) fail(errors, `gate[${index}]`, "id must match [A-Za-z0-9][A-Za-z0-9_-]*");
    if (ids.has(id)) fail(errors, `gate[${index}]`, `duplicate id ${id}`);
    ids.add(id);
    for (const key of fields.keys()) {
      if (!["Status", "Question", "Options", "Default", "Answer"].includes(key)) {
        fail(errors, `gate[${index}]`, `unknown field ${key}`);
      }
    }
    const status = fields.get("Status");
    const question = fields.get("Question");
    const options = fields.get("Options");
    const fallback = fields.get("Default");
    if (question === undefined || options === undefined || fallback === undefined) {
      return fail(errors, `gate[${index}]`, "Question, Options and Default are required");
    }
    const choices = options.split(" | ");
    if (choices.length < 2) fail(errors, `gate[${index}].options`, "at least two choices");
    if (!choices.includes(fallback)) fail(errors, `gate[${index}].default`, "must be one of the options");
    if (status === "open") {
      if (fields.has("Answer")) fail(errors, `gate[${index}]`, "an open gate has no answer");
      gates.push({ id, status, question, options, default: fallback });
    } else if (status === "resolved" && fields.has("Answer")) {
      gates.push({ id, status, question, options, default: fallback, answer: fields.get("Answer") });
    } else {
      fail(errors, `gate[${index}].status`, "expected open, or resolved with an answer");
    }
  });
  return { ok: errors.length === 0, gates, errors };
}

export function validateDeviceRow(type, value) {
  const errors = [];
  if (!PRIMARY_TYPES.includes(type)) return { ok: false, errors: [{ path: "device.type", message: "expected a concrete work type" }] };
  if (!isStr(value)) return { ok: false, errors: [{ path: "device", message: "expected a non-empty DEVICE row" }] };
  const body = value.startsWith("DEVICE: ") ? value.slice(8) : value;
  const form = DEVICE_PATTERN_SOURCES[type].find((pattern) => pattern.test(body));
  if (!form) fail(errors, "device", `does not match the ${type} device grammar in A §B4`);
  return { ok: errors.length === 0, form: form ? form.source : null, errors };
}

// The contract is only real if its own examples are validated: every fenced
// example in references/ledger.md is `wish:<tag>` and dispatched here.
export function extractExamples(markdown) {
  const examples = [];
  let current = null;
  String(markdown).replace(/\r\n?/g, "\n").split("\n").forEach((line) => {
    if (current) {
      if (line.trim() === "```") { examples.push(current); current = null; return; }
      current.body.push(line);
      return;
    }
    const match = /^```[A-Za-z0-9-]+\s+(wish:[A-Za-z0-9:._-]+)\s*$/.exec(line);
    if (match) current = { tag: match[1], body: [] };
  });
  if (current) examples.push({ ...current, unterminated: true });
  return examples.map((example) => ({ ...example, text: example.body.join("\n") }));
}

export function validateExamples(markdown) {
  const results = extractExamples(markdown).map((example) => {
    if (example.unterminated) return { tag: example.tag, ok: false, errors: [{ path: "fence", message: "unterminated" }] };
    try {
      return { tag: example.tag, ...dispatchExample(example.tag, example.text) };
    } catch (error) {
      return { tag: example.tag, ok: false, errors: [{ path: example.tag, message: String(error?.message ?? error) }] };
    }
  });
  return { ok: results.length > 0 && results.every((entry) => entry.ok), examples: results };
}

function dispatchExample(tag, text) {
  if (tag === "wish:receipt") return validateReceipt(JSON.parse(text));
  if (tag === "wish:findings-tsv") return parseFindingsTsv(text, { type: "code" });
  if (tag === "wish:gaps-tsv") return parseGapsTsv(text);
  if (tag === "wish:lens") return parseLensRows(text);
  if (tag === "wish:ledger") {
    const events = text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
    return validateLedgerSequence(events);
  }
  if (tag === "wish:status-json") return validateStatusJson(JSON.parse(text));
  if (tag === "wish:plan-frontmatter") return validatePlanFrontMatter(JSON.parse(text));
  if (tag === "wish:progress") return parseProgressLine(text.trim());
  if (tag === "wish:gates") return parseGatesMarkdown(text);
  if (tag === "wish:receipt-name") {
    const errors = text.split("\n").filter((line) => line.trim() !== "")
      .flatMap((line) => parseReceiptFilename(line.trim()).errors);
    return { ok: errors.length === 0, errors };
  }
  const device = /^wish:device-(code|design|research|audit)$/.exec(tag);
  if (device) return validateDeviceRow(device[1], text.trim());
  return { ok: false, errors: [{ path: tag, message: "no validator is wired to this example tag" }] };
}
