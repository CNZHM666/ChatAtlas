import {webConversation,webCaptureSite,type WebHistoryPage} from "../shared/web-capture";

/** Read links already exposed by the website. Never infer an account-wide total. */
export function readWebChatHistory(address=location.href):WebHistoryPage {
 const site=webCaptureSite(address),entries=new Map<string,WebHistoryPage["entries"][number]>();
 if(!site)return {entries:[],scope:"loaded"};
 for(const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')){
  if(link.closest('main,[contenteditable="true"],[hidden],[aria-hidden="true"]'))continue;
  let url:URL;try{url=new URL(link.getAttribute('href')!,address);}catch{continue;}
  if(url.origin!==site.origin)continue;
  const thread=webConversation(url.href);
  if(!thread||entries.has(thread.id))continue;
  const title=(link.innerText||link.textContent||link.title||"").replace(/\s+/gu," ").trim();
  if(!title)continue;
  entries.set(thread.id,{conversationId:thread.id,url:thread.url,title});
  if(entries.size===200)break;
 }
 return {entries:[...entries.values()],scope:"loaded"};
}
