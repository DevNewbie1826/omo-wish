# wish: discovery, plan, and goal

Covers steps 1-4 of the flow (see SKILL.md, The 13 steps).

## Step 1: Discovery

Gather facts before deciding anything. Survey, in parallel where you can:

- The code the request touches: layout, existing tests, the real surfaces users go through.
- Git history of the paths you will touch: what changed there recently and why.
- Memory: durable facts, past decisions, and regressions earlier runs caught.
- Earlier session evidence for the same area.

Stop when every open question is answered and two consecutive waves add nothing new. Let the survey range wide enough to name everyone the result touches, then apply the boundary before planning: see SKILL.md, Purpose boundary.

When a review sends work back (step 11), re-run discovery for the cited problem and also sweep variants of the same defect class, ulw explore style: list the axes along which that class varies, probe representative inputs at the real entry point, and group failures by root cause. The sweep lives inside this step; never spawn separate nodes for the sweep or for merging its results.

## Step 2: The plan file

Write one plan file that holds:

- IS rows: one per property the delivered request must have, each with its success criterion and the affected party it serves.
- COMPANION rows: `COMPANION: <item> <- <request IS row> : <why expected>`, each passing the guards of SKILL.md, Purpose boundary.
- Gaps: per IS row, the current state, the user impact, and the cause; or "no gap" with the evidence the property already holds.
- User-side QA scenarios: at least one per IS row, run on the real surface, each naming the exact command and one binary pass condition, with the happy case, the failure case, and the evidence path. A scenario that runs a command is a re-runnable script kept with its evidence.
- The IS-row to QA-scenario pairing: which scenario proves which row, so no row is unproven and no scenario is unowned. Step 4 carries this pairing into the goal.
- A risk list by defect class: one row per behavior the change touches, either `guard: <regression a user would hit> -> <node>` for behaviors that get a test, or `no-test: <reason>` for prose or behavior this repository cannot test, naming the QA scenario that covers it. Each row names its defect class from this list: D1 non-discriminating verification, D2 proof bypasses the real surface or revision, D3 verdict contradicts its artifact, D4 fake or fixture diverges from the real contract, D5 fix-induced regression, D6 boundary, saturation, or empty input, D7 resource ownership and cleanup, D8 state sampling, branch order, or timing, D9 deliverable contradicts the source of truth, D10 superseded requirement not propagated, D11 nondeterministic or load-sensitive test, D12 same-class variant missed.
- The two pinned rules, stated once here and never relaxed: every command pins the task worktree, and commits are serialized.

## Step 3: Architect plan review

Spawn one review with `category: architect`. The prompt follows SKILL.md, Delegation prompts, and carries the evidence rule from there. The reviewer reads the plan against the request and answers OKAY or lists blockers: a blocker is anything that would make the plan fail the request, introduce a regression, or rest on a proof that shows the code does not do what is claimed (a code defect); typos, number errors, and wording or format problems in evidence are correction memos. Record one fix per blocker in the plan's review record, then continue; the round is not re-reviewed. If the host lists no architect category, stop and report that as a blocker; name no substitute.

## Step 4: Register the goal

mass-ulw runs only goal-bound work. Create the goal through ulw-loop (`agentToolkit.createGoals`), then register the returned handoff with `create_goal`; never call `create_goal` first with an objective written outside the loop. The loop's `agentToolkit.status().result.evidenceRoot` is `<evidenceRoot>` (resolve a relative root against `result.binding.cwd`); every capture, report, and the follow-up file live under it. Build the brief from the plan's IS rows and the IS-row to QA-scenario pairing as ONE paragraph: line breaks split the brief into separate goals, and the whole request must stay one goal.
