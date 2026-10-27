import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CLI_VERBS,
  EXIT_CODES,
  FINDINGS_CLASSES,
  FINDINGS_COLUMNS,
  GAPS_COLUMNS,
  LEDGER_EVENTS,
  PROGRESS_PATTERN_SOURCE,
  RECEIPT_KINDS,
  RECEIPT_STATUSES,
  SWITCH_KINDS,
  VQA_ITEM_IDS,
  blockingStatus,
  checkVerdictCoverage,
  extractExamples,
  findingsClassesFor,
  formatProgressLine,
  parseFindingsTsv,
  parseGapsTsv,
  parseGatesMarkdown,
  parseProgressLine,
  parseReceiptFilename,
  parseVerdict,
  receiptFilename,
  requiredReceiptsFor,
  validateCsvHeader,
  validateDeviceRow,
  validateExamples,
  validateGapReceipts,
  validateLedgerEvent,
  validateLedgerSequence,
  validatePlanFrontMatter,
  validateReceipt,
  validateReceiptAgainstFilename,
  validateStatusJson,
} from "../skills/wish/scripts/lib/schema.mjs";

const contract = readFileSync(new URL("../skills/wish/references/ledger.md", import.meta.url), "utf8");
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "1111111111111111111111111111111111111111";
const TREE = "89abcdef0123456789abcdef0123456789abcdef";
const SHA256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function receipt(overrides = {}) {
  return {
    kind: "lane", stage: "verify_lane", type: "code", unit: "u1", program_id: null,
    lane: "tests", head: HEAD, tree: TREE, scope: ["test/**"],
    started_at: "2026-10-27T16:00:00Z", ended_at: "2026-10-27T16:01:00Z",
    status: "PASS",
    rows: [{ id: "r1", command: "bun test", observable: "the suite is green", verdict: "PASS", artifact: null }],
    artifacts: [], cleanup: [], ...overrides,
  };
}

function event(overrides = {}) {
  return {
    event: "intake", stage: "intake", type: "code", unit: "u1", program_id: null,
    plan: ".omo/plans/wish-x.md", session_id: "senpi:01a17e58",
    started_at: "2026-10-27T16:00:00Z", tier: "M", facts: ["one fact"], ...overrides,
  };
}

function codes(result) {
  return result.errors.map((entry) => entry.path);
}

const docExamples = extractExamples(contract);
const ledgerExample = docExamples.find((example) => example.tag === "wish:ledger");
const ledgerEvents = ledgerExample.text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));

test("the contract's own examples all validate and every documented tag is wired", () => {
  const result = validateExamples(contract);
  expect(result.examples.filter((example) => !example.ok)).toEqual([]);
  expect(result.ok).toBe(true);
  expect(new Set(docExamples.map((example) => example.tag))).toEqual(new Set([
    "wish:receipt", "wish:findings-tsv", "wish:gaps-tsv", "wish:lens", "wish:ledger",
    "wish:status-json", "wish:plan-frontmatter", "wish:progress", "wish:gates",
    "wish:verdict", "wish:receipt-name", "wish:device-code", "wish:device-design",
    "wish:device-research", "wish:device-audit", "wish:csv-measurements", "wish:csv-rounds",
  ]));
  expect(docExamples.length).toBeGreaterThanOrEqual(19);
});

test("head is a commit SHA for code and the artifact sha256 for research", () => {
  expect(validateReceipt(receipt()).ok).toBe(true);
  expect(validateReceipt(receipt({ head: SHA256 })).ok).toBe(false);
  const research = receipt({ kind: "claim-gate", type: "research", lane: "claim-gate", head: SHA256, tree: null, stage: undefined });
  expect(validateReceipt(research).ok).toBe(true);
  expect(codes(validateReceipt({ ...research, tree: TREE }))).toContain("receipt.tree");
  expect(validateReceipt({ ...research, head: HEAD }).ok).toBe(false);
});

test("WARN never blocks; only FAIL does", () => {
  expect(blockingStatus("FAIL")).toBe(true);
  for (const status of RECEIPT_STATUSES.filter((value) => value !== "FAIL")) {
    expect(blockingStatus(status)).toBe(false);
  }
  expect(RECEIPT_STATUSES).toEqual(["PASS", "FAIL", "WARN", "SKIP"]);
});

test("a receipt body must agree with its filename anchors", () => {
  const name = receiptFilename({ stage: "verify_lane", lane: "tests", head: HEAD });
  expect(name).toBe("verify_lane-tests-0123456.json");
  expect(validateReceiptAgainstFilename(receipt(), name).ok).toBe(true);
  expect(validateReceiptAgainstFilename(receipt({ head: OTHER }), name).ok).toBe(false);
  expect(validateReceiptAgainstFilename(receipt({ lane: "qa" }), name).ok).toBe(false);
  expect(parseReceiptFilename("before-G1-89abcde.png")).toMatchObject({ ok: true, kind: "before", gap: "G1" });
  expect(parseReceiptFilename("vqa-passA-0123456.png")).toMatchObject({ ok: true, kind: "vqa-passA" });
  expect(parseReceiptFilename("lint-draft-guard-89abcde.json")).toMatchObject({ ok: true, kind: "lint", name: "draft-guard" });
  expect(parseReceiptFilename("unknown-stage-x-0123456.json").ok).toBe(false);
  for (const kind of RECEIPT_KINDS) expect(typeof kind).toBe("string");
});

test("findings rows enforce the column set, the class set and non-blocking notes", () => {
  const header = FINDINGS_COLUMNS.join("\t");
  const good = `${header}\nF1\t1\tultrabrain\tC\tHIGH\tsrc/a.mjs:4\t1\tbun test\t${HEAD}\topen\t-\n`;
  expect(parseFindingsTsv(good, { type: "code" }).ok).toBe(true);
  expect(codes(parseFindingsTsv(good, { type: "design" }))).toContain("row[1].class");
  const note = `${header}\nF1\t1\tultrabrain\tC\tHIGH\tsrc/a.mjs:4\t1\tno command\tno head\tnote\t-\n`;
  expect(codes(parseFindingsTsv(note))).toContain("row[1].blocking");
  const short = `${header}\nF1\t1\tultrabrain\tC\tHIGH\tsrc/a.mjs:4\t1\tbun test\t${HEAD}\topen\n`;
  expect(parseFindingsTsv(short).ok).toBe(false);
  const fixed = `${header}\nF1\t1\tsweep\tT\tLOW\ttest/a.test.js:9\t1\tbun test\t${HEAD}\tfixed\t-\n`;
  expect(codes(parseFindingsTsv(fixed))).toContain("row[1].fixed_head");
});

test("gaps rows enforce per-type classes, before pairing and unique ids", () => {
  const header = GAPS_COLUMNS.join("\t");
  const row = (cells) => `${header}\n${cells.join("\t")}\n`;
  const planned = ["G1", "area", "surface", "L1", "now", "ideal", "/e/before-G1-89abcde.png", "HIGH", "defect", "B1", "design", "u1", "planned", "-", "-"];
  expect(parseGapsTsv(row(planned)).ok).toBe(true);
  expect(codes(parseGapsTsv(row([...planned.slice(0, 12), "bogus", ...planned.slice(13)])))).toContain("row[1].status");
  expect(codes(parseGapsTsv(row([...planned.slice(0, 6), "-", ...planned.slice(7)]))), "an edited defect row needs its capture")
    .toContain("row[1].before_artifact");
  expect(codes(parseGapsTsv(row([...planned.slice(0, 9), "S", ...planned.slice(10)])))).toContain("row[1].class");
  expect(parseGapsTsv(row(["G1", ...planned.slice(1)]) + "\n" + planned.join("\t")).ok).toBe(false);
});

test("gap receipts pair both ways with the register", () => {
  const header = GAPS_COLUMNS.join("\t");
  const text = `${header}\nG1\tarea\tsurface\tL1\tnow\tideal\t/e/before-G1-89abcde.png\tHIGH\tdefect\tB1\tdesign\tu1\tplanned\t-\t-\n`;
  const { rows } = parseGapsTsv(text);
  expect(validateGapReceipts(rows, ["before-G1-89abcde.png"]).ok).toBe(true);
  expect(codes(validateGapReceipts(rows, []))).toContain("gap:G1");
  expect(codes(validateGapReceipts(rows, ["before-G1-89abcde.png", "before-G9-89abcde.png"]))).toContain("receipt:G9");
  const fixed = text.replace("planned", "fixed").replace("G1\tarea", "G1\tarea").replace("-\t-\n", `${HEAD}\t-\n`);
  expect(codes(validateGapReceipts(parseGapsTsv(fixed).rows, ["before-G1-89abcde.png"]))).toContain("gap:G1");
});

test("a third REVISE requires a switch and no round may follow APPROVED", () => {
  expect(validateLedgerSequence(ledgerEvents).ok).toBe(true);
  const withoutSwitch = ledgerEvents.filter((entry) => entry.event !== "switch");
  expect(codes(validateLedgerSequence(withoutSwitch))).toContain("unit u1 round 3");

  const duplicateKind = ledgerEvents.map((entry) => entry.event === "switch" ? { ...entry, kind: "premise" } : entry);
  const round4 = duplicateKind.findIndex((entry) => entry.event === "round" && entry.round === 4);
  duplicateKind.splice(round4, 0, { ...duplicateKind.find((entry) => entry.event === "switch"), round: 4, kind: "premise" });
  expect(validateLedgerSequence(duplicateKind).ok).toBe(false);

  const afterApproval = [...ledgerEvents, { ...ledgerEvents[0], event: "round", stage: "round", round: 5, verdict: "REVISE", head: HEAD, started_at: "2026-10-27T19:00:00Z" }];
  afterApproval[afterApproval.length - 1] = { ...afterApproval[afterApproval.length - 1], tier: undefined, facts: undefined };
  expect(codes(validateLedgerSequence(afterApproval))).toContain("unit u1 round 4");

  const capped = ledgerEvents.map((entry) => entry.event === "round" && entry.round === 3 ? { ...entry, terminal: true } : entry);
  expect(codes(validateLedgerSequence(capped))).toContain("events[18].terminal");
});

test("every event names its work type, unit and program, and its required extras", () => {
  expect(validateLedgerEvent(event()).ok).toBe(true);
  for (const key of ["type", "unit", "program_id"]) {
    const broken = event();
    delete broken[key];
    expect(validateLedgerEvent(broken).ok).toBe(false);
  }
  expect(validateLedgerEvent(event({ event: "switch", stage: "switch", round: 3, kind: "strategy", premise: "p", new_approach: "n" })).ok).toBe(true);
  expect(validateLedgerEvent(event({ event: "switch", stage: "switch", round: 3, kind: "guess", premise: "p", new_approach: "n" })).ok).toBe(false);
  expect(SWITCH_KINDS).toEqual(["premise", "family", "strategy", "split", "rediscover"]);
  expect(LEDGER_EVENTS).toContain("lens");
  expect(LEDGER_EVENTS).toContain("progress");
  expect(LEDGER_EVENTS).toContain("switch");
});

test("status --json carries type, units, wave and progress", () => {
  const example = docExamples.find((entry) => entry.tag === "wish:status-json");
  const value = JSON.parse(example.text);
  expect(validateStatusJson(value).ok).toBe(true);
  for (const key of ["type", "units", "wave", "progress"]) {
    const broken = { ...value };
    delete broken[key];
    expect(validateStatusJson(broken).ok).toBe(false);
  }
  expect(validateStatusJson({ ...value, extra: 1 }).ok).toBe(false);
});

test("plan front matter names the work type and unit", () => {
  const value = JSON.parse(docExamples.find((entry) => entry.tag === "wish:plan-frontmatter").text);
  expect(validatePlanFrontMatter(value).ok).toBe(true);
  const missingType = { wish: { ...value.wish } };
  delete missingType.wish.type;
  expect(validatePlanFrontMatter(missingType).ok).toBe(false);
  expect(validatePlanFrontMatter({ wish: { ...value.wish, type: "mixed", unit: null } }).ok).toBe(false);
  expect(validatePlanFrontMatter({ wish: { ...value.wish, run_id: "w-bad" } }).ok).toBe(false);
});

test("the PROGRESS line parses and formats both the register and n/a forms", () => {
  const lines = docExamples.filter((entry) => entry.tag === "wish:progress").map((entry) => entry.text);
  for (const line of lines) {
    const parsed = parseProgressLine(line);
    expect(parsed.ok).toBe(true);
    expect(formatProgressLine(parsed.value)).toBe(line);
  }
  expect(parseProgressLine(lines[0]).value.gaps_total).toBe(5);
  expect(parseProgressLine(lines[1]).value.gaps_total).toBe(null);
  expect(parseProgressLine("PROGRESS: run w-x · units 1/1").ok).toBe(false);
  expect(PROGRESS_PATTERN_SOURCE.startsWith("^PROGRESS: run ")).toBe(true);
});

test("gates.md uses the poteto block shape and rejects ambiguity", () => {
  const text = docExamples.find((entry) => entry.tag === "wish:gates").text;
  const parsed = parseGatesMarkdown(text);
  expect(parsed.ok).toBe(true);
  expect(parsed.gates.map((gate) => gate.status)).toEqual(["open", "resolved"]);
  expect(parseGatesMarkdown(text.replace("- Default: keep both", "- Default: neither")).ok).toBe(false);
  expect(parseGatesMarkdown(text.replace("- Status: open", "- Status: resolved")).ok).toBe(false);
  expect(parseGatesMarkdown("## G1\n\n- Question: q").ok).toBe(false);
});

test("the VERDICT pattern and parser are identical to PR #44", () => {
  expect(parseVerdict(`notes\r\nVERDICT: REVISE round 1 head ${OTHER}\r\nmore\r\nVERDICT: APPROVED round 2 head ${HEAD}\r\n\r\n`))
    .toMatchObject({ ok: true, verdict: "APPROVED", round: 2, head: HEAD });
  for (const body of [
    "", "   \n\t\n", "no verdict here", `VERDICT: APPROVED round 0 head ${HEAD}`,
    `VERDICT: MAYBE round 1 head ${HEAD}`, `VERDICT: APPROVED round 1 head ${HEAD.slice(0, 7)}`,
    `VERDICT: APPROVED round 1 head ${HEAD} trailing`, `VERDICT: APPROVED round 1 head ${HEAD}\nfooter`,
  ]) {
    expect(parseVerdict(body).ok).toBe(false);
  }
  expect(parseVerdict("").reason).toBe("body is empty");
  expect(parseVerdict("no verdict here").reason).toBe("last non-empty line is not a verdict line: no verdict here");
  expect(parseVerdict(`VERDICT: APPROVED round 1 head ${HEAD}`).head).toBe(HEAD);
});

test("rejects a body whose verdict head does not cover HEAD", () => {
  const body = `VERDICT: APPROVED round 1 head ${HEAD}`;
  expect(checkVerdictCoverage({ body, head: HEAD }).ok).toBe(true);
  expect(checkVerdictCoverage({ body, head: HEAD.toUpperCase() }).ok).toBe(true);
  expect(checkVerdictCoverage({ body, head: OTHER }).reason).toBe(`verdict head ${HEAD} does not cover current head ${OTHER}`);
  expect(checkVerdictCoverage({ body, head: HEAD.slice(0, 7) }).ok).toBe(false);
  expect(checkVerdictCoverage({ body, head: "" }).ok).toBe(false);
  const revise = `VERDICT: REVISE round 1 head ${HEAD}`;
  expect(checkVerdictCoverage({ body: revise, head: HEAD }).ok).toBe(true);
  expect(checkVerdictCoverage({ body: revise, head: HEAD, requireApproved: true }).reason).toBe("verdict is REVISE, not APPROVED");
});

test("required receipts union for mixed and add adversarial only for high risk", () => {
  expect(requiredReceiptsFor("code")).toEqual(["tests", "qa", "sweep", "code-review"]);
  expect(requiredReceiptsFor("code", { highRisk: true })).toContain("adversarial");
  expect(requiredReceiptsFor("mixed", { primary: "design", secondary: "code" }))
    .toEqual(["draft-guard", "capture", "vqa-passA", "vqa-passB", "code-review", "tests", "qa", "sweep"]);
  expect(requiredReceiptsFor("nope")).toEqual([]);
});

test("device rows must match the work type's form", () => {
  expect(validateDeviceRow("code", "DEVICE: guard INV1 -> node-1").ok).toBe(true);
  expect(validateDeviceRow("code", "DEVICE: qa bun test => exit 0").ok).toBe(true);
  expect(validateDeviceRow("design", "DEVICE: vqa B1,B7 @ 390/1440 pair settings-default-390-dark").ok).toBe(true);
  expect(validateDeviceRow("research", "DEVICE: claim C1 gate(primary, domains>=2, counter-search)").ok).toBe(true);
  expect(validateDeviceRow("audit", "DEVICE: lint bun lint exit 0").ok).toBe(true);
  expect(validateDeviceRow("audit", "DEVICE: spot 12 rows reproduce").ok).toBe(true);
  expect(validateDeviceRow("code", "DEVICE: vqa B1 @ 390 pair x").ok).toBe(false);
  expect(validateDeviceRow("mixed", "DEVICE: guard INV1 -> n").ok).toBe(false);
});

test("class sets are per work type and stay identical to the dictionaries", () => {
  expect(findingsClassesFor("code")).toContain("S");
  expect(findingsClassesFor("code")).not.toContain("A1");
  expect(findingsClassesFor("design")).toContain("A1");
  expect(findingsClassesFor("design")).toContain("edge-stripe");
  expect(findingsClassesFor("research")).toContain("untraceable_number");
  expect(findingsClassesFor("mixed", { primary: "code", secondary: "design" })).toContain("A1");
  expect(VQA_ITEM_IDS.length).toBe(69);
});

test("kills the guard when the class set loses PANIC", () => {
  expect(FINDINGS_CLASSES.code).toContain("PANIC");
  const header = FINDINGS_COLUMNS.join("\t");
  const row = `F9\t0\tsweep\tPANIC\tHIGH\tsrc/a.mjs:1\t1\tbun test\t${HEAD}\topen\t-\n`;
  expect(parseFindingsTsv(header + "\n" + row, { type: "code" }).ok).toBe(true);
});

test("CSV headers accept the C43 base and the v2 suffix but never a reorder", () => {
  const suffixes = {
    measurements: "type,unit,program_id,switch_count,rounds_after_switch,lens_rules,gaps_total,gaps_fixed,before_receipts",
    rounds: "type,unit,program_id,switch_count,switch_kinds",
  };
  for (const name of ["measurements", "rounds"]) {
    const base = docExamples.find((entry) => entry.tag === `wish:csv-${name}`).text;
    expect(validateCsvHeader(name, base).ok).toBe(true);
    expect(validateCsvHeader(name, `${base},${suffixes[name]}`).ok).toBe(true);
    const cells = base.split(",");
    expect(validateCsvHeader(name, [cells[1], cells[0], ...cells.slice(2)].join(",")).ok).toBe(false);
  }
});

test("the CLI contract exposes every verb and the four exit codes", () => {
  expect(CLI_VERBS).toEqual(["init", "status", "ledger", "findings", "gaps", "gate", "freeze", "pr-body", "reuse-check", "switch", "metrics", "resume-plan"]);
  expect(EXIT_CODES).toEqual({ OK: 0, CHECK_FAILED: 1, USAGE: 2, STATE_MISMATCH: 3 });
});