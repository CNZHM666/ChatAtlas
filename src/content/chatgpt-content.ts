import { conversationScroller } from "./text-reveal";
import { extensionAlive } from "./extension-alive";
import { findQuestionBlock, looseText, pageRoots, shadowOf } from "./question-text";
import type { AtlasMessage, CaptureCommandResponse } from "../shared/messages";
import { buildConversationCapture } from "./capture-builder";
import { PageCapture } from "./page-capture";
import { DOMChatGPTAdapter, usesCurrentChatGPTMarkup } from "./chatgpt-adapter";
import { ChatGPTSyncAdapter, ChatGPTSyncError } from "../sync/chatgpt-sync-adapter";
import { ConversationNavigator } from "./conversation-navigator";
import { pageTheme, watchPageTheme } from "./page-theme";
import { locateDiscussion } from "./locate-discussion";
import { clearProjectComposer, fillProjectComposer } from "./project-handoff";

const adapter = new DOMChatGPTAdapter();
const syncAdapter = new ChatGPTSyncAdapter();
const pageCapture = new PageCapture(() => usesCurrentChatGPTMarkup() ? Promise.resolve(null) : buildConversationCapture(adapter), async capture => {
  const response = await chrome.runtime.sendMessage({type:"ATLAS_CAPTURE_BATCH",capture} satisfies AtlasMessage) as CaptureCommandResponse | undefined;
  return response ?? {ok:false,error:"The ChatAtlas background service did not respond."};
});
const persistCurrentConversation = (force = false) => pageCapture.capture(force);
const scheduleCapture = (delay = 650) => pageCapture.schedule(delay);

chrome.runtime.onMessage.addListener((message: AtlasMessage, _sender, sendResponse) => {
  if (message.type === "ATLAS_FILL_COMPOSER") {
    void (message.undo ? clearProjectComposer(message.text, message.conversationId) : fillProjectComposer(message.text, message.conversationId)).then(sendResponse).catch(error => { console.warn("[ChatAtlas] insert", "error", error); sendResponse({ ok: false, reason: "failed" }); });
    return true;
  }
  if (message.type === "ATLAS_LOCATE_MESSAGE") {
    void locateDiscussion(adapter, message.conversationId, message.identity).then(ok => { if (!ok) reportLocate(message.conversationId, message.identity); return ok; }).then(ok => sendResponse({ ok, ...(!ok ? { error: "暂未在页面上定位到这条讨论，可点书本图标在 Reader 阅读。", ...(adapter.lastReveal ? { reader: adapter.lastReveal } : {}) } : {}) })).catch(error => { console.warn("[ChatAtlas] locate error", error instanceof Error ? `${error.message}
${error.stack ?? ""}` : String(error)); sendResponse({ ok: false, error: "本次自动定位未完成，请重试。" }); });
    return true;
  }
  if (message.type === "ATLAS_PAGE_THEME") { sendResponse({ theme: pageTheme() }); return false; }
  if (message.type === "ATLAS_PING") {
    onExecute();
    sendResponse({ ready: true, conversation: adapter.detectConversation() });
    return false;
  }
  if (message.type === "ATLAS_CAPTURE_NOW") {
    void persistCurrentConversation(true)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Conversation capture failed.",
      } satisfies CaptureCommandResponse));
    return true;
  }
  if (message.type === "ATLAS_SYNC_LIST" || message.type === "ATLAS_SYNC_DETAIL" || message.type === "ATLAS_SYNC_SESSION") {
    const request = message.type === "ATLAS_SYNC_LIST"
      ? syncAdapter.list(message.offset, message.limit, message.archived)
      : message.type === "ATLAS_SYNC_DETAIL" ? syncAdapter.getConversation(message.conversationId) : syncAdapter.isAvailable();
    void request.then((value) => sendResponse({ ok: true, value })).catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "ChatGPT sync failed.", retryable: error instanceof ChatGPTSyncError && error.retryable, category: error instanceof ChatGPTSyncError ? error.category : "unknown", status: error instanceof ChatGPTSyncError ? error.status : undefined, retryAfterMs: error instanceof ChatGPTSyncError ? error.retryAfterMs : undefined }));
    return true;
  }
  return false;
});

const navigator = new ConversationNavigator(adapter);
// After the extension is reloaded or updated, this copy of the script can no longer reach it: stop instead of
// failing on every page change. The new copy takes over.
const retired = () => { if (extensionAlive()) return false; observer.disconnect(); pageCapture.pause(); navigator.stop(); return true; };
const observer = new MutationObserver(() => { if (retired()) return; scheduleCapture(); navigator.syncPage(); navigator.ensureTrigger(); });
let active = false;
/** CRXJS calls this even when a reinjected loader reuses its cached module. */
export function onExecute(): void {
  navigator.start();
  if (active) return;
  active = true;
  pageCapture.resume();
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scheduleCapture(250);
}
window.addEventListener("pagehide", () => { active = false; observer.disconnect(); pageCapture.pause(); });
window.addEventListener("pageshow", event => { if (event.persisted) onExecute(); });
onExecute();

void chrome.runtime.sendMessage({
  type: "ATLAS_CONTENT_READY",
  url: window.location.href,
} satisfies AtlasMessage).catch(() => undefined);

/** A diagnostic must never turn a finished locate into an error. */
function reportLocate(conversationId: string, identity: { messageId?: string; text?: string }) {
  try { console.warn("[ChatAtlas] locate " + JSON.stringify(locateDiagnostics(conversationId, identity))); }
  catch (error) { console.warn("[ChatAtlas] locate diagnostics failed", String(error)); }
}

/** Page structure only (counts and attribute names), never message text, so a failed locate can be explained. */
function locateDiagnostics(conversationId: string, identity: { messageId?: string; text?: string }) {
  const turn = document.querySelector<HTMLElement>('[data-testid^="conversation-turn-"], article');
  return {
    conversation: adapter.detectConversation()?.id === conversationId,
    main: Boolean(document.querySelector("main")),
    roles: document.querySelectorAll("[data-message-author-role]").length,
    rolesInMain: document.querySelectorAll("main [data-message-author-role]").length,
    questions: adapter.parseQuestions?.().length ?? 0,
    turns: document.querySelectorAll('[data-testid^="conversation-turn-"]').length,
    articles: document.querySelectorAll("article").length,
    messageIds: document.querySelectorAll("[data-message-id]").length,
    byId: Boolean(identity.messageId && document.querySelector(`[data-message-id="${CSS.escape(identity.messageId)}"], [data-chatgpt-search-message-ids~="${CSS.escape(identity.messageId)}"], [data-chatgpt-selection-message-id="${CSS.escape(identity.messageId)}"]`)),
    turnKeys: document.querySelectorAll("[data-turn-key]").length,
    userUnits: document.querySelectorAll('[data-content-search-unit-key$=":user"]').length,
    assistantUnits: document.querySelectorAll('[data-content-search-unit-key$=":assistant"]').length,
    hasText: Boolean(identity.text),
    foundByText: Boolean(identity.text && findQuestionBlock(identity.text)),
    shadowRoots: [...document.querySelectorAll("*")].filter(element => element.shadowRoot).length,
    closedShadowRoots: [...document.querySelectorAll("*")].filter(element => !element.shadowRoot && shadowOf(element)).length,
    searchedRoots: pageRoots().length,
    frames: document.querySelectorAll("iframe").length,
    sameOriginFrames: [...document.querySelectorAll("iframe")].filter(frame => { try { return Boolean(frame.contentDocument); } catch { return false; } }).length,
    frameSources: [...document.querySelectorAll("iframe")].map(frame => { try { return new URL(frame.src, location.href).pathname.slice(0, 40); } catch { return ""; } }),
    textInVisiblePage: Boolean(identity.text && looseText(document.body?.innerText ?? "").includes(looseText(identity.text).slice(0, 40))),
    mainChildren: document.querySelector("main")?.childElementCount ?? 0,
    mainTextLength: document.querySelector("main")?.textContent?.length ?? 0,
    scroller: (scroller => ({ tag: scroller.localName, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, top: Math.round(scroller.scrollTop) }))(conversationScroller()),
    messageIndex: (identity as { messageIndex?: number }).messageIndex, messageCount: (identity as { messageCount?: number }).messageCount,
    customElements: new Set([...document.querySelectorAll("*")].map(element => element.localName).filter(name => name.includes("-"))).size,
    turnAttributes: turn ? turn.getAttributeNames().filter(name => name.startsWith("data-")) : [],
  };
}
// The side panel, when opened as Chrome's side panel here, matches ChatGPT's light or dark theme as it changes.
watchPageTheme(theme => { void chrome.runtime.sendMessage({ type: "ATLAS_PAGE_THEME_CHANGED", theme } satisfies AtlasMessage).catch(() => undefined); });
