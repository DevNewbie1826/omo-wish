import { appendEvent, computeStatus, progressLine, stateMismatch, usage, withLock } from "../lib/store.mjs";
import { join } from "node:path";
import { expectPositional } from "./args.mjs";
import { sessionId, readInput, git, observeWorktree, unitContext, headArg, identityOf } from "./context.mjs";
import { planFor } from "./plan.mjs";

function verbStatus(parsed, root) {
  const { plan, planPath, events } = planFor(root, parsed, { planless: true });
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

  const computed = computeStatus({ root, planPath, plan, head: head ?? null, tree: tree ?? null });
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
  const { plan, planPath } = planFor(root, parsed, { planless: true });
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


export { verbLedger, verbStatus };
