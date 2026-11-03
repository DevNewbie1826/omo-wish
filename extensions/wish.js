const keyword = /\b(?:ultrawork|ulw)\b/i;
const armingSymbol = Symbol.for("omo.ultrawork.arming");
const stageSkillsType = "omo-wish:stage-skills";
const stageSkillsText = "This /wish run stages its work through two omo skills: read the `mass-ulw` skill before the collect, build and fix stages (each is one mass-ulw run) and the `ulw-loop` skill before the goal and checkpoint stages (goals, evidence, checkpoints). Load each with the read tool when its first stage begins; the session's skill list carries their SKILL.md paths.";
const wishMarker = "Read and follow the `wish` skill";
const stageSkillsKeyword = /\b(?:mass-ulw|ulw-loop)\b/i;
const stageSkillsSessions = new Set();

export default function (pi) {
  pi.on("before_agent_start", (event, ctx) => {
    if (event.preview === true || typeof event.prompt !== "string" || !keyword.test(event.prompt)) return;
    const state = globalThis[armingSymbol];
    const arming = state?.arming;
    const sessionId = ctx.sessionManager?.getSessionId();
    if (typeof sessionId !== "string" || sessionId.length === 0
      || typeof state?.directive !== "string" || state.directive.length === 0
      || typeof arming?.isArmed !== "function" || typeof arming?.markArmed !== "function"
      || arming.isArmed(sessionId)) return;
    arming.markArmed(sessionId);
    return {
      message: {
        customType: "omo-ultrawork:directive",
        content: state.directive,
        display: false,
      },
    };
  }, { previewSafe: true });

  pi.on("before_agent_start", (event, ctx) => {
    if (typeof event.prompt !== "string" || event.preview === true || event.trigger !== "prompt"
      || !event.prompt.includes(wishMarker) || !stageSkillsKeyword.test(event.prompt)) return;
    const sessionId = ctx.sessionManager?.getSessionId();
    if (typeof sessionId !== "string" || sessionId.length === 0) return;
    // Keep the pointer available after compaction without repeating it on each prompt.
    stageSkillsSessions.add(sessionId);
    return { message: { customType: stageSkillsType, content: stageSkillsText, display: false } };
  }, { previewSafe: true });

  pi.on("context", (event, ctx) => {
    const sessionId = ctx.sessionManager?.getSessionId();
    if (typeof sessionId !== "string" || sessionId.length === 0 || !stageSkillsSessions.has(sessionId)) return;
    if (event.messages.some(message => message.customType === stageSkillsType)) return;
    return {
      messages: [...event.messages, {
        role: "custom",
        customType: stageSkillsType,
        content: stageSkillsText,
        display: false,
      }],
    };
  });
}
