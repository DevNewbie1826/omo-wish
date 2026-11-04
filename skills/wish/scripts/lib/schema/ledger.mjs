import { T, isObj, isStr, fail, rejectUnknown, SESSION, HEX } from "./primitives.mjs";
import { PRIMARY_TYPES, SWITCH_KINDS } from "./constants.mjs";
import { LEDGER_COMMON_SPEC } from "./specs.mjs";
import { LEDGER_EVENT_EXTRAS, LEDGER_KEYS, LEDGER_OPTIONAL_SPEC, HEAD_REQUIRED, TREE_REQUIRED } from "./ledger-specs.mjs";
import { headErrors } from "./core.mjs";
export function validateLedgerEvent(value) {
  const errors = [];
  T.obj(LEDGER_COMMON_SPEC)(value, "event", errors);
  if (!isObj(value)) return { ok: false, errors };
  const extras = LEDGER_EVENT_EXTRAS[value.event] ?? {};
  // The intake-only identity keys reach the allowed set through this event's own
  // extras: they are not global ledger keys, so every other event still rejects
  // them as unknown fields.
  rejectUnknown(value, [...LEDGER_KEYS, ...Object.keys(extras)], "event", errors);
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
