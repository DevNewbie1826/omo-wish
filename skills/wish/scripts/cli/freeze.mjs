import { validateLedgerEvent } from "../lib/schema.mjs";
import { appendEvent, checkFailed, mergeFrontMatter, nowIso, readLedger, stateMismatch, unitLedgerFacts, usage, withLock } from "../lib/store.mjs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { sessionId, git, observeWorktree, headArg, withLabels, identityOf } from "./context.mjs";
import { planFor } from "./plan.mjs";

function verbFreeze(parsed, root) {
  const check = parsed.has("--check");
  const { plan, planPath, events } = planFor(root, parsed, {
    planless: check, missingPlanReason: check ? null : "front matter write",
  });
  const identity = identityOf(plan, events);
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
      const { freeze: frozenEvent } = unitLedgerFacts(readLedger(root), plan.wish.unit ?? "u1");
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

// Every file the evidence root holds is protected, at any depth: a hard link to a
// nested artifact is the same inode as the artifact. Directory symlinks are not
// followed (a cycle would hang the walk), and an unreadable evidence directory is a
// state error rather than an empty set, so the guard never fails open.
function walkEvidence(dir, depth = 0) {
  // The guard needs the whole set, so an unreachable depth fails closed instead of
  // handing back a partial set that a hard link could slip past.
  if (depth > 32) throw stateMismatch(`the evidence tree under ${dir} is deeper than the guard walks`);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw stateMismatch(`cannot read ${dir}: ${error?.code ?? error}`);
  }
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkEvidence(full, depth + 1));
      continue;
    }
    files.push(full);
  }
  return files;
}


export { verbFreeze, walkEvidence };
