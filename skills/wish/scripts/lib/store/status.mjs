import { formatProgressLine, validateStatusJson } from "../schema.mjs";
import { checkFailed, stateMismatch } from "./core.mjs";
import { readLedger, pendingSwitchErrors, roundsOf } from "./ledger.mjs";
import { readPlan } from "./plan.mjs";
import { readFindings, readGaps } from "./tables.mjs";
import { readGates, listReceipts, judgeReceipt } from "./gates-receipts.mjs";
import { defectGaps } from "./stages.mjs";
import { buildContext, unitStatus } from "./blocking.mjs";

// --------------------------------------------------------------- the status

// §11. 'head'/'tree' are what the caller observed in the unit's worktree; the
// derivation itself is pure, so a test can pin it without a repository.
export function computeStatus({ root, planPath, head = null, tree = null, plan: planGiven = null }) {
  // A planless status derives the run's identity from the ledger (§9.3) and
  // passes it here; without it the plan file is the only authority, exactly as
  // before this seam existed.
  const plan = planGiven ?? readPlan(planPath);
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

  const progress = computeProgress({ events, gaps, units, contexts, unitStates, current });
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

function computeProgress({ events, gaps, units, contexts, unitStates, current }) {
  const done = unitStates.filter((entry) => entry.stage === "done").length;
  const defects = defectGaps(gaps);
  const merged = units.filter((unit) => events.some((event) => event.event === "merge" && event.unit === unit)).length;
  const open = units.filter((unit) => events.some((event) => event.event === "pr_open" && event.unit === unit)
    && !events.some((event) => event.event === "merge" && event.unit === unit)).length;
  const lastRound = unitStates.reduce((max, entry) => Math.max(max, entry.round), 0);
  const switching = events.filter((event) => event.event === "switch").length;
  const openGate = unitStates
    .find((entry) => entry.id === current.unit)?.blocking
    .find((reason) => reason.startsWith("gate:"));
  const pr = unitStates.find((entry) => entry.pr !== null)?.pr ?? null;
  const awaitingVerdict = unitStates.some((entry) => entry.next === "round" || entry.next === "switch");
  const awaitingMerge = unitStates.some((entry) => entry.next === "merge");
  let waiting = "none";
  if (openGate) waiting = "gate ".concat(openGate.slice("gate:".length).replace(/ open$/, ""));
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

// After an APPROVED verdict no round may follow, so the in-run remedy is the head that
// verdict judged, never a dispatch the ledger sequence refuses.
function approvedRestore(last) {
  return "restore the head the APPROVED verdict judged (".concat(String(last.head).slice(0, 7), "), because a round may not follow APPROVED");
}

// §2.9: the first invalid stage plus the actions that clear it. 'status' says
// what is true; 'resume-plan' says where to start again.
export function resumePlan({ status, contexts, unitStates, unit }) {
  // One unit's answer must name that unit's own missing step: a sibling's state is
  // not a resume instruction.
  const state = unitStates.find((entry) => entry.id === unit) ?? unitStates[0];
  const context = contexts.find((entry) => entry.unit === unit) ?? contexts[0];
  const rounds = context ? roundsOf(context.events, context.unit) : [];
  const last = rounds[rounds.length - 1];
  const merged = context ? context.events.some((event) => event.event === "merge" && event.unit === context.unit) : false;
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
      const id = reason.slice("gate:".length).replace(/ open$/, "");
      const fileGate = context?.gates?.some((gate) => gate.id === id && gate.status === "open") ?? false;
      // One id can be open in both sources at once. Each source needs its own
      // clearing action, so answering the file gate must not hide the ledger one.
      const lastLedger = [...(context?.events ?? [])].reverse()
        .find((event) => event.event === "gate" && event.unit === context.unit && event.gate_id === id);
      const ledgerOpen = lastLedger?.gate_status === "open";
      if (fileGate) actions.push("answer ".concat(id, " with gate resolve"));
      if (ledgerOpen && id === "dispatch") actions.push("re-run gate --round at the frozen head");
      else if (ledgerOpen) actions.push("append a resolved gate event for ".concat(id, " to the ledger"));
      if (!fileGate && !ledgerOpen) actions.push("answer ".concat(id, " with gate resolve"));
    } else if (reason === "order:freeze missing before round") {
      actions.push("freeze the head, then run the code-review lane at the frozen head");
    } else if (reason.startsWith("order:")) {
      actions.push("run the code-review lane at the frozen head ".concat(reason.slice("order:code-review missing at ".length)));
    } else if (reason.startsWith("verdict:")) {
      if (!merged) actions.push(last?.verdict === "APPROVED" ? approvedRestore(last) : "dispatch the final review on the frozen head");
    } else if (reason === "head:moved") {
      if (!merged) actions.push(last?.verdict === "APPROVED" ? approvedRestore(last) : "freeze the new head, or rebase back to the frozen one");
    } else {
      actions.push(reason);
    }
  }
  return { firstInvalid, next: status.next, blocking: status.blocking, actions: [...new Set(actions)] };
}
