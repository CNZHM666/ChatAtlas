import { WEB_CAPTURE_KEY, WEB_CAPTURE_PLATFORMS, webCapturePlatform, webCapturePatterns, webConversation, webCaptureSite, type WebHistoryPage, type WebCapturePlatform, type WebCaptureTab, type WebPageInspection } from "../shared/web-capture";
import type { ConversationCapture } from "../shared/types";
import type { AtlasMessage, CaptureCommandResponse } from "../shared/messages";

/** Supported source sites activate as soon as browser permission is available. */
export function createWebCaptureManager(scriptFile: string) {
  let queue: Promise<unknown> = Promise.resolve();
  let importing=false;
  const permitted = async (platform: WebCapturePlatform) => chrome.permissions.contains({origins:webCapturePatterns(platform)});
  const id = (platform: WebCapturePlatform) => `atlas-web-capture-${platform}`;
  async function register(platform: WebCapturePlatform, active: boolean) {
    const scriptId=id(platform);
    const registered=await chrome.scripting.getRegisteredContentScripts({ids:[scriptId]});
    if (!active) { if(registered.length)await chrome.scripting.unregisterContentScripts({ids:[scriptId]}); return; }
    const registration={id:scriptId,matches:webCapturePatterns(platform),js:[scriptFile],persistAcrossSessions:true,runAt:"document_idle" as const};
    if(registered.length)await chrome.scripting.updateContentScripts([registration]);
    else await chrome.scripting.registerContentScripts([registration]);
    const tabs=await chrome.tabs.query({url:webCapturePatterns(platform)});
    await Promise.all(tabs.map(async tab=>{
      if(tab.id===undefined)return;
      try{const response=await chrome.tabs.sendMessage(tab.id,{type:"ATLAS_WEB_PAGE_INSPECT"});if(response?.state)return;}catch{/* A pre-update tab needs injection. */}
      try{await chrome.scripting.executeScript({target:{tabId:tab.id},files:[scriptFile]});}catch{/* A navigating tab gets the registered script on its next load. */}
    }));
  }
  const serialize=<T>(work:()=>Promise<T>):Promise<T>=>{const next=queue.catch(()=>undefined).then(work);queue=next;return next;};
  async function requireEnabled(platform: WebCapturePlatform) {
    if (!webCapturePlatform(platform) || !await permitted(platform)) throw Error("Page capture is disabled or website access was revoked");
  }
  async function inspectTab(tabId: number): Promise<WebPageInspection> {
    try {
      const result = await chrome.tabs.sendMessage(tabId, {type:"ATLAS_WEB_PAGE_INSPECT"} satisfies AtlasMessage) as WebPageInspection;
      if (!result || !["ready","streaming","empty","unsupported","disabled"].includes(result.state) || !Number.isSafeInteger(result.messageCount) || result.messageCount < 0) throw Error("Invalid page response");
      return result;
    } catch { return {state:"disconnected",messageCount:0}; }
  }
  return {
    async history(platform:WebCapturePlatform,tabId:number):Promise<WebHistoryPage>{
      await requireEnabled(platform);
      const tab=await chrome.tabs.get(tabId);
      if(!tab.url||webCaptureSite(tab.url)?.id!==platform)throw Error("The source tab changed. Check open conversations again.");
      const page=await chrome.tabs.sendMessage(tabId,{type:"ATLAS_WEB_HISTORY_PAGE"} satisfies AtlasMessage) as WebHistoryPage;
      const current=await chrome.tabs.get(tabId);
      if(current.url!==tab.url||!Array.isArray(page?.entries))throw Error("The source tab changed or disconnected.");
      await requireEnabled(platform);
      const entries=page.entries.slice(0,200).filter(entry=>{
        const expected=webConversation(entry.url);
        return expected?.id===entry.conversationId&&new URL(entry.url).origin===new URL(tab.url!).origin&&typeof entry.title==="string";
      });
      return {entries:[...new Map(entries.map(entry=>[entry.conversationId,entry])).values()],scope:"loaded"};
    },
    async importHistory(platform:WebCapturePlatform,url:string,conversationId:string):Promise<CaptureCommandResponse>{
      await requireEnabled(platform);
      const thread=webConversation(url);
      if(!thread||thread.site.id!==platform||thread.id!==conversationId)throw Error("Invalid conversation address");
      if(importing)throw Error("A conversation import is already running. Please wait.");
      importing=true;let owned:number|undefined,takenOver=false;
      const activated=(info:chrome.tabs.TabActiveInfo)=>{if(info.tabId===owned)takenOver=true;};
      chrome.tabs.onActivated?.addListener(activated);
      try{
        const created=await chrome.tabs.create({url:thread.url,active:false});owned=created.id;
        if(owned===undefined)throw Error("Could not open the conversation");
        let stable=0,lastCount=0;
        // Bounded one-at-a-time import. A stable rendered window is still partial.
        for(let attempt=0;attempt<40;attempt++){
          await new Promise(resolve=>setTimeout(resolve,400));
          await requireEnabled(platform);
          const current=await chrome.tabs.get(owned);
          if(current.active)takenOver=true;
          if(current.url&&webConversation(current.url)?.id!==conversationId)throw Error("Conversation redirected or requires login. Open the website and retry.");
          const inspection=await inspectTab(owned);
          if(inspection.state==="ready"&&inspection.conversationId===conversationId&&current.status==="complete"){
            stable=lastCount===inspection.messageCount?stable+1:0;lastCount=inspection.messageCount;
            if(stable>=3)return await this.captureTab(platform,owned,conversationId);
          }else stable=0;
        }
        throw Error("The conversation did not finish loading. Open it on the website and retry.");
      }finally{
        importing=false;
        // Only close the tab this operation created, and never after the user takes it over.
        try{if(owned!==undefined){const tab=await chrome.tabs.get(owned);if(!takenOver&&!tab.active&&tab.url&&webConversation(tab.url)?.id===conversationId)await chrome.tabs.remove(owned);}}catch{/* Already closed. */}
        finally{chrome.tabs.onActivated?.removeListener(activated);}
      }
    },
    async tabs(platform: WebCapturePlatform): Promise<WebCaptureTab[]> {
      await requireEnabled(platform);
      const tabs = await chrome.tabs.query({url:webCapturePatterns(platform)});
      const results: WebCaptureTab[] = [];
      for (const tab of tabs) {
        if (tab.id === undefined || !tab.url) continue;
        const inspected = await inspectTab(tab.id), expected = webConversation(tab.url);
        const valid = inspected.conversationId === expected?.id;
        results.push({tabId:tab.id,title:tab.title ?? "",url:tab.url,...(valid?inspected:{state:"disconnected",messageCount:0})});
      }
      return results;
    },
    async captureTab(platform: WebCapturePlatform, tabId: number, conversationId: string): Promise<CaptureCommandResponse> {
      await requireEnabled(platform);
      const tab = await chrome.tabs.get(tabId), expected = tab.url ? webConversation(tab.url) : undefined;
      if (!expected || expected.site.id !== platform || expected.id !== conversationId) throw Error("Conversation changed. Refresh the open conversations list.");
      const inspection = await inspectTab(tabId);
      if (inspection.state !== "ready" || inspection.conversationId !== conversationId) throw Error("Conversation is not ready. Wait for the reply to finish and refresh.");
      const response = await chrome.tabs.sendMessage(tabId, {type:"ATLAS_CAPTURE_NOW",conversationId} satisfies AtlasMessage) as CaptureCommandResponse;
      if (!response?.ok || response.summary?.conversationId !== conversationId) throw Error(response?.error ?? "The selected conversation was not saved. Refresh and retry.");
      return response;
    },
    restore() {
      if(!chrome.storage?.local||!chrome.permissions?.contains||!chrome.scripting?.getRegisteredContentScripts)return Promise.resolve();
      return serialize(async()=>{
        const sites = await Promise.all(WEB_CAPTURE_PLATFORMS.map(async ({id}) => ({id, active:await permitted(id)})));
        await chrome.storage.local.set({[WEB_CAPTURE_KEY]:sites.filter(site=>site.active).map(site=>site.id)});
        await Promise.all(sites.map(site=>register(site.id,site.active)));
      });
    },
    async accepts(capture: ConversationCapture, url?: string) {
      const expected=url?webConversation(url):undefined, source=webConversation(capture.conversation.url);
      if(!expected||expected.site.id!==capture.conversation.platform||!await permitted(expected.site.id))return false;
      return capture.conversation.id===expected.id&&capture.conversation.source===`${expected.site.id}_dom`&&source?.site.origin===expected.site.origin&&source?.id===expected.id;
    },
  };
}
