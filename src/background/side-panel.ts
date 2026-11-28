import {isNativePanelSite} from "../shared/sidecar-scope";
export {isNativePanelSite} from "../shared/sidecar-scope";

/** Called only from a user gesture, after checking the actual caller's URL. */
export async function openNativeSidePanel(tabId:number,url:string,windowId?:number) {
 if(!chrome.sidePanel?.open)return {ok:false,unsupported:true};
 if(!isNativePanelSite(url))return {ok:false,unsupported:true};
 // The manifest already configures the shared panel. Open it during the gesture.
 await chrome.sidePanel.open(windowId===undefined?{tabId}:{windowId});
 return {ok:true};
}
