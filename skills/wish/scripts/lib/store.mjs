// wish v2 - module M1: state primitives for the one CLI (`wish.mjs`).
//
// This file owns files and derivations only: it imports every shape, value set
// and validator from the frozen M0 contract (`./schema.mjs`) instead of
// re-declaring one, exactly as `references/ledger.md` requires. It never calls
// git and never spawns a process (M1's CLI does both), so every derivation here
// is a pure function of files plus the head/tree the caller observed.
//
// Contract sections used: ledger.md §1 (paths and write authority), §2 (head,
// tree, head7), §4 (receipt and validity), §5 (findings), §6 (gaps), §7 (lens),
// §8 (plan front matter), §9 (ledger events and the cap-is-a-switch rule), §11
// (status --json and the PROGRESS line), §13 (gates.md), §14 (the CLI verbs).

import {
  GAPS_COLUMNS,
  FINDINGS_COLUMNS,
  FINDINGS_STATUSES,
  GAP_STATUSES,
  LEDGER_EVENTS,
  RECEIPT_STATUSES,
  STAGE_NAMES,
  SWITCH_KINDS,
  formatProgressLine,
  parseFindingsTsv,
  parseGapsTsv,
  parseGatesMarkdown,
  parseReceiptFilename,
  requiredReceiptsFor,
  validateLedgerEvent,
  validateLedgerSequence,
  validatePlanFrontMatter,
  validateReceipt,
  validateReceiptAgainstFilename,
  validateStatusJson,
  blockingStatus,
} from "./schema.mjs";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";

// --------------------------------------------------------------------- errors

// One class for every refusal: `code` is the §14 exit code, so the CLI never
// invents one. 0 ok, 1 check failed, 2 usage, 3 state mismatch.
export class WishError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = "WishError";
    this.code = code;
    this.details = details;
  }
}

export const usage = (message, details = []) => new WishError(2, message, details);
export const checkFailed = (message, details = []) => new WishError(1, message, details);
export const stateMismatch = (message, details = []) => new WishError(3, message, details);

export function formatErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return "";
  return errors.map((entry) => `${entry.path}: ${entry.message}`).join("; ");
}

// -------------------------------------------------------------- file plumbing

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

export function readTextOrNull(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw stateMismatch(`cannot read ${file}: ${error?.code ?? error?.message ?? error}`);
  }
}

// Write-then-rename in the same directory: a reader never sees a half file, and
// a crash leaves either the old file or the new one (ledger.md §1 one writer).
export function atomicWrite(file, text) {
  ensureDir(dirname(file));
  const tmp = join(dirname(file), `.${basename(file)}.tmp.${process.pid}.${Date.now()}`);
  writeSyncFile(tmp, text);
  renameSync(tmp, file);
}

function writeSyncFile(file, text) {
  const fd = openSync(file, "w");
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
}

function basename(file) {
  const parts = String(file).split(/[\\/]/);
  return parts[parts.length - 1];
}

// ---------------------------------------------------------------------- paths

// ledger.md §1: `<ER>` plus its files. Nothing else may be created here.
export function rootPaths(root) {
  const dir = resolvePath(root);
  return {
    root: dir,
    ledger: join(dir, "ledger.jsonl"),
    findings: join(dir, "findings.tsv"),
    gaps: join(dir, "gaps.tsv"),
    gates: join(dir, "gates.md"),
    lens: join(dir, "lens.md"),
    ideal: join(dir, "ideal.md"),
    resume: join(dir, "resume.md"),
    receipts: join(dir, "receipts"),
    lock: join(dir, "lock"),
  };
}

// ----------------------------------------------------------------------- lock

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM"; // exists, owned by someone else
  }
}

// A bounded, synchronous wait: the CLI is a one-shot process, so blocking here
// costs nothing and keeps the lock protocol synchronous (no timers, no events).
function sleepSync(ms) {
  const cell = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(cell, 0, 0, ms);
}

// ledger.md §1 write authority: one mutating verb at a time across processes.
//
// A pid file plus takeover has a window that no amount of care closes: two
// processes can both see a stale owner, both remove it, and both believe they hold
// the lock, after which one whole-file write silently erases the other's row. So the
// exclusion is a queue instead of a takeover. Each contender writes a ticket named
// by a strictly increasing number, and enters only when its ticket is the smallest
// present. Nobody ever removes a live peer's ticket, so there is no moment at which
// two contenders can both be the smallest.
//
// A contender killed while holding leaves its ticket behind; the next contender
// removes tickets whose pid is dead, which is idempotent and race-free (removing a
// dead peer's file cannot create a second owner). The one hazard left is pid reuse
// making a dead holder look alive: that stalls the run at the acquire deadline with
// a state error and loses nothing, which is the safe direction.
class FileLock {
  constructor(root) {
    this.paths = rootPaths(root);
    this.queueDir = `${this.paths.root}/lock.queue`;
    this.id = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    this.ticket = null;
    this.held = false;
  }

  entryName(ticket) {
    return `${String(ticket).padStart(12, "0")}-${this.id}.ticket`;
  }

  acquire({ waitMs = 2000, pollMs = 10 } = {}) {
    ensureDir(this.paths.root);
    ensureDir(this.queueDir);
    const deadline = Date.now() + waitMs;
    const choosing = `${this.queueDir}/${this.id}.choosing`;
    writeFileSync(choosing, JSON.stringify({ pid: process.pid, started_at: nowIso() }));
    try {
      // Publish at once: waiting here would let two choosers wait on each other.
      // A chooser that is still outstanding is handled at entry time instead, which
      // is the rule that keeps a descheduled contender from being leapfrogged.
      const open = this.list();
      const max = open.reduce((top, entry) => (entry.ticket > top ? entry.ticket : top), 0);
      this.ticket = max + 1;
      writeFileSync(`${this.queueDir}/${this.entryName(this.ticket)}`,
        JSON.stringify({ pid: process.pid, started_at: nowIso() }));
    } finally {
      rmQuiet(choosing);
    }
    const mine = { ticket: this.ticket, id: this.id };
    for (;;) {
      this.sweep();
      const ahead = this.choosers().length > 0 || this.list().some((entry) => entry.ticket < mine.ticket
        || (entry.ticket === mine.ticket && entry.id < mine.id));
      if (!ahead) {
        // A contender that started reading while we were writing our ticket could
        // hold the same number; one settle read orders the two before we enter.
        sleepSync(2);
        const again = this.choosers().length > 0 || this.list().some((entry) => entry.ticket < mine.ticket
          || (entry.ticket === mine.ticket && entry.id < mine.id));
        if (!again) {
          this.held = true;
          return this;
        }
      }
      if (Date.now() >= deadline) {
        this.release();
        throw stateMismatch(`cannot lock ${this.paths.root}: still queued after ${waitMs}ms`);
      }
      sleepSync(pollMs);
    }
  }

  list() {
    let names;
    try {
      names = readdirSync(this.queueDir);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      // An unreadable queue is not an empty one: guessing here would let two
      // contenders both believe they are alone.
      throw stateMismatch(`cannot read ${this.queueDir}: ${error?.code ?? error}`);
    }
    const entries = [];
    for (const name of names) {
      const match = /^(\d{12})-([0-9]+-[a-z0-9]+)\.ticket$/.exec(name);
      if (!match) continue;
      entries.push({ ticket: Number(match[1]), id: match[2], name });
    }
    return entries.sort((left, right) => left.ticket - right.ticket || (left.id < right.id ? -1 : 1));
  }

  choosers() {
    let names;
    try {
      names = readdirSync(this.queueDir);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw stateMismatch(`cannot read ${this.queueDir}: ${error?.code ?? error}`);
    }
    const live = [];
    for (const name of names) {
      const match = /^([0-9]+)-[a-z0-9]+\.choosing$/.exec(name);
      if (!match) continue;
      if (name === `${this.id}.choosing`) continue;
      const pid = Number(match[1]);
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
      if (pidAlive(pid)) live.push(name);
    }
    return live;
  }

  // Only a dead contender's files are removed, so a live holder's ticket can never
  // be taken away by a peer.
  sweep() {
    let names;
    try {
      names = readdirSync(this.queueDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === `${this.id}.choosing` || name === this.entryName(this.ticket ?? 0)) continue;
      const match = /^(?:\d{12})?-?([0-9]+)-[a-z0-9]+\.(?:ticket|choosing)$/.exec(name);
      if (!match) continue;
      const pid = Number(match[1]);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      if (pid === process.pid) continue;
      if (pidAlive(pid)) continue;
      rmQuiet(`${this.queueDir}/${name}`);
    }
  }

  release() {
    if (!this.held) {
      if (this.ticket !== null) rmQuiet(`${this.queueDir}/${this.entryName(this.ticket)}`);
      this.ticket = null;
      return;
    }
    this.held = false;
    rmQuiet(`${this.queueDir}/${this.entryName(this.ticket)}`);
    this.ticket = null;
  }
}

function rmQuiet(path) {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}

export function withLock(root, fn, options = {}) {
  const lock = new FileLock(root).acquire(options);
  try {
    return fn();
  } finally {
    lock.release();
  }
}
// --------------------------------------------------------------------- ledger

// §9: one JSON object per line, append-only. A malformed line is a state error,
// never silently skipped: a lost event would move `status` backwards.
export function readLedger(root) {
  const paths = rootPaths(root);
  const text = readTextOrNull(paths.ledger);
  if (text === null) return [];
  const lines = text.split("\n");
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
export function appendEvent(root, input, { plan, sessionId = "senpi:wish-cli", now = nowIso() } = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw usage("the event must be one JSON object");
  }
  const event = { ...input };
  if (event.stage === undefined) event.stage = event.event;
  if (event.started_at === undefined) event.started_at = now;
  if (event.session_id === undefined) event.session_id = sessionId;
  if (event.plan === undefined && plan) event.plan = plan;
  const checked = validateLedgerEvent(event);
  if (!checked.ok) throw checkFailed("the event does not match the ledger contract", checked.errors);
  const existing = readLedger(root);
  if (event.event !== "intake") {
    const opened = existing.some((other) => other.unit === event.unit && other.event === "intake");
    if (!opened) {
      throw stateMismatch(`out of stage order: unit ${event.unit} has no intake event`);
    }
  }
  const pending = pendingSwitchErrors([...existing, event]);
  if (pending.length > 0) throw stateMismatch("out of stage order", pending);
  const paths = rootPaths(root);
  appendLine(paths.ledger, `${JSON.stringify(event)}\n`);
  return event;
}

// Atomic append under the caller's lock: O_APPEND keeps concurrent writers from
// interleaving a line (QA12).
function appendLine(file, text) {
  ensureDir(dirname(file));
  const fd = openSync(file, "a");
  try {
    writeSync(fd, text);
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

export function switchesOf(events, unit) {
  return events.filter((event) => event.event === "switch" && event.unit === unit);
}

// ---------------------------------------------------------- plan front matter

// §8.1: the YAML shape M1 reads and writes. Only the front-matter block is
// re-rendered; the body is handed back exactly as it arrived, line endings and
// all, because the plan body belongs to the session and M2.
export function splitFrontMatter(text) {
  const source = String(text ?? "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?=\r?\n|$)/.exec(source);
  if (!match) return { block: null, body: source, unterminated: source.startsWith("---") };
  return { block: match[1].split(/\r?\n/), body: source.slice(match[0].length) };
}

function coerceScalar(raw, key) {
  const value = raw.trim();
  if (value === "null" || value === "~" || value === "") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  // Only the two numeric keys are numbers: an all-digit SHA in frozen_head or a
  // numeric-looking run id must stay a string, or the contract rejects it.
  if ((key === "pr" || key === "round") && /^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    // The writer quotes with JSON.stringify, so escapes (a quote, a backslash, a
    // control character) have to be decoded the same way or the round trip drifts.
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1);
  return value;
}

const FRONT_MATTER_KEYS = [
  "run_id", "tier", "type", "unit", "program_id", "worktree", "branch", "pr", "frozen_head", "round",
];

export function parseFrontMatter(text) {
  const split = splitFrontMatter(text);
  if (split.unterminated) throw stateMismatch("the plan front matter is not terminated by ---");
  if (split.block === null) throw stateMismatch("the plan has no wish: front matter");
  const wish = {};
  let seenRoot = false;
  split.block.forEach((line, index) => {
    if (line.trim() === "" || line.trim().startsWith("#")) return;
    if (line === "wish:") {
      seenRoot = true;
      return;
    }
    const match = /^ {2}([A-Za-z_][A-Za-z0-9_]*):[ ]?(.*)$/.exec(line);
    if (!match || !seenRoot) {
      throw stateMismatch(`the plan front matter line ${index + 2} is not a wish: key`);
    }
    wish[match[1]] = coerceScalar(match[2], match[1]);
  });
  if (!seenRoot) throw stateMismatch("the plan has no wish: front matter");
  for (const key of Object.keys(wish)) {
    if (!FRONT_MATTER_KEYS.includes(key)) throw stateMismatch(`the plan front matter key ${key} is not in the contract`);
  }
  return { wish, body: split.body };
}

export function readPlan(planPath) {
  const text = readTextOrNull(planPath);
  if (text === null) throw stateMismatch(`the plan does not exist: ${planPath}`);
  const parsed = parseFrontMatter(text);
  const checked = validatePlanFrontMatter(parsed);
  if (!checked.ok) throw stateMismatch(`${planPath} front matter does not match the contract`, checked.errors);
  return { wish: parsed.wish, body: parsed.body, path: planPath };
}

// A string that would parse back as something else must be quoted: the program id
// "null", a run id of digits, "true". Otherwise a round trip silently changes the
// value and the write's own verification never converges.
function yamlScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  if (/^(?:null|~|true|false|-?\d+)$/.test(text) || text.trim() !== text || text === "") {
    return JSON.stringify(text);
  }
  return text;
}

export function renderFrontMatter(wish, eol = "\n") {
  const lines = ["---", "wish:"];
  for (const key of FRONT_MATTER_KEYS) {
    if (!(key in wish)) continue;
    const value = wish[key];
    lines.push(`  ${key}: ${yamlScalar(value)}`);
  }
  lines.push("---");
  return `${lines.join(eol)}${eol}`;
}

// The plan body belongs to M2 and the session; M1 rewrites only the front
// matter block and keeps the rest byte-for-byte.
export function writeFrontMatter(planPath, wish) {
  mutateText(planPath, (current) => {
    const raw = current === null ? "" : splitFrontMatter(current).body;
    // The plan's own line ending is honoured, so a CRLF document survives a freeze
    // byte for byte; the marker's break travels with the body and is re-supplied by
    // the renderer, so exactly one is dropped and every other byte is kept.
    const eol = current?.match(/\r?\n/)?.[0] ?? "\n";
    const body = raw.replace(/^\r?\n/, "");
    return renderFrontMatter(wish, eol) + body;
  }, (text) => {
    const written = parseFrontMatter(text).wish;
    return Object.entries(wish).every(([key, value]) => written[key] === value);
  });
}

export function mergeFrontMatter(planPath, patch) {
  let merged = null;
  mutateText(planPath, (current) => {
    if (current === null) throw stateMismatch(`the plan does not exist: ${planPath}`);
    const parsed = parseFrontMatter(current);
    const wish = { ...parsed.wish, ...patch };
    const checked = validatePlanFrontMatter({ wish });
    if (!checked.ok) throw stateMismatch("the updated front matter would not match the contract", checked.errors);
    merged = wish;
    const eol = current.match(/\r?\n/)?.[0] ?? "\n";
    const body = splitFrontMatter(current).body.replace(/^\r?\n/, "");
    return renderFrontMatter(wish, eol) + body;
  }, (text) => {
    const wish = parseFrontMatter(text).wish;
    return Object.entries(patch).every(([key, value]) => wish[key] === value);
  });
  return merged;
}

// ------------------------------------------------------------------ tsv files

// §5/§6 rows are strings on disk; the schema parser owns their validity. A
// header-only file is zero rows (a register that was opened and not filled).
function readTsv(file, columns, parse) {
  const text = readTextOrNull(file);
  if (text === null) return null;
  const body = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (body.trim() === "") return [];
  if (body === columns.join("\t")) return [];
  const parsed = parse(text);
  if (!parsed.ok) throw stateMismatch(`${file} does not match the contract`, parsed.errors);
  return parsed.rows;
}

function writeTsv(file, columns, rows) {
  const lines = [columns.join("\t"), ...rows.map((row) => columns.map((column) => row[column]).join("\t"))];
  atomicWrite(file, `${lines.join("\n")}\n`);
}

function tsvCell(value, label) {
  const text = value === null || value === undefined ? "" : String(value);
  if (text.includes("\t") || text.includes("\n") || text.includes("\r")) {
    throw usage(`${label} may not contain a tab, CR or LF`);
  }
  return text;
}

// A read-modify-write on a whole file cannot be made safe by a lock alone: POSIX
// has no compare-and-swap on a path, and a reclaimer that removes a lock a
// competitor just installed lets two writers into the same section. So the write
// itself is guarded: re-read, compare against the bytes the computation saw, and
// only then swap the file in. A writer that loses the race recomputes against the
// newer bytes instead of overwriting them, which turns a possible lost update into
// either a correct result or a loud refusal (bounded, never a silent clobber).
function mutateText(file, compute, verify) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (attempt > 0) sleepSync(1 + (attempt % 7));
    const before = readTextOrNull(file);
    const next = compute(before);
    if (next === null || next === undefined) return;
    if (readTextOrNull(file) !== before) continue;
    if (!swapIfUnchanged(file, next, before)) continue;
    // A rename is atomic but last-wins: another writer may have replaced the file
    // between the comparison and the swap. Re-read and confirm this write's own
    // effect survived; if it did not, recompute against the newer bytes instead of
    // silently losing the update.
    if (!verify) return;
    let holds = false;
    try {
      holds = verify(readTextOrNull(file));
    } catch {
      holds = false;
    }
    if (holds) return;
  }
  throw stateMismatch(`cannot update ${file}: concurrent writers keep moving it`);
}

function swapIfUnchanged(file, text, expected) {
  ensureDir(dirname(file));
  const tmp = join(dirname(file), `.${basename(file)}.tmp.${process.pid}.${Date.now()}`);
  writeSyncFile(tmp, text);
  if (readTextOrNull(file) !== expected) {
    try {
      unlinkSync(tmp);
    } catch {
      // the temp file is already gone
    }
    return false;
  }
  renameSync(tmp, file);
  return true;
}

function rowsFromText(text, columns, parse) {
  if (text === null) return [];
  const body = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (body.trim() === "" || body === columns.join("\t")) return [];
  const parsed = parse(text);
  if (!parsed.ok) throw stateMismatch("the table does not match the contract", parsed.errors);
  return parsed.rows;
}

function renderTsv(columns, rows) {
  return [columns.join("\t"), ...rows.map((row) => columns.map((column) => row[column]).join("\t"))].join("\n");
}

export function readFindings(root, options = {}) {
  return readTsv(rootPaths(root).findings, FINDINGS_COLUMNS, (text) => parseFindingsTsv(text, options));
}

export function readGaps(root) {
  return readTsv(rootPaths(root).gaps, GAPS_COLUMNS, (text) => parseGapsTsv(text));
}

const FINDING_TRANSITIONS = {
  open: ["fixed", "not-fixed", "no-command", "note", "owner"],
  "not-fixed": ["open", "fixed", "note", "owner"],
  "no-command": ["open", "not-fixed", "fixed", "note", "owner"],
  fixed: ["open"],
  note: ["open", "owner"],
  owner: ["open", "note"],
};

const GAP_TRANSITIONS = {
  open: ["planned", "fixed", "accepted-limit", "out-of-scope"],
  planned: ["open", "fixed", "accepted-limit", "out-of-scope"],
  fixed: ["open"],
  "accepted-limit": ["open", "planned"],
  "out-of-scope": ["open"],
};

function normalizeRows(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    return String(input)
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .filter((line) => line.trim() !== "");
  }
  throw usage("expected rows as text or an array of row arrays");
}

// `findings add --tsv <file|->`: the text is the full file (header + rows) or
// just rows. Existing ids are never replaced.
export function addFindings(root, text, { type, primary, secondary } = {}) {
  const paths = rootPaths(root);
  const options = { type, primary, secondary };
  const incoming = parseFindingsText(text);
  mutateText(paths.findings, (current) => {
    const now = rowsFromText(current, FINDINGS_COLUMNS, (value) => parseFindingsTsv(value, options));
    const seen = new Set(now.map((row) => row.id));
    for (const row of incoming) {
      if (seen.has(row.id)) throw checkFailed(`finding ${row.id} already exists; findings.set moves it`);
      seen.add(row.id);
    }
    const merged = [...now, ...incoming];
    const checked = parseFindingsTsv(renderTsv(FINDINGS_COLUMNS, merged), options);
    if (!checked.ok) throw checkFailed("the findings rows do not match the contract", checked.errors);
    return `${renderTsv(FINDINGS_COLUMNS, merged)}\n`;
  }, (text) => {
    const ids = new Set(rowsFromText(text, FINDINGS_COLUMNS, (value) => parseFindingsTsv(value, options)).map((row) => row.id));
    return incoming.every((row) => ids.has(row.id));
  });
  return incoming;
}

function parseFindingsText(text) {
  const lines = normalizeRows(text);
  if (lines.length === 0) throw usage("no finding rows were given");
  const header = FINDINGS_COLUMNS.join("\t");
  const body = lines[0] === header ? lines.slice(1) : lines;
  if (body.length === 0) throw usage("the findings text has a header and no rows");
  const checked = parseFindingsTsv([header, ...body].join("\n"), {});
  if (!checked.ok) throw checkFailed("the findings rows do not match the contract", checked.errors);
  return checked.rows;
}

export function setFinding(root, id, patch, { type, primary, secondary } = {}) {
  const paths = rootPaths(root);
  const options = { type, primary, secondary };
  let updated = null;
  mutateText(paths.findings, (current) => {
    if (current === null) throw stateMismatch(`no findings file: ${paths.findings}`);
    const rows = rowsFromText(current, FINDINGS_COLUMNS, (value) => parseFindingsTsv(value, options));
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) throw stateMismatch(`unknown finding id ${id}`);
    const row = { ...rows[index] };
    if (patch.status !== undefined) {
      if (!FINDINGS_STATUSES.includes(patch.status)) throw usage(`unknown finding status ${patch.status}`);
      const allowed = FINDING_TRANSITIONS[row.status] ?? [];
      if (patch.status !== row.status && !allowed.includes(patch.status)) {
        throw checkFailed(`finding ${id} may not move from ${row.status} to ${patch.status}`);
      }
      row.status = patch.status;
    }
    if (patch.blocking !== undefined) {
      if (patch.blocking !== "0" && patch.blocking !== "1") throw usage("--blocking takes 0 or 1");
      row.blocking = patch.blocking;
    }
    if (patch.fixedHead !== undefined) {
      row.fixed_head = patch.fixedHead === "-" ? "-" : tsvCell(patch.fixedHead, "--fixed-head");
    }
    if (row.status === "fixed" && !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(row.fixed_head)) {
      throw checkFailed(`finding ${id} is fixed but names no fix head`);
    }
    if (row.status !== "fixed" && row.fixed_head !== "-") row.fixed_head = "-";
    if ((row.status === "note" || row.status === "owner") && row.blocking === "1") {
      throw checkFailed(`finding ${id} is ${row.status} and may not block`);
    }
    rows[index] = row;
    const checked = parseFindingsTsv(renderTsv(FINDINGS_COLUMNS, rows), options);
    if (!checked.ok) throw checkFailed("the findings rows do not match the contract", checked.errors);
    updated = row;
    return `${renderTsv(FINDINGS_COLUMNS, rows)}\n`;
  }, (text) => {
    const rows = rowsFromText(text, FINDINGS_COLUMNS, (value) => parseFindingsTsv(value, options));
    const row = rows.find((entry) => entry.id === id);
    if (!row) return false;
    if (patch.status !== undefined && row.status !== patch.status) return false;
    if (patch.blocking !== undefined && row.blocking !== patch.blocking) return false;
    // The stored head is normalized: anything but a fixed row keeps "-", so the
    // expected value is the normalized one, never the raw flag.
    if (patch.fixedHead !== undefined) {
      const expected = row.status === "fixed" ? (patch.fixedHead === "-" ? "-" : patch.fixedHead) : "-";
      if (row.fixed_head !== expected) return false;
    }
    return true;
  });
  return updated;
}

export function addGaps(root, text) {
  const paths = rootPaths(root);
  const lines = normalizeRows(text);
  if (lines.length === 0) throw usage("no gap rows were given");
  const header = GAPS_COLUMNS.join("\t");
  const body = lines[0] === header ? lines.slice(1) : lines;
  if (body.length === 0) throw usage("the gaps text has a header and no rows");
  const incoming = parseGapsTsv([header, ...body].join("\n"));
  if (!incoming.ok) throw checkFailed("the gap rows do not match the contract", incoming.errors);
  mutateText(paths.gaps, (current) => {
    const now = rowsFromText(current, GAPS_COLUMNS, (value) => parseGapsTsv(value));
    const seen = new Set(now.map((row) => row.id));
    for (const row of incoming.rows) {
      if (seen.has(row.id)) throw checkFailed(`gap ${row.id} already exists; gaps.set moves it`);
      seen.add(row.id);
    }
    const merged = [...now, ...incoming.rows];
    const checked = parseGapsTsv(renderTsv(GAPS_COLUMNS, merged));
    if (!checked.ok) throw checkFailed("the register does not match the contract", checked.errors);
    return `${renderTsv(GAPS_COLUMNS, merged)}\n`;
  }, (text) => {
    const ids = new Set(rowsFromText(text, GAPS_COLUMNS, (value) => parseGapsTsv(value)).map((row) => row.id));
    return incoming.rows.every((row) => ids.has(row.id));
  });
  return incoming.rows;
}

export function setGap(root, id, patch) {
  const paths = rootPaths(root);
  let updated = null;
  mutateText(paths.gaps, (current) => {
    if (current === null) throw stateMismatch(`no register: ${paths.gaps}`);
    const rows = rowsFromText(current, GAPS_COLUMNS, (value) => parseGapsTsv(value));
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) throw stateMismatch(`unknown gap id ${id}`);
    const row = { ...rows[index] };
    if (patch.status !== undefined) {
      if (!GAP_STATUSES.includes(patch.status)) throw usage(`unknown gap status ${patch.status}`);
      const allowed = GAP_TRANSITIONS[row.status] ?? [];
      if (patch.status !== row.status && !allowed.includes(patch.status)) {
        throw stateMismatch(`gap ${id} may not move from ${row.status} to ${patch.status}`);
      }
      row.status = patch.status;
    }
    if (patch.pr !== undefined) {
      if (patch.pr !== "-" && !/^[1-9][0-9]*$/.test(String(patch.pr))) throw usage("--pr takes a PR number or -");
      row.pr = String(patch.pr);
    }
    if (patch.fixedHead !== undefined) {
      row.fixed_head = patch.fixedHead === "-" ? "-" : tsvCell(patch.fixedHead, "--fixed-head");
    }
    // Leaving "fixed" clears the fix head, exactly as findings.set does: a row that
    // is open again must not claim a commit that no longer closes it.
    if (row.status !== "fixed") row.fixed_head = "-";
    rows[index] = row;
    const checked = parseGapsTsv(renderTsv(GAPS_COLUMNS, rows));
    if (!checked.ok) throw checkFailed("the register does not match the contract", checked.errors);
    updated = row;
    return `${renderTsv(GAPS_COLUMNS, rows)}\n`;
  }, (text) => {
    const row = rowsFromText(text, GAPS_COLUMNS, (value) => parseGapsTsv(value)).find((entry) => entry.id === id);
    if (!row) return false;
    if (patch.status !== undefined && row.status !== patch.status) return false;
    if (patch.pr !== undefined && row.pr !== String(patch.pr)) return false;
    if (patch.fixedHead !== undefined && row.fixed_head !== (patch.fixedHead === "-" ? "-" : patch.fixedHead)) return false;
    return true;
  });
  return updated;
}

// ---------------------------------------------------------------------- gates

// §13: the poteto block shape, read and written through the M0 parser so the
// renderer and the reader cannot drift.
export function readGates(root) {
  const text = readTextOrNull(rootPaths(root).gates);
  if (text === null) return [];
  const parsed = parseGatesMarkdown(text);
  if (!parsed.ok) throw stateMismatch(`${rootPaths(root).gates} does not match the contract`, parsed.errors);
  return parsed.gates;
}

export function renderGates(gates) {
  if (gates.length === 0) return "";
  const blocks = gates.map((gate) => {
    const lines = [
      `## ${gate.id}`,
      "",
      `- Status: ${gate.status}`,
      `- Question: ${gate.question}`,
      `- Options: ${gate.options}`,
      `- Default: ${gate.default}`,
    ];
    if (gate.status === "resolved") lines.push(`- Answer: ${gate.answer}`);
    return lines.join("\n");
  });
  return `# Gates\n\n${blocks.join("\n\n")}\n`;
}

function gateField(value, label) {
  if (value === null || value === undefined) throw usage(`${label} is required`);
  const text = String(value).replace(/\r?\n/g, " ").trim();
  if (text === "") throw usage(`${label} may not be empty`);
  return text;
}

function gatesFromText(text) {
  if (text === null || text.trim() === "") return [];
  const parsed = parseGatesMarkdown(text);
  if (!parsed.ok) throw stateMismatch("gates.md does not match the contract", parsed.errors);
  return parsed.gates;
}

export function addGate(root, { id, question, options, fallback }) {
  const paths = rootPaths(root);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(id ?? ""))) throw usage("--id takes [A-Za-z0-9][A-Za-z0-9_-]*");
  const choices = String(options ?? "").split("|").map((choice) => choice.trim()).filter((choice) => choice !== "");
  if (choices.length < 2) throw usage("--options takes at least two choices separated by |");
  const picked = gateField(fallback, "--default");
  if (!choices.includes(picked)) throw usage("--default must be one of --options");
  const gate = {
    id,
    status: "open",
    question: gateField(question, "--question"),
    options: choices.join(" | "),
    default: picked,
  };
  mutateText(paths.gates, (current) => {
    const gates = gatesFromText(current);
    if (gates.some((entry) => entry.id === id)) throw checkFailed(`gate ${id} already exists`);
    const next = [...gates, gate];
    const checked = parseGatesMarkdown(renderGates(next));
    if (!checked.ok) throw checkFailed("the gate block does not match the contract", checked.errors);
    return renderGates(next);
  }, (text) => gatesFromText(text).some((entry) => entry.id === gate.id && entry.question === gate.question));
  return gate;
}

export function resolveGate(root, { id, answer }) {
  const paths = rootPaths(root);
  const resolved = gateField(answer, "--answer");
  mutateText(paths.gates, (current) => {
    const gates = gatesFromText(current);
    const index = gates.findIndex((gate) => gate.id === id);
    if (index === -1) throw stateMismatch(`unknown gate ${id}`);
    if (gates[index].status !== "open") throw checkFailed(`gate ${id} is already ${gates[index].status}`);
    const next = gates.map((gate, at) => (at === index ? { ...gate, status: "resolved", answer: resolved } : gate));
    const checked = parseGatesMarkdown(renderGates(next));
    if (!checked.ok) throw checkFailed("the gate block does not match the contract", checked.errors);
    return renderGates(next);
  }, (text) => gatesFromText(text).some((entry) => entry.id === id && entry.status === "resolved"));
  return { id, status: "resolved", answer: resolved };
}
// ------------------------------------------------------ receipts and validity

// §4.2. A `.json` receipt is validated in full; a `.md` receipt contributes its
// front-matter identity and status only (LIM1 in the plan: no YAML array
// parser, and rows are not machine-counted for prose reports).
export function listReceipts(root) {
  const dir = rootPaths(root).receipts;
  let names;
  try {
    names = readdirSync(dir).filter((name) => name !== "." && name !== "..");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw stateMismatch(`cannot read ${dir}: ${error?.code ?? error}`);
  }
  return names.sort().map((name) => {
    const parsed = parseReceiptFilename(name);
    // A file whose name is not a receipt name is an artifact, not evidence about a
    // lane: the contract's filename grammar decides what a receipt is, and calling
    // every capture in `receipts/` a stale receipt buries the real ones.
    if (!parsed.ok) return null;
    const file = join(dir, name);
    const extension = name.slice(name.lastIndexOf(".") + 1);
    if (extension !== "json" && extension !== "md") {
      // A capture (png/jpg/webp/txt) carries no machine body: its identity and
      // validity come from the filename anchor alone (ledger.md §4.2).
      try {
        if (statSync(file).isDirectory()) return { name, ok: false, parsed, body: null, errors: [{ path: name, message: "is a directory" }] };
      } catch (error) {
        return { name, ok: false, parsed, body: null, errors: [{ path: name, message: "unreadable: " + (error?.code ?? "error") }] };
      }
      return { name, ok: true, parsed, body: null, errors: [], opaque: true };
    }
    let body;
    try {
      if (statSync(file).isDirectory()) return { name, ok: false, parsed, body: null, errors: [{ path: name, message: "is a directory" }] };
      body = extension === "md" ? parseReceiptMarkdown(readFileSync(file, "utf8")) : JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      return { name, ok: false, parsed, body: null, errors: [{ path: name, message: "unreadable: " + (error?.message ?? error) }] };
    }
    const shape = validateReceipt(body);
    const anchors = validateReceiptAgainstFilename(body, name);
    const errors = [...shape.errors, ...anchors.errors];
    return { name, ok: errors.length === 0, parsed, body, errors };
  }).filter(Boolean);
}

function parseReceiptMarkdown(text) {
  const split = splitFrontMatter(text);
  if (split.block === null) throw new Error("no front matter");
  const value = {};
  split.block.forEach((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*):[ ]?(.*)$/.exec(line);
    if (!match) throw new Error(`front matter line is not key: value: ${line}`);
    value[match[1]] = coerceScalar(match[2], match[1]);
  });
  if (typeof value.scope === "string") value.scope = [value.scope];
  value.rows = [];
  value.artifacts = Array.isArray(value.artifacts) ? value.artifacts : [];
  value.cleanup = Array.isArray(value.cleanup) ? value.cleanup : [];
  return value;
}

// §2/§4: a lane receipt is valid while its tree (or, for research, its artifact
// sha256 in head) matches; otherwise a recorded `reuse` verdict at the same head
// can keep it valid (§2.7). `before`/`after` captures are exempt on purpose, and
// an opaque capture is judged by its filename anchor only.
export function judgeReceipt(receipt, { type, head, tree, reuseEvents = [] }) {
  const kind = receipt.body?.kind ?? receipt.parsed?.kind;
  // Structural validity comes first: a malformed file or a directory named like a
  // receipt is unproven evidence, and being exempt from age checks (before/after)
  // must never make an unreadable file count as valid.
  if (!receipt.ok) return { valid: false, reason: "unparseable" };
  if (kind === "before" || kind === "after") return { valid: true, reason: "capture exempt from reuse" };
  if (receipt.opaque) {
    const anchor = receipt.parsed?.tree7 ?? receipt.parsed?.head7;
    const current = receipt.parsed?.tree7 ? tree : head;
    const valid = Boolean(anchor && typeof current === "string" && current.startsWith(anchor));
    return { valid, reason: valid ? "filename anchor matches" : "filename anchor moved" };
  }
  const body = receipt.body;
  if (!receipt.ok || !body) return { valid: false, reason: "unparseable" };
  const byTree = type === "research" ? null : body.tree;
  const anchored = type === "research" ? body.head === head : Boolean(tree) && byTree === tree;
  if (anchored) return { valid: true, reason: type === "research" ? "artifact sha256 matches" : "tree matches" };
  const rescue = [...reuseEvents].reverse().find((event) => event.reuse && event.reuse.receipt === receipt.name);
  if (rescue && rescue.reuse.verdict === "VALID" && (!head || rescue.head === head)) {
    return { valid: true, reason: "reuse VALID: ".concat(rescue.reuse.reason) };
  }
  return { valid: false, reason: type === "research" ? "artifact sha256 moved" : "tree moved" };
}

// -------------------------------------------------------------- stage machine

// The dispatchable stages, in order (design §2.2 + addendum §C.3). Side events
// ('gate', 'round', 'verdict', 'switch', 'progress', 'reuse', 'resume') are not
// stages: they record a decision or a measurement, never a step to dispatch.
export const STAGE_ORDER = Object.freeze([
  "intake", "lens", "discover", "ideal", "gap", "before", "plan", "plan_lint",
  "plan_review", "goal", "build", "verify_lane", "triage", "fix", "freeze",
  "pr_open", "round", "merge", "post_merge", "checkpoint", "cleanup",
]);

// A stage is attempted when the ledger has its event; 'verify_lane' is also
// attempted when any lane receipt exists, because a lane may write its evidence
// before the session records the event.
function stageAttempted(stage, events, receipts, unit) {
  if (events.some((event) => event.event === stage && event.unit === unit)) return true;
  if (stage === "verify_lane") {
    // The same evidence satisfiesLane accepts counts as an attempt: a typed receipt
    // (claim-gate, vqa-capture, lint) is verification evidence with no stage event.
    return receipts.some((receipt) => receipt.body?.unit === unit
      && (receipt.body.kind === "lane"
        ? receipt.body.stage === "verify_lane"
        : LANE_KINDS.has(receipt.body.kind)));
  }
  return false;
}

function defectGaps(gaps) {
  return (gaps ?? []).filter((row) => row.kind === "defect");
}

function blockingFindings(findings) {
  return (findings ?? []).filter((row) => row.blocking === "1"
    && ["open", "not-fixed", "no-command"].includes(row.status));
}

function isDone(events, unit) {
  return events.some((event) => event.unit === unit && event.event === "cleanup"
    && Array.isArray(event.cleanup) && event.cleanup.length > 0);
}

export function deriveStage(events, receipts, unit) {
  if (isDone(events, unit)) return "done";
  let furthest = -1;
  for (const stage of STAGE_ORDER) {
    if (stageAttempted(stage, events, receipts, unit)) furthest = STAGE_ORDER.indexOf(stage);
  }
  return furthest === -1 ? "intake" : STAGE_ORDER[furthest];
}

// Applicability: a conditional stage is skipped when the data that would make it
// necessary is absent (LIM3). Everything else is always on the path.
function stageApplies(stage, context) {
  const { root, events, gaps, findings, type } = context;
  const paths = rootPaths(root);
  switch (stage) {
    case "lens":
      return existsSync(paths.lens) || events.some((event) => event.event === "lens");
    case "ideal":
      return existsSync(paths.ideal) || events.some((event) => event.event === "ideal");
    case "gap":
      return (gaps ?? []).length > 0 || events.some((event) => event.event === "gap");
    case "before":
      return defectGaps(gaps).length > 0 || events.some((event) => event.event === "before");
    case "build":
      return type !== "audit"; // addendum §C.5: audit has no BUILD
    case "fix":
      return blockingFindings(findings).length > 0 || events.some((event) => event.event === "fix");
    default:
      return true;
  }
}

function nextLinear(stage, context) {
  const from = stage === "done" ? STAGE_ORDER.length : STAGE_ORDER.indexOf(stage) + 1;
  for (let index = Math.max(from, 0); index < STAGE_ORDER.length; index += 1) {
    if (stageApplies(STAGE_ORDER[index], context)) return STAGE_ORDER[index];
  }
  return "done";
}

// One decision table, in the order a session asks: the merge tail, then a REVISE
// (which returns to the first invalid step of the same unit), then the linear
// path. 'switch' may be next: a cap is a switch signal, never an exit (§9.4).
export function deriveNext(stage, context) {
  const { events, findings, frozenHead, head, unit } = context;
  if (stage === "done") return "done";
  const rounds = roundsOf(events, unit);
  const last = rounds[rounds.length - 1];
  if (last && last.verdict === "APPROVED") {
    const merged = events.some((event) => event.event === "merge" && event.unit === unit);
    if (!merged) return "merge";
    const posted = events.some((event) => event.event === "post_merge" && event.unit === unit);
    if (!posted) return "post_merge";
    const checkpoint = [...events].reverse().find((event) => event.event === "checkpoint" && event.unit === unit);
    if (!checkpoint || checkpoint.checkpoint_op !== "complete") return "checkpoint";
    return nextLinear("checkpoint", context);
  }
  if (last && last.verdict === "REVISE") {
    if (!context.lanes.ok) return "verify_lane";
    if (blockingFindings(findings).length > 0) return "fix";
    if (frozenHead !== head) return "freeze";
    const switched = switchesOf(events, unit).some((event) => event.round === last.round);
    if (last.round >= 3 && !switched) return "switch";
    return "round";
  }
  return nextLinear(stage, context);
}

// M0's required-lane table names lanes whose receipt kind is not always "lane": a
// research claim gate writes kind "claim-gate", a design capture kind "vqa-capture",
// an audit lint kind "lint". A typed receipt for the same lane is evidence for it.
const TYPED_LANES = Object.freeze({ capture: "vqa-capture" });
const LANE_KINDS = new Set(["claim-gate", "vqa-capture", "vqa-passA", "vqa-passB", "lint"]);

function satisfiesLane(receipt, lane) {
  const body = receipt.body;
  if (!body) return false;
  if (body.kind === "lane") return body.stage === "verify_lane" && body.lane === lane;
  if (TYPED_LANES[lane] === body.kind) return true;
  return body.kind === lane;
}

function laneState(context) {
  const { receipts, requiredLanes, head, tree, reuseEvents, unit, identity } = context;
  const missing = [];
  const stale = [];
  const satisfied = [];
  for (const lane of requiredLanes) {
    const candidates = receipts.filter((receipt) => satisfiesLane(receipt, lane) && receipt.body.unit === unit);
    if (candidates.length === 0) {
      missing.push(lane);
      continue;
    }
    const judged = candidates.map((receipt) => ({ receipt, verdict: judgeReceipt(receipt, { type: identity, head, tree, reuseEvents }) }));
    const good = judged.find((entry) => entry.verdict.valid
      && RECEIPT_STATUSES.includes(entry.receipt.body.status)
      && entry.receipt.body.status !== "SKIP"
      && !blockingStatus(entry.receipt.body.status));
    if (good) {
      satisfied.push(good.receipt.name);
      continue;
    }
    const latest = judged[judged.length - 1];
    stale.push({ name: latest.receipt.name, skip: latest.receipt.body.status === "SKIP" });
  }
  return { missing, stale, satisfied, ok: missing.length === 0 && stale.length === 0 };
}

function buildContext({ root, plan, events, receipts, findings, gaps, gates, head, tree, unit }) {
  const wish = plan.wish;
  const mixedLabels = [...events].reverse().find((event) => event.unit === unit
    && typeof event.primary === "string" && typeof event.secondary === "string");
  const primary = mixedLabels?.primary;
  const secondary = mixedLabels?.secondary;
  const identity = identityType(wish.type, primary);
  // design §2.3: an L unit always carries the adversarial lane; below L only a
  // plan-flagged high-risk row does. Any event of this unit that flagged an
  // applicable class counts: a later, unrelated row must not retract it.
  const highRisk = wish.tier === "L"
    || events.some((event) => event.unit === unit && Array.isArray(event.adversarial_classes)
      && event.adversarial_classes.some((entry) => entry?.applicable === true));
  const requiredLanes = requiredReceiptsFor(wish.type, { primary, secondary, highRisk });
  const context = {
    root, type: wish.type, identity, primary, secondary, head, tree, unit, events, receipts, findings, gaps, gates,
    requiredLanes, highRisk,
    reuseEvents: events.filter((event) => event.event === "reuse"),
    frozenHead: wish.frozen_head,
  };
  return { ...context, lanes: laneState(context) };
}

// §11 'blocking': strings in a stable order, so two statuses differ only where
// facts differ. WARN never appears (M0 §4.1) and SKIP never satisfies a lane.
export function blockingFor(context) {
  const { lanes, findings, gates, events, unit, frozenHead, head } = context;
  const reasons = [];
  // A lane only blocks once the unit has reached the verify wave: before that
  // the wave has not been dispatched, so a missing lane is not an obstacle.
  const laneRelevant = STAGE_ORDER.indexOf(context.stage ?? "intake") >= STAGE_ORDER.indexOf("verify_lane")
    || lanes.satisfied.length > 0 || lanes.stale.length > 0;
  if (laneRelevant) {
    for (const entry of lanes.stale) {
      reasons.push((entry.skip ? "receipt-skip:" : "receipt:").concat(entry.name));
    }
    for (const lane of lanes.missing) reasons.push("receipt-missing:".concat(lane));
  }
  const open = blockingFindings(findings);
  if (open.length > 0) reasons.push("findings:".concat(String(open.length), " open"));
  // Two sources, one meaning: an owner question parked in gates.md, and a lane
  // gate (the dispatch table) whose last event is open. The later event wins.
  const openGates = new Set(gates.filter((entry) => entry.status === "open").map((entry) => entry.id));
  const latestByGate = new Map();
  for (const event of events) {
    // Another unit's dispatch gate is not this unit's obstacle, and its resolution
    // must not clear this unit's open gate.
    if (event.event === "gate" && event.unit === unit && typeof event.gate_id === "string") {
      latestByGate.set(event.gate_id, event.gate_status);
    }
  }
  for (const [id, status] of latestByGate) {
    if (status === "open") openGates.add(id);
  }
  for (const id of [...openGates].sort()) reasons.push("gate:".concat(id, " open"));
  const rounds = roundsOf(events, unit);
  const last = rounds[rounds.length - 1];
  if (frozenHead) {
    if (!last) reasons.push("verdict:missing");
    else if (last.head !== frozenHead) {
      reasons.push("verdict:round ".concat(String(last.round), " head does not cover ", frozenHead.slice(0, 7)));
    }
  }
  if (frozenHead && head && frozenHead !== head) reasons.push("head:moved");
  if (last && last.verdict === "REVISE" && last.round >= 3
      && !switchesOf(events, unit).some((event) => event.round === last.round)) {
    reasons.push("round:".concat(String(last.round), " needs an approach switch"));
  }
  return reasons;
}

// Completeness per stage: what 'resume-plan' and the first-invalid answer need.
function stageComplete(stage, context) {
  const { events, unit, gaps, lanes, frozenHead, head } = context;
  const has = (name, predicate) => events.some((event) => event.unit === unit && event.event === name
    && (!predicate || predicate(event)));
  switch (stage) {
    case "intake": return has("intake");
    case "discover": return has("discover");
    case "lens": return !stageApplies("lens", context) || has("lens");
    case "ideal": return !stageApplies("ideal", context) || has("ideal");
    case "gap": return !stageApplies("gap", context) || has("gap");
    case "before": return !stageApplies("before", context)
      || defectGaps(gaps).every((row) => row.before_artifact !== "-");
    case "plan": return has("plan");
    case "plan_lint": return has("plan_lint");
    case "plan_review": return has("plan_review", (event) => event.verdict === "OKAY");
    case "goal": return has("goal");
    case "build": return !stageApplies("build", context) || has("build");
    case "verify_lane": return lanes.ok;
    case "triage": return has("triage");
    case "fix": return !stageApplies("fix", context) || has("fix");
    case "freeze": return Boolean(frozenHead) && has("freeze") && (!head || frozenHead === head);
    case "pr_open": return has("pr_open");
    case "round": return has("round");
    case "merge": return has("merge");
    case "post_merge": return has("post_merge");
    case "checkpoint": return has("checkpoint", (event) => event.checkpoint_op === "complete");
    case "cleanup": return isDone(events, unit);
    default: return false;
  }
}

export function firstInvalidStage(context) {
  for (const stage of STAGE_ORDER) {
    if (!stageApplies(stage, context)) continue;
    if (!stageComplete(stage, context)) return stage;
  }
  return "done";
}

function unitStatus(context) {
  const stage = deriveStage(context.events, context.receipts, context.unit);
  const enriched = { ...context, stage };
  const rounds = roundsOf(context.events, context.unit);
  const last = rounds[rounds.length - 1];
  const prSources = [...context.events].reverse().filter((event) => event.unit === context.unit
    && ((event.event === "pr_open" && Number.isInteger(event.pr)) || (event.event === "freeze" && Number.isInteger(event.pr))));
  return {
    id: context.unit,
    stage,
    pr: prSources.length > 0 ? prSources[0].pr : null,
    round: last ? last.round : 0,
    switches: switchesOf(context.events, context.unit).length,
    next: deriveNext(stage, enriched),
    blocking: blockingFor(enriched),
    firstInvalid: firstInvalidStage(enriched),
  };
}

// --------------------------------------------------------------- the status

// §11. 'head'/'tree' are what the caller observed in the unit's worktree; the
// derivation itself is pure, so a test can pin it without a repository.
export function computeStatus({ root, planPath, head = null, tree = null }) {
  const plan = readPlan(planPath);
  const events = readLedger(root);
  const sequence = pendingSwitchErrors(events);
  if (sequence.length > 0) throw stateMismatch("the ledger is not a valid sequence", sequence);
  const receipts = listReceipts(root);
  // A mixed run's class set is the union of its two types (ledger.md §5.1), and the
  // labels travel on the events, so the table cannot be parsed without them.
  const unit = plan.wish.unit ?? "u1";
  const labels = [...events].reverse().find((event) => event.unit === unit
    && typeof event.primary === "string" && typeof event.secondary === "string");
  const findingOptions = { type: plan.wish.type, primary: labels?.primary, secondary: labels?.secondary };
  const findings = readFindings(root, findingOptions) ?? [];
  const gaps = readGaps(root);
  const gates = readGates(root);

  const units = [];
  for (const event of events) {
    if (typeof event.unit === "string" && !units.includes(event.unit)) units.push(event.unit);
  }
  if (units.length === 0) units.push(plan.wish.unit ?? "u1");

  const observedHead = head ?? [...events].reverse().find((event) => typeof event.head === "string")?.head ?? null;
  const observedTree = tree ?? [...events].reverse().find((event) => typeof event.tree === "string")?.tree ?? null;

  const contexts = units.map((unit) => buildContext({
    root, plan, events, receipts, findings, gaps, gates, head: observedHead, tree: observedTree, unit,
  }));
  const current = contexts.find((context) => context.unit === plan.wish.unit) ?? contexts[0];
  const unitStates = contexts.map((context) => unitStatus(context));
  const currentState = unitStates[contexts.indexOf(current)];

  const valid = [];
  const stale = [];
  for (const receipt of receipts) {
    const verdict = judgeReceipt(receipt, {
      type: current.identity, head: observedHead, tree: observedTree, reuseEvents: current.reuseEvents,
    });
    (verdict.valid ? valid : stale).push(receipt.name);
  }

  const progress = computeProgress({ events, gaps, gates, units, contexts, unitStates, current });
  const status = {
    run_id: plan.wish.run_id,
    stage: currentState.stage,
    type: plan.wish.type,
    tier: plan.wish.tier,
    head: observedHead,
    tree: observedTree,
    round: unitStates.reduce((max, entry) => Math.max(max, entry.round), 0),
    valid_receipts: valid,
    stale_receipts: stale,
    blocking: currentState.blocking,
    next: currentState.next,
    units: unitStates.map((entry) => ({
      id: entry.id, stage: entry.stage, pr: entry.pr, round: entry.round, switches: entry.switches,
    })),
    wave: { k: contexts.indexOf(current) + 1, n: contexts.length },
    progress,
  };
  const checked = validateStatusJson(status);
  if (!checked.ok) throw checkFailed("the status object does not match the M0 contract", checked.errors);
  return { status, plan, events, receipts, findings, gaps, gates, contexts, unitStates };
}

function computeProgress({ events, gaps, gates, units, contexts, unitStates, current }) {
  const done = unitStates.filter((entry) => entry.stage === "done").length;
  const defects = defectGaps(gaps);
  const merged = units.filter((unit) => events.some((event) => event.event === "merge" && event.unit === unit)).length;
  const open = units.filter((unit) => events.some((event) => event.event === "pr_open" && event.unit === unit)
    && !events.some((event) => event.event === "merge" && event.unit === unit)).length;
  const lastRound = unitStates.reduce((max, entry) => Math.max(max, entry.round), 0);
  const switching = events.filter((event) => event.event === "switch").length;
  const openGate = gates.find((gate) => gate.status === "open");
  const pr = unitStates.find((entry) => entry.pr !== null)?.pr ?? null;
  const awaitingVerdict = unitStates.some((entry) => entry.next === "round" || entry.next === "switch");
  const awaitingMerge = unitStates.some((entry) => entry.next === "merge");
  let waiting = "none";
  if (openGate) waiting = "gate ".concat(openGate.id);
  else if (awaitingVerdict) waiting = "verdict on ".concat(pr === null ? "the frozen head" : "#".concat(String(pr)));
  else if (awaitingMerge) waiting = "merge go on #".concat(String(pr));
  return {
    units_done: done,
    units_total: units.length,
    gaps_fixed: defects.filter((row) => row.status === "fixed").length,
    gaps_total: gaps === null ? null : defects.length,
    prs_merged: merged,
    prs_open: open,
    wave_k: contexts.indexOf(current) + 1,
    wave_n: contexts.length,
    round: lastRound,
    switch: switching,
    waiting,
  };
}

export function progressLine(status, pr) {
  return formatProgressLine({
    run_id: status.run_id,
    ...status.progress,
    pr: pr === null || pr === undefined ? null : "#".concat(String(pr)),
  });
}

// ---------------------------------------------------------------- resume plan

// §2.9: the first invalid stage plus the actions that clear it. 'status' says
// what is true; 'resume-plan' says where to start again.
export function resumePlan({ status, contexts, unitStates, unit }) {
  void contexts;
  // One unit's answer must name that unit's own missing step: a sibling's state is
  // not a resume instruction.
  const state = unitStates.find((entry) => entry.id === unit) ?? unitStates[0];
  const firstInvalid = state ? state.firstInvalid : "intake";
  const actions = [];
  for (const reason of status.blocking) {
    if (reason.startsWith("receipt-missing:")) {
      actions.push("run the ".concat(reason.slice("receipt-missing:".length), " lane at ",
        String(status.head ?? "the frozen head").slice(0, 7)));
    } else if (reason.startsWith("receipt-skip:")) {
      actions.push("re-run the skipped lane ".concat(reason.slice("receipt-skip:".length)));
    } else if (reason.startsWith("receipt:")) {
      actions.push("re-run the stale lane receipt ".concat(reason.slice("receipt:".length)));
    } else if (reason.startsWith("findings:")) {
      actions.push("fix the blocking findings, then findings set --status fixed --fixed-head <sha>");
    } else if (reason.startsWith("gate:")) {
      actions.push("answer ".concat(reason.slice(4).replace(/ open$/, ""), " with gate resolve"));
    } else if (reason.startsWith("verdict:")) {
      actions.push("dispatch the final review on the frozen head");
    } else if (reason === "head:moved") {
      actions.push("freeze the new head, or rebase back to the frozen one");
    } else {
      actions.push(reason);
    }
  }
  return { firstInvalid, next: status.next, blocking: status.blocking, actions: [...new Set(actions)] };
}
