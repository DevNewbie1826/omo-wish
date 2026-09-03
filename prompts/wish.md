---
description: 소원을 빕니다
---
$ARGUMENTS

Use ultrawork explore to analyze the overall context and history of the work, assess the current problems and key decision points based on evidence, and define the ideal state as one concrete top-level goal. This goal and the Phase, review, and merge execution principles below MUST remain the governing criteria until the entire work is complete.

Apply the system-provided tool execution and eval policies consistently throughout the entire run.

Divide all work required to achieve this top-level goal into multiple Phases, and execute each Phase sequentially through an ulw loop.

For each Phase, MUST create a new dedicated Git worktree, define the concrete tasks to perform and their scope, then use mass ulw to implement, validate, test, and open a PR.

Afterward, have ultrabrain review the changes. If revisions are requested, decompose the feedback into tasks that can be handled independently and dispatch as many deep agent workers in parallel as possible. Integrate the results, have ultrabrain review the combined changes again, and repeat this parallel review/fix loop until final approval.

NEVER merge the PR before ultrabrain gives final approval. Once approved, merge it and move to the next Phase. Continue the ulw loop until all Phases are complete and the top-level goal is fully satisfied.

Always respond in the user's language.
