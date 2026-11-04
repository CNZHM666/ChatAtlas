import {webCaptureSite} from "./web-capture";
export function isNativePanelSite(value?:string):boolean {
 try { return new URL(value??"").origin==="https://chatgpt.com"||Boolean(value&&webCaptureSite(value)); }
 catch { return false; }
}

export function nativePanelTabId(value:string|null):number|undefined {
 if(value===null||!/^\d+$/u.test(value))return undefined;
 const id=Number(value);return Number.isSafeInteger(id)&&id>=0?id:undefined;
}

export const nativePanelPath=(tabId?:number)=>`sidecar.html?native=1${tabId===undefined?"":`&tabId=${tabId}`}`;
