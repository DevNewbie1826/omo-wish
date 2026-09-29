import { fileURLToPath } from "node:url";

const skillPath = fileURLToPath(new URL("../skills/wish/SKILL.md", import.meta.url));
const entry = /(?:^|\r?\n)<!-- omo-wish:entry:v1 -->\s*$/;

export default function (pi) {
  pi.on("before_agent_start", (event) => {
    if (typeof event.prompt !== "string" || !entry.test(event.prompt)) return;
    return {
      message: {
        customType: "omo-wish:skill",
        content: `Read the wish skill at ${JSON.stringify(skillPath)} and follow it for this request.`,
        display: false,
      },
    };
  }, { previewSafe: true });
}
