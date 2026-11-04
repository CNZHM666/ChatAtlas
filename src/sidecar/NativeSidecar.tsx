import {useEffect,useState} from "react";
import {SidecarHeader} from "./SidecarHeader";
import {useSidecarLocale} from "./sidecar-locale";
import {SidecarProject} from "./SidecarProject";
import {setNativeSidecarTab} from "./host";
import {chatGPTConversationId} from "../shared/native-discussion";
import {isNativePanelSite} from "../shared/sidecar-scope";
import {webConversation,webCaptureSite} from "../shared/web-capture";
import {platformName} from "../shared/platforms";

export function NativeSidecar({zh:initialChinese,tabId}:{zh:boolean;tabId?:number}) {
 const [zh,toggleLanguage]=useSidecarLocale(initialChinese);
 const [tab,setTab]=useState<chrome.tabs.Tab>();
 useEffect(()=>{
  let live=true,revision=0,ownWindow:number|undefined;
  const refresh=async()=>{const run=++revision;setNativeSidecarTab(undefined);let next:chrome.tabs.Tab|undefined;try{next=tabId===undefined?(await chrome.tabs.query({active:true,...(ownWindow===undefined?{currentWindow:true}:{windowId:ownWindow})}))[0]:await chrome.tabs.get(tabId);}catch{/* Restricted or closing tabs cannot receive actions. */}if(live&&run===revision){setNativeSidecarTab(isNativePanelSite(next?.url)?next?.id:undefined);setTab(next);}};
  const activated=(info:chrome.tabs.TabActiveInfo)=>{if(tabId===undefined&&info.windowId===ownWindow)void refresh();};
  const updated=(id:number,change:chrome.tabs.TabChangeInfo,updatedTab:chrome.tabs.Tab)=>{if((tabId===undefined?updatedTab.windowId===ownWindow&&updatedTab.active:id===tabId)&&(change.url||change.title))void refresh();};
  if(tabId!==undefined)void refresh();
  else void chrome.windows.getCurrent().then(window=>{ownWindow=window.id;return refresh();}).catch(()=>{if(live){setNativeSidecarTab(undefined);setTab(undefined);}});
  chrome.tabs.onActivated.addListener(activated);chrome.tabs.onUpdated.addListener(updated);
  return()=>{live=false;revision++;setNativeSidecarTab(undefined);chrome.tabs.onActivated.removeListener(activated);chrome.tabs.onUpdated.removeListener(updated);};
 },[tabId]);
 if(tabId!==undefined&&tab&&!isNativePanelSite(tab.url))return null;
 if(tabId!==undefined&&tab?.id!==tabId)return <SidecarHeader zh={zh} onToggleLanguage={toggleLanguage} showBrand={false}/>;
 let conversation="",canInsert=false,platformLabel="";
 try{const url=new URL(tab?.url??"");const site=webCaptureSite(url.href);platformLabel=site?platformName(site.id,zh?"zh-CN":"en"):url.origin==="https://chatgpt.com"?"ChatGPT":"";if(url.origin==="https://chatgpt.com")conversation=chatGPTConversationId(url.pathname)??"";else conversation=webConversation(url.href)?.id??"";canInsert=isNativePanelSite(url.href);}catch{/* A browser/system tab still supports local history search. */}
 return <SidecarProject onToggleLanguage={toggleLanguage} canInsert={canInsert} platformLabel={platformLabel} conversationId={conversation} conversationTitle={isNativePanelSite(tab?.url)?tab?.title??"":""} zh={zh}/>;
}
