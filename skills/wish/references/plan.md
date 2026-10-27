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

Before the first correction edit, keep the reviewer's reproduction as a guard test or QA scenario, write the failed premise in the plan, and list the relevant input and transition axes. Probe each axis at the production entry point, not only at the cited line. Keep regression tests for the original failure and for the neighbouring inputs that must still pass.

## Step 2: The plan file

Write one plan file that holds:

- IS rows: one per property the delivered request must have, each with its success criterion and the affected party it serves.
- COMPANION rows: `COMPANION: <item> <- <request IS row> : <why expected>`, each passing the guards of SKILL.md, Purpose boundary.
- Invariants and known limits: one row per property the change must keep, `INVARIANT: <property> : <the test or QA scenario that shows a violation>`, and one row per limit the change accepts, `LIMIT: <what is not handled> : <why accepted>`. With the IS and COMPANION rows they are the finite contract: a reviewer blocks only on a listed invariant shown violated or a row not delivered, and everything else is a note or a follow-up (SKILL.md, Delegation prompts).
- Gaps: per IS row, the current state, the user impact, and the cause; or "no gap" with the evidence the property already holds.
- User-side QA scenarios: at least one per IS row, run on the real surface, each naming the exact command and one binary pass condition, with the happy case, the failure case, and the evidence path. A scenario that runs a command is a re-runnable script kept with its evidence.
- The IS-row to QA-scenario pairing: which scenario proves which row, so no row is unproven and no scenario is unowned. Step 4 carries this pairing into the goal.
- Wiring: per IS row, the production entry point, the consumer that observes the result, and the code that owns the state or representation it relies on. A helper-only test does not prove production wiring. When two sources could supply a value, tests give them distinct fixture values so the test shows which one was used.
- Transitions: per state or lifetime row, the owner changes, generation changes, and terminal transitions that apply, such as success, rejection, abort before start, and abort while pending. Reuse the component's existing test table if it has one; never add an unrelated test matrix.
- A risk list: one row per behavior the change touches, either `guard: <invariant> : <regression a user would hit> -> <node>` for behaviors that get a test, where the invariant is one of the listed INVARIANT rows or the IS row the test proves, or `no-test: <reason>` for prose or behavior this repository cannot test, naming the QA scenario that covers it. Step 6 makes one mutation per guard row. Flag a row `high-risk` when the behavior involves concurrency, persistence, or state and lifetimes; its node runs the adversarial review of run.md, Step 5.
- The two pinned rules, stated once here and never relaxed: every command pins the task worktree, and commits are serialized.

The Step 3 review challenges any duplicate source of authority: a second parser, a reconstructed path, a duplicate identity, or an enumeration of a domain the change does not own. For each, the plan records the authoritative source or a user-approved known limit.

Before Step 3, run the plan checker from the repository root:

```sh
node skills/wish/scripts/check-plan.mjs <plan file> --repo <repository root>
```

Fix every line it prints and record the command and its output in the plan's review record, and record verbatim every complaint you judged to be a false positive with its reason. It checks that every IS row is named by a QA scenario and every QA scenario by an IS row, that the wiring names an entry point, consumer, and owner whose paths exist or are delivered by an IS row, that every guard row cites a listed INVARIANT or IS row, the COMPANION shape, the transitions of state and lifetime rows, and the two pinned rules. Step 3 stays one architect review and the checker never replaces it.

The checker reads these row shapes; a row in another shape is a complaint, never a silent pass:

- IS rows: one bullet or one IS-table row per property, `- IS-<id> ...`.
- Wiring: `## Wiring` with `- IS-<id>: entry point ..., consumer ..., owner ...`, or IS-table columns headed entry point, consumer, and owner.
- QA scenarios: one bullet or table row per scenario, `- QA-<id> (...) <command> -> PASS iff <observable>`, plus one pairing line `IS-row to QA pairing: IS-<id>, IS-<id> -> QA-<id>; IS-<id> -> QA-<id>`.
- Ranges: `IS-1-IS-4` covers every row between the two ids.
- Invariants: `- INV-<id> <property> : <test or scenario>` or `- INVARIANT: <property> : <test or scenario>`; a risk row cites one of those ids, an IS row, or the invariant's property text: `- guard: <INVARIANT or IS row> : <regression a user would hit> -> <node>`.
- Companions: `COMPANION: <item> <- <IS row> : <why expected>`, or `COMPANION: none.`
- State or lifetime rows: mark them `high-risk (state/lifetime): <IS row>` and list their transitions under `## Transitions`.
- Pinned rules: a `## Pinned rules` section that states the worktree pin and serialized commits.

## Step 3: Architect plan review

Spawn one review with `category: architect`. The prompt follows SKILL.md, Delegation prompts, and carries the evidence rule from there. The reviewer reads the plan against the request and answers OKAY or lists blockers: a blocker is anything that would make the plan fail the request, introduce a regression, or rest on a proof that shows the code does not do what is claimed (a code defect); typos, number errors, and wording or format problems in evidence are correction memos. Because nothing outside the contract can block later, the reviewer also checks that the invariants and known limits cover what the request needs kept. Record one fix per blocker in the plan's review record, then continue; the round is not re-reviewed. If the host lists no architect category, stop and report that as a blocker; name no substitute.

## Step 4: Register the goal

mass-ulw runs only goal-bound work. Create the goal through ulw-loop (`agentToolkit.createGoals`), then register the returned handoff with `create_goal`; never call `create_goal` first with an objective written outside the loop. The loop's `agentToolkit.status().result.evidenceRoot` is `<evidenceRoot>` (resolve a relative root against `result.binding.cwd`); every capture, report, and the follow-up file live under it. Build the brief from the plan's IS rows and the IS-row to QA-scenario pairing as ONE paragraph: line breaks split the brief into separate goals, and the whole request must stay one goal.
