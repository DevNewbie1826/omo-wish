// The probe registry, in the order the receipt reports them.
//
// Each module owns one measured defect class, exports its name, the work types
// it applies to, its config shape, and `run(config, ctx)`, and is runnable on
// its own (`--help`). The runner imports this list and nothing else, so adding a
// class is one new module plus one line here.

import * as secrets from "./secrets.mjs";
import * as boundary from "./boundary.mjs";
import * as race from "./race.mjs";
import * as lifecycle from "./lifecycle.mjs";
import * as errors from "./errors.mjs";
import * as mutation from "./mutation.mjs";
import * as docs from "./docs.mjs";
import * as config from "./config.mjs";
import * as draftGuard from "./draft-guard.mjs";

export const PROBES = [secrets, boundary, race, lifecycle, errors, mutation, docs, config, draftGuard];

export const PROBE_NAMES = PROBES.map((probe) => probe.name);