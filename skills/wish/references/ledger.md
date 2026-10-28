# wish v2 — state, receipt, and interface contract (M0)

This file is the single interface contract between wish v2's modules. M1 (state, CLI), M2 (plan lint),
M3 (probes), M4 (verdict, patch-id, reuse), M5 (prompts) and M7 (PR watch, metrics) import every shape and
value set from `scripts/lib/schema.mjs`; none of them re-declares one. The prose states the contract, the
library enforces it, and `test/schema.test.js` validates every machine example in this file, so prose and
code cannot drift.

`references/ledger.md` and `scripts/lib/schema.mjs` live under `skills/wish/`; `test/schema.test.js` is the
repository test suite at the repo root, together with the existing `test/wish.test.js` (design §3 tree).

Sources cited per field:

- **D** = `/tmp/oru-wish-v2/design.md` — §2.2 (stage table), §2.7 (evidence reuse), §2.8 (state and receipt
  formats), §2.9 (resume), §2.10 (measurement hooks), §3 (file layout), §4 (module split and the M0 list).
- **A** = `/tmp/oru-wish-v2/design-addendum-general.md` — §B1–§B10 (lens, register, before, devices,
  program, before/after, PROGRESS, goal, cap→switch, review axes), §C.1–§C.6 (work types, shared vs
  playbook, stage machine, ledger extension, per-type boundaries, cap→switch execution), §F (M0 brief).
- **U** = omo `ulw-execute` `SKILL.md:176` — the evidence-ledger field set, `DoneClaim`/`AdversarialVerify`,
  and the repeated-failure stop rule.
- **L** = omo `ulw-loop` `SKILL.md:64` — evidence is bound to a tree hash and a matching tree is reused.
- **P** = poteto-mode `scripts/orch/store.ts:597-668` — the `gates.md` renderer and reader.
- **C44** = PR #44 `skills/wish/scripts/check-verdict.mjs` and `test/verdict.test.js` — the `VERDICT:` line
  pattern, parser semantics, and reason strings, carried verbatim.
- **C43** = PR #43's shared experiment columns, quoted in D §2.10 and verified on
  `origin/wish/review-dispatch-gate` (`docs/experiments/{measurements,rounds}.csv`).
- **O/** = omo skills root, `/home/mirage/.bun/install/global/node_modules/omo-ai/plugin/skills`.
- **M0** = a decision this contract makes where no source pins the answer; every such line says so.

`$SKILL` means `skills/wish`. `<ER>` is the ulw-loop evidence root
(`agentToolkit.status().result.evidenceRoot`), outside the repository on purpose: evidence never costs a
commit and never moves a reviewed head (D §2.6/§2.8).

## 1. Paths, roots, and write authority

| Path | Only writer | Content | Source |
| --- | --- | --- | --- |
| `.omo/boulder.json` | session | ulw-execute Boulder state v2: `schema_version`, `works{}`, `active_plan`, `session_ids` as `senpi:<id>`, `worktree_path`, `status` | U, D §2.8/§2.9 |
| `.omo/plans/wish-<slug>.md` | session | the one plan: ulw-plan checkbox grammar + wish sections + the front matter of §8 | D §2.8, A §C.3 |
| `<ER>/ledger.jsonl` | session (`wish.mjs ledger append`) | one event per line, §9 | U, D §2.8, A §C.4 |
| `<ER>/findings.tsv` | session (`wish.mjs findings`) | one finding per line, §5 | D §2.8 |
| `<ER>/gaps.tsv` | session (`wish.mjs gaps`) | the completeness register, §6 | A §B2/§C.4 |
| `<ER>/lens.md`, `<ER>/ideal.md` | session | judgment rules and the ideal state, §7 | A §B1/§B2/§C.4 |
| `<ER>/receipts/*` | the lane that produced it | one lane's evidence, §4 | D §2.8, A §C.4 |
| `<ER>/gates.md` | session | owner questions parked with a default, §13 | P, D §2.8 |
| `<ER>/resume.md` | session | one line per stage transition: intent, current stage, valid receipts, next action | D §2.9 |
| `<ER>/metrics/{measurements,rounds}.csv` | session (`wish.mjs metrics`) | shared experiment rows, §10 | C43, D §2.10 |
| `.omo/ulw-loop/<session>/` | ulw-loop SDK only | loop state | U |

1. **One writer per file.** The session alone writes boulder, plan, ledger, findings, gaps, lens, ideal,
   gates and resume; a lane writes only its own receipt; scripts validate and compute and never author
   state (P `orchestrate.md:23`, D §2.8, A §C.4).
2. **omo stays authoritative.** Nothing here adds an orchestrator, category list, or agent list, and no
   omo role is replaced. Categories, native agents, `mass-ulw`, `ulw-execute` Boulder/ledger, `ulw-loop`
   evidence/checkpoint, goals, monitors, `visual-qa`, `frontend`, `remove-ai-slops` and `ulw-research`
   remain the execution machinery; the scripts are helper commands those roles call.
3. **Two ledgers, one owner each.** `<ER>/ledger.jsonl` is wish's run ledger. omo's
   `.omo/ulw-execute/ledger.jsonl` stays omo's, written by the executing agent per checkbox; the Boulder
   continuation hook reads `.omo/boulder.json` and the plan, never wish's ledger.
4. **Stage names are ledger event names.** D §2.2 writes `rounds` once in prose; the normative D §4 list
   writes `round`, and `round` is the pinned name here.

## 2. Identities: head, tree, patch-id, research sha256

| Value | Definition | Format | Source |
| --- | --- | --- | --- |
| `head` | `git rev-parse HEAD`; for the `research` type, the frozen artifact's sha256 | 40 lowercase hex; `research` uses 64 lowercase hex | D §2.8, A §C.1 ("FREEZE의 head"), O `ulw-research` `artifact_sha256` |
| `head7` | `head.slice(0, 7)`, derived, never stored | 7 lowercase hex | D §4 filename rule |
| `tree` | `git rev-parse HEAD^{tree}`, always full | 40 or 64 lowercase hex; `research` has none (`null`) | D §2.7/§2.8, L |
| `patch_id` | first field of `git diff <base>...<head> \| git patch-id --verbatim` | 40 hex | C44, v1 skills/wish/references/review.md:40 at cbbfbf8 |
| `artifact_sha256` | sha256 of the frozen research artifact; equals `head` for a research unit | 64 lowercase hex | A §C.1, O `ulw-research` |

A receipt is valid while its `tree` (or, for research, its `artifact_sha256` in `head`) matches; a verdict
is valid while its `patch_id` matches. A seven-character SHA is never accepted as a `head`
(`headErrors`). `research` never carries a git tree; its receipts set `tree: null`. A `mixed` run takes its
`primary` type's identity form (A §C.2).

## 3. Work types and the required-receipt table

`type ∈ {code, design, research, audit, mixed}` (A §C.1). `mixed` names a `primary` and a `secondary`
concrete type: the primary owns the deliverable and the end condition, the secondary adds lanes and
dictionary entries (A §C.2). Every event and receipt carries `type`, `unit` and `program_id` (A §C.4/F).

`unit` = one run of the stage machine (one worktree, branch, PR); `program_id` = the multi-unit program
id, or `null` for a single unit (A §B5/§C.4).

A type must produce these lane receipts before `status.next` may leave VERIFY-WAVE
(`requiredReceiptsFor`):

| Type | Required lanes | Source |
| --- | --- | --- |
| `code` | `tests`, `qa`, `sweep`, `code-review`; `adversarial` when the plan flags a high-risk row | A §C.1, D §2.3/§2.5 |
| `design` | `draft-guard`, `capture`, `vqa-passA`, `vqa-passB`, `code-review`, `qa` | A §C.1, O `frontend:62`, O `visual-qa:232,286` |
| `research` | `fact-verify`, `claim-gate`, `skeptic`, `execution-verify`, `delivery-gate` | A §C.1, O `ulw-research:415-437` |
| `audit` | `lint`, `spot`, `register-schema` | A §C.1 |
| `mixed` | the union of `primary` and `secondary` | A §C.2 |

`units[]` and `wave` (A §B5): a wave holds the units whose write scopes do not overlap; one unit's REVISE
never blocks another unit's merge. A first program run is diagnostic only (A §F M7).

Gap-level records add two more receipts per **defect** gap: `before-<gap>-<tree7>` and, once fixed,
`after-<gap>-<tree7>` (§4.2, §6). `before` receipts are exempt from reuse checks: a pre-edit capture is
deliberately old (A §B3).

## 4. `receipt` — one lane's evidence

Body fields (D §2.8 + A §C.4):

| Field | Type | Meaning | Source |
| --- | --- | --- | --- |
| `kind` | `lane` \| `before` \| `after` \| `vqa-passA` \| `vqa-passB` \| `vqa-capture` \| `claim-gate` \| `lint` | the receipt family | D §4, A §C.4 |
| `type` | work type | the run's type; `mixed` also sets `primary`/`secondary` | A §C.4/F |
| `unit`, `program_id` | string, string\|null | the unit and program the lane served | A §B5/§C.4 |
| `lane` | kebab-case | the lane that wrote it; equals `verify_lane.lane` | D §2.8 |
| `stage` | ledger event | required for `kind: lane`; the stage the receipt answers | D §4 |
| `head` | §2 | the head (or research sha256) it ran against | D §2.7, A §C.1 |
| `tree` | §2 or `null` | the tree it is bound to | D §2.7, L |
| `scope` | non-empty array of paths/globs | what the lane covered; `reuse-check` intersects it with changed files | D §2.7 |
| `started_at`, `ended_at` | ISO-8601 UTC (`Z`) | lane wall clock; `ended_at ≥ started_at` | D §2.8/§2.10 |
| `status` | `PASS` \| `FAIL` \| `WARN` \| `SKIP` | lane verdict, §4.1 | D §2.8 |
| `rows` | array of `{id, command, observable, verdict, artifact, class?, note?}` | one row per check; `verdict` adds `INVALID` for a probe row that could not decide | D §2.8, O `exp/x1` sweep summary |
| `artifacts` | array of paths | captures under `<ER>` | D §2.8 |
| `cleanup` | array of strings | teardown receipts for resources the lane started | D §2.8 |
| `gap`, `name`, `pass`, `env_sha` | per kind / optional | `before`/`after` name their gap; `lint` names the lint; a `vqa-*` receipt sets `pass` to its own suffix (`passA`, `passB`, `capture`); `env_sha` is the 64-hex surface/build artifact hash — a changed value makes the receipt STALE (M4) | A §B3/§C.4, D §2.7, A §F M4 |

Every row's `command` is the literal command (or `no command` for a read-through row), `observable` is the
one binary observation that decided it, and `artifact` is a path or `null`.

### 4.1 Status semantics — WARN never blocks

| Status | Meaning | Blocks `next`? | Source |
| --- | --- | --- | --- |
| `PASS` | every row passed | no | D §2.8 |
| `FAIL` | a row failed inside the finite contract | yes, after the session reproduces it and files a blocking finding | D §2.6/§2.8 |
| `WARN` | a memo; nothing inside the contract failed | **no** — at most a `note` finding | D §6 ("WARN은 차단 아님") |
| `SKIP` | the lane did not apply; the reason is in `note` | no, but it never satisfies a required lane | D §2.8 |
| `INVALID` | a row only: the probe could not decide (did not compile, no marker) | no; it is unproven, never a PASS | O `exp/x1` |

A `FAIL` receipt is a claim, not a verdict: the session reproduces it before `blocking=1` (D §2.6).

### 4.2 Filenames

`parseReceiptFilename` / `receiptFilename` / `validateReceiptAgainstFilename`:

| Kind | Filename | Source |
| --- | --- | --- |
| `lane` | `<stage>-<lane>-<head7>.json` (or `.md` for a prose report) | D §4 |
| `before`, `after` | `before-<gap>-<tree7>.<ext>`, `after-<gap>-<tree7>.<ext>` | A §B3/§B6/§C.4 |
| `vqa-*` | `vqa-passA-<head7>.<ext>`, `vqa-passB-<head7>.<ext>`, `vqa-capture-<head7>.<ext>` | A §C.4 |
| `claim-gate` | `claim-gate-<sha7>.json`, where `sha7` prefixes the research `head` | A §C.4 |
| `lint` | `lint-<name>-<tree7>.json` | A §C.4 |

`<stage>` is a §9 event, `<lane>` is kebab-case, `<gap>` is `G<n>`, `<head7>`/`<tree7>`/`<sha7>` are the
first seven hex of the receipt's own head/tree. A receipt whose filename anchor disagrees with its body is
rejected. An `.md` receipt is the same object in YAML front matter with `rows: []` and the report below it.

## 5. `findings.tsv`

Eleven columns in this order, a header first, TSV with no quoting: a field never contains a tab, CR or LF;
"absent" is `-`, and a missing reproduction is the literal `no command` (D §2.8).

| Column | Value set | Meaning | Source |
| --- | --- | --- | --- |
| `id` | `[A-Za-z0-9][A-Za-z0-9._-]*` | stable id, never reused | D §2.8 |
| `round` | integer ≥ 0 | `0` for pre-review lanes, the ultrabrain round otherwise | D §2.8 |
| `source` | `code-review` \| `qa` \| `sweep` \| `ultrabrain` \| `architect` \| `adversarial` | the reporting lane; `qa` covers real-surface and visual-qa lanes, `sweep` covers scripted probe and lint lanes (M0) | D §2.8 |
| `class` | the run type's §5.1 set | the defect class; identical string in M3's dictionary and M5's axes | D §2.8, A §C.1 |
| `severity` | `CRITICAL` \| `HIGH` \| `MEDIUM` \| `LOW` | reviewer severity, not the blocking decision | v1 step 7 |
| `file_line` | `<path>:<line>` or `-` | where it was observed | D §2.8 |
| `blocking` | `0` \| `1` | `1` blocks; a `note` or `owner` row is always `0` | D §2.6/§2.8 |
| `repro_cmd` | one line, or `no command` | the command that shows the defect on `head_found` | D §2.6 (C1) |
| `head_found` | §2 head or `no head` | the head (or research sha256) where it reproduced | D §2.8 |
| `status` | `open` \| `fixed` \| `not-fixed` \| `no-command` \| `note` \| `owner` | fix state and triage bucket | D §2.8, P `bugbot-triage.md` |
| `fixed_head` | §2 head or `-` | required when `fixed`; otherwise `-` | D §2.8 |

`not-fixed` is what stops an ultrabrain dispatch: the gate re-ran the row's `repro_cmd` on the new head
and the defect still reproduces (D §2.6 C1). `no-command` means the session must write a reproduction
before the next gate. `note` is a memo; `owner` is parked in `gates.md`.

### 5.1 Class value sets, per work type

One alphabet per type; M3's dictionary key, M5's axis name and this column are the same string
(A §C.1 last row, A §B10). A class outside the run type's set is rejected.

| Type | Values | Source |
| --- | --- | --- |
| `code` | `S` (state/lifetime/cancel/ownership), `C` (input, IO, error boundary), `D` (reconstructed instead of the original), `O` (real shipping path missing), `T` (a test that passes when wrong, including a vacuous guard), `W` (write/ownership boundary), `SEC` (secret in logs/artifacts), `DOC` (code and docs disagree), `CFG` (config accepted/rejected wrongly), `PANIC` (crash on a contract input), `REGRESS` (a prior fix regressed — named `REGRESS`, not `C4`, because `C4` is visual-qa's truncation item) | D §1.2 measured classes S/C/D/O/T/W (343 findings) plus the independent-review rows SEC/T/DOC/CFG/PANIC/C4 (PR #47 table); the `REGRESS` rename is M0's collision fix |
| `design` | the 69 `visual-qa` item ids `A1`–`J2`, the draft-guard and accent-stripe rule ids (`edge-stripe`, `pseudo-bar`, `inset-shadow-stripe`, `gradient-stripe`, `accent-outline`, `promo-copy`, `emoji-icon`, `decorative-badge`, `vanity-stat`), and `taste` | A §C.1, O `visual-qa:128-218`, O `frontend/scripts/perfection/{draft-guard,accent-stripes}/findings.ts` |
| `research` | the gate codes (`untraceable_number`, `value_mismatch`, `quote_not_verbatim`, `unbound_sentence`, `meaning_drift_confirmed`, `meaning_drift_warn`, `fidelity_unresolved`), the nine `drift_kind` values (`subject_changed`, `scope_widened`, `hedge_dropped`, `certainty_added`, `causality_added`, `direction_flipped`, `population_changed`, `evidence_grade_raised`, `other`), and the claim states `claim_unresolved`, `claim_refuted` (M0's names for ulw-research's `unresolved`/`refuted`) | A §C.1/§B10, O `ulw-research:168,427,439` |
| `audit` | the audited rule corpus' own ids, `^[a-z][a-z0-9._-]*$` (open set by design) | A §C.1 ("규칙 id") |
| `mixed` | the union of `primary` and `secondary` | A §C.2 |

Adding, renaming or removing a class is a contract change: it edits this table, `FINDINGS_CLASSES`, M3's
dictionary, M5's axis and the test in the same change.

## 6. `gaps.tsv` — the completeness register

Fifteen columns, header first, same TSV rules as §5 (A §B2/§C.4):

`id, area, surface, rule, current, ideal, before_artifact, severity, kind, class, type, unit, status, pr, fixed_head`

| Column | Value set | Meaning | Source |
| --- | --- | --- | --- |
| `id` | `G<n>`, n ≥ 1, unique | stable gap id; `before`/`after` receipts and plan rows cite it | A §B2 |
| `area`, `surface` | non-empty | the area and the surface (route, screen, file, artifact) | A §B2 |
| `rule` | `L<n>` or `skill:<skill>:<code>` (the skill's own id form, e.g. `skill:visual-qa:B1`) | the lens rule or omo rule that judges it | A §B1/§B2 |
| `current`, `ideal` | non-empty | observed state and ideal state | A §B2 |
| `before_artifact` | path or `-` | the pre-edit capture; required once a defect row is planned | A §B3 |
| `severity` | §5 severity | defect severity | A §B2 |
| `kind` | `defect` \| `taste` | visual-qa's own split; both are listed, only `defect` blocks | A §B2, O `visual-qa:227,367` |
| `class` | the row type's §5.1 set | the defect class | A §C.1 |
| `type` | `code` \| `design` \| `research` \| `audit` | the work type that owns the row | A §B2 |
| `unit` | non-empty | the unit that will close it | A §B5 |
| `status` | `open` \| `planned` \| `fixed` \| `accepted-limit` \| `out-of-scope` | register state | A §B2/§B5 |
| `pr` | PR number or `-` | the PR that closes it | A §B2 |
| `fixed_head` | §2 head or `-` | the head that fixed it | A §B2 |

Pairing (`validateGapReceipts`): every `before`/`after` receipt names a row; every `defect` row has a
`before` receipt; a `fixed` row also has an `after` receipt and a `fixed_head`. A request is complete only
when every `defect` row is `fixed`, `accepted-limit` (backed by a plan LIMIT row) or `out-of-scope`
(A §B5). `ideal.md` is prose — one paragraph per surface/area with the instantiated `L` rules (A §B2) — and
has no machine schema.

## 7. `lens.md` — judgment rules

One row per rule, six `|`-separated fields (A §B1):

`L<n> | rule | source anchor | universal|platform | persona/journey served | surface kinds it applies to`

Ids are unique, `scope` is `universal` or `platform`, and every field is non-empty. Reuse first: omo's own
distilled rules (visual-qa checklist, `frontend` build rules, `remove-ai-slops` categories) become the
first rows, and reading the corpus only hunts rules missing from them (A §B1).

## 8. Plan front matter and DEVICE rows

### 8.1 Front matter

The plan's YAML front matter parses to this object (`validatePlanFrontMatter`):

| Key | Type | Meaning | Source |
| --- | --- | --- | --- |
| `run_id` | `w-<slug>-<yyyymmdd>-<hhmm>` | run identity | D §2.2/§2.8 |
| `tier` | `S` \| `M` \| `L` | decided at intake, never lowered | D §2.3 |
| `type` | work type | the §3 type | A §C.4 |
| `unit`, `program_id` | string\|null, string\|null | the unit and program | A §B5/§C.4 |
| `worktree`, `branch` | absolute path, non-empty | every command pins the worktree | D §2.8 |
| `pr` | PR number or `null` | set once open | D §2.8 |
| `frozen_head` | §2 head or `null` | the reviewed head | D §2.6/§2.8 |
| `round` | integer ≥ 0 | rounds completed | D §2.8 |

### 8.2 `DEVICE:` rows — one paired verification device per plan row

Every IS/GAP row carries ≥1 `DEVICE:` row, and the form is fixed by the work type
(`validateDeviceRow`, A §B4):

| Type | Forms |
| --- | --- |
| `code` | `DEVICE: guard <INVARIANT> -> <node>` or `DEVICE: qa <command> => <binary observation>` |
| `design` | `DEVICE: vqa <item ids> @ <matrix cells> pair <case>-<state>-<width>-<theme>` |
| `research` | `DEVICE: claim C<n> gate(primary, domains>=<n>, counter-search)` |
| `audit` | `DEVICE: lint <command> exit 0` or `DEVICE: spot <n> rows reproduce` |

M2's `check-plan.mjs` lints the pairing (IS↔DEVICE, DEVICE form↔type, IS↔gap id when a register exists); M0
owns the grammar only.

## 9. `ledger.jsonl`

One JSON object per line, append-only, written only through `wish.mjs ledger append` (U for the field set,
D §2.8 and A §C.4 for the wish additions).

### 9.1 Events

`schema.mjs` exports the frozen list as `LEDGER_EVENTS`; the same alphabet names a receipt's stage.

`intake, lens, discover, ideal, gap, before, plan, plan_lint, plan_review, goal, build, verify_lane,
triage, fix, reuse, freeze, pr_open, gate, round, verdict, reopen, switch, progress, merge, post_merge,
checkpoint, cleanup, resume`

D §4's stage alphabet is unchanged; `lens, ideal, gap, before, switch, progress` are A §C.4 additions. `reopen`
is v2's review-tail event (§9.4): an approved review that a later, real defect re-opens.

### 9.2 Fields on every event

| Field | Type | Source |
| --- | --- | --- |
| `event`, `stage` | a §9.1 name; `stage` equals `event` | U, D §2.8 |
| `type` | work type | A §C.4/F |
| `unit`, `program_id` | string, string\|null | A §B5/§C.4/F |
| `plan` | plan path | U |
| `session_id` | `senpi:<id>` | U, D §2.9 |
| `started_at` | ISO-8601 UTC | D §2.8 |
| `head`, `tree` | §2 values when the event reports on a state | D §2.8, U |
| `ended_at`, `duration_s` | ISO timestamp, seconds ≥ 0 | D §2.10 |
| `commands`, `artifact`, `cleanup`, `attempt`, `checkpoint_opened_at`, `adversarial_classes` | U's field set | U |
| `category` \| `agent`, `model_family`, `lane`, `tier`, `verdict`, `round`, `reuse`, `gate_id`, `gate_status`, `checkpoint_op`, `pr`, `sha`, `merged_at`, `note`, `reason`, `primary`, `secondary`, `facts`, `progress`, `gap_id`, `gap_status`, `kind`, `premise`, `new_approach`, `rules_total`, `task` | optional, validated when present | D §2.2/§2.10, A §C.4/§C.6 |

### 9.3 Required extras per event

| Event | Extra required fields | Source |
| --- | --- | --- |
| `intake` | `tier`, `facts` (non-empty) | D §2.2/§2.3 |
| `lens` | `artifact` (lens.md), `rules_total` | A §B1 |
| `discover` | `artifact` | D §2.2 |
| `ideal` | `artifact` (ideal.md) | A §B2 |
| `gap` | `gap_id`, `gap_status` | A §B2/§C.4 |
| `before` | `gap_id`, `artifact` (the before receipt) | A §B3 |
| `plan` | `artifact` (the plan) | D §2.2 |
| `plan_lint` | — (`artifact` is the lint receipt; `verdict` optional) | M2 |
| `plan_review` | `verdict`: `OKAY` \| `BLOCKERS` | D §2.2 |
| `goal` | `artifact` (goal id) | D §2.2, A §B8 |
| `build` | `task` (node id), `head` | D §2.2 |
| `verify_lane` | `lane`, `verdict`, `head`, `tree` | D §2.2 |
| `triage` | — | D §2.2 |
| `fix` | `round` ≥ 0 (`0` = the pre-PR TRIAGE+FIX of D §2.2 step 7), `head` | D §2.2 |
| `reuse` | `reuse: {receipt, verdict: VALID\|STALE, reason}`, `head` | D §2.7 |
| `freeze` | `head`, `tree` (the git tree; `null` for research, whose `head` is the artifact sha256), `pr` (integer or `null` before the PR) | D §2.6 |
| `pr_open` | `pr` | D §2.2 |
| `gate` | `gate_id`, `gate_status` | D §2.6, P |
| `round` | `round` ≥ 1, `verdict` ∈ `APPROVED`/`REVISE` | C43, D §2.2 |
| `verdict` | `round`, `verdict`, `artifact` (the reviewer body), `head` | C44 |
| `reopen` | `round` (the `APPROVED` round it re-opens), `reason` ∈ `author-found-defect` \| `owner-found-defect`, `head` (the head the next round judges) | §9.4 |
| `switch` | `round`, `kind`, `premise`, `new_approach` | A §C.6 |
| `progress` | `progress` (§11 values) | A §B7/§C.4 |
| `merge` | `sha`, `merged_at`, `pr`, `head` | D §2.2 |
| `post_merge` | `head`, `tree` | D §2.2 |
| `checkpoint` | `checkpoint_op`: `open` \| `complete` \| `blocked` | U, D §2.2 |
| `cleanup` | `cleanup` with ≥1 receipt | D §2.2 |
| `resume` | `note` (the first invalid stage) | D §2.9 |

### 9.4 The cap is a switch, never an exit

`round` has **no terminal state**. There is no `[~]`, no blocked outcome, and no owner gate that ends
review: a cap triggers an approach switch and the review continues until `APPROVED` (A §C.6, superseding
D §2.2 step 10's `[~]` row, which A §C.6 deletes).

`validateLedgerSequence` enforces:

1. `round` events for a unit are `1, 2, 3, …` with no gap.
2. No further `round` follows an `APPROVED` round for that unit unless a `reopen` event for that unit sits
   between them, naming that round, a `reason` from the set above, and the head the coming round judges.
   A real approval that a later defect disproves is re-opened on the record; it is never silently
   overridden, and the re-opened round is judged at the head the `reopen` names.
3. A third-or-later `REVISE` round requires a `switch` event for the same round **before the next round** —
   otherwise the review continued without a change of approach, which is not an outcome.
4. A `switch` follows a `REVISE` round of the same round number, and its `kind` differs from the kinds already used until every applicable kind has been used — then the cycle may repeat (single-unit runs have four applicable kinds: `split` is program-mode only). This keeps A §C.6.1's "one more kind per REVISE" without creating the cap A §C.6.3 forbids: review has no round ceiling.
5. No event carries `[~]` or a terminal marker.

A `reopen` adds no outcome: review still ends only at `APPROVED`, and the re-opened round re-runs the same
lanes, the same gate and a fresh reviewer. The sentences above are the whole rule, so a cap stays an approach
switch and the owner is still never asked whether to keep reviewing.

`switch.kind` values (A §C.6.2): `premise` (the architect premise review has not run), `family` (the fix
node moves to a model family different from the one that produced the failed fix), `strategy` (a
`SWITCH: <failed premise> -> <new approach>` plan row; redesign the component, not the patch), `split` (program mode only: the failing component becomes its own unit and PR; the gap row stays open; a
single-unit run has four applicable kinds), and `rediscover` (re-run DISCOVER with the lens and sweep
variants).

The owner is asked only when the decision is theirs: an irreversible, destructive or spend decision, or a
contract-level LIMIT the product owner must accept. "Should we stop reviewing" is not a question. While a
gate is open, other units keep running (A §C.6.4, D §2.2).

## 10. Shared experiment columns

M7 writes these in exactly this order (C43), appending the v2 columns and never reordering:

| File | Columns | Source |
| --- | --- | --- |
| `measurements.csv` | `pr, repo, arm, common_arms, route_class, size_bucket, stacked_on, opened_at, merged_at, open_to_merge_min, rounds_total, ultrabrain_calls, code_reviewer_calls, architect_calls, content_commits_after_approval, step12_result, post_merge_refix, blind_rereview, invalid_flag, notes` | C43 |
| `rounds.csv` | `pr, round_index, round_kind, verdict_head, dispatch_at, verdict_at, minutes, reviewer, reviewer_family, defect_count, defect_axes, finding_scope, counterexample_present, gate_rows_fixed, gate_rows_not_fixed, gate_rows_no_command, c2_split, axis_lines_present, verdict_line_present, verdict_head_match` | C43 |

v2 appends (A §F M7, M0 for the round-level names): `measurements` gains
`type, unit, program_id, switch_count, rounds_after_switch, lens_rules, gaps_total, gaps_fixed,
before_receipts`; `rounds` gains `type, unit, program_id, switch_count, switch_kinds`. `validateCsvHeader`
accepts the base header or the base plus its exact suffix.

## 11. `status --json` and the `PROGRESS:` line

`wish.mjs status --json` prints exactly this object on stdout (D §4 + A §C.4):

| Key | Type | Meaning | Source |
| --- | --- | --- | --- |
| `run_id` | `w-<slug>-<yyyymmdd>-<hhmm>` | run identity (M0 addition to the D §4 / A §C.4 key list; the format is D §2.2's) | D §2.2 |
| `stage` | §9.1 name or `done` | furthest stage whose required receipts are valid | D §4 |
| `type`, `tier` | work type, `S`/`M`/`L` | from the plan | A §C.4, D §2.3 |
| `head`, `tree` | §2 or `null` | the state described | D §4 |
| `round` | integer ≥ 0 | current ultrabrain round | D §4 |
| `valid_receipts`, `stale_receipts` | receipt filenames | reuse verdict per receipt, judged against the state it certified; a unit whose run is finished (`stage: done`) reads its readable receipts as history — no lane of it can run again, so none is reported stale | D §4/§2.7 |
| `blocking` | strings | what stops `next`, e.g. `receipt:<file>`, `findings:<n> open`, `gate:<id> open`, `verdict:<reason>` | D §4 |
| `next` | §9.1 name or `done` | the only stage the session may dispatch; `blocking` says why it is blocked | D §4 |
| `units` | `[{id, stage, pr, round, switches}]`, where `stage` is a §9.1 name or `done` | per-unit state (program mode) | A §C.4 |
| `wave` | `{k, n}` | current wave of a program | A §B5/§C.4 |
| `progress` | §11 values | the counters the PROGRESS line prints | A §B7/§C.4 |

`status --progress` prints one machine-read line (A §B7):

`PROGRESS: run <id> · units <done>/<total> · gaps <fixed>/<total defect> · prs <merged> merged <open> open · wave <k>/<n> · round r<round> on <#pr|none> · switch <count> · waiting <what|none>`

The separator is `·` with one space either side; a run without a register prints `gaps n/a`; the line is
printed on every transition that changes a number, and while any unit runs at least every
`report.interval` minutes (default 30, `wish.yaml`, A §B7). A repeat with no change is suppressed.

## 12. `VERDICT:` line — identical to PR #44

The final review's last non-empty line is the verdict and must cover the frozen head (C44):

```
^VERDICT: (APPROVED|REVISE) round ([1-9][0-9]*) head ([0-9a-fA-F]{40})$
```

Parser semantics, verbatim from C44: CRLF-normalized, the last line whose `trim()` is non-empty is the
candidate, trailing whitespace is trimmed, the pattern is matched, and the head is lowercased. An empty
body fails with `body is empty`; a mismatch fails with
`last non-empty line is not a verdict line: <line>`. `round` is a positive integer with no leading zero and
no upper bound; a seven-character head is rejected. Coverage fails with
`verdict head <a> does not cover current head <b>`, and `requireApproved` fails with
`verdict is REVISE, not APPROVED`. `schema.mjs` exports `VERDICT_PATTERN_SOURCE`, `parseVerdict` and
`checkVerdictCoverage`; M4's `check-verdict.mjs` imports them instead of copying the pattern.

## 13. `gates.md` — owner questions

poteto-mode's rendered shape (P `store.ts:597-668`), adopted by D §2.8:

- `# Gates` heading, a blank line, then one `## <id>` block per question.
- Fields are `- Key: value` lines: `Status`, `Question`, `Options`, `Default`, and `Answer` only once
  resolved.
- `<id>` matches `[A-Za-z0-9][A-Za-z0-9_-]*` and is unique.
- `Options` lists at least two choices separated by ` | `; `Default` must be one of them.
- `Status: open` has no `Answer`; `Status: resolved` has one (the owner may answer outside the options).

A gate is parked only for an owner decision (D §2.2, A §C.6.4). Every gate open longer than 15 minutes is
recorded so `status` can report the wait (D §5.1).

## 14. CLI — `$SKILL/scripts/wish.mjs`

M1 implements one entry point. M0 fixes the verbs, arguments and exit codes.

| Verb | Arguments | Effect | Exit codes | Source |
| --- | --- | --- | --- | --- |
| `init` | `--run-id <w-slug-yyyymmdd-hhmm> --type <type> --tier <S\|M\|L> --plan <path> [--program <id>] [--unit <id>] [--worktree <path>]` | create `<ER>`, write front matter, append `intake` | 0 ok; 2 usage; 3 a different run owns the plan | D §2.8, A §F |
| `status` | `[--json] [--progress] [--head <sha>]` | replay the ledger, re-judge receipts, print §11 | 0 ok; 2 usage; 3 state unreadable or the head contradicts `frozen_head` | D §4 |
| `ledger` | `append --event <name> --json <file\|->` | validate one event (§9) and append it | 0 ok; 1 schema failure; 2 usage; 3 out of stage order | U, D §2.8 |
| `findings` | `add --tsv <file\|->`; `set --id <id> --status <status> [--fixed-head <sha>] [--blocking <0\|1>]` | append or transition findings | 0 ok; 1 schema or transition failure; 2 usage; 3 unknown id | D §2.8 |
| `gaps` | `add --tsv <file\|->`; `set --id <id> --status <status> [--pr <n>] [--fixed-head <sha>]`; `list [--json]` | maintain the register | 0 ok; 1 schema failure; 2 usage; 3 unknown id or illegal transition | A §B2/§F |
| `gate` | `[--round <n>]` / `add --id <id> --question <text> --options <a\|b> --default <a>` / `resolve --id <id> --answer <text>` | run the dispatch gate's reproduction table, or park/resolve a question | 0 ok; 1 a prior blocker still reproduces; 2 usage; 3 missing receipt or unknown gate | D §2.6, P |
| `freeze` | `[--head <sha>] [--pr <n>]` / `--check [--head <sha>]` | record `head`, `tree`, `pr`; `--check` proves nothing landed after it | 0 ok; 1 dirty tree, pending commit or verdict mismatch; 2 usage; 3 head moved | D §2.6 |
| `pr-body` | `[--pr <n>] [--out <path>]` | build the body, including the §4.2 before/after table; when the last round is `APPROVED` at the frozen head the body ends with its `VERDICT:` line | 0 ok; 2 usage; 3 freeze or a before/after pair is missing | D §2.2, A §B6 |
| `merge-ready` | `--body <path>` | refuse the merge-ready state until that body's last line is the `APPROVED` verdict on the frozen head and the ledger's last round names the same round and head | 0 merge ready; 1 not merge ready; 2 usage; 3 no freeze | D §2.2, §12 |
| `reuse-check` | `<receipt> --head <sha>` | tree match → VALID; else intersect changed files and their reference holders with `scope` | 0 VALID; 1 STALE; 2 usage; 3 unparseable or another run's receipt | D §2.7 |
| `switch` | `record --round <n> --kind <kind> --premise <text> --new-approach <text>` | record the approach switch (§9.4) | 0 ok; 1 schema failure; 2 usage; 3 no REVISE at that round | A §C.6 |
| `metrics` | `export [--out <dir>]`; `post-merge --days <n> [--pr <n>]` | write §10 rows; count post-merge refixes | 0 ok; 1 a row or query fails; 2 usage; 3 freeze/merge data missing | C43, D §2.10 |
| `resume-plan` | — | print the first invalid stage and the resume actions | 0 ok; 2 usage; 3 ledger missing | D §2.9 |

Exit codes are fixed by D §4: **0** ok, **1** check failed, **2** usage, **3** state mismatch. A usage
mistake never exits 1 and a schema failure never exits 3, so the session can branch without parsing text.
`--help` exits 0 on every verb and prints the usage above.

## 15. Machine-checked examples

Every block below is extracted by `extractExamples` (fence info string `wish:<tag>`) and validated by
`validateExamples`; `test/schema.test.js` requires the tag set to equal the documented one, so deleting or
unwiring an example fails the suite.

A code lane receipt (`kind: lane`):

```json wish:receipt
{
  "kind": "lane",
  "stage": "verify_lane",
  "type": "code",
  "unit": "u1",
  "program_id": null,
  "lane": "sweep",
  "head": "0123456789abcdef0123456789abcdef01234567",
  "tree": "89abcdef0123456789abcdef0123456789abcdef",
  "scope": ["skills/wish/scripts/**"],
  "started_at": "2026-10-27T16:20:00Z",
  "ended_at": "2026-10-27T16:24:30Z",
  "status": "WARN",
  "rows": [
    {
      "id": "secrets-canary",
      "command": "bun $SKILL/scripts/sweep.mjs --probe secrets",
      "observable": "the canary token appears in neither stdout nor any artifact",
      "verdict": "PASS",
      "artifact": "/evidence/w-u1-20261027-1610/receipts/sweep-secrets.log",
      "class": "SEC"
    },
    {
      "id": "docs-flags",
      "command": "bun $SKILL/scripts/sweep.mjs --probe docs",
      "observable": "every flag documented in ledger.md exists in --help",
      "verdict": "WARN",
      "artifact": null,
      "class": "DOC",
      "note": "two flags undocumented; filed as a note finding, never blocking"
    }
  ],
  "artifacts": ["/evidence/w-u1-20261027-1610/receipts/verify_lane-sweep-0123456.json"],
  "cleanup": ["rm -rf /tmp/wish-sweep-8f3 (exit 0)"]
}
```

A defect row's pre-edit capture (`kind: before`, gap pairing):

```json wish:receipt
{
  "kind": "before",
  "type": "design",
  "unit": "u2",
  "program_id": "p1",
  "lane": "capture",
  "gap": "G1",
  "head": "0123456789abcdef0123456789abcdef01234567",
  "tree": "89abcdef0123456789abcdef0123456789abcdef",
  "scope": ["app/routes/settings/**"],
  "started_at": "2026-10-27T16:00:00Z",
  "ended_at": "2026-10-27T16:02:00Z",
  "status": "PASS",
  "rows": [
    {
      "id": "settings-390-dark-before",
      "command": "browser capture --route /settings --width 390 --theme dark",
      "observable": "the primary action is the only prominent control in the pre-edit build",
      "verdict": "PASS",
      "artifact": "/evidence/w-u2-20261027-1600/receipts/before-G1-89abcde.png",
      "class": "B1"
    }
  ],
  "artifacts": ["/evidence/w-u2-20261027-1600/receipts/before-G1-89abcde.png"],
  "cleanup": []
}
```

A research claim gate (`head` is the artifact sha256, `tree` is null):

```json wish:receipt
{
  "kind": "claim-gate",
  "type": "research",
  "unit": "u3",
  "program_id": null,
  "lane": "claim-gate",
  "head": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "tree": null,
  "scope": ["report.html", "claims/claim-graph.json"],
  "started_at": "2026-10-27T16:30:00Z",
  "ended_at": "2026-10-27T16:33:00Z",
  "status": "PASS",
  "rows": [
    {
      "id": "C1-primary-domain",
      "command": "node $SKILL_DIR/scripts/report-tools.mjs check --claims claims/resolved.json",
      "observable": "claim C1 is supported by a primary source from a second distinct domain",
      "verdict": "PASS",
      "artifact": "/evidence/w-u3-20261027-1630/receipts/claim-gate-0123456.json",
      "class": "claim_unresolved"
    }
  ],
  "artifacts": ["/evidence/w-u3-20261027-1630/receipts/claim-gate-0123456.json"],
  "cleanup": []
}
```

The findings table:

```tsv wish:findings-tsv
id	round	source	class	severity	file_line	blocking	repro_cmd	head_found	status	fixed_head
F1	1	ultrabrain	C	HIGH	skills/wish/scripts/lib/schema.mjs:120	1	bun test test/schema.test.js --test-name-pattern "rejects a body whose verdict head does not cover HEAD"	0123456789abcdef0123456789abcdef01234567	open	-
F2	0	sweep	T	MEDIUM	test/schema.test.js:88	1	bun test test/schema.test.js --test-name-pattern "kills the guard when the class set loses PANIC"	0123456789abcdef0123456789abcdef01234567	fixed	1111111111111111111111111111111111111111
F3	0	code-review	DOC	LOW	skills/wish/references/ledger.md:12	0	no command	no head	note	-
```

The gap register:
```tsv wish:gaps-tsv
id	area	surface	rule	current	ideal	before_artifact	severity	kind	class	type	unit	status	pr	fixed_head
G1	settings	/settings	skill:visual-qa:B1	primary action is not unique	one prominent primary action	/evidence/w-u2-20261027-1600/receipts/before-G1-89abcde.png	HIGH	defect	B1	design	u2	planned	-	-
G2	settings	/settings	skill:visual-qa:C2	ISO timestamps shown raw	relative local times	-	LOW	taste	C2	design	u2	open	-	-
```

The lens:

```text wish:lens
L1 | One primary action per view, prominent by style not size | visual-qa B1 (HIG) | universal | first-time user on the primary journey | web, app, TUI
L2 | Destructive actions are never the Enter default | visual-qa B2 (HIG) | platform | keyboard user | macOS, web
```

The ledger, including a third-round REVISE that switches approach and a fourth-round APPROVED:

```jsonl wish:ledger
{"event":"intake","stage":"intake","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T16:00:00Z","tier":"M","facts":["new module: the M0 contract","three files touched"]}
{"event":"lens","stage":"lens","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T16:01:00Z","artifact":"/evidence/w-u1-20261027-1600/lens.md","rules_total":9}
{"event":"discover","stage":"discover","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T16:02:00Z","artifact":"/evidence/w-u1-20261027-1600/receipts/discover-explore-0123456.md"}
{"event":"ideal","stage":"ideal","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T16:03:00Z","artifact":"/evidence/w-u1-20261027-1600/ideal.md"}
{"event":"gap","stage":"gap","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T16:03:30Z","gap_id":"G1","gap_status":"planned"}
{"event":"before","stage":"before","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T16:04:00Z","gap_id":"G1","artifact":"/evidence/w-u1-20261027-1600/receipts/before-G1-89abcde.txt"}
{"event":"plan","stage":"plan","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T16:10:00Z","artifact":".omo/plans/wish-m0.md"}
{"event":"plan_review","stage":"plan_review","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T16:12:00Z","verdict":"OKAY","artifact":"/evidence/w-u1-20261027-1600/receipts/plan_review-architect-0123456.md"}
{"event":"goal","stage":"goal","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T16:13:00Z","artifact":"goal:01a17e58-u1"}
{"event":"build","stage":"build","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T16:14:00Z","task":"node-1","head":"0123456789abcdef0123456789abcdef01234567"}
{"event":"verify_lane","stage":"verify_lane","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T16:20:00Z","lane":"tests","verdict":"PASS","head":"0123456789abcdef0123456789abcdef01234567","tree":"89abcdef0123456789abcdef0123456789abcdef"}
{"event":"triage","stage":"triage","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T16:25:00Z"}
{"event":"fix","stage":"fix","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T16:40:00Z","round":0,"head":"0123456789abcdef0123456789abcdef01234567"}
{"event":"freeze","stage":"freeze","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T16:50:00Z","head":"0123456789abcdef0123456789abcdef01234567","tree":"89abcdef0123456789abcdef0123456789abcdef","pr":null}
{"event":"pr_open","stage":"pr_open","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T16:55:00Z","pr":51,"head":"0123456789abcdef0123456789abcdef01234567"}
{"event":"gate","stage":"gate","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T17:00:00Z","gate_id":"dispatch","gate_status":"resolved"}
{"event":"round","stage":"round","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T17:05:00Z","round":1,"verdict":"REVISE","head":"0123456789abcdef0123456789abcdef01234567"}
{"event":"round","stage":"round","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T17:30:00Z","round":2,"verdict":"REVISE","head":"0123456789abcdef0123456789abcdef01234567"}
{"event":"round","stage":"round","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T18:00:00Z","round":3,"verdict":"REVISE","head":"0123456789abcdef0123456789abcdef01234567"}
{"event":"switch","stage":"switch","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T18:01:00Z","round":3,"kind":"premise","premise":"the classifier only needed one more branch","new_approach":"re-read the input contract and delete the classifier"}
{"event":"round","stage":"round","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T18:20:00Z","round":4,"verdict":"APPROVED","head":"0123456789abcdef0123456789abcdef01234567"}
{"event":"verdict","stage":"verdict","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T18:20:00Z","round":4,"verdict":"APPROVED","head":"0123456789abcdef0123456789abcdef01234567","artifact":"/evidence/w-u1-20261027-1600/receipts/verdict-ultrabrain-0123456.md"}
{"event":"progress","stage":"progress","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T18:21:00Z","progress":{"units_done":1,"units_total":1,"gaps_fixed":1,"gaps_total":1,"prs_merged":0,"prs_open":1,"wave_k":1,"wave_n":1,"round":4,"switch":1,"waiting":"none"}}
{"event":"merge","stage":"merge","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T18:30:00Z","head":"0123456789abcdef0123456789abcdef01234567","sha":"2222222222222222222222222222222222222222","merged_at":"2026-10-27T18:30:00Z","pr":51}
{"event":"post_merge","stage":"post_merge","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T18:35:00Z","head":"0123456789abcdef0123456789abcdef01234567","tree":"89abcdef0123456789abcdef0123456789abcdef"}
{"event":"checkpoint","stage":"checkpoint","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T18:40:00Z","checkpoint_op":"complete"}
{"event":"cleanup","stage":"cleanup","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T18:45:00Z","cleanup":["worktree removed (exit 0)","branch deleted (exit 0)"]}
{"event":"resume","stage":"resume","type":"code","unit":"u1","program_id":null,"plan":".omo/plans/wish-m0.md","session_id":"senpi:01a17e58","started_at":"2026-10-27T18:50:00Z","note":"all stages valid"}
```

`status --json` for a program unit in its verify wave:

```json wish:status-json
{
  "run_id": "w-wish-demo-20261027-1610",
  "stage": "verify_lane",
  "type": "code",
  "tier": "M",
  "head": "0123456789abcdef0123456789abcdef01234567",
  "tree": "89abcdef0123456789abcdef0123456789abcdef",
  "round": 0,
  "valid_receipts": ["verify_lane-tests-0123456.json", "verify_lane-sweep-0123456.json"],
  "stale_receipts": ["verify_lane-qa-1111111.json"],
  "blocking": ["receipt:verify_lane-qa-1111111.json", "findings:2 open"],
  "next": "triage",
  "units": [
    {"id": "u1", "stage": "verify_lane", "pr": null, "round": 0, "switches": 0},
    {"id": "u2", "stage": "pr_open", "pr": 51, "round": 2, "switches": 1}
  ],
  "wave": {"k": 1, "n": 2},
  "progress": {
    "units_done": 0, "units_total": 2, "gaps_fixed": 1, "gaps_total": 5,
    "prs_merged": 0, "prs_open": 1, "wave_k": 1, "wave_n": 2,
    "round": 2, "switch": 1, "waiting": "verdict on #51"
  }
}
```

Plan front matter (the object the YAML parses to):

```json wish:plan-frontmatter
{
  "wish": {
    "run_id": "w-wish-demo-20261027-1610",
    "tier": "M",
    "type": "code",
    "unit": "u1",
    "program_id": null,
    "worktree": "/Volumes/storage/workspace/omo-wish-worktrees/v2",
    "branch": "wish-v2",
    "pr": null,
    "frozen_head": null,
    "round": 0
  }
}
```

The PROGRESS line:

```text wish:progress
PROGRESS: run w-wish-demo-20261027-1610 · units 0/2 · gaps 1/5 · prs 0 merged 1 open · wave 1/2 · round r2 on #51 · switch 1 · waiting verdict on #51
```

The PROGRESS line for a run with no register:

```text wish:progress
PROGRESS: run w-wish-demo-20261027-1610 · units 0/1 · gaps n/a · prs 0 merged 0 open · wave 1/1 · round r0 on none · switch 0 · waiting none
```

Gates, open and resolved:

```md wish:gates
# Gates

## G1

- Status: open
- Question: Should the settings page keep the legacy export button while the new one ships?
- Options: keep both | replace now
- Default: keep both

## G2

- Status: resolved
- Question: Is a contract class value allowed to change without a contract revision?
- Options: yes | no
- Default: no
- Answer: no; it edits this table, schema.mjs, M3, M5 and the test together
```

A verdict body (last non-empty line is the verdict):

```text wish:verdict
Axes: state none; boundary one note; tests none; docs none.
VERDICT: APPROVED round 4 head 0123456789abcdef0123456789abcdef01234567
```

Receipt filenames:

```text wish:receipt-name
verify_lane-sweep-0123456.json
plan_review-architect-0123456.md
before-G1-89abcde.png
after-G1-89abcde.png
vqa-passA-0123456.png
claim-gate-0123456.json
lint-draft-guard-89abcde.json
```

The four device forms:

```text wish:device-code
DEVICE: guard INV1 -> node-1
```

```text wish:device-design
DEVICE: vqa B1,B7 @ 390/1440 light/dark pair settings-default-390-dark
```

```text wish:device-research
DEVICE: claim C1 gate(primary, domains>=2, counter-search)
```

```text wish:device-audit
DEVICE: spot 12 rows reproduce
```

The shared CSV headers:

```csv wish:csv-measurements
pr,repo,arm,common_arms,route_class,size_bucket,stacked_on,opened_at,merged_at,open_to_merge_min,rounds_total,ultrabrain_calls,code_reviewer_calls,architect_calls,content_commits_after_approval,step12_result,post_merge_refix,blind_rereview,invalid_flag,notes
```

```csv wish:csv-rounds
pr,round_index,round_kind,verdict_head,dispatch_at,verdict_at,minutes,reviewer,reviewer_family,defect_count,defect_axes,finding_scope,counterexample_present,gate_rows_fixed,gate_rows_not_fixed,gate_rows_no_command,c2_split,axis_lines_present,verdict_line_present,verdict_head_match
```