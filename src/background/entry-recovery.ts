/** Restore the existing ChatGPT entry after an extension reload or a replaced page.
 * This only repairs the content bridge; it never opens a panel or starts an import.
 */
export function registerChatGPTEntryRecovery(deps:{ping:(tabId:number)=>Promise<boolean>;inject:(tabId:number)=>Promise<void>}) {
 let live=true;
 const pending=new Map<number,Promise<void>>();
 const supported=(url?:string)=>{try{return new URL(url??"").origin==="https://chatgpt.com";}catch{return false;}};
 const repair=(id:number)=>{
  const current=pending.get(id);if(current)return current;
  const work=Promise.resolve().then(async()=>{
   const tab=await chrome.tabs.get(id);if(!live||!supported(tab.url))return;
   if(await deps.ping(id))return;
   // Navigation can finish while the old receiver is being checked.
   const latest=await chrome.tabs.get(id);if(live&&supported(latest.url))await deps.inject(id);
  }).catch(()=>undefined).finally(()=>{if(pending.get(id)===work)pending.delete(id);});
  pending.set(id,work);return work;
 };
 const activated=(info:chrome.tabs.TabActiveInfo)=>{void repair(info.tabId);};
 const updated=(id:number,change:chrome.tabs.TabChangeInfo,tab:chrome.tabs.Tab)=>{if(change.status==="complete"&&tab.active&&supported(tab.url))void repair(id);};
 chrome.tabs.onActivated?.addListener(activated);chrome.tabs.onUpdated.addListener(updated);
 return {
  repairOpenTabs:async()=>{try{const tabs=await chrome.tabs.query({url:"https://chatgpt.com/*"});if(live)await Promise.all(tabs.map(tab=>tab.id===undefined?undefined:repair(tab.id)));}catch{/* A closing browser can reject tab access. */}},
  dispose:()=>{live=false;chrome.tabs.onActivated?.removeListener(activated);chrome.tabs.onUpdated.removeListener(updated);},
 };
}
