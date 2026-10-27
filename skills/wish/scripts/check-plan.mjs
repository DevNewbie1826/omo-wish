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

const problems = [];
const fail = (line, message) => problems.push(`${file}:${line}: ${message}`);
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

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
	let code = Boolean(fence);
	if (fence && FENCE_CLOSE.test(text) && text.trim().startsWith(fence)) {
		code = false;
		fence = null;
	} else if (!fence && FENCE_OPEN.test(text)) {
		const match = text.match(FENCE_OPEN);
		fence = match[1][0].repeat(3);
		code = true;
	}
	lines.push({ n: i + 1, text, code });
}
const prose = lines.filter((line) => !line.code);

const ROW_PREFIX = String.raw`^\s*(?:[-*+]\s+)?`;
const ID_BODY = String.raw`IS-?(?:\d|[A-Za-z]\d)[A-Za-z0-9_-]*`;
// `IS-<id>:` opens a wiring row, not a new IS row; only the latter declares a property.
const IS_ROW = new RegExp(`${ROW_PREFIX}\\*{0,2}(${ID_BODY})\\*{0,2}(?!:)\\b`);
const QA_ROW = new RegExp(`${ROW_PREFIX}\\*{0,2}(QA?[.-]?[0-9][A-Za-z0-9_-]*)\\*{0,2}\\b`);
const GUARD_ROW = new RegExp(`${ROW_PREFIX}guard:\\s*(.*)$`, "i");
const COMPANION_ROW = new RegExp(`${ROW_PREFIX}COMPANION:\\s*(.*)$`, "i");
const PAIRING_ROW = new RegExp(`${ROW_PREFIX}Pairing:\\s*(.*)$`, "i");
const INVARIANT_ROW = /^\s*(?:[-*+]\s+)?\*{0,2}(?:INV[A-Za-z0-9_-]*|INVARIANT)\b/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const IS_TOKEN = new RegExp(`\\b${ID_BODY}\\b`, "g");
const INV_TOKEN = /\bINV[A-Za-z0-9_-]*\b/g;
const QA_TOKEN = /\bQA?[.-]?[0-9][A-Za-z0-9_-]*\b/g;
const PATH_TOKEN =
	/(?<![\w/<.-])((?:skills|scripts|test|tests|docs|prompts|extensions|src|lib|packages)\/[A-Za-z0-9._/-]*[A-Za-z0-9._-]|\b(?:README\.md|package\.json)\b)/g;

const tokens = (text, pattern) =>
	[...text.matchAll(new RegExp(pattern.source, "g"))]
		.map((match) => match[0].replace(/-IS\d.*$/, ""))
		.filter(Boolean);
const normalize = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();

// IS rows.
const isRows = [];
for (const line of prose) {
	const match = line.text.match(IS_ROW);
	if (!match) continue;
	if (isRows.some((row) => row.id === match[1])) fail(line.n, `duplicate IS row ${match[1]}`);
	else isRows.push({ id: match[1], n: line.n, text: line.text });
}
const isIds = new Set(isRows.map((row) => row.id));

// QA scenario rows and the pairing links between the two sides.
const qaRows = [];
for (const line of prose) {
	const match = line.text.match(QA_ROW);
	if (!match) continue;
	if (qaRows.some((row) => row.id === match[1])) fail(line.n, `duplicate QA scenario ${match[1]}`);
	else qaRows.push({ id: match[1], n: line.n, text: line.text });
}
const qaIds = new Set(qaRows.map((row) => row.id));

const links = new Set();
const link = (is, qa) => links.add(`${is} -> ${qa}`);
const resolveIs = (token) => {
	if (isIds.has(token)) return [token];
	const suffix = isRows.filter((row) => row.id.endsWith(`-${token}`)).map((row) => row.id);
	return token.includes("-") || token.length < 2 ? [] : suffix;
};
const resolveQa = (token) => {
	if (qaIds.has(token)) return [token];
	const suffix = qaRows
		.filter((row) => {
			const bare = row.id.replace(/^QA?[.-]?/, "");
			return bare === token.replace(/^QA?[.-]?/, "");
		})
		.map((row) => row.id);
	return suffix;
};
for (const row of isRows) {
	for (const qa of tokens(row.text, QA_TOKEN)) {
		for (const resolved of resolveQa(qa)) link(row.id, resolved);
	}
}
for (const row of qaRows) {
	for (const is of tokens(row.text, IS_TOKEN)) {
		for (const resolved of resolveIs(is)) link(resolved, row.id);
	}
}
for (const line of prose) {
	const pairing = line.text.match(PAIRING_ROW);
	if (!pairing) continue;
	for (const segment of pairing[1].split(";")) {
		const [left, right] = segment.split("->");
		if (!left || !right) continue;
		const leftIds = tokens(left, IS_TOKEN).flatMap(resolveIs);
		for (const bare of left.matchAll(/(?:^|[,(\s])([A-Za-z]+[0-9][A-Za-z0-9._-]*)/g)) {
			leftIds.push(...resolveIs(bare[1]));
		}
		const rightIds = tokens(right, QA_TOKEN).flatMap(resolveQa);
		for (const is of new Set(leftIds)) {
			for (const qa of new Set(rightIds)) link(is, qa);
		}
	}
}
const pairedIs = new Set([...links].map((entry) => entry.split(" -> ")[0]));
const pairedQa = new Set([...links].map((entry) => entry.split(" -> ")[1]));

if (isRows.length === 0) fail(1, "no IS rows found; the plan needs one `IS-<id>` row per delivered property");
for (const row of isRows) {
	if (!pairedIs.has(row.id)) fail(row.n, `${row.id} is not named by any QA scenario`);
}
for (const row of qaRows) {
	if (!pairedQa.has(row.id)) fail(row.n, `${row.id} is owned by no IS row`);
}

// Invariants and the guard rows that must cite one of them (or an IS row).
const invariantIds = new Set();
const invariantProperties = [];
for (const line of prose) {
	if (!INVARIANT_ROW.test(line.text)) continue;
	for (const id of tokens(line.text, INV_TOKEN)) invariantIds.add(id);
	const body = line.text.replace(/^\s*(?:[-*+]\s+)?\*{0,2}(?:INV[A-Za-z0-9._-]*|INVARIANT)\*{0,2}\s*,?\s*:?\s*/i, "");
	const property = body.split(" : ")[0].replace(/^\*+|\*+$/g, "");
	if (property && / : /.test(body)) invariantProperties.push(normalize(property));
}
const guardRows = [];
for (const line of prose) {
	const match = line.text.match(GUARD_ROW);
	if (!match) continue;
	guardRows.push({ n: line.n, text: line.text });
	const separator = match[1].indexOf(" : ");
	if (separator === -1) {
		fail(line.n, "guard row must read `guard: <INVARIANT or IS row> : <regression a user would hit> -> <node>`");
		continue;
	}
	const ref = match[1].slice(0, separator).trim().replace(/^[`*]+|[`*]+$/g, "");
	const cited = tokens(ref, IS_TOKEN).concat(tokens(ref, INV_TOKEN));
	const ok =
		cited.some((id) => isIds.has(id)) ||
		cited.some((id) => invariantIds.has(id)) ||
		invariantProperties.some((property) => property && normalize(ref).includes(property));
	if (!ok) fail(line.n, `guard row cites "${ref}", which is neither a listed INVARIANT nor an IS row`);
}

// COMPANION rows: `COMPANION: <item> <- <IS row> : <why expected>`.
let companionCount = 0;
for (const line of prose) {
	const match = line.text.match(COMPANION_ROW);
	if (!match) continue;
	companionCount++;
	const shape = match[1].match(new RegExp(`^(.+?)\\s*<-\\s*(${ID_BODY})\\s*:\\s*(\\S.*)$`));
	if (!shape) {
		fail(line.n, "COMPANION row must read `COMPANION: <item> <- <IS row> : <why expected>`");
		continue;
	}
	if (!isIds.has(shape[2])) fail(line.n, `COMPANION row targets ${shape[2]}, which is not a declared IS row`);
}

// Wiring: a `## Wiring` section covering every IS row, or the same fields on each IS row.
const headings = [];
for (const line of prose) {
	const match = line.text.match(HEADING);
	if (match) headings.push({ n: line.n, level: match[1].length, title: match[2].trim() });
}
const sectionBody = (heading) => {
	const next = headings.find((other) => other.n > heading.n && other.level <= heading.level);
	const stop = next ? next.n : Infinity;
	return prose.filter((line) => line.n > heading.n && line.n < stop);
};
const wiringHeading = headings.find((heading) => /wiring/i.test(heading.title));
const wiringLines = wiringHeading ? sectionBody(wiringHeading) : [];
const wiringText = wiringLines.map((line) => line.text).join("\n");
const inlineWiring = (row) =>
	/entry[ -]?point|entry:/i.test(row.text) && /consumer/i.test(row.text) && /owner/i.test(row.text);
for (const row of isRows) {
	const covered = wiringHeading ? tokens(wiringText, IS_TOKEN).includes(row.id) : inlineWiring(row);
	if (!covered) {
		fail(
			row.n,
			wiringHeading
				? `${row.id} has no row under "## Wiring"; name its entry point, consumer, and owner`
				: `${row.id} names no wiring; add a "## Wiring" row for it (entry point, consumer, owner)`,
		);
	}
}
const pathLines = wiringHeading ? wiringLines : prose.filter((line) => isRows.some((row) => row.n === line.n));
for (const line of pathLines) {
	for (const token of tokens(line.text, PATH_TOKEN)) {
		const candidate = token.replace(/[.,;:)\]]+$/, "");
		if (!candidate || candidate.endsWith("/")) continue;
		if (/[<>*${}]/.test(candidate)) continue;
		if (fs.existsSync(path.join(repo, candidate))) continue;
		if (isRows.some((row) => row.text.includes(candidate))) continue;
		fail(line.n, `wiring path "${candidate}" does not exist in ${repo} and no IS row delivers it`);
	}
}

// State or lifetime rows list their transitions.
const transitionsHeading = headings.find((heading) => /transition/i.test(heading.title));
const transitionsText = transitionsHeading ? sectionBody(transitionsHeading).map((line) => line.text).join("\n") : "";
const transitionIds = new Set(tokens(transitionsText, IS_TOKEN));
for (const line of prose) {
	if (!/high-risk/i.test(line.text)) continue;
	if (!/state|lifetime/i.test(line.text)) continue;
	for (const id of tokens(line.text, IS_TOKEN)) {
		if (!isIds.has(id)) continue;
		const row = isRows.find((entry) => entry.id === id);
		if (transitionIds.has(id) || /transition/i.test(row.text)) continue;
		fail(line.n, `${id} is flagged state/lifetime but no transitions are listed for it`);
	}
}
for (const line of prose) {
	const heading = line.text.match(/^##\s+Transition/i);
	if (!heading) continue;
	for (const id of tokens(sectionBody({ n: line.n, level: 2 }).map((entry) => entry.text).join("\n"), IS_TOKEN)) {
		if (!isIds.has(id)) fail(line.n, `transitions name ${id}, which is not a declared IS row`);
	}
}

// The two pinned rules, stated once and never relaxed.
const allProse = prose.map((line) => line.text).join("\n");
const pinnedHeading = headings.find((heading) => /pinned rule/i.test(heading.title));
const pinnedLine = pinnedHeading ? pinnedHeading.n : 1;
const worktreePinned =
	/worktree[^.\n]{0,120}\bpinn?(?:ed|ing)\b/i.test(allProse) || /\bpinn?(?:ed|ing)\b[^.\n]{0,120}worktree/i.test(allProse);
const commitsSerialized =
	/\bcommits?\b[^.\n]{0,80}\bserial(?:ized|ised|ly)?\b/i.test(allProse) ||
	/\bserial(?:ized|ised|ly)?\b[^.\n]{0,80}\bcommits?\b/i.test(allProse);
if (!worktreePinned) fail(pinnedLine, 'missing pinned rule: every command pins the task worktree');
if (!commitsSerialized) fail(pinnedLine, "missing pinned rule: commits are serialized");

if (problems.length) {
	for (const problem of problems) console.error(problem);
	console.error(`FAIL ${file}: ${problems.length} problems`);
	process.exit(1);
}
console.log(
	`PASS ${file}: ${isRows.length} IS rows, ${qaRows.length} QA scenarios, ${guardRows.length} guard rows, ${companionCount} COMPANION rows`,
);