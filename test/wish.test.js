import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const senpi = process.env.SENPI_ROOT ?? join(homedir(), ".bun/install/global/node_modules/@code-yeongyu/senpi");
const { loadPromptTemplates, expandPromptTemplate } = await import(`${senpi}/dist/core/prompt-templates.js`);
const { loadSkills } = await import(`${senpi}/dist/core/skills.js`);
const { loadExtensions } = await import(`${senpi}/dist/core/extensions/loader.js`);
const { ExtensionRunner } = await import(`${senpi}/dist/core/extensions/runner.js`);
const fixtures = [];

afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

function resources(root = repo) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).pi;
  const paths = (field) => (manifest[field] ?? []).map((entry) => resolve(root, entry));
  const templates = loadPromptTemplates({
    cwd: root, agentDir: join(root, ".absent-agent"), promptPaths: paths("prompts"), includeDefaults: false,
  });
  const skills = loadSkills({
    cwd: root, agentDir: join(root, ".absent-agent"), skillPaths: paths("skills"), includeDefaults: false,
  });
  return { templates, skills, extensionPaths: paths("extensions") };
}

async function runner(root = repo) {
  const { extensionPaths } = resources(root);
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
  const { templates } = resources();
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

test("package resources discover the available wish skill", () => {
  const { templates, skills, extensionPaths } = resources();
  expect(templates.map((template) => template.name)).toContain("wish");
  expect(skills.diagnostics).toEqual([]);
  expect(skills.skills.find((skill) => skill.name === "wish")?.filePath)
    .toBe(join(repo, "skills/wish/SKILL.md"));
  expect(extensionPaths).toEqual([join(repo, "extensions/wish.js")]);
});

test("bare and quoted /wish arguments reach the expanded entry without recursive expansion", async () => {
  const { templates } = resources();
  const extensionRunner = await runner();
  const bare = expandPromptTemplate("/wish", templates);
  const withArgs = expandPromptTemplate('/wish "keep $ARGUMENTS $1 literal" "x <literal> y"', templates);
  expect(bare.split("\n")[0]).toBe("");
  expect(withArgs.split("\n")[0]).toBe("keep $ARGUMENTS $1 literal x <literal> y");
  for (const text of [bare, withArgs]) {
    expect(text).not.toContain("<!-- omo-wish:entry:v1 -->");
    expect(await messages(extensionRunner, text, { preview: true })).toEqual([]);
    expect(existsSync(join(repo, "skills/wish/SKILL.md"))).toBe(true);
  }
});

test("lookalike words do not activate generic mode", async () => {
  const { templates } = resources();
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
  const { templates } = resources();
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

test("an installation path with spaces, quotes, #, and Unicode discovers skill and activates generic mode", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wish "quoted" # 한글 '));
  fixtures.push(dir);
  cpSync(join(repo, "package.json"), join(dir, "package.json"));
  cpSync(join(repo, "prompts"), join(dir, "prompts"), { recursive: true });
  cpSync(join(repo, "extensions"), join(dir, "extensions"), { recursive: true });
  cpSync(join(repo, "skills/wish"), join(dir, "skills/wish"), { recursive: true });
  const { templates, skills } = resources(dir);
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
