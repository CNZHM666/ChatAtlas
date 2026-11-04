import {isNativePanelSite,nativePanelPath} from "../shared/sidecar-scope";
export {isNativePanelSite} from "../shared/sidecar-scope";

/** A single window panel follows its active tab; tab changes never close or reopen it. */
export function registerNativeSidePanels() {
 if(chrome.sidePanel?.setOptions)void chrome.sidePanel.setOptions({path:nativePanelPath(),enabled:true}).catch(()=>undefined);
 return ()=>{};
}

/** Called only from a user gesture, after checking the actual caller's URL. */
export async function openNativeSidePanel(tabId:number,url:string,windowId?:number) {
 if(!chrome.sidePanel?.open||!chrome.sidePanel?.setOptions)return {ok:false,unsupported:true};
 if(!isNativePanelSite(url))return {ok:false,unsupported:true};
 // Do not await setup or a tabs query before open: both can lose transient activation.
 const configured=chrome.sidePanel.setOptions({path:nativePanelPath(),enabled:true});
 const opened=chrome.sidePanel.open(windowId===undefined?{tabId}:{windowId});
 await Promise.all([configured,opened]);return {ok:true};
}
