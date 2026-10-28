import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isPublicTool, shippedScripts, smokeScript } from "../scripts/verify.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const senpi = process.env.SENPI_ROOT ?? join(homedir(), ".bun/install/global/node_modules/@code-yeongyu/senpi");
const { expandPromptTemplate } = await import(`${senpi}/dist/core/prompt-templates.js`);
const { DefaultResourceLoader } = await import(`${senpi}/dist/core/resource-loader.js`);
const { SettingsManager } = await import(`${senpi}/dist/core/settings-manager.js`);
const { loadExtensions } = await import(`${senpi}/dist/core/extensions/loader.js`);
const { ExtensionRunner } = await import(`${senpi}/dist/core/extensions/runner.js`);
const fixtures = [];

afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

function packageCopy() {
  const dir = mkdtempSync(join(tmpdir(), "wish-verify-"));
  fixtures.push(dir);
  for (const entry of ["package.json", "prompts", "extensions", "skills"]) {
    cpSync(join(repo, entry), join(dir, entry), { recursive: true });
  }
  return dir;
}

function verifyRun(root) {
  return spawnSync(process.execPath, [join(repo, "scripts/verify.mjs"), root], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
}

function mjsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return mjsFiles(path);
    return entry.name.endsWith(".mjs") ? [path] : [];
  });
}

async function resources(root = repo) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).pi;
  const paths = (field) => (manifest[field] ?? []).map((entry) => resolve(root, entry));
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: join(root, ".absent-agent"),
    settingsManager: SettingsManager.inMemory(),
    additionalExtensionPaths: [root],
    noContextFiles: true,
  });
  await loader.reload();
  return { templates: loader.getPrompts().prompts, skills: loader.getSkills(), extensionPaths: paths("extensions") };
}

async function runner(root = repo) {
  const { extensionPaths } = await resources(root);
  const loaded = await loadExtensions(extensionPaths, root);
  expect(loaded.errors).toEqual([]);
  const sessionManager = {
    getSessionId: () => "wish-test",
    getBranch: () => [],
    getSessionFile: () => undefined,
    getEntries: () => [],
  };
  return new ExtensionRunner(loaded.extensions, loaded.runtime, root, sessionManager, {}, loaded.eventBus);
}

async function messages(extensionRunner, prompt, options = {}) {
  return (await extensionRunner.emitBeforeAgentStart(prompt, undefined, "", {}, options))?.messages ?? [];
}

test("expanded wish and ordinary whole-word ulw arm generic mode with only the host directive", async () => {
  const { templates } = await resources();
  const symbol = Symbol.for("omo.ultrawork.arming");
  const prior = Object.getOwnPropertyDescriptor(globalThis, symbol);
  const armed = new Set();
  const marks = [];
  try {
    globalThis[symbol] = {
      directive: "DIRECTIVE_SENTINEL",
      arming: {
        isArmed: (id) => armed.has(id),
        markArmed: (id) => { marks.push(id); armed.add(id); },
      },
    };
    const extensionRunner = await runner();
    for (const text of ["ordinary ULW request", expandPromptTemplate("/wish do it", templates)]) {
      armed.clear();
      const first = await messages(extensionRunner, text);
      expect(first).toEqual([{
        customType: "omo-ultrawork:directive",
        content: "DIRECTIVE_SENTINEL",
        display: false,
      }]);
      expect(await messages(extensionRunner, text)).toEqual([]);
    }
    expect(marks).toEqual(["wish-test", "wish-test"]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});

test("package resources discover the available wish skill", async () => {
  const { templates, skills, extensionPaths } = await resources();
  expect(templates.map((template) => template.name)).toContain("wish");
  expect(skills.diagnostics).toEqual([]);
  expect(skills.skills.find((skill) => skill.name === "wish")?.filePath)
    .toBe(join(repo, "skills/wish/SKILL.md"));
  expect(extensionPaths).toEqual([join(repo, "extensions/wish.js")]);
});

test("bare and quoted /wish arguments reach the expanded entry without recursive expansion", async () => {
  const { templates } = await resources();
  const extensionRunner = await runner();
  const bare = expandPromptTemplate("/wish", templates);
  const withArgs = expandPromptTemplate('/wish "keep $ARGUMENTS $1 literal" "x <literal> y"', templates);
  expect(bare.split("\n")[0]).toBe("");
  expect(withArgs.split("\n")[0]).toBe("keep $ARGUMENTS $1 literal x <literal> y");
  for (const text of [bare, withArgs]) {
    expect(text).toContain("Read and follow the `wish` skill");
    expect(text).not.toContain("<!-- omo-wish:entry:v1 -->");
    expect(await messages(extensionRunner, text, { preview: true })).toEqual([]);
    expect(existsSync(join(repo, "skills/wish/SKILL.md"))).toBe(true);
  }
});

test("lookalike words do not activate generic mode", async () => {
  const { templates } = await resources();
  const extensionRunner = await runner();
  const symbol = Symbol.for("omo.ultrawork.arming");
  const prior = Object.getOwnPropertyDescriptor(globalThis, symbol);
  const marks = [];
  try {
    globalThis[symbol] = {
      directive: "DIRECTIVE_SENTINEL",
      arming: {
        isArmed: () => false,
        markArmed: (id) => marks.push(id),
      },
    };
    for (const raw of ["ulworks", "xulw", "ultrawork_ish", "/wishful hello", "/WISH hello"]) {
      const expanded = expandPromptTemplate(raw, templates);
      expect(expanded).toBe(raw);
      expect(await messages(extensionRunner, expanded)).toEqual([]);
    }
    expect(marks).toEqual([]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});

test("real wish entry arms once; preview, unrelated input and pre-armed sessions do not", async () => {
  const { templates } = await resources();
  const text = expandPromptTemplate("/wish again", templates);
  const symbol = Symbol.for("omo.ultrawork.arming");
  const prior = Object.getOwnPropertyDescriptor(globalThis, symbol);
  const marks = [];
  const armed = new Set();
  try {
    globalThis[symbol] = {
      directive: "DIRECTIVE_SENTINEL",
      arming: {
        isArmed: (id) => armed.has(id),
        markArmed: (id) => { marks.push(id); armed.add(id); },
      },
    };
    const first = await runner();
    const preview = await messages(first, text, { preview: true });
    expect(preview).toEqual([]);
    expect(await messages(first, "unrelated input")).toEqual([]);
    expect(marks).toEqual([]);
    armed.add("wish-test");
    const prearmed = await messages(first, text);
    expect(prearmed).toEqual([]);
    expect(marks).toEqual([]);
    armed.delete("wish-test");
    const activation = await messages(first, text);
    expect(activation).toEqual([{
      customType: "omo-ultrawork:directive",
      content: "DIRECTIVE_SENTINEL",
      display: false,
    }]);
    expect(marks).toEqual(["wish-test"]);
    for (const next of [first, await runner()]) {
      expect(await messages(next, text)).toEqual([]);
    }
    expect(marks).toEqual(["wish-test"]);
    expect(globalThis[symbol].directive).toBe("DIRECTIVE_SENTINEL");
    delete globalThis[symbol];
    expect(await messages(first, text)).toEqual([]);
    expect(Object.hasOwn(globalThis, symbol)).toBe(false);
    globalThis[symbol] = { directive: "DIRECTIVE_SENTINEL" };
    expect(await messages(first, text)).toEqual([]);
    expect(marks).toEqual(["wish-test"]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});

test("verify.mjs discovers every shipped script and gives each one a usage line", () => {
  const scripts = shippedScripts(repo);
  const expected = mjsFiles(join(repo, "skills/wish/scripts")).sort();
  expect(scripts).toEqual(expected);
  const names = expected.map((file) => relative(join(repo, "skills/wish/scripts"), file).split(sep).join("/"));
  for (const tool of ["wish.mjs", "check-plan.mjs", "sweep.mjs", "check-verdict.mjs",
    "patch-id.mjs", "reuse-check.mjs", "pr-watch.mjs", "metrics.mjs"]) {
    expect(names).toContain(tool);
  }
  for (const file of scripts) {
    const row = smokeScript(repo, file);
    expect(row.rel.endsWith(".mjs")).toBe(true);
    if (isPublicTool(repo, file)) expect(row.bytes).toBeGreaterThan(0);
  }
}, 120_000);

test("verify.mjs passes on this repository through the real loader", () => {
  const result = verifyRun(repo);
  const output = `${result.stdout}${result.stderr}`;
  expect(output).toContain("ALL PASS");
  expect(result.status).toBe(0);
  expect(output.split("\n").filter((line) => line.startsWith("PASS --help exits 0: ")).length)
    .toBe(shippedScripts(repo).length);
}, 120_000);

test("verify.mjs fails and names a shipped script that does not answer --help", () => {
  const dir = packageCopy();
  writeFileSync(join(dir, "skills/wish/scripts/patch-id.mjs"), "process.exit(1);\n");
  const result = verifyRun(dir);
  const output = `${result.stdout}${result.stderr}`;
  expect(result.status).not.toBe(0);
  expect(output).toContain("skills/wish/scripts/patch-id.mjs --help failed");
}, 120_000);

test("verify.mjs fails and names a skill file the loader cannot find", () => {
  const dir = packageCopy();
  rmSync(join(dir, "skills/wish/SKILL.md"));
  const result = verifyRun(dir);
  const output = `${result.stdout}${result.stderr}`;
  expect(result.status).not.toBe(0);
  expect(output).toContain("skill file is missing");
  expect(output).toContain("skills/wish/SKILL.md");
}, 120_000);

test("an installation path with spaces, quotes, #, and Unicode discovers skill and activates generic mode", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wish "quoted" # 한글 '));
  fixtures.push(dir);
  cpSync(join(repo, "package.json"), join(dir, "package.json"));
  cpSync(join(repo, "prompts"), join(dir, "prompts"), { recursive: true });
  cpSync(join(repo, "extensions"), join(dir, "extensions"), { recursive: true });
  cpSync(join(repo, "skills/wish"), join(dir, "skills/wish"), { recursive: true });
  const { templates, skills } = await resources(dir);
  const actualSkillPath = join(dir, "skills/wish/SKILL.md");
  expect(skills.diagnostics).toEqual([]);
  expect(skills.skills.find((skill) => skill.name === "wish")?.filePath).toBe(actualSkillPath);
  expect(existsSync(actualSkillPath)).toBe(true);
  const symbol = Symbol.for("omo.ultrawork.arming");
  const prior = Object.getOwnPropertyDescriptor(globalThis, symbol);
  const marks = [];
  try {
    globalThis[symbol] = {
      directive: "DIRECTIVE_SENTINEL",
      arming: {
        isArmed: () => false,
        markArmed: (id) => marks.push(id),
      },
    };
    expect(await messages(await runner(dir), expandPromptTemplate("/wish moved", templates))).toEqual([{
      customType: "omo-ultrawork:directive",
      content: "DIRECTIVE_SENTINEL",
      display: false,
    }]);
    expect(marks).toEqual(["wish-test"]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});
