import { validateGapReceipts } from "../lib/schema.mjs";
import { listReceipts, readFindings, readGaps, rootPaths, stateMismatch, unitLedgerFacts, usage } from "../lib/store.mjs";
import { existsSync, lstatSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { findingOptions } from "./context.mjs";
import { planFor } from "./plan.mjs";
import { walkEvidence } from "./freeze.mjs";

function verbPrBody(parsed, root) {
  const { plan, planPath, events } = planFor(root, parsed, { missingPlanReason: "plan body" });
  const unit = plan.wish.unit ?? "u1";
  const { freeze: frozen } = unitLedgerFacts(events, unit);
  if (!frozen) throw stateMismatch("no freeze event: freeze the head before building the PR body");
  const gaps = readGaps(root) ?? [];
  const findings = readFindings(root, findingOptions(plan, events)) ?? [];
  const receipts = listReceipts(root);
  const names = receipts.map((receipt) => receipt.name);
  const defects = gaps.filter((row) => row.kind === "defect");
  const pairing = validateGapReceipts(defects, names);
  if (!pairing.ok) throw stateMismatch("the register's before/after receipts do not pair", pairing.errors);

  const beforeAfter = defects.length === 0
    ? ["no defect rows in this unit"]
    : [
      "| gap | before | after | state |",
      "| --- | --- | --- | --- |",
      ...defects.map((row) => {
        const after = names.find((name) => name.startsWith(`after-${row.id}-`));
        return `| ${row.id} | ${row.before_artifact} | ${after ?? "-"} | ${row.status} |`;
      }),
    ];

  const laneRows = receipts.filter((receipt) => receipt.body?.kind === "lane" && receipt.body.stage === "verify_lane");
  const verification = laneRows.length === 0
    ? ["no lane receipts"]
    : [
      "| lane | head | status |",
      "| --- | --- | --- |",
      ...laneRows.map((receipt) => `| ${receipt.body.lane} | ${String(receipt.body.head).slice(0, 7)} | ${receipt.body.status} |`),
    ];

  const findingRows = findings.length === 0
    ? ["no findings"]
    : [
      "| id | round | class | severity | blocking | status | file |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...findings.map((row) => `| ${row.id} | ${row.round} | ${row.class} | ${row.severity} | ${row.blocking} | ${row.status} | ${row.file_line} |`),
    ];

  const contract = planSection(plan.body, "## Contract") ?? `the plan's contract rows: ${planPath}`;
  const limits = planSection(plan.body, "### LIMIT rows (known limits, accepted)")
    ?? planSection(plan.body, "### LIMIT rows")
    ?? "none recorded in the plan";
  const outcome = planSection(plan.body, "## Purpose") ?? planPath;
  const pr = parsed.has("--pr") ? parsed.get("--pr") : (plan.wish.pr ?? "-");
  const lines = [
    `# ${plan.wish.run_id} - ${plan.wish.type} (${plan.wish.tier})`,
    "",
    ...(pr === null || pr === "-" ? ["PR: none"] : [`PR: #${pr}`]),
    `Frozen head: ${String(frozen.head)}  tree: ${frozen.tree ?? "null"}`,
    `Evidence root: ${root}`,
    "",
    "## Outcome",
    "",
    outcome,
    "",
    "## Contract",
    "",
    contract,
    "",
    "## Verification (lane receipts at this head)",
    "",
    ...verification,
    "",
    "## Findings",
    "",
    ...findingRows,
    "",
    "## Before / After",
    "",
    ...beforeAfter,
    "",
    "## Known limits",
    "",
    limits,
    "",
    "## Evidence",
    "",
    `- ledger: ${join(root, "ledger.jsonl")}`,
    `- receipts: ${join(root, "receipts")}`,
    `- findings: ${join(root, "findings.tsv")}`,
    "",
  ];
  const body = lines.join("\n");
  const out = parsed.get("--out");
  if (out) {
    // The caller chooses the path, but the run's own state is not a valid choice: a
    // typo there used to overwrite the append-only ledger (or the findings table)
    // with a PR body, outside the lock.
    const paths = rootPaths(root);
    // The body may be written inside the evidence root and nowhere else: a path
    // outside it is a product file, and this module writes no product file. Both
    // sides are resolved, so a symlinked alias of the root cannot walk out of it.
    const rootReal = realpathSync(paths.root);
    const planReal = existsSync(planPath) ? realpathSync(planPath) : planPath;
    const reserved = [paths.ledger, paths.findings, paths.gaps, paths.gates, paths.lens, paths.ideal,
      paths.resume, paths.lock].map((entry) => join(rootReal, relative(paths.root, entry))).concat(planReal);
    const requested = resolve(out);
    const parentReal = existsSync(dirname(requested)) ? realpathSync(dirname(requested)) : dirname(requested);
    // lstat sees a link that exists but points nowhere; existsSync does not, and a
    // write through it would create the target outside the root.
    let linkStat = null;
    try {
      linkStat = lstatSync(requested);
    } catch (error) {
      // Only "absent" means absent: a metadata error (EIO, EACCES) has to refuse the
      // write, or the dangling-link check silently disappears.
      if (error?.code !== "ENOENT") {
        throw stateMismatch(`cannot inspect the output path ${requested}: ${error?.code ?? error}`);
      }
      linkStat = null;
    }
    if (linkStat?.isSymbolicLink() && !existsSync(requested)) {
      throw usage(`--out is a dangling symlink: ${requested}`);
    }
    // An existing target is resolved through its own links: a symlink that leaves
    // the root is the same write as naming a path outside it.
    const targetReal = existsSync(requested) ? realpathSync(requested) : join(parentReal, basename(requested));
    const inside = targetReal === rootReal || targetReal.startsWith(rootReal + sep);
    const evidenceDirs = [join(rootReal, "receipts"), join(rootReal, "rounds")];
    if (!inside) throw usage(`--out must stay inside the evidence root: ${targetReal}`);
    if (reserved.includes(targetReal) || evidenceDirs.some((dir) => targetReal === dir || targetReal.startsWith(dir + sep))) {
      throw usage(`--out may not overwrite run state or evidence: ${targetReal}`);
    }
    // A hard link points at the same inode as a path that is not guarded here, so
    // identity is compared too: the state files and every artifact already in the
    // evidence directories. A link anywhere else that shares an inode is that file.
    if (existsSync(targetReal)) {
      const targetStat = statSync(targetReal);
      const guarded = reserved.slice();
      for (const dir of evidenceDirs) guarded.push(...walkEvidence(dir));
      for (const guard of guarded) {
        let guardStat;
        try {
          guardStat = statSync(guard);
        } catch (error) {
          // Absent is fine; any other metadata failure means the identity set is
          // unknown, and an unknown set cannot be trusted to be a superset.
          if (error?.code === "ENOENT") continue;
          throw stateMismatch(`cannot inspect ${guard}: ${error?.code ?? error}`);
        }
        if (guardStat.dev === targetStat.dev && guardStat.ino === targetStat.ino) {
          throw usage(`--out may not overwrite run state or evidence: ${targetReal} is ${guard}`);
        }
      }
    }
    try {
      writeFileSync(targetReal, body);
    } catch (error) {
      if (["ENOENT", "EISDIR", "ENOTDIR", "EACCES", "EPERM", "EROFS"].includes(error?.code)) {
        throw usage(`--out is not a writable path: ${targetReal} (${error.code})`);
      }
      throw error;
    }
    process.stdout.write(`${resolve(out)}\n`);
  } else process.stdout.write(body);
  return null;
}

function planSection(body, heading) {
  const lines = String(body ?? "").split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^## /.test(lines[index])) {
      end = index;
      break;
    }
  }
  // The renderer emits the heading, so the section body is returned without it.
  return lines.slice(start + 1, end).join("\n").trim();
}


export { verbPrBody };
