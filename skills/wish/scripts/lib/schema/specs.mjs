import { TIERS, WORK_TYPES, PRIMARY_TYPES, LEDGER_EVENTS, RECEIPT_STATUSES, ROW_VERDICTS, RECEIPT_KINDS, GAP_STATUSES, SWITCH_KINDS, ROUND_VERDICTS, STAGE_NAMES } from "./constants.mjs";
import { T, isStr, fail, RUN_ID } from "./primitives.mjs";
const RECEIPT_ROW_SPEC = {
  id: T.str,
  command: T.str,
  observable: T.str,
  verdict: T.enumOf(ROW_VERDICTS),
  artifact: T.nullable(T.str),
  class: T.opt(T.str),
  note: T.opt(T.str),
};
export const RECEIPT_SPEC = {
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
export const RECEIPT_KEYS = [
  ...Object.keys(RECEIPT_SPEC), "stage", "gap", "name", "pass", "note", "primary", "secondary", "env_sha",
];
export const RECEIPT_OPTIONAL_SPEC = {
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
export const PROGRESS_VALUES_SPEC = {
  units_done: T.int(0), units_total: T.int(0),
  gaps_fixed: T.int(0), gaps_total: T.nullable(T.int(0)),
  prs_merged: T.int(0), prs_open: T.int(0),
  wave_k: T.int(1), wave_n: T.int(1), round: T.int(0), switch: T.int(0),
  waiting: T.str,
};
export const STATUS_SPEC = {
  run_id: T.str, stage: T.enumOf(STAGE_NAMES), type: T.enumOf(WORK_TYPES), tier: T.enumOf(TIERS),
  head: T.nullable(T.hex), tree: T.nullable(T.hex), round: T.int(0),
  valid_receipts: T.arr(T.str), stale_receipts: T.arr(T.str), blocking: T.arr(T.str),
  next: T.enumOf(STAGE_NAMES), units: T.arr(T.obj(UNIT_SPEC), 1),
  wave: T.obj({ k: T.int(1), n: T.int(1) }),
  progress: T.obj(PROGRESS_VALUES_SPEC),
};
export const FRONT_MATTER_SPEC = {
  run_id: T.str, tier: T.enumOf(TIERS), type: T.enumOf(WORK_TYPES),
  unit: T.nullable(T.str), program_id: T.nullable(T.str), worktree: T.str,
  branch: T.str, pr: T.nullable(T.int(1)), frozen_head: T.nullable(T.str), round: T.int(0),
};
export const LEDGER_COMMON_SPEC = {
  event: T.enumOf(LEDGER_EVENTS), stage: T.enumOf(LEDGER_EVENTS), type: T.enumOf(WORK_TYPES),
  unit: T.str, program_id: T.nullable(T.str), plan: T.str, session_id: T.str, started_at: T.iso,
};
