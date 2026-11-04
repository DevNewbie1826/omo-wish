import { expect } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const senpi = process.env.SENPI_ROOT ?? join(homedir(), ".bun/install/global/node_modules/@code-yeongyu/senpi");
export const { expandPromptTemplate } = await import(`${senpi}/dist/core/prompt-templates.js`);
const { DefaultResourceLoader } = await import(`${senpi}/dist/core/resource-loader.js`);
const { SettingsManager } = await import(`${senpi}/dist/core/settings-manager.js`);
const { loadExtensions } = await import(`${senpi}/dist/core/extensions/loader.js`);
const { ExtensionRunner } = await import(`${senpi}/dist/core/extensions/runner.js`);
import { stageSkillsText } from "../extensions/wish.js";
export const fixtures = [];

// Bun binds a hook in a shared module to its first importer only, so each test file registers its own afterAll(removeFixtures).
export function removeFixtures() {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
}

export async function resources(root = repo) {
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

export async function runner(root = repo, sessionId = "wish-test", { sendMessage } = {}) {
  const { extensionPaths } = await resources(root);
  const loaded = await loadExtensions(extensionPaths, root);
  expect(loaded.errors).toEqual([]);
  if (sendMessage) loaded.runtime.sendMessage = sendMessage;
  const sessionManager = {
    getSessionId: () => sessionId,
    getBranch: () => [],
    getSessionFile: () => undefined,
    getEntries: () => [],
  };
  return new ExtensionRunner(loaded.extensions, loaded.runtime, root, sessionManager, {}, loaded.eventBus);
}

export async function messages(extensionRunner, prompt, options = {}) {
  return (await extensionRunner.emitBeforeAgentStart(prompt, undefined, "", {}, options))?.messages ?? [];
}

export const directiveMessages = (list) => (list ?? []).filter((m) => m?.customType === "omo-ultrawork:directive");
export const stageSkillsMessage = {
  customType: "omo-wish:stage-skills",
  content: stageSkillsText,
  display: false,
};

