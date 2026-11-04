import { FINDINGS_COLUMNS, FINDINGS_STATUSES, parseFindingsTsv } from "../schema.mjs";
import { join } from "node:path";
import { usage, checkFailed, stateMismatch, rootPaths } from "./core.mjs";
import { tsvCell, mutateText, rowsFromText, renderTsv, FINDING_TRANSITIONS, normalizeRows } from "./tables.mjs";

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
