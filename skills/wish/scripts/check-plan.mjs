#!/usr/bin/env node
// Mechanical checks for a wish v2 plan. Grammar and the rule list: references/plan-format.md §6.
// Usage: check-plan.mjs <plan.md> [--register <gaps.tsv>] [--json] [--help]
// Exit: 0 clean, 1 a rule failed, 2 usage or read error (references/ledger.md §14).
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRIMARY_TYPES, classValid, parseGapsTsv, validateDeviceRow, validatePlanFrontMatter,
} from "./lib/schema.mjs";

const USAGE = [
  "Usage: check-plan.mjs <plan.md> [--register <gaps.tsv>] [--json] [--help]",
  "",
  "Lints one wish v2 plan file (references/plan-format.md).",
  "",
  "  <plan.md>            the plan to check",
  "  --register <path>    gaps.tsv; makes every IS row's gap: id required and checked",
  "  --json               print one JSON object instead of the summary",
  "  --help               print this text",
  "",
  "Exit: 0 clean, 1 a rule failed, 2 usage or read error.",
].join("\n");

export function parseArgs(argv) {
  const options = { help: false, json: false, plan: null, register: null };
  let literal = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!literal && arg === "--") { literal = true; continue; }
    if (literal) {
      if (options.plan) throw new Error(`unexpected argument: ${arg}`);
      options.plan = arg;
      continue;
    }
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--register") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error("--register needs a gaps.tsv path");
      options.register = value;
      i += 1;
    } else if (arg.startsWith("-") && arg !== "-") throw new Error(`unknown flag: ${arg}`);
    else if (options.plan) throw new Error(`unexpected argument: ${arg}`);
    else options.plan = arg;
  }
  if (!options.help && !options.plan) throw new Error("no plan file given");
  return options;
}

const scalar = (raw) => {
  const text = raw.trim();
  if (text === "null" || text === "~") return null;
  if (/^"[^"]*"$/.test(text) || /^'[^']*'$/.test(text)) return text.slice(1, -1);
  if (/^-?[0-9]+$/.test(text)) return Number(text);
  return text;
};

export function parseFrontMatter(lines) {
  const errors = [];
  const keyLines = new Map();
  if (lines[0]?.trim() !== "---") {
    return { wish: null, keys: keyLines, errors: [{ line: 1, message: "no front matter: the file opens with --- and a wish: block" }] };
  }
  const close = lines.findIndex((text, index) => index > 0 && text.trim() === "---");
  if (close === -1) return { wish: null, keys: keyLines, errors: [{ line: 1, message: "front matter never closes with ---" }] };
  const wish = {};
  let wishLine = null;
  for (let i = 1; i < close; i += 1) {
    const text = lines[i];
    if (text.trim() === "" || text.trimStart().startsWith("#")) continue;
    if (/^wish:\s*$/.test(text)) {
      if (wishLine !== null) errors.push({ line: i + 1, message: "a second wish: block" });
      wishLine = i + 1;
      continue;
    }
    const match = /^ {2}([a-z_]+):[ \t]?(.*)$/.exec(text);
    if (!match) {
      errors.push({ line: i + 1, message: "front matter accepts one two-space `<key>: <value>` per line under wish:" });
      continue;
    }
    if (wishLine === null) {
      errors.push({ line: i + 1, message: "a key appears before the wish: block" });
      continue;
    }
    if (keyLines.has(match[1])) errors.push({ line: i + 1, message: `duplicate front matter key ${match[1]}` });
    keyLines.set(match[1], i + 1);
    wish[match[1]] = scalar(match[2]);
  }
  if (wishLine === null) errors.push({ line: 1, message: "no wish: block in the front matter" });
  keyLines.set("wish", wishLine ?? 1);
  return { wish, keys: keyLines, errors };
}

const MARKERS = [
  ["task", /^- \[(?: |x|X)\] (\d+)\. (\S.*)$/],
  ["final", /^- \[(?: |x|X)\] F(\d+)\. (\S.*)$/],
  ["device", /^- ((?:IS-|G)\d+) DEVICE: (.*)$/],
  ["is", /^- (IS-\d+): (.*)$/],
  ["qa", /^- (QA-\d+): (.*)$/],
  ["companion", /^- COMPANION: (.*)$/],
  ["invariant", /^- INVARIANT (INV\d+): (.*)$/],
  ["limit", /^- LIMIT: (.*)$/],
  ["switch", /^- SWITCH: (.*)$/],
  ["guard", /^- guard: (.*)$/],
  ["notest", /^- no-test: (.*)$/],
  ["highrisk", /^- HIGH-RISK: (.*)$/],
  ["typed", /^- (SCREEN|AXIS|CLAIM|RULE): (.*)$/],
];
// Case-insensitive on purpose: a near-miss marker (`- Device: ...`) must be loud, never prose.
const DECLARED = /^- (?:IS-?\d|QA-?\d|INV\d|G\d+\s+DEVICE|DEVICE|COMPANION|INVARIANT|LIMIT|SWITCH|guard|no-test|HIGH-RISK|SCREEN|AXIS|CLAIM|RULE)\b/i;
const KEEP_SECTIONS = ["Todos", "Final verification wave"];
const TYPE_OF_KIND = { SCREEN: "design", AXIS: "research", CLAIM: "research", RULE: "audit" };
const REQUIRED_KINDS = { code: [], design: ["SCREEN"], research: ["AXIS", "CLAIM"], audit: ["RULE"], mixed: [] };
const HIGH_RISK_KINDS = ["concurrency", "persistence", "state", "lifetime"];

// Every complaint carries the id of the rule it answers (plan-format.md §6); PL18 is a reading rule
// with no message. The table is the code half of the doc table, and a test holds the two equal.
const RULES = [
  ["PL1", /^(no front matter|front matter never closes|a second wish: block|front matter accepts|a key appears before|duplicate front matter key|no wish: block|frontmatter\.)/],
  ["PL2", /^(a task row outside|a (task|final) row belongs|no "## Todos"|"## Todos" holds|no "## Final verification wave"|"## Final verification wave" holds|duplicate (task|final) row number)/],
  ["PL3", /^(no IS rows|duplicate IS row |IS-\d+ must read|IS-\d+ states no property)/],
  ["PL4", /^(IS-\d+ criterion "|IS-\d+ names no QA|IS-\d+ names QA-|IS-\d+ gap "|duplicate QA scenario |QA-\d+ is owned by no IS row)/],
  ["PL5", /^QA-\d+ (must read|has an empty)/],
  ["PL6", /^(DEVICE row names |IS-\d+ has no DEVICE row)/],
  ["PL7", /^(DEVICE body does not match|DEVICE cites claim )/],
  ["PL8", /^(a [A-Z]+: row belongs|SCREEN |CLAIM |AXIS |RULE |duplicate claim |duplicate rule |a (code|design|research|audit|mixed) plan needs|[A-Za-z0-9._-]+ is not an audit rule id|[A-Z][A-Z]+ [^ ]+ states nothing)/],
  ["PL9", /^guard /],
  ["PL10", /^no-test /],
  ["PL11", /^(HIGH-RISK |a [a-z]+ plan runs no adversarial lane)/],
  ["PL12", /^(COMPANION |`COMPANION: none.` excludes)/],
  ["PL13", /^(duplicate invariant |INV\d+ must read)/],
  ["PL14", /^LIMIT /],
  ["PL15", /^SWITCH /],
  ["PL16", /^malformed row/],
  ["PL17", /^(IS-\d+ must cite|IS-\d+ cites |DEVICE targets G|[^ ]*\.tsv: )/],
];
export const RULE_IDS = Object.freeze(["PL1", "PL2", "PL3", "PL4", "PL5", "PL6", "PL7", "PL8", "PL9",
  "PL10", "PL11", "PL12", "PL13", "PL14", "PL15", "PL16", "PL17", "PL18"]);

// Fixed field order: the last marker owns the rest of the row, so a command may hold `;`, `|` or `->`.
function fieldsOf(body, markers) {
  const marks = markers.map((marker) => ({ marker, at: body.indexOf(marker) }));
  for (let i = 0; i < marks.length; i += 1) {
    if (marks[i].at === -1) return null;
    if (i > 0 && marks[i].at < marks[i - 1].at + marks[i - 1].marker.length) return null;
  }
  return {
    head: body.slice(0, marks[0].at),
    values: marks.map((mark, i) => body.slice(mark.at + mark.marker.length, i + 1 < marks.length ? marks[i + 1].at : body.length)),
  };
}

export function lintPlan(text, options = {}) {
  const problems = [];
  const add = (line, message) => problems.push({ line, message });
  const lines = String(text).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const rows = { task: [], final: [], is: [], qa: [], companion: [], invariant: [], limit: [], switch: [], device: [], guard: [], notest: [], highrisk: [], typed: [] };
  const sections = new Map();
  let fence = null;
  let section = "";

  const front = parseFrontMatter(lines);
  for (const error of front.errors) add(error.line, error.message);
  const checked = front.wish ? validatePlanFrontMatter({ wish: front.wish }) : { errors: [] };
  for (const error of checked.errors) {
    const key = /^frontmatter\.wish\.([A-Za-z_]+)/.exec(error.path)?.[1];
    add(front.keys.get(key) ?? front.keys.get("wish"), `${error.path}: ${error.message}`);
  }
  const type = front.wish?.type ?? null;
  const tier = front.wish?.tier ?? null;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const n = i + 1;
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(raw);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
    if (open) { fence = open[1]; continue; }
    const heading = /^#{1,6} (.+)$/.exec(raw);
    if (heading) { section = heading[1].trim(); if (!sections.has(section)) sections.set(section, n); continue; }
    if (!raw.startsWith("- ") && !raw.startsWith("- [")) continue;
    const hit = MARKERS.map(([kind, pattern]) => ({ kind, match: pattern.exec(raw) })).find((entry) => entry.match);
    if (!hit) {
      if (DECLARED.test(raw)) add(n, "malformed row: a declared marker without its grammar (references/plan-format.md §4)");
      continue;
    }
    const [, first, second] = hit.match;
    if (hit.kind === "task" || hit.kind === "final") {
      const wrong = hit.kind === "task" ? "Final verification wave" : "Todos";
      if (!KEEP_SECTIONS.includes(section)) add(n, "a task row outside ## Todos and ## Final verification wave would never run");
      else if (section === wrong) add(n, `a ${hit.kind} row belongs under the other section`);
      rows[hit.kind].push({ line: n, id: Number(first), title: second, section });
    } else if (hit.kind === "typed") {
      rows.typed.push({ line: n, kind: first, body: second, section });
    } else if (["is", "qa", "invariant", "device"].includes(hit.kind)) {
      rows[hit.kind].push({ line: n, id: first, body: second, section });
    } else {
      rows[hit.kind].push({ line: n, body: first, section });
    }
  }

  if (!sections.has("Todos")) add(1, 'no "## Todos" section: ulw-plan task rows live there');
  else if (!rows.task.length) add(sections.get("Todos"), '"## Todos" holds no "- [ ] <N>. <title>" row');
  if (!sections.has("Final verification wave")) add(1, 'no "## Final verification wave" section');
  else if (!rows.final.length) add(sections.get("Final verification wave"), '"## Final verification wave" holds no "- [ ] F<n>. <title>" row');
  for (const kind of ["task", "final"]) {
    const seen = new Set();
    for (const row of rows[kind]) {
      if (!seen.has(row.id)) { seen.add(row.id); continue; }
      add(row.line, `duplicate ${kind} row number ${row.id}`);
    }
  }

  if (!rows.is.length) add(1, "no IS rows: the plan delivers nothing measurable");
  const isIds = new Map();
  const qaOwner = new Map();
  for (const row of rows.is) {
    if (isIds.has(row.id)) add(row.line, `duplicate IS row ${row.id}`);
    isIds.set(row.id, row);
    const fields = fieldsOf(row.body, [" ; criterion: "]);
    if (!fields) { add(row.line, `${row.id} must read \`${row.id}: <property> ; criterion: QA-<n>[; gap: G<n>]\``); continue; }
    if (!fields.head.trim()) add(row.line, `${row.id} states no property`);
    const [criterion] = fields.values;
    const gapAt = criterion.indexOf(" ; gap: ");
    const gap = gapAt === -1 ? null : criterion.slice(gapAt + 7).trim();
    row.gap = gap;
    row.qa = [];
    for (const name of (gapAt === -1 ? criterion : criterion.slice(0, gapAt)).split(",").map((part) => part.trim())) {
      if (!/^QA-\d+$/.test(name)) { add(row.line, `${row.id} criterion "${name}" is not a QA-<n> id`); continue; }
      row.qa.push(name);
      if (!qaOwner.has(name)) qaOwner.set(name, new Set());
      qaOwner.get(name).add(row.id);
    }
    if (!row.qa.length) add(row.line, `${row.id} names no QA scenario: every IS row needs its proof`);
    if (gap !== null && !/^G[1-9]\d*$/.test(gap)) add(row.line, `${row.id} gap "${gap}" is not a G<n> id`);
  }

  const qaIds = new Map();
  for (const row of rows.qa) {
    if (qaIds.has(row.id)) add(row.line, `duplicate QA scenario ${row.id}`);
    qaIds.set(row.id, row);
    const fields = fieldsOf(row.body, [" ; pass when: ", " ; evidence: ", " ; run: "]);
    if (!fields) {
      add(row.line, `${row.id} must read \`${row.id}: <what the user does> ; pass when: <one binary observation> ; evidence: <path> ; run: <command>\``);
      continue;
    }
    const labels = ["what the user does", "pass when", "evidence", "run"];
    [fields.head, ...fields.values].forEach((value, index) => {
      if (!value.trim()) add(row.line, `${row.id} has an empty ${labels[index]} field`);
    });
    if (!qaOwner.has(row.id)) add(row.line, `${row.id} is owned by no IS row`);
  }

  for (const row of rows.is) {
    for (const name of row.qa ?? []) {
      if (!qaIds.has(name)) add(row.line, `${row.id} names ${name}, which has no QA scenario`);
    }
  }

  for (const row of rows.device) {
    const target = /^IS-\d+$/.test(row.id) ? row.id : null;
    if (target && !isIds.has(target)) add(row.line, `DEVICE row names ${target}, which is not a declared IS row`);
    const body = row.body.trim();
    const accepted = type === "mixed"
      ? PRIMARY_TYPES.some((concrete) => validateDeviceRow(concrete, body).ok)
      : type !== null && validateDeviceRow(type, body).ok;
    if (!accepted) add(row.line, `DEVICE body does not match the ${type ?? "declared"} device grammar`);
    const claim = /^claim (C\d+) gate\(/.exec(body);
    if (claim) row.claim = claim[1];
  }
  for (const row of rows.is) {
    if (!rows.device.some((device) => device.id === row.id)) add(row.line, `${row.id} has no DEVICE row`);
  }

  const claimIds = new Map();
  const ruleIds = new Map();
  for (const row of rows.typed) {
    const expected = TYPE_OF_KIND[row.kind];
    if (type !== null && type !== "mixed" && expected !== type) {
      add(row.line, `a ${row.kind}: row belongs to the ${expected} type, not to a ${type} plan`);
    }
    if (row.kind === "SCREEN") {
      const fields = fieldsOf(row.body, [" ; primary: ", " ; priorities: ", " ; left-out: ", " ; required: "]);
      if (!fields) { add(row.line, "SCREEN must read `SCREEN: <surface> ; primary: ... ; priorities: ... ; left-out: ... ; required: ...`"); continue; }
      if (!fields.head.trim()) add(row.line, "SCREEN names no surface");
      const layoutAt = fields.values[3].indexOf(" ; layout: ");
      if (layoutAt !== -1) fields.values[3] = fields.values[3].slice(0, layoutAt);
      ["primary", "priorities", "left-out", "required"].forEach((label, index) => {
        if (!fields.values[index].trim()) add(row.line, `SCREEN has an empty ${label} field`);
      });
    } else if (row.kind === "CLAIM") {
      const fields = fieldsOf(row.body, [" : "]);
      const id = fields ? fields.head.trim() : "";
      if (!fields || !/^C[1-9]\d*$/.test(id)) { add(row.line, "CLAIM must read `CLAIM: C<n> : <the claim the report must support>`"); continue; }
      if (claimIds.has(id)) add(row.line, `duplicate claim ${id}`);
      claimIds.set(id, row);
      if (!fields.values[0].trim()) add(row.line, `${id} states no claim`);
    } else {
      const fields = fieldsOf(row.body, [" : "]);
      const hint = row.kind === "AXIS" ? "<the question it must answer>" : "<what it requires>";
      if (!fields) { add(row.line, `${row.kind} must read \`${row.kind}: <name> : ${hint}\``); continue; }
      const name = fields.head.trim();
      if (!name) add(row.line, `${row.kind} has no name`);
      if (row.kind === "RULE") {
        if (!classValid("audit", name)) add(row.line, `${name} is not an audit rule id`);
        if (ruleIds.has(name)) add(row.line, `duplicate rule ${name}`);
        ruleIds.set(name, row);
      }
      if (!fields.values[0].trim()) add(row.line, `${row.kind} ${name || ""} states nothing it requires`.replace("  ", " "));
    }
  }
  const contractLine = sections.get("Contract") ?? 1;
  for (const kind of REQUIRED_KINDS[type] ?? []) {
    if (!rows.typed.some((row) => row.kind === kind)) add(contractLine, `a ${type} plan needs at least one ${kind}: row`);
  }
  for (const row of rows.device) {
    if (row.claim && !claimIds.has(row.claim)) add(row.line, `DEVICE cites claim ${row.claim}, which no CLAIM: row declares`);
  }

  for (const row of rows.companion) {
    const body = row.body.trim();
    if (/^none\.?$/.test(body)) { row.none = true; continue; }
    const fields = /^(.+?) <- (IS-\d+) : (\S.*)$/.exec(body);
    if (!fields) { add(row.line, "COMPANION must read `COMPANION: <item> <- IS-<n> : <why expected>` or `COMPANION: none.`"); continue; }
    if (!isIds.has(fields[2])) add(row.line, `COMPANION targets ${fields[2]}, which is not a declared IS row`);
  }
  if (rows.companion.some((row) => row.none) && rows.companion.some((row) => !row.none)) {
    add(rows.companion.find((row) => row.none).line, "`COMPANION: none.` excludes other COMPANION rows");
  }

  const invariantIds = new Map();
  for (const row of rows.invariant) {
    if (invariantIds.has(row.id)) add(row.line, `duplicate invariant ${row.id}`);
    invariantIds.set(row.id, row);
    const fields = fieldsOf(row.body, [" : "]);
    if (!fields || !fields.head.trim() || !fields.values[0].trim()) {
      add(row.line, `${row.id} must read \`INVARIANT ${row.id}: <property> : <the test or QA scenario that shows a violation>\``);
    }
  }

  for (const row of rows.limit) {
    const fields = fieldsOf(row.body, [" : "]);
    if (!fields || !fields.head.trim() || !fields.values[0].trim()) add(row.line, "LIMIT must read `LIMIT: <what is not handled> : <why accepted>`");
  }
  for (const row of rows.switch) {
    const fields = fieldsOf(row.body, [" -> "]);
    if (!fields || !fields.head.trim() || !fields.values[0].trim()) add(row.line, "SWITCH must read `SWITCH: <the failed premise> -> <the new approach>`");
  }
  for (const row of rows.guard) {
    const fields = /^(\S+) : (.*) -> (\S+)$/.exec(row.body);
    if (!fields) { add(row.line, "guard must read `guard: <INVARIANT or IS row> : <the regression a user would hit> -> <node>`"); continue; }
    const cited = fields[1];
    if (/^INV\d+$/.test(cited) ? !invariantIds.has(cited) : !isIds.has(cited)) {
      add(row.line, `guard cites "${cited}", which is neither a declared INVARIANT nor an IS row`);
    }
    if (!fields[2].trim()) add(row.line, "guard states no regression");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fields[3])) add(row.line, `guard node "${fields[3]}" is not a node id`);
  }
  for (const row of rows.notest) {
    const fields = fieldsOf(row.body, [" : "]);
    const qa = fields ? fields.values[0].trim() : "";
    if (!fields || !fields.head.trim() || !/^QA-\d+$/.test(qa)) add(row.line, "no-test must read `no-test: <reason> : QA-<n>`");
    else if (!qaIds.has(qa)) add(row.line, `no-test names ${qa}, which has no QA scenario`);
  }
  for (const row of rows.highrisk) {
    const fields = /^(IS-\d+|INV\d+) \((concurrency|persistence|state|lifetime)\) -> (\S+)$/.exec(row.body);
    if (!fields) { add(row.line, `HIGH-RISK must read \`HIGH-RISK: <IS row|INV> (${HIGH_RISK_KINDS.join("|")}) -> <node>\``); continue; }
    const cited = fields[1];
    if (/^INV\d+$/.test(cited) ? !invariantIds.has(cited) : !isIds.has(cited)) add(row.line, `HIGH-RISK cites "${cited}", which is not declared`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fields[3])) add(row.line, `HIGH-RISK node "${fields[3]}" is not a node id`);
    if (type !== null && type !== "code" && type !== "mixed") add(row.line, `a ${type} plan runs no adversarial lane, so it cannot flag a HIGH-RISK row`);
  }

  let register = null;
  if (options.register) {
    const parsed = parseGapsTsv(options.register.text);
    for (const error of parsed.errors) add(1, `${options.register.path}: ${error.path}: ${error.message}`);
    const gapIds = new Set(parsed.rows.map((row) => row.id));
    register = { path: options.register.path, rows: parsed.rows.length };
    for (const row of rows.is) {
      if (!row.gap) add(row.line, `${row.id} must cite its register row as \`gap: G<n>\` when a register is given`);
      else if (!gapIds.has(row.gap)) add(row.line, `${row.id} cites ${row.gap}, which is not in ${options.register.path}`);
    }
    for (const row of rows.device) {
      if (/^G\d+$/.test(row.id) && !gapIds.has(row.id)) add(row.line, `DEVICE targets ${row.id}, which is not in ${options.register.path}`);
    }
  }

  for (const problem of problems) {
    const rule = RULES.find(([, pattern]) => pattern.test(problem.message));
    problem.rule = rule ? rule[0] : "PL0";
    problem.message = `${problem.rule}: ${problem.message}`;
  }
  problems.sort((a, b) => a.line - b.line);
  return {
    ok: problems.length === 0,
    type,
    tier,
    counts: {
      is: rows.is.length, qa: rows.qa.length, devices: rows.device.length, guards: rows.guard.length,
      companions: rows.companion.filter((row) => !row.none).length, invariants: rows.invariant.length,
      limits: rows.limit.length, switches: rows.switch.length, highRisk: rows.highrisk.length,
      typeRows: rows.typed.length, tasks: rows.task.length + rows.final.length,
    },
    register,
    problems,
  };
}

// A FIFO or a device would block readFileSync forever; a linter must always reach an exit.
function readText(path) {
  if (!statSync(path).isFile()) throw Object.assign(new Error("not a regular file"), { path, code: "ENOTFILE" });
  return readFileSync(path, "utf8");
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  let text;
  let register;
  try {
    text = readText(options.plan);
    if (options.register) register = { path: options.register, text: readText(options.register) };
  } catch (error) {
    console.error(`cannot read ${error.path ?? "the plan"}: ${error.code ?? error.message}\n${USAGE}`);
    return 2;
  }
  const result = lintPlan(text, { register });
  if (options.json) {
    console.log(JSON.stringify({ ok: result.ok, plan: options.plan, type: result.type, tier: result.tier, counts: result.counts, register: result.register, problems: result.problems }));
  } else if (result.ok) {
    const { is, qa, devices, guards, companions } = result.counts;
    console.log(`PASS ${options.plan}: ${is} IS rows, ${qa} QA scenarios, ${devices} DEVICE rows, ${guards} guard rows, ${companions} COMPANION rows`);
  } else {
    for (const problem of result.problems) console.error(`${options.plan}:${problem.line}: ${problem.message}`);
    console.error(`FAIL ${options.plan}: ${result.problems.length} problems`);
  }
  return result.ok ? 0 : 1;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) process.exitCode = main(process.argv.slice(2));