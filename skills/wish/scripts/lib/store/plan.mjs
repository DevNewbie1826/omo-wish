import { validatePlanFrontMatter } from "../schema.mjs";
import { join } from "node:path";
import { stateMismatch, readTextOrNull } from "./core.mjs";
import { mutateText } from "./tables.mjs";

// ---------------------------------------------------------- plan front matter

// §8.1: the YAML shape M1 reads and writes. Only the front-matter block is
// re-rendered; the body is handed back exactly as it arrived, line endings and
// all, because the plan body belongs to the session and M2.
export function splitFrontMatter(text) {
  const source = String(text ?? "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?=\r?\n|$)/.exec(source);
  if (!match) return { block: null, body: source, unterminated: source.startsWith("---") };
  return { block: match[1].split(/\r?\n/), body: source.slice(match[0].length) };
}

function coerceScalar(raw, key) {
  const value = raw.trim();
  if (value === "null" || value === "~" || value === "") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  // Only the two numeric keys are numbers: an all-digit SHA in frozen_head or a
  // numeric-looking run id must stay a string, or the contract rejects it.
  if ((key === "pr" || key === "round") && /^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    // The writer quotes with JSON.stringify, so escapes (a quote, a backslash, a
    // control character) have to be decoded the same way or the round trip drifts.
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1);
  return value;
}

const FRONT_MATTER_KEYS = [
  "run_id", "tier", "type", "unit", "program_id", "worktree", "branch", "pr", "frozen_head", "round",
];

export function parseFrontMatter(text) {
  const split = splitFrontMatter(text);
  if (split.unterminated) throw stateMismatch("the plan front matter is not terminated by ---");
  if (split.block === null) throw stateMismatch("the plan has no wish: front matter");
  const wish = {};
  let seenRoot = false;
  split.block.forEach((line, index) => {
    if (line.trim() === "" || line.trim().startsWith("#")) return;
    if (line === "wish:") {
      seenRoot = true;
      return;
    }
    const match = /^ {2}([A-Za-z_][A-Za-z0-9_]*):[ ]?(.*)$/.exec(line);
    if (!match || !seenRoot) {
      throw stateMismatch(`the plan front matter line ${index + 2} is not a wish: key`);
    }
    wish[match[1]] = coerceScalar(match[2], match[1]);
  });
  if (!seenRoot) throw stateMismatch("the plan has no wish: front matter");
  for (const key of Object.keys(wish)) {
    if (!FRONT_MATTER_KEYS.includes(key)) throw stateMismatch(`the plan front matter key ${key} is not in the contract`);
  }
  return { wish, body: split.body };
}

export function readPlan(planPath) {
  const text = readTextOrNull(planPath);
  if (text === null) throw stateMismatch(`the plan does not exist: ${planPath}`);
  const parsed = parseFrontMatter(text);
  const checked = validatePlanFrontMatter(parsed);
  if (!checked.ok) throw stateMismatch(`${planPath} front matter does not match the contract`, checked.errors);
  return { wish: parsed.wish, body: parsed.body, path: planPath };
}

// A string that would parse back as something else must be quoted: the program id
// "null", a run id of digits, "true". Otherwise a round trip silently changes the
// value and the write's own verification never converges.
function yamlScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  if (/^(?:null|~|true|false|-?\d+)$/.test(text) || text.trim() !== text || text === "") {
    return JSON.stringify(text);
  }
  return text;
}

export function renderFrontMatter(wish, eol = "\n") {
  const lines = ["---", "wish:"];
  for (const key of FRONT_MATTER_KEYS) {
    if (!(key in wish)) continue;
    const value = wish[key];
    lines.push(`  ${key}: ${yamlScalar(value)}`);
  }
  lines.push("---");
  return `${lines.join(eol)}${eol}`;
}

// The plan body belongs to M2 and the session; M1 rewrites only the front
// matter block and keeps the rest byte-for-byte.
export function writeFrontMatter(planPath, wish) {
  mutateText(planPath, (current) => {
    const raw = current === null ? "" : splitFrontMatter(current).body;
    // The plan's own line ending is honoured, so a CRLF document survives a freeze
    // byte for byte; the marker's break travels with the body and is re-supplied by
    // the renderer, so exactly one is dropped and every other byte is kept.
    const eol = current?.match(/\r?\n/)?.[0] ?? "\n";
    const body = raw.replace(/^\r?\n/, "");
    return renderFrontMatter(wish, eol) + body;
  }, (text) => {
    const written = parseFrontMatter(text).wish;
    return Object.entries(wish).every(([key, value]) => written[key] === value);
  });
}

export function mergeFrontMatter(planPath, patch) {
  let merged = null;
  mutateText(planPath, (current) => {
    if (current === null) throw stateMismatch(`the plan does not exist: ${planPath}`);
    const parsed = parseFrontMatter(current);
    const wish = { ...parsed.wish, ...patch };
    const checked = validatePlanFrontMatter({ wish });
    if (!checked.ok) throw stateMismatch("the updated front matter would not match the contract", checked.errors);
    merged = wish;
    const eol = current.match(/\r?\n/)?.[0] ?? "\n";
    const body = splitFrontMatter(current).body.replace(/^\r?\n/, "");
    return renderFrontMatter(wish, eol) + body;
  }, (text) => {
    const wish = parseFrontMatter(text).wish;
    return Object.entries(patch).every(([key, value]) => wish[key] === value);
  });
  return merged;
}


export { coerceScalar };
