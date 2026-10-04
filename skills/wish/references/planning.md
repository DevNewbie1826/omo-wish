# wish: discovery and plan

Read this when a wish starts, together with the `ulw-plan` skill, which you **MUST** also read now. ulw-plan supplies the planning discipline: the affected users, the ideal state, the gap list, a decision-complete plan, and agent-executed QA. This file specializes it for a request the user has already authorized end to end. Where they conflict, such as the plan-mode pledge, the approval wait, the separate execution session, or the review gate, this file and `SKILL.md` win. You leave this stage when the plan gate passes; then read the files `SKILL.md` lists for execution, starting with `references/execution.md`, relative to the wish skill directory.

## Discovery

Gather evidence before deciding anything: code, git history of paths you'll touch, memory, and earlier session evidence. Identify everyone and everything the result touches, including end users, other developers, and dependent code, and how they use it now and will use it.

Collect as much of that evidence as the request can use, in parallel. When the request touches a library, an external API, or documentation outside the repository, spawn `librarian` to gather the current facts instead of relying on what you remember about them. When the code layout is unfamiliar, spawn `explore` to map it. Run them in the background alongside your own reads, and fold their findings into the plan before deciding anything they could change.

Use that picture to set the boundary, not to grow the request. For each affected party, ask one question: does the original request need to change something for them? If yes, it's part of the ideal state. If no, but you saw real pain, it's a follow-up note.

## The plan

Write one plan file with:

- **Affected users and ideal state.** One IS row per property the delivered request must have, each with its reason. One GAP row per difference from today. Every todo closes a GAP; every IS row has a success criterion.
- **QA scenarios from the users' side.** Each names the real surface, the exact invocation, and the single PASS/FAIL observable.
- **Test decision.** Where runtime behavior changes and the repository can hold tests for it, plan behavioral TDD: which behavior gets a failing test first. Prose, prompts, and docs get read-through QA, never wording tests.
- **Tasks and DAG shape.** Usually one task. Name the nodes, their write scopes, and real dependencies. Don't invent nodes to fill a quota.
- **Out of scope.** Anything discovery surfaced that the request doesn't need.
- **Follow-up file.** The absolute path of `<evidence directory>/follow-ups.md` from `SKILL.md`. Without ulw-loop, record it when you pick the evidence directory. A fresh loop exposes `evidenceRoot` only after it initializes, so keep the plan-before-loop order: hold discovery findings in the plan, then record the path once the root exists, before execution or dispatch. Once the path is recorded, transfer any held findings to that file and apply the memory and disclosure rules. If there are no findings, leave the file absent.

## Minimal plan gate

One gate is enough. Pick the first path that applies:

1. **Native plan-reviewer is genuinely eligible.** The native gate opens only for plans produced by `ulw-plan` under its own recorded conditions. If this run meets them, use one native `plan-reviewer` review per round as `ulw-plan` describes.
2. **Otherwise, a category-based read-only plan review.** Spawn one `task` with `category: "deep-high"` (fall back to `unspecified-high` if unavailable) and a reviewer prompt: read the plan file, check it against the original request and the purpose boundary, answer OKAY or list blockers. Name it in the notes as a category-based plan review, not a plan-reviewer approval.

A `/wish` invocation doesn't open the native gate by itself. Never unlock the gate by hand, and never retry a gate denial. A denial means path 2.

Don't run every native advisory lane or a full review panel. A plan blocker is something that would make the plan fail the request, introduce a regression, or rest on invalid proof. Fix those and review again under the path you used. Native `plan-reviewer` is one-shot and refuses follow-up messages, so each round is a fresh native review session under its own contract. A category-based reviewer gets the delta resubmitted to the same session when that's supported, or a fresh one with the same prompt otherwise. Record other remarks as notes.

## Leaving this stage

When the gate returns OKAY, continue straight into execution. The user already authorized it, so don't stop with a planning-only summary and don't ask for approval again.
