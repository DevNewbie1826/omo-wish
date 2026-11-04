import { isStr, fail, HEX, ID, COUNT, GAP } from "./primitives.mjs";
import { FINDINGS_COLUMNS, FINDINGS_SOURCES, FINDINGS_SEVERITIES, FINDINGS_STATUSES, GAPS_COLUMNS, GAP_KINDS, GAP_STATUSES, PRIMARY_TYPES } from "./constants.mjs";
import { classValid } from "./core.mjs";
import { parseReceiptFilename } from "./receipt.mjs";
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
