import { usage } from "../lib/store.mjs";
import { join } from "node:path";

function parseArgs(argv, spec) {
  const values = new Map();
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg : arg.slice(0, eq);
      if (name === "--help" || name === "-h") {
        values.set("--help", true);
        continue;
      }
      const entry = spec[name];
      if (!entry) throw usage(`unknown flag ${name}`);
      if (entry.kind === "bool") {
        if (eq !== -1) throw usage(`${name} takes no value`);
        values.set(name, true);
        continue;
      }
      let value;
      if (eq !== -1) value = arg.slice(eq + 1);
      else {
        value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) throw usage(`${name} needs a value`);
        index += 1;
      }
      if (entry.repeat) values.set(name, [...(values.get(name) ?? []), value]);
      else {
        if (values.has(name)) throw usage(`${name} given twice`);
        values.set(name, value);
      }
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, get: (name) => values.get(name), has: (name) => values.has(name) };
}

const COMMENT_FLAGS = {
  "--root": { kind: "value" },
  "--plan": { kind: "value" },
  "--session": { kind: "value" },
  "--json": { kind: "bool" },
};
const SHARED_VALUE_FLAGS = new Set(Object.keys(COMMENT_FLAGS).filter((name) => COMMENT_FLAGS[name].kind === "value"));

function expectPositional(parsed, allowed, label) {
  const [command, ...rest] = parsed.positionals;
  if (command === undefined) throw usage(`${label}: missing subcommand (${allowed.join(", ")})`);
  if (!allowed.includes(command)) throw usage(`${label}: unknown subcommand ${command} (${allowed.join(", ")})`);
  if (rest.length > 0) throw usage(`${label}: unexpected argument ${rest[0]}`);
  return command;
}

// One root resolution for every verb, including the delegated one: `--root` first, then

export { COMMENT_FLAGS, SHARED_VALUE_FLAGS, expectPositional, parseArgs };
