import { chatGPTConversationId, isCurrentNativeConversation } from "./native-discussion";
import { webCaptureSite, webConversation } from "./web-capture";

/** A handoff is bound to its original page. Without a conversation it targets a new-chat page of a supported
 * AI site (ChatGPT's home or project page, or another site's new chat), never an open conversation. */
export function handoffPageMatches(url: string | undefined, conversationId: string): boolean {
  if (conversationId) return isCurrentNativeConversation(url, conversationId);
  try {
    const page = new URL(url ?? "");
    if (page.origin === "https://chatgpt.com") return !chatGPTConversationId(page.pathname);
    return Boolean(webCaptureSite(page.href)) && !webConversation(page.href);
  } catch { return false; }
}
