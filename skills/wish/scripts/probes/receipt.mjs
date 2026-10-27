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

// A path names a directory when it is an existing directory, ends with a
// separator, or its basename has no dot; the file inside then takes the canonical
// <stage>-<lane>-<head7>.json that M0 §4.2 requires. Any other path is written
// exactly as given (a caller inspecting a run may want a scratch name), and its
// body is validated either way; the filename agreement is checked whenever the
// name parses.
export function writeReceipt(pathArg, receipt) {
  const resolved = resolve(pathArg);
  const given = String(pathArg);
  const name = basename(resolved);
  const isDir = (existsSync(resolved) && statSync(resolved).isDirectory())
    || given.endsWith("/")
    || !name.includes(".");
  const path = isDir
    ? join(resolved, receiptFilename({ stage: "verify_lane", lane: receipt.lane, head: receipt.head }))
    : resolved;
  receipt.artifacts = [path];
  const body = validateReceipt(receipt);
  const finalName = basename(path);
  const named = parseReceiptFilename(finalName).ok ? validateReceiptAgainstFilename(receipt, finalName) : { ok: true, errors: [] };
  const errors = [...body.errors, ...named.errors];
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`sweep: receipt ${error.path}: ${error.message}\n`);
    return { ok: false, path };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
  return { ok: true, path };
}