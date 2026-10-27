// Design classes — the omo frontend skill's draft-guard lint, wrapped so a
// design unit's verify wave has a scripted lane (addendum §F M3).
//
// The gate is a lint, so the receipt row is decided by an exit code:
//   0  clean                    -> PASS
//   1  findings                 -> FAIL, one row per rule the checker names
//   2  usage or unreadable      -> INVALID (the probe could not decide)
//
// The checker is not vendored here: its path arrives through the config or the
// SWEEP_DRAFT_GUARD environment variable, so this file names no install path.
// Its stderr is never copied into a row: a checker may print a credential while
// explaining itself, and the receipt is an artifact.

import { assertRevision, gitLines, q, row, runCommand, isMain, probeCli } from "./lib.mjs";

export const name = "draft-guard";
export const types = ["design"];
export const summary = "the draft guard reports no accent stripe and no generated copy";

export const usage = `config:
  "probes": { "draft-guard": {
    "checker": "bun /path/to/frontend/scripts/perfection/check-draft-guard.ts",
    "targets": ["app/routes/**"],
    "base": "origin/main"
  } }

The checker runs once as "<checker> --json <targets...>" and must follow the omo
frontend draft-guard contract: exit 0 clean, exit 1 findings, exit 2 usage or an
unreadable target, and a JSON array of
{ "file": "...", "line": 1, "column": 1, "rule": "...", "excerpt": "..." } on
stdout. "checker" defaults to the SWEEP_DRAFT_GUARD environment variable. When
neither is set the probe reports SKIP, never PASS: the class then belongs to the
checklist pass. "targets" defaults to the files the diff changed. A rule outside
the design class set of references/ledger.md keeps its row and its note but
carries no "class", so the receipt can never hold a class the contract rejects.`;

function changedFiles(root, base) {
  return gitLines(root, ["diff", "--name-only", `${assertRevision(base) ?? "origin/main"}...HEAD`])
    .then((text) => (text === null ? [] : text.split("\n").map((line) => line.trim()).filter(Boolean)));
}

export async function run(config, ctx) {
  const checker = config.checker ?? process.env.SWEEP_DRAFT_GUARD;
  if (!checker) {
    return [row({
      id: "draft-guard",
      verdict: "SKIP",
      observable: "a draft-guard checker is configured",
      note: "no checker: set probes.draft-guard.checker or SWEEP_DRAFT_GUARD; the class belongs to the checklist pass",
    })];
  }
  const targets = config.targets ?? await changedFiles(ctx.root, config.base);
  if (targets.length === 0) {
    return [row({
      id: "draft-guard", verdict: "SKIP", observable: "at least one target file is declared",
      note: "no targets declared and the diff changed no file",
    })];
  }
  const cmd = `${checker} --json ${targets.map((target) => q(target)).join(" ")}`;
  const result = await runCommand({ cmd, cwd: ctx.root, timeoutMs: config.timeoutMs ?? ctx.timeoutMs });
  const observed = "the draft guard exits 0 (no draft-guard finding)";
  if (result.code === 0) {
    return [row({ id: "draft-guard", command: cmd, observable: observed, verdict: "PASS", note: `${targets.length} target(s) clean` })];
  }
  if (result.code !== 1) {
    return [row({
      id: "draft-guard", command: cmd, observable: observed, verdict: "INVALID",
      note: `the checker could not decide (exit ${result.code}); its diagnostic is not copied here, so re-run the declared command to read it`,
    })];
  }
  let findings;
  try {
    findings = JSON.parse(result.stdout);
  } catch {
    findings = null;
  }
  if (!Array.isArray(findings)) {
    return [row({
      id: "draft-guard", command: cmd, observable: observed, verdict: "INVALID",
      note: "the checker exited 1 but wrote no JSON findings array; the report is not machine-readable",
    })];
  }
  if (findings.length === 0) {
    return [row({
      id: "draft-guard", command: cmd, observable: observed, verdict: "INVALID",
      note: "the checker exited 1 with an empty findings array",
    })];
  }
  return findings.map((finding) => row({
    id: `draft-guard/${finding.rule ?? "unknown"}:${finding.file ?? "?"}:${finding.line ?? 0}`,
    command: cmd,
    observable: observed,
    verdict: "FAIL",
    cls: ctx.classFor(finding.rule),
    note: `${finding.rule ?? "unknown rule"} at ${finding.file ?? "?"}:${finding.line ?? 0}${finding.excerpt ? ` > ${finding.excerpt}` : ""}`,
  }));
}

if (isMain(import.meta.url)) await probeCli({ name, types, summary, usage, run });