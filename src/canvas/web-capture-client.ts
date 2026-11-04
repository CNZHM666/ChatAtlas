import type { AtlasMessage } from "../shared/messages";
import { WEB_CAPTURE_PLATFORMS, webCapturePatterns, type WebHistoryPage, type WebHistoryEntry, type WebCapturePlatform, type WebCaptureStatus, type WebCaptureTab } from "../shared/web-capture";
import type { CaptureCommandResponse } from "../shared/messages";
export const pageCaptureAvailable=()=>typeof chrome!=="undefined"&&Boolean(chrome.runtime?.id&&chrome.permissions?.request);
const empty=()=>WEB_CAPTURE_PLATFORMS.map(item=>({platform:item.id,enabled:false,permitted:false}));
async function command(message:AtlasMessage):Promise<WebCaptureStatus[]>{
  const response=await chrome.runtime.sendMessage(message) as {ok?:boolean;status?:WebCaptureStatus[];error?:string};
  if(!response?.ok||!response.status)throw Error(response?.error??"Could not update page capture");
  return response.status;
}
export function readPageCaptureStatus(){return pageCaptureAvailable()?command({type:"ATLAS_WEB_CAPTURE_STATUS"}):Promise.resolve(empty());}
export async function setPageCapture(platform:WebCapturePlatform,enabled:boolean){
  if(!pageCaptureAvailable())throw Error("Use the installed browser extension");
  if(enabled){
    // Request directly from the click gesture, before waiting for any other work.
    const granted=await chrome.permissions.request({origins:webCapturePatterns(platform)});
    if(!granted)throw Error("Website access was not granted");
  }
  return command({type:"ATLAS_WEB_CAPTURE_SET",platform,enabled});
}
export async function inspectPageCaptureTabs(platform:WebCapturePlatform):Promise<WebCaptureTab[]> {
  const response=await chrome.runtime.sendMessage({type:"ATLAS_WEB_CAPTURE_TABS",platform} satisfies AtlasMessage) as {ok?:boolean;tabs?:WebCaptureTab[];error?:string};
  if(!response?.ok||!response.tabs)throw Error(response?.error??"Could not inspect open conversations");
  return response.tabs;
}
export async function captureOpenTab(platform:WebCapturePlatform,tab:WebCaptureTab):Promise<CaptureCommandResponse> {
  if(!tab.conversationId)throw Error("No conversation selected");
  const response=await chrome.runtime.sendMessage({type:"ATLAS_WEB_CAPTURE_TAB",platform,tabId:tab.tabId,conversationId:tab.conversationId} satisfies AtlasMessage) as CaptureCommandResponse;
  if(!response?.ok)throw Error(response?.error??"Could not save conversation");
  return response;
}
export async function readWebHistory(platform:WebCapturePlatform,tabId:number):Promise<WebHistoryPage>{
  const response=await chrome.runtime.sendMessage({type:"ATLAS_WEB_HISTORY_LIST",platform,tabId} satisfies AtlasMessage);
  if(!response?.ok||!response.page)throw Error(response?.error??"Could not read history");
  return response.page;
}
export async function importWebHistory(platform:WebCapturePlatform,entry:WebHistoryEntry):Promise<CaptureCommandResponse>{
  const response=await chrome.runtime.sendMessage({type:"ATLAS_WEB_HISTORY_IMPORT",platform,url:entry.url,conversationId:entry.conversationId} satisfies AtlasMessage) as CaptureCommandResponse;
  if(!response?.ok)throw Error(response?.error??"Could not import conversation");
  return response;
}
