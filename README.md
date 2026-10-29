# omo-wish

`/wish`: make a wish.

An [OmO](https://github.com/code-yeongyu/oh-my-openagent) plugin. One slash command loads the `wish` skill and
carries a single authorized request from collection to definition, one reviewed plan, a multi-PR build, review to
APPROVED, merge and cleanup.

wish runs **on top of omo**. Every stage is executed by an omo feature — categories (`architect`, `ultrabrain`,
`quick`, `deep-high`, `writing`), native agents (`explore`, `librarian`, `omo-native-qa-executor`,
`omo-native-code-reviewer`, `omo-native-gate-reviewer`), `mass-ulw` (collect, build, fix), `ulw-loop` (goal,
evidence, checkpoint), `ulw-plan`'s plan grammar, `monitor`. The skill's scripts are helper commands those roles
call; they neither replace an omo role nor decide a quality question.

Speed comes from moving work earlier, never from reviewing less. The same review, the same lanes and the same
blocker definition run before the final review at the same head, so the final review starts from a verified head.

## Install

```sh
omo install https://github.com/DevNewbie1826/omo-wish
```

To install into the current project only, add `-l`:

```sh
omo install -l https://github.com/DevNewbie1826/omo-wish
```

For local development, load the working directory without copying it:

```sh
omo install -l .
```

Remove it:

```sh
omo remove https://github.com/DevNewbie1826/omo-wish
```

A new session (or `/reload`) picks the plugin up.

## Compatibility

The environment the test suite and the loader verification were actually run in:

| Component | Tested version |
| --- | --- |
| OmO plugin host (Senpi) | the version installed under `~/.bun/install/global/node_modules/@code-yeongyu/senpi` |
| Bun | 1.4 or newer |

This is the tested combination, not a minimum. The plugin assumes a host that supports the `pi.skills` manifest
entry and the extension's `before_agent_start` event.

## Usage

Typing `/` lists the command as **wish: make a wish**.

```sh
/wish <request>
```

Examples:

```sh
/wish fix the login redirect bug
/wish add a rate limit to the upload endpoint
```

- The argument is inserted verbatim where `$ARGUMENTS` sits at the top of the template. Text inside the argument
  that looks like `$ARGUMENTS` or `$1` is never re-expanded.
- `/wish` with no argument also works; the request is taken from the conversation.
- After a session death or a context compaction, `/wish --resume <run_id>` continues the same run.
  `playbooks/resume.md` owns the resume path, and `wish resume-plan` reports the stage to resume from.
- `/wishful` and `/WISH` do not invoke the skill. A plain request containing `ulw` may still turn on the generic
  ultrawork mode, but that does not select wish for that request.

## Flow

```text
/wish <request>
  ├─ prompts/wish.md: argument + "Read and follow the `wish` skill"
  ├─ extensions/wish.js: sees the ultrawork keyword in the expanded text and
  │   turns the host ultrawork mode on once if it is not already on
  ├─ the host resolves the `wish` skill from the pi.skills manifest
  └─ SKILL.md: the contract and the stage map (this file is authoritative)
      ├─ the work type's playbook (playbooks/<type>.md): the steps copied into `todo`
      └─ references/: plan grammar, finite contract, ledger shapes, delegation prompts,
                      defect classes, metrics
```

`/wish` opens no goal or notepad at bootstrap: the plan file holds the notes, and the GOAL stage registers one
goal per unit through `ulw-loop`. The authorized request already covers planning, build, PR, review, merge and
cleanup, so no phase is re-authorized. Decisions are asked once, as one batch at the DECIDE stage, each with a
recommended default; a decision that appears mid-run parks only its own lane and every other lane continues.

## Stages

`wish status` names the next stage and the receipt blocking it. A playbook reads as "dispatch only the stage
`status` names". `<ER>` is the evidence root ulw-loop reports, outside the repository.

| Stage | The omo feature that runs it | The receipt `status` requires |
| --- | --- | --- |
| `intake` | ultrawork tier triage + `todo` (the playbook steps copied in) | the `intake` event `wish init` writes (it also creates the plan) |
| `collect` | one `mass-ulw` run `wish-<run>-collect`: harvest, extract, explore | `collect` event + `<ER>/collect.md` |
| `define` | session, seeded by the collect report | `define` event + `<ER>/define.md` + the difference rows in `<ER>/gaps.tsv` |
| `before` | session (a read-only lane may drive the capture) | `before` event + one `before-<gap>-<tree7>` before the first edit |
| `plan` | session (ulw-plan's checkbox grammar) | `plan` event (the plan) |
| `plan_lint` | `scripts/check-plan.mjs` (session or a `quick` node) | `plan_lint` event, exit 0 |
| `plan_review` | `category: architect` once | `plan_review-architect-<head7>.md` (`OKAY`, or blockers each with a fix) |
| `decide` | session collects the decision batch | `decide` event + `<ER>/gates.md` entries with a recommended default |
| `goal` | `ulw-loop` goals + ulw-execute Boulder (format only) | `goal` event (the goal id) |
| `build` | `mass-ulw` run `wish-<run>-build`, one PR per unit (the commit node loads `git-master`) | `build` events + `build-<node>.json` |
| `verify_lane` | one `task` batch per head: `quick` tests and mutation, `omo-native-qa-executor`, `omo-native-code-reviewer` (with `remove-ai-slops` and `programming`), `deep-high` adversarial | `verify_lane-<lane>-<head7>.json` per required lane |
| `triage` | session (bugbot trichotomy: fix, dismiss, owner) | `triage` event + `findings.tsv` rows |
| `fix` | `mass-ulw` run `wish-<run>-fix-r<n>` + `reuse-check.mjs` | `fix` + `reuse` events |
| `freeze` | `wish freeze`, `wish pr-body` | `freeze` event (`head`, `tree`, `pr`) |
| `pr_open` | `gh pr create` + `tool.monitor` on `pr-watch.mjs` | `pr_open` event |
| `round` | `wish gate` then `category: ultrabrain` (r1 full, r2+ delta and regression) then `check-verdict.mjs` | `final-r<n>-<head7>.md` + `round`, `verdict` events |
| `switch` | `architect` premise review, `deep-high` family switch, a `SWITCH:` plan row, or rediscovery | `switch` event (`round`, `kind`, `premise`, `new_approach`) |
| `merge` | session (the session that did the work merges) | `merge` event (`sha`, `merged_at`, `pr`) |
| `post_merge` | `omo-native-qa-executor`: smoke when the tree is identical, full otherwise | `post_merge` event + `post_merge-<tree7>.*` |
| `checkpoint` | `ulw-loop` `checkpoint` + `omo-native-gate-reviewer` | `checkpoint` event (`checkpoint_op: complete`) |
| `cleanup` | session: `metrics export`, then `memory` | `cleanup` event + at least one teardown receipt |

`before` and `fix` are conditional. When one does not apply, the todo keeps `skip: <reason>`; it is never
silently dropped. While a unit runs, `wish status --progress` prints one line on every transition that changes a
number and at least every 30 minutes; a repeat with identical numbers prints nothing.

```
PROGRESS: run <id> · units <done>/<total> · gaps <fixed>/<total defect> · prs <merged> merged <open> open · wave <k>/<n> · round r<round> on <#pr|none> · switch <count> · waiting <what|none>
```

## Tiers

The tier comes from omo's LIGHT/HEAVY facts and never goes down: a HEAVY fact found mid-run raises it at once.

| Tier | Criterion | What changes (review depth does not) |
| --- | --- | --- |
| **S** | ≤2 files and ≤150 lines by the collect estimate, no HEAVY fact | one `explore` node, a short define, a short plan, PLAN-REVIEW may start with BUILD and a blocker `amend`s the run, mutation at most one per guard row |
| **M** | beyond S, ≤1 HEAVY fact, ≤3 components | serial by default, the full verify wave |
| **L** | ≥2 HEAVY facts, ≥4 components, or the requester asked for thoroughness | M plus the `adversarial` lane even without a high-risk row, the state and lifetime transition table run in QA, and the mutation cap |

## Work types

| Type | Playbook | The lanes `status` requires |
| --- | --- | --- |
| `code` | `playbooks/code.md` (patch, feature, refactor) | `tests`, `qa`, `sweep`, `code-review`, plus `adversarial` when a high-risk row exists |
| `design` | `playbooks/design.md` | `draft-guard`, `capture`, `vqa-passA`, `vqa-passB`, `code-review`, `qa` |
| `research` | `playbooks/research.md` | `fact-verify`, `claim-gate`, `skeptic`, `execution-verify`, `delivery-gate` |
| `audit` | `playbooks/audit.md` | `lint`, `spot`, `register-schema` |
| `mixed` | the primary type's playbook | the union of the primary's and secondary's lanes; `wish init` and `sweep.mjs` take `--type mixed --primary … --secondary …` |

`frontend` builds rendered surfaces and `visual-qa` verifies them; `ulw-research` runs a research unit's phases.
wish takes their output as receipts and adds the contract, the verdict, the ledger and the progress line; it never
reimplements those skills.

When one request has to become several PRs, `playbooks/program.md` adds units and waves. A unit is one PR; a wave
is a set of units whose write scopes do not overlap. One unit's REVISE never blocks another unit's merge.

## Plan, definitions, and the ulw-execute handoff

DEFINE runs before any plan and writes `<ER>/define.md`: the end user, how they use the result today and after,
the ideal state as rows with their reasons, and every difference from today with its reason. Those differences
become the register, so the plan closes each one.

The plan is written at `.omo/plans/wish-<slug>.md` using ulw-plan's checkbox grammar — column-zero
`- [ ] <N>. <title>` rows under `## Todos`, `- [ ] F<n>. <title>` rows under `## Final verification wave` — plus
the contract rows and the required sentences of `references/plan-format.md`. That location and that grammar are
exactly what `ulw-execute` selects as its plan, so a wish plan is handed to execution without a second planning
pass. A plan in another location or another shape is a defect: ulw-execute would treat it as no plan at all.

## The round rule — a cap is a switch, never an exit

Review has no round ceiling. **`APPROVED` is the only end.**

1. Two consecutive REVISE rounds on the same component **or** the same defect class stop the patch loop and force
   one `architect` premise review of the assumption the failed fixes shared.
2. A **third-or-later** REVISE round that repeats a defect class an earlier round already cited forces an
   approach switch, and every repeat after it adds one kind not yet used: `premise`, `family` (a model family
   other than the failed fix's), `strategy` (a `SWITCH:` row that redesigns the component), `split` (program
   only), `rediscover`. A round whose blocking findings are all new classes is not a repeat and needs only the
   fix lane.
3. After a switch: fix run, `reuse-check`, stale lanes only, `freeze`, the gate table, then a **new** ultrabrain
   reviewer on the delta and the prior findings.
4. The requester is never asked whether to keep reviewing. Decisions are theirs only when irreversible,
   destructive, a spend, or a contract-level LIMIT; the batch closed at DECIDE, and a parked lane never stops
   another lane.

A REVISE returns the flow to DEFINE for the cited problem: DEFINE again for it, a plan round for it, the fix lane,
then the same verify wave — and the fix commits append to the same PR.

## Reviews, in the one order that holds

`triage`, `fix`, `freeze`, `pr_open` and `round` are one sequence and the order is mechanical, not advisory.
`freeze` binds the head and the tree; `round` refuses to run unless a valid `code-review` receipt exists **at the
frozen head**; `ultrabrain` is dispatched only after that refusal cannot fire. A verdict is valid only for the
head it reviewed, so the two reviews never share a wave.

The head is frozen for the whole round: a fix lands only after the verdict, as the next round's head. A head that
moves while a round is in flight is not the head the verdict covers, so a head change during a round is a
re-review, and `wish gate --round` refuses it with exit 3 and `the head moved after the freeze`.

## The finite contract — what may block

The plan's `IS` and `COMPANION` rows are the request, `INVARIANT` is what must keep holding, `LIMIT` is what is
knowingly not handled. Only two things block: **a row not delivered, or a listed invariant shown violated by a
failing test** (or, for a `no-test` row, by its failing QA scenario). Everything else is a note or a follow-up.
`WARN` never blocks, and a `FAIL` receipt is a claim the session reproduces before it blocks. A known limit
written in the plan is not a finding. In a program, a unit's contract is its own `IS` rows.

Every reviewer prompt carries the sentence of `references/contract.md` §5 verbatim. A typo, a wrong number or a
wording problem in evidence is a correction memo, never a REVISE reason.

## Evidence and state

Evidence lives outside the repository (`<ER>`) and never moves a reviewed head. Nothing commits after the freeze;
a memo goes to `<ER>`.

| File | Content |
| --- | --- |
| `.omo/plans/wish-<slug>.md` | the plan: ulw-plan checkbox grammar + `IS`/`COMPANION`/`INVARIANT`/`LIMIT`/`DEVICE` rows + front matter |
| `<ER>/collect.md` | what collection read, the important elements, and the project-viewpoint exploration |
| `<ER>/define.md` | the end user, journey, ideal state and every difference, with reasons |
| `<ER>/ledger.jsonl` | stage, lane, head, tree, verdict and round events |
| `<ER>/receipts/` | per-lane receipts `<stage>-<lane>-<head7>.json` (status `PASS`/`FAIL`/`WARN`/`SKIP`) |
| `<ER>/findings.tsv` | review, QA, probe and final-review findings with their fix status |
| `<ER>/gaps.tsv` | the completeness register (`kind: defect|taste`) |
| `<ER>/gates.md` | the decision batch: options, recommended default, answer |
| `<ER>/follow-ups.md` | everything out of scope, named in the final report |
| `<ER>/resume.md` | the resume point |

Write authority is fixed: only the session writes the plan, ledger, findings, gaps, collect, define, gates and
resume; a lane writes only its own receipt; scripts author nothing. A receipt is valid while its `tree` matches (a
research unit's 64-hex sha256 is its `head` and its `tree` is `null`), a verdict while its `patch_id` matches.
`before` captures are deliberately old and are exempt from the reuse check.

## Scripts

All of them are helper commands an agent calls. None decides a stage or dispatches a review. Exit codes are
shared: **0** ok, **1** check failed, **2** usage error, **3** state mismatch.

| Script | Role |
| --- | --- |
| `scripts/wish.mjs` | state and CLI: `init`, `status [--json\|--progress]`, `ledger append`, `findings add\|set`, `gaps add\|set\|list`, `gate` (reproduction table, `add`, `resolve`), `freeze [--check]`, `pr-body`, `reuse-check`, `switch record`, `metrics export\|post-merge`, `resume-plan` |
| `scripts/check-plan.mjs` | plan lint: IS↔QA pairing, `DEVICE:` rows, guard and no-test rows, `HIGH-RISK`, front matter, and gap citation with `--register` |
| `scripts/sweep.mjs` + `scripts/probes/*.mjs` | the defect-class probe runner: secret canaries, boundary inputs, race and lifetime, error chains, mutation, doc and help, config, draft guard. It writes a lane receipt; a probe also runs standalone |
| `scripts/check-verdict.mjs` | verdict-line parser: the last non-empty line must be `VERDICT: <APPROVED\|REVISE> round <n> head <sha>` and cover the head; `--require-approved` |
| `scripts/patch-id.mjs` | `git patch-id --verbatim` comparison and interdiff — whether a verdict covers a patch |
| `scripts/reuse-check.mjs` | receipt validity: `VALID` when the tree matches, `STALE` from changed files and referrers against the receipt's scope |
| `scripts/pr-watch.mjs` | PR state machine as NDJSON (`READY`/`WAITING`/`BLOCKED`/`MERGED`/`CLOSED`) that `tool.monitor` subscribes to |
| `scripts/metrics.mjs` | builds and validates `measurements.csv` and `rounds.csv` rows, detects post-merge rework |
| `scripts/lib/schema.mjs`, `scripts/lib/store.mjs` | schema validation, atomic writes, pid locking, ledger replay (internal modules) |

## Layout

```
omo-wish/
├── package.json                  # pi manifest: pi.prompts, pi.extensions, pi.skills
├── prompts/
│   └── wish.md                   # the slash-command template (description = menu text)
├── extensions/
│   └── wish.js                   # turns the host mode on for the ultrawork keyword
├── skills/
│   └── wish/
│       ├── SKILL.md              # contract + stage map + round rule
│       ├── playbooks/            # code, design, research, audit, program, lens, revise, resume
│       ├── references/           # contract, plan-format, ledger, prompts, defect-classes, metrics
│       └── scripts/              # wish, check-plan, sweep(+probes), check-verdict, patch-id,
│                                 # reuse-check, pr-watch, metrics, lib/
├── test/                         # loader, CLI, lint, probe, verdict, reuse, watch and metrics tests
├── scripts/
│   └── verify.mjs                # the real loader plus a --help smoke over every script
└── docs/
    └── experiments/              # experiment ledger, baseline, measurements and rounds CSV
```

`package.json`'s `pi.skills: ["skills/wish"]` registers the skill with the host.

## Development and verification

```sh
bun test
bun scripts/verify.mjs .
```

`scripts/verify.mjs` loads the package through the installed Senpi's real loader (prompt templates, skills,
extension runner) and checks:

- every skill file the manifest names exists, the loader resolves `wish` to `skills/wish/SKILL.md`, and no skill
  the loader found points at a missing file;
- the extension's `before_agent_start` behaviour: preview-safe, word-boundary keyword, armed once, silent when
  already armed or when the host integration is unavailable;
- every script under `skills/wish/scripts` exits 0 on `--help`, and a public tool (a script directly under
  `scripts/`) also prints a real usage line.

The default Senpi location is `~/.bun/install/global/node_modules/@code-yeongyu/senpi`. Set `SENPI_ROOT` to point
at a different installation.

## Experiments

The time targets and quality guards live in `docs/experiments/ledger.md` and `skills/wish/references/metrics.md`.
The baseline is 104 merged PRs (2026-10-27): median open→merge 92.8 minutes and 40.4% of PRs needing at least one
final-review REVISE.

A v3 arm is judged on 20 treated PRs and at least 10 alternating control PRs in the same window. The continue
condition is median open→merge ≤55 minutes **and** REVISE≥1 ≤25% **and** guards 1-5 passing; the cancel condition
is median ≥92.8 minutes **or** REVISE≥1 ≥40% **or** a guard violation. A value in between extends by 10 PRs once
and is judged by the same rule. The first program-mode run is diagnostic only, because it has no control group.

Rows are built and checked from the ledger:

```sh
bun skills/wish/scripts/metrics.mjs export --ledger "$ER/ledger.jsonl" --findings "$ER/findings.tsv" --gaps "$ER/gaps.tsv" --out "$ER/metrics"
bun skills/wish/scripts/metrics.mjs validate --dir "$ER/metrics"
```

## Customizing

- The menu text and the entry template live in `prompts/wish.md`. Removing the `ultrawork` and `wish` skill
  mentions from the template can stop the mode from arming or the skill from being selected.
- The work rules live in `skills/wish/SKILL.md`, the per-type `playbooks/`, and the machine shapes in
  `references/`. This README explains; when it and a skill file read differently, the skill file is right, so keep
  this summary in step when a rule changes.

## Mode behaviour

- `/wish` assumes ultrawork is on. When it is not, the plugin sees the `ultrawork`/`ulw` keyword in the expanded
  text and turns the host mode on once, appending only the host directive. A `ulw` in another request may turn the
  generic mode on; that does not select wish for that request.
- When the mode is already on, the plugin leaves the state alone and appends no directive. A preview never changes
  mode state.
- Skill instructions do not outrank system or developer instructions, a later explicit request, or a gate the tool
  actually enforces. This is instruction precedence, not an engine rule.
- When the host's mode integration is unavailable, or the input arrives through a path that bypasses
  `before_agent_start` (queued input, for example), the plugin may fail to turn the mode on. It never claims it did,
  and the run continues per the skill's instruction.
- The authorized request already covers the whole flow, so no phase is re-authorized and the run does not stop for
  a native reviewer loop or a failed-attempt question. Decisions are collected once at DECIDE; an answer that only
  the requester can give is asked through the question tool, or through whoever assigned the work when the tool is
  unavailable.

## The native plan gate

`/wish` never opens the host's native plan-reviewer gate itself; the gate opens only when the requester's own
message asks for the ulw-plan workflow. That fact produces the two plan branches.

The default branch: the session writes the plan to fit ulw-plan's grammar, and ONE `category: architect` review
checks it. No approval question goes to the requester.

The ulw-plan branch: ulw-plan runs whole, with its approval gate, and the plan gets BOTH reviews — the
`plan-reviewer` agent and the one `category: architect` review. No third round is added in either branch.

A host that offers neither role leaves the review with the session, which records that in the plan's review
record. Either way the plan records one fix per blocker and is not re-reviewed; the final ultrabrain review
confirms those fixes.