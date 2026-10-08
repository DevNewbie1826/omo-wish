# wish: execution

This file covers stage 2. Its required reads are listed in `SKILL.md`, Stages and required reads. Native instructions apply except where `SKILL.md`, Native skills and mode, specializes them.

## One loop goal

Build the brief from the plan's ideal state, success criteria, and stop line. Its success criteria are the plan's IS rows: inside the brief, pair each IS row with the QA scenario or scenarios that prove it, so no IS row is left unproven and no scenario is unowned. Write the brief as ONE paragraph. `createGoals` splits the brief on line breaks, so criteria placed on separate lines become separate goals; a single paragraph keeps them inside the one top-level loop goal for the whole wish (`SKILL.md`, Native skills and mode, ulw-loop row). The todo list that mirrors this ledger is defined in `SKILL.md`, Progress reporting.

From a JS eval cell, use ulw-loop's `agentToolkit.createGoals({ brief })`, then register its returned handoff under `SKILL.md` rule 3.

For wish's same-session completed-aggregate policy, follow the archive procedure in `SKILL.md`, Native skills and mode. Use the existing loop's artifact paths as the sources; the `cmp` checks compare each source with its archived copy. After those checks pass, the SDK call is `agentToolkit.createGoals({ brief, force: true })`.

## Worktree and node design

Create each task's dedicated Git worktree off the integration base, following `SKILL.md`, Task shape and rule 4. Every command in a node prompt **MUST** pin that worktree: use `git -C <worktree> ...` or `cd <worktree> && ...`, never the node's default cwd.

Follow mass-ulw's `references/planning.md` for splitting and dependencies. Wish-specific requirements:

- Split the work as finely as correctness allows, not only the easy parts: small, disjoint nodes run in parallel, and no two parallel nodes share a write scope.
- Route each node by difficulty, not size: a small design decision or edge-heavy node needs a higher-capability worker, and a large mechanical node can go to a cheaper one. This file names no category for a work node; pick the concrete category from the host's list at dispatch (next bullet).
- Use only categories that exist on this host: the categories the `task` tool lists as available. Native skill tables, such as the ones in ulw-plan and mass-ulw, can name categories this host doesn't have, such as `git`; never invent a category or copy one that isn't in that list. Before you call the run's `start`, check every node's category against the list together with mass-ulw's dependency-matrix self-check. A verification node can't catch this: a node with an unknown category fails at dispatch with `plan_unresolved`, and its dependents never run. If one slips through, recover the same run with `amend` to an existing category once the run settles (Concurrency and ownership, rule 1).
- Every node prompt carries all five items: the success criterion the node must meet, the exact VERIFY command or check that proves it, numbered must-do steps, forbidden deviations, and the artifact paths the node must write, such as its verdict file, QA summary, or report. Its stop condition requires those artifacts written and no background command the node started still running. This applies to every node, not only cheap ones.
- Each dependent node's prompt requires it to re-check the specific upstream facts it builds on before trusting them.
- On every completion wake, the lead reads the output against its criterion and checks that every artifact the prompt names exists and is non-empty before counting the node done. A node marked `completed` without them, or with only a progress handoff, is recovered as a call error under Recovery below instead of trusting its claim.
- For a node that owns `guard` rows, the lead also checks each guard's injection check (see Regression tests): the output shows the test, the injection diff, the failing output, and the passing output after restore, and the diff produces the regression the guard names. A missing piece or a mismatched diff is unproven work.
- Keep each production change and its behavioral proof in the same node.
- If the plan introduces a serializing test wrapper or a global test lock, nodes that run tests queue behind it. Record its expected wait cost in the plan, split the nodes to its throughput, and make the wait fail fast: when it would pass a bound the plan sets, the node reports the wait and exits instead of waiting up to the wrapper's cap, and the lead handles that exit under Recovery below.
- Define closing nodes from `references/verification.md`, following `SKILL.md`, Stages and required reads and Task shape.
- Every node prompt follows `SKILL.md`, Delegation prompts.

**One verification node per parallel batch of implementation nodes.** It diffs each node's output from the plan's pinned base SHA, reruns every node's VERIFY, and checks each output against its success criterion. Its difficulty is at least the hardest node in its batch, so it can judge them. It writes its verdict to `<evidenceRoot>/<run-key>/<node-id>-verdict.md`, whose first line is exactly `VERDICT: PASS` or `VERDICT: FAIL`, followed by the reasons. What it checks besides each node's VERIFY is in `references/verification.md`, Batch verification checks. The next batch waits on that verdict, not on `dependsOn` alone: a node counts `completed` whenever its child answers, even with a FAIL report, so a dependency edge never blocks a bad batch by itself.

**The verdict gate is transitive.** Every node downstream of any verification node, transitively, has as its FIRST must-do step: read every upstream verdict file and stop with `BLOCKED: <id> not PASS` unless each first line is `VERDICT: PASS`. A node that needs a prior artifact, such as a PR URL, also checks that the artifact exists before starting. A node that stops with `BLOCKED` exits at once, with that `BLOCKED` line as its final answer: it **NEVER** waits for an upstream verdict to change, and it arms no monitor, alarm, or polling loop to watch for one. Its first must-do step says so explicitly. Whether and when the blocked work resumes is the lead's decision, made after the verdict under Recovery below. A blocked node that resumes on its own acts outside the lead's dispatch and can commit work the lead has already re-dispatched.

On each wake the lead reports the verdict (see `SKILL.md`, Progress reporting). A FAIL is a work failure: follow Recovery below. Never `send` a verification node to fix its own batch, and never `retry` a completed node.

## Commits

A node commits each verified unit inside the task worktree, in the repository's commit style, with only that unit's files staged. Parallel nodes share one Git index, so serialize commits: use a dependent committing node or chain the committing nodes.

## Concurrency and ownership

Parallel nodes, reviewers, and the lead share runs and worktrees. Four rules keep one from corrupting another's work:

1. **Never amend a running run.** `amend` waits until the run settles. Work that must start while a run is still active, such as an extra evidence node, goes into a separate small run with its own run key, gated on the same verdict files; this is the one exception to sequential runs (`SKILL.md`, Task shape). Before reviving a producer with `send`, stop or hold every dependent node that reads its worktree, so no verifier judges a tree that is still being edited.
2. **One foreground command per injection.** An injection driver injects, runs the test, restores the file from a backup, and checks that the restored file's hash matches the backup, all in one foreground shell command, never across separate tool calls, in a background session, or in a detached cell, so a turn that ends early can't leave code injected. Before restoring a file a node left injected, find and stop that node's driver process; a restore under a live driver gets injected again.
3. **No injection where a reviewer reads.** Never inject into a worktree while a reviewer or verification node may read it, whatever the producer's category or model; a node on the host's lowest-capability category or a flash-class model is the riskiest case, because it can end its turn mid-injection. Run injections before the reader starts, or in a private copy of the worktree.
4. **Siblings see each other's edits.** Nodes that share a worktree see each other's mid-edit state. A whole-tree check such as `go vet ./...` or a build that fails in a file outside the node's write scope may have caught a sibling mid-edit: check whether a sibling was writing that file, and rerun after it settles before calling the failure a defect. Don't inject into a package while a sibling's test battery may run it, because the sibling would record the injected failure as its own.

## Regression tests

This section applies where a node changes runtime behavior and the repository can hold tests for it. Three principles govern it, in this order:

1. **Code first.** Write the change before its test.
2. **Once it works, add the tests.** What matters is that the tests exist at the end, not the order they were written in.
3. **Test only externally visible behavior, never internals.** A test breaks only when behavior changes, not when the implementation is refactored.

In this order:

1. Read the existing tests for that behavior first. Note whether they encode the intended behavior, cover the changed path, and pass. For a behavior the plan classifies as left intact, record its reference before editing (`references/planning.md`, The plan, Success criteria).
2. For a bug fix, reproduce the bug before fixing it and capture the failure, through an existing owner test or a real-surface reproduction; any new test comes after the fix under principle 1.
3. Implement the change, and confirm the behavior works on its real surface.
4. For each `guard` row the plan assigns to this node, add or extend one test on the behavior or contract the user relies on. If an existing test already catches the guard's regression, name it and add none: naming an existing test means no NEW test is needed, and the injection check on that test still applies. Only `guard` rows get new tests. A guard's test asserts the outcome the guard intends; a green test that requires the opposite of that outcome, such as one that passes only while an escaped child process survives, is not evidence for that guard.
5. Run the injection check below on each guard's test, new or existing.
6. Clean up only while the same tests stay green.

**Injection check.** Recreate the regression the guard names, run its test once, and capture the failure; then restore, run the test once more, and capture the pass. For a bug fix, revert only the production fix and keep the test; that failing capture is additional proof, not the bug's reproduction, which the pre-fix step above already captured. For new code, make the one smallest edit that produces the guard's regression, such as dropping a condition, shifting a boundary by one, or omitting a return value or side effect. Remove the feature entirely only when the guard is the feature's existence. Don't use a full mutation-testing tool. The evidence is the injection diff, the failing output, and the passing output after restore. A test that stays green under its injection guards nothing and isn't evidence. A green exit alone proves nothing: every run of a guard's test, meaning the injected run, the run after restore, and the combined-verification run, must report a non-zero executed test count with that test named among the executed tests, and the injected run must fail at the assertion that checks the guard's regression, not at an earlier one. An unescaped regex in a `-t`/`-run` filter can skip that test or every test, and some runners, such as `go test -run`, still exit 0. Run every injection under Concurrency and ownership, rules 2 and 3.

**Interleaving check.** When a node changes concurrency, ordering, or subscription identity, each affected interleaving is a `guard` row, added to the plan's risk list when it lacks one, and the same commit adds that guard's test, reproducing the interleaving deterministically, holding each step at a barrier or with an explicit release instead of relying on timing. Cover at least these three: two concurrent requests; a renewal or resubscription under the same ID; and a failure or stale result that arrives after a newer state. The test passes the injection check only when it fails under that interleaving with the fix reverted or the regression injected; failing under a coarse injection, such as removing the protective branch outright, is not enough, because a test that never reaches the interleaving can't catch it.

Use the `debugging` skill only for a bug whose cause isn't confirmed, or when a test stays green under its injection and the reason isn't clear. Don't load it for every node.

Ask of every test you add or touch whether it breaks when the behavior changes or only when the implementation changes. One that breaks only on implementation changes pins detail: rewrite it against the behavior or drop it. Don't pin prose, prompt wording, content hashes, or incidental tunable parameters and call counts. Exact machine or API values that the contract explicitly requires may be tested. Prose, prompt, and docs changes are `no-test` rows: they get read-through QA, never wording tests.

Never delete, weaken, or skip an existing or approved test, and never loosen its assertion to make it pass. If one is removed anyway, including a detail-pinning test dropped under the paragraph above, the node report, the PR body, and the final report each name the removed test, why it was removed, and the evidence that replaces it.

## Findings during execution

Apply `SKILL.md`, The purpose boundary and Follow-up record. That section is canonical for what is in scope, including the companion class and the sibling-bug rule; this file adds no second definition. In-scope findings get a node in the current run or an amendment to it. The lead decides which side each finding falls on and corrects drift under `SKILL.md`, Delegation prompts.

## Recovery

Every failure is one of two kinds, and only the second touches the plan. Keep the original DAG definition object so later amendments build on it.

**Call errors** are failures of the host or the call, not of the work: a node that ended without a result, a tool or provider error, a timeout, a crash, or a node that answered with a progress handoff or `completed` without writing its named artifacts. Resume the same node; don't redesign the graph or the plan.

- Running child: use `send`.
- Completed or `BLOCKED` node whose child can still be resumed: use `send`, after holding every dependent node that reads its worktree (Concurrency and ownership, rule 1).
- Failed or cancelled node after the run settles: use `retry`. It is refused while the run is running (`run_still_active`).
- Completed node that can't be resumed and whose output shows it didn't do the work, or a wrong definition: use `amend` once the run settles (Concurrency and ownership, rule 1); `retry` refuses completed nodes.

**Work failures** are genuine: a verification verdict of `VERDICT: FAIL`, or a criterion the work doesn't meet. After one work failure, stop and record its cause in the loop ledger as one of three classes: a plan problem, a node-instruction problem, or an environment problem. Fix the plan or the node instruction for that cause, then reassign the corrected work to the category that fits it and retry, through `amend` of the failing producer nodes once the run settles or through a correction run. A stronger category doesn't fix a wrong plan. A failure again with the same cause runs the same loop. The loop has no cap; when the same cause class is recorded a third time in a row, send the owner a one-line notice where the run reports progress, and continue. A final-review REVISE is a work failure with its own loop in `references/verification.md`, REVISE.
