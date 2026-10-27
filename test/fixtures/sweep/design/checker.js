#!/usr/bin/env bun
// Fixture stand-in for the omo frontend draft-guard checker: same interface
// (exit 0 clean, 1 findings, 2 usage or unreadable target) and the same JSON
// finding shape, so the wrapper is tested without depending on an install path.
import { readFileSync, statSync } from "node:fs";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const targets = argv.filter((arg) => arg !== "--json");
if (targets.length === 0) {
  process.stderr.write("usage: checker.js [--json] <file>...\n");
  process.exit(2);
}

const RULES = [
  [/border-left\s*:/, "edge-stripe"],
  [/supercharge/i, "promo-copy"],
  [/\u{1F680}/u, "emoji-icon"],
  [/mystery/, "mystery-rule"],
];

const findings = [];
for (const target of targets) {
  let stat;
  try {
    stat = statSync(target);
  } catch {
    process.stderr.write(`checker: cannot read ${target}\n`);
    process.exit(2);
  }
  if (!stat.isFile()) continue;
  readFileSync(target, "utf8").split("\n").forEach((text, index) => {
    for (const [pattern, rule] of RULES) {
      if (pattern.test(text)) findings.push({ file: target, line: index + 1, column: 1, rule, excerpt: text.trim().slice(0, 60) });
    }
  });
}

if (json) process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
process.exit(findings.length === 0 ? 0 : 1);