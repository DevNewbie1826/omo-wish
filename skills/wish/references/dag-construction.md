> Read this when you build, change or check any DAG: decomposition, dependencies, convergence and the checks.

# DAG construction

Decompose top-down from the goal to atomic tasks. Run each atomic task as soon as its real preconditions hold. Converge results bottom-up, one level at a time, each verified and integrated by its direct parent.

## Three relationships

Keep these separate; never let one stand in for another.

- **Classification**: which parent a task belongs to. Every task except the goal has exactly one direct parent. It implies no execution order.
- **Execution dependency**: task B needs something task A produces or changes. Add one only for a real precondition: data, state, a resource, or a file both tasks write. It always has a direction.
- **Convergence**: where a result goes to be verified and integrated. Always to the task's direct parent, never past it.

## Procedure

1. **Define the goal.** State its inputs, output, constraints and completion condition. Size the DAG to the request: a small request gets a small DAG.
2. **Decompose recursively.** Split each composite task into semantically distinct subtasks. Split further only when splitting helps independent execution, parallelism, verification, error isolation or management. Stop when it no longer helps. Branches may differ in depth; never fix the depth or the number of subtasks in advance.
3. **Check coverage.** The subtasks of each parent cover all of its responsibility, with no omission and no duplicated responsibility, and each subtask has a clear deliverable. If integrating the subtask results cannot meet the parent's completion condition, add the missing execution task or redo the split.
4. **Confirm the atomic tasks.** Each leaf has one responsibility, defined inputs and preconditions, a defined output, an executor that can actually do it, a pass/fail check, and known dependencies. A short description does not make a task atomic; being splittable into smaller actions does not make it non-atomic. Redefine or split any leaf that fails.
5. **Prune levels.** Keep a level only if it has a purpose: its own scope of responsibility, a grouping of related subtasks, a boundary for verification and integration, for error isolation or for recovery, or an intermediate deliverable the level above needs. Remove or merge any level that has none of these.
6. **Add execution dependencies.** Add them between tasks only for real preconditions (see Three relationships), so every independent task can run in parallel. Never order tasks because they share a parent or sit at the same level. When an item's next step needs only that item's result, chain it per item; wait for a whole set only when the step needs every result together (dedup, merge, comparison).
7. **Define convergence.** Each parent, once the results it needs are ready, collects its children's results, checks their input/output contracts, finds missing or failed results, checks the results against each other, integrates them, checks its own completion condition, and only then passes its result up. When integrating needs its own execution (merging edits, running tests on the combined result), make it a task. When it only collects and checks, it is the parent's own check, not a separate task.
8. **Plan failure handling.** A failed task reports to its direct parent, which retries, recovers or propagates the failure. A parent with an unrecovered failure that blocks its completion condition is not successful, and its result does not go up as verified. Failure and recovery status also move up one level at a time. A failure never stops independent tasks.
9. **Check and fix.** Check the DAG against Three relationships, Checks and Forbidden structures. Fix each violation and check everything again. Run only a DAG that passes. The goal is complete only when its predefined completion condition is met.

## Checks

A DAG that fails any item is invalid.

- Every composite task is decomposed until further splitting has no real benefit, and every leaf is atomic.
- Every task except the goal has exactly one direct parent; the subtasks of each parent cover its responsibility with no omission or duplication.
- Every level has a purpose from step 5.
- Every execution dependency rests on a real precondition, and no tasks are serialized without one.
- Classification and execution dependencies are both acyclic, and the dependency graph has a valid topological order.
- Every result converges through its direct parent and goes up only after that parent verified and integrated it.
- Every task has inputs, preconditions and a completion condition, and every failure has a handling path.
- No duplicate execution or misrouted result can contaminate a result.

## Forbidden structures

- A leaf result connected directly to the top-level result, skipping intermediate levels.
- One final node that integrates results from several levels at once, or verifies at the top without lower-level verification.
- Flat convergence: leaves of a task with intermediate levels all feeding one final integration node.
- A convergence path that bypasses an existing intermediate level.
- Nominal levels added to match a depth or to balance branches, the same responsibility repeated on several levels, integration tasks with nothing real to verify or integrate, and chains of pass-through nodes.
- Order forced without a real dependency, or tasks split so small that coordination costs more than it saves.

Removing a level never permits skipping one that still exists, and no level is added just for form.
