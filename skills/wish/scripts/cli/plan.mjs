import { readLedger, readPlan, resolvePlanPath, stateMismatch, unitLedgerFacts } from "../lib/store.mjs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

function planFor(root, parsed, { planless = false, missingPlanReason = null } = {}) {
  const events = readLedger(root);
  const planPath = resolvePlanPath(events, parsed.get("--plan"));
  // Planless mode serves ledger append (including round), status, gate --round
  // dispatch and freeze --check; freeze and pr-body still need the plan for
  // front matter writes and body rendering respectively. It runs only after
  // resolvePlanPath has resolved the unit's plan path: when that
  // file no longer exists the ledger's own intake is the identity, never a
  // guess. When the plan exists the planful path runs first and every refusal
  // fires exactly as before (INV1).
  if (planless && !existsSync(planPath)) {
    return { plan: planFromLedger(events, planPath), events, planPath, fromLedger: true };
  }
  if (missingPlanReason && !existsSync(planPath)) throw stateMismatch(`needs the plan file: ${missingPlanReason}`);
  return { plan: readPlan(planPath), events, planPath };
}

// The ledger-derived identity for a planless read (§9.3): the unit is the intake
// whose plan equals the resolved path. run_id is never guessed — an intake that
// predates the identity keys fails closed naming run_id (the pre-change ledger
// limit), and so does a resolved path no intake claims.
function planFromLedger(events, planPath) {
  const intakes = events.filter((event) => event?.event === "intake"
    && typeof event.plan === "string" && resolve(event.plan) === planPath);
  if (intakes.length === 0) {
    throw stateMismatch(`no intake names the plan ${planPath}: the unit cannot be identified without the plan file`);
  }
  const named = intakes.filter((event) => typeof event.run_id === "string" && event.run_id !== "");
  const units = new Set(intakes.map((event) => event.unit));
  const runIds = new Set(named.map((event) => event.run_id));
  if (units.size > 1 || runIds.size > 1) {
    throw stateMismatch(`the ledger records several identities for the plan ${planPath}: the unit is ambiguous without the plan file`);
  }
  const intake = named[named.length - 1];
  if (!intake) {
    throw stateMismatch(`the intake for ${planPath} records no run_id: a ledger written before planless identity needs its plan file`);
  }
  const unit = intake.unit;
  const { pr, frozen_head, round } = unitLedgerFacts(events, unit);
  return {
    wish: {
      run_id: intake.run_id,
      tier: intake.tier,
      type: intake.type,
      unit,
      program_id: intake.program_id ?? null,
      worktree: intake.worktree ?? null,
      branch: intake.branch ?? null,
      pr,
      frozen_head,
      round,
    },
    body: "",
    path: planPath,
  };
}

// -------------------------------------------------------------------- verbs


export { planFor };
