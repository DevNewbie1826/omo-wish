// Arms OmO ultrawork mode for /wish. OmO's own hook listens on "input", which fires
// BEFORE prompt-template expansion and therefore only ever sees the raw "/wish ..." line;
// before_agent_start receives the prompt AFTER expansion, so the trigger words in the
// wish.md body are visible here. Directive text and arming state are OmO's own, read
// through the interop symbol it publishes on globalThis.

const ARMING_SYMBOL = Symbol.for("omo.ultrawork.arming");
const DIRECTIVE_CUSTOM_TYPE = "omo-ultrawork:directive";
const TRIGGER = /(?:ultrawork|ulw)/i;

function readArmingState() {
  const state = globalThis[ARMING_SYMBOL];
  if (typeof state !== "object" || state === null) return undefined;
  if (typeof state.directive !== "string" || state.directive.length === 0) return undefined;
  const arming = state.arming;
  if (typeof arming !== "object" || arming === null) return undefined;
  if (typeof arming.isArmed !== "function" || typeof arming.markArmed !== "function") return undefined;
  return { directive: state.directive, arming };
}

function readSessionId(ctx) {
  const getSessionId = ctx?.sessionManager?.getSessionId;
  if (typeof getSessionId !== "function") return undefined;
  const id = getSessionId.call(ctx.sessionManager);
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

export default function (pi) {
  pi.on("before_agent_start", (event, ctx) => {
    if (typeof event?.prompt !== "string" || !TRIGGER.test(event.prompt)) return;
    const state = readArmingState();
    if (state === undefined) return;
    const sessionId = readSessionId(ctx);
    if (state.arming.isArmed(sessionId)) return;
    state.arming.markArmed(sessionId);
    return {
      message: {
        customType: DIRECTIVE_CUSTOM_TYPE,
        content: state.directive,
        display: false,
      },
    };
  });
}
