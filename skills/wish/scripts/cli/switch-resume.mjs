import { SWITCH_KINDS } from "../lib/schema.mjs";
import { appendEvent, checkFailed, computeStatus, nowIso, readLedger, resumePlan, rootPaths, stateMismatch, switchesOf, usage, withLock } from "../lib/store.mjs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expectPositional } from "./args.mjs";
import { sessionId, observeWorktree, withLabels, identityOf } from "./context.mjs";
import { planFor } from "./plan.mjs";

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));

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

// ---------------------------------------------------------------- dispatch


export { verbResumePlan, verbSwitch };
