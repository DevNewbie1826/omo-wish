# wish: discovery and plan

This file covers stage 1. Its required reads are listed in `SKILL.md`, Stages and required reads. It specializes `ulw-plan` the way `SKILL.md`, Native skills and mode, describes.

## Discovery

Gather evidence before deciding anything: code, git history of paths you'll touch, memory, and earlier session evidence.

From the start, spawn `explore` and `librarian` in parallel, in the background, and collect as much of that evidence as the request can use. `explore` maps a code layout you don't know. `librarian` gathers the current facts for a library, an external API, or documentation outside the repository, instead of relying on what you remember about them. Run them alongside your own reads, and fold their findings into the plan before deciding anything they could change. Stop collecting when every open question is answered, or when two waves add nothing new.

Name everyone and everything the result touches, and how they use it, in four explicit steps before applying the boundary: (1) name every party the result touches, including code and programs, other developers, and end users; (2) how each uses it now; (3) how each will use it after the change; (4) where each snags today or what bothers them. These four steps become the plan's affected-parties table.

Use that picture to set the boundary, not to grow the request. Apply `SKILL.md`, The purpose boundary: the request and the COMPANION items the requester would naturally expect done together are in scope, and everything else is a follow-up note (`SKILL.md`, Follow-up record).

## The plan

Write one plan file with:

- **Affected parties and ideal state.** The affected-parties table Discovery produced, one row per party. One IS row per property the delivered request must have, stated so that, from the affected party's view, nothing snags, feels odd, regresses, or degrades, and each with its reason. Every IS row has a success criterion.
- **Gaps.** Every IS row has either a GAP row or `no gap` with the evidence that the property is already met. A GAP row has three columns: current state | user impact (required) | cause (if known).
- **Todos.** Every todo is a checkbox that lists the GAP it closes, its method, the reason for that method, the files it writes, and its prerequisites.
- **COMPANION rows.** In-scope items beyond the request itself, of the same grain the requester would naturally expect done together, one per row as `COMPANION: <item> <- <request IS row> : <why expected>` (`SKILL.md`, The purpose boundary). Each passes guards (a)-(d); anything that fails one is out of scope.
- **QA scenarios from the users' side.** At least one scenario per IS row, each with the reason it proves that row. A scenario names the real surface, the exact invocation, the single PASS/FAIL observable, the happy case and the failure case, and the evidence path.
- **Risk list.** One row for each behavior the change touches, in one of two forms:
  - `guard: <regression a user would hit> -> <node> [<existing test path::name>, when one already catches it]`
  - `no-test: <reason>`, where the reason is exactly one of: the change is prose, a prompt, or docs (read-through QA, never wording tests); or the behavior can't be tested in this repository, so QA scenario `<id>` covers it.

  A guard names a regression a user would hit, never an implementation step. Only `guard` rows get new tests (see `references/execution.md`, Regression tests).
- **Tasks and DAG shape.** Usually one task. Name the nodes, their write scopes, and real dependencies. Don't invent nodes to fill a quota. Route each node by difficulty against the categories the host lists (`references/execution.md`, Worktree and node design); name no category here.
- **Out of scope.** Anything discovery surfaced that the request doesn't need.
- **Follow-up file.** Follow the path and timing in `SKILL.md`, Follow-up record.
- **Plan review record.** Each blocker the plan review cites, with the fix made for it and where the fix lives, as `<blocker> -> <fix> -> <where>` (`references/verification.md`, Final ultrabrain review).

## Plan review

One review round, by `category: "architect"`. Spawn one `task` with that category and a reviewer prompt: read the plan file, check it against the original request, `SKILL.md`, The purpose boundary, and the rules above, and answer OKAY or list blockers. If `architect` is not in the host's category list, stop and report that as a blocker; name no substitute. A wish plan has no native `plan-reviewer` path.

Don't run every native advisory lane or a full review panel. A plan blocker is something that would make the plan fail the request, introduce a regression, or rest on invalid proof. For the risk list, that means a regression a user would plainly hit has neither a `guard` row nor a valid `no-test` row, a guard names an implementation step instead of a regression, or a `no-test` reason is outside the allowed list. A COMPANION row that fails a guard (a)-(d), or a plainly expected item missing both as an IS or COMPANION row and as a reasoned follow-up, is also a blocker (`SKILL.md`, The purpose boundary).

Fix every cited blocker in the plan and record it in the plan's Plan review record. The round is not re-reviewed; the final ultrabrain review checks these fixes (`references/verification.md`, Final ultrabrain review). Record other remarks as notes.

## Leaving this stage

When the one architect round has returned and every blocker it cited has a recorded fix, continue straight into execution under `SKILL.md`, Stages and required reads, stage 2. Don't stop with a planning-only summary or ask for a second approval (see `SKILL.md`, Native skills and mode).
