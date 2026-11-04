import type { Conversation, ConversationMessage } from "../shared/types";
import { discussionQuestion, isCurrentNativeConversation, nativeQuestionAnchors, nativeQuestionText } from "../shared/native-discussion";
import type { AtlasMessage } from "../shared/messages";

export function originalConversationUrl(conversation: Conversation): string | undefined {
  try { const url = new URL(conversation.url); return ["https:", "http:"].includes(url.protocol) ? url.href : undefined; } catch { return; }
}

/** Reuse a loaded native tab first. Reading never syncs messages or invokes AI. */
export async function openNativeDiscussion(conversation: Conversation, messages: ConversationMessage[], currentId?: string): Promise<"located" | "opened"> {
  const href = originalConversationUrl(conversation);
  if (!href) throw Error("Original conversation URL unavailable");
  const url = new URL(href);
  const tabs = await chrome.tabs.query({ url: `${url.origin}/*` });
  const existing = tabs.find(tab => { try { const candidate = new URL(tab.url ?? ""); return candidate.origin === url.origin && (isCurrentNativeConversation(href,conversation.id)&&isCurrentNativeConversation(candidate.href,conversation.id)||candidate.pathname === url.pathname && candidate.search === url.search); } catch { return false; } });
  const tab = existing?.id !== undefined ? await chrome.tabs.update(existing.id, { active: true }) : await chrome.tabs.create({ url: href, active: true });
  if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  const question = currentId ? discussionQuestion(messages, currentId) : undefined;
  if (tab.id === undefined || !question || !isCurrentNativeConversation(href, conversation.id)) return "opened";
  const anchors = nativeQuestionAnchors(messages, question);
  const request: AtlasMessage = { type: "ATLAS_LOCATE_MESSAGE", conversationId: conversation.id, identity: { messageId: question.platformMessageId, contentHash: question.contentHash, preview: question.preview || question.content.slice(0, 240), messageIndex: question.messageIndex, role: "user", ...(anchors.length ? { anchors } : {}), ...nativeQuestionText(question.content), messageCount: messages.length } };
  const tabId = tab.id, wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const sameChat = async () => isCurrentNativeConversation((await chrome.tabs.get(tabId)).url, conversation.id);
  // Wait for the page script to answer for this chat first. A locate may scroll to load earlier
  // history for many seconds; resending it on a short timer would cancel that work every time.
  const deadline = Date.now() + 15_000;
  let ready = false;
  while (!ready && Date.now() < deadline) {
    if (!await sameChat()) return "opened";
    try {
      const ping = await Promise.race([chrome.tabs.sendMessage(tabId, { type: "ATLAS_PING" } satisfies AtlasMessage), wait(800).then(() => undefined)]) as { ready?: boolean; conversation?: { id?: string } | null } | undefined;
      ready = Boolean(ping?.ready && [conversation.id, encodeURIComponent(conversation.id)].includes(ping.conversation?.id ?? ""));
    } catch { /* Content script may still be loading. */ }
    if (!ready) await wait(400);
  }
  if (!ready) return "opened";
  // A freshly opened chat renders its messages a moment after the script is ready; retry only after a reply.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!await sameChat()) return "opened";
    try {
      const result = await Promise.race([chrome.tabs.sendMessage(tabId, request), wait(50_000).then(() => undefined)]) as { ok?: boolean } | undefined;
      if (result?.ok) return "located";
    } catch { /* The page navigated or reloaded. */ }
    if (attempt < 2) await wait(900);
  }
  return "opened";
}
