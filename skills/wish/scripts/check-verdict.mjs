#!/usr/bin/env node
// wish v2 — module M4: does the final review's VERDICT line cover the frozen head?
//
// The pattern, the parser semantics (CRLF-normalized, last non-empty line, trailing
// whitespace trimmed, head lowercased) and the reason strings are M0's, carried
// verbatim from PR #44: `scripts/lib/schema.mjs` exports them so no copy of the
// pattern can drift from `references/ledger.md` §12. This file is only the command
// the session runs before merging.
//
// Exit codes (`references/ledger.md` §14): 0 the verdict covers the head, 1 it does
// not, 2 usage. `--help` exits 0.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXIT_CODES, checkVerdictCoverage } from "./lib/schema.mjs";

const USAGE = "usage: check-verdict.mjs --body <file> --head <full-40-hex-sha> [--require-approved] [--help]";

export function parseArgs(argv) {
  const options = { requireApproved: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--require-approved") {
      options.requireApproved = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--body" || argument === "--head") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} needs a value`);
      if (value.startsWith("-")) throw new Error(`${argument} needs a value, not the flag ${value}`);
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

function readBody(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    // The code alone: a host message may carry paths or text the caller never asked to print.
    throw new Error(`cannot read the body file: ${error.code ?? "read failed"}`);
  }
}

export function checkVerdictFile({ bodyPath, head, requireApproved = false }) {
  const body = readBody(bodyPath);
  return checkVerdictCoverage({ body, head, requireApproved });
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    return EXIT_CODES.USAGE;
  }
  if (options.help) {
    console.log(USAGE);
    return EXIT_CODES.OK;
  }
  if (options.body === undefined || options.head === undefined) {
    console.error(`FAIL ${USAGE}`);
    return EXIT_CODES.USAGE;
  }
  let result;
  try {
    result = checkVerdictFile({
      bodyPath: options.body,
      head: options.head,
      requireApproved: options.requireApproved,
    });
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    return EXIT_CODES.USAGE;
  }
  if (result.ok) {
    console.log(`PASS ${result.reason}`);
    return EXIT_CODES.OK;
  }
  console.error(`FAIL ${result.reason}`);
  return EXIT_CODES.CHECK_FAILED;
}

function invokedDirectly() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (invokedDirectly()) process.exitCode = main(process.argv.slice(2));