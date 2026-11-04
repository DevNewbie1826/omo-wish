import { GAPS_COLUMNS, GAP_STATUSES, parseGapsTsv } from "../schema.mjs";
import { realpathSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import { usage, checkFailed, stateMismatch, rootPaths } from "./core.mjs";
import { tsvCell, mutateText, rowsFromText, renderTsv, GAP_TRANSITIONS, normalizeRows } from "./tables.mjs";
import { listReceipts } from "./gates-receipts.mjs";

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
  // The capture this setGap binds, if any. The post-write verification must
  // affirm it, not just the patch's own fields: a same-status writer that slips
  // between the swap and the verify must not be able to discard the capture and
  // still have this mutation's verify succeed. Set by the compute callback on
  // every retry, so it always describes the text that was actually swapped.
  let boundBeforeArtifact = null;
  // A before/after capture is a real file under the evidence root's receipts
  // directory. A receipt named like a capture whose physical location escapes
  // that directory (a symlink to an outside file) is not a capture: binding it
  // would write a path that points outside <ER> into the register, which is the
  // same hazard the pr-body writer's containment guard refuses.
  const containedPath = (name) => {
    const path = join(paths.receipts, name);
    let real;
    try {
      real = realpathSync(path);
    } catch {
      return null; // dangling link or unreadable target: not a capture
    }
    let evidenceRootReal;
    let rootReal;
    try {
      evidenceRootReal = realpathSync(paths.root);
      rootReal = realpathSync(paths.receipts);
    } catch {
      return null; // the evidence or receipts directory disappeared: not a capture
    }
    const insideRoot = rootReal === evidenceRootReal || rootReal.startsWith(evidenceRootReal + sep);
    const insideReceipts = real === rootReal || real.startsWith(rootReal + sep);
    return insideRoot && insideReceipts ? path : null;
  };
  // Find the existing before receipt for this gap, if any. Its absolute path is
  // the only value that can satisfy the rule: a fixed defect row carries a real
  // pre-edit capture. A path that does not match a before-<id>-<tree7> receipt
  // is not a capture, and a made-up path must not be written into the register.
  // The selector binds the first receipt that is both valid and contained:
  // an earlier-sorting escaping symlink must not shadow a later, valid,
  // contained receipt.
  const beforeReceiptPath = () => {
    const receipts = listReceipts(root);
    for (const receipt of receipts) {
      if (!(receipt.parsed?.kind === "before" && receipt.parsed?.gap === id && receipt.ok)) continue;
      const path = containedPath(receipt.name);
      if (path !== null) return path;
    }
    return null;
  };
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
    // A non-open defect row must carry its pre-edit capture. When the row was
    // registered with before_artifact "-" and a before receipt now exists, bind
    // the receipt's absolute path into the row so the M0 rule can pass.
    // An explicit --before-artifact flag must name an existing receipt file; a
    // made-up path is refused, because a path that is not a receipt is not a capture.
    if (patch.beforeArtifact !== undefined || (row.kind === "defect" && row.status !== "open" && row.before_artifact === "-")) {
      const explicit = patch.beforeArtifact;
      let path;
      if (explicit !== undefined) {
        path = tsvCell(explicit, "--before-artifact");
        if (path === "-") {
          throw checkFailed(`gap ${id}: --before-artifact must name an existing before receipt, not "-"`);
        }
        // The explicit path must be an existing before-<id>-<tree7> receipt in the
        // evidence root; a file outside receipts/ or that does not parse as a
        // before receipt for this gap is not a capture. A gap may hold more than
        // one valid capture (several trees, several formats), so the selector
        // matches the requested path rather than the first receipt in sort order.
        // A relative path is not a location-independent capture: it is refused,
        // and the session must name the absolute receipt path instead.
        const receipts = listReceipts(root);
        const candidates = receipts.filter((receipt) =>
          receipt.parsed?.kind === "before" && receipt.parsed?.gap === id && receipt.ok
        ).map((receipt) => containedPath(receipt.name)).filter((entry) => entry !== null);
        if (!isAbsolute(path)) {
          throw checkFailed(`gap ${id}: --before-artifact must name an absolute receipt path`
            + (candidates.length > 0 ? `; the gap's before receipts are ${candidates.join(", ")}` : ""));
        }
        if (!candidates.includes(path)) {
          throw checkFailed(`gap ${id}: --before-artifact names no existing before receipt`
            + (candidates.length > 0 ? `; the gap's before receipts are ${candidates.join(", ")}` : ""));
        }
      } else {
        // No explicit flag: bind the existing before receipt automatically.
        path = beforeReceiptPath();
        if (path === null) {
          throw checkFailed(`gap ${id}: a non-open defect row needs a before receipt before it can move to ${row.status}`);
        }
      }
      row.before_artifact = path;
      boundBeforeArtifact = path;
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
    // A capture this setGap bound (automatic or explicit) must still be present
    // in the swapped bytes: a competing writer that cleared it while our status
    // patch held must not let this verification pass. An explicit --before-artifact
    // stores the canonical absolute receipt path, so the bound value, not the raw
    // flag value, is the value to confirm.
    if (boundBeforeArtifact !== null && row.before_artifact !== boundBeforeArtifact) return false;
    return true;
  });
  return updated;
}
