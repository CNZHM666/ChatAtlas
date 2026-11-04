import { openNativeDiscussion } from "../canvas/open-native-discussion";
import type { AtlasMessage } from "../shared/messages";
import type { Conversation, ConversationMessage } from "../shared/types";
import { discussionQuestion, isCurrentNativeConversation,nativeQuestionAnchors,nativeQuestionText } from "../shared/native-discussion";
import { handoffPageMatches } from "../shared/handoff-page";
import {nativePanelTabId} from "../shared/sidecar-scope";

type SidecarAction = Extract<AtlasMessage, { type: "ATLAS_SIDECAR_OPEN_ORIGINAL" | "ATLAS_SIDECAR_LOCATE" | "ATLAS_SIDECAR_SYNC" | "ATLAS_SIDECAR_HANDOFF" | "ATLAS_SIDECAR_CAPTURE" }> & {tabId?:number};
export async function executeSidecarAction(message: SidecarAction, sender: chrome.runtime.MessageSender, dependencies: {
  getMessages: (id: string,options?:{cache?:boolean}) => Promise<ConversationMessage[]>;
  getConversation?: (id: string) => Promise<Conversation | undefined>;
  sync: (tabId: number, conversationId: string) => Promise<unknown>;
}): Promise<unknown> {
  const native=sender.url?.startsWith(chrome.runtime.getURL("sidecar.html")+"?")&&new URL(sender.url).searchParams.get("native")==="1";
  const tabId = sender.tab?.id??(native?message.tabId:undefined);
  if (tabId === undefined || !sender.url?.startsWith(chrome.runtime.getURL("sidecar.html") + "?")) throw new Error("请从当前对话的 ChatAtlas 侧栏操作。");
  const boundTab=native?new URL(sender.url).searchParams.get("tabId"):null;
  if(boundTab!==null&&nativePanelTabId(boundTab)!==tabId)throw Error("侧栏与目标标签页不一致，请重新打开。");
  const tab = await chrome.tabs.get(tabId);
  if(native&&!tab.active)throw Error("目标标签页已切换，请重新核对上下文。");
  if (message.type === "ATLAS_SIDECAR_OPEN_ORIGINAL") {
    const source = await dependencies.getConversation?.(message.conversationId);
    if (!source || !isCurrentNativeConversation(source.url, source.id)) throw Error("原始对话地址不可用，请在 Reader 阅读。");
    const messages = await dependencies.getMessages(source.id, { cache: false });
    if (!messages.some(item => item.id === message.messageId)) throw Error("原文已变化，请刷新搜索结果。");
    const current = await chrome.tabs.get(tabId);
    if (current.url !== tab.url || native && !current.active || !native && !isCurrentNativeConversation(current.url, new URL(sender.url).searchParams.get("conversation") ?? "")) throw Error("当前页面已变化，请重新核对后定位。");
    const result = await openNativeDiscussion(source, messages, message.messageId);
    return { ok: true, located: result === "located" };
  }
  if (message.type === "ATLAS_SIDECAR_HANDOFF") {
    const frameConversation = new URL(sender.url!).searchParams.get("conversation") ?? "";
    if (!native&&frameConversation !== message.conversationId || !handoffPageMatches(tab.url, message.conversationId)) throw new Error("当前对话已切换，请重新打开侧栏。");
    if (typeof message.text !== "string" || !message.text.trim() || message.text.length > 1_000_000) throw new Error("交接内容不可用，请调整后重试。");
    return chrome.tabs.sendMessage(tabId, { type: "ATLAS_FILL_COMPOSER", conversationId: message.conversationId, text: message.text } satisfies AtlasMessage);
  }
  if (!isCurrentNativeConversation(tab.url, message.conversationId)) throw new Error("当前对话已切换，请重新打开侧栏。");
  if (!native&&new URL(sender.url!).searchParams.get("conversation") !== message.conversationId) throw new Error("侧栏与当前对话不一致，请重新打开。");
  if (message.type === "ATLAS_SIDECAR_CAPTURE") return chrome.tabs.sendMessage(tabId, { type: "ATLAS_CAPTURE_NOW" } satisfies AtlasMessage);
  if (message.type === "ATLAS_SIDECAR_SYNC") return dependencies.sync(tabId, message.conversationId);
  // The directory reads committed originals directly; a worker's old reader
  // cache must not make those same questions disappear during navigation.
  const messages=await dependencies.getMessages(message.conversationId,{cache:false});
  const exact=discussionQuestion(messages,message.messageId);
  const nativeQuestion=message.platformMessageId?discussionQuestion(messages,message.platformMessageId):undefined;
  const question=exact??nativeQuestion;
  if (!question||message.platformMessageId&&question.platformMessageId!==message.platformMessageId) throw new Error("这条重点的问题记录已更新，请刷新重点后重试定位。");
  const anchors=nativeQuestionAnchors(messages,question);
  return chrome.tabs.sendMessage(tabId, { type: "ATLAS_LOCATE_MESSAGE", conversationId: message.conversationId, identity: { messageId: question.platformMessageId, contentHash: question.contentHash, preview: question.preview||question.content?.slice(0,240)||"", messageIndex: question.messageIndex, role: "user",...(anchors.length?{anchors}:{}),...nativeQuestionText(question.content??""),messageCount:messages.length } } satisfies AtlasMessage);
}
