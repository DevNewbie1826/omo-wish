import { requiredReceiptsFor, switchRepeats, validateLedgerEvent, validateLedgerSequence } from "../schema.mjs";
import { closeSync, existsSync, fstatSync, ftruncateSync, openSync, writeSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { usage, checkFailed, stateMismatch, nowIso, ensureDir, readTextOrNull, rootPaths } from "./core.mjs";
import { readPlan } from "./plan.mjs";
import { readFindings } from "./tables.mjs";
import { listReceipts } from "./gates-receipts.mjs";
import { lastRoundOf, requireCodeReview } from "./stages.mjs";

// --------------------------------------------------------------------- ledger

// Only an unterminated final segment can be an interrupted append.
function ledgerTail(text) {
  if (text === "" || text.endsWith("\n")) return { kind: "terminated" };
  const start = text.lastIndexOf("\n") + 1;
  try {
    const value = JSON.parse(text.slice(start));
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return { kind: "complete" };
    }
  } catch {
    // An unparsable final segment is an uncommitted write.
  }
  return { kind: "torn", size: Buffer.byteLength(text.slice(0, start)) };
}

// §9: terminated malformed lines are state errors; a torn final write is ignored.
export function readLedger(root) {
  const paths = rootPaths(root);
  const text = readTextOrNull(paths.ledger);
  if (text === null) return [];
  const lines = text.split("\n");
  if (ledgerTail(text).kind === "torn") lines.pop();
  const events = [];
  lines.forEach((line, index) => {
    const raw = line.trim();
    if (raw === "") return;
    try {
      const value = JSON.parse(raw);
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
      events.push(value);
    } catch {
      // JSON.parse quotes the input in its message, and a ledger line may hold a token:
      // report where it broke, never the bytes.
      throw stateMismatch(`${paths.ledger}:${index + 1} is not a JSON event`);
    }
  });
  return events;
}

// The plan path travels on every event (§9.2 `plan`), so no extra state file is
// invented to remember it.
export function resolvePlanPath(events, override) {
  if (override) return resolvePath(override);
  // A shared root can hold several units, each with its own plan: guessing the most
  // recent one would act on another unit's state, so the ambiguity is an error.
  const named = new Set();
  for (const event of events) {
    const candidate = event?.plan;
    if (typeof candidate === "string" && candidate !== "") named.add(resolvePath(candidate));
  }
  if (named.size > 1) {
    throw usage(`the evidence root names ${named.size} plans: pass --plan <path> to name the unit`);
  }
  if (named.size === 1) return [...named][0];
  throw stateMismatch("no plan path: pass --plan or append an event that names one");
}

// §9.4 rules M1 enforces beyond the schema: `intake` opens a unit, and the
// round/switch/terminal rules come from the M0 validator on the whole replay.
//
// Rule 3 needs a decision the events alone cannot carry, so this writer makes it: the
// repeat test is read from findings.tsv once, when the round that follows lands, and
// stamped on that event. A replay then reads the stamp, which is why a later findings
// row can never re-open a window the ledger already closed.
function repeatStamp(root, events, event) {
  const previous = roundsOf(events, event.unit).pop();
  if (!previous || previous.verdict !== "REVISE" || previous.round < 3) return undefined;
  return switchRepeats(readFindings(root) ?? [], previous.round) !== false;
}

export function appendEvent(root, input, { plan, sessionId = "senpi:wish-cli", now = nowIso() } = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw usage("the event must be one JSON object");
  }
  if (input.prior_repeat !== undefined) {
    throw usage("prior_repeat is the ledger's own decision: append the round and the writer stamps it");
  }
  const event = { ...input };
  if (event.stage === undefined) event.stage = event.event;
  if (event.started_at === undefined) event.started_at = now;
  if (event.session_id === undefined) event.session_id = sessionId;
  if (event.plan === undefined && plan) event.plan = plan;
  const checked = validateLedgerEvent(event);
  if (!checked.ok) throw checkFailed("the event does not match the ledger contract", checked.errors);
  const existing = readLedger(root);
  if (event.event === "round") {
    const stamp = repeatStamp(root, existing, event);
    if (stamp !== undefined) event.prior_repeat = stamp;
  }
  if (event.event !== "intake") {
    const opened = existing.some((other) => other.unit === event.unit && other.event === "intake");
    if (!opened) {
      throw stateMismatch(`out of stage order: unit ${event.unit} has no intake event`);
    }
  }
  const pending = pendingSwitchErrors([...existing, event]);
  if (pending.length > 0) throw stateMismatch("out of stage order", pending);
  if (event.event === "round") {
    const intake = existing.find((other) => other.unit === event.unit && other.event === "intake");
    const { freeze: frozen } = unitLedgerFacts(existing, event.unit);
    const planState = existsSync(event.plan) ? readPlan(event.plan) : null;
    requireCodeReview({
      receipts: listReceipts(root), unit: event.unit,
      requiredLanes: requiredReceiptsFor(intake.type, intake),
      frozenHead: planState?.wish.unit === event.unit ? planState.wish.frozen_head : frozen?.head,
      tree: frozen?.tree,
    });
  }
  const paths = rootPaths(root);
  appendLine(paths.ledger, `${JSON.stringify(event)}\n`);
  return event;
}

// Repair only while the caller holds the lock. Include padding in the checked
// write so a short write can be rolled back to the repaired pre-write size.
function appendLine(file, text) {
  ensureDir(dirname(file));
  const fd = openSync(file, "a");
  try {
    const tail = ledgerTail(readTextOrNull(file) ?? "");
    if (tail.kind === "torn") ftruncateSync(fd, tail.size);
    const size = fstatSync(fd).size;
    const data = tail.kind === "complete" ? `\n${text}` : text;
    if (writeSync(fd, data) !== Buffer.byteLength(data)) {
      ftruncateSync(fd, size);
      throw stateMismatch(`short write to ${file}`);
    }
  } finally {
    closeSync(fd);
  }
}

// M0 §2: a mixed run takes its primary type's identity form, so head/tree rules
// (and the research artifact hash) follow the primary, not the label "mixed".
export const identityType = (type, primary) => (type === "mixed" ? primary : type);

// M0 §9.4: M0's own sequence validator demands that a third-or-later REVISE already
// has its approach switch in the same array, while a switch in turn demands the
// REVISE before it. Enforced incrementally that pair is circular: the round could
// never be appended, so the switch could never follow. M1 therefore appends the
// round first and treats the missing switch as a *pending obligation* until the
// next round lands: `next` becomes "switch" and `blocking` names it. Once a later
// round exists the rule bites again, exactly as M0 states it ("before the next
// round").
const PENDING_SWITCH = "requires an approach switch";

export function pendingSwitchErrors(events) {
  const result = validateLedgerSequence(events);
  const lastRoundOf = new Map();
  for (const event of events) {
    if (event?.event !== "round" || typeof event.unit !== "string") continue;
    lastRoundOf.set(event.unit, Math.max(lastRoundOf.get(event.unit) ?? 0, Number(event.round) || 0));
  }
  return result.errors.filter((entry) => {
    if (!String(entry.message).includes(PENDING_SWITCH)) return true;
    const match = /^unit (.+) round (\d+)$/.exec(String(entry.path ?? ""));
    if (!match) return true;
    return Number(match[2]) !== (lastRoundOf.get(match[1]) ?? -1);
  });
}

export function roundsOf(events, unit) {
  return events
    .filter((event) => event.event === "round" && event.unit === unit)
    .sort((left, right) => left.round - right.round);
}

export function unitLedgerFacts(events, unit) {
  const reversed = [...events].reverse();
  const prSource = reversed.find((event) => event.unit === unit
    && ((event.event === "pr_open" && Number.isInteger(event.pr)) || (event.event === "freeze" && Number.isInteger(event.pr))));
  const freeze = reversed.find((event) => event.unit === unit && event.event === "freeze");
  const rounds = roundsOf(events, unit);
  return { pr: prSource?.pr ?? null, round: rounds.at(-1)?.round ?? 0, frozen_head: freeze?.head ?? null, freeze };
}

export function switchesOf(events, unit) {
  return events.filter((event) => event.event === "switch" && event.unit === unit);
}
