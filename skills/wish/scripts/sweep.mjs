#!/usr/bin/env bun
// wish v2 M3 — the pre-review defect-class sweep runner.
//
// One probe per measured defect class, one lane receipt per run, validated
// against M0 before it is written (`references/ledger.md` §4). The sweep adds
// work before the final review and never replaces a reviewer: its PASS is a
// claim to verify, and its FAIL is a claim the session reproduces before filing.
//
// Every command runs once. No retry, no sleep, no poll. At most 8 processes.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXIT_CODES, PRIMARY_TYPES, WORK_TYPES } from "./lib/schema.mjs";
import { PROBES } from "./probes/index.mjs";
import { DEFAULT_LANE, ctxFor, gitFacts, isMain, receiptStatus, row, summarise, sweepBudget } from "./probes/lib.mjs";
import { buildReceipt, writeReceipt } from "./probes/receipt.mjs";

const USAGE = `usage: bun sweep.mjs [--config <path>] [--root <dir>] [--probe <names>] [--lane <kebab>]
                      [--receipt <path|dir>] [--unit <id>] [--head <sha>] [--tree <sha>]
                      [--scope <glob>]... [--type <type>] [--primary <type>] [--secondary <type>]

  --config <path>     sweep config, relative to --root (default .wish-sweep.json)
  --root <dir>        project root every probe command runs in (default .)
  --probe <names>     comma-separated probes to run (default: every probe present in the config)
  --lane <kebab>      lane of the receipt (default sweep; a single --probe defaults to its own name)
  --receipt <path>    write the M0 lane receipt to a file, or into a directory as
                      verify_lane-<lane>-<head7>.json
  --unit <id>         the unit the receipt belongs to (required with --receipt)
  --head <sha>        frozen head; derived from git when omitted (a research-primary
                      run passes the 64-hex artifact sha256 instead)
  --tree <sha>        frozen tree; derived from git when omitted
  --scope <glob>      a path or glob the lane covered (repeatable; default **)
  --type <type>       code | design | research | audit | mixed (default code)
  --primary <type>    primary type of a mixed run
  --secondary <type>  secondary type of a mixed run
  --help              print this message

exit: 0 no row failed, 1 a row failed, 2 usage, 3 state mismatch (HEAD cannot be
derived, --head disagrees with the checkout, or the receipt would violate
references/ledger.md). Probes are runnable alone: bun probes/<name>.mjs --help.`;

const VALUE_FLAGS = {
  "--config": "config", "--root": "root", "--probe": "probe", "--lane": "lane", "--receipt": "receipt",
  "--unit": "unit", "--program": "program", "--head": "head", "--tree": "tree", "--type": "type",
  "--primary": "primary", "--secondary": "secondary",
};

class Usage extends Error {}

function parseArgs(argv) {
  const opts = { config: ".wish-sweep.json", root: ".", scope: [], type: "code" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      continue;
    }
    const key = VALUE_FLAGS[arg];
    if (key === undefined && arg !== "--scope") throw new Usage(`unknown argument: ${arg}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) throw new Usage(`${arg} needs a value`);
    if (arg === "--scope") opts.scope.push(next);
    else opts[key] = next;
    i += 1;
  }
  return opts;
}

function selectProbes(names) {
  if (names === undefined) return PROBES;
  const wanted = names.split(",").map((name) => name.trim()).filter(Boolean);
  const unknown = wanted.filter((name) => !PROBES.some((probe) => probe.name === name));
  if (wanted.length === 0 || unknown.length > 0) {
    throw new Usage(`unknown --probe ${unknown.join(",") || "(empty)"}; known: ${PROBES.map((probe) => probe.name).join(",")}`);
  }
  return PROBES.filter((probe) => wanted.includes(probe.name));
}

function validateOptions(opts, selected) {
  if (!WORK_TYPES.includes(opts.type)) throw new Usage(`unknown --type ${opts.type}`);
  if (opts.type === "mixed" && !(PRIMARY_TYPES.includes(opts.primary) && PRIMARY_TYPES.includes(opts.secondary))) {
    throw new Usage("--type mixed needs --primary and --secondary, both concrete types");
  }
  if (opts.lane !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(opts.lane)) throw new Usage(`--lane must be kebab-case: ${opts.lane}`);
  if (opts.receipt && !opts.unit) throw new Usage("--receipt needs --unit: a lane receipt names the unit it served");
  if (opts.receipt && opts.type === "research") throw new Usage("--type research has no sweep lane");
  if (opts.lane !== undefined) return opts.lane;
  return selected.length === 1 ? selected[0].name : DEFAULT_LANE;
}

function skip(probe, observable, note) {
  return [row({ id: probe.name, verdict: "SKIP", observable, note })];
}

async function collect(config, ctx, selected) {
  const probes = [];
  const budgetMs = sweepBudget(config.budgetMs);
  const deadline = Date.now() + budgetMs;
  let exhausted = false;
  for (const probe of selected) {
    const probeConfig = config.probes?.[probe.name];
    if (!exhausted && Date.now() > deadline) exhausted = true;
    if (exhausted) {
      probes.push({ name: probe.name, status: "SKIP", rows: skip(probe, "the probe runs inside the run budget", `the ${budgetMs} ms budget was exhausted`) });
      continue;
    }
    let rows;
    try {
      if (!ctx.applies(probe)) rows = skip(probe, `the probe applies to the ${ctx.type} work type`, `probe types: ${probe.types.join(",")}`);
      else if (probeConfig === undefined) rows = skip(probe, "the probe is configured", `probes.${probe.name} is absent`);
      else rows = await probe.run(probeConfig, ctx);
    } catch (error) {
      rows = [row({ id: probe.name, verdict: "FAIL", observable: "the probe runs to completion", note: `probe crashed: ${error?.message ?? error}` })];
    }
    probes.push({ name: probe.name, status: summarise(rows), rows });
  }
  if (exhausted) {
    probes.push({
      name: "budget",
      status: "WARN",
      rows: [row({
        id: "sweep/budget",
        verdict: "WARN",
        observable: `every selected probe runs inside ${budgetMs} ms`,
        note: "the run budget ran out; the skipped probes are unproven and belong to the checklist pass",
      })],
    });
  }
  return probes;
}

function render({ root, head, probes, exit }) {
  const lines = [`wish sweep — ${root}${head ? ` @ ${head.slice(0, 7)}` : ""}`, ""];
  const counts = { PASS: 0, FAIL: 0, WARN: 0, INVALID: 0, SKIP: 0 };
  const verbose = Boolean(process.env.WISH_SWEEP_VERBOSE);
  for (const probe of probes) {
    lines.push(`${probe.status.padEnd(7)} ${probe.name}`);
    for (const entry of probe.rows) {
      counts[entry.verdict] = (counts[entry.verdict] ?? 0) + 1;
      if (entry.verdict === "PASS" && !verbose) continue;
      lines.push(`  ${entry.verdict.padEnd(7)} ${entry.id}${entry.note ? `: ${entry.note}` : ""}`);
    }
  }
  const summary = Object.entries(counts).map(([key, count]) => `${key} ${count}`).join(" ");
  lines.push("", `summary ${summary} — exit ${exit}`);
  return lines.join("\n");
}

async function main(argv) {
  let opts;
  let selected;
  let lane;
  try {
    opts = parseArgs(argv);
    if (opts.help) {
      process.stdout.write(`${USAGE}\n`);
      return EXIT_CODES.OK;
    }
    selected = selectProbes(opts.probe);
    lane = validateOptions(opts, selected);
  } catch (error) {
    process.stderr.write(`sweep: ${error.message}\n\n${USAGE}\n`);
    return EXIT_CODES.USAGE;
  }

  const root = resolve(opts.root);
  const configPath = resolve(root, opts.config);
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    process.stderr.write(`sweep: config not readable: ${configPath}: ${error?.message ?? error}\n`);
    return EXIT_CODES.USAGE;
  }
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    process.stderr.write(`sweep: config must be a JSON object: ${configPath}\n`);
    return EXIT_CODES.USAGE;
  }

  // M0 §2: a mixed run takes its primary type's identity form, so a
  // research-primary mixed run has an artifact sha256 head and no git tree.
  const identity = opts.type === "mixed" ? opts.primary : opts.type;
  const facts = await gitFacts(root);
  if (identity !== "research" && opts.head && facts.head && opts.head !== facts.head) {
    process.stderr.write(`sweep: --head ${opts.head.slice(0, 7)} is not this checkout's HEAD ${facts.head.slice(0, 7)}; the commands run on HEAD, so the receipt would bind another state\n`);
    return EXIT_CODES.STATE_MISMATCH;
  }
  const head = opts.head ?? facts.head;
  const tree = identity === "research" ? null : (opts.tree ?? facts.tree);
  if (opts.receipt && !head) {
    process.stderr.write("sweep: cannot derive HEAD; pass --head <full sha>\n");
    return EXIT_CODES.STATE_MISMATCH;
  }

  const startedAt = new Date().toISOString();
  const ctx = ctxFor({
    root, type: opts.type, primary: opts.primary ?? null, secondary: opts.secondary ?? null,
    timeoutMs: config.timeoutMs, parallel: config.parallel,
  });
  const probes = await collect(config, ctx, selected);
  const { status, exit } = receiptStatus(probes.flatMap((probe) => probe.rows));

  if (opts.receipt) {
    const receipt = buildReceipt({ opts, lane, head, tree, status, probes, ctx, startedAt });
    const written = writeReceipt(opts.receipt, receipt);
    if (!written.ok) return written.reason === "usage" ? EXIT_CODES.USAGE : EXIT_CODES.STATE_MISMATCH;
    process.stdout.write(`${render({ root, head, probes, exit })}\nreceipt: ${written.path}\n`);
    return exit;
  }
  process.stdout.write(`${render({ root, head, probes, exit })}\n`);
  return exit;
}

if (isMain(import.meta.url)) process.exit(await main(process.argv.slice(2)));