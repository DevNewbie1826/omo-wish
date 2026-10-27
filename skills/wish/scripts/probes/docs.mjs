// Class DOC — documentation that promises a flag the program does not have.
//
// Measured: 5 rows, none blocking, and the reason this probe reports only the
// mechanical half: a documented flag must exist in the help output. Whether the
// prose promise matches the behavior needs a reader, so it stays in the
// checklist pass.

import { readFileSync } from "node:fs";
import { matchFiles, row, syncText, isMain, probeCli } from "./lib.mjs";

export const name = "docs";
export const types = ["code"];
export const summary = "every documented flag exists in the help output";

export const usage = `config:
  "probes": { "docs": {
    "helpCmd": "bin --help", "docs": ["docs/**/*.md"], "known": ["--internal-flag"],
    "flagPattern": "--[a-z][a-z0-9-]{2,}"
  } }

Every token matched by "flagPattern" in the changed docs must appear in the
output of "helpCmd" or in "known". FAIL means the documentation promises a flag
that does not exist. A documented flag with a wrong description is not decided
here; that row goes to the checklist pass.`;

export async function run(config, ctx) {
  const cls = ctx.classFor("DOC");
  const docs = matchFiles(ctx.root, config.docs ?? []);
  if (docs.length === 0) {
    return [row({ id: "docs", verdict: "SKIP", observable: "at least one changed doc is declared", cls, note: "no changed docs matched" })];
  }
  if (!config.helpCmd) {
    return [row({ id: "docs", verdict: "SKIP", observable: "a help command is declared", cls, note: "no help command; documented flags go to the checklist pass" })];
  }
  const help = syncText(config.helpCmd, ctx.root);
  const known = new Set(config.known ?? []);
  const pattern = new RegExp(config.flagPattern ?? "--[a-z][a-z0-9-]{2,}", "g");
  const documented = new Set();
  for (const file of docs) {
    for (const match of readFileSync(file, "utf8").matchAll(pattern)) documented.add(match[0]);
  }
  if (documented.size === 0) {
    return [row({ id: "docs", verdict: "SKIP", observable: "a flag is documented in the changed docs", cls, note: "no flags documented in the changed docs" })];
  }
  const checks = [];
  for (const token of documented) {
    if (known.has(token)) {
      checks.push(row({
        id: `docs/${token}`, command: config.helpCmd,
        observable: "a documented flag is in the help output or the known list",
        verdict: "PASS", cls, note: "declared known in the sweep config",
      }));
      continue;
    }
    const present = help.includes(token);
    checks.push(row({
      id: `docs/${token}`, command: config.helpCmd,
      observable: "a documented flag is in the help output or the known list",
      verdict: present ? "PASS" : "FAIL", cls,
      note: present ? "documented flag exists in help output" : "documented flag does not exist in help output or the known list",
    }));
  }
  return checks;
}

if (isMain(import.meta.url)) await probeCli({ name, types, summary, usage, run });