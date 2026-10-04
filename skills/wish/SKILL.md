---
name: wish
description: "Runs a user-authorized /wish request end to end inside its original purpose: bounded discovery, one plan with a minimal plan gate, one ulw loop goal, worktree DAG execution with behavioral TDD, QA, PR, and a final ultrabrain review. Use when the /wish command or the user names this skill."
metadata:
  short-description: Bounded wish orchestration over ulw-plan, ulw-loop, and mass-ulw
---

# wish

A `/wish` invocation is the user's request plus authorization to plan, implement, verify, open a PR, pass review, merge, and clean up, without asking again for phases already covered. This file is the governing contract. The three references specialize the native skills `ulw-plan`, `ulw-loop`, and `mass-ulw` for each stage.

Resolve every reference-document path in this skill relative to the directory of this SKILL.md. SDK and work-artifact paths, such as the follow-up file, follow their own rules below. The skill registration gives that directory; never guess an install location. Read native skills from the locations the available skill list gives.

## Stages and required reads

Move through the stages in order. Read each reference and each native skill at the timing below, not before.

1. **Discovery and plan.** Required reads at entry: `references/planning.md` and the `ulw-plan` skill. Survey context and history, name the affected users and the ideal state inside the boundary, list the gaps, define QA scenarios from the users' perspective, write one plan, and pass the minimal plan gate described there. Leave this stage when the plan gate passes.
2. **Execution.** Required reads when the plan gate passes, in this order: `references/execution.md`; the `ulw-loop` skill, before seeding the goal; the `mass-ulw` skill and its `references/planning.md` in full, then `references/verification.md`, before defining any task DAG, since the DAG's closing nodes follow it. Seed the loop from the plan, create a worktree per task, and run the work through mass-ulw with behavioral TDD. Leave this stage when the task's production nodes have settled.
3. **Verification, PR, and review.** These are the DAG's closing nodes, already defined from `references/verification.md`, and they run after the production nodes. Follow that reference through combined QA, PR, review, merge, verification of the merged result, and cleanup.

Loop back rather than restart: a REVISE returns to stage 2 with a correction run in the same worktree and PR, then comes back to stage 3. The loop ends at APPROVED and a merged, verified result.

## Non-negotiable rules

These rules hold for every model and every request size. Breaking one is a defect, not a judgment call. The `/wish` request is the user's explicit instruction to run this flow, so a generic preference for doing small work directly doesn't override them.

1. **Read every required file at its stage entry.** The stage list names them. You **MUST** open each one in this run; having read this file, a summary, or an earlier run's copy doesn't count. If a required native skill is missing from the available skill list, stop and report it as a blocker. **NEVER** reconstruct its procedure from memory.
2. **Report the reads.** The first handoff of each stage names the files you read for it.
3. **The goal comes only from ulw-loop.** Create it with `agentToolkit.createGoals` through the ulw-loop SDK, then register the returned handoff with `create_goal`. **NEVER** call `create_goal` before that, or with an objective written outside the loop.
4. **Changes to the task's files run only in DAG nodes.** Every edit, test write, and fix, including REVISE fixes, happens inside a `workflow` node defined through mass-ulw and working in the task's worktree. The lead plans, drives runs, reviews, merges, and cleans up; it **NEVER** edits the task's files itself, in the main session or the main checkout, however small the change.
5. **NEVER define a DAG before reading mass-ulw's `references/planning.md` in full.**
6. **Gate order holds.** **NEVER** open the PR before combined verification passes, and **NEVER** merge before the ultrabrain review returns APPROVED.

## The purpose boundary

The original request is the boundary for every stage: discovery, plan, TDD, QA, and review.

- Discovery may look wide to find who and what the result touches. Wide discovery doesn't authorize solving every affected party's discomfort.
- The ideal state is the state where the original request is fully delivered with no regression it introduces. Don't widen it into a general improvement of the product.
- A finding is **in scope** when it shows the request isn't delivered, the change introduces a regression (including a failing test or a stale doc of code this change touched), or the proof is invalid. Fix it autonomously, inside the same task.
- A finding is **out of scope** otherwise, including real pre-existing bugs. Don't fix it. Record it as a follow-up (next section).
- When impact is **uncertain**, run the smallest check that decides it. If the check shows it affects the request, it's in scope. An unrelated hypothetical that can't be decided may become a follow-up with what was tried. Uncertainty that keeps you from proving the request is delivered, or that the change introduced no regression, is invalid evidence, not a follow-up: verify it adequately or report an honest blocker. Deferring it never turns a criterion into a PASS.

## Follow-up record

The **follow-up file** is `<evidenceRoot>/follow-ups.md`, where `evidenceRoot` is `agentToolkit.status().result.evidenceRoot`. Resolve a relative root against `result.binding.cwd`, never the installed skill directory or `currentAttemptDir`.

Until the loop initializes and `evidenceRoot` exists, hold findings in the plan file. Once it exists, record one absolute path in the plan before execution or dispatch, then transfer any held findings to that file. Every later finding, memory entry, and final report reuses that path.

Each record contains the finding, reproduction, evidence, impact, and exclusion reason. Later attempts reuse the same file and keep its existing records. The loop ledger only indexes progress, verdicts, and evidence references; it never replaces the follow-up file. Create the file only when a real finding exists.

Workers report findings and append them when they can write the file; the lead saves a persistent memory entry with a short summary, why the finding wasn't fixed in this work, and the follow-up file path. Memory is an index; the follow-up file keeps the detail.

Out-of-scope findings **MUST** also appear in the final report. For each one give the finding, its impact, why it wasn't fixed now, and its follow-up file path. If there were none, say so explicitly and don't create empty records. A note in a file alone isn't disclosure.

## Native skills and mode

Assume ultrawork is active. The wish plugin may have armed it for this request, or the user armed it earlier. Don't arm it again, reset it, or disarm it from here. Every wish runs ulw-loop in stage 2. If ultrawork mode is not active, this skill still governs.

This skill doesn't outrank system or developer instructions, later explicit user requests, or gates a tool actually enforces. This file and its references are the workflow for this authorized request; the specializations in the table take over wherever native defaults conflict. Original-purpose scope, the approved plan-to-execution transition, QA evidence reuse, and the final review **MUST** follow this file's procedures. **NEVER** expand the scope under a conflicting default, add a duplicate approval step, rerun unaffected verification mid-run, or add an extra product-review panel.

### Where wish specializes a native default

| Native default | Wish rule |
| --- | --- |
| ulw-plan: plan mode is sticky; pledge, approval brief and wait, separate execution session | `/wish` is the approval; no pledge or wait; continue in this session. ulw-plan's planning discipline (ideal state, IS/GAP rows, decision-complete plan, explore before asking, agent-executed QA per todo, test strategy) and its owner-decision rule stay: genuine owner-decisions (irreversible, destructive, spend) are still asked, and an explicit user request to be interviewed is honored |
| ulw-plan: native plan-reviewer gate opens only for its own recorded plans | Wish's minimal gate: native plan-reviewer only when genuinely eligible, otherwise one category-based read-only review (see `references/planning.md`, Minimal plan gate) |
| Ultrawork bootstrap: goal and notepad | No goal or notepad at bootstrap; the stage 1 plan file holds notes; stage 2 ulw-loop creates the goal and its ledger is the notepad (see rule 3 for registration) |
| ulw-loop: separate goal per phase or task | One top-level loop goal for the whole wish; tasks and runs live inside it. mass-ulw already registers no second goal under ulw-loop; wish agrees |
| ulw-loop: completed aggregate requires a fresh session | Wish deliberately reuses the same session: archive `goals.json`, `ledger.jsonl`, and `brief.md` to `.omo/ulw-loop/archive/<name>/`, verify with `cmp`, then `createGoals({ force: true })`; never `addGoal` onto a completed aggregate (see `references/execution.md`, One loop goal) |
| mass-ulw: one run per phase | A task's work runs as sequential runs (see Task shape); a correction is a new run in the same worktree |
| Ultrawork: conditional reviewer loop, at most two re-reviews then ask the user | Minimal plan gate, then one mandatory ultrabrain final review; REVISE rounds are delta-scoped, each by a new reviewer, and unlimited until APPROVED (deliberate owner decision; see `references/verification.md`, REVISE) |
| Ultrawork: tests only when the repo keeps them and a regression would pass unnoticed; no RED/GREEN mandate | Wish keeps behavioral TDD where runtime behavior changes and the repo can hold tests (see `references/execution.md`, Behavioral TDD) |
| ulw-loop: evidence bound to tree hash, rerun at current HEAD when the tree differs | Wish decides reruns per target (see `references/verification.md`, Evidence reuse per target); loop evidence records and the final checkpoint come from the final full pass on the merged result, so the loop's tree rule is never bypassed |
| Ultrawork: blast-radius fix versus tracked issue | Same split (see The purpose boundary); the follow-up record plus its memory entry is the tracked issue |

Still applies: every compatible native rule applies in full - evidence capture, cleanup receipts, asynchronous waiting, never suppressing failures, verification rigor, recording regressions caught and QA invocations in memory, per-target evidence reuse and the one final full pass (ultrawork agrees).

## Task shape

- One requested purpose is one task. Per pre-merge delivery, it has one worktree, one PR, and one branch; gaps are nodes, not tasks.
- Its work runs as one or more **sequential** workflow runs (mass-ulw phases): the initial run, then runs defined from what earlier runs proved, such as polish, REVISE corrections, and post-merge fixes. **NEVER** split a task into parallel runs for speed; concurrency comes from parallel nodes inside a run.
- Create a second task only for work with a different purpose. Tasks are independent when neither can affect the other's correctness; when that's unclear, keep one task.
- Across the wish, the task is the unit of parallelism. Large work splits into tasks only along the purpose lines above; a large single-purpose request stays one task.
- Independent tasks run concurrently. A dependent task starts after its prerequisite merges. Approved merges happen one at a time without waiting on unrelated tasks.
- In the run that precedes merge, the task's closing order is combined verification -> PR -> ultrabrain review.
- A post-merge failure continues the same task's purpose: create a new worktree off the merged base, run the fix, open its own PR, and get ultrabrain review. It isn't a second-purpose task.

## Delegation prompts

Before dispatch, every implementation, QA, and review assignment **MUST** explicitly contain all four items below. **NEVER** rely on the child having read the parent conversation or shared skill:

- Purpose: the original requested outcome.
- Scope: this assignment's permitted work.
- Blockers: goal failure, introduced regression, and invalid proof; state all three, including in implementation and QA assignments.
- Separate findings: report unrelated findings instead of fixing them or treating them as blockers; follow Follow-up record.

The lead owns the boundary. When a child drifts, reporting unrelated work as required or widening its own scope, correct it with a follow-up message or a re-scoped prompt. Don't accept that work as a requirement.

For command paths, see `references/execution.md`, Worktree and node design.

## Progress reporting

Keep the todo list current for the whole run. At every node and stage transition, update the todo state (start, done, append, drop) and report it to the user in a short handoff naming what just finished, what is running, and what comes next. Never let the todo list lag behind the loop ledger or the DAG run.

## Finish

Stop when the requested work is merged, the full verification set passes on the merged result, task worktrees and merged task branches are removed, and the report is delivered. For report contents, see `references/verification.md`, Final report checklist; for out-of-scope disclosure, see Follow-up record.

Always respond in the user's language. Agent prompts stay in English.
