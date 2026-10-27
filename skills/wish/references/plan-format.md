# wish v2 — plan format and its lint (M2)

One wish run writes one plan file at `.omo/plans/wish-<slug>.md`. This file states what that plan contains and
which parts `scripts/check-plan.mjs` checks mechanically. Three references split the contract by question:
`contract.md` says what blocks a reviewer, `ledger.md` fixes the machine shapes (front matter keys, device
grammar, exit codes, class sets), and this file fixes the plan's own grammar and the linter's rule list. Where
this file and `ledger.md` could disagree, `ledger.md` wins and this file has a bug.

Sources: D = `/tmp/oru-wish-v2/design.md` §2.3, §4 (the M2 row); A =
`/tmp/oru-wish-v2/design-addendum-general.md` §B4 (device rows), §B5 (unit contract), §C.1 (per-type
contract rows), §C.6 (switch rows), §F (the M2 delta); U = omo `ulw-plan` `SKILL.md` (the checkbox grammar
and the `## Final verification wave` section); v1 = `skills/wish/references/plan.md` and `SKILL.md:32-44` at
`main` (`IS`/`COMPANION`/`INVARIANT`/`LIMIT` rows, the risk list, the pinned rules); o3 = branch `exp/o3`
`skills/wish/scripts/check-plan.mjs` (the lint experiment this file ports and narrows).

## 1. The document

A plan has four layers, in this order:

1. **Front matter** — the machine identity of the run (`ledger.md` §8.1). The linter parses it and validates it
   with M0's `validatePlanFrontMatter`; it never re-declares a field or a value set.
2. **`## Todos`** — the executable nodes in ulw-plan's checkbox grammar (U). Boulder's continuation hook reads
   these, so a row in another shape is invisible to resume and is a complaint.
3. **`## Final verification wave`** — the final-verifier rows, `F<n>`, same grammar, run once before the PR.
4. **The wish sections** — the contract rows, the QA scenarios, the risk list and the pinned rules. Their
   headings are a reading aid; the linter recognizes these rows by their marker anywhere outside a fenced
   block, so a plan may group them as it likes.

Reading rules the linter applies to every line:

- Only a **column-zero** bullet is a row: it starts with `- ` at column 0. An indented bullet, a table, a
  numbered paragraph, or a heading is prose; `## Todos` and `## Final verification wave` are the only sections
  whose *location* matters.
- A **fenced block** (```` ``` ```` or `~~~`, any info string) is documentation: its lines are never rows. This
  is how a plan quotes an example row.
- CRLF, a trailing newline and a UTF-8 BOM are accepted; they never change a verdict.
- A bullet that starts with a declared marker but does not match that marker's grammar is a **complaint**,
  never a silent skip (rule PL16). Marker words match case-insensitively, so a near miss such as `Device:` or
  `limits:` is a complaint and not prose; prose that must open with one of these words belongs in a fenced
  block or in indented text.

## 2. Front matter

```yaml
---
wish:
  run_id: w-<slug>-<yyyymmdd>-<hhmm>
  tier: S | M | L
  type: code | design | research | audit | mixed
  unit: u1
  program_id: null
  worktree: /absolute/path
  branch: branch-name
  pr: null
  frozen_head: null
  round: 0
---
```

Every key is required, no other key is accepted, and every value is a scalar: a bare or quoted string, an
integer, or the literal `null`. Indentation is two spaces under `wish:`; a nested third level is a complaint.
`ledger.md` §8.1 fixes the meaning of each key and `schema.mjs` fixes the formats, so the linter reports M0's
errors, mapped to the key's own line.

`pr`, `frozen_head` and `program_id` are `null` until they exist. `round` counts completed ultrabrain rounds
and has no ceiling (§C.6): the cap is a switch, never an exit.

`mixed` names a primary and a secondary concrete type in `receipt` and ledger shapes, but `ledger.md` §8.1
does not carry those two keys in the plan front matter, so a mixed plan's rows cannot be attributed to one
concrete type. The linter therefore accepts any concrete device form on a mixed plan (see §6).

## 3. Checkbox rows (ulw-plan grammar)

```
- [ ] 1. <title>
- [ ] F1. <title>
```

Under `## Todos`, each implementation row is `- [ ] <N>. <title>` with a positive decimal `N`. Under
`## Final verification wave`, each final-verifier row is `- [ ] F<n>. <title>`. A row may be checked `- [x]`.
Both section names are exact, both sections are required, each needs at least one row, numbers are unique
within their section, and a task row outside those two sections is a complaint: it would never run.
ulw-plan's optional `Recommended task executor category:` line is not part of this grammar and is not linted;
a playbook may still ask for it.

## 4. Contract rows

Every row below is a column-zero bullet. `; ` separates the fields of a row introduced in v2; the v1 rows keep
their v1 shape so plans and quotations stay recognizable.

### 4.1 IS rows — one per delivered property

```
- IS-<n>: <property the delivered change must have> ; criterion: QA-<n>[, QA-<m>] [; gap: G<n>]
```

`n` is a positive integer and unique. The property is the thing the requester gets, stated so a test or a QA
scenario can show it. `criterion` names the QA scenarios that prove this row; it is the only pairing
declaration, and both directions are checked from it. `gap` cites the register row (`ledger.md` §6) this IS row
closes; it is required when `--register` is passed and optional otherwise.

An IS row is the unit's contract: see `contract.md` §2.

### 4.2 COMPANION rows

```
- COMPANION: <item> <- IS-<n> : <why the requester expects it in this task>
- COMPANION: none.
```

The four guards of `contract.md` §3 decide whether an item may be a companion at all. Of them the linter
enforces the mechanical ones: the target must be a declared IS row and never another companion (guard a), and
the row carries no PR or task field of its own, so it rides this plan and this PR (guard c). Guard b (no new
owner decision) is semantic and belongs to PLAN-REVIEW. `COMPANION: none.` is the explicit empty set; a plan
with companions may not also write `none.`.

### 4.3 INVARIANT rows — what the change must keep

```
- INVARIANT INV<n>: <property that must keep holding> : <the test or QA scenario that shows a violation>
```

The id is cited by guard and high-risk rows. The right-hand side names the proof: a test path, a QA id, or a
command. A plan with no invariant row says so by having none.

### 4.4 LIMIT rows — what the change knowingly does not handle

```
- LIMIT: <what is not handled> : <why it is accepted>
```

Both halves are required: a limit without a reason is the defect this row exists to prevent. A `LIMIT` row is
part of the finite contract, so a reviewer may not report it as a finding (`contract.md` §1).

### 4.5 SWITCH rows — the approach switch of §C.6

```
- SWITCH: <the premise the failed fixes assumed> -> <the approach that replaces it>
```

`playbooks/revise.md` (M6) writes one after a third REVISE round, and the ledger records the same switch as a
`switch` event (`ledger.md` §9.4). The plan row states the redesign; the ledger event carries the round and the
kind. Two sides are required; the plan's `round` front matter says which round it belongs to.

### 4.6 Type rows — the per-type contract rows of §C.1

| Row | Type | Shape |
| --- | --- | --- |
| `SCREEN` | design | `- SCREEN: <surface> ; primary: <the one primary action> ; priorities: <1-3 in reading order> ; left-out: <what a generated version would add and this one will not> ; required: <every input, datum, label and copy item, by name> [; layout: <the Layout: line>]` |
| `AXIS` | research | `- AXIS: <axis> : <the question this axis must answer>` |
| `CLAIM` | research | `- CLAIM: C<n> : <the claim the report must support>` |
| `RULE` | audit | `- RULE: <rule id> : <what the rule requires>` |

`SCREEN` mirrors the frontend brief (primary action, information priorities, left out on purpose, required
content, optional `Layout:` line). `AXIS` and `CLAIM` mirror the research Phase 0 axes and the questions a
report must answer; a research device row cites a `CLAIM` id, so those ids are what makes the device checkable.
`RULE` ids use `ledger.md` §5.1's open audit set (`^[a-z][a-z0-9._-]*$`) and are unique.

A plan requires its type's rows: `design` at least one `SCREEN`; `research` at least one `AXIS` and one
`CLAIM`; `audit` at least one `RULE`; `code` none. A type row of another type's kind on a concrete-type plan is
a complaint: the contract would name a lane that type never runs. A `mixed` plan may use any of the four kinds.

## 5. QA scenarios and verification devices

### 5.1 QA scenario rows — the real-surface proof

```
- QA-<n>: <what the user does> ; pass when: <one binary observation> ; evidence: <path> ; run: <the exact command>
```

`n` is a positive integer and unique. The four fields are required and must appear in this order: `run` comes
last, and everything after `run: ` is the command, so a command may contain `;`, `|`, quotes or arrows without
breaking the row. `pass when` is one observation that decides PASS or FAIL — an exit code, one line of stdout,
a number — never "looks right". `evidence` is where the capture lands (normally under the evidence root,
`ledger.md` §1). A scenario that runs a command is a re-runnable script kept with its evidence.

### 5.2 DEVICE rows — one paired verification device per contract row

```
- <IS-<n>|G<n>> DEVICE: <the device body>
```

Every IS row needs at least one device row, and a register-row target (`G<n>`) is written the same way. The body
is exactly `ledger.md` §8.2's grammar for the row's work type, and the linter validates it with M0's
`validateDeviceRow` instead of restating the forms:

| Type | Body |
| --- | --- |
| `code` | `guard <INVARIANT> -> <node>` or `qa <command> => <binary observation>` |
| `design` | `vqa <item ids> @ <matrix cells> pair <case>-<state>-<width>-<theme>` |
| `research` | `claim C<n> gate(primary, domains>=<n>, counter-search)` |
| `audit` | `lint <command> exit 0` or `spot <n> rows reproduce` |

A device row whose body is valid for another type is a complaint: it would run a lane the type never runs.
On a research plan the cited `C<n>` must be a declared `CLAIM` row.

### 5.3 Risk rows

```
- guard: <INVARIANT or IS row> : <the regression a user would hit> -> <node>
- no-test: <reason this repository cannot test it> : QA-<n>
- HIGH-RISK: <IS-<n>|INV<n>> (<concurrency|persistence|state|lifetime>) -> <node>
```

A `guard` row makes one mutation in the final verification wave and names the mass-ulw node that owns it, so no
guard is unowned. The cited reference must be a declared `INV<n>` or `IS-<n>`. A `no-test` row covers prose or
behavior the repository cannot test and names the QA scenario that covers it instead.

A `HIGH-RISK` row flags a behavior that involves concurrency, persistence, or state and lifetimes; the node that
owns it runs the adversarial review, and the run's required receipts gain the `adversarial` lane
(`ledger.md` §3). Only `code` and `mixed` plans may carry one, because no other type's receipt table includes
that lane. Missing a high-risk row is a judgment call, not a grammar defect: PLAN-REVIEW looks for it.

### 5.4 Pinned rules

The plan states both rules once, in prose, and never relaxes them: every command pins the task worktree, and
commits are serialized. The linter does not pin the wording; PLAN-REVIEW checks that the plan says both.

## 6. The machine-checked rules

`scripts/check-plan.mjs <plan.md> [--register <gaps.tsv>] [--json] [--help]` exits `0` clean, `1` when any rule
below fails, and `2` for a usage or read error (`ledger.md` §14); `--` ends the flags so a dashed path is still a
plan, and `--json` prints the machine object instead of the summary. Every complaint is
`<plan path>:<line>: <PL id>: <message>`, where the id is a row of the table below (`PL18` is a reading rule and
carries no message), and a message quotes only an id, a node or one short value — never a whole row, because a
plan can quote a command that carries a token. `RULE_IDS` in the script and the ids in this table are held equal
by the test suite, so a rule cannot be added on one side only.

| Rule | Check |
| --- | --- |
| PL1 | The file opens with front matter that M0's `validatePlanFrontMatter` accepts; every parse error is reported on its key's line. |
| PL2 | `## Todos` exists with at least one `- [ ] <N>. <title>` row; `## Final verification wave` exists with at least one `- [ ] F<n>. <title>` row; task numbers are unique per section; no task row appears outside those sections. |
| PL3 | At least one IS row exists; ids are unique. |
| PL4 | Every IS row names at least one QA scenario, and every QA scenario is named by at least one IS row. |
| PL5 | Every QA row has its four fields in order, each non-empty; `run` is the last field. |
| PL6 | Every IS row, and every `G<n>` device target, has at least one DEVICE row. |
| PL7 | Every DEVICE body validates for its row's work type (M0 grammar); a research device's `C<n>` is a declared CLAIM. |
| PL8 | The type rows required by the plan's type exist; a row kind belonging to another type is a complaint; CLAIM and RULE ids are unique. |
| PL9 | Every guard row has its three parts; the cited `INV<n>`/`IS-<n>` is declared; the node is a non-empty node id. |
| PL10 | Every no-test row has a reason and names a declared QA scenario. |
| PL11 | Every HIGH-RISK row has a declared target, an allowed kind and a node, and appears only on a `code` or `mixed` plan. |
| PL12 | Every COMPANION row is either `none.` or `<item> <- <IS row> : <why>` targeting a declared IS row; `none.` excludes other companion rows. |
| PL13 | Every INVARIANT row has an id, a property and a proof, and ids are unique. |
| PL14 | Every LIMIT row has both a limit and a reason. |
| PL15 | Every SWITCH row has both a premise and a new approach. |
| PL16 | A column-zero bullet that begins with a declared marker but does not match that marker's grammar is a complaint (this is what makes a malformed row loud instead of invisible). |
| PL17 | With `--register <gaps.tsv>`: the register parses with M0's `parseGapsTsv`, every IS row cites `gap: G<n>`, and every cited id exists in the register. |
| PL18 | Fenced blocks, indented prose, tables and headings are never rows; CRLF, a BOM and a missing final newline change nothing. |

`--json` prints one object instead of the summary:

```json
{"ok": true, "plan": "<path>", "type": "code", "tier": "M",
 "counts": {"is": 1, "qa": 2, "devices": 1, "guards": 2, "companions": 1, "invariants": 1,
            "limits": 1, "switches": 0, "highRisk": 0, "typeRows": 0, "tasks": 3},
 "register": null, "problems": []}
```

## 7. What the linter does not check

These are deliberate, and each one is judged by a named role instead:

- **Wiring.** The v1 plan required every IS row to name a production entry point, a consumer, and an
  authoritative owner, and the o3 arm checked that the paths existed. Path existence produced that arm's largest
  false-positive class (a path written relative to a skill directory, a file a later IS row creates), so the
  linter no longer guesses; PLAN-REVIEW reads the wiring and challenges duplicate sources of authority.
- **Node existence.** A guard or high-risk row's node is checked for shape, not for a matching `## Todos`
  title: v2 fixes no node-id convention in task titles, so a title check would mean inventing one and coupling
  this linter to M6's playbooks. PLAN-REVIEW reads the node graph and reports an ownerless mutation.
- **Transitions.** v1 asked a state or lifetime row to list its transitions. That judgment stays with
  PLAN-REVIEW: "state" and "lifetime" are semantic, and a keyword check would pass a row that lists none of the
  transitions that matter.
- **Whether the plan is any good.** The linter judges grammar only: whether an IS row is the right property,
  whether the invariants cover what must be kept, and whether a high-risk behavior was flagged are contract
  judgments (PLAN-REVIEW, then the final review).
- **Mixed attribution.** See §2: on a `mixed` plan a device row may use any concrete form.
- **An unregistered `G<n>`.** Without `--register` a device row's gap target cannot be verified; the register
  lives at `<ER>/gaps.tsv` (`ledger.md` §1) and is optional for a single unit.

## 8. A complete plan

```md wish:plan
---
wish:
  run_id: w-tokenizer-20261028-0900
  tier: S
  type: code
  unit: u1
  program_id: null
  worktree: /srv/worktrees/tokenizer
  branch: tokenizer-empty-input
  pr: null
  frozen_head: null
  round: 0
---

# Tokenizer: accept empty input

## Todos

- [ ] 1. n-parse: return an empty token list for an empty input
- [ ] 2. n-test: cover the empty input and the single-token input

## Final verification wave

- [ ] F1. n-verify: run the suite and the QA scenario on the real command

## Contract

- IS-1: an empty input yields an empty token list without an error ; criterion: QA-1, QA-2
- COMPANION: the usage text names the empty-input behavior <- IS-1 : it is one hop from the same property and ships in this PR
- INVARIANT INV1: a non-empty input yields the same tokens as before : QA-2
- LIMIT: tab-separated input is not tokenized : the request covers whitespace-separated input only
- IS-1 DEVICE: guard INV1 -> n-test

## QA scenarios

- QA-1: run the tokenizer on an empty input ; pass when: exit 0 and stdout is the empty string ; evidence: <evidence-root>/qa1-empty.log ; run: printf '' | tokenizer -
- QA-2: run the tokenizer on the regression fixture ; pass when: exit 0 and stdout equals the expected lines ; evidence: <evidence-root>/qa2-regression.log ; run: tokenizer test/fixtures/tokens.txt

## Risk list

- guard: INV1 : a non-empty input loses a token -> n-test
- no-test: the usage text is prose : QA-1

## Pinned rules

- Every command pins the task worktree /srv/worktrees/tokenizer.
- Commits are serialized.
```

The linter treats this block as documentation and never lints it in place; `test/check-plan.test.js` extracts it
and requires it to pass, so the example cannot drift from the grammar.