import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
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

test("package resources discover the available wish skill", () => {
  const { templates, skills, extensionPaths } = resources();
  expect(templates.map((template) => template.name)).toContain("wish");
  expect(skills.diagnostics).toEqual([]);
  expect(skills.skills.find((skill) => skill.name === "wish")?.filePath)
    .toBe(join(repo, "skills/wish/SKILL.md"));
  expect(extensionPaths).toEqual([join(repo, "extensions/wish.js")]);
});

test("bare and quoted /wish arguments reach the terminal entrypoint without recursive expansion", async () => {
  const { templates } = resources();
  const extensionRunner = await runner();
  const marker = "<!-- omo-wish:entry:v1 -->";
  const bare = expandPromptTemplate("/wish", templates);
  const withArgs = expandPromptTemplate('/wish "keep $ARGUMENTS $1 literal" "x <!-- omo-wish:entry:v1 --> y"', templates);
  expect(bare.split("\n")[0]).toBe("");
  expect(withArgs.split("\n")[0]).toBe(`keep $ARGUMENTS $1 literal x ${marker} y`);
  expect(bare.trimEnd().endsWith(marker)).toBe(true);
  expect(withArgs.trimEnd().endsWith(marker)).toBe(true);
  for (const text of [bare, withArgs]) {
    const pointer = await messages(extensionRunner, text, { preview: true });
    expect(pointer).toHaveLength(1);
    expect(pointer[0].customType).toBe("omo-wish:skill");
    expect(pointer[0].display).toBe(false);
    expect(pointer[0].content).toContain(JSON.stringify(join(repo, "skills/wish/SKILL.md")));
    expect(existsSync(join(repo, "skills/wish/SKILL.md"))).toBe(true);
  }
});

test("ordinary mode words and lookalike commands do not add a wish pointer", async () => {
  const { templates } = resources();
  const extensionRunner = await runner();
  for (const raw of ["ordinary ulw text", "/wishful hello", "/WISH hello", "x <!-- omo-wish:entry:v1 --> suffix"]) {
    const expanded = expandPromptTemplate(raw, templates);
    expect(expanded).toBe(raw);
    expect(await messages(extensionRunner, expanded)).toEqual([]);
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
    expect(preview).toHaveLength(1);
    expect(preview[0].customType).toBe("omo-wish:skill");
    expect(await messages(first, "ordinary ulw text")).toEqual([]);
    expect(marks).toEqual([]);
    armed.add("wish-test");
    const prearmed = await messages(first, text);
    expect(prearmed).toHaveLength(1);
    expect(prearmed[0].customType).toBe("omo-wish:skill");
    expect(marks).toEqual([]);
    armed.delete("wish-test");
    const activation = await messages(first, text);
    expect(activation).toHaveLength(1);
    expect(activation[0].customType).toBe("omo-ultrawork:directive");
    expect(activation[0].content).toContain("DIRECTIVE_SENTINEL");
    expect(activation[0].content).toContain(JSON.stringify(join(repo, "skills/wish/SKILL.md")));
    expect(marks).toEqual(["wish-test"]);
    for (const next of [first, await runner()]) {
      const pointer = await messages(next, text);
      expect(pointer).toHaveLength(1);
      expect(pointer[0].customType).toBe("omo-wish:skill");
    }
    expect(marks).toEqual(["wish-test"]);
    expect(globalThis[symbol].directive).toBe("DIRECTIVE_SENTINEL");
    delete globalThis[symbol];
    const withoutMode = await messages(first, text);
    expect(withoutMode).toHaveLength(1);
    expect(withoutMode[0].customType).toBe("omo-wish:skill");
    expect(Object.hasOwn(globalThis, symbol)).toBe(false);
    globalThis[symbol] = { directive: "DIRECTIVE_SENTINEL" };
    const withoutInterop = await messages(first, text);
    expect(withoutInterop).toHaveLength(1);
    expect(withoutInterop[0].customType).toBe("omo-wish:skill");
    expect(marks).toEqual(["wish-test"]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});

test("an installation path with spaces, quotes, #, and Unicode yields a readable absolute pointer", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wish "quoted" # 한글 '));
  fixtures.push(dir);
  cpSync(join(repo, "package.json"), join(dir, "package.json"));
  cpSync(join(repo, "prompts"), join(dir, "prompts"), { recursive: true });
  cpSync(join(repo, "extensions"), join(dir, "extensions"), { recursive: true });
  cpSync(join(repo, "skills/wish"), join(dir, "skills/wish"), { recursive: true });
  const { templates } = resources(dir);
  const pointer = await messages(await runner(dir), expandPromptTemplate("/wish moved", templates));
  const actualSkillPath = join(realpathSync(dir), "skills/wish/SKILL.md");
  expect(pointer).toHaveLength(1);
  expect(pointer[0].content).toContain(JSON.stringify(actualSkillPath));
  expect(existsSync(actualSkillPath)).toBe(true);
});
