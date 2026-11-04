#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./cli/dispatch.mjs";
import { killAllGroups } from "./cli/gate-process.mjs";

export { run };

const invokedDirectly = typeof import.meta.main === "boolean"
  ? import.meta.main
  : isDirectInvocation();

// Under node, comparing raw paths misses a symlinked entry point (and
// `--preserve-symlinks-main` flips which side is unresolved), so both sides are
// resolved to their real path: a symlinked CLI must still run its verbs.
function isDirectInvocation() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return resolve(entry) === self;
  }
}

if (invokedDirectly) {
  // A cancelled CLI must not leave a reproduction running: the children are detached
  // into their own process groups, so the group has to be killed on the way out.
  // Only the CLI itself installs this: an importer's signals are not ours to handle.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      killAllGroups();
      process.exit(130);
    });
  }
  const outcome = run(process.argv.slice(2));
  if (outcome && typeof outcome.then === "function") {
    outcome.then((code) => {
      process.exitCode = code;
    });
  } else {
    process.exitCode = typeof outcome === "number" ? outcome : 0;
  }
}
