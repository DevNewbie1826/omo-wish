# wish v2 — defect-class dictionary (M3)

This file is the one dictionary behind three consumers:

1. the `class` column of `findings.tsv`, whose value set `scripts/lib/schema.mjs` enforces (M0
   `references/ledger.md` §5.1 owns the enum — this file never re-declares it, it maps it);
2. the review axes the final review reports one line per axis (M5 `references/prompts.md` uses these
   names verbatim);
3. the probe mapping in `scripts/probes/`: which scripted lane can decide which class, and which class
   only a reader can decide.

Adding, renaming or removing a class is a contract change: it edits M0's table and `FINDINGS_CLASSES`,
this file, M5's axis list and `test/sweep.test.js` in the same change.

## 1. How a probe row becomes a finding

A sweep row is a **claim, not a verdict** (design §2.6, M0 §4.1):

| Row verdict | What the session does | Receipt status it can produce |
| --- | --- | --- |
| `FAIL` | reproduce it, then file a finding with `blocking=1` and the row's `command` as `repro_cmd` | `FAIL`, exit 1 |
| `WARN` | file a `note` finding or drop it; it never blocks and never fails the run | `WARN`, exit 0 |
| `INVALID` | the probe could not decide (a mutation that did not compile, a checker with no machine report); the class returns to the checklist pass | `WARN`, exit 0 — an INVALID row is unproven, so it can never leave the receipt `PASS` and never blocks |
| `SKIP` | the probe did not apply; it never satisfies a required lane | `SKIP`, exit 0 |
| `PASS` | nothing to file; the PASS is still a claim the reviewer may contradict | `PASS`, exit 0 |

The derivation is fixed: any `FAIL` row makes the lane `FAIL` (exit 1); otherwise any `WARN` or `INVALID` row makes it `WARN` (exit 0); otherwise any `PASS` row makes it `PASS`; otherwise `SKIP`. M0's status set is `PASS|FAIL|WARN|SKIP`, and `PASS` means "every row passed", so an undecided line must cost the lane its PASS.

## 2. The measured table

Source: PR #47 (branch `exp/x1`), eleven independent review rounds over agent-sense PRs 8, 9, 10, 12, 21,
23 and genie 81 (2026-10-27). 52 findings, **29 blocking**, 2.64 blocking findings per round.

| Class (M0 value) | Measured rows | Blocking | Probe that decides it |
| --- | --- | --- | --- |
| `SEC` — a credential in errors or logs | 8 | 7 | `secrets` |
| `PANIC` — a crash on a contract input | 1 | 1 | `boundary` (crash marker on a generated variant) |
| `S` — cancellation and handler lifetime | 10 | 7 | `race`, `lifecycle` |
| `C` — an error chain dropped while wrapping | 2 | 2 | `errors` |
| `C` — boundary and odd input | 18 | 11 | `boundary` |
| `C` — the split-boundary variant: markup loses its attributes | 1 | 1 | `boundary` with an `expectStdout` round trip |
| `T` — a test that survives guard removal | 8 | 1 | `mutation` |
| `DOC` — documentation contradicting the code | 5 | 0 | `docs` (the mechanical half) |
| `CFG` — a config key accepted or rejected wrongly | 1 | 1 | `config` |

The scripted probes reach 47 of the 52 rows and 29 of the 29 blocking findings **in this sample**. That is a
sample fact, not a coverage guarantee: the classification was derived from the same rounds it measures
(PR #47's own limit 1), so re-measure on a new sample before quoting a rate.

## 3. The probes

Every probe is one module under `scripts/probes/`, is runnable alone
(`bun skills/wish/scripts/probes/<name>.mjs --help`), and is driven by `probes.<name>` in the sweep config.
A probe the change does not touch is not configured and reports `SKIP`.

Which probes a run may use is fixed by the work type (M0 §3, §5.1):

| Run type | Probes that produce rows |
| --- | --- |
| `code` | `secrets`, `boundary`, `race`, `lifecycle`, `errors`, `mutation`, `docs`, `config` |
| `design` | `draft-guard` |
| `mixed` | the union of `primary` and `secondary` |
| `research`, `audit` | none — the sweep writes no lane for them (see §6 and §7); a probe that does not apply reports `SKIP` with `probe types: …` so the receipt stays valid |

| Probe | Classes | What a `FAIL` means | What it does **not** decide |
| --- | --- | --- | --- |
| `secrets` | `SEC` | the canary reached a command's stdout/stderr or a log the run wrote | a secret that is only ever read from a file and never printed (no canary path) |
| `boundary` | `PANIC`, `C` | a crash marker, an exit outside the declared set, or a round trip that changed the input (one trailing newline is forgiven, other whitespace is significant) | whether the declared exit set is the *right* contract |
| `race` | `S` | the project's own race detector or the crash scan reported something | a race the detector cannot see |
| `lifecycle` | `S` | no readiness line, a living session survivor after the child exited (including one that moved into its own group), or an exit past the budget; `budgetMs` and `readyTimeoutMs` are clamped to 300 s | a survivor that left the session too |
| `errors` | `C` | a wrap site hides its cause (`%v`/`%s` instead of `%w`, `new Error(err.message)`, an empty catch); `strict: false` reports `WARN` | whether the message text is useful |
| `mutation` | `T` | `SURVIVED`: the suite stayed green with one added production line removed. A mutant that does not parse is `INVALID`, never a kill | a test that asserts the wrong thing but still fails on removal |
| `docs` | `DOC` | a documented flag is in neither the help output nor the `known` list | whether the prose describes the behavior correctly |
| `config` | `CFG` | the program accepted a declared reject case, or rejected a declared accept case | keys nobody declared a case for |
| `draft-guard` | design rules (`edge-stripe`, `promo-copy`, …), never `taste` | the omo `frontend` draft-guard checker exited 1 for the declared targets | anything the checker has no rule for |

The slop replay (`remove-ai-slops`' ten categories read over the diff) is **not** a script here: it is the
report-only lane in M5's prompts, because judging a category needs a reader. `draft-guard` is the one design
probe that is machine-decidable end to end, because its decision is an exit code.

`errors` and `mutation` look at **added production source lines** only: a line whose file matches the test
globs, or whose extension is not a source extension, is skipped (`testGlobs` and `codeExtensions` in the
config override both). Two reasons, both measured by this module's own first sweep: mutating a documentation
line demands a test that pins prose (which the flow forbids, and prose lines were consuming the mutation cap),
and scanning a test file reports its fixture needles as production wraps.

`draft-guard` takes its checker from `probes.draft-guard.checker` or `SWEEP_DRAFT_GUARD`, so this file names
no install path. Its rules must follow the omo `frontend` draft-guard contract: exit 0 clean, 1 findings, 2
usage or an unreadable target, and a JSON findings array on stdout. A rule id outside M0's design class set
keeps its row and its note but carries **no `class`**, so a receipt can never hold a class the contract
rejects (a known checker would make that a contract change, not a silent fallback).

## 4. Code classes: the script lane and the checklist lane

| Class | Meaning | Decided by |
| --- | --- | --- |
| `S` | state, lifetime, cancel, ownership | `race` + `lifecycle` scripted; a transition table read for the rest |
| `C` | input, IO, error boundary | `boundary` + `errors` scripted; the declared exit contract read |
| `D` | reconstructed instead of the original | checklist only — nothing scripted can tell a copy from the original |
| `O` | the real shipping path is missing | the QA lane (a lane that never runs the shipped entry point is the defect) and the checklist |
| `T` | a test that passes when the code is wrong | `mutation` |
| `W` | write and ownership boundary | checklist only — who owns a transition is a reading |
| `SEC` | a secret in logs or artifacts | `secrets` |
| `DOC` | code and docs disagree | `docs` for flags; the promise itself for prose |
| `CFG` | config accepted or rejected wrongly | `config` |
| `PANIC` | a crash on a contract input | `boundary` |
| `REGRESS` | a prior fix regressed | not probed by the sweep: the dispatch gate re-runs the prior finding's `repro_cmd` (M1 `gate`), and `mutation` is what keeps that reproduction from going vacuous |

## 5. Design classes

`design` runs carry the 69 `visual-qa` checklist item ids, the nine draft-guard rule ids, and `taste`
(M0 §5.1). Item ids are grouped as the checklist groups them, and the two review passes own different
groups: Pass A owns G–J, Pass B owns A–F.

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
| `edge-stripe`, `pseudo-bar`, `inset-shadow-stripe`, `gradient-stripe`, `accent-outline`, `promo-copy`, `emoji-icon`, `decorative-badge`, `vanity-stat` | draft-guard rules | **`draft-guard` probe** (exit code) |
| `taste` | a difference with no violated rule | listed, never blocking (visual-qa's own split) |

A capture matrix cell that no checklist item covers is not a class; it is a note. `taste` rows are listed in
the register so the register is complete, and the plan may only ride them along with a defect on the same
surface.

## 6. Research classes

The sweep has **no research lane**: research's machinery is `ulw-research`'s own scripts and gates, and this
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

Lanes: `fact-verify`, `claim-gate`, `skeptic`, `execution-verify`, `delivery-gate` (M0 §3) — each is a
receipt, and a claim with `claim_unresolved` at the delivery gate blocks.

## 7. Audit classes

`audit` classes are the **audited rule corpus' own ids**, an open set matching
`^[a-z][a-z0-9._-]*$` (M0 §5.1). No script here can know another corpus' id vocabulary, so the sweep writes
no audit lane: an audit unit's lanes are `lint` (a `kind: lint` receipt naming the lint in kebab-case),
`spot` (random rows re-run) and `register-schema` (the register parses and every rule × surface cell is
judged). The sweep's `docs`/`config` probes may serve an audit unit when the audited corpus is this
repository's own CLI, because then the ids are this repository's.

## 8. Review axes, one line each

The final review answers one line per axis with `clean` or a counterexample; an axis without a line is an
incomplete review, not a clean one.

| Type | Axes |
| --- | --- |
| `code` | error propagation; resource cleanup; concurrency and ordering; boundary and empty input; contract rows (IS/COMPANION/INVARIANT delivered); regression of the previous fix; secrets in output; docs-versus-code; config accept/reject; test strength |
| `design` | each lens rule instantiating a checklist id; capture freshness; the pair per changed surface; `taste` separated from `defect` |
| `research` | each claim's gate code; drift kinds; unresolved claims at the delivery gate |
| `audit` | coverage (every rule × surface judged); spot accuracy; register schema |

## 9. Learning patterns

Confidence from the measured table above: **strong** = three or more blocking rows or every row blocking
with at least two rows; **candidate** = one or two rows; **noise** = three or more rows with none blocking.
A pattern is a triage prior, never a reason to skip a reproduction.

| Pattern | Rows / blocking | Confidence | What it changes |
| --- | --- | --- | --- |
| a credential reaches the failure path | 8 / 7 | strong | `secrets` runs on every declared error path; `SEC` triage is blocking by default |
| odd and boundary input breaks the splitter | 18 / 11 | strong | `boundary` runs three generated variants per stdin case, always |
| a signal handler keeps the process or its child alive | 10 / 7 | strong | `lifecycle` measures the **group**, not the direct child |
| an error is re-wrapped without its cause | 2 / 2 | candidate | `errors` defaults to `WARN` unless the plan marks the chain as a contract (`strict`) |
| a config schema accepts what it must reject | 1 / 1 | candidate | `config` cases are declared per changed key |
| a suite stays green with a guard line removed | 8 / 1 | candidate | `mutation` is capped and reported as `WARN` when it cannot cover every line; a survivor still needs a reproduction before it blocks (the E7-shaped rule the owner set: a test finding blocks only with a reproduction) |
| the docs promise a flag the program lacks | 5 / 0 | noise | `docs` still reports the mechanical fact, and the session files it as a note unless the flag is a user-facing contract |

## 10. The runner contract

`bun skills/wish/scripts/sweep.mjs [--config <path>] [--root <dir>] [--probe <names>] [--lane <kebab>]
[--receipt <path|dir>] [--unit <id>] [--head <sha>] [--tree <sha>] [--scope <glob>]… [--type <type>]
[--primary <type>] [--secondary <type>]`

| Flag | Meaning |
| --- | --- |
| `--probe <names>` | comma-separated probes to run; default is every probe present in the config. M0's example invocations (`sweep.mjs --probe secrets`, `--probe mutation`) use this form |
| `--lane <kebab>` | the receipt's lane; default `sweep`, or the probe's own name when exactly one `--probe` is given (so `--probe draft-guard` writes `verify_lane-draft-guard-<head7>.json`, and `--probe mutation --lane tests` files that evidence under the `tests` lane M0 requires for `code`) |
| `--type`, `--primary`, `--secondary` | the run type; `mixed` requires both, and they are written into the receipt |
| `--scope` | repeatable; defaults to `**` |
| `--head`, `--tree` | derived from `git rev-parse` of `--root` when omitted; a `--head` that disagrees with the checkout's HEAD is refused (the commands run on HEAD, so the receipt would bind another state). A `mixed` run takes its **primary** type's identity form (M0 §2): with `primary: research` the head is the 64-hex artifact sha256 and `tree` is `null`, so neither is derived from git |
| config `base` | a revision only: an option-shaped value (`--output=…`) is refused, because it would turn a diff into a write outside the receipt and scratch boundary (INV4) |
| config `budgetMs` | the whole-run cap, default 600000 and clamped to it (design §2.5's ten minutes). When it runs out, the remaining probes are `SKIP` with the reason and one `sweep/budget` `WARN` row records it, so an unrun probe can never read as covered |
| config `timeoutMs`, `parallel` | per command (clamped to 300000) and pool width (clamped to 8) |

| Exit | Meaning |
| --- | --- |
| 0 | no row failed |
| 1 | a row failed |
| 2 | usage, unreadable config, a config that is not a JSON object, unknown probe or lane, an unknown type, or a receipt name that is not the M0 form |
| 3 | state mismatch: HEAD cannot be derived, `--head` is not the checkout's HEAD, the receipt would violate `references/ledger.md`, or the receipt cannot be written |

`--receipt` writes one `kind: lane`, `stage: verify_lane` receipt. A path that is an existing directory, ends with
`/`, or whose basename has no dot is a directory: it is created and the file inside takes the canonical
`verify_lane-<lane>-<head7>.json` name M0 §4.2 requires. Any other path must already be that canonical name —
a name M0 would reject is a usage error (exit 2), because a receipt the contract cannot read is not evidence.
A receipt is validated against M0 **before** it is written (exit 3 on a violation), and an unwritable
destination is a state mismatch (exit 3), never an uncaught error. The runner writes no findings, no ledger
event and no plan state: the session owns those files (M0 §1).

Known limits, accepted by the plan: probes see only declared entry points (LIM1); `mutation` covers at most
12 production lines per run and reports the rest as one `WARN` (LIM2); `draft-guard` without a checker is `SKIP`
(LIM3); `sessionMembers()` reads `/proc` with a `ps` fallback, so the primary kill is always the process
group (LIM4). A `draft-guard` row keeps the checker's finding excerpt, which is the surface's own source, not
the checker's diagnostic (LIM6) — a credential inside that source is a repository defect, not a receipt defect.