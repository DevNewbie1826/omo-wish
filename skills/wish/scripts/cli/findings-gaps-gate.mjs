import { addFindings, addGaps, addGate, readFindings, readGaps, removeGate, resolveGate, setFinding, setGap, usage, withLock } from "../lib/store.mjs";
import { join, resolve } from "node:path";
import { expectPositional } from "./args.mjs";
import { readInput, findingOptions } from "./context.mjs";
import { planFor } from "./plan.mjs";
import { runDispatchGate } from "./dispatch-gate.mjs";

function verbFindings(parsed, root) {
  const command = expectPositional(parsed, ["add", "set", "list"], "findings");
  const { plan, events } = planFor(root, parsed);
  const options = findingOptions(plan, events);
  if (command === "add") {
    const source = parsed.get("--tsv");
    if (!source) throw usage("findings add needs --tsv <file|->");
    const added = withLock(root, () => addFindings(root, readInput(source, "--tsv"), options));
    process.stdout.write(`${JSON.stringify({ added: added.map((row) => row.id) })}\n`);
    return null;
  }
  if (command === "set") {
    const id = parsed.get("--id");
    if (!id) throw usage("findings set needs --id");
    const patch = {};
    if (parsed.has("--status")) patch.status = parsed.get("--status");
    if (parsed.has("--blocking")) patch.blocking = parsed.get("--blocking");
    if (parsed.has("--fixed-head")) patch.fixedHead = parsed.get("--fixed-head");
    if (Object.keys(patch).length === 0) throw usage("findings set needs --status, --blocking or --fixed-head");
    const row = withLock(root, () => setFinding(root, id, patch, options));
    process.stdout.write(`${JSON.stringify(row)}\n`);
    return null;
  }
  const rows = readFindings(root, options) ?? [];
  if (parsed.has("--json")) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  else {
    const header = ["id", "round", "source", "class", "severity", "blocking", "status", "file_line"].join("\t");
    process.stdout.write(`${[header, ...rows.map((row) => [row.id, row.round, row.source, row.class, row.severity, row.blocking, row.status, row.file_line].join("\t"))].join("\n")}\n`);
  }
  return null;
}

function verbGaps(parsed, root) {
  const command = expectPositional(parsed, ["add", "set", "list"], "gaps");
  if (command === "add") {
    const source = parsed.get("--tsv");
    if (!source) throw usage("gaps add needs --tsv <file|->");
    planFor(root, parsed);
    const added = withLock(root, () => addGaps(root, readInput(source, "--tsv")));
    process.stdout.write(`${JSON.stringify({ added: added.map((row) => row.id) })}\n`);
    return null;
  }
  if (command === "set") {
    const id = parsed.get("--id");
    if (!id) throw usage("gaps set needs --id");
    planFor(root, parsed);
    const patch = {};
    if (parsed.has("--status")) patch.status = parsed.get("--status");
    if (parsed.has("--pr")) patch.pr = parsed.get("--pr");
    if (parsed.has("--fixed-head")) patch.fixedHead = parsed.get("--fixed-head");
    if (parsed.has("--before-artifact")) patch.beforeArtifact = parsed.get("--before-artifact");
    if (Object.keys(patch).length === 0) throw usage("gaps set needs --status, --pr, --fixed-head or --before-artifact");
    const row = withLock(root, () => setGap(root, id, patch));
    process.stdout.write(`${JSON.stringify(row)}\n`);
    return null;
  }
  planFor(root, parsed);
  const rows = readGaps(root) ?? [];
  if (parsed.has("--json")) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  else {
    const header = ["id", "area", "surface", "kind", "severity", "status", "pr", "fixed_head"].join("\t");
    process.stdout.write(`${[header, ...rows.map((row) => [row.id, row.area, row.surface, row.kind, row.severity, row.status, row.pr, row.fixed_head].join("\t"))].join("\n")}\n`);
  }
  return null;
}

function verbGate(parsed, root) {
  const command = parsed.positionals[0];
  if (command === "add" || command === "remove" || command === "resolve") {
    const allowed = command === "add" ? ["--id", "--question", "--options", "--default"]
      : command === "resolve" ? ["--id", "--answer"] : ["--id"];
    for (const flag of ["--round", "--id", "--question", "--options", "--default", "--answer", "--head", "--timeout", "--dry-run"]) {
      if (!allowed.includes(flag) && parsed.has(flag)) throw usage(`gate ${command}: unexpected flag ${flag}`);
    }
  }
  if (command === "add") {
    if (parsed.positionals.length > 1) throw usage(`gate add: unexpected argument ${parsed.positionals[1]}`);
    planFor(root, parsed);
    const gate = withLock(root, () => addGate(root, {
      id: parsed.get("--id"),
      question: parsed.get("--question"),
      options: parsed.get("--options"),
      fallback: parsed.get("--default"),
    }));
    process.stdout.write(`${JSON.stringify(gate)}\n`);
    return null;
  }
  if (command === "resolve") {
    if (parsed.positionals.length > 1) throw usage(`gate resolve: unexpected argument ${parsed.positionals[1]}`);
    planFor(root, parsed);
    const gate = withLock(root, () => resolveGate(root, { id: parsed.get("--id"), answer: parsed.get("--answer") }));
    process.stdout.write(`${JSON.stringify(gate)}\n`);
    return null;
  }
  if (command === "remove") {
    if (parsed.positionals.length > 1) throw usage(`gate remove: unexpected argument ${parsed.positionals[1]}`);
    planFor(root, parsed);
    const gate = withLock(root, () => removeGate(root, { id: parsed.get("--id") }));
    process.stdout.write(`${JSON.stringify(gate)}\n`);
    return null;
  }
  if (command !== undefined) throw usage(`gate: unknown subcommand ${command} (add, remove, resolve)`);
  return runDispatchGate(parsed, root);
}

// The dispatch gate (design §2.6 C1): re-run every open blocker's reproduction
// on the current head. Exit 0 only when nothing reproduces and no row is
// unprovable; a row that still reproduces is recorded as 'not-fixed' (that is
// what stops an ultrabrain dispatch) and a row with no command as 'no-command'.

export { verbFindings, verbGaps, verbGate };
