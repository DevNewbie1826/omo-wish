import { CLI_VERBS, EXIT_CODES } from "../lib/schema.mjs";
import { WishError, usage } from "../lib/store.mjs";
import { printUsage, printVerbUsage } from "./usage.mjs";
import { parseArgs, COMMENT_FLAGS, SHARED_VALUE_FLAGS } from "./args.mjs";
import { resolveRoot } from "./context.mjs";
import { verbInit } from "./init.mjs";
import { verbStatus, verbLedger } from "./status-ledger.mjs";
import { verbFindings, verbGaps, verbGate } from "./findings-gaps-gate.mjs";
import { verbFreeze } from "./freeze.mjs";
import { verbPrBody } from "./pr-body.mjs";
import { verbSwitch, verbResumePlan } from "./switch-resume.mjs";

const SPECS = {
  init: {
    ...COMMENT_FLAGS,
    "--run-id": { kind: "value" },
    "--type": { kind: "value" },
    "--tier": { kind: "value" },
    "--program": { kind: "value" },
    "--unit": { kind: "value" },
    "--worktree": { kind: "value" },
    "--branch": { kind: "value" },
    "--primary": { kind: "value" },
    "--secondary": { kind: "value" },
    "--fact": { kind: "value", repeat: true },
  },
  status: { ...COMMENT_FLAGS, "--progress": { kind: "bool" }, "--head": { kind: "value" } },
  // ledger reads its event body from a file or stdin, so --json is a value here
  // even though every other verb uses it as a boolean.
  ledger: { ...COMMENT_FLAGS, "--json": { kind: "value" }, "--event": { kind: "value" } },
  findings: {
    ...COMMENT_FLAGS,
    "--tsv": { kind: "value" },
    "--id": { kind: "value" },
    "--status": { kind: "value" },
    "--fixed-head": { kind: "value" },
    "--blocking": { kind: "value" },
  },
  gaps: {
    ...COMMENT_FLAGS,
    "--tsv": { kind: "value" },
    "--id": { kind: "value" },
    "--status": { kind: "value" },
    "--pr": { kind: "value" },
    "--fixed-head": { kind: "value" },
    "--before-artifact": { kind: "value" },
  },
  gate: {
    ...COMMENT_FLAGS,
    "--round": { kind: "value" },
    "--id": { kind: "value" },
    "--question": { kind: "value" },
    "--options": { kind: "value" },
    "--default": { kind: "value" },
    "--answer": { kind: "value" },
    "--head": { kind: "value" },
    "--timeout": { kind: "value" },
    "--dry-run": { kind: "bool" },
  },
  freeze: { ...COMMENT_FLAGS, "--head": { kind: "value" }, "--pr": { kind: "value" }, "--check": { kind: "bool" } },
  "pr-body": { ...COMMENT_FLAGS, "--pr": { kind: "value" }, "--out": { kind: "value" } },
  switch: {
    ...COMMENT_FLAGS,
    "--round": { kind: "value" },
    "--kind": { kind: "value" },
    "--premise": { kind: "value" },
    "--new-approach": { kind: "value" },
  },
  "resume-plan": { ...COMMENT_FLAGS },
};

const HANDLERS = {
  init: verbInit,
  status: verbStatus,
  ledger: verbLedger,
  findings: verbFindings,
  gaps: verbGaps,
  gate: verbGate,
  freeze: verbFreeze,
  "pr-body": verbPrBody,
  switch: verbSwitch,
  "resume-plan": verbResumePlan,
};

export function run(argv) {
  try {
    const peeled = [];
    let i = 0;
    while (i < argv.length && SHARED_VALUE_FLAGS.has(argv[i].split("=")[0])) {
      const one = argv[i].includes("=");
      if (!one && argv[i + 1] === undefined) break;
      const take = one ? 1 : 2;
      peeled.push(...argv.slice(i, i + take));
      i += take;
    }
    const [verb, ...rest] = argv.slice(i);
    if (verb === undefined && peeled.length) throw usage(`unknown verb ${peeled[0].split("=")[0]}`);
    if (verb === undefined || verb === "help" || verb === "-h" || verb === "--help") {
      printUsage();
      return 0;
    }
    if (!CLI_VERBS.includes(verb)) throw usage(`unknown verb ${verb}`);
    if (rest.includes("--help") || rest.includes("-h")) {
      printVerbUsage(verb);
      return 0;
    }
    const handler = HANDLERS[verb];
    if (!handler) throw usage(`unknown verb ${verb}`);
    const parsed = parseArgs([...peeled, ...rest], SPECS[verb]);
    if (parsed.has("--help")) {
      printVerbUsage(verb);
      return 0;
    }
    const root = resolveRoot(parsed);
    const result = handler(parsed, root);
    if (result && typeof result.then === "function") {
      return result.then(() => EXIT_CODES.OK).catch(handleFailure);
    }
    return EXIT_CODES.OK;
  } catch (error) {
    return handleFailure(error);
  }
}

function handleFailure(error) {
  if (error instanceof WishError) {
    process.stderr.write(`wish: ${error.message}\n`);
    for (const detail of error.details.slice(0, 20)) {
      process.stderr.write(`  ${detail.path}: ${detail.message}\n`);
    }
    if (error.details.length > 20) process.stderr.write(`  ... ${error.details.length - 20} more\n`);
    return error.code;
  }
  process.stderr.write(`wish: internal error: ${error?.message ?? error}\n`);
  if (process.env.WISH_DEBUG === "1" && error?.stack) process.stderr.write(`${error.stack}\n`);
  return EXIT_CODES.CHECK_FAILED;
}

// A cancelled CLI must not leave a reproduction running: the children are detached
// into their own process groups, so the group has to be killed on the way out.
