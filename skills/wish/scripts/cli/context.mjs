import { identityType, stateMismatch, usage } from "../lib/store.mjs";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function resolveRootValue(explicit) {
  const value = explicit ?? process.env.WISH_EVIDENCE_ROOT;
  if (!value) throw usage("no evidence root: pass --root <ER> or set WISH_EVIDENCE_ROOT");
  return resolve(value);
}

function resolveRoot(parsed) {
  return resolveRootValue(parsed.get("--root"));
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


export { findingOptions, git, headArg, identityOf, mixedLabelsOf, observeWorktree, readInput, resolveRoot, sessionId, unitContext, withLabels };
