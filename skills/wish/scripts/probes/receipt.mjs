// The receipt surface of the sweep runner: build the M0 `kind: lane` object and
// write it only when the contract accepts it. Nothing here decides a check, so
// the runner keeps only dispatch and reporting.

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseReceiptFilename, receiptFilename, validateReceipt, validateReceiptAgainstFilename } from "../lib/schema.mjs";

function iso() {
  return new Date().toISOString();
}

export function buildReceipt({ opts, lane, head, tree, status, probes, ctx, startedAt }) {
  const receipt = {
    kind: "lane",
    stage: "verify_lane",
    type: opts.type,
    unit: opts.unit,
    program_id: opts.program ?? null,
    lane,
    head,
    tree,
    scope: opts.scope.length > 0 ? opts.scope : ["**"],
    started_at: startedAt,
    ended_at: iso(),
    status,
    rows: probes.flatMap((probe) => probe.rows),
    artifacts: [],
    cleanup: ctx.cleanupReceipts,
  };
  if (opts.type === "mixed") {
    receipt.primary = opts.primary;
    receipt.secondary = opts.secondary;
  }
  return receipt;
}

// A violation is a state mismatch (exit 3), never a silently broken artifact.
export function writeReceipt(pathArg, receipt) {
  let path = resolve(pathArg);
  if (existsSync(path) && statSync(path).isDirectory()) {
    path = join(path, receiptFilename({ stage: "verify_lane", lane: receipt.lane, head: receipt.head }));
  }
  receipt.artifacts = [path];
  const name = basename(path);
  const body = validateReceipt(receipt);
  const named = parseReceiptFilename(name).ok ? validateReceiptAgainstFilename(receipt, name) : { ok: true, errors: [] };
  const errors = [...body.errors, ...named.errors];
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`sweep: receipt ${error.path}: ${error.message}\n`);
    return { ok: false, path };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
  return { ok: true, path };
}