#!/usr/bin/env bun
// wish v2 — module M7: watch one pull request and print NDJSON state lines.
//
// A helper an omo session runs as a `monitor` command: one JSON object per
// line, one line per observation, READY | WAITING | BLOCKED | MERGED | CLOSED.
// The wait between polls follows poteto-mode's query backoff
// (`min(max(interval, 60) * 2^(attempt - 1), maxInterval)`, policy.ts:266-269)
// and resets when the observed state changes.
//
// The script is a helper, never an omo role: the session decides, the monitor
// watches. `gh` is the only external command and every argv reaches it as an
// array (`shell: false`), so no caller value is ever word-split or expanded.

import { spawn } from "node:child_process";

export const STATES = Object.freeze(["READY", "WAITING", "BLOCKED", "MERGED", "CLOSED"]);
export const REASONS = Object.freeze([
  "ready", "draft", "conflict", "checks-failing", "checks-pending", "changes-requested",
  "review-required", "behind", "merge-state-unknown", "blocked", "merged", "closed",
  "unknown-state", "query-failed",
]);
export const GH_FIELDS = "number,url,state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,headRefOid";
export const DEFAULTS = Object.freeze({
  until: "merged", interval: 60, maxInterval: 300, maxFailures: 5,
  timeoutMs: 60000, tokenEnv: "GH_TOKEN,GITHUB_TOKEN", gh: "gh", repo: null, pr: null,
});
const USAGE = `pr-watch.mjs — watch one pull request and print NDJSON state lines

Usage:
  bun pr-watch.mjs --pr <n> --repo <owner/name> [options]

Options:
  --pr <n>              pull request number (required)
  --repo <owner/name>   repository (required)
  --until ready|merged  stop at this state (default merged)
  --once                one poll, then exit
  --all                 print every poll, not only when the state changes
  --interval <s>        base poll interval in seconds; values below 60 are
                        raised to 60 (default 60)
  --max-interval <s>    backoff cap, at least 60 (default 300)
  --max-failures <n>    consecutive poll failures before exit 1 (default 5)
  --gh <path>           gh executable (default gh)
  --timeout <ms>        one gh call in milliseconds (default 60000)
  --token-env <names>   comma-separated env vars whose values are redacted
                        (default GH_TOKEN,GITHUB_TOKEN)
  --help                print this help

States: ${STATES.join(" ")}
Reasons: ${REASONS.join(" ")}
Exit: 0 ok or the requested terminal state · 1 check failed (CLOSED, failures,
      a different terminal state) · 2 usage · 3 state mismatch (auth, missing PR)
      130 interrupted (SIGINT/SIGTERM; no line is printed for the abort)
`;

const FAILED_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
const PASSED_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const OUTPUT_CAP = 1024 * 1024;

export function backoffSeconds(interval, attempt = 1, maxInterval = 300) {
  const base = Number.isFinite(interval) && interval > 0 ? Math.max(interval, 60) : 60;
  const cap = Number.isFinite(maxInterval) && maxInterval >= 60 ? maxInterval : 300;
  const step = Number.isInteger(attempt) && attempt >= 1 ? attempt : 1;
  return Math.min(Math.round(base * 2 ** (step - 1)), Math.max(cap, 60));
}

export function tokenValues(env = {}, names = DEFAULTS.tokenEnv) {
  return String(names ?? "").split(",").map((name) => name.trim()).filter(Boolean)
    .map((name) => env[name])
    .filter((value) => typeof value === "string" && value.length > 0);
}

export function redactSecrets(text, secrets = []) {
  let out = String(text ?? "");
  const values = [...new Set(secrets.filter((value) => typeof value === "string" && value !== ""))]
    .sort((left, right) => right.length - left.length);
  for (const value of values) out = out.split(value).join("[redacted]");
  return out
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted]")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted]");
}

function checkKind(item) {
  if (!item || typeof item !== "object") return "pending";
  const conclusion = String(item.conclusion ?? item.state ?? "").toUpperCase();
  const status = String(item.status ?? "").toUpperCase();
  if (FAILED_CONCLUSIONS.has(conclusion)) return "failed";
  if (PASSED_CONCLUSIONS.has(conclusion)) return "passed";
  if (status === "COMPLETED" && PASSED_CONCLUSIONS.has(conclusion)) return "passed";
  return "pending";
}

// Unknown shapes are never READY: a check whose state cannot be read counts as
// pending (R4), and an unreadable rollup does the same.
export function classifyPr(view) {
  const empty = { total: 0, failing: 0, pending: 0 };
  if (!view || typeof view !== "object" || Array.isArray(view)) {
    return { state: "BLOCKED", reasons: ["query-failed"], checks: empty, head: null };
  }
  const head = typeof view.headRefOid === "string" ? view.headRefOid : null;
  const rollup = view.statusCheckRollup;
  const checks = { ...empty };
  let malformed = false;
  if (Array.isArray(rollup)) {
    checks.total = rollup.length;
    for (const item of rollup) {
      const kind = checkKind(item);
      if (kind === "failed") checks.failing += 1;
      if (kind === "pending") checks.pending += 1;
    }
  } else if (rollup !== null && rollup !== undefined) {
    malformed = true;
  }
  const state = String(view.state ?? "").toUpperCase();
  if (state === "MERGED") return { state: "MERGED", reasons: ["merged"], checks, head };
  if (state === "CLOSED") return { state: "CLOSED", reasons: ["closed"], checks, head };
  if (state !== "OPEN") return { state: "BLOCKED", reasons: ["unknown-state"], checks, head };
  if (view.isDraft === true) return { state: "WAITING", reasons: ["draft"], checks, head };
  const mergeable = String(view.mergeable ?? "").toUpperCase();
  const mergeState = String(view.mergeStateStatus ?? "").toUpperCase();
  const review = String(view.reviewDecision ?? "").toUpperCase();
  if (mergeable === "CONFLICTING" || mergeState === "DIRTY") {
    return { state: "BLOCKED", reasons: ["conflict"], checks, head };
  }
  if (checks.failing > 0) return { state: "BLOCKED", reasons: ["checks-failing"], checks, head };
  if (review === "CHANGES_REQUESTED") {
    return { state: "BLOCKED", reasons: ["changes-requested"], checks, head };
  }
  const waiting = [];
  if (checks.pending > 0 || malformed) waiting.push("checks-pending");
  if (review === "REVIEW_REQUIRED") waiting.push("review-required");
  if (mergeState === "BEHIND") waiting.push("behind");
  if (mergeState === "UNSTABLE") waiting.push("checks-pending");
  if (mergeState === "UNKNOWN") waiting.push("merge-state-unknown");
  if (waiting.length > 0) return { state: "WAITING", reasons: [...new Set(waiting)], checks, head };
  if (mergeState === "BLOCKED") return { state: "BLOCKED", reasons: ["blocked"], checks, head };
  if (mergeState === "") return { state: "WAITING", reasons: ["merge-state-unknown"], checks, head };
  return { state: "READY", reasons: ["ready"], checks, head };
}

export function observation({ seq, at, pr, repo, classification, nextPollS = null, error = null }) {
  return {
    seq, at, pr, repo, state: classification.state, reasons: classification.reasons,
    head: classification.head, checks: classification.checks, next_poll_s: nextPollS, error,
  };
}

export function formatLine(record) {
  return `${JSON.stringify(record)}\n`;
}

// Redaction runs over the record's string values, never over the serialised
// line, so a token that happens to equal a field name cannot break the shape a
// monitor reads.
export function sanitizeRecord(record, sanitize) {
  const walk = (value) => {
    if (typeof value === "string") return sanitize(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, walk(entry)]));
    }
    return value;
  };
  return walk(record);
}

function abortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

export function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const AUTH_TEXT = /authentication|not logged in|gh auth login|HTTP 401|Could not resolve to a (?:Repository|PullRequest)|no pull requests found/i;

export async function runGh({ gh = "gh", args = [], signal, timeoutMs = DEFAULTS.timeoutMs, sanitize = (text) => text }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(gh, args, { shell: false, stdio: ["ignore", "pipe", "pipe"], signal });
    } catch (error) {
      resolve({ ok: false, fatal: true, error: sanitize(String(error?.message ?? error)) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      finish({ ok: false, error: sanitize(`gh timed out after ${timeoutMs}ms`), timeout: true });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(0, OUTPUT_CAP); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(0, OUTPUT_CAP); });
    child.on("error", (error) => {
      const text = sanitize(String(error?.message ?? error));
      finish({ ok: false, fatal: error?.code === "ENOENT", error: text });
    });
    child.on("close", (code) => {
      const combined = `${stdout}\n${stderr}`;
      if (code !== 0) {
        const error = sanitize(stderr.trim() || stdout.trim() || `gh exited with ${code}`);
        finish({ ok: false, code, error, fatal: AUTH_TEXT.test(combined) });
        return;
      }
      try {
        const view = JSON.parse(stdout);
        if (!view || typeof view !== "object" || Array.isArray(view) || typeof view.state !== "string") {
          finish({ ok: false, error: sanitize("gh returned an unexpected shape"), malformed: true });
          return;
        }
        finish({ ok: true, view });
      } catch {
        finish({ ok: false, error: sanitize("gh returned malformed JSON"), malformed: true });
      }
    });
  });
}

export async function watch({ query, emit, now = () => new Date().toISOString(), sleep = defaultSleep, sanitize = (text) => text, options, signal }) {
  const { pr, repo, interval, maxInterval, maxFailures, until, all, once } = options;
  let seq = 0;
  let attempt = 1;
  let failures = 0;
  let lastKey = null;
  for (;;) {
    if (signal?.aborted) throw abortError();
    let result;
    try {
      result = await query();
    } catch (error) {
      result = { ok: false, error: String(error?.message ?? error) };
    }
    const at = now();
    if (signal?.aborted) throw abortError();
    if (!result || result.ok !== true) {
      failures += 1;
      // `--once` is one poll: a failed poll reports and exits instead of retrying.
      const exhausted = result?.fatal === true || failures >= maxFailures || once;
      const classification = { state: "BLOCKED", reasons: ["query-failed"], checks: { total: 0, failing: 0, pending: 0 }, head: null };
      const nextPollS = exhausted ? null : backoffSeconds(interval, failures, maxInterval);
      seq += 1;
      if (exhausted || all || lastKey !== "BLOCKED/query-failed") {
        emit(observation({ seq, at, pr, repo, classification, nextPollS, error: sanitize(result?.error ?? "gh failed") }));
      }
      lastKey = "BLOCKED/query-failed";
      if (exhausted) return result?.fatal === true ? 3 : 1;
      await sleep(nextPollS * 1000, signal);
      continue;
    }
    failures = 0;
    const classification = classifyPr(result.view);
    const key = `${classification.state}/${[...classification.reasons].sort().join(",")}`;
    const changed = key !== lastKey;
    attempt = changed ? 1 : attempt + 1;
    const terminal = classification.state === "CLOSED"
      || (until === "merged" && classification.state === "MERGED")
      || (until === "ready" && (classification.state === "READY" || classification.state === "MERGED"));
    const nextPollS = terminal ? null : backoffSeconds(interval, attempt, maxInterval);
    seq += 1;
    if (changed || all || terminal) {
      emit(observation({ seq, at, pr, repo, classification, nextPollS, error: null }));
    }
    lastKey = key;
    if (terminal) {
      if (classification.state === "CLOSED") return 1;
      if (classification.state === "MERGED" && until === "ready") return 1;
      return 0;
    }
    if (once) return 0;
    await sleep(nextPollS * 1000, signal);
  }
}

function positiveInt(value, name, min, errors) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) errors.push(`${name} must be an integer >= ${min}`);
  return number;
}

export function parseArgs(argv = []) {
  const options = { ...DEFAULTS, all: false, once: false, help: false };
  const errors = [];
  const known = new Set(["--pr", "--repo", "--gh", "--until", "--interval", "--max-interval", "--max-failures", "--timeout", "--token-env"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") { options.help = true; continue; }
    if (arg === "--all") { options.all = true; continue; }
    if (arg === "--once") { options.once = true; continue; }
    if (!known.has(arg)) { errors.push(`unknown option: ${arg}`); continue; }
    const value = argv[index + 1];
    if (value === undefined) { errors.push(`missing value for ${arg}`); continue; }
    index += 1;
    if (arg === "--pr") options.pr = positiveInt(value, "--pr", 1, errors);
    else if (arg === "--repo") options.repo = value;
    else if (arg === "--gh") options.gh = value;
    else if (arg === "--until") options.until = value;
    else if (arg === "--interval") options.interval = positiveInt(value, "--interval", 1, errors);
    else if (arg === "--max-interval") options.maxInterval = positiveInt(value, "--max-interval", 60, errors);
    else if (arg === "--max-failures") options.maxFailures = positiveInt(value, "--max-failures", 1, errors);
    else if (arg === "--timeout") options.timeoutMs = positiveInt(value, "--timeout", 1, errors);
    else if (arg === "--token-env") options.tokenEnv = value;
  }
  if (!options.help) {
    if (!Number.isInteger(options.pr)) errors.push("--pr is required");
    if (!options.repo) errors.push("--repo is required");
    else if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo)) errors.push("--repo must be owner/name");
    if (!["ready", "merged"].includes(options.until)) errors.push("--until must be ready or merged");
    if (!/^[^\0\n]+$/.test(String(options.gh ?? ""))) errors.push("--gh must be a plain path");
  }
  return { ok: errors.length === 0, options, errors, usage: USAGE };
}

const VALUE_OPTIONS = new Set([
  "--pr", "--repo", "--gh", "--until", "--interval", "--max-interval", "--max-failures", "--timeout", "--token-env",
]);

function tokenEnvFromArgv(argv) {
  let names = DEFAULTS.tokenEnv;
  // The scan mirrors parseArgs: a known option consumes its value, so a value
  // that happens to read `--token-env` is data, not another option.
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!VALUE_OPTIONS.has(arg)) continue;
    const value = argv[index + 1];
    if (value === undefined) break;
    if (arg === "--token-env") names = value;
    index += 1;
  }
  return names;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const env = deps.env ?? process.env;
  // The token names are read from argv before parsing, so a usage error cannot
  // echo a value that the parsed options would have redacted.
  const earlySecrets = tokenValues(env, tokenEnvFromArgv(argv));
  const earlySanitize = (text) => redactSecrets(text, earlySecrets);
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(earlySanitize(`pr-watch: ${parsed.errors.join("; ")}\n${USAGE}`));
    return 2;
  }
  if (parsed.options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const options = parsed.options;
  const secrets = tokenValues(env, options.tokenEnv);
  const sanitize = (text) => redactSecrets(text, secrets);
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const chrome = deps.watch ?? watch;
  const args = ["pr", "view", String(options.pr), "--repo", options.repo, "--json", GH_FIELDS];
  try {
    return await chrome({
      query: () => (deps.query ? deps.query() : runGh({ gh: options.gh, args, signal: controller.signal, timeoutMs: options.timeoutMs, sanitize })),
      emit: (record) => process.stdout.write(formatLine(sanitizeRecord(record, sanitize))),
      now: deps.now,
      sleep: deps.sleep,
      sanitize,
      options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") return 130;
    process.stderr.write(`pr-watch: ${sanitize(String(error?.message ?? error))}\n`);
    return 1;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

if (import.meta.main === true) {
  main().then((code) => process.exit(code));
}