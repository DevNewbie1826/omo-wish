import { GAPS_COLUMNS, FINDINGS_COLUMNS, parseFindingsTsv, parseGapsTsv } from "../schema.mjs";
import { renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { usage, stateMismatch, ensureDir, readTextOrNull, atomicWrite, writeSyncFile, basename, rootPaths } from "./core.mjs";
import { sleepSync } from "./lock.mjs";

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

export { FINDING_TRANSITIONS, GAP_TRANSITIONS, mutateText, normalizeRows, renderTsv, rowsFromText, tsvCell };
