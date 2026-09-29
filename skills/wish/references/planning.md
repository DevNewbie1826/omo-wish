# wish: discovery and plan

Read this when a wish starts. It specializes `ulw-plan` for a request the user has already authorized end to end. You leave this stage when the plan gate passes; then read `references/execution.md`, relative to the wish skill directory.

## Discovery

Gather evidence before deciding anything: code, git history of paths you'll touch, memory, and earlier session evidence. Identify everyone and everything the result touches, including end users, other developers, and dependent code, and how they use it now and will use it.

Use that picture to set the boundary, not to grow the request. For each affected party, ask one question: does the original request need to change something for them? If yes, it's part of the ideal state. If no, but you saw real pain, it's a follow-up note.

## The plan

Write one plan file with:

- **Affected users and ideal state.** One IS row per property the delivered request must have, each with its reason. One GAP row per difference from today. Every todo closes a GAP; every IS row has a success criterion.
- **QA scenarios from the users' side.** Each names the real surface, the exact invocation, and the single PASS/FAIL observable.
- **Test decision.** Where runtime behavior changes and the repository can hold tests for it, plan behavioral TDD: which behavior gets a failing test first. Prose, prompts, and docs get read-through QA, never wording tests.
- **Tasks and DAG shape.** Usually one task. Name the nodes, their write scopes, and real dependencies. Don't invent nodes to fill a quota.
- **Out of scope.** Anything discovery surfaced that the request doesn't need.

## Minimal plan gate

One gate is enough. Pick the first path that applies:

1. **Native plan-reviewer is genuinely eligible.** The native gate opens only for plans produced by `ulw-plan` under its own recorded conditions. If this run meets them, use one native `plan-reviewer` review per round as `ulw-plan` describes.
2. **Otherwise, a category-based read-only plan review.** Spawn one `task` with `category: "deep-high"` (fall back to `unspecified-high` if unavailable) and a reviewer prompt: read the plan file, check it against the original request and the purpose boundary, answer OKAY or list blockers. Name it in the notes as a category-based plan review, not a plan-reviewer approval.

A `/wish` invocation doesn't open the native gate by itself. Never unlock the gate by hand, and never retry a gate denial. A denial means path 2.

Don't run every native advisory lane or a full review panel. A plan blocker is something that would make the plan fail the request, introduce a regression, or rest on invalid proof. Fix those and review again under the path you used. Native `plan-reviewer` is one-shot and refuses follow-up messages, so each round is a fresh native review session under its own contract. A category-based reviewer gets the delta resubmitted to the same session when that's supported, or a fresh one with the same prompt otherwise. Record other remarks as notes.

## Leaving this stage

When the gate returns OKAY, continue straight into execution. The user already authorized it, so don't stop with a planning-only summary and don't ask for approval again.
