# wish: discovery and plan

This file covers stage 1. Its required reads are listed in `SKILL.md`, Stages and required reads. It specializes `ulw-plan` the way `SKILL.md`, Native skills and mode, describes.

## Discovery

Gather evidence before deciding anything: code, git history of paths you'll touch, memory, and earlier session evidence.

From the start, spawn `explore` and `librarian` in parallel, in the background, several of each when the request has several open questions, code areas, or outside sources, and over-collect: a finding that goes unused costs less than a decision made without a fact a lane would have found. `explore` maps a code layout you don't know. `librarian` gathers the current facts for a library, an external API, or documentation outside the repository, instead of relying on what you remember about them. Run them alongside your own reads, and fold their findings into the plan before deciding anything they could change. Stop collecting only when both hold: every open question is answered, and two consecutive waves have added nothing new.

Name everyone and everything the result touches, and how they use it, in four explicit steps before applying the boundary: (1) name every party the result touches, including code and programs, other developers, and end users; (2) how each uses it now; (3) how each will use it after the change; (4) where each snags today or what bothers them. These four steps become the plan's affected-parties table.

Use that picture to set the boundary, not to grow the request. Apply `SKILL.md`, The purpose boundary: the request and the COMPANION items the requester would naturally expect done together are in scope, and everything else is a follow-up note (`SKILL.md`, Follow-up record).

## The plan

Write one plan file with:

- **Affected parties and ideal state.** The affected-parties table Discovery produced, one row per party. One IS row per property the delivered request must have, stated so that, from the affected party's view, nothing snags, feels odd, regresses, or degrades, and each with its reason. Every IS row has a success criterion.
- **Success criteria.** Classify each behavior the change touches before writing its criterion. A behavior the request changes, such as a bug fix, a restore, or new code, is verified against intent: the spec or requirement. A behavior the change must leave intact, including persisted state and side effects such as scheduled jobs, queues, and stored records, is verified against a reference recorded before the change: what the code does today, the actual value, even where it looks wrong. Record that reference before editing, as an observation rather than a test written first, then prove the change preserves it; never substitute your own idea of the correct value. A criterion names the observable behavior, not an exact assertion line: an earlier assertion in the same flow can fire first and make the criterion unsatisfiable. A criterion over records compares them by identity, not count (`references/verification.md`, Combined verification).
- **Gaps.** Every IS row has either a GAP row or `no gap` with the evidence that the property is already met. A GAP row has three columns: current state | user impact (required) | cause (if known).
- **Todos.** Every todo is a checkbox that lists the GAP it closes, its method, the reason for that method, the files it writes, and its prerequisites.
- **COMPANION rows.** In-scope items beyond the request itself, of the same grain the requester would naturally expect done together, one per row as `COMPANION: <item> <- <request IS row> : <why expected>` (`SKILL.md`, The purpose boundary). Each passes guards (a)-(d); anything that fails one is out of scope.
- **QA scenarios from the users' side.** At least one scenario per IS row, each with the reason it proves that row. A scenario names the real surface, the exact invocation, the single PASS/FAIL observable, the happy case and the failure case, and the evidence path. A scenario proves only the steps it actually performed: a rehearsal that skips, stubs, or assumes a step it claims, such as a reconnect or a restore, is invalid evidence for that step, and its artifact must show the state after that step. Every criterion and scenario must be satisfiable in principle. On a live system that keeps writing, such as a running daemon's state directory or logs, a check like "the file list and mtimes are identical before and after" fails whether or not QA touched it; prove non-interference instead with an isolated-sandbox proof (the QA ran in its own temporary directory, config, socket, and port, and its writes landed there) and a no-deploy proof (the live processes' PIDs and start times and the deployed binary's hash are the same before and after, and no QA command names a live path). Each scenario that runs a command, a harness, or a comparator is a re-runnable script, committed or kept with its evidence, never a hand-assembled transcript, and carries a control that can fail (`references/verification.md`, Combined verification); a read-through scenario for a prose, prompt, or docs change (Risk list, `no-test`) records what was read against which source.
- **Risk list.** One row for each behavior the change touches, in one of two forms:
  - `guard: <regression a user would hit> -> <node> [<existing test path::name>, when one already catches it]`
  - `no-test: <reason>`, where the reason is exactly one of: the change is prose, a prompt, or docs (read-through QA, never wording tests); or the behavior can't be tested in this repository, so QA scenario `<id>` covers it. When the row rests on a claim about behavior, such as restart or recovery, it names the source that establishes the claim.

  A guard names a regression a user would hit, never an implementation step. Only `guard` rows get new tests (see `references/execution.md`, Regression tests).
- **Defect classes.** The classes from Defect classes below that apply to this change, each with the plan's answer to its check question.
- **Tasks and DAG shape.** Usually one task. Name the nodes, their write scopes, and real dependencies. Don't invent nodes to fill a quota. Route each node by difficulty against the categories the host lists (`references/execution.md`, Worktree and node design); name no category here. If the plan introduces a serializing test wrapper or a global test lock, record its expected wait cost here (`references/execution.md`, Worktree and node design).
- **Out of scope.** Anything discovery surfaced that the request doesn't need.
- **Follow-up file.** Follow the path and timing in `SKILL.md`, Follow-up record.
- **Plan review record.** Each blocker the plan review cites, with the fix made for it and where the fix lives, as `<blocker> -> <fix> -> <where>` (`references/verification.md`, Final ultrabrain review).

## Defect classes

These are failure classes past wish runs let through to late review. Each is a check question. At planning, pick the classes that apply to the change and answer their questions in the plan; skip the rest. Each class has one stage that checks it: the plan review (Plan review below), the batch verification node (`references/verification.md`, Batch verification checks), or the final review (`references/verification.md`, Final ultrabrain review). When a later run finds a failure class this table lacks, append it with its check question and stage.

| ID | Class | Check question | Checked at |
| --- | --- | --- | --- |
| D1 | Non-discriminating verification | Can this check fail when the defect it names is present, and is there current evidence of it failing, such as an injection or mutation, rather than a single PASS? | Plan review |
| D2 | Proof bypasses the real surface, target, or revision | Does the command or capture run against the claimed target, such as the remote, the live surface, the stated viewport, or the commit under review, rather than a cache, proxy, script, or older revision? | Plan review |
| D3 | Verdict contradicts its own artifact | Does each verdict match the actual text of the artifact it cites? | Batch verification |
| D4 | Fake or fixture diverges from the real contract | Does each test double behave like the real contract it stands for, and does each hard-coded fixture value come from the production constant? | Plan review |
| D5 | Fix-induced regression | Does the fix change adjacent behavior, boundaries included, and does an existing or new guard cover that change? | Batch verification |
| D6 | Boundary, saturation, or empty input | At a capacity limit, a size budget, or an empty or missing input, does the behavior follow the contract instead of silently dropping something? | Plan review |
| D7 | Resource ownership and cleanup | On cancel, failure, or confirmed end, does the owner release each process, connection, socket, lock, or file, without killing a shared resource? | Batch verification |
| D8 | State sampling, branch order, or timing | Does each state comparison use the previous sample rather than a high-water mark, does the branch order keep every due outcome reachable, and does each assertion run after parsing or rendering completes? | Batch verification |
| D9 | Deliverable contradicts the source of truth | Do docs, the PR body, completion reports, and UI text match the actual behavior and source, with no claim stronger than its evidence and nothing invented? | Final review |
| D10 | Superseded requirement not propagated | If the requirement changed during the work, do the implementation, tests, and docs prove the latest one rather than the superseded contract? | Plan review |
| D11 | Nondeterministic or load-sensitive test | Does the test give the same result alone, repeated, and in the full suite under load? | Batch verification |

## Plan review

One review round, by `category: "architect"`. Spawn one `task` with that category and a reviewer prompt: read the plan file, check it against the original request, `SKILL.md`, The purpose boundary, and the rules above, and answer OKAY or list blockers. If `architect` is not in the host's category list, stop and report that as a blocker; name no substitute. A wish plan has no native `plan-reviewer` path.

Don't run every native advisory lane or a full review panel. A plan blocker is something that would make the plan fail the request, introduce a regression, or rest on invalid proof. For the risk list, that means a regression a user would plainly hit has neither a `guard` row nor a valid `no-test` row, a guard names an implementation step instead of a regression, or a `no-test` reason is outside the allowed list. A COMPANION row that fails a guard (a)-(d), or a plainly expected item missing both as an IS or COMPANION row and as a reasoned follow-up, is also a blocker (`SKILL.md`, The purpose boundary). So is a criterion or scenario that can't be met in principle (The plan, QA scenarios from the users' side). So is an applicable class from Defect classes, checked at the plan review, whose question the plan leaves unanswered.

Fix every cited blocker in the plan and record it in the plan's Plan review record. The round is not re-reviewed; the final ultrabrain review checks these fixes (`references/verification.md`, Final ultrabrain review). Before execution starts, the lead re-reads the plan once and confirms that each recorded fix is actually in it; that check is not a second review round. Record other remarks as notes.

## Leaving this stage

When the one architect round has returned and every blocker it cited has a recorded fix, continue straight into execution under `SKILL.md`, Stages and required reads, stage 2. Don't stop with a planning-only summary or ask for a second approval (see `SKILL.md`, Native skills and mode).
