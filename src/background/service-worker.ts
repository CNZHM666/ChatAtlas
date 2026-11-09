import { readerSearchContext, type MessageSourceRange, type ReaderSearchContext } from "../shared/message-location";
import type { AtlasMessage, CaptureCommandResponse, CaptureSummary } from "../shared/messages";
import type { ConversationCapture, ImportFailureCategory, ImportJob } from "../shared/types";
import { saveConversationCapture } from "../storage/messages";
import { getMessagesForConversation } from "../storage/messages";
import { getConversation } from "../storage/conversations";
import { getStoredConversationGraph } from "../storage/conversation-graphs";
import { getDatabase } from "../storage/db";
import { buildNavigatorData } from "../shared/conversation-navigator";
import { getSidecarData } from "../storage/sidecar";
import { historyImportStatus, isHistoryImportRunning, markHistoryUnavailable, pauseHistoryImport, raiseHistoryPriorities, setImportConnectionState, startHistoryImport, waitForHistoryImportIdle, type HistoryAdapter } from "../sync/import-runner";
import { ChatGPTSyncError } from "../sync/chatgpt-sync-adapter";
import { ensureContentConnection, selectChatGPTTab } from "./chatgpt-connection";
import { executeSidecarAction } from "./sidecar-actions";
import { respondAsync } from "./async-response";
import {registerChatGPTEntryRecovery} from "./entry-recovery";
import {isNativePanelSite,openNativeSidePanel,registerNativeSidePanels} from "./side-panel";
import { isDeletedProject } from "../storage/project-deletion";
import webCaptureScript from "../content/multi-ai-content.ts?script&iife";
import { createWebCaptureManager } from "./web-capture";
import {webCaptureSite} from "../shared/web-capture";
import { createNativeImportRunner } from "../sync/native-import-runner";
import { nativeHistoryRequest } from "./native-history-transport";
import { nativeImportSources } from "../shared/native-import-sources";

const ATLAS_PAGE = "atlas.html";
const webCapture = createWebCaptureManager(webCaptureScript);
const nativeImports = createNativeImportRunner(nativeHistoryRequest, async job => {
  await chrome.runtime.sendMessage({ type: "ATLAS_IMPORT_PROGRESS", job } satisfies AtlasMessage).catch(() => undefined);
});
void nativeImports.recover().catch(() => undefined);
chrome.runtime.onInstalled.addListener(()=>{void webCapture.restore().catch(()=>undefined);});
chrome.runtime.onStartup.addListener(()=>{void webCapture.restore().catch(()=>undefined);});
chrome.permissions?.onRemoved?.addListener(()=>{void webCapture.restore().catch(()=>undefined);});
chrome.permissions?.onAdded?.addListener(()=>{void webCapture.restore().catch(()=>undefined);});
void webCapture.restore().catch(()=>undefined);
registerNativeSidePanels();
const entryRecovery=registerChatGPTEntryRecovery({ping:pingChatGPTContent,inject:injectChatGPTContent});
const CHATGPT_URL = "https://chatgpt.com/*";
const CHATGPT_TAB_KEY = "atlasChatGPTTabId";
const IMPORT_INTENT_KEY = "atlasImportIntent";
const IMPORT_SELECTION_KEY = "atlasImportSelection";
const CONNECTION_RETRY_ALARM = "atlas-import-connect-retry";
let connectionAttempt: Promise<ImportJob> | null = null;
let selectionCommand: Promise<unknown> = Promise.resolve();
let importCancellation = 0;

/** Serialize acknowledgements, never the entire sync. Selections made during connection are not lost. */
/** Conversations to read again although already synced, until the next selected import starts. */
let forcedSelection: string[] = [];
function syncSelectedConversations(ids: string[], force = false): Promise<ImportJob> {
  const cancellation = importCancellation;
  const request = selectionCommand.catch(() => undefined).then(async () => {
    if (cancellation !== importCancellation) return historyImportStatus();
    if (connectionAttempt) await connectionAttempt;
    if (cancellation !== importCancellation) return historyImportStatus();
    const job = await historyImportStatus();
    if (job.native || ids.some(id => /^(?:claude|gemini|deepseek|doubao|kimi|qwen):/u.test(id))) {
      if (!job.native) throw Error("请先点击导入并选择对应 AI / Import the source AI first");
      return nativeImports.select(ids, nativeImportSources(await chrome.tabs.query({})), force);
    }
    if (isHistoryImportRunning()) {
      if (job.status === "paused" || job.phase === "reconciling" || job.retryScope === "titles") {
        if (job.retryScope === "titles" && job.status !== "paused") await pauseHistoryImport();
        await waitForHistoryImportIdle();
        if (cancellation !== importCancellation) return historyImportStatus();
      } else {
        await raiseHistoryPriorities(ids);
        return historyImportStatus();
      }
    }
    forcedSelection = force ? [...new Set(ids)] : [];
    return connectAndStartImport("selected", [...new Set(ids)]);
  });
  selectionCommand = request;
  return request;
}

function importLog(stage: string, details: Record<string, unknown> = {}): void {
  if (import.meta.env.DEV) console.info("[ChatAtlas Import]", { stage, ...details });
}

async function openAtlas(conversationId?: string, messageId?: string, settings = false, sourceRange?: MessageSourceRange, prepareId?:string, search?: ReaderSearchContext): Promise<void> {
  const baseUrl = chrome.runtime.getURL(ATLAS_PAGE);
  const hash = new URLSearchParams({ ...(conversationId ? { conversation: conversationId, ...(messageId ? { message: messageId, ...(sourceRange ? { location: JSON.stringify(sourceRange) } : {}), ...(search ? { search: JSON.stringify(search) } : {}) } : {}) } : {}), ...(settings ? { settings: "ai" } : {}),...(prepareId?{prepare:prepareId}:{}) });
  const url = hash.size ? `${baseUrl}#${hash}` : baseUrl;
  const existing = await chrome.tabs.query({ url: `${baseUrl}*` });
  const tab = existing[0];

  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true, ...(hash.size ? { url } : {}) });
    if (conversationId) void chrome.runtime.sendMessage({ type: "ATLAS_FOCUS_CONVERSATION", conversationId, messageId, sourceRange, search } satisfies AtlasMessage).catch(() => undefined);
    if (settings) void chrome.runtime.sendMessage({ type: "ATLAS_FOCUS_AI_SETTINGS" } satisfies AtlasMessage).catch(() => undefined);
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }

  await chrome.tabs.create({ url, active: true });
}

async function navigatorData(conversationId: string) {
  const [graph, conversation, messages, snapshots] = await Promise.all([
    getStoredConversationGraph(conversationId),
    getConversation(conversationId),
    getMessagesForConversation(conversationId),
    getDatabase().then((db) => db.getAllFromIndex("questionSnapshots", "by-conversation", conversationId)),
  ]);
  return buildNavigatorData(conversationId, graph, conversation, messages, snapshots);
}

async function openReview(sessionId: string, sectionId?: string, query = false): Promise<void> {
  const db = await getDatabase();
  const session = await db.get("focusSessions", sessionId);
  if (!session) throw new Error("Saved reading no longer exists.");
  const project = session.canvasId ? await db.get("canvases", session.canvasId) : undefined;
  if (project && isDeletedProject(project)) throw new Error("项目已删除，可在工作台回收站恢复。");
  if (sectionId && !session.sections.some(section => section.id === sectionId)) throw new Error("This chapter no longer exists.");
  const baseUrl = chrome.runtime.getURL(ATLAS_PAGE);
  const hash = new URLSearchParams({ review: sessionId, ...(sectionId ? { section: sectionId } : {}), ...(query ? { query: "1" } : {}) });
  const url = `${baseUrl}#${hash}`;
  const tab = (await chrome.tabs.query({ url: `${baseUrl}*` }))[0];
  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true, url });
    void chrome.runtime.sendMessage({ type: "ATLAS_FOCUS_REVIEW", sessionId, sectionId, query } satisfies AtlasMessage).catch(() => undefined);
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  } else await chrome.tabs.create({ url, active: true });
}

async function persistCapture(capture: ConversationCapture): Promise<CaptureCommandResponse> {
  await saveConversationCapture(capture, { replace: false });
  const summary: CaptureSummary = {
    conversationId: capture.conversation.id,
    title: capture.conversation.title,
    messageCount: capture.messages.length,
    savedAt: capture.capturedAt,
  };
  void chrome.runtime.sendMessage({ type: "ATLAS_CAPTURE_SAVED", summary } satisfies AtlasMessage).catch(() => undefined);
  return { ok: true, summary };
}

async function importCurrentConversation(): Promise<CaptureCommandResponse> {
  const tabs = await chrome.tabs.query({ url: CHATGPT_URL });
  const candidates = tabs
    .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === "number")
    .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  const target = candidates[0];
  if (!target) return { ok: false, error: "Open a ChatGPT conversation first, then try again." };

  try {
    await chrome.storage.session.set({ [CHATGPT_TAB_KEY]: target.id });
    return await chrome.tabs.sendMessage(target.id, { type: "ATLAS_CAPTURE_NOW" } satisfies AtlasMessage) as CaptureCommandResponse;
  } catch {
    return { ok: false, error: "Reload the open ChatGPT tab so ChatAtlas can connect to it." };
  }
}

async function waitForTabComplete(tabId: number, timeoutMs = 20_000): Promise<void> {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("ChatGPT took too long to load."));
    }, timeoutMs);
    const listener = (updatedId: number, change: chrome.tabs.TabChangeInfo) => {
      if (updatedId !== tabId || change.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function reloadAndWait(tabId: number, timeoutMs = 20_000): Promise<void> {
  const completed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error("ChatGPT took too long to reload.")); }, timeoutMs);
    const listener = (updatedId: number, change: chrome.tabs.TabChangeInfo) => {
      if (updatedId !== tabId || change.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
  await chrome.tabs.reload(tabId);
  await completed;
}

async function pingChatGPTContent(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "ATLAS_PING" } satisfies AtlasMessage) as { ready?: boolean };
    return response?.ready === true;
  } catch { return false; }
}

function manifestContentScriptFiles(): string[] {
  return chrome.runtime.getManifest().content_scripts?.find((entry) => entry.matches?.some((pattern) => pattern.includes("chatgpt.com")))?.js ?? [];
}

async function injectChatGPTContent(tabId: number): Promise<void> {
  const files = manifestContentScriptFiles();
  if (!files.length) throw new Error("ChatAtlas content script is missing from the extension manifest.");
  await chrome.scripting.executeScript({ target: { tabId }, files });
}

async function waitForChatGPTContent(tabId: number): Promise<void> {
  const result = await ensureContentConnection({
    ping: () => pingChatGPTContent(tabId),
    inject: () => injectChatGPTContent(tabId),
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  });
  if (!result.ok) throw new Error("ChatAtlas could not connect to the current ChatGPT page.");
}

async function createTabAdapter(tabId: number): Promise<HistoryAdapter> {
  let sessionAvailable: boolean | undefined;
  const request = async <T>(message: AtlasMessage): Promise<T> => {
    let response: { ok: boolean; value?: T; error?: string; retryable?: boolean; category?: ImportFailureCategory; status?: number; retryAfterMs?: number };
    try { response = await chrome.tabs.sendMessage(tabId, message); }
    catch {
      try {
        await waitForChatGPTContent(tabId);
        response = await chrome.tabs.sendMessage(tabId, message);
      } catch { throw new ChatGPTSyncError("ChatAtlas could not reach the ChatGPT page.", true, "bridge_error"); }
    }
    if (!response?.ok || response.value === undefined) throw new ChatGPTSyncError(response?.error ?? "ChatGPT sync did not respond.", response?.retryable, response?.category ?? (response?.error && /session|sign.?in|401/i.test(response.error) ? "auth" : "unknown"), response?.status, response?.retryAfterMs);
    return response.value;
  };
  return {
    isAvailable: async () => sessionAvailable ??= await request<boolean>({ type: "ATLAS_SYNC_SESSION" }),
    list: (offset, limit, archived) => request({ type: "ATLAS_SYNC_LIST", offset, limit, archived }),
    getConversation: (conversationId) => request({ type: "ATLAS_SYNC_DETAIL", conversationId }),
  };
}

type ImportMode = "full" | "incremental" | "failed" | "titles" | "selected";

async function pendingImportMode(): Promise<ImportMode | null> {
  const job = await historyImportStatus();
  if (job.status === "paused") return null;
  const stored = await chrome.storage.session.get(IMPORT_INTENT_KEY);
  const mode = stored[IMPORT_INTENT_KEY];
  if (mode === "full" || mode === "incremental") return "titles";
  if (mode === "failed" || mode === "titles" || mode === "selected") return mode;
  if (!["connecting", "discovering", "syncing", "reconciling"].includes(job.status)) return null;
  return job.retryScope === "full" || job.retryScope === "incremental" ? "titles" : job.retryScope ?? "titles";
}

async function scheduleConnectionRetry(): Promise<void> {
  await chrome.alarms.create(CONNECTION_RETRY_ALARM, { delayInMinutes: 0.15 });
}

async function connectAndStartImport(mode: ImportMode, selectedIds: string[] = [], resumeTitleScan = false): Promise<ImportJob> {
  if (connectionAttempt) return connectionAttempt;
  const cancellation = importCancellation;
  connectionAttempt = (async () => {
    const previous = await historyImportStatus();
    if (mode === "selected") {
      const intent = await chrome.storage.session.get([IMPORT_INTENT_KEY, IMPORT_SELECTION_KEY]);
      const waiting = intent[IMPORT_INTENT_KEY] === "selected" && Array.isArray(intent[IMPORT_SELECTION_KEY]) ? intent[IMPORT_SELECTION_KEY] as string[] : [];
      selectedIds = [...new Set([...selectedIds, ...waiting])];
    }
    const resumeTitles = mode === "titles" && (resumeTitleScan || previous.status === "paused");
    await chrome.storage.session.set({ [IMPORT_INTENT_KEY]: mode, ...(mode === "selected" ? { [IMPORT_SELECTION_KEY]: selectedIds } : {}) });
    importLog("finding_chatgpt_tab");
    await setImportConnectionState("finding_chatgpt_tab", "connecting", { stage: "tab", success: true }, mode === "failed");
    const tabs = await chrome.tabs.query({ url: CHATGPT_URL });
    if (cancellation !== importCancellation) return pauseHistoryImport();
    const tab = selectChatGPTTab(tabs);
    if (tab?.id === undefined) {
      importLog("finding_chatgpt_tab", { success: false, code: "NO_CHATGPT_TAB" });
      return setImportConnectionState("finding_chatgpt_tab", "connecting", { stage: "tab", success: false, code: "NO_CHATGPT_TAB" }, mode === "failed");
    }
    await chrome.storage.session.set({ [CHATGPT_TAB_KEY]: tab.id });
    importLog("finding_chatgpt_tab", { success: true, id: tab.id, url: tab.url });
    if (tab.status !== "complete") await waitForTabComplete(tab.id);
    if (cancellation !== importCancellation) return pauseHistoryImport();

    await setImportConnectionState("connecting_content_script", "connecting", { stage: "content-script", success: true }, mode === "failed");
    const connection = await ensureContentConnection({
      ping: () => pingChatGPTContent(tab.id!),
      inject: () => injectChatGPTContent(tab.id!),
      wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    });
    importLog("connecting_content_script", { ping: connection.ok, injection: connection.injected, code: connection.code });
    if (cancellation !== importCancellation) return pauseHistoryImport();
    if (!connection.ok) return setImportConnectionState("connecting_content_script", "unavailable", { stage: connection.code === "BRIDGE_INJECTION_FAILED" ? "bridge" : "content-script", success: false, code: connection.code, message: "Unable to connect to the current ChatGPT page." }, mode === "failed");

    await setImportConnectionState("connecting_page_bridge", "connecting", { stage: "bridge", success: true }, mode === "failed");
    const adapter = await createTabAdapter(tab.id);
    await setImportConnectionState("checking_session", "connecting", { stage: "session", success: true }, mode === "failed");
    let available = false;
    try { available = await adapter.isAvailable(); }
    catch (error) { importLog("checking_session", { success: false, error: error instanceof Error ? error.message : String(error) }); }
    if (cancellation !== importCancellation) return pauseHistoryImport();
    if (!available) {
      importLog("checking_session", { success: false, code: "SESSION_UNAVAILABLE" });
      await scheduleConnectionRetry();
      return setImportConnectionState("checking_session", "auth_required", { stage: "session", success: false, code: "SESSION_UNAVAILABLE" }, mode === "failed");
    }
    importLog("checking_session", { success: true });
    if (cancellation !== importCancellation) return pauseHistoryImport();
    const latest = await historyImportStatus();
    if (latest.status === "paused") return latest;
    const force = mode === "selected" ? forcedSelection : [];
    forcedSelection = [];
    const job = await startHistoryImport(adapter, mode, selectedIds, { resumeTitles, force });
    await chrome.storage.session.remove([IMPORT_INTENT_KEY, IMPORT_SELECTION_KEY]);
    return job;
  })().catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : "Unable to start import.";
    importLog("connection_failed", { success: false, message });
    return setImportConnectionState("connecting_page_bridge", "unavailable", { stage: "bridge", success: false, code: "REQUEST_FAILED", message }, mode === "failed");
  }).finally(() => { connectionAttempt = null; });
  return connectionAttempt;
}

async function openChatGPTForPendingImport(): Promise<ImportJob> {
  const mode = await pendingImportMode() ?? "titles";
  await chrome.storage.session.set({ [IMPORT_INTENT_KEY]: mode });
  const tabs = await chrome.tabs.query({ url: CHATGPT_URL });
  let tab = selectChatGPTTab(tabs);
  if (!tab?.id) tab = await chrome.tabs.create({ url: "https://chatgpt.com/", active: true });
  else {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  }
  if (tab.id !== undefined) await chrome.storage.session.set({ [CHATGPT_TAB_KEY]: tab.id });
  await scheduleConnectionRetry();
  if (tab.status === "complete") return retryPendingImport();
  return setImportConnectionState("connecting_content_script", "connecting", { stage: "content-script", success: true }, mode === "failed");
}

async function retryPendingImport(reload = false, requested = false): Promise<ImportJob> {
  const job = await historyImportStatus();
  if (job.native) return requested ? nativeImports.resume(nativeImportSources(await chrome.tabs.query({}))) : job;
  if (job.status === "paused" || isHistoryImportRunning()) return job;
  const mode = await pendingImportMode() ?? (requested ? job.retryScope === "full" || job.retryScope === "incremental" ? "titles" : job.retryScope ?? "titles" : null);
  if (!mode) return job;
  const stored = await chrome.storage.session.get(IMPORT_SELECTION_KEY);
  const selectedIds = job.retryScope === "selected" && job.pendingIds?.length ? job.pendingIds : Array.isArray(stored[IMPORT_SELECTION_KEY]) ? stored[IMPORT_SELECTION_KEY] as string[] : [];
  if (reload) {
    const tabs = await chrome.tabs.query({ url: CHATGPT_URL });
    const tab = selectChatGPTTab(tabs);
    if (!tab?.id) return connectAndStartImport(mode, selectedIds, true);
    await reloadAndWait(tab.id);
  }
  return connectAndStartImport(mode, selectedIds, true);
}

chrome.action.onClicked.addListener((tab) => {
  if(typeof chrome.sidePanel?.open==="function"&&tab?.id!==undefined&&isNativePanelSite(tab.url)){void openNativeSidePanel(tab.id,tab.url!,tab.windowId).then(result=>{if(!result.ok)return openAtlas();}).catch(()=>openAtlas());return;}
  void openAtlas().catch((error: unknown) => {
    console.error("[ChatAtlas] Unable to open the workspace", error);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  void entryRecovery.repairOpenTabs();
  void chrome.alarms.clear("atlas-incremental-sync");
  void chrome.alarms.create("atlas-import-resume", { periodInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  void entryRecovery.repairOpenTabs();
  void chrome.alarms.clear("atlas-incremental-sync");
  void chrome.alarms.create("atlas-import-resume", { periodInMinutes: 1 });
  void historyImportStatus().then((job) => { if (["connecting", "discovering", "syncing", "reconciling"].includes(job.status)) void retryPendingImport().catch(() => undefined); });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "atlas-import-resume") void historyImportStatus().then((job) => { if (["connecting", "discovering", "syncing", "reconciling"].includes(job.status)) void retryPendingImport().catch(() => undefined); });
  if (alarm.name === CONNECTION_RETRY_ALARM) void retryPendingImport().then(async (job) => { if (job.status === "connecting") await scheduleConnectionRetry(); }).catch(() => undefined);
  // Completed title inventories are refreshed only by an explicit user request.
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== "complete") return;
  void chrome.storage.session.get([CHATGPT_TAB_KEY, IMPORT_INTENT_KEY]).then((stored) => {
    if (stored[CHATGPT_TAB_KEY] === tabId && ["full", "incremental", "failed", "titles", "selected"].includes(stored[IMPORT_INTENT_KEY] as string)) void retryPendingImport().catch(() => undefined);
  });
});

chrome.runtime.onMessage.addListener((message: AtlasMessage, sender, sendResponse) => {
  const reply = (operation: () => Promise<unknown>) => respondAsync(sendResponse, operation);
  if (message.type === "ATLAS_OPEN_SIDEPANEL") {
    if (sender.tab?.id === undefined || !isNativePanelSite(sender.url)) { sendResponse({ ok: false, error: "Invalid sidebar caller" }); return false; }
    return reply(() => openNativeSidePanel(sender.tab!.id!,sender.url!,sender.tab!.windowId));
  }
  if (message.type === "ATLAS_SIDECAR_OPEN_ORIGINAL" || message.type === "ATLAS_SIDECAR_LOCATE" || message.type === "ATLAS_SIDECAR_SYNC" || message.type === "ATLAS_SIDECAR_HANDOFF" || message.type === "ATLAS_SIDECAR_CAPTURE") {
    return reply(() => executeSidecarAction(message, sender, {
      getMessages: getMessagesForConversation,
      getConversation,
      sync: async (tabId, conversationId) => {
        const tab=await chrome.tabs.get(tabId),site=tab.url?webCaptureSite(tab.url):undefined;
        if(site)return webCapture.captureTab(site.id,tabId,conversationId);
        const capture = await (await createTabAdapter(tabId)).getConversation(conversationId);
        if (capture.conversation.id !== conversationId) throw new Error("同步的对话不一致，请重试。");
        return persistCapture(capture);
      },
    }));
  }
  if (message.type === "ATLAS_OPEN_AI_SETTINGS") return reply(async () => { await openAtlas(undefined, undefined, true); return { ok: true }; });
  if (message.type === "ATLAS_OPEN") return reply(async () => { await openAtlas(undefined,undefined,false,undefined,message.prepareId); return { ok: true }; });
  if (message.type === "ATLAS_OPEN_CONVERSATION") return reply(async () => { await openAtlas(message.conversationId, message.messageId, false, message.sourceRange, undefined, readerSearchContext(message.search)); return { ok: true }; });
  if (message.type === "ATLAS_NAVIGATOR_DATA") return reply(async () => ({ ok: true, data: await navigatorData(message.conversationId) }));
  if (message.type === "ATLAS_SIDECAR_DATA") return reply(async () => ({ ok: true, data: await getSidecarData(message.conversationId) }));
  if (message.type === "ATLAS_OPEN_REVIEW") return reply(async () => { await openReview(message.sessionId, message.sectionId, message.query); return { ok: true }; });
  if (message.type === "ATLAS_CONTENT_READY") {
    void pendingImportMode().then(mode => { if (mode) void retryPendingImport().catch(() => undefined); }).catch(() => undefined);
    return false;
  }
  if (message.type === "ATLAS_WEB_CAPTURE_STATUS") return reply(async()=>({ok:true,status:await webCapture.status()}));
  if(message.type==="ATLAS_WEB_HISTORY_LIST"||message.type==="ATLAS_WEB_HISTORY_IMPORT"){
    if(sender.id!==chrome.runtime.id||!sender.url?.startsWith(chrome.runtime.getURL(""))){sendResponse({ok:false,error:"Open history import in ChatAtlas."});return false;}
    return message.type==="ATLAS_WEB_HISTORY_LIST"?reply(async()=>({ok:true,page:await webCapture.history(message.platform,message.tabId)})):reply(()=>webCapture.importHistory(message.platform,message.url,message.conversationId));
  }
  if (message.type === "ATLAS_WEB_CAPTURE_TABS" || message.type === "ATLAS_WEB_CAPTURE_TAB") {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) { sendResponse({ok:false,error:"Open capture settings in ChatAtlas."}); return false; }
    return message.type === "ATLAS_WEB_CAPTURE_TABS"
      ? reply(async()=>({ok:true,tabs:await webCapture.tabs(message.platform)}))
      : reply(()=>webCapture.captureTab(message.platform,message.tabId,message.conversationId));
  }
  if (message.type === "ATLAS_WEB_CAPTURE_SET") return reply(async()=>({ok:true,status:await webCapture.set(message.platform,message.enabled)}));
  if (message.type === "ATLAS_CAPTURE_BATCH") return reply(async () => {
    if(message.capture.conversation.platform!=="chatgpt"&&!await webCapture.accepts(message.capture,sender.url??sender.tab?.url))throw Error("Page capture is disabled or does not match this website");
    return persistCapture(message.capture);
  });
  if (message.type === "ATLAS_IMPORT_CURRENT") return reply(importCurrentConversation);
  if (message.type === "ATLAS_NATIVE_IMPORT_START" || message.type === "ATLAS_NATIVE_IMPORT_RESUME") {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) { sendResponse({ error: "Open import in ChatAtlas" }); return false; }
    return reply(async () => {
      if (isHistoryImportRunning() || connectionAttempt) throw Error("请先暂停当前导入 / Pause the current import first");
      if (message.type === "ATLAS_NATIVE_IMPORT_RESUME") return nativeImports.resume(nativeImportSources(await chrome.tabs.query({})));
      const detected = nativeImportSources(await chrome.tabs.query({}));
      const sources = message.sources.map(requested => {
        const found = detected.find(item => item.id === requested.id && item.tabId === requested.tabId && item.platform === requested.platform);
        if (!found) throw Error("AI 来源已变化，请重新检测 / AI source changed; detect again");
        return found;
      });
      await chrome.storage.session.remove([IMPORT_INTENT_KEY, IMPORT_SELECTION_KEY]);
      await chrome.alarms.clear(CONNECTION_RETRY_ALARM);
      return nativeImports.start(sources);
    });
  }
  if (message.type === "ATLAS_IMPORT_START") return reply(async () => {
    if (nativeImports.isRunning()) throw Error("请先暂停当前导入 / Pause the current import first");
    try { return await connectAndStartImport(message.mode); }
    catch (error) { return markHistoryUnavailable(error instanceof Error ? error.message : "Unable to start import."); }
  });
  if (message.type === "ATLAS_IMPORT_SELECT") return reply(() => syncSelectedConversations(message.conversationIds, message.force));
  if (message.type === "ATLAS_IMPORT_OPEN_CHATGPT") return reply(openChatGPTForPendingImport);
  if (message.type === "ATLAS_IMPORT_RETRY") return reply(() => retryPendingImport(Boolean(message.reload), true));
  if (message.type === "ATLAS_IMPORT_PAUSE") {
    importCancellation += 1;
    return reply(async () => {
      if ((await historyImportStatus()).native) return nativeImports.pause();
      const job = await pauseHistoryImport();
      await chrome.storage.session.remove(IMPORT_INTENT_KEY);
      await chrome.alarms.clear(CONNECTION_RETRY_ALARM);
      return job;
    });
  }
  if (message.type === "ATLAS_IMPORT_STATUS") return reply(historyImportStatus);
  if (message.type === "ATLAS_IMPORT_PRIORITY") return reply(() => syncSelectedConversations([message.conversationId]));
  return false;
});
