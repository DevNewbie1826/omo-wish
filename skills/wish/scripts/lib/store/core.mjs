import { closeSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";

// --------------------------------------------------------------------- errors

// One class for every refusal: `code` is the §14 exit code, so the CLI never
// invents one. 0 ok, 1 check failed, 2 usage, 3 state mismatch.
export class WishError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = "WishError";
    this.code = code;
    this.details = details;
  }
}

export const usage = (message, details = []) => new WishError(2, message, details);
export const checkFailed = (message, details = []) => new WishError(1, message, details);
export const stateMismatch = (message, details = []) => new WishError(3, message, details);

export function formatErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return "";
  return errors.map((entry) => `${entry.path}: ${entry.message}`).join("; ");
}

// -------------------------------------------------------------- file plumbing

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

export function readTextOrNull(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw stateMismatch(`cannot read ${file}: ${error?.code ?? error?.message ?? error}`);
  }
}

// Write-then-rename in the same directory: a reader never sees a half file, and
// a crash leaves either the old file or the new one (ledger.md §1 one writer).
export function atomicWrite(file, text) {
  ensureDir(dirname(file));
  const tmp = join(dirname(file), `.${basename(file)}.tmp.${process.pid}.${Date.now()}`);
  writeSyncFile(tmp, text);
  renameSync(tmp, file);
}

function writeSyncFile(file, text) {
  const fd = openSync(file, "w");
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
}

function basename(file) {
  const parts = String(file).split(/[\\/]/);
  return parts[parts.length - 1];
}

// ---------------------------------------------------------------------- paths

// ledger.md §1: `<ER>` plus its files, the transient `lock.queue/` that serializes
// writers, and the `receipts/` and `rounds/` evidence directories.
export function rootPaths(root) {
  const dir = resolvePath(root);
  return {
    root: dir,
    ledger: join(dir, "ledger.jsonl"),
    findings: join(dir, "findings.tsv"),
    gaps: join(dir, "gaps.tsv"),
    gates: join(dir, "gates.md"),
    lens: join(dir, "lens.md"),
    ideal: join(dir, "ideal.md"),
    resume: join(dir, "resume.md"),
    receipts: join(dir, "receipts"),
    rounds: join(dir, "rounds"),
    lock: join(dir, "lock"),
    queue: join(dir, "lock.queue"),
  };
}


export { basename, writeSyncFile };
