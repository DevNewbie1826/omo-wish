export const SCHEMA_VERSION = 2;

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

// A §C.1 last row / §B10: the same strings across the defect-class dictionary and the review axes.
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
