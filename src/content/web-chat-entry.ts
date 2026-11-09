import type {AtlasMessage} from "../shared/messages";
import {brandLogos} from "../shared/brand-assets";
import {ATLAS_TRIGGER_STYLE} from "./atlas-trigger-style";

/** Small native-panel entry. No transcript, project content or iframe in host DOM. It has the look of ChatGPT's button at
 * the page edge, the brand logo and "ChatAtlas": other AI sites showed a plain text button with a green border. */
export function webChatEntry(){
 const id="atlas-web-chat-entry",styleId="atlas-navigator-trigger-style";
 const zh=/^zh\b/iu.test(navigator.language);
 const dark=()=>document.documentElement.classList.contains("dark")||document.body?.classList.contains("dark")||window.matchMedia?.("(prefers-color-scheme: dark)").matches===true;
 // This script is built on its own, with the logo inlined as a data URL: only a file path is an extension resource.
 const logo=()=>{const source=brandLogos[dark()?"dark":"light"];return source.startsWith("data:")?source:chrome.runtime.getURL(source.replace(/^\//u,""));};
 const ensure=()=>{
  if(!document.body)return;
  const placed=document.getElementById(id);
  if(placed){const image=placed.querySelector("img");if(image&&image.getAttribute("src")!==logo())image.src=logo();return;}
  if(!document.getElementById(styleId)){const style=document.createElement("style");style.id=styleId;style.textContent=ATLAS_TRIGGER_STYLE;(document.head??document.documentElement).append(style);}
  const button=document.createElement("button");button.id=id;button.type="button";button.className="atlas-navigator-trigger atlas-navigator-trigger--edge";
  const label=zh?"ChatAtlas 知识助手":"ChatAtlas knowledge companion";
  button.setAttribute("aria-label",label);button.title=`${label} · Ctrl+Shift+Y`;
  const mark=document.createElement("span");mark.className="atlas-trigger-mark";mark.setAttribute("aria-hidden","true");
  const image=document.createElement("img");image.src=logo();image.alt="";image.width=32;image.height=32;image.draggable=false;mark.append(image);
  const name=document.createElement("span");name.className="atlas-trigger-label";name.textContent="ChatAtlas";
  button.append(mark,name);
  button.addEventListener("click",()=>{void chrome.runtime.sendMessage({type:"ATLAS_OPEN_SIDEPANEL"} satisfies AtlasMessage).then(result=>{if(!result?.ok)return chrome.runtime.sendMessage({type:"ATLAS_OPEN"} satisfies AtlasMessage);}).catch(()=>chrome.runtime.sendMessage({type:"ATLAS_OPEN"} satisfies AtlasMessage));});
  document.body.append(button);
 };
 return {ensure,remove:()=>document.getElementById(id)?.remove()};
}
