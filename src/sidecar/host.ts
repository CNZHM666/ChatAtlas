import type {AtlasMessage} from "../shared/messages";
let nativeTabId:number|undefined;
export const setNativeSidecarTab=(id:number|undefined)=>{nativeTabId=id;};
/** Bind the reviewed action to the tab observed by this native panel, not a guessed active tab. */
export const sendSidecarMessage=async(message:AtlasMessage)=>{
 try{return await chrome.runtime.sendMessage({...message,...(nativeTabId===undefined?{}:{tabId:nativeTabId})});}
 catch(error){
  const detail=error instanceof Error?error.message:String(error);
  if(/message (?:channel|port) closed|asynchronous response|receiving end does not exist|extension context invalidated|could not establish connection/iu.test(detail)){
   const zh=typeof document==="undefined"||document.documentElement.lang.toLowerCase().startsWith("zh");
   throw Error(zh?"ChatAtlas 与页面的连接已中断，请刷新当前 AI 页面并重新打开侧栏后重试。已保存的对话保留。":"ChatAtlas lost its connection. Refresh the AI page and reopen the sidebar to retry. Saved conversations are retained.");
  }
  throw error;
 }
};

export async function sendComposerReference(conversationId: string, text: string, undo = false) {
 const result = await sendSidecarMessage({ type: "ATLAS_SIDECAR_HANDOFF", conversationId, text, ...(undo ? { undo: true } : {}) }) as { ok?: boolean; reason?: string; error?: string };
 if (!result?.ok) throw new Error(result?.reason ?? result?.error);
}
