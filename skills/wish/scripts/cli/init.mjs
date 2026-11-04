import { WORK_TYPES, TIERS } from "../lib/schema.mjs";
import { appendEvent, ensureDir, nowIso, readLedger, readPlan, rootPaths, stateMismatch, usage, withLock, writeFrontMatter } from "../lib/store.mjs";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { sessionId, observeWorktree } from "./context.mjs";

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
    // INV5: the ledger's recorded intake binds the unit to its run, so a re-init
    // with a different --run-id must not rebind a ledger whose plan file is gone.
    const ledgerEvents = readLedger(root);
    const recorded = ledgerEvents.find((event) => event.event === "intake" && event.unit === unit);
    if (recorded && typeof recorded.run_id === "string" && recorded.run_id !== runId) {
      throw stateMismatch(`the ledger belongs to another run: ${recorded.run_id}`);
    }
    if (existing) {
      // A second init for the same run is a no-op: rewriting the front matter from
      // these flags would erase values (program_id, unit, branch) that a resume did
      // not repeat on its command line.
      const events = readLedger(root);
      const already = events.find((event) => event.event === "intake" && event.unit === existing.wish.unit);
      if (already) {
        printInitResult({ run_id: runId, root: paths.root, plan: planPath, intake: already, note: "already initialized" });
        return null;
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
    const already = events.find((event) => event.event === "intake" && event.unit === unit);
    if (already) {
      printInitResult({ run_id: runId, root: paths.root, plan: planPath, intake: already, note: "already initialized" });
      return null;
    }
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
      // §9.3: identity is written by init only — run_id always, worktree and
      // branch when the caller named them. A plain `ledger append --event
      // intake` carries identity only when the caller supplies it (no backfill).
      run_id: runId,
      ...(parsed.has("--worktree") ? { worktree } : {}),
      ...(parsed.has("--branch") ? { branch } : {}),
      ...(type === "mixed" ? { primary, secondary } : {}),
    }, { plan: planPath, sessionId: sessionId(parsed) });
    const result = { run_id: runId, root: paths.root, plan: planPath, intake: event, note: "initialized" };
    printInitResult(result);
    return null;
  });
}

function printInitResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}


export { verbInit };
