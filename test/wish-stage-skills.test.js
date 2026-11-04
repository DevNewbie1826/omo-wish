import { expect, test } from "bun:test";
import { repo, convertToLlm, expandPromptTemplate, resources, runner, messages, stageSkillsMessage } from "./wish-harness.js";

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

test("stage skills are never re-sent as the newest message across converted continuation turns", async () => {
  const extensionRunner = await runner();
  const { templates } = await resources();
  await messages(extensionRunner, expandPromptTemplate("/wish latch", templates));
  let transcript = [
    { role: "user", content: "/wish go", timestamp: 1 },
    { role: "custom", ...stageSkillsMessage, timestamp: 2 },
    { role: "assistant", content: [{ type: "text", text: "starting" }], timestamp: 3 },
    { role: "user", content: "continue", timestamp: 4 },
  ];
  for (let turn = 1; turn <= 3; turn++) {
    // The host's compaction hook runs convertToLlm first: customType is gone before this extension's hooks.
    const sent = await extensionRunner.emitContext(convertToLlm(transcript), undefined, "agent");
    const copies = sent.filter((m) => JSON.stringify(m.content).includes(stageSkillsMessage.content));
    expect(copies).toHaveLength(1);
    expect(JSON.stringify(sent.at(-1).content)).not.toContain(stageSkillsMessage.content);
    transcript = [...transcript, { role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: 9 }, { role: "user", content: "next", timestamp: 10 }];
  }
});

test("stage skills restore once per accepted compaction for a latched session only", async () => {
  const sent = [];
  const extensionRunner = await runner(repo, "wish-test-compact", { sendMessage: (message, options) => sent.push([message, options]) });
  const { templates } = await resources();
  const compact = (accepted) => extensionRunner.emit({ type: "session_compact", accepted, reason: "manual", requestId: "r", fromExtension: false, willRetry: false, ...(accepted ? { compactionEntry: {} } : { rejectionCause: "cancelled-by-extension" }) });
  await compact(true);
  expect(sent).toEqual([]);
  await messages(extensionRunner, expandPromptTemplate("/wish latch", templates));
  await compact(false);
  expect(sent).toEqual([]);
  await compact(true);
  expect(sent).toEqual([[{ customType: stageSkillsMessage.customType, content: stageSkillsMessage.content, display: false }, { triggerTurn: false }]]);
  await extensionRunner.emitContext([{ role: "user", content: "x" }], undefined, "agent");
  expect(sent).toHaveLength(1);
});

test("stage skills refuse invalid session ids and keep context unchanged", async () => {
  const { templates } = await resources();
  for (const invalidId of [0, false, ""]) {
    const sent = [];
    const extensionRunner = await runner(repo, invalidId, { sendMessage: (...args) => sent.push(args) });
    const wish = expandPromptTemplate("/wish guards", templates);
    expect((await messages(extensionRunner, wish)).filter((m) => m?.customType === "omo-wish:stage-skills"))
      .toEqual([]);
    await extensionRunner.emit({ type: "session_compact", accepted: true, reason: "manual", requestId: "r", fromExtension: false, willRetry: false, compactionEntry: {} });
    expect(sent).toEqual([]);
  }
  const control = await runner(repo, "wish-test-guard-control");
  const wish = expandPromptTemplate("/wish guards", templates);
  expect((await messages(control, wish)).filter((m) => m?.customType === "omo-wish:stage-skills"))
    .toEqual([stageSkillsMessage]);
});
