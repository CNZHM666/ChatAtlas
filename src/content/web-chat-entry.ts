import type {AtlasMessage} from "../shared/messages";

/** Small native-panel entry. No transcript, project content or iframe in host DOM. */
export function webChatEntry(){
 const id="atlas-web-chat-entry";
 const ensure=()=>{
  if(document.getElementById(id)||!document.body)return;
  const button=document.createElement("button");button.id=id;button.type="button";button.textContent="ChatAtlas";
  button.setAttribute("aria-label","ChatAtlas · Ctrl+Shift+Y");
  button.style.cssText="position:fixed;right:12px;top:76px;z-index:2147482000;padding:8px 12px;border:1px solid #22c55e66;border-radius:9px;background:Canvas;color:CanvasText;font:600 13px system-ui;cursor:pointer";
  button.addEventListener("click",()=>{void chrome.runtime.sendMessage({type:"ATLAS_OPEN_SIDEPANEL"} satisfies AtlasMessage).then(result=>{if(!result?.ok)return chrome.runtime.sendMessage({type:"ATLAS_OPEN"} satisfies AtlasMessage);}).catch(()=>chrome.runtime.sendMessage({type:"ATLAS_OPEN"} satisfies AtlasMessage));});
  document.body.append(button);
 };
 return {ensure,remove:()=>document.getElementById(id)?.remove()};
}
