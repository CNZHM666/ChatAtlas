import {useEffect,useRef,useState} from "react";
import type {WebCapturePlatform,WebHistoryEntry,WebCaptureTab} from "../../shared/web-capture";
import {readWebHistory,importWebHistory} from "../web-capture-client";

export function WebCaptureHistory({platform,tabs,zh}:{platform:WebCapturePlatform;tabs:WebCaptureTab[];zh:boolean}){
 const [entries,setEntries]=useState<WebHistoryEntry[]>([]),[selected,setSelected]=useState<Set<string>>(new Set());
 const [busy,setBusy]=useState(false),[scanned,setScanned]=useState(false),[error,setError]=useState(false);
 const [results,setResults]=useState<Record<string,"saved"|"failed">>({}),[current,setCurrent]=useState("");
 const [sourceTab,setSourceTab]=useState(tabs[0]?.tabId);
 const stop=useRef(false),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;stop.current=true;};},[]);
 const scan=async(tabId:number)=>{
  setBusy(true);setError(false);
  try{const page=await readWebHistory(platform,tabId);if(live.current){setEntries(page.entries);setSelected(new Set());setScanned(true);}}
  catch{if(live.current)setError(true);}finally{if(live.current)setBusy(false);}
 };
 const run=async()=>{
  setBusy(true);stop.current=false;setError(false);
  for(const entry of entries.filter(item=>selected.has(item.conversationId))){
   if(stop.current||!live.current)break;
   setCurrent(entry.title);
   let result:"saved"|"failed"="saved";try{await importWebHistory(platform,entry);}catch{result="failed";}
   if(live.current)setResults(value=>({...value,[entry.conversationId]:result}));
  }
  if(live.current){setCurrent("");setBusy(false);}
 };
 return <div className="web-capture-history">
  <p>{zh?"历史导入：先在原网站展开历史列表。这里只读取网页已加载的标题，最多 200 条；选中后逐条打开后台标签页保存已加载正文。未加载的更早记录仍需在原网站加载或导入文件。":"History import: expand history on the website first. Read up to 200 loaded titles, then import selected conversations through background tabs. Earlier unloaded records need to be loaded on the website or imported from files."}</p>
  <div className="web-capture-history-source">{tabs.length>1?<select aria-label={zh?"历史来源网页":"History source tab"} value={tabs.some(tab=>tab.tabId===sourceTab)?sourceTab:tabs[0]?.tabId} disabled={busy} onChange={event=>setSourceTab(Number(event.target.value))}>{tabs.map(tab=><option key={tab.tabId} value={tab.tabId}>{tab.title||tab.url}</option>)}</select>:null}<button type="button" className="import-button" disabled={busy||!tabs.length} onClick={()=>void scan(tabs.some(tab=>tab.tabId===sourceTab)?sourceTab!:tabs[0].tabId)}>{zh?"读取历史标题":"Read history titles"}</button></div>
  {scanned&&entries.length===0?<p role="status">{zh?"未识别到历史链接。请在原网页展开或滚动历史列表后重试；这不表示账号没有历史记录。":"No history links recognized. Expand or scroll website history and retry; this does not mean your account has no history."}</p>:null}
  <div className="web-capture-history-list">{entries.map(entry=><label key={entry.conversationId}><input type="checkbox" disabled={busy} checked={selected.has(entry.conversationId)} onChange={event=>{const checked=event.target.checked;setSelected(value=>{const next=new Set(value);if(checked)next.add(entry.conversationId);else next.delete(entry.conversationId);return next;});}}/>{entry.title}{results[entry.conversationId]?<small>{results[entry.conversationId]==="saved"?zh?" · 已保存已加载内容":" · Loaded content saved":zh?" · 失败，可重试":" · Failed; retry available"}</small>:null}</label>)}</div>
  {entries.length>0?<button type="button" className="import-button primary" disabled={busy||selected.size===0} onClick={()=>void run()}>{zh?`导入所选（${selected.size}）`:`Import selected (${selected.size})`}</button>:null}
  {current?<><p role="status">{zh?"正在导入：":"Importing: "}{current}</p><button type="button" className="import-button" onClick={()=>{stop.current=true;}}>{zh?"当前条目完成后停止":"Stop after current conversation"}</button></>:null}
  {error?<p role="alert">{zh?"读取失败，请确认网页仍打开且有网站权限后重试。":"Could not read history. Check the open page and website access, then retry."}</p>:null}
 </div>;
}
