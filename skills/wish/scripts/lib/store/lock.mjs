import { readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { stateMismatch, nowIso, ensureDir, rootPaths } from "./core.mjs";

// ----------------------------------------------------------------------- lock

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM"; // exists, owned by someone else
  }
}

// A bounded, synchronous wait: the CLI is a one-shot process, so blocking here
// costs nothing and keeps the lock protocol synchronous (no timers, no events).
function sleepSync(ms) {
  const cell = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(cell, 0, 0, ms);
}

// ledger.md §1 write authority: one mutating verb at a time across processes.
//
// A pid file plus takeover has a window that no amount of care closes: two
// processes can both see a stale owner, both remove it, and both believe they hold
// the lock, after which one whole-file write silently erases the other's row. So the
// exclusion is a queue instead of a takeover. Each contender writes a ticket named
// by a strictly increasing number, and enters only when its ticket is the smallest
// present. Nobody ever removes a live peer's ticket, so there is no moment at which
// two contenders can both be the smallest.
//
// A contender killed while holding leaves its ticket behind; the next contender
// removes tickets whose pid is dead, which is idempotent and race-free (removing a
// dead peer's file cannot create a second owner). The one hazard left is pid reuse
// making a dead holder look alive: that stalls the run at the acquire deadline with
// a state error and loses nothing, which is the safe direction.
class FileLock {
  constructor(root) {
    this.paths = rootPaths(root);
    this.queueDir = this.paths.queue;
    this.id = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    this.ticket = null;
    this.held = false;
  }

  entryName(ticket) {
    return `${String(ticket).padStart(12, "0")}-${this.id}.ticket`;
  }

  acquire({ waitMs = 2000, pollMs = 10 } = {}) {
    ensureDir(this.paths.root);
    ensureDir(this.queueDir);
    const deadline = Date.now() + waitMs;
    const choosing = `${this.queueDir}/${this.id}.choosing`;
    writeFileSync(choosing, JSON.stringify({ pid: process.pid, started_at: nowIso() }));
    try {
      // Publish at once: waiting here would let two choosers wait on each other.
      // A chooser that is still outstanding is handled at entry time instead, which
      // is the rule that keeps a descheduled contender from being leapfrogged.
      const open = this.list();
      const max = open.reduce((top, entry) => (entry.ticket > top ? entry.ticket : top), 0);
      this.ticket = max + 1;
      writeFileSync(`${this.queueDir}/${this.entryName(this.ticket)}`,
        JSON.stringify({ pid: process.pid, started_at: nowIso() }));
    } finally {
      rmQuiet(choosing);
    }
    const mine = { ticket: this.ticket, id: this.id };
    for (;;) {
      this.sweep();
      const ahead = this.choosers().length > 0 || this.list().some((entry) => entry.ticket < mine.ticket
        || (entry.ticket === mine.ticket && entry.id < mine.id));
      if (!ahead) {
        // A contender that started reading while we were writing our ticket could
        // hold the same number; one settle read orders the two before we enter.
        sleepSync(2);
        const again = this.choosers().length > 0 || this.list().some((entry) => entry.ticket < mine.ticket
          || (entry.ticket === mine.ticket && entry.id < mine.id));
        if (!again) {
          this.held = true;
          return this;
        }
      }
      if (Date.now() >= deadline) {
        this.release();
        throw stateMismatch(`cannot lock ${this.paths.root}: still queued after ${waitMs}ms`);
      }
      sleepSync(pollMs);
    }
  }

  list() {
    let names;
    try {
      names = readdirSync(this.queueDir);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      // An unreadable queue is not an empty one: guessing here would let two
      // contenders both believe they are alone.
      throw stateMismatch(`cannot read ${this.queueDir}: ${error?.code ?? error}`);
    }
    const entries = [];
    for (const name of names) {
      const match = /^(\d{12})-([0-9]+-[a-z0-9]+)\.ticket$/.exec(name);
      if (!match) continue;
      entries.push({ ticket: Number(match[1]), id: match[2], name });
    }
    return entries.sort((left, right) => left.ticket - right.ticket || (left.id < right.id ? -1 : 1));
  }

  choosers() {
    let names;
    try {
      names = readdirSync(this.queueDir);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw stateMismatch(`cannot read ${this.queueDir}: ${error?.code ?? error}`);
    }
    const live = [];
    for (const name of names) {
      const match = /^([0-9]+)-[a-z0-9]+\.choosing$/.exec(name);
      if (!match) continue;
      if (name === `${this.id}.choosing`) continue;
      const pid = Number(match[1]);
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
      if (pidAlive(pid)) live.push(name);
    }
    return live;
  }

  // Only a dead contender's files are removed, so a live holder's ticket can never
  // be taken away by a peer.
  sweep() {
    let names;
    try {
      names = readdirSync(this.queueDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === `${this.id}.choosing` || name === this.entryName(this.ticket ?? 0)) continue;
      const match = /^(?:\d{12})?-?([0-9]+)-[a-z0-9]+\.(?:ticket|choosing)$/.exec(name);
      if (!match) continue;
      const pid = Number(match[1]);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      if (pid === process.pid) continue;
      if (pidAlive(pid)) continue;
      rmQuiet(`${this.queueDir}/${name}`);
    }
  }

  release() {
    if (!this.held) {
      if (this.ticket !== null) rmQuiet(`${this.queueDir}/${this.entryName(this.ticket)}`);
      this.ticket = null;
      return;
    }
    this.held = false;
    rmQuiet(`${this.queueDir}/${this.entryName(this.ticket)}`);
    this.ticket = null;
  }
}

function rmQuiet(path) {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}

export function withLock(root, fn, options = {}) {
  const lock = new FileLock(root).acquire(options);
  try {
    return fn();
  } finally {
    lock.release();
  }
}

export { sleepSync };
