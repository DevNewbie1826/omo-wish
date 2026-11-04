import { CLI_VERBS, LEDGER_EVENTS } from "../lib/schema.mjs";
import { usage } from "../lib/store.mjs";
import { join, resolve } from "node:path";

const VERB_USAGE = {
  init: [
    "init --run-id <w-slug-yyyymmdd-hhmm> --type <code|design|research|audit|mixed> --tier <S|M|L> --plan <path>",
    "     [--program <id>] [--unit <id>] [--worktree <path>] [--branch <name>]",
    "     [--primary <type> --secondary <type> (mixed only)] [--fact <text>]... [--session <senpi:id>]",
    "     Create <ER>, write the plan front matter and append the intake event.",
  ],
  status: [
    "status [--json] [--progress] [--head <sha>] [--plan <path>]",
    "     Replay the ledger, re-judge every receipt against the current tree, print §11.",
  ],
  ledger: [
    "ledger append --event <name> [--json <file|->]",
    "     Validate one §9 event and append it. Missing stage/started_at/plan/type/unit",
    "     are filled from the plan front matter.",
    `     Events: ${LEDGER_EVENTS.join(", ")}.`,
  ],
  findings: [
    "findings add --tsv <file|->",
    "findings set --id <id> [--status <status>] [--fixed-head <sha>] [--blocking <0|1>]",
    "findings list [--json]",
  ],
  gaps: [
    "gaps add --tsv <file|->",
    "gaps set --id <G<n>> [--status <status>] [--pr <n>] [--fixed-head <sha>] [--before-artifact <path>]",
    "     A non-open defect row needs its before capture; without the flag the existing before receipt is bound.",
    "gaps list [--json]",
  ],
  gate: [
    "gate add --id <id> --question <text> --options <a|b> --default <a>",
    "gate remove --id <id>",
    "gate resolve --id <id> --answer <text>",
    "gate --round <n> [--head <sha>] [--timeout <seconds>] [--dry-run]",
    "     Park/resolve an owner question, or run the dispatch reproduction table.",
  ],
  freeze: [
    "freeze [--head <sha>] [--pr <n>]",
    "freeze --check [--head <sha>]",
    "     Record head, tree and pr; --check proves nothing landed after the freeze.",
  ],
  "pr-body": ["pr-body [--pr <n>] [--out <path>]", "     Build the PR body from state, including the before/after table."],
  switch: [
    "switch record --round <n> --kind <premise|family|strategy|split|rediscover> --premise <text> --new-approach <text>",
    "     Record an approach switch. A cap is a switch, never an exit (§9.4).",
  ],
  "resume-plan": ["resume-plan", "     Print the first invalid stage and the actions that clear it."],
};

const ROOT_NOTE = [
  "Shared: --root <ER> (or WISH_EVIDENCE_ROOT) is the evidence root; --plan overrides the plan path;",
  "        --session <senpi:id> overrides the ledger session id; --help exits 0 on every verb.",
].join("\n");

function printUsage() {
  const lines = [
    "wish - wish v2 state and CLI (module M1)",
    "",
    "usage: wish <verb> [flags]",
    "",
    ...CLI_VERBS.map((verb) => `  ${verb}`),
    "",
    `ledger append events: ${LEDGER_EVENTS.join(", ")}`,
    "",
    "exit codes: 0 ok, 1 check failed, 2 usage, 3 state mismatch",
    "",
    ROOT_NOTE,
    "",
    "run 'wish <verb> --help' for one verb",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function printVerbUsage(verb) {
  const lines = [VERB_USAGE[verb][0], ...VERB_USAGE[verb].slice(1), "", ROOT_NOTE];
  process.stdout.write(`${lines.join("\n")}\n`);
}

// ----------------------------------------------------------------- argv flags

export { printUsage, printVerbUsage };
