import { requiredReceiptsFor, validateReceipt, validateReceiptAgainstFilename } from "../lib/schema.mjs";
import { appendEvent, atomicWrite, checkFailed, listReceipts, nowIso, readFindings, requireCodeReview, rootPaths, setFinding, stateMismatch, usage, withLock } from "../lib/store.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sessionId, observeWorktree, unitContext, headArg, findingOptions, mixedLabelsOf, withLabels, identityOf } from "./context.mjs";
import { planFor } from "./plan.mjs";
import { runRows } from "./gate-process.mjs";

async function runDispatchGate(parsed, root) {
  const roundValue = parsed.get("--round");
  if (roundValue === undefined) throw usage("gate needs --round <n>");
  if (!/^[1-9][0-9]*$/.test(roundValue)) throw usage("--round takes an integer >= 1");
  const target = Number(roundValue);
  const timeoutSeconds = parsed.get("--timeout") === undefined ? 120 : Number(parsed.get("--timeout"));
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 1800) {
    throw usage("--timeout takes 1..1800 seconds");
  }
  const { plan, planPath, events, fromLedger } = planFor(root, parsed, { planless: true });
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
  // The freeze binds the head a round is judged at, so a stale freeze is refused before
  // the argument check: the playbooks dispatch with the frozen head itself, and a moved
  // head must not read as a bad --head. Research has no worktree head to compare.
  if (identity !== "research" && plan.wish.frozen_head && observed.head
      && plan.wish.frozen_head !== observed.head) {
    throw stateMismatch(`the head moved after the freeze: frozen ${plan.wish.frozen_head.slice(0, 7)}, now ${String(observed.head).slice(0, 7)}`);
  }
  // The rows run in this checkout: a head that is not the observed one would bind
  // PASS evidence to a head whose tree was never executed.
  if (identity !== "research" && head !== observed.head) {
    throw stateMismatch(`the gate runs the current worktree: --head ${String(head).slice(0, 7)} is not HEAD ${String(observed.head).slice(0, 7)}`);
  }
  const tree = identity === "research" ? null : observed.tree;

  if (pending.length > 20) {
    throw stateMismatch("the gate table is capped at 20 rows; " + pending.length + " are pending, so split the round");
  }

  requireCodeReview({
    receipts: listReceipts(root), unit: context.unit,
    requiredLanes: requiredReceiptsFor(plan.wish.type, mixedLabelsOf(plan, events) ?? {}),
    frozenHead: plan.wish.frozen_head, tree,
  });

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
  if (anyFail) throw (fromLedger ? stateMismatch : checkFailed)("a prior blocker still reproduces");
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

export { runDispatchGate };
