#!/usr/bin/env bun
// wish v2 — module M7: experiment metrics.
//
// Generates and validates the two shared CSV files of the wish experiment
// ledger (`measurements.csv`, `rounds.csv`), and detects post-merge refixes.
// The shapes come from M0 (`scripts/lib/schema.mjs`): the ported #43 columns
// first, then the v2 suffix, never reordered. This script computes and checks;
// the session owns the numbers it passes in and the files it writes.
//
// Everything is derived or empty. A cell the input does not contain stays
// empty: this tool never turns a missing measurement into a zero.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { spawn } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import {
  MEASUREMENTS_COLUMNS, ROUNDS_COLUMNS, V2_MEASUREMENTS_SUFFIX, V2_ROUNDS_SUFFIX,
  SWITCH_KINDS, WORK_TYPES, headErrors, parseFindingsTsv, parseGapsTsv,
  validateCsvHeader, validateLedgerEvent,
} from "./lib/schema.mjs";

export const MEASUREMENTS_HEADER = Object.freeze([...MEASUREMENTS_COLUMNS, ...V2_MEASUREMENTS_SUFFIX]);
export const ROUNDS_HEADER = Object.freeze([...ROUNDS_COLUMNS, ...V2_ROUNDS_SUFFIX]);
export const ROUND_KINDS = Object.freeze(["first", "revise", "delta", "gate-blocked"]);
export const FINDING_SCOPES = Object.freeze(["prod", "test", "plan", "mixed", "none"]);
export const BIT_COLUMNS = Object.freeze(["invalid_flag", "counterexample_present", "axis_lines_present", "verdict_line_present", "verdict_head_match"]);
export const INT_COLUMNS = Object.freeze({
  pr: 1, rounds_total: 0, ultrabrain_calls: 0, code_reviewer_calls: 0, architect_calls: 0,
  content_commits_after_approval: 0, switch_count: 0, rounds_after_switch: 0, lens_rules: 0,
  gaps_total: 0, gaps_fixed: 0, before_receipts: 0, round_index: 1, defect_count: 0,
  gate_rows_fixed: 0, gate_rows_not_fixed: 0, gate_rows_no_command: 0,
});
export const NUMBER_COLUMNS = Object.freeze({ open_to_merge_min: 0, minutes: 0 });
export const MULTI_VALUE_COLUMNS = Object.freeze(["switch_kinds", "defect_axes"]);

const USAGE = `metrics.mjs — wish v2 experiment metrics (measurements.csv, rounds.csv)

Verbs:
  export    derive rows from <ER>/ledger.jsonl and write both CSV files
  validate  check a CSV file (or a directory holding both) against the contract
  post-merge count commits after a merge that touch the merged PR's files

Usage:
  bun metrics.mjs export --ledger <path> [--findings <path>] [--gaps <path>]
                         [--out <dir>] [--unit <id>] [--repo <owner/name>]
                         [--arm <name>] [--extra <json>] [--json]
  bun metrics.mjs validate (--file <path> --name measurements|rounds | --dir <dir>) [--json]
  bun metrics.mjs post-merge --merged-at <iso> (--files <a,b> | --merge-sha <sha>)
  [--merge-sha <sha>]
                         --repo-dir <dir> [--ref HEAD] [--days 7]
                         [--max-commits <n>]   (0 = no cap; default 0)
                         [--from-json <path>] [--json]
  bun metrics.mjs --help

Contract: headers are M0's MEASUREMENTS_COLUMNS + V2_MEASUREMENTS_SUFFIX and
ROUNDS_COLUMNS + V2_ROUNDS_SUFFIX. Cells are RFC 4180 quoted; a multi-valued
cell joins with ";". An absent measurement is an empty cell, never 0.

Exit: 0 ok · 1 check failed (invalid file, refix found) · 2 usage · 3 unusable state
`;

// ------------------------------------------------------------------ CSV

export function parseCsv(text) {
  const errors = [];
  const source = String(text ?? "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 2; continue; }
        quoted = false; afterQuote = true; index += 1; continue;
      }
      field += char; index += 1; continue;
    }
    if (afterQuote) {
      if (char === ",") { row.push(field); field = ""; afterQuote = false; index += 1; continue; }
      if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; afterQuote = false; index += 1; continue; }
      if (char === "\r") {
        row.push(field); rows.push(row); row = []; field = ""; afterQuote = false;
        index += source[index + 1] === "\n" ? 2 : 1;
        continue;
      }
      errors.push({ path: `row[${rows.length}]`, message: "unexpected character after a closing quote" });
      afterQuote = false;
      field += char; index += 1; continue;
    }
    if (char === '"') {
      if (field !== "") errors.push({ path: `row[${rows.length}]`, message: "unexpected quote in an unquoted cell" });
      quoted = true; index += 1; continue;
    }
    if (char === ",") { row.push(field); field = ""; index += 1; continue; }
    if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; index += 1; continue; }
    if (char === "\r") {
      row.push(field); rows.push(row); row = []; field = "";
      index += source[index + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += char; index += 1;
  }
  if (quoted) errors.push({ path: "csv", message: "unterminated quoted cell" });
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  const records = rows.filter((cells) => !(cells.length === 1 && cells[0] === ""));
  return { ok: errors.length === 0, header: records[0] ?? [], rows: records.slice(1), errors };
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function formatCsv(header, rows) {
  return `${[header, ...rows].map((cells) => cells.map(csvCell).join(",")).join("\n")}\n`;
}

// --------------------------------------------------------------- validation

function rowErrors(name, row, path) {
  const errors = [];
  const fail = (column, message) => errors.push({ path: `${path}.${column}`, message });
  for (const [column, min] of Object.entries(INT_COLUMNS)) {
    if (!(column in row)) continue;
    const value = row[column];
    if (value === "") continue;
    if (!/^(0|[1-9][0-9]*)$/.test(value) || Number(value) < min) fail(column, `expected an integer >= ${min} or empty`);
  }
  for (const [column, min] of Object.entries(NUMBER_COLUMNS)) {
    if (!(column in row) || row[column] === "") continue;
    if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(row[column]) || Number(row[column]) < min) {
      fail(column, `expected a number >= ${min} or empty`);
    }
  }
  if ("pr" in row && row.pr === "") fail("pr", "every row names its PR");
  if (name === "rounds" && row.round_index === "") fail("round_index", "every round row names its index");
  if ("round_kind" in row && row.round_kind !== "" && !ROUND_KINDS.includes(row.round_kind)) {
    fail("round_kind", `expected one of ${ROUND_KINDS.join("|")}`);
  }
  if ("type" in row && row.type !== "" && !WORK_TYPES.includes(row.type)) fail("type", `expected one of ${WORK_TYPES.join("|")}`);
  if ("finding_scope" in row && row.finding_scope !== "" && !FINDING_SCOPES.includes(row.finding_scope)) {
    fail("finding_scope", `expected one of ${FINDING_SCOPES.join("|")}`);
  }
  for (const column of BIT_COLUMNS) {
    if (column in row && row[column] !== "" && !["0", "1"].includes(row[column])) fail(column, "expected 0, 1 or empty");
  }
  if ("switch_kinds" in row && row.switch_kinds !== "") {
    const kinds = row.switch_kinds.split(";");
    for (const kind of kinds) {
      if (!SWITCH_KINDS.includes(kind)) fail("switch_kinds", `unknown switch kind ${kind}`);
    }
    if (new Set(kinds).size !== kinds.length) fail("switch_kinds", "a kind repeats");
  }
  if ("verdict_head" in row && row.verdict_head !== "") {
    const type = row.type === "" || row.type === undefined ? "code" : row.type;
    const accepted = type === "mixed"
      ? headErrors("code", row.verdict_head).length === 0 || headErrors("research", row.verdict_head).length === 0
      : headErrors(type, row.verdict_head).length === 0;
    if (!accepted) fail("verdict_head", "expected the row type's head form (40 hex; 64 for research; either for mixed)");
  }
  if ("gaps_total" in row && "gaps_fixed" in row && row.gaps_total !== "" && row.gaps_fixed !== ""
      && Number(row.gaps_fixed) > Number(row.gaps_total)) {
    fail("gaps_fixed", "exceeds gaps_total");
  }
  return errors;
}

export function validateFile(name, text) {
  if (!["measurements", "rounds"].includes(name)) {
    return { ok: false, header: [], rows: [], errors: [{ path: "csv", message: "expected measurements or rounds" }] };
  }
  const parsed = parseCsv(text);
  const errors = [...parsed.errors];
  if (parsed.header.length === 0) return { ok: false, header: [], rows: [], errors: [...errors, { path: "csv.header", message: "missing header" }] };
  const headerCheck = validateCsvHeader(name, parsed.header.join(","));
  if (!headerCheck.ok) errors.push(...headerCheck.errors);
  const header = parsed.header;
  parsed.rows.forEach((cells, index) => {
    const path = `row[${index + 1}]`;
    if (cells.length !== header.length) {
      errors.push({ path, message: `expected ${header.length} columns, got ${cells.length}` });
      return;
    }
    const row = Object.fromEntries(header.map((column, cellIndex) => [column, cells[cellIndex]]));
    errors.push(...rowErrors(name, row, path));
  });
  return { ok: errors.length === 0, header, rows: parsed.rows, errors };
}

function rowsOf(parsed) {
  return parsed.rows.map((cells) => Object.fromEntries(parsed.header.map((column, index) => [column, cells[index]])));
}

export function validateDir(files) {
  const errors = [];
  const measurements = validateFile("measurements", files.measurements ?? "");
  const rounds = validateFile("rounds", files.rounds ?? "");
  errors.push(...measurements.errors.map((entry) => ({ ...entry, path: `measurements.${entry.path}` })));
  errors.push(...rounds.errors.map((entry) => ({ ...entry, path: `rounds.${entry.path}` })));
  const measurementRows = rowsOf(measurements);
  const roundRows = rowsOf(rounds);
  const prs = new Set(measurementRows.map((row) => row.pr));
  const seen = new Set();
  roundRows.forEach((row, index) => {
    const path = `rounds.row[${index + 1}]`;
    if (!prs.has(row.pr)) errors.push({ path: `${path}.pr`, message: "no measurements row names this PR" });
    const key = `${row.pr}#${row.round_index}`;
    if (seen.has(key)) errors.push({ path: `${path}.round_index`, message: "duplicate PR and round index" });
    seen.add(key);
  });
  measurementRows.forEach((row, index) => {
    if (row.rounds_total === "") return;
    const actual = roundRows.filter((entry) => entry.pr === row.pr).length;
    if (Number(row.rounds_total) !== actual) {
      errors.push({ path: `measurements.row[${index + 1}].rounds_total`, message: `says ${row.rounds_total}, rounds.csv has ${actual}` });
    }
  });
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------- derivation

const roundOf = (event) => (Number.isInteger(event.round) ? event.round : null);

function minutesBetween(from, to) {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  return ((end - start) / 60000).toFixed(1);
}

function findingScope(rows) {
  const paths = rows.map((row) => String(row.file_line).split(":")[0]).filter((path) => path && path !== "-");
  if (paths.length === 0) return "none";
  const isTest = (path) => /(^|\/)(test|tests|qa|__tests__)\//.test(path) || /\.(test|spec)\.[a-z]+$/.test(path) || /_test\.go$/.test(path);
  const isPlan = (path) => /(^|\/)(docs|plans|\.omo)\//.test(path) || /\.md$/.test(path);
  if (paths.every(isTest)) return "test";
  if (paths.every(isPlan)) return "plan";
  if (paths.some(isTest) || paths.some(isPlan)) return "mixed";
  return "prod";
}

function applyExtra(values, overrides, columns, errors, path) {
  for (const [column, value] of Object.entries(overrides ?? {})) {
    if (!columns.includes(column)) {
      errors.push({ path: `${path}.${column}`, message: "not a column of this file" });
      continue;
    }
    if (value === null || value === undefined) { values[column] = ""; continue; }
    values[column] = String(value);
  }
}

export function deriveRows({ events = [], findings = [], gaps = [], extra = {}, options = {} }) {
  const errors = [];
  events.forEach((event, index) => {
    const checked = validateLedgerEvent(event);
    checked.errors.forEach((entry) => errors.push({ path: `ledger[${index}]${entry.path.replace(/^event/, "")}`, message: entry.message }));
  });
  if (errors.length > 0) return { ok: false, errors };
  const units = [...new Set(events.map((event) => event.unit))];
  const unit = options.unit ?? (units.length === 1 ? units[0] : null);
  if (!unit) return { ok: false, errors: [{ path: "ledger", message: "multiple units in one ledger; pass --unit" }] };
  const scoped = events.filter((event) => event.unit === unit);
  const first = scoped[0] ?? {};
  const type = options.type ?? first.type;
  const programId = options.program_id ?? first.program_id ?? null;
  const prOpen = scoped.find((event) => event.event === "pr_open" && Number.isInteger(event.pr));
  const merge = [...scoped].reverse().find((event) => event.event === "merge");
  const pr = options.pr ?? merge?.pr ?? prOpen?.pr ?? null;
  if (!pr) return { ok: false, errors: [{ path: "ledger", message: "no pr_open or merge event names a PR" }] };

  const rounds = scoped.filter((event) => event.event === "round" && roundOf(event) !== null)
    .sort((left, right) => left.round - right.round);
  const verdicts = scoped.filter((event) => event.event === "verdict");
  const switches = scoped.filter((event) => event.event === "switch" && roundOf(event) !== null)
    .sort((left, right) => left.round - right.round);
  const firstSwitch = switches.length > 0 ? switches[0].round : null;
  const lens = [...scoped].reverse().find((event) => event.event === "lens");
  const postMerge = [...scoped].reverse().find((event) => event.event === "post_merge");
  const registerSupplied = gaps.length > 0;
  const defectGaps = gaps.filter((row) => row.kind === "defect");
  const openedAt = prOpen?.started_at ?? "";
  const mergedAt = merge?.merged_at ?? "";
  const openMinutes = openedAt && mergedAt ? minutesBetween(openedAt, mergedAt) : "";
  if (openedAt && mergedAt && openMinutes === "") {
    return { ok: false, errors: [{ path: "ledger", message: "merged_at precedes pr_open.started_at" }] };
  }
  const beforeEvents = scoped.filter((event) => event.event === "before");

  const measurementsValues = {
    pr: String(pr), repo: options.repo ?? "", arm: options.arm ?? "v2",
    common_arms: "", route_class: "", size_bucket: "", stacked_on: "",
    opened_at: openedAt, merged_at: mergedAt, open_to_merge_min: String(openMinutes),
    rounds_total: String(rounds.length), ultrabrain_calls: String(verdicts.length),
    code_reviewer_calls: String(scoped.filter((event) => event.event === "verify_lane" && event.lane === "code-review").length),
    architect_calls: String(scoped.filter((event) => event.event === "plan_review").length
      + switches.filter((event) => event.kind === "premise").length),
    content_commits_after_approval: "", step12_result: postMerge?.verdict ?? "",
    post_merge_refix: "", blind_rereview: "", invalid_flag: "", notes: "",
    type, unit, program_id: programId ?? "",
    switch_count: String(switches.length),
    rounds_after_switch: firstSwitch === null ? "" : String(rounds.filter((event) => event.round > firstSwitch).length),
    lens_rules: lens ? String(lens.rules_total) : "",
    gaps_total: registerSupplied ? String(defectGaps.length) : "",
    gaps_fixed: registerSupplied ? String(defectGaps.filter((row) => row.status === "fixed").length) : "",
    before_receipts: String(beforeEvents.length),
  };
  applyExtra(measurementsValues, extra.measurements, MEASUREMENTS_HEADER, errors, "extra.measurements");

  const roundsRows = rounds.map((event) => {
    const roundNumber = event.round;
    const roundFindings = findings.filter((row) => String(row.round) === String(roundNumber));
    const priorFindings = roundNumber > 1 ? findings.filter((row) => String(row.round) === String(roundNumber - 1)) : [];
    // The latest gate event for an id before the round decides: an open after a
    // resolve re-opens it.
    const gatesBefore = new Map();
    for (const other of scoped) {
      if (other.event !== "gate" || Date.parse(other.started_at) > Date.parse(event.started_at)) continue;
      const current = gatesBefore.get(other.gate_id);
      if (!current || Date.parse(other.started_at) >= Date.parse(current.started_at)) gatesBefore.set(other.gate_id, other);
    }
    const gateBefore = [...gatesBefore.values()].some((gate) => gate.gate_status === "open");
    const cumulativeSwitches = switches.filter((item) => item.round <= roundNumber);
    const values = {
      pr: String(pr), round_index: String(roundNumber),
      round_kind: gateBefore ? "gate-blocked" : (roundNumber === 1 ? "first" : "revise"),
      verdict_head: event.head ?? "",
      dispatch_at: event.started_at,
      verdict_at: event.ended_at ?? "",
      minutes: event.duration_s !== undefined && event.duration_s !== null
        ? (event.duration_s / 60).toFixed(1)
        : (event.ended_at ? minutesBetween(event.started_at, event.ended_at) : ""),
      reviewer: event.category ?? event.agent ?? "",
      reviewer_family: event.model_family ?? "",
      defect_count: findings.length > 0 ? String(roundFindings.length) : "",
      defect_axes: findings.length > 0 ? [...new Set(roundFindings.map((row) => row.class))].sort().join(";") : "",
      finding_scope: findings.length > 0 ? findingScope(roundFindings) : "",
      counterexample_present: findings.length > 0
        ? (roundFindings.some((row) => row.repro_cmd && row.repro_cmd !== "no command") ? "1" : "0")
        : "",
      gate_rows_fixed: priorFindings.length > 0 ? String(priorFindings.filter((row) => row.status === "fixed").length) : "",
      gate_rows_not_fixed: priorFindings.length > 0 ? String(priorFindings.filter((row) => row.status === "not-fixed").length) : "",
      gate_rows_no_command: priorFindings.length > 0 ? String(priorFindings.filter((row) => row.status === "no-command").length) : "",
      c2_split: "", axis_lines_present: "", verdict_line_present: "", verdict_head_match: "",
      type, unit, program_id: programId ?? "",
      switch_count: String(cumulativeSwitches.length),
      switch_kinds: [...new Set(cumulativeSwitches.map((item) => item.kind))].join(";"),
    };
    return values;
  });
  for (const override of extra.rounds ?? []) {
    const index = roundsRows.findIndex((row) => row.round_index === String(override.round_index));
    if (index === -1) { errors.push({ path: `extra.rounds[${override.round_index}]`, message: "no such round" }); continue; }
    applyExtra(roundsRows[index], override, ROUNDS_HEADER, errors, `extra.rounds[${override.round_index}]`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true, errors: [], unit, pr, type,
    measurements: MEASUREMENTS_HEADER.map((column) => measurementsValues[column] ?? ""),
    rounds: roundsRows.map((row) => ROUNDS_HEADER.map((column) => row[column] ?? "")),
    skipped: Object.entries(measurementsValues).filter(([, value]) => value === "").map(([column]) => column),
  };
}

// --------------------------------------------------------------- post-merge

export function parseGitLog(text) {
  const commits = [];
  for (const chunk of String(text ?? "").split("\x1e")) {
    const raw = chunk.replace(/^\n+/, "");
    if (raw === "") continue;
    // `-z` output: header, then a newline, then NUL-separated file names. The
    // newline form is still accepted so a caller without -z keeps working.
    const parts = raw.split("\x00");
    const fields = parts[0].split("\x1f");
    if (fields.length < 3) continue;
    const [sha, committedAt] = fields;
    if (!/^[0-9a-f]{40}$/.test(sha) || !Number.isFinite(Date.parse(committedAt))) continue;
    const rest = fields.slice(2).join("\x1f");
    const newline = rest.indexOf("\n");
    const subject = newline === -1 ? rest : rest.slice(0, newline);
    const files = [];
    if (newline !== -1) {
      const tail = rest.slice(newline + 1);
      if (parts.length > 1) {
        if (tail !== "") files.push(tail);
      } else {
        files.push(...tail.split("\n").filter((file) => file !== ""));
      }
    }
    for (const file of parts.slice(1)) if (file !== "") files.push(file);
    commits.push({ sha, committed_at: committedAt, subject, files });
  }
  return commits;
}

export function postMergeRefixes({ mergedAt, files = [], commits = [], days = 7, mergeSha = null }) {
  const start = Date.parse(mergedAt);
  if (!Number.isFinite(start)) return { ok: false, errors: [{ path: "merged_at", message: "not an ISO timestamp" }] };
  if (!Number.isInteger(days) || days < 1) return { ok: false, errors: [{ path: "days", message: "expected an integer >= 1" }] };
  if (files.length === 0) return { ok: false, errors: [{ path: "files", message: "at least one merged file is required" }] };
  const end = start + days * 86400000;
  const wanted = new Set(files);
  const refixes = [];
  for (const commit of commits) {
    if (mergeSha && commit.sha === mergeSha) continue;
    const at = Date.parse(commit.committed_at);
    if (!Number.isFinite(at) || at <= start || at > end) continue;
    const touched = (commit.files ?? []).filter((file) => wanted.has(file));
    if (touched.length === 0) continue;
    refixes.push({ sha: commit.sha, committed_at: commit.committed_at, subject: commit.subject ?? "", files: touched });
  }
  return { ok: true, refixes, count: refixes.length, window: { from: new Date(start).toISOString(), to: new Date(end).toISOString(), days } };
}

export const GIT_OUTPUT_CAP_DEFAULT = 64 * 1024 * 1024;

export function runGit(args, timeoutMs = 30000, capBytes = GIT_OUTPUT_CAP_DEFAULT) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn("git", args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolvePromise({ ok: false, error: String(error?.message ?? error) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let overflow = false;
    let settled = false;
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolvePromise(result); };
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } finish({ ok: false, error: `git timed out after ${timeoutMs}ms` }); }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      // A silent cut would look like a clean scan that found nothing, so an
      // over-cap read is reported as an error instead of truncated output.
      if (stdout.length + chunk.length > capBytes) overflow = true;
      stdout = (stdout + chunk).slice(0, capBytes);
    });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(0, 1024 * 1024); });
    child.on("error", (error) => finish({ ok: false, error: String(error?.message ?? error) }));
    child.on("close", (code) => {
      if (overflow) {
        finish({ ok: false, overflow: true, error: `git output exceeded ${capBytes} bytes; narrow the scan with --max-commits` });
        return;
      }
      finish(code === 0 ? { ok: true, stdout } : { ok: false, error: stderr.trim() || `git exited with ${code}` });
    });
  });
}

// ------------------------------------------------------------------- CLI

function usageError(message, usage = USAGE) {
  return { ok: false, errors: [{ path: "usage", message }], usage };
}

export function parseArgs(argv = []) {
  const verb = argv[0];
  const options = { verb, help: false, json: false, values: {} };
  if (verb === undefined) return { ok: false, errors: [{ path: "usage", message: "missing verb" }], usage: USAGE };
  if (verb === "--help" || verb === "-h") return { ok: true, options: { ...options, help: true }, errors: [], usage: USAGE };
  const known = {
    export: ["--ledger", "--findings", "--gaps", "--out", "--unit", "--repo", "--arm", "--type", "--program-id", "--extra", "--json"],
    validate: ["--file", "--name", "--dir", "--json"],
    "post-merge": ["--merged-at", "--files", "--merge-sha", "--repo-dir", "--ref", "--days", "--max-commits", "--from-json", "--pr", "--json"],
  }[verb];
  if (!known) return usageError(`unknown verb: ${verb}`);
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") { options.json = true; continue; }
    if (!known.includes(arg)) return usageError(`unknown option for ${verb}: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined) return usageError(`missing value for ${arg}`);
    options.values[arg.slice(2)] = value;
    index += 1;
  }
  if (verb === "export" && !options.values.ledger) return usageError("export requires --ledger");
  if (verb === "validate" && !options.values.file && !options.values.dir) return usageError("validate requires --file or --dir");
  if (verb === "validate" && options.values.file && options.values.dir) return usageError("validate takes --file or --dir, not both");
  if (verb === "validate" && options.values.name !== undefined && !["measurements", "rounds"].includes(options.values.name)) {
    return usageError("--name must be measurements or rounds");
  }
  if (verb === "post-merge") {
    if (!options.values["merged-at"]) return usageError("post-merge requires --merged-at");
    if (!options.values.files && !options.values["merge-sha"] && !options.values["from-json"]) {
      return usageError("post-merge requires --files, --merge-sha or --from-json");
    }
    if (options.values.files && options.values["merge-sha"]) return usageError("post-merge takes --files or --merge-sha, not both");
  }
  return { ok: true, options, errors: [], usage: USAGE };
}

function readText(path) {
  try {
    return { ok: true, text: readFileSync(path, "utf8") };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
}

function emitJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function exportVerb(options) {
  const values = options.values;
  const ledgerRead = readText(values.ledger);
  if (!ledgerRead.ok) return { code: 3, body: { ok: false, errors: [{ path: "ledger", message: ledgerRead.error }] } };
  const events = [];
  const errors = [];
  ledgerRead.text.replace(/\r\n?/g, "\n").split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    try { events.push(JSON.parse(line)); } catch { errors.push({ path: `ledger[${index}]`, message: "not JSON" }); }
  });
  if (errors.length > 0) return { code: 1, body: { ok: false, errors } };
  const findingsRead = values.findings ? readText(values.findings) : null;
  const gapsRead = values.gaps ? readText(values.gaps) : null;
  if (findingsRead && !findingsRead.ok) return { code: 3, body: { ok: false, errors: [{ path: "findings", message: findingsRead.error }] } };
  if (gapsRead && !gapsRead.ok) return { code: 3, body: { ok: false, errors: [{ path: "gaps", message: gapsRead.error }] } };
  const type = values.type ?? events[0]?.type;
  // The findings' class set belongs to the unit being measured, not to whichever
  // event happens to be first in the ledger.
  const units = [...new Set(events.map((event) => event.unit))];
  const scopeUnit = values.unit ?? (units.length === 1 ? units[0] : null);
  const scopeEvents = scopeUnit === null ? events : events.filter((event) => event.unit === scopeUnit);
  const scopeType = values.type ?? scopeEvents[0]?.type ?? type;
  const findings = findingsRead
    ? parseFindingsTsv(findingsRead.text, {
      type: scopeType, primary: scopeEvents[0]?.primary, secondary: scopeEvents[0]?.secondary,
    })
    : { ok: true, rows: [], errors: [] };
  const gaps = gapsRead ? parseGapsTsv(gapsRead.text) : { ok: true, rows: [], errors: [] };
  const inputErrors = [...findings.errors.map((entry) => ({ ...entry, path: `findings.${entry.path}` })),
    ...gaps.errors.map((entry) => ({ ...entry, path: `gaps.${entry.path}` }))];
  if (inputErrors.length > 0) return { code: 1, body: { ok: false, errors: inputErrors } };
  let extra = {};
  if (values.extra) {
    const extraRead = readText(values.extra);
    if (!extraRead.ok) return { code: 3, body: { ok: false, errors: [{ path: "extra", message: extraRead.error }] } };
    try { extra = JSON.parse(extraRead.text); } catch { return { code: 1, body: { ok: false, errors: [{ path: "extra", message: "not JSON" }] } }; }
  }
  const derived = deriveRows({
    events, findings: findings.rows, gaps: gaps.rows, extra,
    options: {
      unit: values.unit, repo: values.repo, arm: values.arm, type: values.type,
      program_id: values["program-id"],
    },
  });
  if (!derived.ok) return { code: 1, body: { ok: false, errors: derived.errors } };
  // An override may not put a value outside its column's domain: the exported file
  // must pass the same validation a reader runs.
  const rowProblems = [
    ...rowErrors("measurements", Object.fromEntries(MEASUREMENTS_HEADER.map((column, index) => [column, derived.measurements[index]])), "measurements"),
    ...derived.rounds.flatMap((cells, index) => rowErrors("rounds", Object.fromEntries(ROUNDS_HEADER.map((column, columnIndex) => [column, cells[columnIndex]])), `rounds[${index + 1}]`)),
  ];
  if (rowProblems.length > 0) return { code: 1, body: { ok: false, errors: rowProblems } };
  const outDir = values.out ?? join(dirname(resolve(values.ledger)), "metrics");
  const measurementsPath = join(outDir, "measurements.csv");
  const roundsPath = join(outDir, "rounds.csv");
  try {
    writeText(measurementsPath, formatCsv([...MEASUREMENTS_HEADER], [derived.measurements]));
    writeText(roundsPath, formatCsv([...ROUNDS_HEADER], derived.rounds));
  } catch (error) {
    return { code: 1, body: { ok: false, errors: [{ path: "out", message: String(error?.message ?? error) }] } };
  }
  return {
    code: 0,
    body: {
      ok: true, unit: derived.unit, pr: derived.pr, type: derived.type,
      files: { measurements: measurementsPath, rounds: roundsPath },
      rows: { measurements: 1, rounds: derived.rounds.length }, empty_cells: derived.skipped,
    },
  };
}

function validateVerb(options) {
  const values = options.values;
  if (values.dir) {
    const measurements = readText(join(values.dir, "measurements.csv"));
    const rounds = readText(join(values.dir, "rounds.csv"));
    if (!measurements.ok || !rounds.ok) {
      return { code: 3, body: { ok: false, errors: [{ path: "dir", message: measurements.error ?? rounds.error }] } };
    }
    const result = validateDir({ measurements: measurements.text, rounds: rounds.text });
    return { code: result.ok ? 0 : 1, body: { ok: result.ok, errors: result.errors } };
  }
  const read = readText(values.file);
  if (!read.ok) return { code: 3, body: { ok: false, errors: [{ path: "file", message: read.error }] } };
  const base = basename(values.file);
  const inferred = values.name
    ?? (base.endsWith("measurements.csv") ? "measurements" : base.endsWith("rounds.csv") ? "rounds" : null);
  if (inferred === null) return { code: 2, body: { ok: false, errors: [{ path: "name", message: "pass --name measurements|rounds" }] } };
  const result = validateFile(inferred, read.text);
  return { code: result.ok ? 0 : 1, body: { ok: result.ok, file: values.file, name: inferred, rows: result.rows.length, errors: result.errors } };
}

async function postMergeVerb(options) {
  const values = options.values;
  const days = values.days === undefined ? 7 : Number(values.days);
  // 0 means no cap: a cap is an explicit choice, and a truncated scan is reported.
  const maxCommits = values["max-commits"] === undefined ? 0 : Number(values["max-commits"]);
  if (!Number.isInteger(days) || days < 1) return { code: 2, body: { ok: false, errors: [{ path: "days", message: "expected an integer >= 1" }] } };
  if (!Number.isInteger(maxCommits) || maxCommits < 0) return { code: 2, body: { ok: false, errors: [{ path: "max-commits", message: "expected an integer >= 0 (0 = no cap)" }] } };
  const mergedAt = values["merged-at"];
  if (!Number.isFinite(Date.parse(mergedAt))) return { code: 3, body: { ok: false, errors: [{ path: "merged_at", message: "not an ISO timestamp" }] } };
  if (values["from-json"]) {
    const read = readText(values["from-json"]);
    if (!read.ok) return { code: 3, body: { ok: false, errors: [{ path: "from-json", message: read.error }] } };
    let fixture;
    try { fixture = JSON.parse(read.text); } catch {
      return { code: 3, body: { ok: false, errors: [{ path: "from-json", message: "not JSON" }] } };
    }
    if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) {
      return { code: 3, body: { ok: false, errors: [{ path: "from-json", message: "expected a JSON object" }] } };
    }
    const result = postMergeRefixes({
      mergedAt: fixture.merged_at ?? mergedAt, files: fixture.files ?? [], commits: fixture.commits ?? [],
      days, mergeSha: fixture.merge_sha ?? null,
    });
    return { code: result.ok ? (result.count > 0 ? 1 : 0) : 3, body: { ok: result.ok, ...result, errors: result.errors ?? [] } };
  }
  const repoDir = resolve(values["repo-dir"] ?? ".");
  const ref = values.ref ?? "HEAD";
  // Git's ref rules without the revision-syntax characters: a real branch such as
  // `release+qa` is valid, while whitespace, NUL and `~^:?*[\` are not.
  if (ref.startsWith("-") || ref.includes("..") || ref.includes("@{") || /[\s\x00~^:?*\[\\]/.test(ref)) {
    return { code: 2, body: { ok: false, errors: [{ path: "ref", message: "invalid ref name" }] } };
  }
  let files = values.files ? values.files.split(",").filter((file) => file !== "") : [];
  const mergeSha = values["merge-sha"] ?? null;
  if (mergeSha !== null) {
    if (!/^[0-9a-f]{40}$/.test(mergeSha)) return { code: 2, body: { ok: false, errors: [{ path: "merge-sha", message: "expected a full 40-hex commit SHA" }] } };
    const listed = await runGit(["-C", repoDir, "diff-tree", "-z", "-r", "--no-commit-id", "--name-only", "-m", "--first-parent", mergeSha, "--"]);
    if (!listed.ok) return { code: 3, body: { ok: false, errors: [{ path: "merge-sha", message: listed.error }] } };
    files = [...new Set(listed.stdout.split("\x00").filter((name) => name !== ""))];
  }
  if (files.length === 0) return { code: 3, body: { ok: false, errors: [{ path: "files", message: "no merged files to check" }] } };
  // No --since/--until: git prunes traversal on committer dates, so a backdated
  // descendant can hide an eligible commit. The window is applied in code instead,
  // and --diff-merges=first-parent makes a merge show what it introduced.
  const cap = maxCommits > 0 ? [`--max-count=${maxCommits}`] : [];
  const log = await runGit(["-C", repoDir, "log", ...cap, "-z",
    "--diff-merges=first-parent", "--name-only", "--pretty=format:%x1e%H%x1f%cI%x1f%s", ref, "--"]);
  if (!log.ok) return { code: 3, body: { ok: false, errors: [{ path: "git", message: log.error }], overflow: log.overflow === true } };
  const commits = parseGitLog(log.stdout);
  if (maxCommits > 0 && commits.length >= maxCommits) {
    return {
      code: 3,
      body: { ok: false, errors: [{ path: "max-commits", message: `the scan stopped at the cap of ${maxCommits} commits; raise --max-commits or drop it` }], truncated: true },
    };
  }
  const result = postMergeRefixes({ mergedAt, files, commits, days, mergeSha });
  return {
    code: result.ok ? (result.count > 0 ? 1 : 0) : 3,
    body: { ok: result.ok, pr: values.pr === undefined ? null : Number(values.pr), files, ...result, errors: result.errors ?? [] },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`metrics: ${parsed.errors.map((entry) => entry.message).join("; ")}\n${parsed.usage}`);
    return 2;
  }
  if (parsed.options.help) { process.stdout.write(USAGE); return 0; }
  const verb = parsed.options.verb;
  const outcome = verb === "export" ? exportVerb(parsed.options)
    : verb === "validate" ? validateVerb(parsed.options)
      : await postMergeVerb(parsed.options);
  emitJson(outcome.body);
  if (outcome.body.ok === false && outcome.code === 0) return 1;
  return outcome.code;
}

if (import.meta.main === true) {
  main().then((code) => process.exit(code));
}