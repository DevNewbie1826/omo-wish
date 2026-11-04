import { switchRepeats } from "../schema.mjs";
import { stateMismatch } from "./core.mjs";
import { roundsOf, switchesOf } from "./ledger.mjs";
import { LANE_KINDS, satisfiesLane } from "./blocking.mjs";

// -------------------------------------------------------------- stage machine

// The dispatchable stages, in order (design §2.2 + addendum §C.3). Side events
// ('gate', 'round', 'verdict', 'switch', 'progress', 'reuse', 'resume') are not
// stages: they record a decision or a measurement, never a step to dispatch.
export const STAGE_ORDER = Object.freeze([
  "intake", "collect", "define", "before", "plan", "plan_lint",
  "plan_review", "decide", "goal", "build", "verify_lane", "triage", "fix", "freeze",
  "pr_open", "round", "merge", "post_merge", "checkpoint", "cleanup",
]);

// A stage is attempted when the ledger has its event; 'verify_lane' is also
// attempted when any lane receipt exists, because a lane may write its evidence
// before the session records the event.
function stageAttempted(stage, events, receipts, unit) {
  if (events.some((event) => event.event === stage && event.unit === unit)) return true;
  if (stage === "verify_lane") {
    // The same evidence satisfiesLane accepts counts as an attempt: a typed receipt
    // (claim-gate, vqa-capture, lint) is verification evidence with no stage event.
    return receipts.some((receipt) => receipt.body?.unit === unit
      && (receipt.body.kind === "lane"
        ? receipt.body.stage === "verify_lane"
        : LANE_KINDS.has(receipt.body.kind)));
  }
  return false;
}

function defectGaps(gaps) {
  return (gaps ?? []).filter((row) => row.kind === "defect");
}

function blockingFindings(findings) {
  return (findings ?? []).filter((row) => row.blocking === "1"
    && ["open", "not-fixed", "no-command"].includes(row.status));
}

function isDone(events, unit) {
  return events.some((event) => event.unit === unit && event.event === "cleanup"
    && Array.isArray(event.cleanup) && event.cleanup.length > 0);
}

export function deriveStage(events, receipts, unit) {
  if (isDone(events, unit)) return "done";
  let furthest = -1;
  for (const stage of STAGE_ORDER) {
    if (stageAttempted(stage, events, receipts, unit)) furthest = STAGE_ORDER.indexOf(stage);
  }
  return furthest === -1 ? "intake" : STAGE_ORDER[furthest];
}

// Applicability: a conditional stage is skipped when the data that would make it
// necessary is absent (LIM3). Everything else is always on the path.
function stageApplies(stage, context) {
  const { events, gaps, findings, type } = context;
  switch (stage) {
    case "before":
      return defectGaps(gaps).length > 0 || events.some((event) => event.event === "before");
    case "build":
      return type !== "audit"; // addendum §C.5: audit has no BUILD
    case "fix":
      return blockingFindings(findings).length > 0 || events.some((event) => event.event === "fix");
    default:
      return true;
  }
}

function nextLinear(stage, context) {
  const from = stage === "done" ? STAGE_ORDER.length : STAGE_ORDER.indexOf(stage) + 1;
  for (let index = Math.max(from, 0); index < STAGE_ORDER.length; index += 1) {
    if (stageApplies(STAGE_ORDER[index], context)) return STAGE_ORDER[index];
  }
  return "done";
}

// One decision table, in the order a session asks: the merge tail, then a REVISE
// (which returns to the first invalid step of the same unit), then the linear
// path. 'switch' may be next: a cap is a switch signal, never an exit (§9.4).
export function deriveNext(stage, context) {
  const { events, findings, frozenHead, head, unit } = context;
  if (stage === "done") return "done";
  const rounds = roundsOf(events, unit);
  const last = rounds[rounds.length - 1];
  if (last && last.verdict === "APPROVED") {
    const merged = events.some((event) => event.event === "merge" && event.unit === unit);
    if (!merged) {
      // A verdict covers only the head it judged: a set frozen head the branch left, or a
      // verdict a later freeze passed, is unreviewed content and answers the re-review path.
      if (head && frozenHead && frozenHead !== head) return "freeze";
      if (head && !verdictCoversHead(context)) return context.lanes.ok ? "round" : "verify_lane";
      return "merge";
    }
    const posted = events.some((event) => event.event === "post_merge" && event.unit === unit);
    if (!posted) return "post_merge";
    const checkpoint = [...events].reverse().find((event) => event.event === "checkpoint" && event.unit === unit);
    if (!checkpoint || checkpoint.checkpoint_op !== "complete") return "checkpoint";
    return nextLinear("checkpoint", context);
  }
  if (last && last.verdict === "REVISE") {
    for (const revisit of ["define", "plan", "plan_lint"]) {
      if (!events.some((event) => event.unit === unit && event.event === revisit && event.round === last.round)) {
        return revisit;
      }
    }
    if (!context.lanes.ok) return "verify_lane";
    if (blockingFindings(findings).length > 0) return "fix";
    if (frozenHead !== head) return "freeze";
    const switched = switchesOf(events, unit).some((event) => event.round === last.round);
    if (last.round >= 3 && !switched && switchRepeats(findings, last.round) !== false) return "switch";
    if (codeReviewMissing(context)) return "verify_lane";
    return "round";
  }
  if (!last && frozenHead && (!context.lanes.ok || codeReviewMissing(context))) return "verify_lane";
  return nextLinear(stage, context);
}

// Tree reuse cannot substitute for review of the exact frozen commit.
export function codeReviewAt(receipts, unit, head) {
  return receipts.filter((receipt) => receipt.ok && receipt.body?.kind === "lane"
    && receipt.body.stage === "verify_lane" && receipt.body.lane === "code-review"
    && receipt.body.unit === unit && receipt.body.head === head
    && ["PASS", "WARN"].includes(receipt.body.status));
}

function codeReviewMissing({ receipts, requiredLanes, unit, frozenHead, tree }) {
  return requiredLanes.includes("code-review")
    && (!frozenHead || !codeReviewAt(receipts, unit, frozenHead).some((receipt) => receipt.body.tree === tree));
}

// A verdict is valid only for the head it reviewed: it covers the frozen head and the
// observed one, and the round it closes is only complete once that review says APPROVED.
function lastRoundOf(context) {
  const rounds = roundsOf(context.events, context.unit);
  return rounds[rounds.length - 1];
}

function verdictCoversHead(context) {
  const last = lastRoundOf(context);
  if (!last) return false;
  return (!context.frozenHead || last.head === context.frozenHead)
    && (!context.head || last.head === context.head);
}

function approvedCoversHead(context) {
  return lastRoundOf(context)?.verdict === "APPROVED" && verdictCoversHead(context);
}

export function requireCodeReview(context) {
  if (codeReviewMissing(context)) {
    if (!context.frozenHead) throw stateMismatch("out of stage order: freeze missing before round");
    throw stateMismatch(`out of stage order: code-review missing at ${context.frozenHead.slice(0, 7)}`);
  }
}

// M0's required-lane table names lanes whose receipt kind is not always "lane": a
// research claim gate writes kind "claim-gate", a design capture kind "vqa-capture",
// an audit lint kind "lint". A typed receipt for the same lane is evidence for it.

export { approvedCoversHead, blockingFindings, codeReviewMissing, defectGaps, isDone, lastRoundOf, stageApplies, verdictCoversHead };
