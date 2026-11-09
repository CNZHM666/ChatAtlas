import { enabledWebCapturePlatforms, webCaptureSite, WEB_CAPTURE_KEY } from "../shared/web-capture";
import type { AtlasMessage, CaptureCommandResponse } from "../shared/messages";
import { buildConversationCapture } from "./capture-builder";
import { WebChatAdapter } from "./web-chat-adapter";
import { PageCapture } from "./page-capture";
import {locateDiscussion} from "./locate-discussion";
import {fillProjectComposer} from "./project-handoff";
import {webChatEntry} from "./web-chat-entry";
import {readWebChatHistory} from "./web-chat-history";
import {pageTheme,watchPageTheme} from "./page-theme";

const site = webCaptureSite(location.href);
if (site) {
  const host = window as Window & { __chatAtlasWebCaptureDispose?: () => void };
  host.__chatAtlasWebCaptureDispose?.();
  const adapter = new WebChatAdapter(site.id);
  const entry=webChatEntry();
  const capture = new PageCapture(async () => {
    if (adapter.isStreaming()) return null;
    const address = location.href, batch = await buildConversationCapture(adapter);
    return location.href === address && !adapter.isStreaming() ? batch : null;
  }, async batch => {
    return await chrome.runtime.sendMessage({ type: "ATLAS_CAPTURE_BATCH", capture: batch } satisfies AtlasMessage) as CaptureCommandResponse;
  });
  let enabled = false, disposed = false, address = location.href, settingsRevision = 0;
  capture.pause();
  const schedule = () => { if (enabled) {capture.schedule();entry.ensure();} };
  const observer = new MutationObserver(schedule);
  const apply = (value: unknown) => {
    if (disposed) return;
    enabled = enabledWebCapturePlatforms(value).includes(site.id);
    observer.disconnect();
    if (enabled) { capture.resume(); observer.observe(document.documentElement, {childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["data-is-streaming","aria-busy","hidden","aria-hidden"]}); capture.schedule(250); }
    else {capture.pause();entry.remove();}
    if(enabled)entry.ensure();
  };
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "local" && changes[WEB_CAPTURE_KEY]) { settingsRevision++; apply(changes[WEB_CAPTURE_KEY].newValue); } };
  const message = (value: AtlasMessage, _sender: chrome.runtime.MessageSender, reply: (response: unknown) => void) => {
    if(value.type==="ATLAS_PAGE_THEME"){reply({theme:pageTheme()});return false;}
    if(value.type==="ATLAS_PING"){reply({ready:enabled,conversation:adapter.detectConversation()});return false;}
    if(value.type==="ATLAS_WEB_HISTORY_PAGE"){reply(enabled?readWebChatHistory():{entries:[],scope:"loaded"});return false;}
    if(value.type==="ATLAS_FILL_COMPOSER"){if(!enabled){reply({ok:false,reason:"unavailable"});return false;}void fillProjectComposer(value.text,value.conversationId,location.href,()=>adapter.composer()).then(reply).catch(()=>reply({ok:false,reason:"failed"}));return true;}
    if(value.type==="ATLAS_LOCATE_MESSAGE"){
      if(!enabled){reply({ok:false});return false;}
      void locateDiscussion(adapter,value.conversationId,value.identity).then(ok=>reply({ok})).catch(()=>reply({ok:false}));return true;
    }
    if (value.type === "ATLAS_WEB_PAGE_INSPECT") { reply(enabled ? adapter.inspect() : {state:"disabled",messageCount:0}); return false; }
    if (value.type !== "ATLAS_CAPTURE_NOW") return false;
    if (value.conversationId && value.conversationId !== adapter.detectConversation()?.id) { reply({ok:false,error:"Conversation changed. Refresh the open conversations list."}); return false; }
    void capture.capture(true).then(reply).catch(error => reply({ok:false,error:String(error)})); return true;
  };
  const navigation = setInterval(() => { if (location.href !== address) { address = location.href; schedule(); } }, 1000);
  const hidden = () => capture.pause(), restored = () => { if (enabled) { capture.resume(); schedule(); } };
  window.addEventListener("pagehide", hidden); window.addEventListener("pageshow", restored);
  chrome.storage.onChanged.addListener(changed); chrome.runtime.onMessage.addListener(message);
  // The side panel matches the site's light or dark theme as it changes.
  const unwatchTheme = watchPageTheme(theme => { void chrome.runtime.sendMessage({ type: "ATLAS_PAGE_THEME_CHANGED", theme } satisfies AtlasMessage).catch(() => undefined); });
  void chrome.storage.local.get(WEB_CAPTURE_KEY).then(value => { if(settingsRevision===0)apply(value[WEB_CAPTURE_KEY]); }).catch(() => {if(settingsRevision===0)capture.pause();});
  host.__chatAtlasWebCaptureDispose = () => {
    disposed = true; enabled = false; observer.disconnect(); unwatchTheme(); capture.pause();entry.remove(); clearInterval(navigation);
    chrome.storage.onChanged.removeListener(changed); chrome.runtime.onMessage.removeListener(message);
    window.removeEventListener("pagehide", hidden); window.removeEventListener("pageshow", restored);
  };
}
