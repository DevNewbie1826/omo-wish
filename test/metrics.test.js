import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  FINDING_SCOPES, INT_COLUMNS, MEASUREMENTS_HEADER, ROUNDS_HEADER, ROUND_KINDS,
  deriveRows, formatCsv, main, parseArgs, parseCsv, parseGitLog, postMergeRefixes,
  validateDir, validateFile,
} from "../skills/wish/scripts/metrics.mjs";
import {
  MEASUREMENTS_COLUMNS, ROUNDS_COLUMNS, V2_MEASUREMENTS_SUFFIX, V2_ROUNDS_SUFFIX,
  validateLedgerSequence,
} from "../skills/wish/scripts/lib/schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "../skills/wish/scripts/metrics.mjs");
const repoRoot = resolve(here, "..");
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "1111111111111111111111111111111111111111";
const TREE = "89abcdef0123456789abcdef0123456789abcdef";
const dirs = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "wish-metrics-"));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function run(args, cwd = here) {
  return new Promise((resolvePromise) => {
    const child = spawn("bun", [script, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

const common = {
  type: "code", unit: "u1", program_id: null,
  plan: ".omo/plans/wish-x.md", session_id: "senpi:01a17e58",
};

function event(name, extra = {}) {
  return { event: name, stage: name, ...common, ...extra, stage: name };
}

function ledgerFixture() {
  return [
    event("intake", { tier: "M", facts: ["one fact"], started_at: "2026-10-27T16:00:00Z" }),
    event("lens", { artifact: "/er/lens.md", rules_total: 9, started_at: "2026-10-27T16:01:00Z" }),
    event("plan", { artifact: ".omo/plans/wish-x.md", started_at: "2026-10-27T16:10:00Z" }),
    event("pr_open", { pr: 51, head: HEAD, started_at: "2026-10-27T16:55:00Z" }),
    event("round", {
      round: 1, verdict: "REVISE", head: HEAD, category: "ultrabrain", model_family: "gpt",
      started_at: "2026-10-27T17:00:00Z", ended_at: "2026-10-27T17:25:30Z", duration_s: 1530,
    }),
    event("verdict", { round: 1, verdict: "REVISE", head: HEAD, artifact: "/er/receipts/final-r1.md", started_at: "2026-10-27T17:25:30Z" }),
    event("round", { round: 2, verdict: "REVISE", head: HEAD, category: "ultrabrain", started_at: "2026-10-27T17:30:00Z" }),
    event("verdict", { round: 2, verdict: "REVISE", head: HEAD, artifact: "/er/receipts/final-r2.md", started_at: "2026-10-27T17:50:00Z" }),
    event("round", { round: 3, verdict: "REVISE", head: HEAD, category: "ultrabrain", started_at: "2026-10-27T18:00:00Z" }),
    event("switch", { round: 3, kind: "premise", premise: "one more branch", new_approach: "delete the branch", started_at: "2026-10-27T18:01:00Z" }),
    event("switch", { round: 3, kind: "family", premise: "same family", new_approach: "other family", started_at: "2026-10-27T18:02:00Z" }),
    event("verdict", { round: 3, verdict: "REVISE", head: HEAD, artifact: "/er/receipts/final-r3.md", started_at: "2026-10-27T18:20:00Z" }),
    event("before", { gap_id: "G1", artifact: "/er/receipts/before-G1-1111111.png", started_at: "2026-10-27T16:04:00Z" }),
    event("round", { round: 4, verdict: "APPROVED", head: HEAD, category: "ultrabrain", started_at: "2026-10-27T18:25:00Z" }),
    event("verdict", { round: 4, verdict: "APPROVED", head: HEAD, artifact: "/er/receipts/final-r4.md", started_at: "2026-10-27T18:40:00Z" }),
    event("merge", { pr: 51, sha: OTHER, merged_at: "2026-10-27T18:45:00Z", head: HEAD, started_at: "2026-10-27T18:45:00Z" }),
    event("post_merge", { head: HEAD, tree: TREE, verdict: "PASS", started_at: "2026-10-27T18:50:00Z" }),
  ];
}

const FINDINGS = `id\tround\tsource\tclass\tseverity\tfile_line\tblocking\trepro_cmd\thead_found\tstatus\tfixed_head
F1\t3\tultrabrain\tC\tHIGH\tskills/wish/scripts/metrics.mjs:120\t1\tbun test test/metrics.test.js\t${HEAD}\tfixed\t${OTHER}
F2\t3\tultrabrain\tT\tMEDIUM\ttest/metrics.test.js:88\t1\tno command\t${HEAD}\tno-command\t-
`;
const GAPS = `id\tarea\tsurface\trule\tcurrent\tideal\tbefore_artifact\tseverity\tkind\tclass\ttype\tunit\tstatus\tpr\tfixed_head
G1\tcsv\texport\tskill:visual-qa:B1\tabsent\tpresent\t/er/receipts/before-G1-1111111.png\tHIGH\tdefect\tC\tcode\tu1\tfixed\t51\t${OTHER}
G2\tcsv\texport\tL1\tplain\tpretty\t-\tLOW\ttaste\tC\tcode\tu1\topen\t-\t-
G3\tcsv\tvalidate\tL2\tloose\tstrict\t-\tMEDIUM\tdefect\tC\tcode\tu1\topen\t-\t-
`;

describe("headers and CSV dialect", () => {
  test("the exported headers are M0's base plus the v2 suffix, in order", () => {
    expect([...MEASUREMENTS_HEADER]).toEqual([...MEASUREMENTS_COLUMNS, ...V2_MEASUREMENTS_SUFFIX]);
    expect([...ROUNDS_HEADER]).toEqual([...ROUNDS_COLUMNS, ...V2_ROUNDS_SUFFIX]);
    expect(MEASUREMENTS_HEADER[0]).toBe("pr");
    expect(MEASUREMENTS_HEADER.at(-1)).toBe("before_receipts");
    expect(ROUNDS_HEADER.at(-1)).toBe("switch_kinds");
  });

  test("a cell with a comma, a quote or a newline survives a round trip", () => {
    const header = ["a", "b", "c", "d"];
    const rows = [["1", "x,y", 'he said "no"', "line1\nline2"], ["2", "cr\rhere", "win\r\nline", "tail"]];
    const text = formatCsv(header, rows);
    const parsed = parseCsv(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.header).toEqual(header);
    expect(parsed.rows).toEqual(rows);
    expect(formatCsv(["a", "b"], [["1", ""]])).toBe("a,b\n1,\n");
    expect(parseCsv(formatCsv(["a", "b"], [["1", ""]])).rows).toEqual([["1", ""]]);
  });

  test("an unterminated quote is reported, not silently accepted", () => {
    const parsed = parseCsv('a,b\n"open,1\n');
    expect(parsed.ok).toBe(false);
    expect(parsed.errors[0].message).toContain("unterminated");
  });
});

describe("validateFile", () => {
  function measurements(cells) {
    return [MEASUREMENTS_HEADER.join(","), cells.join(",")].join("\n");
  }

  function measurementsLine(overrides = {}) {
    const cells = Array(MEASUREMENTS_HEADER.length).fill("");
    cells[0] = "51";
    for (const [column, value] of Object.entries(overrides)) cells[MEASUREMENTS_HEADER.indexOf(column)] = value;
    return `${MEASUREMENTS_HEADER.join(",")}\n${cells.join(",")}\n`;
  }

  function roundsLine(overrides = {}) {
    const cells = Array(ROUNDS_HEADER.length).fill("");
    cells[0] = "51";
    cells[1] = "1";
    cells[2] = "first";
    cells[ROUNDS_HEADER.indexOf("type")] = "code";
    cells[ROUNDS_HEADER.indexOf("unit")] = "u1";
    for (const [column, value] of Object.entries(overrides)) cells[ROUNDS_HEADER.indexOf(column)] = value;
    return `${ROUNDS_HEADER.join(",")}\n${cells.join(",")}\n`;
  }

  test("the base header (without the v2 suffix) is accepted", () => {
    const text = `${MEASUREMENTS_COLUMNS.join(",")}\n51,owner/name,arm,,route,size,,"2026-10-27T16:55:00Z","2026-10-27T18:45:00Z",110.0,4,4,0,1,0,PASS,0,,0,note\n`;
    expect(validateFile("measurements", text).ok).toBe(true);
  });

  test("a wrong header, a short row and a bad enum are rejected with a row path", () => {
    const wrongHeader = validateFile("measurements", "a,b\n1,2\n");
    expect(wrongHeader.ok).toBe(false);
    expect(wrongHeader.errors[0].path).toBe("csv.header");
    const short = validateFile("measurements", measurements(Array(MEASUREMENTS_HEADER.length - 1).fill("")));
    expect(short.ok).toBe(false);
    expect(short.errors[0].path).toBe("row[1]");
    const bad = validateFile("rounds", roundsLine({ round_kind: "whenever" }));
    expect(bad.ok).toBe(false);
    expect(bad.errors.some((entry) => entry.path === "row[1].round_kind")).toBe(true);
  });

  test("verdict_head follows the row type: 40 hex for code, 64 hex for research", () => {
    expect(validateFile("rounds", roundsLine({ verdict_head: HEAD })).ok).toBe(true);
    expect(validateFile("rounds", roundsLine({ verdict_head: HEAD.slice(0, 39) })).ok).toBe(false);
    expect(validateFile("rounds", roundsLine({ verdict_head: `${HEAD}${OTHER.slice(0, 24)}`, type: "research" })).ok).toBe(true);
    expect(validateFile("rounds", roundsLine({ verdict_head: HEAD, type: "research" })).ok).toBe(false);
    // a mixed run takes its primary type's identity form (§2); the CSV has no primary column, so either length validates
    expect(validateFile("rounds", roundsLine({ verdict_head: `${HEAD}${OTHER.slice(0, 24)}`, type: "mixed" })).ok).toBe(true);
    expect(validateFile("rounds", roundsLine({ verdict_head: HEAD, type: "mixed" })).ok).toBe(true);
    expect(validateFile("rounds", roundsLine({ verdict_head: HEAD.slice(0, 39), type: "mixed" })).ok).toBe(false);
  });

  test("switch kinds must be known and unique, and gaps_fixed cannot exceed gaps_total", () => {
    expect(validateFile("rounds", roundsLine({ switch_kinds: "premise;family" })).ok).toBe(true);
    expect(validateFile("rounds", roundsLine({ switch_kinds: "premise;premise" })).ok).toBe(false);
    expect(validateFile("rounds", roundsLine({ switch_kinds: "invented" })).ok).toBe(false);
    expect(validateFile("measurements", measurementsLine({ gaps_total: "1", gaps_fixed: "2" })).ok).toBe(false);
    expect(validateFile("measurements", measurementsLine({ gaps_total: "2", gaps_fixed: "2" })).ok).toBe(true);
  });
});

describe("deriveRows", () => {
  test("the fixture ledger is sequence-valid", () => {
    const result = validateLedgerSequence(ledgerFixture());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("measures rounds, switches, gaps and before receipts from the ledger", () => {
    const derived = deriveRows({
      events: ledgerFixture(),
      findings: [
        { round: "3", class: "C", file_line: "skills/wish/scripts/metrics.mjs:120", repro_cmd: "bun test", status: "fixed" },
        { round: "3", class: "T", file_line: "test/metrics.test.js:88", repro_cmd: "no command", status: "no-command" },
      ],
      gaps: [
        { id: "G1", kind: "defect", status: "fixed", before_artifact: "/er/before.png" },
        { id: "G2", kind: "taste", status: "open", before_artifact: "-" },
        { id: "G3", kind: "defect", status: "open", before_artifact: "-" },
      ],
      options: { repo: "owner/name" },
    });
    expect(derived.errors).toEqual([]);
    const row = Object.fromEntries(MEASUREMENTS_HEADER.map((column, index) => [column, derived.measurements[index]]));
    expect(row).toMatchObject({
      pr: "51", repo: "owner/name", arm: "v2", rounds_total: "4", ultrabrain_calls: "4",
      switch_count: "2", rounds_after_switch: "1", lens_rules: "9",
      gaps_total: "2", gaps_fixed: "1", before_receipts: "1", step12_result: "PASS",
      type: "code", unit: "u1", program_id: "",
    });
    expect(row.open_to_merge_min).toBe("110.0");
    expect(derived.rounds.length).toBe(4);
    const rounds = derived.rounds.map((cells) => Object.fromEntries(ROUNDS_HEADER.map((column, index) => [column, cells[index]])));
    expect(rounds[0]).toMatchObject({ round_index: "1", round_kind: "first", minutes: "25.5", reviewer: "ultrabrain", reviewer_family: "gpt", defect_count: "0", finding_scope: "none" });
    expect(rounds[2]).toMatchObject({
      round_index: "3", round_kind: "revise", defect_count: "2", defect_axes: "C;T",
      finding_scope: "mixed", counterexample_present: "1", switch_count: "2", switch_kinds: "premise;family",
      gate_rows_fixed: "", gate_rows_not_fixed: "", gate_rows_no_command: "",
    });
    expect(rounds[3]).toMatchObject({
      round_index: "4", gate_rows_fixed: "1", gate_rows_not_fixed: "0", gate_rows_no_command: "1",
    });
  });

  test("rounds stay ordered even when the ledger lines are not", () => {
    const derived = deriveRows({ events: [...ledgerFixture()].reverse(), options: {} });
    expect(derived.ok).toBe(true);
    const index = ROUNDS_HEADER.indexOf("round_index");
    expect(derived.rounds.map((cells) => cells[index])).toEqual(["1", "2", "3", "4"]);
  });

  test("a before event is counted even when no register is supplied", () => {
    const derived = deriveRows({ events: ledgerFixture(), options: {} });
    expect(derived.ok).toBe(true);
    const row = Object.fromEntries(MEASUREMENTS_HEADER.map((column, index) => [column, derived.measurements[index]]));
    expect(row.before_receipts).toBe("1");
    expect(row.gaps_total).toBe("");
    expect(row.gaps_fixed).toBe("");
  });

  test("findings of a mixed unit accept both class sets", () => {
    const events = ledgerFixture().map((entry) => ({ ...entry, type: "mixed", primary: "code", secondary: "design" }));
    const findings = [
      { round: "1", class: "S", file_line: "src/a.mjs:1", repro_cmd: "bun test", status: "open" },
      { round: "1", class: "A1", file_line: "ui/page.tsx:2", repro_cmd: "no command", status: "open" },
    ];
    const derived = deriveRows({ events, findings, options: {} });
    expect(derived.errors).toEqual([]);
    const index = ROUNDS_HEADER.indexOf("defect_axes");
    expect(derived.rounds[0][index]).toBe("A1;S");
  });

  test("findings use the selected unit's type, not the first event's", async () => {
    const dir = tempDir();
    const codeUnit = ledgerFixture().map((entry) => ({ ...entry, unit: "u1", type: "code" }));
    const designUnit = ledgerFixture().map((entry) => ({ ...entry, unit: "u2", type: "design" }));
    const ledger = join(dir, "ledger.jsonl");
    writeFileSync(ledger, `${[...codeUnit, ...designUnit].map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    const findings = join(dir, "findings.tsv");
    writeFileSync(findings, `id\tround\tsource\tclass\tseverity\tfile_line\tblocking\trepro_cmd\thead_found\tstatus\tfixed_head\nF1\t1\tqa\tA1\tHIGH\tui/page.tsx:3\t1\tbun test\t${HEAD}\topen\t-\n`);
    const out = join(dir, "metrics");
    const result = await run(["export", "--ledger", ledger, "--findings", findings, "--unit", "u2", "--out", out, "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).type).toBe("design");
  });

  test("an extra override outside its column's domain is refused at export", async () => {
    const dir = tempDir();
    const ledger = join(dir, "ledger.jsonl");
    writeFileSync(ledger, `${ledgerFixture().map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    const extra = join(dir, "extra.json");
    writeFileSync(extra, JSON.stringify({ measurements: { invalid_flag: "bad" } }));
    const result = await run(["export", "--ledger", ledger, "--extra", extra, "--out", join(dir, "metrics"), "--json"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).errors.some((entry) => entry.path.includes("invalid_flag"))).toBe(true);
  });

  test("a metric the input does not contain is empty, never 0", () => {
    const minimal = [
      event("intake", { tier: "S", facts: ["one fact"], started_at: "2026-10-27T16:00:00Z" }),
      event("pr_open", { pr: 7, head: HEAD, started_at: "2026-10-27T16:10:00Z" }),
      event("merge", { pr: 7, sha: OTHER, merged_at: "2026-10-27T16:20:00Z", head: HEAD, started_at: "2026-10-27T16:20:00Z" }),
    ];
    const derived = deriveRows({ events: minimal, options: {} });
    expect(derived.ok).toBe(true);
    const row = Object.fromEntries(MEASUREMENTS_HEADER.map((column, index) => [column, derived.measurements[index]]));
    for (const column of ["lens_rules", "gaps_total", "gaps_fixed", "content_commits_after_approval", "blind_rereview", "invalid_flag", "notes"]) {
      expect(row[column]).toBe("");
    }
    expect(row.before_receipts).toBe("0");
    expect(row.rounds_total).toBe("0");
    expect(row.switch_count).toBe("0");
    expect(row.rounds_after_switch).toBe("");
    expect(row.post_merge_refix).toBe("");
  });

  test("an invalid ledger event, a negative window and an ambiguous unit are rejected", () => {
    const broken = ledgerFixture();
    delete broken[0].facts;
    expect(deriveRows({ events: broken, options: {} }).ok).toBe(false);
    const reversed = ledgerFixture();
    const merge = reversed.find((entry) => entry.event === "merge");
    merge.merged_at = "2026-10-27T16:00:00Z";
    const result = deriveRows({ events: reversed, options: {} });
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toContain("precedes");
    const other = ledgerFixture().filter((entry) => entry.event === "intake" || entry.event === "pr_open" || entry.event === "merge");
    const ambiguous = deriveRows({ events: [...other, { ...other[0], unit: "u2" }], options: {} });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.errors[0].message).toContain("--unit");
  });

  test("extra overrides are limited to real columns and reach their round", () => {
    const derived = deriveRows({
      events: ledgerFixture(),
      extra: { measurements: { notes: "note, with a comma", invented: "x" }, rounds: [{ round_index: 1, axis_lines_present: "1" }] },
      options: {},
    });
    expect(derived.ok).toBe(false);
    expect(derived.errors[0].path).toBe("extra.measurements.invented");
    const ok = deriveRows({
      events: ledgerFixture(),
      extra: { measurements: { notes: "note, with a comma" }, rounds: [{ round_index: 1, axis_lines_present: "1" }] },
      options: {},
    });
    expect(ok.ok).toBe(true);
    const row = Object.fromEntries(MEASUREMENTS_HEADER.map((column, index) => [column, ok.measurements[index]]));
    expect(row.notes).toBe("note, with a comma");
    const first = Object.fromEntries(ROUNDS_HEADER.map((column, index) => [column, ok.rounds[0][index]]));
    expect(first.axis_lines_present).toBe("1");
  });
});

describe("validateDir", () => {
  test("cross-file checks catch a dangling PR, a duplicate round and a wrong total", () => {
    const measurements = `${MEASUREMENTS_HEADER.join(",")}\n51,o/r,v2,,,,,,,,2,0,0,0,0,,0,0,0,0,code,u1,,0,,,0,0,0,0\n`;
    const rounds = `${ROUNDS_HEADER.join(",")}\n51,1,first,${HEAD},,,,,,,,,,,,,,,,,,,,,,code,u1,,0,\n51,1,revise,${HEAD},,,,,,,,,,,,,,,,,,,,,,code,u1,,0,\n52,2,revise,${HEAD},,,,,,,,,,,,,,,,,,,,,,code,u1,,0,\n`;
    const result = validateDir({ measurements, rounds });
    expect(result.ok).toBe(false);
    const paths = result.errors.map((entry) => entry.path);
    expect(paths.some((path) => path.includes("duplicate"))).toBe(false);
    expect(paths).toContain("rounds.row[2].round_index");
    expect(paths).toContain("rounds.row[3].pr");
  });
});

describe("postMergeRefixes", () => {
  const mergedAt = "2026-10-01T00:00:00Z";
  const commits = [
    { sha: OTHER, committed_at: "2026-10-01T00:00:00Z", subject: "merge", files: ["a.txt", "b.txt"] },
    { sha: "2222222222222222222222222222222222222222", committed_at: "2026-10-01T00:00:00Z", subject: "at the boundary", files: ["a.txt"] },
    { sha: "3333333333333333333333333333333333333333", committed_at: "2026-10-02T00:00:00Z", subject: "fix(a)", files: ["a.txt"] },
    { sha: "4444444444444444444444444444444444444444", committed_at: "2026-10-03T00:00:00Z", subject: "docs", files: ["README.md"] },
    { sha: "5555555555555555555555555555555555555555", committed_at: "2026-10-20T00:00:00Z", subject: "late", files: ["a.txt"] },
  ];

  test("counts only commits inside the window that touch a merged file", () => {
    const result = postMergeRefixes({ mergedAt, files: ["a.txt", "b.txt"], commits, days: 7 });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.refixes[0]).toMatchObject({ sha: "3333333333333333333333333333333333333333", files: ["a.txt"] });
    expect(result.window).toEqual({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z", days: 7 });
  });

  test("excludes the merge commit and reports no refix for an untouched file", () => {
    const withMerge = postMergeRefixes({ mergedAt, files: ["a.txt"], commits, days: 7, mergeSha: OTHER });
    expect(withMerge.count).toBe(1);
    expect(withMerge.refixes.some((entry) => entry.sha === OTHER)).toBe(false);
    expect(postMergeRefixes({ mergedAt, files: ["b.txt"], commits, days: 7 }).count).toBe(0);
  });

  test("unusable inputs are reported, not counted as zero", () => {
    expect(postMergeRefixes({ mergedAt: "not a date", files: ["a"], commits }).ok).toBe(false);
    expect(postMergeRefixes({ mergedAt, files: [], commits }).ok).toBe(false);
    expect(postMergeRefixes({ mergedAt, files: ["a"], commits, days: 0 }).ok).toBe(false);
  });

  test("parseGitLog reads sha, committer date, subject and files", () => {
    const text = `\x1e${OTHER}\x1f2026-10-01T00:00:00+00:00\x1fmerge a\na.txt\nb.txt\n\n\x1e2222222222222222222222222222222222222222\x1f2026-10-02T00:00:00+00:00\x1ffix(a)\na.txt\n`;
    const commitsRead = parseGitLog(text);
    expect(commitsRead).toEqual([
      { sha: OTHER, committed_at: "2026-10-01T00:00:00+00:00", subject: "merge a", files: ["a.txt", "b.txt"] },
      { sha: "2222222222222222222222222222222222222222", committed_at: "2026-10-02T00:00:00+00:00", subject: "fix(a)", files: ["a.txt"] },
    ]);
    expect(parseGitLog("")).toEqual([]);
    expect(parseGitLog("not a log")).toEqual([]);
  });
});

describe("CLI", () => {
  test("--help exits 0 and names every verb", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(0);
    for (const verb of ["export", "validate", "post-merge"]) expect(result.stdout).toContain(verb);
  });

  test("export writes both files, validates them and round-trips a comma-bearing note", async () => {
    const dir = tempDir();
    const ledger = join(dir, "ledger.jsonl");
    writeFileSync(ledger, `${ledgerFixture().map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    const findings = join(dir, "findings.tsv");
    writeFileSync(findings, FINDINGS);
    const gaps = join(dir, "gaps.tsv");
    writeFileSync(gaps, GAPS);
    const extra = join(dir, "extra.json");
    writeFileSync(extra, JSON.stringify({ measurements: { notes: "note, with a comma" } }));
    const out = join(dir, "metrics");
    const result = await run(["export", "--ledger", ledger, "--findings", findings, "--gaps", gaps, "--extra", extra, "--repo", "owner/name", "--out", out, "--json"]);
    expect(result.code).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary.ok).toBe(true);
    expect(summary.rows).toEqual({ measurements: 1, rounds: 4 });
    const measurements = parseCsv(readFileSync(join(out, "measurements.csv"), "utf8"));
    const rounds = parseCsv(readFileSync(join(out, "rounds.csv"), "utf8"));
    expect(measurements.header).toEqual([...MEASUREMENTS_HEADER]);
    expect(rounds.header).toEqual([...ROUNDS_HEADER]);
    const row = Object.fromEntries(measurements.header.map((column, index) => [column, measurements.rows[0][index]]));
    expect(row).toMatchObject({ pr: "51", rounds_total: "4", switch_count: "2", rounds_after_switch: "1", gaps_total: "2", gaps_fixed: "1", notes: "note, with a comma" });
    const checked = await run(["validate", "--dir", out, "--json"]);
    expect(checked.code).toBe(0);
    expect(JSON.parse(checked.stdout).ok).toBe(true);
  });

  test("export works without a findings or gaps file and leaves those cells empty", async () => {
    const dir = tempDir();
    const ledger = join(dir, "ledger.jsonl");
    writeFileSync(ledger, `${ledgerFixture().map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    const out = join(dir, "metrics");
    const result = await run(["export", "--ledger", ledger, "--out", out, "--json"]);
    expect(result.code).toBe(0);
    const measurements = parseCsv(readFileSync(join(out, "measurements.csv"), "utf8"));
    const row = Object.fromEntries(measurements.header.map((column, index) => [column, measurements.rows[0][index]]));
    expect(row).toMatchObject({ pr: "51", gaps_total: "", gaps_fixed: "", before_receipts: "1", notes: "" });
    const rounds = parseCsv(readFileSync(join(out, "rounds.csv"), "utf8"));
    const first = Object.fromEntries(rounds.header.map((column, index) => [column, rounds.rows[0][index]]));
    expect(first).toMatchObject({ round_index: "1", defect_count: "", finding_scope: "" });
    expect((await run(["validate", "--dir", out, "--json"])).code).toBe(0);
  });

  test("validate exits 1 on a bad file with a row path and 2 without a name it cannot infer", async () => {
    const dir = tempDir();
    const bad = join(dir, "rounds.csv");
    writeFileSync(bad, `${ROUNDS_HEADER.join(",")}\n51,1,whenever,${HEAD},,,,,,,,,,,,,,,,,,,,,,code,u1,,0,\n`);
    const result = await run(["validate", "--file", bad]);
    expect(result.code).toBe(1);
    const body = JSON.parse(result.stdout);
    expect(body.errors.some((entry) => entry.path.startsWith("row[1]"))).toBe(true);
    const unnamed = join(dir, "data.csv");
    writeFileSync(unnamed, "a\n");
    expect((await run(["validate", "--file", unnamed])).code).toBe(2);
    expect((await run(["validate"])).code).toBe(2);
  });

  test("the shipped experiment CSVs validate against the contract", () => {
    for (const name of ["measurements", "rounds"]) {
      const text = readFileSync(join(repoRoot, "docs/experiments", `${name}.csv`), "utf8");
      const result = validateFile(name, text);
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  test("metrics.md names every v2 column and the switch rules", () => {
    const doc = readFileSync(join(repoRoot, "skills/wish/references/metrics.md"), "utf8");
    for (const column of [...V2_MEASUREMENTS_SUFFIX, ...V2_ROUNDS_SUFFIX]) expect(doc).toContain(column);
    for (const term of ["rounds_after_switch", "diff-tree", "RFC 4180", "diagnostic"]) expect(doc).toContain(term);
    expect(doc.includes("[~]")).toBe(false);
  });

  test("a malformed CSV cell is rejected: junk after a closing quote", () => {
    const line = `${ROUNDS_HEADER.join(",")}\n51,1,first,${HEAD},,,,,,,,,,,,,,,,,,,,,,code,u1,,0,"note"junk\n`;
    const parsed = validateFile("rounds", line);
    expect(parsed.ok).toBe(false);
    expect(parsed.errors.some((entry) => entry.message.includes("closing quote"))).toBe(true);
  });

  test("validate --name only accepts the two file names", async () => {
    const dir = tempDir();
    const file = join(dir, "rounds.csv");
    writeFileSync(file, `${ROUNDS_HEADER.join(",")}\n51,1,first,${HEAD},,,,,,,,,,,,,,,,,,,,,,code,u1,,0,\n`);
    expect((await run(["validate", "--file", file, "--name", "bogus"])).code).toBe(2);
  });

  test("unusable merge fixtures exit 3, never a clean 0", async () => {
    const dir = tempDir();
    const nullFile = join(dir, "null.json");
    writeFileSync(nullFile, "null");
    const nullResult = await run(["post-merge", "--merged-at", "2026-10-01T00:00:00Z", "--from-json", nullFile]);
    expect(nullResult.code).toBe(3);
    expect(JSON.parse(nullResult.stdout).ok).toBe(false);
    const badFile = join(dir, "bad.json");
    writeFileSync(badFile, "{not json");
    const badResult = await run(["post-merge", "--merged-at", "2026-10-01T00:00:00Z", "--from-json", badFile]);
    expect(badResult.code).toBe(3);
    expect(badResult.stdout.trim().startsWith("{")).toBe(true);
  });

  test("post-merge reads a real git history, excludes the merge commit and exits 1 on a refix", async () => {
    const dir = tempDir();
    const git = (args, env) => new Promise((resolvePromise) => {
      const child = spawn("git", args, { cwd: dir, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
    });
    expect((await git(["init", "-q"])).code).toBe(0);
    await git(["config", "user.email", "test@example.invalid"]);
    await git(["config", "user.name", "test"]);
    writeFileSync(join(dir, "a.txt"), "a\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    await git(["add", "."]);
    expect((await git(["commit", "-qm", "base"], { GIT_AUTHOR_DATE: "2026-09-30T00:00:00Z", GIT_COMMITTER_DATE: "2026-09-30T00:00:00Z" })).code).toBe(0);
    writeFileSync(join(dir, "a.txt"), "a2\n");
    writeFileSync(join(dir, "b.txt"), "b2\n");
    await git(["add", "."]);
    expect((await git(["commit", "-qm", "merge"], { GIT_AUTHOR_DATE: "2026-10-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-10-01T00:00:00Z" })).code).toBe(0);
    const mergeSha = (await git(["rev-parse", "HEAD"])).stdout.trim();
    writeFileSync(join(dir, "a.txt"), "a3\n");
    await git(["add", "."]);
    expect((await git(["commit", "-qm", "fix(a)"], { GIT_AUTHOR_DATE: "2026-10-02T00:00:00Z", GIT_COMMITTER_DATE: "2026-10-02T00:00:00Z" })).code).toBe(0);
    const fixSha = (await git(["rev-parse", "HEAD"])).stdout.trim();
    const result = await run(["post-merge", "--merged-at", "2026-10-01T00:00:00Z", "--merge-sha", mergeSha, "--repo-dir", dir, "--days", "7", "--json"]);
    expect(result.code).toBe(1);
    const body = JSON.parse(result.stdout);
    expect(body.files.sort()).toEqual(["a.txt", "b.txt"]);
    expect(body.refixes.map((entry) => entry.sha)).toEqual([fixSha]);
    const clean = await run(["post-merge", "--merged-at", "2026-10-01T00:00:00Z", "--files", "b.txt", "--repo-dir", dir, "--days", "7", "--json"]);
    expect(clean.code).toBe(0);
    expect(JSON.parse(clean.stdout).count).toBe(0);
    const usable = await run(["post-merge", "--merged-at", "2026-10-01T00:00:00Z", "--merge-sha", "not-a-sha", "--repo-dir", dir, "--json"]);
    expect(usable.code).toBe(2);
  });
});
describe("git history edges", () => {
  async function gitFixture() {
    const dir = tempDir();
    const git = (args, env = {}) => new Promise((resolvePromise) => {
      const child = spawn("git", args, { cwd: dir, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
    });
    expect((await git(["init", "-q"])).code).toBe(0);
    await git(["config", "user.email", "test@example.invalid"]);
    await git(["config", "user.name", "test"]);
    const write = (name, text) => Bun.write(join(dir, name), text);
    const commit = async (message, date, files) => {
      for (const [name, text] of Object.entries(files)) await write(name, text);
      await git(["add", "-A"]);
      const done = await git(["commit", "-qm", message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
      expect(done.code).toBe(0);
      return (await git(["rev-parse", "HEAD"])).stdout.trim();
    };
    return { dir, git, write, commit };
  }

  test("a cap that stops the scan is reported, never a silent clean result", async () => {
    const repo = await gitFixture();
    await repo.commit("base", "2026-09-30T00:00:00Z", { "a.txt": "a\n" });
    await repo.commit("fix(a)", "2026-10-02T00:00:00Z", { "a.txt": "a2\n" });
    await repo.commit("unrelated", "2026-10-03T00:00:00Z", { "b.txt": "b\n" });
    const capped = await run(["post-merge", "--merged-at", "2026-10-01T00:00:00Z", "--files", "a.txt", "--repo-dir", repo.dir, "--max-commits", "1"]);
    expect(capped.code).toBe(3);
    expect(JSON.parse(capped.stdout)).toMatchObject({ ok: false, truncated: true });
    const full = await run(["post-merge", "--merged-at", "2026-10-01T00:00:00Z", "--files", "a.txt", "--repo-dir", repo.dir]);
    expect(full.code).toBe(1);
    expect(JSON.parse(full.stdout).count).toBe(1);
  });

  test("a backdated descendant does not hide an eligible commit", async () => {
    const repo = await gitFixture();
    await repo.commit("base", "2026-09-01T00:00:00Z", { "a.txt": "a\n" });
    await repo.commit("fix(a)", "2026-10-05T00:00:00Z", { "a.txt": "a2\n" });
    await repo.commit("backdated", "2026-08-01T00:00:00Z", { "z.txt": "z\n" });
    const result = await run(["post-merge", "--merged-at", "2026-10-01T00:00:00Z", "--files", "a.txt", "--repo-dir", repo.dir, "--days", "7"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).count).toBe(1);
  });

  test("a merge shows what it introduced against its first parent", async () => {
    const repo = await gitFixture();
    await repo.commit("base", "2026-09-30T00:00:00Z", { "a.txt": "a\n" });
    await repo.git(["checkout", "-q", "-b", "side"]);
    await repo.commit("side work", "2026-09-20T00:00:00Z", { "b.txt": "b\n" });
    await repo.git(["checkout", "-q", "master"]).then(async (done) => {
      if (done.code !== 0) await repo.git(["checkout", "-q", "main"]);
    });
    await repo.git(["merge", "--no-ff", "-q", "-m", "merge side", "side"], {
      GIT_AUTHOR_DATE: "2026-10-02T00:00:00Z", GIT_COMMITTER_DATE: "2026-10-02T00:00:00Z",
    });
    const result = await run(["post-merge", "--merged-at", "2026-10-01T00:00:00Z", "--files", "b.txt", "--repo-dir", repo.dir, "--days", "7"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).refixes[0].subject).toBe("merge side");
  });

  test("git paths keep their exact names: Unicode is not quoted and a leading space is preserved", async () => {
    const repo = await gitFixture();
    await repo.commit("root", "2026-09-20T00:00:00Z", { "root.txt": "r\n" });
    const base = await repo.commit("base", "2026-09-30T00:00:00Z", { "café.txt": "c\n", " a.txt": "s\n" });
    await repo.commit("touch both", "2026-10-03T00:00:00Z", { "café.txt": "c2\n", " a.txt": "s2\n" });
    const viaSha = await run(["post-merge", "--merged-at", "2026-10-01T00:00:00Z", "--merge-sha", base, "--repo-dir", repo.dir]);
    expect(viaSha.code).toBe(1);
    const body = JSON.parse(viaSha.stdout);
    expect(body.files.sort()).toEqual([" a.txt", "café.txt"]);
    expect(body.refixes.length).toBe(1);
    // The refix matched both names, so the commit scan kept the Unicode name raw too.
    expect([...body.refixes[0].files].sort()).toEqual([" a.txt", "café.txt"]);
  });

  test("a real ref such as release+qa is accepted", async () => {
    const repo = await gitFixture();
    await repo.commit("base", "2026-09-30T00:00:00Z", { "a.txt": "a\n" });
    await repo.git(["branch", "release+qa"]);
    const result = await run(["post-merge", "--merged-at", "2026-10-01T00:00:00Z", "--files", "a.txt", "--repo-dir", repo.dir, "--ref", "release+qa"]);
    expect(result.code).not.toBe(2);
  });
});
