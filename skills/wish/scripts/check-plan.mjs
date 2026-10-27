#!/usr/bin/env node
// Mechanical checks for a wish plan file (references/plan.md, Step 2).
// Usage: node check-plan.mjs <plan.md> [--repo <repository root>]
// Exit: 0 clean, 1 complaints, 2 usage or read error.
import fs from "node:fs";
import path from "node:path";

const USAGE = "Usage: node check-plan.mjs <plan.md> [--repo <repository root>]";

function usage(message) {
	console.error(message ? `${message}\n${USAGE}` : USAGE);
	process.exit(2);
}

const argv = process.argv.slice(2);
const file = argv.find((arg) => !arg.startsWith("--"));
const repoFlag = argv.indexOf("--repo");
const repo = path.resolve(repoFlag === -1 ? process.cwd() : (argv[repoFlag + 1] ?? usage("--repo needs a directory")));
if (!file) usage();

let raw;
try {
	raw = fs.readFileSync(file, "utf8").split(/\r?\n/);
} catch (error) {
	usage(`cannot read ${file}: ${error.message}`);
}

const ID = String.raw`IS-?(?:\d|[A-Za-z]\d)[A-Za-z0-9_-]*`;
const QID = String.raw`QA?[.-]?[0-9][A-Za-z0-9_-]*`;
const IS_ANY = new RegExp(`\\b${ID}\\b`, "g");
const QA_ANY = new RegExp(`\\b${QID}\\b`, "g");
const INV_ANY = /\bINV[A-Za-z0-9_-]*\b/g;
const IS_EXACT = new RegExp(`^${ID}$`);
const QA_EXACT = new RegExp(`^${QID}$`);
const BULLET = String.raw`^\s*[-*+]\s+`;
const TAIL = String.raw`(?![A-Za-z0-9_:/.-])\*{0,2}`;
const IS_ROW = new RegExp(`${BULLET}\\*{0,2}(${ID})${TAIL}`);
const QA_ROW = new RegExp(`${BULLET}\\*{0,2}(${QID})${TAIL}`);
const GUARD_ROW = new RegExp(`${BULLET}guard:\\s*(.*)$`, "i");
const COMPANION_ROW = new RegExp(`${BULLET}COMPANION:\\s*(.*)$`, "i");
const PAIRING_ROW = new RegExp(
	String.raw`^\s*(?:[-*+]\s+)?(?:IS-row\s+to\s+QA|IS-to-QA|IS-QA|Pairing)\b[^:]*:\s*(.*)$`,
	"i",
);
const INVARIANT_ROW = /^\s*(?:[-*+]\s+)?\*{0,2}(?:INV[A-Za-z0-9_-]*|INVARIANT)\b/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const PATH_TOKEN = /(?<![\w/<.$-])((?:[A-Za-z_][\w.-]*\/)+[\w.-]*[A-Za-z0-9_-]|\b(?:README\.md|package\.json)\b)/g;
const FILE_EXTENSION = /\.(?:md|mjs|js|ts|json|ya?ml|toml|sh|txt|css|html)$/;

const problems = [];
const fail = (line, message) => problems.push(`${file}:${line}: ${message}`);

// Fenced code is documentation, never a row. Front matter is skipped too.
let start = 0;
if (raw[0] === "---") {
	const end = raw.indexOf("---", 1);
	if (end !== -1) start = end + 1;
}
const lines = [];
let fence = null;
for (let i = start; i < raw.length; i++) {
	const text = raw[i];
	let code = false;
	if (fence) {
		code = true;
		const close = text.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
		if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
	} else {
		const open = text.match(/^ {0,3}(`{3,}|~{3,})/);
		if (open) {
			fence = { char: open[1][0], length: open[1].length };
			code = true;
		}
	}
	lines.push({ n: i + 1, text, code });
}
const prose = lines.filter((line) => !line.code);

function tokens(text, pattern) {
	return [...text.matchAll(new RegExp(pattern.source, "g"))].map((match) => match[0]);
}
const normalize = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();
// `IS-1`, `IS1`, and `IS-A1` are one id family; `QA-1` and `Q1` likewise.
const canonIs = (id) => id.replace(/^IS-?/, "IS");
const canonQa = (id) => id.replace(/^QA?[.-]?/, "Q");
const splitCells = (text) =>
	text
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());

// `IS1-IS4` means four rows; expand ranges before collecting ids.
function expandIds(text) {
	let rest = text;
	const ids = [];
	for (const match of text.matchAll(/\b(IS-?\w+)\s*-\s*(IS-?\w+)\b/g)) {
		const first = Number(match[1].replace(/^IS-?/, ""));
		const last = Number(match[2].replace(/^IS-?/, ""));
		if (!Number.isInteger(first) || !Number.isInteger(last) || last < first || last - first > 50) continue;
		const prefix = match[1].startsWith("IS-") ? "IS-" : "IS";
		for (let index = first; index <= last; index++) ids.push(`${prefix}${index}`);
		rest = rest.replace(match[0], " ");
	}
	for (const token of tokens(rest, IS_ANY)) ids.push(token.replace(/-IS\d.*$/, ""));
	return [...new Set(ids)];
}

const headings = [];
for (const line of prose) {
	const match = line.text.match(HEADING);
	if (match) headings.push({ n: line.n, level: match[1].length, title: match[2].trim() });
}
const sectionAt = (n) => [...headings].reverse().find((heading) => heading.n < n)?.title ?? "";

// Markdown tables carry IS rows, QA scenarios, and wiring in several real plans.
const tables = [];
for (let i = 0; i < prose.length; i++) {
	if (!/^\s*\|/.test(prose[i].text)) continue;
	const separator = prose[i + 1];
	if (!separator || !/^\s*\|[\s:|-]+\|\s*$/.test(separator.text)) continue;
	const header = splitCells(prose[i].text);
	const rows = [];
	let j = i + 2;
	while (j < prose.length && /^\s*\|/.test(prose[j].text)) {
		rows.push({ n: prose[j].n, cells: splitCells(prose[j].text), text: prose[j].text });
		j++;
	}
	tables.push({ header, rows, section: sectionAt(prose[i].n) });
	i = j - 1;
}
const isTable = (table) =>
	/\bIS rows?\b/i.test(table.section) || table.header.some((cell) => /deliverable|property|requirement|criterion|description/i.test(cell));
const qaTable = (table) => /QA scenario|QA check/i.test(table.section) || table.header.some((cell) => /pairing/i.test(cell));

// IS rows: bullet rows and table rows.
const isRows = [];
for (const line of prose) {
	const match = line.text.match(IS_ROW);
	if (!match) continue;
	isRows.push({ id: match[1], n: line.n, text: line.text });
}
for (const table of tables) {
	if (!isTable(table)) continue;
	for (const row of table.rows) {
		const id = row.cells[0]?.match(IS_EXACT) ? row.cells[0] : null;
		if (id) isRows.push({ id, n: row.n, text: row.text, table });
	}
}
for (const row of isRows) {
	if (isRows.filter((entry) => canonIs(entry.id) === canonIs(row.id)).length > 1) fail(row.n, `duplicate IS row ${row.id}`);
}
const isIds = new Set(isRows.map((row) => canonIs(row.id)));
if (isRows.length === 0) fail(1, "no IS rows found; the plan needs one `IS-<id>` row per delivered property");

// QA scenarios: bullet rows, table rows, and a pairing line anywhere.
const qaRows = [];
for (const line of prose) {
	const match = line.text.match(QA_ROW);
	if (!match) continue;
	qaRows.push({ id: match[1], n: line.n, text: line.text });
}
for (const table of tables) {
	if (!qaTable(table)) continue;
	for (const row of table.rows) {
		const id = row.cells[0]?.match(QA_EXACT) ? row.cells[0] : null;
		if (id) qaRows.push({ id, n: row.n, text: row.text });
	}
}
for (const row of qaRows) {
	if (qaRows.filter((entry) => canonQa(entry.id) === canonQa(row.id)).length > 1) fail(row.n, `duplicate QA scenario ${row.id}`);
}
const qaIds = new Set(qaRows.map((row) => canonQa(row.id)));
// A comma separates pairing segments only when the part holds several arrows;
// otherwise the commas belong to the IS list on the left of one arrow.
function pairSegments(value) {
	const segments = [];
	for (const part of value.split(";")) {
		if (part.split("->").length > 2) segments.push(...part.split(/,\s*(?=IS-?[\w/ -]*->)/));
		else segments.push(part);
	}
	return segments;
}
const links = new Set();
const link = (is, qa) => links.add(`${canonIs(is)} -> ${canonQa(qa)}`);
const resolveQa = (token) =>
	qaIds.has(canonQa(token)) ? [canonQa(token)] : qaRows.filter((row) => canonQa(row.id) === canonQa(token)).map((row) => canonQa(row.id));

for (const row of qaRows) {
	for (const id of expandIds(row.text)) if (isIds.has(canonIs(id))) link(id, row.id);
}
for (const row of isRows) {
	for (const qa of tokens(row.text, QA_ANY)) for (const resolved of resolveQa(qa)) link(row.id, resolved);
}
for (const line of prose) {
	const pairing = line.text.match(PAIRING_ROW);
	if (!pairing) continue;
	for (const segment of pairSegments(pairing[1])) {
		const arrow = segment.indexOf("->");
		if (arrow === -1) continue;
		for (const is of expandIds(segment.slice(0, arrow))) {
			if (!isIds.has(canonIs(is))) continue;
			for (const qa of tokens(segment.slice(arrow + 2), QA_ANY).flatMap(resolveQa)) link(is, qa);
		}
	}
}
const pairedIs = new Set([...links].map((entry) => entry.split(" -> ")[0]));
const pairedQa = new Set([...links].map((entry) => entry.split(" -> ")[1]));
for (const row of isRows) if (!pairedIs.has(canonIs(row.id))) fail(row.n, `${row.id} is not named by any QA scenario`);
for (const row of qaRows) if (!pairedQa.has(canonQa(row.id))) fail(row.n, `${row.id} is owned by no IS row`);

// Invariants and the guard rows that must cite one of them (or an IS row).
const invariantIds = new Set();
const invariantProperties = [];
for (const line of prose) {
	if (!INVARIANT_ROW.test(line.text)) continue;
	for (const id of tokens(line.text, INV_ANY)) invariantIds.add(id);
	const body = line.text.replace(/^\s*(?:[-*+]\s+)?\*{0,2}(?:INV[A-Za-z0-9_-]*|INVARIANT)\*{0,2}\s*,?\s*:?\s*/i, "");
	const property = body.split(" : ")[0].replace(/^\*+|\*+$/g, "");
	if (property && / : /.test(body)) invariantProperties.push(normalize(property));
}
let guardCount = 0;
for (const line of prose) {
	const match = line.text.match(GUARD_ROW);
	if (!match) continue;
	guardCount++;
	const separator = match[1].indexOf(" : ");
	if (separator === -1) {
		fail(line.n, "guard row must read `guard: <INVARIANT or IS row> : <regression a user would hit> -> <node>`");
		continue;
	}
	const ref = match[1].slice(0, separator).trim().replace(/^[`*"']+|[`*"']+$/g, "");
	const cited = [...tokens(ref, IS_ANY).map(canonIs), ...tokens(ref, INV_ANY)];
	const ok =
		cited.some((id) => isIds.has(id)) ||
		cited.some((id) => invariantIds.has(id)) ||
		invariantProperties.some((property) => property && normalize(ref).includes(property));
	if (!ok) fail(line.n, `guard row cites "${ref}", which is neither a listed INVARIANT nor an IS row`);
}

// COMPANION rows: `COMPANION: <item> <- <IS row> : <why expected>`, or the `none` sentinel.
let companionCount = 0;
for (const line of prose) {
	const match = line.text.match(COMPANION_ROW);
	if (!match) continue;
	companionCount++;
	if (/^none\b/i.test(match[1].trim())) continue;
	const shape = match[1].match(/^(.+?)\s*<-\s*([^:;]+?)\s*[:;]\s*(\S.*)$/);
	if (!shape) {
		fail(line.n, "COMPANION row must read `COMPANION: <item> <- <IS row> : <why expected>`");
		continue;
	}
	for (const target of expandIds(shape[2])) {
		if (!isIds.has(canonIs(target))) fail(line.n, `COMPANION row targets ${target}, which is not a declared IS row`);
	}
}

// Wiring: a `## Wiring` section, an IS table with entry/consumer/owner columns, or the fields inline.
const sectionBody = (heading) => {
	const next = headings.find((other) => other.n > heading.n && other.level <= heading.level);
	return prose.filter((line) => line.n > heading.n && line.n < (next ? next.n : Infinity));
};
const wiringHeading = headings.find((heading) => /wiring/i.test(heading.title));
const wiringLines = wiringHeading ? sectionBody(wiringHeading) : [];
const wiringIds = new Set(expandIds(wiringLines.map((line) => line.text).join("\n")).map(canonIs));
const wiringTable = tables.find(
	(table) =>
		table.header.some((cell) => /entry|file/i.test(cell)) &&
		table.header.some((cell) => /consumer/i.test(cell)) &&
		table.header.some((cell) => /owner/i.test(cell)),
);
const wiringTableIds = new Set(
	(wiringTable?.rows ?? []).map((row) => row.cells[0]).filter((cell) => cell && IS_EXACT.test(cell)).map(canonIs),
);
const inlineWiring = (row) =>
	/entry[ -]?point|entry:/i.test(row.text) && /consumer/i.test(row.text) && /owner/i.test(row.text);
for (const row of isRows) {
	const covered = wiringIds.has(canonIs(row.id)) || wiringTableIds.has(canonIs(row.id)) || inlineWiring(row);
	if (!covered) {
		fail(
			row.n,
			wiringHeading || wiringTable
				? `${row.id} has no wiring row; name its entry point, consumer, and owner under "## Wiring" or in the IS table`
				: `${row.id} names no wiring; add a "## Wiring" row for it (entry point, consumer, owner)`,
		);
	}
}
const pathLines = [
	...(wiringHeading ? wiringLines : []),
	...(wiringTable?.rows ?? []).map((row) => ({ n: row.n, text: row.text })),
	...prose.filter((line) => isRows.some((row) => row.n === line.n && inlineWiring(row))),
];
const looksLikePath = (candidate) =>
	fs.existsSync(path.join(repo, candidate.split("/")[0])) || FILE_EXTENSION.test(candidate);
// A path resolves from the repository root or, as plans often write it, under a skill directory.
function pathExists(candidate) {
	if (fs.existsSync(path.join(repo, candidate))) return true;
	const tops = fs.readdirSync(repo, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	for (const top of tops) {
		if (fs.existsSync(path.join(repo, top, candidate))) return true;
		if (top !== "skills") continue;
		for (const skill of fs.readdirSync(path.join(repo, top))) {
			if (fs.existsSync(path.join(repo, top, skill, candidate))) return true;
		}
	}
	return false;
}
for (const line of pathLines) {
	for (const token of tokens(line.text, PATH_TOKEN)) {
		const candidate = token.replace(/[.,;:)\]]+$/, "");
		if (!candidate || candidate.endsWith("/") || /[<>*${}]/.test(candidate)) continue;
		if (!looksLikePath(candidate)) continue;
		if (pathExists(candidate)) continue;
		if (isRows.some((row) => row.text.includes(candidate))) continue;
		fail(line.n, `wiring path "${candidate}" does not exist in ${repo} and no IS row delivers it`);
	}
}

// State or lifetime rows list their transitions.
const transitionsHeading = headings.find((heading) => /transition/i.test(heading.title));
const transitionTokens = expandIds(
	transitionsHeading ? sectionBody(transitionsHeading).map((line) => line.text).join("\n") : "",
);
const transitionIds = new Set(transitionTokens.map(canonIs));
for (const line of prose) {
	if (!/high-risk/i.test(line.text) || !/state|lifetime/i.test(line.text)) continue;
	for (const id of expandIds(line.text)) {
		if (!isIds.has(canonIs(id))) continue;
		const row = isRows.find((entry) => canonIs(entry.id) === canonIs(id));
		if (transitionIds.has(canonIs(id)) || /transition/i.test(row.text)) continue;
		fail(line.n, `${id} is flagged state/lifetime but no transitions are listed for it`);
	}
}
if (transitionsHeading) {
	for (const id of transitionTokens) {
		if (!isIds.has(canonIs(id))) fail(transitionsHeading.n, `transitions name ${id}, which is not a declared IS row`);
	}
}

// The two pinned rules, stated once and never relaxed.
const allProse = prose.map((line) => line.text).join("\n");
const pinnedHeading = headings.find((heading) => /pinned rule/i.test(heading.title));
const pinnedLine = pinnedHeading ? pinnedHeading.n : 1;
const worktreePinned =
	/worktree[^.\n]{0,120}\bpin(?:s|ned|ning)?\b/i.test(allProse) ||
	/\bpin(?:s|ned|ning)?\b[^.\n]{0,120}worktree/i.test(allProse);
const commitsSerialized =
	/\bcommits?\b[^.\n]{0,80}\bserial(?:ized|ised|ly)?\b/i.test(allProse) ||
	/\bserial(?:ized|ised|ly)?\b[^.\n]{0,80}\bcommits?\b/i.test(allProse);
if (!worktreePinned) fail(pinnedLine, "missing pinned rule: every command pins the task worktree");
if (!commitsSerialized) fail(pinnedLine, "missing pinned rule: commits are serialized");

if (problems.length) {
	for (const problem of problems) console.error(problem);
	console.error(`FAIL ${file}: ${problems.length} problems`);
	process.exit(1);
}
console.log(
	`PASS ${file}: ${isRows.length} IS rows, ${qaRows.length} QA scenarios, ${guardCount} guard rows, ${companionCount} COMPANION rows`,
);