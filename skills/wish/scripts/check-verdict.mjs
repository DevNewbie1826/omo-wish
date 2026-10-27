#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERDICT_PATTERN = /^VERDICT: (APPROVED|REVISE) round ([1-9][0-9]*) head ([0-9a-fA-F]{40})$/;
const SHA_PATTERN = /^[0-9a-fA-F]{40}$/;
const USAGE = "usage: check-verdict.mjs --body <file> --head <full-40-hex-sha> [--require-approved]";

export function parseVerdict(body) {
  const lines = String(body).replace(/\r\n?/g, "\n").split("\n");
  let lastIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim() !== "") {
      lastIndex = index;
      break;
    }
  }
  if (lastIndex === -1) return { ok: false, reason: "body is empty" };
  const line = lines[lastIndex].trimEnd();
  const match = VERDICT_PATTERN.exec(line);
  if (!match) {
    return { ok: false, reason: `last non-empty line is not a verdict line: ${line}` };
  }
  return {
    ok: true,
    verdict: match[1],
    round: Number(match[2]),
    head: match[3].toLowerCase(),
    line,
  };
}

export function checkCoverage({ body, head, requireApproved = false }) {
  const parsed = parseVerdict(body);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const currentHead = String(head ?? "").toLowerCase();
  if (!SHA_PATTERN.test(currentHead)) {
    return {
      ok: false,
      verdict: parsed,
      reason: `current head is not a full 40-hex SHA: ${head}`,
    };
  }
  if (parsed.head !== currentHead) {
    return {
      ok: false,
      verdict: parsed,
      reason: `verdict head ${parsed.head} does not cover current head ${currentHead}`,
    };
  }
  if (requireApproved && parsed.verdict !== "APPROVED") {
    return { ok: false, verdict: parsed, reason: `verdict is ${parsed.verdict}, not APPROVED` };
  }
  return {
    ok: true,
    verdict: parsed,
    reason: `verdict ${parsed.verdict} round ${parsed.round} head ${parsed.head} covers current head ${currentHead}`,
  };
}

function parseArgs(argv) {
  const options = { requireApproved: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--require-approved") {
      options.requireApproved = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--body" || argument === "--head") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} needs a value`);
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

function readInput(options) {
  if (options.body === undefined || options.head === undefined) {
    throw new Error(USAGE);
  }
  return { body: readFileSync(options.body, "utf8"), head: options.head };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }
  let input;
  try {
    input = readInput(options);
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 2;
    return;
  }
  const result = checkCoverage({ ...input, requireApproved: options.requireApproved });
  if (result.ok) {
    console.log(`PASS ${result.reason}`);
    return;
  }
  console.error(`FAIL ${result.reason}`);
  process.exitCode = 1;
}

function invokedDirectly() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (invokedDirectly()) main();