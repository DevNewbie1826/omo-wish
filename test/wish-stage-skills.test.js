import { expect, test } from "bun:test";
import { repo, expandPromptTemplate, resources, runner, messages, stageSkillsMessage } from "./wish-harness.js";

test("stage skills inject per wish command but not for ordinary mass-ulw text", async () => {
  const { templates } = await resources();
  const extensionRunner = await runner();
  const wish = expandPromptTemplate("/wish do it", templates);
  const plain = "please use mass-ulw for this task";
  const symbol = Symbol.for("omo.ultrawork.arming");
  const prior = Object.getOwnPropertyDescriptor(globalThis, symbol);
  const armed = new Set();
  try {
    globalThis[symbol] = {
      directive: "DIRECTIVE_SENTINEL",
      arming: {
        isArmed: (id) => armed.has(id),
        markArmed: (id) => armed.add(id),
      },
    };
    // Expanding the shipped template here guards marker drift in the real command.
    const first = await messages(extensionRunner, wish);
    const second = await messages(extensionRunner, wish);
    expect(first).toEqual([
      { customType: "omo-ultrawork:directive", content: "DIRECTIVE_SENTINEL", display: false },
      stageSkillsMessage,
    ]);
    expect(second).toEqual([stageSkillsMessage]);
    expect((await messages(extensionRunner, plain)).filter((m) => m?.customType === "omo-wish:stage-skills"))
      .toEqual([]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});

test("stage skills preview does not inject or latch the pointer", async () => {
  const { templates } = await resources();
  const extensionRunner = await runner();
  const wish = expandPromptTemplate("/wish preview", templates);
  expect(await messages(extensionRunner, wish, { preview: true })).toEqual([]);
  expect((await messages(extensionRunner, wish)).filter((m) => m?.customType === "omo-wish:stage-skills"))
    .toEqual([stageSkillsMessage]);
});

test("stage skills skip non-prompt triggers", async () => {
  const { templates } = await resources();
  const extensionRunner = await runner();
  const wish = expandPromptTemplate("/wish delivery", templates);
  const delivery = await messages(extensionRunner, wish, { trigger: "delivery" });
  expect(delivery.filter((message) => message?.customType === "omo-wish:stage-skills")).toEqual([]);
  const prompt = await messages(extensionRunner, wish);
  expect(prompt.filter((message) => message?.customType === "omo-wish:stage-skills"))
    .toEqual([stageSkillsMessage]);
});

test("stage skills context re-appends once only for a latched session", async () => {
  const extensionRunner = await runner();
  const { templates } = await resources();
  await messages(extensionRunner, expandPromptTemplate("/wish latch", templates));
  const existing = [{ role: "user", content: "keep me" }];
  const reappended = await extensionRunner.emitContext(existing, undefined, "agent");
  expect(reappended).toEqual([...existing, {
    role: "custom",
    ...stageSkillsMessage,
  }]);
  const alreadyPresent = [...existing, { role: "custom", ...stageSkillsMessage }];
  expect(await extensionRunner.emitContext(alreadyPresent, undefined, "agent")).toEqual(alreadyPresent);

  const cold = await runner(repo, "wish-test-cold");
  expect(await cold.emitContext(existing, undefined, "agent")).toEqual(existing);
});

test("stage skills refuse invalid session ids and keep context unchanged", async () => {
  const { templates } = await resources();
  for (const invalidId of [0, false, ""]) {
    const extensionRunner = await runner(repo, invalidId);
    const wish = expandPromptTemplate("/wish guards", templates);
    expect((await messages(extensionRunner, wish)).filter((m) => m?.customType === "omo-wish:stage-skills"))
      .toEqual([]);
    const existing = [{ role: "user", content: "keep me" }];
    expect(await extensionRunner.emitContext(existing, undefined, "agent")).toEqual(existing);
  }
  const control = await runner(repo, "wish-test-guard-control");
  const wish = expandPromptTemplate("/wish guards", templates);
  expect((await messages(control, wish)).filter((m) => m?.customType === "omo-wish:stage-skills"))
    .toEqual([stageSkillsMessage]);
});
