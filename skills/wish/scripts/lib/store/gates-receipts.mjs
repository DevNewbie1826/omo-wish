import { parseGatesMarkdown, parseReceiptFilename, validateReceipt, validateReceiptAgainstFilename } from "../schema.mjs";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { usage, checkFailed, stateMismatch, readTextOrNull, rootPaths } from "./core.mjs";
import { splitFrontMatter, coerceScalar } from "./plan.mjs";
import { mutateText } from "./tables.mjs";

// ---------------------------------------------------------------------- gates

// §13: the poteto block shape, read and written through the M0 parser so the
// renderer and the reader cannot drift.
export function readGates(root) {
  const text = readTextOrNull(rootPaths(root).gates);
  if (text === null) return [];
  const parsed = parseGatesMarkdown(text);
  if (!parsed.ok) throw stateMismatch(`${rootPaths(root).gates} does not match the contract`, parsed.errors);
  return parsed.gates;
}

export function renderGates(gates) {
  if (gates.length === 0) return "";
  const blocks = gates.map((gate) => {
    const lines = [
      `## ${gate.id}`,
      "",
      `- Status: ${gate.status}`,
      `- Question: ${gate.question}`,
      `- Options: ${gate.options}`,
      `- Default: ${gate.default}`,
    ];
    if (gate.status === "resolved") lines.push(`- Answer: ${gate.answer}`);
    return lines.join("\n");
  });
  return `# Gates\n\n${blocks.join("\n\n")}\n`;
}

function gateField(value, label) {
  if (value === null || value === undefined) throw usage(`${label} is required`);
  const text = String(value).replace(/\r?\n/g, " ").trim();
  if (text === "") throw usage(`${label} may not be empty`);
  return text;
}

function gatesFromText(text) {
  if (text === null || text.trim() === "") return [];
  const parsed = parseGatesMarkdown(text);
  if (!parsed.ok) throw stateMismatch("gates.md does not match the contract", parsed.errors);
  return parsed.gates;
}

export function addGate(root, { id, question, options, fallback }) {
  const paths = rootPaths(root);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(id ?? ""))) throw usage("--id takes [A-Za-z0-9][A-Za-z0-9_-]*");
  const choices = String(options ?? "").split("|").map((choice) => choice.trim()).filter((choice) => choice !== "");
  if (choices.length < 2) throw usage("--options takes at least two choices separated by |");
  const picked = gateField(fallback, "--default");
  if (!choices.includes(picked)) throw usage("--default must be one of --options");
  const gate = {
    id,
    status: "open",
    question: gateField(question, "--question"),
    options: choices.join(" | "),
    default: picked,
  };
  mutateText(paths.gates, (current) => {
    const gates = gatesFromText(current);
    if (gates.some((entry) => entry.id === id)) throw checkFailed(`gate ${id} already exists`);
    const next = [...gates, gate];
    const checked = parseGatesMarkdown(renderGates(next));
    if (!checked.ok) throw checkFailed("the gate block does not match the contract", checked.errors);
    return renderGates(next);
  }, (text) => gatesFromText(text).some((entry) => entry.id === gate.id && entry.question === gate.question));
  return gate;
}

export function resolveGate(root, { id, answer }) {
  const paths = rootPaths(root);
  const resolved = gateField(answer, "--answer");
  mutateText(paths.gates, (current) => {
    const gates = gatesFromText(current);
    const index = gates.findIndex((gate) => gate.id === id);
    if (index === -1) throw stateMismatch(`unknown gate ${id}`);
    if (gates[index].status !== "open") throw checkFailed(`gate ${id} is already ${gates[index].status}`);
    const next = gates.map((gate, at) => (at === index ? { ...gate, status: "resolved", answer: resolved } : gate));
    const checked = parseGatesMarkdown(renderGates(next));
    if (!checked.ok) throw checkFailed("the gate block does not match the contract", checked.errors);
    return renderGates(next);
  }, (text) => gatesFromText(text).some((entry) => entry.id === id && entry.status === "resolved"));
  return { id, status: "resolved", answer: resolved };
}
export function removeGate(root, { id }) {
  const paths = rootPaths(root);
  const removed = gateField(id, "--id");
  mutateText(paths.gates, (current) => {
    const gates = gatesFromText(current);
    const gate = gates.find((entry) => entry.id === removed);
    if (gate === undefined) throw stateMismatch(`unknown gate ${removed}`);
    if (gate.status !== "open") throw checkFailed(`gate ${removed} is ${gate.status}; only an open gate can be removed`);
    return renderGates(gates.filter((entry) => entry.id !== removed));
  }, (text) => !gatesFromText(text).some((entry) => entry.id === removed));
  return { id: removed, status: "removed" };
}
// ------------------------------------------------------ receipts and validity

// §4.2. A `.json` receipt is validated in full; a `.md` receipt contributes its
// front-matter identity and status only (LIM1 in the plan: no YAML array
// parser, and rows are not machine-counted for prose reports).
export function listReceipts(root) {
  const dir = rootPaths(root).receipts;
  let names;
  try {
    names = readdirSync(dir).filter((name) => name !== "." && name !== "..");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw stateMismatch(`cannot read ${dir}: ${error?.code ?? error}`);
  }
  return names.sort().map((name) => {
    const parsed = parseReceiptFilename(name);
    // A file whose name is not a receipt name is an artifact, not evidence about a
    // lane: the contract's filename grammar decides what a receipt is, and calling
    // every capture in `receipts/` a stale receipt buries the real ones.
    if (!parsed.ok) return null;
    const file = join(dir, name);
    const extension = name.slice(name.lastIndexOf(".") + 1);
    if (extension !== "json" && extension !== "md") {
      // A capture (png/jpg/webp/txt) carries no machine body: its identity and
      // validity come from the filename anchor alone (ledger.md §4.2).
      try {
        if (statSync(file).isDirectory()) return { name, ok: false, parsed, body: null, errors: [{ path: name, message: "is a directory" }] };
      } catch (error) {
        return { name, ok: false, parsed, body: null, errors: [{ path: name, message: "unreadable: " + (error?.code ?? "error") }] };
      }
      return { name, ok: true, parsed, body: null, errors: [], opaque: true };
    }
    let body;
    try {
      if (statSync(file).isDirectory()) return { name, ok: false, parsed, body: null, errors: [{ path: name, message: "is a directory" }] };
      body = extension === "md" ? parseReceiptMarkdown(readFileSync(file, "utf8")) : JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      return { name, ok: false, parsed, body: null, errors: [{ path: name, message: "unreadable: " + (error?.message ?? error) }] };
    }
    const shape = validateReceipt(body);
    const anchors = validateReceiptAgainstFilename(body, name);
    const errors = [...shape.errors, ...anchors.errors];
    return { name, ok: errors.length === 0, parsed, body, errors };
  }).filter(Boolean);
}

function parseReceiptMarkdown(text) {
  const split = splitFrontMatter(text);
  if (split.block === null) throw new Error("no front matter");
  const value = {};
  split.block.forEach((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*):[ ]?(.*)$/.exec(line);
    if (!match) throw new Error(`front matter line is not key: value: ${line}`);
    value[match[1]] = coerceScalar(match[2], match[1]);
  });
  if (typeof value.scope === "string") value.scope = [value.scope];
  value.rows = [];
  value.artifacts = Array.isArray(value.artifacts) ? value.artifacts : [];
  value.cleanup = Array.isArray(value.cleanup) ? value.cleanup : [];
  return value;
}

// §2/§4: a lane receipt is valid while its tree (or, for research, its artifact
// sha256 in head) matches; otherwise a recorded `reuse` verdict at the same head
// can keep it valid (§2.7). `before`/`after` captures are exempt on purpose, and
// an opaque capture is judged by its filename anchor only.
export function judgeReceipt(receipt, { type, head, tree, reuseEvents = [] }) {
  const kind = receipt.body?.kind ?? receipt.parsed?.kind;
  // Structural validity comes first: a malformed file or a directory named like a
  // receipt is unproven evidence, and being exempt from age checks (before/after)
  // must never make an unreadable file count as valid.
  if (!receipt.ok) return { valid: false, reason: "unparseable" };
  if (kind === "before" || kind === "after") return { valid: true, reason: "capture exempt from reuse" };
  if (receipt.opaque) {
    const anchor = receipt.parsed?.tree7 ?? receipt.parsed?.head7;
    const current = receipt.parsed?.tree7 ? tree : head;
    const valid = Boolean(anchor && typeof current === "string" && current.startsWith(anchor));
    return { valid, reason: valid ? "filename anchor matches" : "filename anchor moved" };
  }
  const body = receipt.body;
  if (!receipt.ok || !body) return { valid: false, reason: "unparseable" };
  const byTree = type === "research" ? null : body.tree;
  const anchored = type === "research" ? body.head === head : Boolean(tree) && byTree === tree;
  if (anchored) return { valid: true, reason: type === "research" ? "artifact sha256 matches" : "tree matches" };
  const rescue = [...reuseEvents].reverse().find((event) => event.reuse && event.reuse.receipt === receipt.name);
  if (rescue && rescue.reuse.verdict === "VALID" && (!head || rescue.head === head)) {
    return { valid: true, reason: "reuse VALID: ".concat(rescue.reuse.reason) };
  }
  return { valid: false, reason: type === "research" ? "artifact sha256 moved" : "tree moved" };
}
