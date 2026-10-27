// Class C — an error chain dropped while wrapping.
//
// Measured: 2 rows inside the boundary class, both blocking. A re-wrap that
// keeps only the message hides the cause from errors.Is / errors.As and from
// every caller that branches on the underlying error.

import { addedLines, lineBody, productionLines, row, isMain, probeCli } from "./lib.mjs";

export const name = "errors";
export const types = ["code"];
export const summary = "no wrap site hides its cause";

export const usage = `config:
  "probes": { "errors": {
    "strict": true,
    "base": "origin/main",
    "paths": ["src/**"],
    "patterns": [{ "name": "rewrapped-message", "regex": "new Error\\\\([^\\\\n]*\\\\.message\\\\)", "message": "..." }],
    "lines": [{ "file": "src/a.js", "line": 12 }]
  } }

Reads the added production source lines of "git diff <base>...HEAD" unless "lines"
are declared ("base" must be a revision, never an option). Prose and test files are
not scanned: a test file's own fixture text is not a production wrap, and no prose
line may demand a test. "testGlobs" and "codeExtensions" override that filter.
"strict": true makes a match FAIL; otherwise it is a WARN memo. The default
patterns are: a formatter that re-wraps with %v or %s instead of %w, a constructor
that re-wraps only the message, and an empty catch.`;

const DEFAULT_PATTERNS = [
  { name: "errorf-loses-chain", regex: "fmt\\.Errorf\\([^\\n]*%(v|s)[^\\n]*\\)", message: "re-wraps with %v or %s, so errors.Is and errors.As cannot see through it" },
  { name: "rewrapped-message", regex: "new Error\\([^\\n]*\\.message\\)", message: "re-wraps an error message and drops its cause" },
  { name: "swallowed-catch", regex: "catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}", message: "swallows the error" },
];

export async function run(config, ctx) {
  const cls = ctx.classFor("C");
  const patterns = (config.patterns ?? DEFAULT_PATTERNS).map((pattern) => ({ ...pattern, re: new RegExp(pattern.regex) }));
  const raw = config.lines?.length ? config.lines : await addedLines({ root: ctx.root, base: config.base, paths: config.paths });
  const lines = productionLines(raw, { testGlobs: config.testGlobs, codeExtensions: config.codeExtensions });
  if (lines.length === 0) {
    return [row({ id: "errors", verdict: "SKIP", observable: "at least one added production line is inspected", cls, note: "no added production source line to inspect" })];
  }
  const verdict = config.strict ? "FAIL" : "WARN";
  const checks = [];
  for (const line of lines) {
    const body = lineBody(ctx, line);
    for (const pattern of patterns) {
      if (!pattern.re.test(body)) continue;
      checks.push(row({
        id: `errors/${pattern.name}:${line.file}:${line.line}`,
        command: "no command",
        observable: "no added production line re-wraps an error without its cause",
        verdict,
        cls,
        note: pattern.message,
      }));
    }
  }
  if (checks.length === 0) {
    checks.push(row({
      id: "errors",
      command: "no command",
      observable: "no added production line re-wraps an error without its cause",
      verdict: "PASS",
      cls,
      note: `${lines.length} added lines re-wrap no error`,
    }));
  }
  return checks;
}

if (isMain(import.meta.url)) await probeCli({ name, types, summary, usage, run });