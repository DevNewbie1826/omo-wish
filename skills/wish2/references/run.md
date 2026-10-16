# wish2: execution with mass-ulw

Covers step 5 of the flow (see SKILL.md, The 13 steps).

## Step 5: Run the plan with mass-ulw

Read the mass-ulw skill and its references/planning.md in full before defining any task DAG; never define the DAG first and read later. Then run the plan's nodes under these rules:

### Worktree and nodes

- One dedicated git worktree off main per task; the task keeps it through merge. Every command in every node prompt pins that worktree: `cd <worktree> && ...` or `git -C <worktree> ...`, never a default cwd (pinned rule, plan.md Step 2).
- Split the work so parallel nodes have disjoint write scopes: no two nodes running together write the same file. Add `dependsOn` only for a real dependency: the downstream node reads or writes a file an upstream node writes, or a rule orders them, such as serialized commits or the closing order of review.md.
- Route each node by difficulty with categories the host actually lists; never invent a category or copy a name the host does not offer.
- One node owns a change AND its proof: the node that makes the edit runs the VERIFY that proves it and captures the evidence. Test rules: see SKILL.md, Rules.
- Every node prompt follows SKILL.md, Delegation prompts.
- Every run is bound to the goal registered in plan.md Step 4; mass-ulw requires goal-bound runs.

### Injection check inside the node

For each guard row the node owns, prove its test can fail, inside the same node:

1. Recreate the regression the guard names: revert the fix, or make the one smallest edit that produces it.
2. Run the guard's test once and capture the failing output.
3. Restore the file from backup, check the restore by hash, run the test once more, and capture the passing output.

The evidence set is the injection diff, the failing output, and the passing output after restore. A test that stays green under its injection guards nothing. Run inject, test, restore, and hash-check as one foreground command, never split across tool calls and never in a background session, so no turn can end mid-injection. Never inject into a worktree a reviewer or sibling node may read: inject before the reader starts, or in a private copy of the worktree.

### Commits

Commit after each verified unit. Parallel nodes share one git index, so commits are serialized: chain the committing nodes with `dependsOn`, and each stages only its own unit's files, in the repository's commit style.

### Recovery

- Call errors, where the host or the call failed (no result, tool or provider error, crash, or a node that ended without its named artifacts): resume the same node. Use `send` on a running or resumable child, `retry` on a failed or cancelled node after the run settles, and `amend` for a wrong definition or a completed node that cannot be resumed. Do not redesign the graph for a call error.
- Work failures, where the work genuinely does not meet its criterion: find the cause (a plan problem, a node-instruction problem, or an environment problem), fix that cause, then retry the corrected work.
