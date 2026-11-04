import { validateReceipt, parseReceiptFilename } from "./receipt.mjs";
import { parseFindingsTsv, parseGapsTsv, parseLensRows } from "./registers.mjs";
import { validateLedgerSequence } from "./ledger.mjs";
import { validateStatusJson, validatePlanFrontMatter, parseProgressLine, parseGatesMarkdown, validateDeviceRow } from "./state.mjs";
// The contract is only real if its own examples are validated: every fenced
// example in references/ledger.md is `wish:<tag>` and dispatched here.
export function extractExamples(markdown) {
  const examples = [];
  let current = null;
  String(markdown).replace(/\r\n?/g, "\n").split("\n").forEach((line) => {
    if (current) {
      if (line.trim() === "```") { examples.push(current); current = null; return; }
      current.body.push(line);
      return;
    }
    const match = /^```[A-Za-z0-9-]+\s+(wish:[A-Za-z0-9:._-]+)\s*$/.exec(line);
    if (match) current = { tag: match[1], body: [] };
  });
  if (current) examples.push({ ...current, unterminated: true });
  return examples.map((example) => ({ ...example, text: example.body.join("\n") }));
}

export function validateExamples(markdown) {
  const results = extractExamples(markdown).map((example) => {
    if (example.unterminated) return { tag: example.tag, ok: false, errors: [{ path: "fence", message: "unterminated" }] };
    try {
      return { tag: example.tag, ...dispatchExample(example.tag, example.text) };
    } catch (error) {
      return { tag: example.tag, ok: false, errors: [{ path: example.tag, message: String(error?.message ?? error) }] };
    }
  });
  return { ok: results.length > 0 && results.every((entry) => entry.ok), examples: results };
}

function dispatchExample(tag, text) {
  if (tag === "wish:receipt") return validateReceipt(JSON.parse(text));
  if (tag === "wish:findings-tsv") return parseFindingsTsv(text, { type: "code" });
  if (tag === "wish:gaps-tsv") return parseGapsTsv(text);
  if (tag === "wish:lens") return parseLensRows(text);
  if (tag === "wish:ledger") {
    const events = text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
    return validateLedgerSequence(events);
  }
  if (tag === "wish:status-json") return validateStatusJson(JSON.parse(text));
  if (tag === "wish:plan-frontmatter") return validatePlanFrontMatter(JSON.parse(text));
  if (tag === "wish:progress") return parseProgressLine(text.trim());
  if (tag === "wish:gates") return parseGatesMarkdown(text);
  if (tag === "wish:receipt-name") {
    const errors = text.split("\n").filter((line) => line.trim() !== "")
      .flatMap((line) => parseReceiptFilename(line.trim()).errors);
    return { ok: errors.length === 0, errors };
  }
  const device = /^wish:device-(code|design|research|audit)$/.exec(tag);
  if (device) return validateDeviceRow(device[1], text.trim());
  return { ok: false, errors: [{ path: tag, message: "no validator is wired to this example tag" }] };
}
