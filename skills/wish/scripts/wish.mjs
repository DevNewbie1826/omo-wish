#!/usr/bin/env node
// wish v2 - module M1: the one entry point (`references/ledger.md` §14).
//
// Verbs and exit codes are the M0 contract's, not this file's invention:
//   0 ok, 1 check failed, 2 usage, 3 state mismatch (§14).
// This CLI is a helper the omo agents call. It never replaces a role: it does
// not review, does not run tests on its own, does not spawn reviewers, and never
// talks to the network. Every shape it reads or writes comes from
// `lib/schema.mjs`; every file primitive comes from `lib/store.mjs`.

import {
  CLI_VERBS,
  EXIT_CODES,
  SWITCH_KINDS,
  WORK_TYPES,
  TIERS,
  validateGapReceipts,
  validateLedgerEvent,
  validateReceipt,
  validateReceiptAgainstFilename,
} from "./lib/schema.mjs";
import {
  WishError,
  addFindings,
  addGaps,
  addGate,
  appendEvent,
  atomicWrite,
  checkFailed,
  computeStatus,
  ensureDir,
  identityType,
  listReceipts,
  mergeFrontMatter,
  nowIso,
  progressLine,
  readFindings,
  readGaps,
  readGates,
  readLedger,
  readPlan,
  resolveGate,
  resolvePlanPath,
  resumePlan,
  rootPaths,
  setFinding,
  setGap,
  stateMismatch,
  switchesOf,
  usage,
  withLock,
  writeFrontMatter,
} from "./lib/store.mjs";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// --------------------------------------------------------------- usage text

const VERB_USAGE = {
  init: [
    "init --run-id <w-slug-yyyymmdd-hhmm> --type <code|design|research|audit|mixed> --tier <S|M|L> --plan <path>",
    "     [--program <id>] [--unit <id>] [--worktree <path>] [--branch <name>]",
    "     [--primary <type> --secondary <type> (mixed only)] [--fact <text>]... [--session <senpi:id>]",
    "     Create <ER>, write the plan front matter and append the intake event.",
  ],
  status: [
    "status [--json] [--progress] [--head <sha>] [--plan <path>]",
    "     Replay the ledger, re-judge every receipt against the current tree, print §11.",
  ],
  ledger: [
    "ledger append --event <name> [--json <file|->]",
    "     Validate one §9 event and append it. Missing stage/started_at/plan/type/unit",
    "     are filled from the plan front matter.",
  ],
  findings: [
    "findings add --tsv <file|->",
    "findings set --id <id> [--status <status>] [--fixed-head <sha>] [--blocking <0|1>]",
    "findings list [--json]",
  ],
  gaps: [
    "gaps add --tsv <file|->",
    "gaps set --id <G<n>> [--status <status>] [--pr <n>] [--fixed-head <sha>]",
    "gaps list [--json]",
  ],
  gate: [
    "gate add --id <id> --question <text> --options <a|b> --default <a>",
    "gate resolve --id <id> --answer <text>",
    "gate --round <n> [--head <sha>] [--timeout <seconds>] [--dry-run]",
    "     Park/resolve an owner question, or run the dispatch reproduction table.",
  ],
  freeze: [
    "freeze [--head <sha>] [--pr <n>]",
    "freeze --check [--head <sha>]",
    "     Record head, tree and pr; --check proves nothing landed after the freeze.",
  ],
  "pr-body": ["pr-body [--pr <n>] [--out <path>]", "     Build the PR body from state, including the before/after table."],
  "reuse-check": ["reuse-check <receipt> --head <sha>", "     Delegates to scripts/reuse-check.mjs (module M4)."],
  switch: [
    "switch record --round <n> --kind <premise|family|strategy|split|rediscover> --premise <text> --new-approach <text>",
    "     Record an approach switch. A cap is a switch, never an exit (§9.4).",
  ],
  metrics: ["metrics export [--out <dir>] | metrics post-merge --days <n> [--pr <n>]", "     Delegates to scripts/metrics.mjs (module M7)."],
  "resume-plan": ["resume-plan", "     Print the first invalid stage and the actions that clear it."],
};

const ROOT_NOTE = [
  "Shared: --root <ER> (or WISH_EVIDENCE_ROOT) is the evidence root; --plan overrides the plan path;",
  "        --session <senpi:id> overrides the ledger session id; --help exits 0 on every verb.",
].join("\n");

function printUsage() {
  const lines = [
    "wish - wish v2 state and CLI (module M1)",
    "",
    "usage: wish <verb> [flags]",
    "",
    ...CLI_VERBS.map((verb) => `  ${verb}`),
    "",
    "exit codes: 0 ok, 1 check failed, 2 usage, 3 state mismatch",
    "",
    ROOT_NOTE,
    "",
    "run 'wish <verb> --help' for one verb",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function printVerbUsage(verb) {
  const lines = [VERB_USAGE[verb][0], ...VERB_USAGE[verb].slice(1), "", ROOT_NOTE];
  process.stdout.write(`${lines.join("\n")}\n`);
}

// ----------------------------------------------------------------- argv flags

function parseArgs(argv, spec) {
  const values = new Map();
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg : arg.slice(0, eq);
      if (name === "--help" || name === "-h") {
        values.set("--help", true);
        continue;
      }
      const entry = spec[name];
      if (!entry) throw usage(`unknown flag ${name}`);
      if (entry.kind === "bool") {
        if (eq !== -1) throw usage(`${name} takes no value`);
        values.set(name, true);
        continue;
      }
      let value;
      if (eq !== -1) value = arg.slice(eq + 1);
      else {
        value = argv[index + 1];
        index += 1;
        if (value === undefined) throw usage(`${name} needs a value`);
      }
      if (entry.repeat) values.set(name, [...(values.get(name) ?? []), value]);
      else {
        if (values.has(name)) throw usage(`${name} given twice`);
        values.set(name, value);
      }
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, get: (name) => values.get(name), has: (name) => values.has(name) };
}

const COMMENT_FLAGS = {
  "--root": { kind: "value" },
  "--plan": { kind: "value" },
  "--session": { kind: "value" },
  "--json": { kind: "bool" },
};

function expectPositional(parsed, allowed, label) {
  const [command, ...rest] = parsed.positionals;
  if (command === undefined) throw usage(`${label}: missing subcommand (${allowed.join(", ")})`);
  if (!allowed.includes(command)) throw usage(`${label}: unknown subcommand ${command} (${allowed.join(", ")})`);
  if (rest.length > 0) throw usage(`${label}: unexpected argument ${rest[0]}`);
  return command;
}

function resolveRoot(parsed) {
  const explicit = parsed.get("--root") ?? process.env.WISH_EVIDENCE_ROOT;
  if (!explicit) throw usage("no evidence root: pass --root <ER> or set WISH_EVIDENCE_ROOT");
  return resolve(explicit);
}

function sessionId(parsed) {
  return parsed.get("--session") ?? process.env.SENPI_SESSION_ID ?? process.env.WISH_SESSION_ID ?? "senpi:wish-cli";
}

function readInput(value, label) {
  if (value === "-") {
    if (process.stdin.isTTY) throw usage(`${label} - needs input on stdin`);
    return readFileSync(0, "utf8");
  }
  if (!existsSync(value)) throw usage(`${label}: no such file ${value}`);
  return readFileSync(value, "utf8");
}

// ------------------------------------------------------------------ git facts

// Short, bounded git calls only. `null` means "not a repository here", which is
// a legal state for a research unit and for tests without a worktree.
function git(worktree, args) {
  if (!worktree) return null;
  const result = spawnSync("git", ["-C", worktree, ...args], { encoding: "utf8", timeout: 30_000 });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

function observeWorktree(worktree) {
  const head = git(worktree, ["rev-parse", "HEAD"]);
  const tree = git(worktree, ["rev-parse", "HEAD^{tree}"]);
  const porcelain = git(worktree, ["status", "--porcelain"]);
  return {
    head: head && /^[0-9a-f]{40}$/.test(head) ? head : null,
    tree: tree && /^[0-9a-f]{40}$/.test(tree) ? tree : null,
    dirty: porcelain === null ? null : porcelain !== "",
    branch: git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]),
  };
}

function unitContext(plan) {
  return { type: plan.wish.type, unit: plan.wish.unit ?? "u1", programId: plan.wish.program_id ?? null };
}

// One validator for every --head: the contract fixes the width by identity, and a
// seven-character SHA is never accepted (ledger.md §2).
function headArg(value, identity) {
  if (value === undefined) return undefined;
  if (identity === "research" ? /^[0-9a-f]{64}$/.test(value) : /^[0-9a-f]{40}$/.test(value)) return value;
  throw usage(identity === "research"
    ? "--head takes the 64-hex artifact sha256 of a research run"
    : "--head takes a full 40-hex commit SHA");
}

// A mixed run's findings table is parsed with the union of its two class sets, so
// every reader of the table needs the labels that travel on the events.
function findingOptions(plan, events) {
  // A shared root can hold several units with different labels: read this unit's own.
  const unit = plan.wish.unit ?? "u1";
  const labels = [...events].reverse().find((event) => event.unit === unit
    && typeof event.primary === "string" && typeof event.secondary === "string");
  return { type: plan.wish.type, primary: labels?.primary, secondary: labels?.secondary };
}

// M0 §2: for a mixed run the head/tree rules follow the primary type. The labels
// travel on the events (the front matter has no primary/secondary key).
function mixedLabelsOf(plan, events) {
  if (plan.wish.type !== "mixed") return null;
  const unit = plan.wish.unit ?? "u1";
  const labels = [...events].reverse().find((event) => event.unit === unit
    && typeof event.primary === "string" && typeof event.secondary === "string");
  if (!labels) throw stateMismatch("a mixed run needs --primary/--secondary on its intake event");
  return { primary: labels.primary, secondary: labels.secondary };
}

// Every event and receipt a mixed run writes must name both types: the frozen
// schema rejects a mixed object without them.
function withLabels(plan, events, object) {
  const labels = mixedLabelsOf(plan, events);
  return labels === null ? object : { ...object, primary: labels.primary, secondary: labels.secondary };
}

function identityOf(plan, events) {
  if (plan.wish.type !== "mixed") return plan.wish.type;
  return identityType(plan.wish.type, mixedLabelsOf(plan, events).primary);
}

function planFor(root, parsed) {
  const events = readLedger(root);
  const planPath = resolvePlanPath(events, parsed.get("--plan"));
  return { plan: readPlan(planPath), events, planPath };
}

// -------------------------------------------------------------------- verbs

function verbInit(parsed, root) {
  const runId = parsed.get("--run-id");
  const type = parsed.get("--type");
  const tier = parsed.get("--tier");
  const planArg = parsed.get("--plan");
  if (!runId) throw usage("init needs --run-id");
  if (!type) throw usage("init needs --type");
  if (!tier) throw usage("init needs --tier");
  if (!planArg) throw usage("init needs --plan");
  if (!parsed.has("--fact")) throw usage("init needs at least one --fact: the tier triage facts");
  if (!/^w-[a-z0-9]+(?:-[a-z0-9]+)*-\d{8}-\d{4}$/.test(runId)) throw usage("--run-id takes w-<slug>-<yyyymmdd>-<hhmm>");
  if (!WORK_TYPES.includes(type)) throw usage(`--type takes ${WORK_TYPES.join("|")}`);
  if (!TIERS.includes(tier)) throw usage("--tier takes S|M|L");
  const primary = parsed.get("--primary");
  const secondary = parsed.get("--secondary");
  if (type === "mixed" && (!primary || !secondary)) throw usage("a mixed run needs --primary and --secondary");
  if (type !== "mixed" && (primary || secondary)) throw usage("--primary/--secondary are for a mixed run only");
  const unit = parsed.get("--unit") ?? (existsSync(planArg) ? (readPlan(resolve(planArg)).wish.unit ?? "u1") : "u1");
  const program = parsed.get("--program") ?? null;
  const planPath = resolve(planArg);
  const worktree = resolve(parsed.get("--worktree") ?? process.cwd());
  const observed = observeWorktree(worktree);
  const branch = parsed.get("--branch") ?? observed.branch ?? "detached";
  const paths = rootPaths(root);
  ensureDir(paths.root);

  return withLock(root, () => {
    // Both the front matter and the intake event land under the lock: two
    // concurrent inits must not interleave a half-written plan.
    const existing = existsSync(planPath) ? readPlan(planPath) : null;
    if (existing && existing.wish.run_id !== runId) {
      throw stateMismatch(`the plan belongs to another run: ${existing.wish.run_id}`);
    }
    if (existing && existing.wish.unit !== unit) {
      throw stateMismatch(`the plan belongs to unit ${existing.wish.unit}, not ${unit}`);
    }
    if (existing) {
      // A second init for the same run is a no-op: rewriting the front matter from
      // these flags would erase values (program_id, unit, branch) that a resume did
      // not repeat on its command line.
      const events = readLedger(root);
      const already = events.some((event) => event.event === "intake" && event.unit === existing.wish.unit);
      if (already) {
        return { run_id: runId, root: paths.root, plan: planPath, intake: null, note: "already initialized" };
      }
    }
    const wish = {
      run_id: runId,
      tier,
      type,
      unit,
      program_id: program ?? existing?.wish.program_id ?? null,
      worktree,
      branch,
      pr: existing?.wish.pr ?? null,
      frozen_head: existing?.wish.frozen_head ?? null,
      round: existing?.wish.round ?? 0,
    };
    writeFrontMatter(planPath, wish);
    const events = readLedger(root);
    const already = events.some((event) => event.event === "intake" && event.unit === unit);
    if (already) return { run_id: runId, root: paths.root, plan: planPath, intake: null, note: "already initialized" };
    const facts = parsed.get("--fact");
    const event = appendEvent(root, {
      event: "intake",
      type,
      unit,
      program_id: program ?? existing?.wish.program_id ?? null,
      plan: planPath,
      session_id: sessionId(parsed),
      started_at: nowIso(),
      tier,
      facts,
      ...(type === "mixed" ? { primary, secondary } : {}),
    }, { plan: planPath, sessionId: sessionId(parsed) });
    return { run_id: runId, root: paths.root, plan: planPath, intake: event, note: "initialized" };
  });
}

function verbStatus(parsed, root) {
  const { plan, planPath, events } = planFor(root, parsed);
  const identity = identityOf(plan, events);
  const given = headArg(parsed.get("--head"), identity);
  const observed = identity === "research" ? { head: null, tree: null } : observeWorktree(plan.wish.worktree);
  const head = given ?? observed.head;
  const tree = identity === "research" ? null : observed.tree;

  // A frozen head that is no longer an ancestor of the observed head means the
  // reviewed patch is gone (rebase, force-push). That is "state unreadable", not
  // a moved head: nothing in this report can be trusted any more (§14).
  if (plan.wish.frozen_head && head && plan.wish.frozen_head !== head) {
    const contained = git(plan.wish.worktree, ["merge-base", "--is-ancestor", plan.wish.frozen_head, head]);
    const known = git(plan.wish.worktree, ["rev-parse", "--verify", "--quiet", plan.wish.frozen_head]);
    if (known === null) {
      throw stateMismatch(`the frozen head ${plan.wish.frozen_head.slice(0, 7)} does not exist in ${plan.wish.worktree}`);
    }
    if (contained === null) {
      throw stateMismatch(`the head ${head.slice(0, 7)} no longer contains the frozen head ${plan.wish.frozen_head.slice(0, 7)}`);
    }
  }

  const computed = computeStatus({ root, planPath, head: head ?? null, tree: tree ?? null });
  const { status, unitStates } = computed;
  const pr = (unitStates.find((entry) => entry.id === (computed.plan.wish.unit ?? "u1")) ?? unitStates[0])?.pr ?? null;
  if (parsed.has("--progress")) {
    process.stdout.write(`${progressLine(status, pr)}\n`);
    return null;
  }
  if (parsed.has("--json")) {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return null;
  }
  const lines = [
    `run ${status.run_id}  type ${status.type}  tier ${status.tier}`,
    `stage: ${status.stage}   next: ${status.next}   round: ${status.round}`,
    `head: ${status.head ? status.head.slice(0, 7) : "-"}   tree: ${status.tree ? status.tree.slice(0, 7) : "-"}   pr: ${pr === null ? "-" : `#${pr}`}`,
    `valid receipts (${status.valid_receipts.length}): ${status.valid_receipts.join(", ") || "-"}`,
    `stale receipts (${status.stale_receipts.length}): ${status.stale_receipts.join(", ") || "-"}`,
  ];
  lines.push(`blocking (${status.blocking.length}):`);
  for (const reason of status.blocking) lines.push(`  - ${reason}`);
  if (status.blocking.length === 0) lines.push("  - none");
  for (const unit of status.units) {
    lines.push(`unit ${unit.id}: ${unit.stage}  next ${status.next}  round ${unit.round}  switches ${unit.switches}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return null;
}

function verbLedger(parsed, root) {
  const command = expectPositional(parsed, ["append"], "ledger");
  void command;
  const name = parsed.get("--event");
  if (!name) throw usage("ledger append needs --event <name>");
  const source = parsed.get("--json");
  let input = {};
  if (source !== undefined) {
    const text = readInput(source, "--json");
    try {
      input = JSON.parse(text);
    } catch {
      // The parser message quotes the input, which may be an unredacted token:
      // report the failure, not the bytes.
      throw usage("--json does not contain valid JSON");
    }
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw usage("--json must contain one JSON object");
    }
  }
  if (input.event === undefined) input.event = name;
  // The body's value is attacker-controlled input; report the disagreement, not it.
  // Neither the flag value nor the body's is repeated: a caller may have pasted a token.
  if (input.event !== name) throw usage("--event disagrees with the event body's event field");
  const { plan, planPath } = planFor(root, parsed);
  const context = unitContext(plan);
  const event = {
    type: input.type ?? context.type,
    unit: input.unit ?? context.unit,
    program_id: input.program_id === undefined ? context.programId : input.program_id,
    plan: input.plan ?? planPath,
    session_id: input.session_id ?? sessionId(parsed),
    ...input,
    event: name,
  };
  const appended = withLock(root, () => appendEvent(root, event, { plan: planPath, sessionId: sessionId(parsed) }));
  process.stdout.write(`${JSON.stringify(appended)}\n`);
  return null;
}

function verbFindings(parsed, root) {
  const command = expectPositional(parsed, ["add", "set", "list"], "findings");
  const { plan, events } = planFor(root, parsed);
  const options = findingOptions(plan, events);
  if (command === "add") {
    const source = parsed.get("--tsv");
    if (!source) throw usage("findings add needs --tsv <file|->");
    const added = withLock(root, () => addFindings(root, readInput(source, "--tsv"), options));
    process.stdout.write(`${JSON.stringify({ added: added.map((row) => row.id) })}\n`);
    return null;
  }
  if (command === "set") {
    const id = parsed.get("--id");
    if (!id) throw usage("findings set needs --id");
    const patch = {};
    if (parsed.has("--status")) patch.status = parsed.get("--status");
    if (parsed.has("--blocking")) patch.blocking = parsed.get("--blocking");
    if (parsed.has("--fixed-head")) patch.fixedHead = parsed.get("--fixed-head");
    if (Object.keys(patch).length === 0) throw usage("findings set needs --status, --blocking or --fixed-head");
    const row = withLock(root, () => setFinding(root, id, patch, options));
    process.stdout.write(`${JSON.stringify(row)}\n`);
    return null;
  }
  const rows = readFindings(root, options) ?? [];
  if (parsed.has("--json")) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  else {
    const header = ["id", "round", "source", "class", "severity", "blocking", "status", "file_line"].join("\t");
    process.stdout.write(`${[header, ...rows.map((row) => [row.id, row.round, row.source, row.class, row.severity, row.blocking, row.status, row.file_line].join("\t"))].join("\n")}\n`);
  }
  return null;
}

function verbGaps(parsed, root) {
  const command = expectPositional(parsed, ["add", "set", "list"], "gaps");
  if (command === "add") {
    const source = parsed.get("--tsv");
    if (!source) throw usage("gaps add needs --tsv <file|->");
    planFor(root, parsed);
    const added = withLock(root, () => addGaps(root, readInput(source, "--tsv")));
    process.stdout.write(`${JSON.stringify({ added: added.map((row) => row.id) })}\n`);
    return null;
  }
  if (command === "set") {
    const id = parsed.get("--id");
    if (!id) throw usage("gaps set needs --id");
    planFor(root, parsed);
    const patch = {};
    if (parsed.has("--status")) patch.status = parsed.get("--status");
    if (parsed.has("--pr")) patch.pr = parsed.get("--pr");
    if (parsed.has("--fixed-head")) patch.fixedHead = parsed.get("--fixed-head");
    if (Object.keys(patch).length === 0) throw usage("gaps set needs --status, --pr or --fixed-head");
    const row = withLock(root, () => setGap(root, id, patch));
    process.stdout.write(`${JSON.stringify(row)}\n`);
    return null;
  }
  planFor(root, parsed);
  const rows = readGaps(root) ?? [];
  if (parsed.has("--json")) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  else {
    const header = ["id", "area", "surface", "kind", "severity", "status", "pr", "fixed_head"].join("\t");
    process.stdout.write(`${[header, ...rows.map((row) => [row.id, row.area, row.surface, row.kind, row.severity, row.status, row.pr, row.fixed_head].join("\t"))].join("\n")}\n`);
  }
  return null;
}

function verbGate(parsed, root) {
  const command = parsed.positionals[0];
  if (command === "add") {
    if (parsed.positionals.length > 1) throw usage(`gate add: unexpected argument ${parsed.positionals[1]}`);
    planFor(root, parsed);
    const gate = withLock(root, () => addGate(root, {
      id: parsed.get("--id"),
      question: parsed.get("--question"),
      options: parsed.get("--options"),
      fallback: parsed.get("--default"),
    }));
    process.stdout.write(`${JSON.stringify(gate)}\n`);
    return null;
  }
  if (command === "resolve") {
    if (parsed.positionals.length > 1) throw usage(`gate resolve: unexpected argument ${parsed.positionals[1]}`);
    planFor(root, parsed);
    const gate = withLock(root, () => resolveGate(root, { id: parsed.get("--id"), answer: parsed.get("--answer") }));
    process.stdout.write(`${JSON.stringify(gate)}\n`);
    return null;
  }
  if (command !== undefined) throw usage(`gate: unknown subcommand ${command} (add, resolve)`);
  return runDispatchGate(parsed, root);
}

// The dispatch gate (design §2.6 C1): re-run every open blocker's reproduction
// on the current head. Exit 0 only when nothing reproduces and no row is
// unprovable; a row that still reproduces is recorded as 'not-fixed' (that is
// what stops an ultrabrain dispatch) and a row with no command as 'no-command'.
async function runDispatchGate(parsed, root) {
  const roundValue = parsed.get("--round");
  if (roundValue === undefined) throw usage("gate needs --round <n>");
  if (!/^[1-9][0-9]*$/.test(roundValue)) throw usage("--round takes an integer >= 1");
  const target = Number(roundValue);
  const timeoutSeconds = parsed.get("--timeout") === undefined ? 120 : Number(parsed.get("--timeout"));
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 1800) {
    throw usage("--timeout takes 1..1800 seconds");
  }
  const { plan, planPath, events } = planFor(root, parsed);
  const context = unitContext(plan);
  const rows = readFindings(root, findingOptions(plan, events)) ?? [];
  const pending = rows.filter((row) => row.blocking === "1"
    && ["open", "not-fixed", "no-command"].includes(row.status)
    && Number(row.round) < target);
  // One observation for head and tree: two calls could straddle a commit and bind
  // the receipt to a head from one state and a tree from another.
  const identity = identityOf(plan, events);
  if (identity !== "research" && !existsSync(plan.wish.worktree)) {
    throw stateMismatch(`the worktree ${plan.wish.worktree} does not exist; a row would run in the wrong directory`);
  }
  const observed = identity === "research" ? { head: null, tree: null } : observeWorktree(plan.wish.worktree);
  const head = headArg(parsed.get("--head"), identity)
    ?? (identity === "research" ? plan.wish.frozen_head : observed.head);
  if (!head) throw stateMismatch("the gate needs a head: pass --head or freeze a worktree with a commit");
  // The rows run in this checkout: a head that is not the observed one would bind
  // PASS evidence to a head whose tree was never executed.
  if (identity !== "research" && head !== observed.head) {
    throw stateMismatch(`the gate runs the current worktree: --head ${String(head).slice(0, 7)} is not HEAD ${String(observed.head).slice(0, 7)}`);
  }
  const tree = identity === "research" ? null : observed.tree;

  if (pending.length > 20) {
    throw stateMismatch("the gate table is capped at 20 rows; " + pending.length + " are pending, so split the round");
  }
  if (parsed.has("--dry-run")) {
    const lines = ["gate round " + target + " on " + head.slice(0, 7) + " (dry run)", "pending rows: " + pending.length];
    for (const row of pending) lines.push("  " + row.id + "  " + row.status + "  " + row.repro_cmd);
    process.stdout.write(lines.join("\n") + "\n");
    return null;
  }

  const started = nowIso();
  if (pending.length === 0) {
    const empty = withLabels(plan, events, {
      kind: "lane", stage: "gate", type: plan.wish.type, unit: context.unit, program_id: context.programId,
      lane: "dispatch", head, tree, scope: [planPath], started_at: started, ended_at: nowIso(),
      status: "PASS", rows: [], artifacts: [], cleanup: [],
    });
    const emptyName = "gate-dispatch-" + head.slice(0, 7) + ".json";
    const emptyCheck = validateReceipt(empty);
    const emptyAnchors = validateReceiptAgainstFilename(empty, emptyName);
    if (!emptyCheck.ok || !emptyAnchors.ok) {
      throw checkFailed("the gate receipt would not match the contract", [...emptyCheck.errors, ...emptyAnchors.errors]);
    }
    withLock(root, () => {
      atomicWrite(join(rootPaths(root).receipts, emptyName), JSON.stringify(empty, null, 2) + "\n");
      recordGate(root, { plan, planPath, context, parsed, started, head, open: false, events });
    });
    process.stdout.write("gate on " + head.slice(0, 7) + ": PASS (nothing pending)\n");
    return null;
  }

  const results = await runRows(pending, { timeoutSeconds, cwd: plan.wish.worktree });
  const anyFail = results.some((entry) => entry.verdict !== "PASS");
  const name = "gate-dispatch-" + head.slice(0, 7) + ".json";
  const receipt = withLabels(plan, events, {
    kind: "lane",
    stage: "gate",
    type: plan.wish.type,
    unit: context.unit,
    program_id: context.programId,
    lane: "dispatch",
    head,
    tree,
    scope: [planPath],
    started_at: started,
    ended_at: nowIso(),
    status: anyFail ? "FAIL" : "PASS",
    rows: results.map((entry) => ({
      id: entry.id,
      command: entry.command,
      observable: "exit 0 means the defect no longer reproduces",
      verdict: entry.verdict,
      artifact: null,
      ...(entry.note ? { note: entry.note } : {}),
    })),
    artifacts: [],
    cleanup: [],
  });
  const checked = validateReceipt(receipt);
  const anchors = validateReceiptAgainstFilename(receipt, name);
  if (!checked.ok || !anchors.ok) {
    throw checkFailed("the gate receipt would not match the contract", [...checked.errors, ...anchors.errors]);
  }
  withLock(root, () => {
    atomicWrite(join(rootPaths(root).receipts, name), JSON.stringify(receipt, null, 2) + "\n");
    // Re-read under the lock: a row may have moved while its command was running
    // (the session can fix a finding mid-gate). Applying the snapshot instead would
    // either write a stale state or abort the whole commit on an illegal move and
    // lose the gate event, which is the one record the dispatch gate owes.
    const fresh = readFindings(root, findingOptions(plan, events)) ?? [];
    const notes = [];
    for (const entry of results) {
      const target = entry.status === "not-fixed" ? "not-fixed" : entry.status === "no-command" ? "no-command" : null;
      if (!target) continue;
      const current = fresh.find((row) => row.id === entry.id);
      if (!current) {
        notes.push(entry.id.concat(" vanished"));
        continue;
      }
      if (current.status === target) continue;
      try {
        setFinding(root, entry.id, { status: target }, findingOptions(plan, events));
      } catch (error) {
        notes.push(entry.id.concat(": ", error?.message ?? "transition refused"));
      }
    }
    recordGate(root, {
      plan, planPath, context, parsed, started, head, open: anyFail, events,
      note: notes.length > 0 ? "skipped: ".concat(notes.join("; ")) : undefined,
    });
  });

  const lines = ["gate on " + head.slice(0, 7) + ": " + (anyFail ? "BLOCKED" : "PASS")];
  for (const entry of results) lines.push("  " + entry.id + "  " + entry.verdict + (entry.note ? "  (" + entry.note + ")" : ""));
  process.stdout.write(lines.join("\n") + "\n");
  if (anyFail) throw checkFailed("a prior blocker still reproduces");
  return null;
}

// The dispatch gate is a section 9 'gate' event with the id the contract's own
// example uses: 'dispatch' + 'open' is what status.blocking reports.
function recordGate(root, { plan, planPath, context, parsed, started, head, open, note, events }) {
  appendEvent(root, withLabels(plan, events, {
    event: "gate",
    type: plan.wish.type,
    unit: context.unit,
    program_id: context.programId,
    plan: planPath,
    session_id: sessionId(parsed),
    started_at: started,
    gate_id: "dispatch",
    gate_status: open ? "open" : "resolved",
    head,
    ...(note ? { note } : {}),
  }), { plan: planPath, sessionId: sessionId(parsed) });
}

// One child per row. The command is the contract's shell line by definition
// (M0 section 14), so it runs through /bin/sh -c exactly once, with no string
// built around it; the child gets the plan's worktree, its own process group,
// and a hard time box. Its stdout/stderr is drained and dropped on purpose: a
// reproduction may print a token, and evidence never carries one (INV6).
function runRows(rows, { timeoutSeconds, cwd }) {
  const workdir = cwd && existsSync(cwd) ? cwd : undefined;
  const jobs = rows.map((row) => new Promise((resolveRow) => {
    if (row.repro_cmd === "no command") {
      resolveRow({ id: row.id, command: row.repro_cmd, verdict: "INVALID", status: "no-command", note: "no reproduction yet" });
      return;
    }
    let child;
    try {
      child = spawn("/bin/sh", ["-c", row.repro_cmd], { cwd: workdir, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolveRow({ id: row.id, command: row.repro_cmd, verdict: "INVALID", status: "open", note: "spawn failed: " + (error?.code ?? "error") });
      return;
    }
    let settled = false;
    let timer = null;
    const finish = (entry) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // INV4: nothing a row started may outlive it, including a grandchild that a
      // successful command left in the background.
      killGroup(child);
      if (child.pid) LIVE_GROUPS.delete(child.pid);
      resolveRow({ id: row.id, command: row.repro_cmd, ...entry });
    };
    const drain = () => {};
    child.stdout.on("data", drain);
    child.stderr.on("data", drain);
    if (child.pid) LIVE_GROUPS.add(child.pid);
    timer = setTimeout(() => {
      killGroup(child);
      finish({ verdict: "INVALID", status: "open", note: "timeout after " + timeoutSeconds + "s" });
    }, timeoutSeconds * 1000);
    child.on("error", (error) => finish({ verdict: "INVALID", status: "open", note: "spawn failed: " + (error?.code ?? "error") }));
    // "close" waits for every inherited pipe to close, which a background grandchild
    // can hold open past the row's real end; the shell's own exit status is the row's
    // verdict, and the group is killed right after it.
    child.on("exit", (code, signal) => finish({
      verdict: code === 0 ? "PASS" : "FAIL",
      status: code === 0 ? "fixed" : "not-fixed",
      note: code === 0 ? "exit 0" : signal ? "signal " + signal : "exit " + String(code),
    }));
  }));
  return Promise.all(jobs);
}

function killGroup(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

function verbFreeze(parsed, root) {
  const { plan, planPath, events } = planFor(root, parsed);
  const identity = identityOf(plan, events);
  const check = parsed.has("--check");
  const observed = identity === "research" ? { head: null, tree: null, dirty: null } : observeWorktree(plan.wish.worktree);
  const given = headArg(parsed.get("--head"), identity);
  // --check must compare the recorded head with the *observed* one; defaulting to
  // the recorded head would make the comparison vacuous.
  const head = given ?? observed.head ?? plan.wish.frozen_head;
  if (!head) throw stateMismatch("no head to freeze: pass --head or make a commit in the worktree");
  if (check) {
    const frozen = plan.wish.frozen_head;
    if (!frozen) throw stateMismatch("nothing is frozen yet");
    if (identity !== "research" && !observed.head) {
      throw stateMismatch(`cannot observe the worktree ${plan.wish.worktree}: no HEAD to compare with the freeze`);
    }
    if (frozen !== head) throw stateMismatch(`the head moved after the freeze: frozen ${frozen.slice(0, 7)}, now ${head.slice(0, 7)}`);
    if (identity !== "research" && plan.wish.frozen_head && observed.tree) {
      const frozenEvent = [...readLedger(root)].reverse().find((event) => event.event === "freeze"
        && event.unit === (plan.wish.unit ?? "u1"));
      if (frozenEvent && frozenEvent.tree && frozenEvent.tree !== observed.tree) {
        throw stateMismatch(`the tree moved after the freeze: frozen ${frozenEvent.tree.slice(0, 7)}, now ${observed.tree.slice(0, 7)}`);
      }
    }
    if (observed.dirty === true) throw checkFailed("the worktree has uncommitted changes after the freeze");
    const lastRound = [...readLedger(root)].reverse().find((event) => event.event === "round"
      && event.unit === (plan.wish.unit ?? "u1"));
    if (lastRound && lastRound.head !== frozen) {
      throw checkFailed(`the last round judged ${String(lastRound.head).slice(0, 7)}, not the frozen head ${frozen.slice(0, 7)}`);
    }
    process.stdout.write(`frozen ${frozen.slice(0, 7)} holds${observed.tree ? ` (tree ${observed.tree.slice(0, 7)})` : ""}\n`);
    return null;
  }
  if (observed.dirty === true) throw checkFailed("the worktree has uncommitted changes; freeze would not describe a commit");
  // A supplied head may be an ancestor of HEAD: its tree is that commit's tree, and
  // pairing another commit's tree with its sha would certify a state that never existed.
  let treeForHead = identity === "research" ? null : observed.tree;
  if (identity !== "research" && given && observed.head && given !== observed.head) {
    const resolved = git(plan.wish.worktree, ["rev-parse", `${given}^{tree}`]);
    if (resolved === null) throw stateMismatch(`the head ${given.slice(0, 7)} has no tree in ${plan.wish.worktree}`);
    treeForHead = resolved;
  }
  const pr = parsed.has("--pr") ? Number(parsed.get("--pr")) : null;
  if (parsed.has("--pr") && (!Number.isInteger(pr) || pr < 1)) throw usage("--pr takes a PR number");
  return withLock(root, () => {
    const freezeEvent = withLabels(plan, events, {
      event: "freeze",
      stage: "freeze",
      type: plan.wish.type,
      unit: plan.wish.unit ?? "u1",
      program_id: plan.wish.program_id ?? null,
      plan: planPath,
      session_id: sessionId(parsed),
      started_at: nowIso(),
      head,
      tree: treeForHead,
      pr: pr ?? plan.wish.pr ?? null,
    });
    // Validate before touching the plan: a rejected event used to leave the front
    // matter frozen at a head no ledger event records.
    const preChecked = validateLedgerEvent(freezeEvent);
    if (!preChecked.ok) throw checkFailed("the freeze event does not match the contract", preChecked.errors);
    // The event lands first: appendEvent also enforces the sequence, and a rejected
    // freeze must not leave the plan frozen at a head no ledger event records.
    appendEvent(root, freezeEvent, { plan: planPath, sessionId: sessionId(parsed) });
    mergeFrontMatter(planPath, { frozen_head: head, pr: pr ?? plan.wish.pr ?? null });
    process.stdout.write(`frozen ${head.slice(0, 7)}${treeForHead ? ` (tree ${treeForHead.slice(0, 7)})` : ""}\n`);
    return null;
  });
}

function verbPrBody(parsed, root) {
  const { plan, planPath, events } = planFor(root, parsed);
  const unit = plan.wish.unit ?? "u1";
  const frozen = [...events].reverse().find((event) => event.event === "freeze" && event.unit === unit);
  if (!frozen) throw stateMismatch("no freeze event: freeze the head before building the PR body");
  const gaps = readGaps(root) ?? [];
  const findings = readFindings(root, findingOptions(plan, events)) ?? [];
  const receipts = listReceipts(root);
  const names = receipts.map((receipt) => receipt.name);
  const defects = gaps.filter((row) => row.kind === "defect");
  const pairing = validateGapReceipts(defects, names);
  if (!pairing.ok) throw stateMismatch("the register's before/after receipts do not pair", pairing.errors);

  const beforeAfter = defects.length === 0
    ? ["no defect rows in this unit"]
    : [
      "| gap | before | after | state |",
      "| --- | --- | --- | --- |",
      ...defects.map((row) => {
        const after = names.find((name) => name.startsWith(`after-${row.id}-`));
        return `| ${row.id} | ${row.before_artifact} | ${after ?? "-"} | ${row.status} |`;
      }),
    ];

  const laneRows = receipts.filter((receipt) => receipt.body?.kind === "lane" && receipt.body.stage === "verify_lane");
  const verification = laneRows.length === 0
    ? ["no lane receipts"]
    : [
      "| lane | head | status |",
      "| --- | --- | --- |",
      ...laneRows.map((receipt) => `| ${receipt.body.lane} | ${String(receipt.body.head).slice(0, 7)} | ${receipt.body.status} |`),
    ];

  const findingRows = findings.length === 0
    ? ["no findings"]
    : [
      "| id | round | class | severity | blocking | status | file |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...findings.map((row) => `| ${row.id} | ${row.round} | ${row.class} | ${row.severity} | ${row.blocking} | ${row.status} | ${row.file_line} |`),
    ];

  const contract = planSection(plan.body, "## Contract") ?? `the plan's contract rows: ${planPath}`;
  const limits = planSection(plan.body, "### LIMIT rows (known limits, accepted)")
    ?? planSection(plan.body, "### LIMIT rows")
    ?? "none recorded in the plan";
  const outcome = planSection(plan.body, "## Purpose") ?? planPath;
  const pr = parsed.has("--pr") ? parsed.get("--pr") : (plan.wish.pr ?? "-");
  const lines = [
    `# ${plan.wish.run_id} - ${plan.wish.type} (${plan.wish.tier})`,
    "",
    ...(pr === null || pr === "-" ? ["PR: none"] : [`PR: #${pr}`]),
    `Frozen head: ${String(frozen.head)}  tree: ${frozen.tree ?? "null"}`,
    `Evidence root: ${root}`,
    "",
    "## Outcome",
    "",
    outcome,
    "",
    "## Contract",
    "",
    contract,
    "",
    "## Verification (lane receipts at this head)",
    "",
    ...verification,
    "",
    "## Findings",
    "",
    ...findingRows,
    "",
    "## Before / After",
    "",
    ...beforeAfter,
    "",
    "## Known limits",
    "",
    limits,
    "",
    "## Evidence",
    "",
    `- ledger: ${join(root, "ledger.jsonl")}`,
    `- receipts: ${join(root, "receipts")}`,
    `- findings: ${join(root, "findings.tsv")}`,
    "",
  ];
  const body = lines.join("\n");
  const out = parsed.get("--out");
  if (out) {
    // The caller chooses the path, but the run's own state is not a valid choice: a
    // typo there used to overwrite the append-only ledger (or the findings table)
    // with a PR body, outside the lock.
    const paths = rootPaths(root);
    const reserved = [paths.ledger, paths.findings, paths.gaps, paths.gates, paths.lens, paths.ideal,
      paths.resume, paths.lock, planPath];
    // The body may be written inside the evidence root and nowhere else: a path
    // outside it is a product file, and this module writes no product file. The
    // check resolves both sides, so a symlink cannot walk out of the root either.
    const rootReal = realpathSync(paths.root);
    const requested = resolve(out);
    const parentReal = existsSync(dirname(requested)) ? realpathSync(dirname(requested)) : dirname(requested);
    // An existing target is resolved through its own links: a symlink that leaves
    // the root is the same write as naming a path outside it.
    const targetReal = existsSync(requested) ? realpathSync(requested) : join(parentReal, basename(requested));
    const inside = targetReal === rootReal || targetReal.startsWith(rootReal + sep);
    const evidenceDirs = [join(rootReal, "receipts"), join(rootReal, "rounds")];
    if (!inside) throw usage(`--out must stay inside the evidence root: ${targetReal}`);
    if (reserved.includes(targetReal) || evidenceDirs.some((dir) => targetReal === dir || targetReal.startsWith(dir + sep))) {
      throw usage(`--out may not overwrite run state or evidence: ${targetReal}`);
    }
    writeFileSync(targetReal, body);
    process.stdout.write(`${resolve(out)}\n`);
  } else process.stdout.write(body);
  return null;
}

function planSection(body, heading) {
  const lines = String(body ?? "").split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^## /.test(lines[index])) {
      end = index;
      break;
    }
  }
  // The renderer emits the heading, so the section body is returned without it.
  return lines.slice(start + 1, end).join("\n").trim();
}

function verbSwitch(parsed, root) {
  const command = expectPositional(parsed, ["record"], "switch");
  void command;
  const roundRaw = parsed.get("--round");
  if (roundRaw === undefined) throw usage("switch record needs --round <n>");
  if (!/^[1-9][0-9]*$/.test(roundRaw)) throw usage("--round takes an integer >= 1");
  const round = Number(roundRaw);
  const kind = parsed.get("--kind");
  if (!SWITCH_KINDS.includes(kind)) throw usage(`--kind takes ${SWITCH_KINDS.join("|")}`);
  const premise = parsed.get("--premise");
  const approach = parsed.get("--new-approach");
  if (!premise) throw usage("switch record needs --premise");
  if (!approach) throw usage("switch record needs --new-approach");
  const { plan, events, planPath } = planFor(root, parsed);
  const unit = plan.wish.unit ?? "u1";
  const target = events.find((event) => event.unit === unit && event.event === "round" && event.round === round);
  if (!target || target.verdict !== "REVISE") throw stateMismatch(`no REVISE at round ${round}`);
  const used = switchesOf(events, unit);
  const applicable = SWITCH_KINDS.filter((entry) => entry !== "split" || Boolean(plan.wish.program_id));
  const kinds = used.map((event) => event.kind);
  const allUsed = applicable.every((entry) => kinds.includes(entry));
  if (kinds.includes(kind) && !allUsed) {
    throw checkFailed(`switch kind ${kind} repeats before every applicable kind is used (${applicable.join(", ")})`);
  }
  const event = withLock(root, () => appendEvent(root, withLabels(plan, readLedger(root), {
    event: "switch",
    type: plan.wish.type,
    unit,
    program_id: plan.wish.program_id ?? null,
    plan: planPath,
    session_id: sessionId(parsed),
    started_at: nowIso(),
    round,
    kind,
    premise,
    new_approach: approach,
    head: target.head,
  }), { plan: planPath, sessionId: sessionId(parsed) }));
  process.stdout.write(`${JSON.stringify(event)}\n`);
  return null;
}

function verbResumePlan(parsed, root) {
  const paths = rootPaths(root);
  if (!existsSync(paths.ledger)) throw stateMismatch(`no ledger at ${paths.ledger}`);
  const { plan, planPath, events } = planFor(root, parsed);
  const identity = identityOf(plan, events);
  const observed = identity === "research" ? { head: null, tree: null } : observeWorktree(plan.wish.worktree);
  const { status, contexts, unitStates } = computeStatus({
    root, planPath, head: observed.head, tree: identity === "research" ? null : observed.tree,
  });
  const resume = resumePlan({ status, contexts, unitStates, unit: plan.wish.unit ?? "u1" });
  const lines = [
    `wish resume - run ${status.run_id}`,
    `current stage: ${status.stage}   next: ${status.next}   first invalid stage: ${resume.firstInvalid}`,
    "blocking:",
    ...(status.blocking.length === 0 ? ["  - none"] : status.blocking.map((reason) => `  - ${reason}`)),
    "resume actions:",
    `  1. bun ${join(HERE, "wish.mjs")} status --json --root ${root}`,
    ...resume.actions.map((action, index) => `  ${index + 2}. ${action}`),
    `  ${resume.actions.length + 2}. re-dispatch ${resume.next} only when the list above is empty`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return null;
}

// `reuse-check` (M4) and `metrics` (M7) are other modules' scripts. M1 owns the
// entry point only: it hands argv over unchanged, with no shell, and returns the
// child's exit code so a caller never has to parse text.
function delegate(verb, argv) {
  const target = join(HERE, `${verb}.mjs`);
  if (!existsSync(target)) {
    throw stateMismatch(`${verb} is owned by another module: ${target} is not installed`);
  }
  const result = spawnSync(process.execPath, [target, ...argv], { stdio: "inherit" });
  if (result.error) throw checkFailed(`${verb} failed to start: ${result.error.code ?? "error"}`);
  if (result.signal) throw checkFailed(`${verb} was killed by ${result.signal}`);
  if (typeof result.status !== "number") throw checkFailed(`${verb} returned no exit code`);
  return { exit: result.status };
}

// ---------------------------------------------------------------- dispatch

const SPECS = {
  init: {
    ...COMMENT_FLAGS,
    "--run-id": { kind: "value" },
    "--type": { kind: "value" },
    "--tier": { kind: "value" },
    "--program": { kind: "value" },
    "--unit": { kind: "value" },
    "--worktree": { kind: "value" },
    "--branch": { kind: "value" },
    "--primary": { kind: "value" },
    "--secondary": { kind: "value" },
    "--fact": { kind: "value", repeat: true },
  },
  status: { ...COMMENT_FLAGS, "--progress": { kind: "bool" }, "--head": { kind: "value" } },
  // ledger reads its event body from a file or stdin, so --json is a value here
  // even though every other verb uses it as a boolean.
  ledger: { ...COMMENT_FLAGS, "--json": { kind: "value" }, "--event": { kind: "value" } },
  findings: {
    ...COMMENT_FLAGS,
    "--tsv": { kind: "value" },
    "--id": { kind: "value" },
    "--status": { kind: "value" },
    "--fixed-head": { kind: "value" },
    "--blocking": { kind: "value" },
  },
  gaps: {
    ...COMMENT_FLAGS,
    "--tsv": { kind: "value" },
    "--id": { kind: "value" },
    "--status": { kind: "value" },
    "--pr": { kind: "value" },
    "--fixed-head": { kind: "value" },
  },
  gate: {
    ...COMMENT_FLAGS,
    "--round": { kind: "value" },
    "--id": { kind: "value" },
    "--question": { kind: "value" },
    "--options": { kind: "value" },
    "--default": { kind: "value" },
    "--answer": { kind: "value" },
    "--head": { kind: "value" },
    "--timeout": { kind: "value" },
    "--dry-run": { kind: "bool" },
  },
  freeze: { ...COMMENT_FLAGS, "--head": { kind: "value" }, "--pr": { kind: "value" }, "--check": { kind: "bool" } },
  "pr-body": { ...COMMENT_FLAGS, "--pr": { kind: "value" }, "--out": { kind: "value" } },
  "reuse-check": { ...COMMENT_FLAGS, "--head": { kind: "value" } },
  switch: {
    ...COMMENT_FLAGS,
    "--round": { kind: "value" },
    "--kind": { kind: "value" },
    "--premise": { kind: "value" },
    "--new-approach": { kind: "value" },
  },
  metrics: { ...COMMENT_FLAGS, "--out": { kind: "value" }, "--days": { kind: "value" }, "--pr": { kind: "value" } },
  "resume-plan": { ...COMMENT_FLAGS },
};

const HANDLERS = {
  init: verbInit,
  status: verbStatus,
  ledger: verbLedger,
  findings: verbFindings,
  gaps: verbGaps,
  gate: verbGate,
  freeze: verbFreeze,
  "pr-body": verbPrBody,
  switch: verbSwitch,
  "resume-plan": verbResumePlan,
};

export function run(argv) {
  try {
    const [verb, ...rest] = argv;
    if (verb === undefined || verb === "help" || verb === "-h" || verb === "--help") {
      printUsage();
      return 0;
    }
    if (!CLI_VERBS.includes(verb)) throw usage(`unknown verb ${verb}`);
    if (rest.includes("--help") || rest.includes("-h")) {
      printVerbUsage(verb);
      return 0;
    }
    if (verb === "reuse-check" || verb === "metrics") {
      return delegate(verb, rest).exit;
    }
    const handler = HANDLERS[verb];
    if (!handler) throw usage(`unknown verb ${verb}`);
    const parsed = parseArgs(rest, SPECS[verb]);
    if (parsed.has("--help")) {
      printVerbUsage(verb);
      return 0;
    }
    const root = resolveRoot(parsed);
    const result = handler(parsed, root);
    if (result && typeof result.then === "function") {
      return result.then(() => EXIT_CODES.OK).catch(handleFailure);
    }
    return EXIT_CODES.OK;
  } catch (error) {
    return handleFailure(error);
  }
}

function handleFailure(error) {
  if (error instanceof WishError) {
    process.stderr.write(`wish: ${error.message}\n`);
    for (const detail of error.details.slice(0, 20)) {
      process.stderr.write(`  ${detail.path}: ${detail.message}\n`);
    }
    if (error.details.length > 20) process.stderr.write(`  ... ${error.details.length - 20} more\n`);
    return error.code;
  }
  process.stderr.write(`wish: internal error: ${error?.message ?? error}\n`);
  if (process.env.WISH_DEBUG === "1" && error?.stack) process.stderr.write(`${error.stack}\n`);
  return EXIT_CODES.CHECK_FAILED;
}

// A cancelled CLI must not leave a reproduction running: the children are detached
// into their own process groups, so the group has to be killed on the way out.
const LIVE_GROUPS = new Set();

function killAllGroups() {
  for (const pid of LIVE_GROUPS) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  LIVE_GROUPS.clear();
}

const invokedDirectly = typeof import.meta.main === "boolean"
  ? import.meta.main
  : isDirectInvocation();

// Under node, comparing raw paths misses a symlinked entry point (and
// `--preserve-symlinks-main` flips which side is unresolved), so both sides are
// resolved to their real path: a symlinked CLI must still run its verbs.
function isDirectInvocation() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return resolve(entry) === self;
  }
}

if (invokedDirectly) {
  // A cancelled CLI must not leave a reproduction running: the children are detached
  // into their own process groups, so the group has to be killed on the way out.
  // Only the CLI itself installs this: an importer's signals are not ours to handle.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      killAllGroups();
      process.exit(130);
    });
  }
  const outcome = run(process.argv.slice(2));
  if (outcome && typeof outcome.then === "function") {
    outcome.then((code) => {
      process.exitCode = code;
    });
  } else {
    process.exitCode = typeof outcome === "number" ? outcome : 0;
  }
}