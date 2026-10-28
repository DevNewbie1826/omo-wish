# lens: the extract rules for a corpus read in COLLECT

Use when the request names a reference corpus: a standard, a guideline set, a style guide, a book, a
paper set, or "make it match X". A corpus is one source of COLLECT: its rows land in `<ER>/collect.md` as
the rule list every later exploration, register row and review axis cites. Without one, "list everything wrong" produces taste dressed as defects.

When the request names no such source, COLLECT simply has no corpus source.

## Reuse before reading

The first rule rows are rules omo already distilled, because reading them again wastes the run:

| Surface | Already-distilled rules |
| --- | --- |
| rendered UI, TUI, documents | `visual-qa`'s checklist `A1`–`J2`, plus the `frontend` build rules |
| code quality | `remove-ai-slops`' ten categories, plus the `programming` practice rules |
| research | `ulw-research`'s source floor and delivery gates |
| the repository itself | its own `AGENTS.md`, README conventions and test rules |

Reading the corpus then hunts only what those lists miss. A rule that duplicates one of them is
dropped, not added twice.

## The extract rules

These nodes run inside the one COLLECT `mass-ulw` run, `wish-<run>-collect`, defined up front with files as
the handoff between nodes (never pasted text):

- [ ] 1. SLICE (harvest): split the corpus into disjoint, readable slices and record the split — a slice is a chapter, a section range or a page range, never "the whole thing" [omo: session] [receipt: the slice list under `<ER>/collect/`]
- [ ] 2. HARVEST (harvest): one `quick` or `deep-low` node per slice with the `lens-harvest` prompt (`../references/prompts.md` §5.1); each returns candidate rules with a source anchor, never a summary [omo: `mass-ulw` nodes] [receipt: one harvest output per slice]
- [ ] 3. EXTRACT (extract): one node per cluster with `lens-extract` (§5.2) — tag each candidate `universal` or `platform`, tie it to the persona and journey it serves, and drop what is a platform's own taste [omo: `mass-ulw` nodes] [receipt: one extract output per cluster]
- [ ] 4. REDUCE (extract): one `lens-reduce` node (§5.3) returns the rule rows — `L<n> | rule | source anchor | universal|platform | persona/journey served | surface kinds it applies to` — and reports how many candidates were dropped and why; the session writes them into `<ER>/collect.md` (one writer: `../SKILL.md`, evidence rules) [omo: `mass-ulw` reduce node] [receipt: the rule section of `<ER>/collect.md` with its total, under the `collect` event]
- [ ] 5. SCOPE (extract): `platform` rules never become a register row on a different platform; a `universal` rule with no surface that can instantiate it is dropped [omo: session] [receipt: the rule rows the register cites — `rule: L<n>`]

A corpus large enough to exceed `max_nodes_per_run` splits into two runs with the reducer in the
second; the reducer always sees files, never a transcript.

## What the rules feed

- the COLLECT `explore` lane prompts (the `lens-explore` template, §5.4) carry the rule list as questions.
- `define.md` names, per surface, the rules it must instantiate.
- each `gaps.tsv` row cites `rule: L<n>` or `skill:<skill>:<code>`, so a reviewer can check the basis.
- each review axis line names the rules it examined.

## Forbidden

Inventing a rule the corpus does not state; keeping a platform's local taste as a universal rule;
node writes: `../SKILL.md`, evidence rules; citing a
rule id that is not in the file.
