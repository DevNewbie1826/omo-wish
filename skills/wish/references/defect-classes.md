# wish v3 — defect-class dictionary

This file is the one dictionary behind two consumers:

1. the `class` column of `findings.tsv`, whose value set `scripts/lib/schema.mjs` enforces
   (`references/ledger.md` §5.1 owns the enum — this file never re-declares it, it maps it);
2. the review axes the final review reports one line per axis (`references/prompts.md` uses these
   names verbatim).

Adding, renaming or removing a class is a contract change: it edits `references/ledger.md` §5.1 and
`FINDINGS_CLASSES` in `scripts/lib/schema.mjs`, this file, and the axis list in `references/prompts.md`
in the same change.

## 1. The sweep lane is a checklist

The `sweep` lane a `code` run requires is a checklist lane, not a scripted one: a `quick` node walks the
class dictionary below over the changed files, runs the check each class names, and writes the same
`verify_lane-sweep-<head7>.json` receipt any other lane writes — one row per check with the literal
command (or `no command` for a read-through row), the one binary observable that decided it, and the
verdict. Receipt status semantics are `references/ledger.md` §4.1: a `FAIL` row is a claim the session
reproduces before it files a blocking finding; `WARN` never blocks; `SKIP` never satisfies a required
lane.

The mutation check is applied by hand: for each guard row of the plan, remove the guard line in a
throwaway copy of the changed file and require the declared suite to fail there (`references/plan-format.md`
§3). A survivor means a regression would pass unnoticed; the E7-shaped rule the owner set still holds — a
test finding blocks only with a reproduction.

## 2. The measured table

Source: PR #47 (branch `exp/x1`), eleven independent review rounds over agent-sense PRs 8, 9, 10, 12, 21,
23 and genie 81 (2026-10-27). 52 findings, **29 blocking**, 2.64 blocking findings per round. The scripted
probes that produced this table were removed with the sweep runner; the checks live on as the checklist
focus of §3.

| Class | Measured rows | Blocking |
| --- | --- | --- |
| `SEC` — a credential in errors or logs | 8 | 7 |
| `PANIC` — a crash on a contract input | 1 | 1 |
| `S` — cancellation and handler lifetime | 10 | 7 |
| `C` — an error chain dropped while wrapping | 2 | 2 |
| `C` — boundary and odd input | 18 | 11 |
| `C` — the split-boundary variant: markup loses its attributes | 1 | 1 |
| `T` — a test that survives guard removal | 8 | 1 |
| `DOC` — documentation contradicting the code | 5 | 0 |
| `CFG` — a config key accepted or rejected wrongly | 1 | 1 |

That is a sample fact, not a coverage guarantee: the classification was derived from the same rounds it
measures (PR #47's own limit 1), so re-measure on a new sample before quoting a rate.

## 3. Code classes: the checklist focus

| Class | Meaning | Checklist focus |
| --- | --- | --- |
| `S` | state, lifetime, cancel, ownership | run the changed entry point, signal it, and the process group dies within its budget; read the state and lifetime transition table for the rest |
| `C` | input, IO, error boundary | boundary variants on every declared input (empty, invalid UTF-8, a 4096-byte block, a split read) and the declared exit contract; a wrap site keeps its cause |
| `D` | reconstructed instead of the original | a reading — nothing mechanical can tell a copy from the original |
| `O` | the real shipping path is missing | the QA lane runs the shipped entry point (a lane that never does is the defect) plus this reading |
| `T` | a test that passes when the code is wrong | one hand-applied mutation per guard row (§1) |
| `W` | write and ownership boundary | a reading — who owns a transition is a reading |
| `SEC` | a secret in logs or artifacts | put a canary token in the environment of every declared error path and read the command's stdout, stderr and every log the run wrote |
| `DOC` | code and docs disagree | a documented flag exists in the help output; whether the prose describes the behavior needs the reviewer |
| `CFG` | config accepted or rejected wrongly | declared accept and reject cases per changed key |
| `PANIC` | a crash on a contract input | no crash marker on any contract input, generated variants included |
| `REGRESS` | a prior fix regressed | the dispatch gate re-runs the prior finding's `repro_cmd`; the mutation check is what keeps that reproduction from going vacuous |

The slop replay (`remove-ai-slops`' ten categories read over the diff) is **not** a lane here: it is the
report-only lane in `references/prompts.md`, because judging a category needs a reader.

## 4. Design classes

`design` runs carry the 69 `visual-qa` checklist item ids, the nine draft-guard rule ids, and `taste`
(`references/ledger.md` §5.1). Item ids are grouped as the checklist groups them, and the two review
passes own different groups: Pass A owns G–J, Pass B owns A–F.

| Ids | Group | Lane |
| --- | --- | --- |
| `A1`–`A12` | layout and alignment (incl. the `Layout:` contract line, `A12`) | capture + Pass B |
| `B1`–`B7` | hierarchy (incl. brief conformance, `B7`) | capture + Pass B |
| `C1`–`C8` | text and copy | capture + Pass B |
| `D1`–`D4` | touch and pointer targets | capture + Pass B |
| `E1`–`E6` | contrast, colour and themes | capture + Pass B |
| `F1`–`F7` | consistency and brand | capture + Pass B |
| `G1`–`G7` | motion and feedback | capture + Pass A |
| `H1`–`H11` | states | capture + Pass A |
| `I1`–`I5` | keyboard and accessibility | capture + Pass A |
| `J1`–`J2` | platform specifics | capture + Pass A |
| `edge-stripe`, `pseudo-bar`, `inset-shadow-stripe`, `gradient-stripe`, `accent-outline`, `promo-copy`, `emoji-icon`, `decorative-badge`, `vanity-stat` | draft-guard rules | **`draft-guard` checker** (exit code) |
| `taste` | a difference with no violated rule | listed, never blocking (visual-qa's own split) |

The `draft-guard` lane runs the omo `frontend` draft-guard checker directly on the declared targets. Its
rules must follow that checker's contract: exit 0 clean, 1 findings, 2 usage or an unreadable target, and
a JSON findings array on stdout. A rule id outside `references/ledger.md` §5.1's design class set keeps
its row and its note but carries **no `class`**, so a receipt can never hold a class the contract rejects.

A capture matrix cell that no checklist item covers is not a class; it is a note. `taste` rows are listed
in the register so the register is complete, and the plan may only ride them along with a defect on the
same surface.

## 5. Research classes

Research has no scripted lane: research's machinery is `ulw-research`'s own scripts and gates, and this
file only names the classes so `findings.tsv` can carry them and the final review can print one line per
gate.

| Class | Meaning |
| --- | --- |
| `untraceable_number` | a number in the deliverable with no source |
| `value_mismatch` | the number differs from its source |
| `quote_not_verbatim` | a quotation that is not word for word |
| `unbound_sentence` | a sentence no claim binds |
| `meaning_drift_confirmed`, `meaning_drift_warn` | a source's meaning changed in the retelling |
| `fidelity_unresolved` | the artifact and the claims still disagree |
| `subject_changed`, `scope_widened`, `hedge_dropped`, `certainty_added`, `causality_added`, `direction_flipped`, `population_changed`, `evidence_grade_raised`, `other` | the nine `drift_kind` values, for a drift finding |
| `claim_unresolved`, `claim_refuted` | a claim's state, for the claim gate |

Lanes: `fact-verify`, `claim-gate`, `skeptic`, `execution-verify`, `delivery-gate` — each is a receipt,
and a claim with `claim_unresolved` at the delivery gate blocks.

## 6. Audit classes

`audit` classes are the **audited rule corpus' own ids**, an open set matching `^[a-z][a-z0-9._-]*$`
(`references/ledger.md` §5.1). No generic lane can know another corpus' id vocabulary, so an audit unit's
lanes are `lint` (a `kind: lint` receipt naming the lint in kebab-case), `spot` (random rows re-run) and
`register-schema` (the register parses and every rule × surface cell is judged). The `docs` and `config`
checks of §3 may serve an audit unit when the audited corpus is this repository's own CLI, because then
the ids are this repository's.

## 7. Review axes, one line each

The final review answers one line per axis with `clean` or a counterexample; an axis without a line is an
incomplete review, not a clean one.

| Type | Axes |
| --- | --- |
| `code` | error propagation; resource cleanup; concurrency and ordering; boundary and empty input; contract rows (IS/COMPANION/INVARIANT delivered); regression of the previous fix; secrets in output; docs-versus-code; config accept/reject; test strength |
| `design` | each lens rule instantiating a checklist id; capture freshness; the pair per changed surface; `taste` separated from `defect` |
| `research` | each claim's gate code; drift kinds; unresolved claims at the delivery gate |
| `audit` | coverage (every rule × surface judged); spot accuracy; register schema |

## 8. Learning patterns

Confidence from the measured table above: **strong** = three or more blocking rows or every row blocking
with at least two rows; **candidate** = one or two rows; **noise** = three or more rows with none
blocking. A pattern is a triage prior, never a reason to skip a reproduction.

| Pattern | Rows / blocking | Confidence | What it changes |
| --- | --- | --- | --- |
| a credential reaches the failure path | 8 / 7 | strong | run the canary through every declared error path; `SEC` triage is blocking by default |
| odd and boundary input breaks the splitter | 18 / 11 | strong | run three generated variants per declared stdin case, always |
| a signal handler keeps the process or its child alive | 10 / 7 | strong | measure the process **group**, not the direct child |
| an error is re-wrapped without its cause | 2 / 2 | candidate | the wrap check defaults to `WARN` unless the plan marks the chain as a contract (`strict`) |
| a config schema accepts what it must reject | 1 / 1 | candidate | declare accept and reject cases per changed key |
| a suite stays green with a guard line removed | 8 / 1 | candidate | the mutation check is capped and reports a `WARN` row when it cannot cover every guard row; a survivor still needs a reproduction before it blocks (the E7-shaped rule the owner set) |
| the docs promise a flag the program lacks | 5 / 0 | noise | the docs check still reports the mechanical fact, and the session files it as a note unless the flag is a user-facing contract |
