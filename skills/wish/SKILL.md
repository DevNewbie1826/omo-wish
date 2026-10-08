---
name: wish
description: "Runs a user-authorized /wish request end to end inside its original purpose and companion scope: bounded discovery, one plan with a single architect plan review, one ulw loop goal, worktree DAG execution with risk-based regression tests, QA, PR, and a final ultrabrain review. Use when the /wish command or the user names this skill."
metadata:
  short-description: Bounded wish orchestration over ulw-plan, ulw-loop, and mass-ulw
---

# wish

A `/wish` invocation is the user's request plus authorization to plan, implement, verify, open a PR, pass review, merge, and clean up, without asking again for phases already covered. This file is the governing contract. The three references specialize the native skills `ulw-plan`, `ulw-loop`, and `mass-ulw` for each stage.

Resolve every reference-document path in this skill relative to the directory of this `SKILL.md`. SDK and work-artifact paths, such as the follow-up file, follow their own rules below. The skill registration gives that directory; never guess an install location. Read native skills from the locations the available skill list gives.

## Stages and required reads

Move through the stages in order. Read each reference and each native skill at the timing below, not before.

1. **Discovery and plan.** Required reads at entry: `references/planning.md` and the `ulw-plan` skill. Survey context and history, name the affected users and the ideal state inside the boundary, list the gaps, define QA scenarios from the users' perspective, write one plan, and pass the single architect plan review in `references/planning.md`, Plan review. Right after the plan is written, register its full todo list (`SKILL.md`, Progress reporting). Leave this stage when the one architect round has returned and every cited blocker has a recorded fix under that procedure.
2. **Execution.** Required reads when stage 1's exit condition holds, in this order:
   1. `references/execution.md`.
   2. The `ulw-loop` skill, before seeding the goal.
   3. The `mass-ulw` skill, then its `references/planning.md` in full, before defining any task DAG.
   4. `references/verification.md`, also before defining any task DAG, because the DAG's closing nodes (stage 3) and the checks of its batch verification nodes are defined from it.

   Seed the loop from the plan, create a worktree per task, and run the work through mass-ulw with risk-based regression tests. Leave this stage when the task's production nodes have settled.
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
7. **Record only what you've checked.** A record (ledger entry, memory entry, follow-up record, plan, PR body, report, or node prompt) states a fact that can be checked outside the session, such as who did something, a commit SHA, a branch, a PR, or a file, only after checking it. A SHA names a commit only when `git cat-file -t <sha>` prints `commit`; a blob or tree hash, or a SHA no repository knows, is not a commit. An action is the owner's only when the owner's own message or an artifact the owner produced, such as a commit the owner authored, shows it; work done by this session or its children is never attributed to the owner. When the check fails or can't run, record only what was observed, such as a file hash and the path where it was seen.

## The purpose boundary

The original request and its companion items are the boundary for every stage: discovery, plan, tests, QA, and review.

- Discovery may look wide to find who and what the result touches. Wide discovery doesn't authorize solving every affected party's discomfort.
- The ideal state is the state where the request IS rows and COMPANION rows are fully delivered with no regression the change introduces. **NEVER** widen it into a general improvement of the product.
- **In scope** means the request IS rows plus COMPANION rows: those planned from the start, or items found later that pass guards (a)-(c) below and are then added as a COMPANION row under guard (d). A planned COMPANION row not delivered is "request not delivered", just like an unmet request IS row.
- A **companion** item is the same grain as the change and something the requester would naturally expect done together. Ask: "Would the requester look at the PR and ask why this was not done?" It must pass these guards:
  - **(a) One hop only.** Attach it directly to a request IS row, **NEVER** to another companion.
  - **(b) No new owner decision.** Anything the user must choose is not companion; ask the decision or record a follow-up.
  - **(c) Same task and PR.** Anything needing a separate task is not companion.
  - **(d) Visible in the plan.** Record each as `COMPANION: <item> <- <request IS row> : <why expected>`.
- Same-pattern pre-existing bugs at sibling locations found while fixing are companion items under these guards, not unrelated follow-ups.
- A finding is **in scope** when it shows an IS or COMPANION row isn't delivered, the change introduces a regression (including a failing test or a stale doc of code this change touched), or the proof is invalid. Fix it autonomously, inside the same task. For a newly found companion, add its row as above and fix it in that task.
- Everything else is **out of scope**, including unrelated pre-existing bugs. **NEVER** fix it in this task. Record it under `SKILL.md`, Follow-up record.
- When impact is **uncertain**, run the smallest check that decides it. If the check shows it affects the request, it's in scope. An unrelated hypothetical that can't be decided may become a follow-up with what was tried. Uncertainty that keeps you from proving the request is delivered, or that the change introduced no regression, is invalid evidence, not a follow-up: verify it adequately or report an honest blocker. Deferring it never turns a criterion into a PASS.

## Follow-up record

The **follow-up file** is `<evidenceRoot>/follow-ups.md`, where `evidenceRoot` is `agentToolkit.status().result.evidenceRoot`. Resolve a relative root against `result.binding.cwd`, never the installed skill directory or `currentAttemptDir`.

Until the loop initializes and `evidenceRoot` exists, hold findings in the plan file. Once it exists, record one absolute path in the plan before execution or dispatch, then transfer any held findings to that file. Every later finding, memory entry, and final report reuses that path.

Each record contains the finding, reproduction, evidence, impact, and exclusion reason, including why it is not companion: name which guard (a)-(d) it fails under `SKILL.md`, The purpose boundary. Later attempts reuse the same file and keep its existing records. The loop ledger only indexes progress, verdicts, and evidence references; it never replaces the follow-up file. Create the file only when a real finding exists.

Workers report findings and append them when they can write the file; the lead saves a persistent memory entry with a short summary, why the finding wasn't fixed in this work, and the follow-up file path. Memory is an index; the follow-up file keeps the detail.

Out-of-scope findings **MUST** also appear in the final report. For each one give the finding, its impact, why it wasn't fixed now, and its follow-up file path. If there were none, say so explicitly and don't create empty records. A note in a file alone isn't disclosure.

## Native skills and mode

Assume ultrawork is active. The wish plugin may have armed it for this request, or the user armed it earlier. Don't arm it again, reset it, or disarm it from here. Every wish runs ulw-loop in stage 2. If ultrawork mode is not active, this skill still governs.

This skill doesn't outrank system or developer instructions, later explicit user requests, or gates a tool actually enforces. This file and its references are the workflow for this authorized request; the specializations in the table take over wherever native defaults conflict. Original-purpose scope, the approved plan-to-execution transition, QA evidence reuse, and the final review **MUST** follow this file's procedures. **NEVER** expand the scope under a conflicting default, add a duplicate approval step, rerun unaffected verification mid-run, or add an extra product-review panel.

### Where wish specializes a native default

| Native default | Wish rule |
| --- | --- |
| ulw-plan: plan mode is sticky; pledge, approval brief and wait, separate execution session | `/wish` is the approval; no pledge or wait; continue in this session. ulw-plan's planning discipline (ideal state, IS/GAP rows, decision-complete plan, explore before asking, agent-executed QA per todo, test strategy, which in wish is the three test principles and the risk list under `references/execution.md`, Regression tests) and its owner-decision rule stay: genuine owner-decisions (irreversible, destructive, spend) are still asked, and an explicit user request to be interviewed is honored |
| ulw-plan: native plan-review gate opens only for its own recorded plans | A single architect plan review under `references/planning.md`, Plan review; that procedure defines blocker fixes, their record, and stage 1's exit |
| Ultrawork: stop exploring after two parallel waves yield no new useful facts | Discovery stops only when every open question is answered and two consecutive waves have added nothing new (see `references/planning.md`, Discovery) |
| Ultrawork bootstrap: goal and notepad | No goal or notepad at bootstrap; the stage 1 plan file holds notes; stage 2 ulw-loop creates the goal and its ledger is the notepad (see `SKILL.md`, Non-negotiable rules, rule 3 for registration) |
| ulw-loop: separate goal per phase or task | One top-level loop goal for the whole wish; tasks and runs live inside it. mass-ulw already registers no second goal under ulw-loop; wish agrees |
| ulw-loop: completed aggregate requires a fresh session | Wish deliberately reuses the same session: archive `goals.json`, `ledger.jsonl`, and `brief.md` to `.omo/ulw-loop/archive/<name>/`, verify with `cmp`, then `createGoals({ force: true })`; never `addGoal` onto a completed aggregate (see `references/execution.md`, One loop goal) |
| mass-ulw: one run per phase | A task's work runs as sequential runs (see `SKILL.md`, Task shape); a correction run is a new run in the same worktree |
| mass-ulw: quick-first ladder, cheap closing verification node | Route by difficulty with host-listed categories only; one verification node per parallel batch at >= the batch's hardest difficulty, gating the next batch by verdict file (see `references/execution.md`, Worktree and node design) |
| Ultrawork: subscribe to every condition you would otherwise check, arming monitors unprompted | A node that the verdict gate stops with `BLOCKED` exits at once and never waits for the verdict: no monitor, alarm, or polling loop. The lead decides whether and when that work resumes (see `references/execution.md`, Worktree and node design) |
| Ultrawork: conditional reviewer loop, at most two re-reviews then ask the user | The single architect plan review under `references/planning.md`, Plan review, then one mandatory ultrabrain final review; REVISE rounds are delta-scoped, each by a new reviewer, and unlimited until APPROVED (deliberate owner decision; see `references/verification.md`, REVISE) |
| Ultrawork: after two identical failed attempts at one step, ask the user | The failure loop has no cap: classify each work failure's cause, fix the plan, and retry; when the same cause class is recorded a third time in a row, send the owner a one-line notice and continue (see `references/execution.md`, Recovery) |
| Ultrawork: tests only when the repo keeps them and a regression would pass unnoticed; no RED/GREEN mandate | No RED-first step; code first under the three test principles in `references/execution.md`, Regression tests. That section also governs the plan's risk list, which decides which regressions get a test, and the injection check every guard's test must pass |
| ulw-loop: evidence bound to tree hash, rerun at current HEAD when the tree differs | Wish decides reruns per target (see `references/verification.md`, Evidence reuse per target); loop evidence records and the final checkpoint come from the final full pass on the merged result, so the loop's tree rule is never bypassed |
| Ultrawork: blast-radius fix versus tracked issue | Same split plus COMPANION items (see `SKILL.md`, The purpose boundary); a record in the follow-up file plus its memory entry is the tracked issue (see `SKILL.md`, Follow-up record) |

Still applies: every compatible native rule applies in full - evidence capture, cleanup receipts, asynchronous waiting, never suppressing failures, verification rigor, recording regressions caught and QA invocations in memory, and ultrawork's per-target evidence reuse with one final full pass, which wish shares (the ulw-loop tree-hash rule is the specialized row above).

## Task shape

- One requested purpose is one task. Per pre-merge delivery, it has one worktree, one PR, and one branch; gaps are nodes, not tasks.
- Its work runs as one or more **sequential** runs. A run is one mass-ulw `workflow` DAG (one mass-ulw phase), and its nodes are the DAG nodes in `SKILL.md`, Non-negotiable rules, rule 4. The sequence is the initial run, then runs defined from what earlier runs proved, such as polish, REVISE corrections, and post-merge fixes. **NEVER** split a task into parallel runs for speed; concurrency comes from parallel nodes inside a run. The one exception is a small run for work that must start while a run is still active (`references/execution.md`, Concurrency and ownership, rule 1).
- Create a second task only for work with a different purpose. Tasks are independent when neither can affect the other's correctness; when that's unclear, keep one task.
- Across the wish, the task is the unit of parallelism. Large work splits into tasks only along the purpose lines above; a large single-purpose request stays one task.
- Independent tasks run concurrently. A dependent task starts after its prerequisite merges. Approved merges happen one at a time without waiting on unrelated tasks.
- In the run that precedes merge, the task's closing order is combined verification -> PR -> ultrabrain review.
- A post-merge failure continues the same task's purpose: create a new worktree off the merged base, run the fix, open its own PR, and get ultrabrain review. It isn't a second-purpose task.

## Delegation prompts

Before dispatch, every implementation, QA, and review assignment **MUST** explicitly contain all four items below. **NEVER** rely on the child having read the parent conversation or shared skill:

- Purpose: the original requested outcome.
- Scope: this assignment's permitted work.
- Blockers: goal failure = an IS or COMPANION row not delivered; introduced regression; invalid proof. State all three, including in implementation and QA assignments.
- Separate findings: unrelated means not companion under `SKILL.md`, The purpose boundary. Report those findings instead of fixing them or treating them as blockers; follow `SKILL.md`, Follow-up record.

Every child prompt **MUST** also carry the companion definition, by an explicit pointer to `SKILL.md`, The purpose boundary, or a quote from that section. Node prompt fields, including the success criterion, exact VERIFY, numbered must-do steps, forbidden deviations, and the artifact paths the node must write, follow `references/execution.md`, Worktree and node design.

The lead owns the boundary. When a child drifts, reporting unrelated work as required or widening its own scope, correct it with a follow-up message or a re-scoped prompt. Don't accept that work as a requirement. A reviewer that flags unrelated quality issues is producing follow-up notes, not blockers.

For command paths, see `references/execution.md`, Worktree and node design.

## Progress reporting

The todo list is the run's live, visible checklist; the ulw-loop ledger stays its durable state. Right after the plan is written, register the full todo list: one task per atomic work unit, starting from the plan's todos (`references/planning.md`, The plan, Todos), each saying where it works, why, how it is done, and how it is verified. Mark a task started the instant its step begins and done the instant it finishes, append each newly found step when it surfaces, and drop abandoned ones. At every stage transition (plan to execution, execution to verification), after each batch, and in each correction round, report to the user in a short handoff naming what just finished, what is running, and what comes next. When each batch verification node finishes, report its verdict on that wake; apply the verdict and failure procedure in `references/execution.md`, Recovery. **NEVER** let the todo list lag behind the loop ledger or the DAG run.

## Answers that don't arrive

A question this run asks the user, through the question tool or a headless RPC host, can lose its answer: the host can fail while delivering the answer and consume the pending question, leaving the session blocked with no answer in it. The answer is delivered only when it appears as a user message in the session transcript; an empty pending-question list is not proof. When it doesn't appear, whoever delivers the answer recovers in this order: abort the session's turn, confirm the session is idle, then send the full answer as a new prompt. While the session is still blocked, don't resend the question response or queue a follow-up; neither is delivered.

The lead treats an answer that arrives as a new prompt after an aborted turn as the answer to its open question and doesn't ask again. Before continuing, it re-reads the loop status and every active run, because the abort may have cut a tool call short.

## Finish

Stop when the requested work is merged, the full verification set passes on the merged result, task worktrees and merged task branches are removed, and the report is delivered. For report contents, see `references/verification.md`, Final report checklist; for out-of-scope disclosure, see `SKILL.md`, Follow-up record.

Always respond in the user's language. Agent prompts stay in English.
