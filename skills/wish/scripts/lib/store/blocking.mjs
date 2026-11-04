import { RECEIPT_STATUSES, requiredReceiptsFor, switchRepeats, blockingStatus } from "../schema.mjs";
import { identityType, roundsOf, unitLedgerFacts, switchesOf } from "./ledger.mjs";
import { judgeReceipt } from "./gates-receipts.mjs";
import { STAGE_ORDER, defectGaps, blockingFindings, isDone, deriveStage, stageApplies, deriveNext, codeReviewMissing, verdictCoversHead, approvedCoversHead } from "./stages.mjs";

const TYPED_LANES = Object.freeze({ capture: "vqa-capture" });
const LANE_KINDS = new Set(["claim-gate", "vqa-capture", "vqa-passA", "vqa-passB", "lint"]);

function satisfiesLane(receipt, lane) {
  const body = receipt.body;
  if (!body) return false;
  if (body.kind === "lane") return body.stage === "verify_lane" && body.lane === lane;
  if (TYPED_LANES[lane] === body.kind) return true;
  return body.kind === lane;
}

function laneState(context) {
  const { receipts, requiredLanes, head, tree, reuseEvents, unit, identity } = context;
  const missing = [];
  const stale = [];
  const satisfied = [];
  for (const lane of requiredLanes) {
    const candidates = receipts.filter((receipt) => satisfiesLane(receipt, lane) && receipt.body.unit === unit);
    if (candidates.length === 0) {
      missing.push(lane);
      continue;
    }
    const judged = candidates.map((receipt) => ({ receipt, verdict: judgeReceipt(receipt, { type: identity, head, tree, reuseEvents }) }));
    const good = judged.find((entry) => entry.verdict.valid
      && RECEIPT_STATUSES.includes(entry.receipt.body.status)
      && entry.receipt.body.status !== "SKIP"
      && !blockingStatus(entry.receipt.body.status));
    if (good) {
      satisfied.push(good.receipt.name);
      continue;
    }
    const latest = judged[judged.length - 1];
    stale.push({ name: latest.receipt.name, skip: latest.receipt.body.status === "SKIP" });
  }
  return { missing, stale, satisfied, ok: missing.length === 0 && stale.length === 0 };
}

function buildContext({ root, plan, events, receipts, findings, gaps, gates, head, tree, unit }) {
  const wish = plan.wish;
  const mixedLabels = [...events].reverse().find((event) => event.unit === unit
    && typeof event.primary === "string" && typeof event.secondary === "string");
  const primary = mixedLabels?.primary;
  const secondary = mixedLabels?.secondary;
  const identity = identityType(wish.type, primary);
  // design §2.3: an L unit always carries the adversarial lane; below L only a
  // plan-flagged high-risk row does. Any event of this unit that flagged an
  // applicable class counts: a later, unrelated row must not retract it.
  const highRisk = wish.tier === "L"
    || events.some((event) => event.unit === unit && Array.isArray(event.adversarial_classes)
      && event.adversarial_classes.some((entry) => entry?.applicable === true));
  const requiredLanes = requiredReceiptsFor(wish.type, { primary, secondary, highRisk });
  const context = {
    root, type: wish.type, identity, primary, secondary, head, tree, unit, events, receipts, findings, gaps, gates,
    requiredLanes, highRisk,
    reuseEvents: events.filter((event) => event.event === "reuse"),
    frozenHead: wish.frozen_head,
  };
  return { ...context, lanes: laneState(context) };
}

// §11 'blocking': strings in a stable order, so two statuses differ only where
// facts differ. WARN never appears (M0 §4.1) and SKIP never satisfies a lane.
export function blockingFor(context) {
  const { lanes, findings, gates, events, unit, frozenHead, head } = context;
  const reasons = [];
  // A lane only blocks once the unit has reached the verify wave: before that
  // the wave has not been dispatched, so a missing lane is not an obstacle.
  const laneRelevant = STAGE_ORDER.indexOf(context.stage ?? "intake") >= STAGE_ORDER.indexOf("verify_lane")
    || lanes.satisfied.length > 0 || lanes.stale.length > 0;
  if (laneRelevant) {
    for (const entry of lanes.stale) {
      reasons.push((entry.skip ? "receipt-skip:" : "receipt:").concat(entry.name));
    }
    for (const lane of lanes.missing) reasons.push("receipt-missing:".concat(lane));
  }
  const open = blockingFindings(findings);
  if (open.length > 0) reasons.push("findings:".concat(String(open.length), " open"));
  // Two sources, one meaning: an owner question parked in gates.md, and a lane
  // gate (the dispatch table) whose last event is open. Both are fail-closed: an
  // open id from either source blocks, and a resolved gate.md block does not clear an open block
  // with the same id.
  const openGates = new Set(gates.filter((entry) => entry.status === "open").map((entry) => entry.id));
  const latestByGate = new Map();
  for (const event of events) {
    // Another unit's dispatch gate is not this unit's obstacle, and its resolution
    // must not clear this unit's open gate.
    if (event.event === "gate" && event.unit === unit && typeof event.gate_id === "string") {
      latestByGate.set(event.gate_id, event.gate_status);
    }
  }
  for (const [id, status] of latestByGate) {
    if (status === "open") openGates.add(id);
  }
  for (const id of [...openGates].sort()) reasons.push("gate:".concat(id, " open"));
  const rounds = roundsOf(events, unit);
  const last = rounds[rounds.length - 1];
  if (codeReviewMissing(context) && (frozenHead
      || STAGE_ORDER.indexOf(context.stage) >= STAGE_ORDER.indexOf("freeze"))) {
    reasons.push(frozenHead ? `order:code-review missing at ${frozenHead.slice(0, 7)}` : "order:freeze missing before round");
  }
  const verdictTarget = head ?? frozenHead;
  const merged = events.some((event) => event.event === "merge" && event.unit === unit);
  if (!merged && frozenHead && !last) reasons.push("verdict:missing");
  else if (!merged && last && verdictTarget && !verdictCoversHead(context)) {
    reasons.push("verdict:round ".concat(String(last.round), " head does not cover ", verdictTarget.slice(0, 7)));
  }
  if (frozenHead && head && frozenHead !== head) reasons.push("head:moved");
  if (last && last.verdict === "REVISE" && last.round >= 3
      && switchRepeats(findings, last.round) !== false
      && !switchesOf(events, unit).some((event) => event.round === last.round)) {
    reasons.push("round:".concat(String(last.round), " needs an approach switch"));
  }
  return reasons;
}

// Completeness per stage: what 'resume-plan' and the first-invalid answer need.
function stageComplete(stage, context) {
  const { events, unit, gaps, lanes, frozenHead, head } = context;
  const has = (name, predicate) => events.some((event) => event.unit === unit && event.event === name
    && (!predicate || predicate(event)));
  switch (stage) {
    case "intake": return has("intake");
    case "collect": return has("collect", (event) => event.elements > 0);
    case "define": return has("define");
    case "before": return !stageApplies("before", context)
      || defectGaps(gaps).every((row) => row.before_artifact !== "-");
    case "plan": return has("plan");
    case "plan_lint": return has("plan_lint");
    case "plan_review": return has("plan_review", (event) => event.verdict === "OKAY");
    case "decide": return has("decide");
    case "goal": return has("goal");
    case "build": return !stageApplies("build", context) || has("build");
    case "verify_lane": return lanes.ok;
    case "triage": return has("triage");
    case "fix": return !stageApplies("fix", context) || has("fix");
    case "freeze": return Boolean(frozenHead) && has("freeze") && (!head || frozenHead === head);
    case "pr_open": return has("pr_open");
    case "round": return has("round") && !codeReviewMissing(context) && approvedCoversHead(context);
    case "merge": return has("merge");
    case "post_merge": return has("post_merge");
    case "checkpoint": return has("checkpoint", (event) => event.checkpoint_op === "complete");
    case "cleanup": return isDone(events, unit);
    default: return false;
  }
}

export function firstInvalidStage(context) {
  for (const stage of STAGE_ORDER) {
    if (!stageApplies(stage, context)) continue;
    if (!stageComplete(stage, context)) return stage;
  }
  return "done";
}

function unitStatus(context) {
  const stage = deriveStage(context.events, context.receipts, context.unit);
  const enriched = { ...context, stage };
  const { pr, round } = unitLedgerFacts(context.events, context.unit);
  return {
    id: context.unit,
    stage,
    pr,
    round,
    switches: switchesOf(context.events, context.unit).length,
    next: deriveNext(stage, enriched),
    blocking: blockingFor(enriched),
    firstInvalid: firstInvalidStage(enriched),
  };
}


export { LANE_KINDS, buildContext, satisfiesLane, unitStatus };
