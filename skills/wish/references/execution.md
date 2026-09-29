# wish: execution

Read this when the plan gate passes. It composes `ulw-loop` (goal, evidence, checkpoints) and `mass-ulw` (DAG runs). Read those skills' own instructions for their APIs; this file only says how wish uses them. Also read `verification.md` before you define a task's DAG, because the DAG's closing nodes (combined verification, PR, ultrabrain review) follow it. Those nodes still execute only after the production nodes settle.

## One loop goal

Seed exactly one ulw loop goal from the plan: the ideal state, the success criteria, and the stop line. Tasks are execution units inside it. Don't create a goal per task or per phase, and don't start a second loop.

## One worktree and one DAG per task

For each task, create a dedicated Git worktree off the integration base, then read the mass-ulw planning reference and define one DAG:

- Split into independent nodes wherever correctness allows. Parallel nodes need disjoint write scopes; dependent nodes run in order.
- Keep each production change and its behavioral proof in the same node.
- End the DAG with combined verification including the task's QA scenarios, then PR creation, then the ultrabrain review, in that order.
- Every node prompt follows the delegation rule in `SKILL.md`: original request, scope, blocker definition, report out-of-scope findings.

Independent tasks run their DAGs at the same time. A dependent task starts only after its prerequisite merges.

## Behavioral TDD

Where a node changes runtime behavior and the repository can hold tests for it:

1. Read the existing tests for that behavior first. Note whether they encode the intended behavior, cover the changed path, and pass. If existing coverage already fails for the regression in question, use it and add no new test.
2. RED: otherwise write the test for the behavior the user will see. Run it once against the unchanged code and capture the failure.
3. GREEN: make the smallest change that meets it. Run the same test once and capture the pass.
4. REFACTOR: clean up only while the same tests stay green, so behavior is preserved.

A test must be able to fail for the regression it names. Don't pin prose, prompt wording, content hashes, implementation details, or incidental tunable parameters and call counts. Exact machine or API values that the contract explicitly requires may be tested. Markdown and prompt changes get read-through QA instead, and nobody fakes a RED for them.

## Findings during execution

Apply the boundary from `SKILL.md`. In-scope findings get a node in the current DAG, or an amendment to it. Out-of-scope findings go to the follow-up list with evidence, reproduction, impact, and why they were excluded. Workers report findings; the lead decides which side they fall on.

## Recovery

A host transport failure (timeout, dropped child) is recovered in place with the run's retry or send, not by redesigning the graph. Keep the original DAG definition so later amendments build on it.
