import { T, isObj, isStr, fail, rejectUnknown, HEX, ISO, GAP, KEBAB } from "./primitives.mjs";
import { PRIMARY_TYPES, LEDGER_EVENTS } from "./constants.mjs";
import { RECEIPT_SPEC, RECEIPT_KEYS, RECEIPT_OPTIONAL_SPEC } from "./specs.mjs";
import { headErrors, classValid } from "./core.mjs";
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
  const identity = receipt.type === "mixed" ? receipt.primary : receipt.type;
  const headAnchored = (parsed.kind === "before" || parsed.kind === "after" || parsed.kind === "lint") && identity === "research";
  if (parsed.tree7) {
    const anchor = headAnchored ? receipt.head : receipt.tree;
    const label = headAnchored ? "head7" : "tree7";
    if (!(isStr(anchor) && anchor.startsWith(parsed.tree7))) {
      fail(errors, headAnchored ? "receipt.head" : "receipt.tree",
        `filename ${label} ${parsed.tree7} does not prefix the receipt ${headAnchored ? "head" : "tree"}`);
    }
  }
  if (parsed.gap && receipt.gap !== parsed.gap) fail(errors, "receipt.gap", `filename says ${parsed.gap}`);
  if (parsed.stage && receipt.stage !== parsed.stage) fail(errors, "receipt.stage", `filename says ${parsed.stage}`);
  if (parsed.lane && receipt.lane !== parsed.lane) fail(errors, "receipt.lane", `filename says ${parsed.lane}`);
  if (parsed.kind === "lint" && receipt.name !== parsed.name) fail(errors, "receipt.name", `filename says ${parsed.name}`);
  return { ok: errors.length === 0, errors };
}
