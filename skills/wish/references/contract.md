# wish v2 — the finite contract (M2)

This file says what a wish v2 plan promises and what a reviewer may block on. It is one of three references:
`plan-format.md` fixes the plan's grammar and the linter's rules, `ledger.md` fixes the machine shapes, and this
file fixes the boundary every review judges against. When this file and `ledger.md` could disagree,
`ledger.md` wins.

Sources: D = `/tmp/oru-wish-v2/design.md` §2.5–§2.6, §4; A = `/tmp/oru-wish-v2/design-addendum-general.md`
§B4 (device rows), §B5 (unit contract), §C.6 (the cap is a switch); v1 = `skills/wish/SKILL.md:32-56` and
`references/plan.md` at `main` (the contract rows, the companion guards, the reviewer rule).

## 1. What the contract is

The plan's **IS rows** and **COMPANION rows** are the request; its **INVARIANT rows** are what the change must
keep; its **LIMIT rows** are what it knowingly does not handle. Together those four kinds are the finite
contract, and they are the only thing a reviewer may block on (`plan-format.md` §4 has the row grammar):

- An **IS row not delivered** blocks: the request is not delivered.
- A **COMPANION row not delivered** blocks the same way: a planned item the requester would expect in this task
  is missing.
- A listed **INVARIANT shown violated** blocks, and the violation is shown by a failing test — or, for a behavior
  the plan marks `no-test`, by its failing QA scenario.
- A **LIMIT row is not a finding.** A known limit listed in the plan is an accepted part of the contract.
- **Everything else is a note or a follow-up.** Never a blocker: no style preference, no coverage wish, no
  wording, no evidence format.

The plan review (PLAN-REVIEW, §4) judges the contract itself: whether the invariants and limits cover what the
request needs kept (`references/plan.md` Step 3 at `main` is this judgment). Because nothing outside the
contract can block later, a contract with a hole is a contract defect that only that review can catch.

## 2. The unit's contract is the unit's IS rows only

In a program (A §B5) the request is split into units: one unit is one worktree, one branch, one PR. **The
contract of a unit's PR is that unit's IS rows only.** A unit therefore never carries another unit's gap, and a
reviewer of one unit cannot demand another unit's delivery.

Completeness of the whole request is held elsewhere: the register (`ledger.md` §6) is complete when every
`defect` row is `fixed`, `accepted-limit` (backed by a LIMIT row) or `out-of-scope`. One unit's REVISE round
never blocks another unit's merge, because no unit's contract mentions the other.

## 3. Companion rows

A companion item is the same grain as the change and something the requester would naturally expect done
together with it, still inside the request's boundary. It must pass all four guards:

- **(a) One hop.** It is one hop from a request IS row and never chained to another companion.
- **(b) No new owner decision.** It needs no decision the requester has not already made: nothing irreversible,
  destructive or a spend, and no product-visible choice.
- **(c) Same task and PR.** It rides this plan and this PR, never a second one.
- **(d) Recorded.** It is written in the plan as
  `COMPANION: <item> <- <request IS row> : <why expected>` (`plan-format.md` §4.2).

Same-pattern pre-existing bugs at sibling locations, found while fixing, are companions under these guards, not
follow-ups. A late-found item that passes the guards is added to the plan as a COMPANION row and fixed in the
same task. Everything else is out of scope: it is recorded in `<ER>/follow-ups.md` and named in the final
report, never fixed in this task.

## 4. PLAN-REVIEW

PLAN-REVIEW happens once per plan, before the build, and it is never re-reviewed in that round.

- If the plan gate is open — the requester explicitly asked for the ulw-plan flow — PLAN-REVIEW is
  `plan-reviewer`, one-shot and read-only, given the plan path and nothing else.
- Otherwise PLAN-REVIEW is one `category: architect` review of the plan.
- Either way the reviewer answers `OKAY` or lists blockers under §1's definition, and the plan records one fix
  per blocker. A host that offers neither role leaves the review with the session, which states so in the plan's
  review record.

The plan linter (`scripts/check-plan.mjs`) runs before PLAN-REVIEW and never replaces it: the linter checks
grammar, and PLAN-REVIEW judges the contract.

## 5. The reviewer rule

Every reviewer prompt — code-reviewer, ultrabrain, gate-reviewer, architect, and the adversarial review —
carries the following paragraph verbatim. `references/prompts.md` (M5) carries the same paragraph; the two copies
stay byte-identical.

Evidence problems are never a REVISE reason. Typos, number errors, and wording or format problems in evidence or reports do not cause REVISE. Write each one as a correction memo in your report; do not fix the evidence yourself and do not request a re-review for it. Only a problem in CODE can cause REVISE, and only inside the plan's finite contract: a listed invariant violated, shown by a failing test (or, for a behavior the plan marks no-test, by its failing QA scenario), or an IS or COMPANION row not delivered. Report every other finding as a note or a follow-up, never as a blocker; a known limit listed in the plan is not a finding. The plan review of step 3 judges the contract itself and keeps the blocker definition of references/plan.md, Step 3.

That last sentence names `references/plan.md` and its Step 3 because the paragraph is carried verbatim from v1;
in v2 that file is replaced by this one, and step 3's plan review is §4 above.

## 6. A cap is a switch, never an exit

Review has no round ceiling (A §C.6). A third REVISE round forces an approach switch — a `SWITCH:` plan row
(`plan-format.md` §4.5) plus a `switch` ledger event (`ledger.md` §9.4) — and every REVISE after it uses one more
switch kind. Review ends at `APPROVED` and nowhere else; the owner is asked only for a decision that is theirs
(irreversible, destructive, a spend, or a contract-level LIMIT to accept), never for permission to stop
reviewing.