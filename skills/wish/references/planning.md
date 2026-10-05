# wish: discovery and plan

This file covers stage 1. Its required reads are listed in `SKILL.md`, Stages and required reads. It specializes ulw-plan as `SKILL.md`, Native skills and mode, describes.

## Discovery

Gather evidence before deciding anything: code, git history of paths you'll touch, memory, and earlier session evidence. Identify everyone and everything the result touches, including end users, other developers, and dependent code, and how they use it now and will use it.

Collect as much of that evidence as the request can use, in parallel. When the request touches a library, an external API, or documentation outside the repository, spawn `librarian` to gather the current facts instead of relying on what you remember about them. When the code layout is unfamiliar, spawn `explore` to map it. Run them in the background alongside your own reads, and fold their findings into the plan before deciding anything they could change.

Use that picture to set the boundary, not to grow the request. For each affected party, ask one question: does the original request need to change something for them? If yes, it's part of the ideal state. If no, but you saw real pain, it's a follow-up note.

## The plan

Write one plan file with:

- **Affected users and ideal state.** One IS row per property the delivered request must have, each with its reason. One GAP row per difference from today. Every todo closes a GAP; every IS row has a success criterion.
- **QA scenarios from the users' side.** Each names the real surface, the exact invocation, and the single PASS/FAIL observable.
- **Risk list.** One row per behavior the change touches:
  - `guard: <regression a user would hit> -> <node> [<existing test path::name>, when one already catches it]`
  - `no-test: <reason>`, where the reason is exactly one of: the change is prose, a prompt, or docs (read-through QA, never wording tests); or the behavior can't be tested in this repository, so QA scenario `<id>` covers it.
  A guard names a regression a user would hit, never an implementation step. Behavior not on the list gets no new test.
- **Tasks and DAG shape.** Usually one task. Name the nodes, their write scopes, and real dependencies. Don't invent nodes to fill a quota.
- **Out of scope.** Anything discovery surfaced that the request doesn't need.
- **Follow-up file.** Follow the path and timing in `SKILL.md`, Follow-up record.

## Minimal plan gate

One gate is enough. Pick the first path that applies:

1. **Native plan-reviewer is genuinely eligible.** The native gate opens only for plans produced by `ulw-plan` under its own recorded conditions. If this run meets them, use one native `plan-reviewer` review per round as `ulw-plan` describes.
2. **Otherwise, a category-based read-only plan review.** Spawn one `task` with `category: "deep-high"` (fall back to `unspecified-high` if unavailable) and a reviewer prompt: read the plan file, check it against the original request, the purpose boundary, and the risk-list rules, answer OKAY or list blockers. Name it in the notes as a category-based plan review, not a plan-reviewer approval.

A `/wish` invocation doesn't open the native gate by itself. Never unlock the gate by hand, and never retry a gate denial. A denial means path 2.

Don't run every native advisory lane or a full review panel. A plan blocker is something that would make the plan fail the request, introduce a regression, or rest on invalid proof. For the risk list, that means a regression a user would plainly hit has neither a guard row nor a valid `no-test` row, a guard names an implementation step instead of a regression, or a `no-test` reason is outside the allowed list. Fix those and review again under the path you used. Every review round goes to a new reviewer, never back to the one that reviewed the last round, so no reviewer re-reads its own verdict. Native `plan-reviewer` is one-shot anyway, so each round is a fresh native review session under its own contract. A category-based round spawns a fresh `task` with the same reviewer prompt plus the delta, the blockers the last round cited, and the already-approved parts marked out of scope. Record other remarks as notes.

## Leaving this stage

When the gate returns OKAY, continue straight into execution under `SKILL.md`, Stages and required reads, stage 2. Don't stop with a planning-only summary or ask for a second approval (see `SKILL.md`, Native skills and mode).
