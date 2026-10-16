import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const senpi = process.env.SENPI_ROOT ?? join(homedir(), ".bun/install/global/node_modules/@code-yeongyu/senpi");
const { expandPromptTemplate } = await import(`${senpi}/dist/core/prompt-templates.js`);
const { DefaultResourceLoader } = await import(`${senpi}/dist/core/resource-loader.js`);
const { SettingsManager } = await import(`${senpi}/dist/core/settings-manager.js`);
const { loadExtensions } = await import(`${senpi}/dist/core/extensions/loader.js`);
const { ExtensionRunner } = await import(`${senpi}/dist/core/extensions/runner.js`);

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

test("package resources discover the wish2 skill and command", async () => {
  const { templates, skills } = await resources();
  expect(skills.diagnostics).toEqual([]);
  expect(skills.skills.find((skill) => skill.name === "wish2")?.filePath)
    .toBe(join(repo, "skills/wish2/SKILL.md"));
  expect(templates.map((template) => template.name)).toContain("wish2");
});

test("/wish2 expansion keeps arguments, names the wish2 skill, and arms ultrawork once", async () => {
  const { templates } = await resources();
  const text = expandPromptTemplate('/wish2 "keep $1 literal"', templates);
  expect(text.split("\n")[0]).toBe("keep $1 literal");
  expect(text).toContain("`wish2` skill");
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
    const first = await messages(extensionRunner, text);
    expect(first).toEqual([{
      customType: "omo-ultrawork:directive",
      content: "DIRECTIVE_SENTINEL",
      display: false,
    }]);
    expect(await messages(extensionRunner, text)).toEqual([]);
    expect(marks).toEqual(["wish-test"]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});
