# wish: execution

This file covers stage 2. Its required reads are listed in `SKILL.md`, Stages and required reads. Native instructions apply except where `SKILL.md`, Native skills and mode, specializes them.

## One loop goal

Build the brief from the plan's ideal state, success criteria, and stop line. It seeds the one top-level loop goal for the whole wish (`SKILL.md`, Native skills and mode, ulw-loop row).

From a JS eval cell, use ulw-loop's `agentToolkit.createGoals({ brief })`, then register its returned handoff under `SKILL.md` rule 3.

For wish's same-session completed-aggregate policy, follow the archive procedure in `SKILL.md`, Native skills and mode. Use the existing loop's artifact paths as the sources; the `cmp` checks compare each source with its archived copy. After those checks pass, the SDK call is `agentToolkit.createGoals({ brief, force: true })`.

## Worktree and node design

Create each task's dedicated Git worktree off the integration base, following `SKILL.md`, Task shape and rule 4. Every command in a node prompt **MUST** pin that worktree: use `git -C <worktree> ...` or `cd <worktree> && ...`, never the node's default cwd.

Follow mass-ulw's `references/planning.md` for splitting and dependencies. Wish-specific requirements:

- Split all work into small nodes wherever correctness allows, not only the easy parts.
- Route by difficulty, not size: a small design decision or edge-heavy node needs a higher-capability category such as `deep-low` or `deep-high`; a large mechanical node can use `quick`.
- Verify harder, especially for `quick` nodes on small models. Each prompt carries a concrete success criterion and exact VERIFY command. Each `quick` prompt also carries numbered must-do steps and forbidden deviations.
- Each dependent node's prompt requires it to re-check the specific upstream facts it builds on before trusting them.
- On every completion wake, the lead reads the output against its criterion and recovers unproven work under Recovery below, instead of trusting its claim.
- For a node that owns `guard` rows, the lead also checks each guard's injection check (see Regression tests): the output shows the test, the injection diff, the failing output, and the passing output after restore, and the diff produces the regression the guard names. A missing piece or a mismatched diff is unproven work.
- Use only categories that exist on this host: the categories the `task` tool lists as available. Native skill tables, such as the ones in ulw-plan and mass-ulw, can name categories this host doesn't have, such as `git`; never invent a category or copy one that isn't in that list. Before you call the run's `start`, check every node's category against the list together with mass-ulw's dependency-matrix self-check. A verification node can't catch this: a node with an unknown category fails at dispatch with `plan_unresolved`, and its dependents never run. If one slips through, recover the same run with `amend` to an existing category.
- Keep each production change and its behavioral proof in the same node.
- Define closing nodes from `references/verification.md`, following `SKILL.md`, Stages and required reads and Task shape.
- Every node prompt follows `SKILL.md`, Delegation prompts.

## Commits

A node commits each verified unit inside the task worktree, in the repository's commit style, with only that unit's files staged. Parallel nodes share one Git index, so serialize commits: use a dependent committing node or chain the committing nodes.

## Regression tests

This section applies where a node changes runtime behavior and the repository can hold tests for it. The order of writing code and tests is free; the result is what's checked.

1. Read the existing tests for that behavior first. Note whether they encode the intended behavior, cover the changed path, and pass.
2. For a bug fix, reproduce the bug before fixing it and capture the failure, through an existing owner test, a new test, or a real-surface reproduction.
3. Implement the change, and confirm the behavior works on its real surface.
4. For each `guard` row the plan assigns to this node, add or extend one test on the behavior or contract the user relies on. If an existing test already catches the guard's regression, name it and add none. Only `guard` rows get new tests.
5. Run the injection check below on each guard's test, new or existing.
6. Clean up only while the same tests stay green.

**Injection check.** Recreate the regression the guard names, run its test once, and capture the failure; then restore, run the test once more, and capture the pass. For a bug fix, revert only the production fix and keep the test. For new code, make the one smallest edit that produces the guard's regression, such as dropping a condition, shifting a boundary by one, or omitting a return value or side effect. Remove the feature entirely only when the guard is the feature's existence. Don't use a full mutation-testing tool. The evidence is the injection diff, the failing output, and the passing output after restore. A test that stays green under its injection guards nothing and isn't evidence.

Use the `debugging` skill only for a bug whose cause isn't confirmed, or when a test stays green under its injection and the reason isn't clear. Don't load it for every node.

Ask of every test you add or touch whether it breaks when the behavior changes or only when the implementation changes. One that breaks only on implementation changes pins detail: rewrite it against the behavior or drop it. Don't pin prose, prompt wording, content hashes, or incidental tunable parameters and call counts. Exact machine or API values that the contract explicitly requires may be tested. Prose, prompt, and docs changes are `no-test` rows: they get read-through QA, never wording tests.

## Findings during execution

Apply `SKILL.md`, The purpose boundary and Follow-up record. In-scope findings get a node in the current run or an amendment to it. The lead decides which side each finding falls on and corrects drift under `SKILL.md`, Delegation prompts.

## Recovery

A host transport failure (timeout, dropped child) is recovered in place, not by redesigning the graph. Keep the original DAG definition object so later amendments build on it.

- Running child: use `send`.
- Failed or cancelled node after the run settles: use `retry`. It is refused while the run is running (`run_still_active`).
- Completed node whose output shows it didn't do the work, or a wrong definition: use `amend`; `retry` refuses completed nodes.
