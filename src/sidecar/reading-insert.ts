import type { Conversation, ConversationMessage } from "../shared/types";
import { platformName } from "../shared/platforms";
import { formatComposerReference, plainComposerReference } from "../shared/composer-reference";

const when = (message: ConversationMessage | undefined, zh: boolean) => {
  const time = message?.sourceCreatedAt;
  return typeof time === "number" && Number.isFinite(time) && time > 0 && time <= 8.64e15 ? new Date(time).toLocaleDateString(zh ? "zh-CN" : "en") : "";
};

/** What a question turn read in the sidebar puts into the AI's input box: where it was said, the question and the
 * answer under labels, and a rule the user writes under. A selection inside it puts in only what was selected.
 * Ends on a new line under the rule, where the cursor stands after the insertion. */
export function readingInsertText(conversation: Conversation, messages: ConversationMessage[], zh: boolean, selection = ""): string {
  const l = (cn: string, en: string) => zh ? cn : en;
  const source = [`${zh ? "《" : "“"}${conversation.title}${zh ? "》" : "”"}`, platformName(conversation.platform, zh ? "zh-CN" : "en"), when(messages[0], zh)].filter(Boolean).join(" · ");
  const picked = selection.replace(/\r\n/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
  if (picked) return formatComposerReference(
    l("以下是我之前讨论中的一段内容，供参考：", "For reference, a passage from an earlier discussion of mine:"),
    source, `${zh ? "「" : "\""}${picked}${zh ? "」" : "\""}`,
  );
  const body = messages.map(message => {
    const role = message.role === "user" ? l("【我问】", "[I asked]") : l("【AI 答】", "[AI answered]");
    return `${role}\n${plainComposerReference(message.content)}`;
  }).join("\n\n");
  return formatComposerReference(l("以下是我之前的一段讨论，供参考：", "For reference, an earlier discussion of mine:"), source, body);
}
