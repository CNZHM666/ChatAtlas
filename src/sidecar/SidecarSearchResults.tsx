import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, LocateFixed, Search } from "lucide-react";
import type { Conversation, ConversationMessage } from "../shared/types";
import type { MessageSourceRange, ReaderSearchContext } from "../shared/message-location";
import type { NavigationResponse } from "../shared/messages";
import type { MemoryHit } from "./context-engine";
import { sendSidecarMessage } from "./host";
import {memoryDiscussion} from "./context-engine";
import {SidecarMessageContent} from "./SidecarMessageContent";
import {isCurrentNativeConversation} from "../shared/native-discussion";
import {nearMatch,queryPattern} from "./search-excerpt";
import {SidecarReading} from "./SidecarReading";

const originalTime=(hit:MemoryHit)=>{const value=hit.message.sourceCreatedAt;return typeof value==="number"&&Number.isFinite(value)&&value>0&&value<=8.64e15?value:undefined;};
const canLocate=(hit:MemoryHit)=>hit.conversation.platform==="chatgpt"||isCurrentNativeConversation(hit.conversation.url,hit.conversation.id);

/** An excerpt with the searched words marked. */
function marked(text:string,query:string):ReactNode{
  const pattern=queryPattern(query);
  if(!pattern)return text;
  return text.split(pattern).map((part,index)=>index%2?<mark key={index}>{part}</mark>:part);
}

function DiscussionPreview({hit,zh}:{hit:MemoryHit;zh:boolean}){
  const [messages,setMessages]=useState<ConversationMessage[]>();
  useEffect(()=>{let live=true;setMessages(undefined);void memoryDiscussion(hit).then(rows=>{
    const source=rows.find(message=>message.id===hit.message.id);
    if(live&&source?.content===hit.message.content)setMessages(rows);
  }).catch(()=>undefined);return()=>{live=false;};},[hit]);
  if(!messages?.length)return <p>{hit.excerpt}</p>;
  const question=messages.find(message=>message.role==="user");
  return <div className="memory-discussion-preview">
    {question&&question.id!==hit.message.id?<blockquote>{question.content}</blockquote>:null}
    <p className="memory-match-excerpt">{hit.excerpt}</p>
    <details><summary>{zh?"前后问答":"Conversation context"}</summary><div className="memory-originals">{messages.map(message=><section key={message.id} data-role={message.role}><small>{message.role==="user"?(zh?"我":"Me"):(zh?"AI 回复":"AI reply")}</small><SidecarMessageContent message={message} sourceUrl={hit.conversation.url??""} zh={zh}/></section>)}</div></details>
  </div>;
}

export function SidecarSearchResults({ hits, conversationId, zh, onOpen, order = "relevance",previewFirst=false,compact=false,query="",canInsert=false }: {
  compact?:boolean;
  /** The native input can take a question turn read in the sidebar. */
  canInsert?:boolean;
  /** The searched words, marked in each excerpt. */
  query?:string;
  previewFirst?:boolean;
  order?: "relevance" | "newest" | "oldest"; hits: MemoryHit[]; conversationId: string; zh: boolean;
  onOpen: (conversation: Conversation, message?: ConversationMessage, range?: MessageSourceRange, search?: ReaderSearchContext) => void;
}) {
  const l = (cn: string, en: string) => zh ? cn : en;
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [locating, setLocating] = useState(""), [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [selected, setSelected] = useState("");
  const [showOther,setShowOther]=useState(false),[expanded,setExpanded]=useState<string[]>([]);
  // The match read in the sidebar, and where the list was scrolled, so returning lands on the same card.
  const [reading,setReading]=useState<{id:string;at:number}>();
  const list=useRef<HTMLDivElement>(null),listScroll=useRef(0);
  useLayoutEffect(()=>{if(reading)return;const scroller=list.current?.closest<HTMLElement>(".memory-found");if(scroller)scroller.scrollTop=listScroll.current;},[reading]);
  const dated = [...hits].sort((a,b) => { if(order === "relevance")return 0; const x=originalTime(a), y=originalTime(b); if(!x)return y?1:0;if(!y)return -1;return order === "newest"?y-x:x-y; });
  const groups = new Map<string, MemoryHit[]>();
  for (const hit of dated) groups.set(hit.conversation.id, [...groups.get(hit.conversation.id) ?? [], hit]);
  const matchingGroups=[...groups].filter(([id])=>!groups.has(selected)||id===selected);
  const visibleGroups=previewFirst&&!showOther?matchingGroups.slice(0,1):matchingGroups;
  // Reader receives this conversation's matches, so it can step through them like the workbench search.
  const searchFor = (hit: MemoryHit): ReaderSearchContext | undefined => query.trim() ? { query: query.trim(), hits: (groups.get(hit.conversation.id) ?? [hit]).map(item => ({ messageId: item.message.id, excerpt: item.excerpt, ...(item.sourceRange ? { sourceRange: item.sourceRange } : {}) })) } : undefined;
  const locate = async (hit: MemoryHit) => {
    setLocating(hit.id); setNotice(""); setFailed(false);
    try {
      const result = await sendSidecarMessage({ type: hit.conversation.id === conversationId ? "ATLAS_SIDECAR_LOCATE" : "ATLAS_SIDECAR_OPEN_ORIGINAL", conversationId: hit.conversation.id, messageId: hit.message.id }) as NavigationResponse & { located?: boolean; reader?: "far" | "unknown" };
      // The platform keeps only a few turns loaded; a question far back would take dozens of loads to reach.
      // Reader opens at it directly, which is the same reading place.
      if (result?.reader) { onOpen(hit.conversation, hit.message, hit.sourceRange, searchFor(hit)); if (live.current) { setFailed(false); setNotice(result.reader === "far" ? l("这条讨论在对话较早的位置，原平台需要逐段加载，已在 Reader 中直接打开。", "This is far back in the chat; the platform loads it piece by piece, so it opened in Reader.") : l("原平台暂时无法定位这条讨论，已在 Reader 中直接打开。", "The platform could not locate it, so it opened in Reader.")); } return; }
      if (live.current) { setFailed(!result?.ok); setNotice(result?.ok ? result.located === false ? l("已打开原始对话，暂未找到对应问题，可在 Reader 阅读。", "Original chat opened; question unavailable. Read in Reader.") : l("已定位原文", "Original located") : result?.error || l("暂未定位到原文，可重试或在 Reader 阅读。", "Could not locate the original. Retry or read in Reader.")); }
    } catch {
      if (live.current) { setFailed(true); setNotice(l("本次定位未完成，可重试或在 Reader 阅读。", "Location failed. Retry or read in Reader.")); }
    } finally { if (live.current) setLocating(""); }
  };
  if (!hits.length) return <div className="memory-search-empty"><Search size={22} aria-hidden="true"/><strong>{l("未找到相关对话", "No matching conversations")}</strong></div>;
  // One card per conversation: a click reads its best match in the sidebar, beside the AI page, which stays where it
  // is; a conversation's other matches are one line each and open alike. The full Reader is one icon away.
  const read=(hit:MemoryHit)=>{const rows=groups.get(hit.conversation.id)??[hit];listScroll.current=list.current?.closest<HTMLElement>(".memory-found")?.scrollTop??0;setNotice("");setReading({id:hit.conversation.id,at:Math.max(0,rows.indexOf(hit))});};
  const openReader=(hit:MemoryHit)=>onOpen(hit.conversation,hit.message,hit.sourceRange,searchFor(hit));
  if(compact&&reading&&groups.has(reading.id))return <SidecarReading key={reading.id} hits={groups.get(reading.id)!} start={reading.at} query={query} zh={zh} canInsert={canInsert} conversationId={conversationId}
    onBack={()=>setReading(undefined)} onOpenReader={openReader}/>;
  if(compact)return <div className="memory-source-list" ref={list}>
    <small>{l("相关对话","Related chats")} · {groups.size}</small>
    {[...groups].slice(0,showOther?groups.size:5).map(([id,rows])=>{const [best,...more]=rows,open=expanded.includes(id),time=originalTime(best);return <article className="memory-source-card" key={id}>
      <div className="memory-source-head">
        <button type="button" className="memory-source-main" aria-label={l(`在侧栏阅读：${best.conversation.title}`,`Read here: ${best.conversation.title}`)} onClick={()=>read(best)}>
          <strong>{best.conversation.title}</strong>
          <small>{[rows.length>1?l(`${rows.length} 处匹配`,`${rows.length} matches`):"",time?new Date(time).toLocaleDateString(zh?"zh-CN":"en"):""].filter(Boolean).join(" · ")}</small>
          <p>{marked(best.excerpt,query)}</p>
        </button>
        <button type="button" className="memory-source-locate" aria-label={l(`在完整 Reader 中打开：${best.conversation.title}`,`Open in the full Reader: ${best.conversation.title}`)} title={l("在完整 Reader 中打开","Open in the full Reader")} onClick={()=>openReader(best)}><BookOpen size={14} aria-hidden="true"/></button>
      </div>
      {more.length?<>
        <button type="button" className="memory-source-more" aria-expanded={open} onClick={()=>setExpanded(open?expanded.filter(item=>item!==id):[...expanded,id])}>{open?l("收起","Show less"):l(`另有 ${more.length} 处`,`${more.length} more`)}</button>
        {open?<ul className="memory-source-matches">{more.map(hit=><li key={hit.id}><button type="button" onClick={()=>read(hit)}><span>{marked(nearMatch(hit.excerpt,query),query)}</span></button></li>)}</ul>:null}
      </>:null}
    </article>;})}
    {groups.size>5?<button type="button" className="sidecar-text-button" onClick={()=>setShowOther(value=>!value)}>{showOther?l("收起","Show less"):l(`更多对话（${groups.size-5}）`,`More chats (${groups.size-5})`)}</button>:null}
    {locating?<p role="status" className="memory-result-notice">{l("正在原平台定位…","Locating on the original platform…")}</p>:notice?<p role={failed?"alert":"status"} className="memory-result-notice">{notice}</p>:null}
  </div>;
  return <div className="memory-search-results">
    <p className="memory-results-count">{l(`找到 ${groups.size} 条对话`, `${groups.size} conversations found`)}</p>
    {groups.size > 1&&!previewFirst ? <select className="memory-conversation-switch" aria-label={l("切换结果对话","Switch result conversation")} value={groups.has(selected)?selected:""} onChange={event=>setSelected(event.target.value)}><option value="">{l("全部匹配对话","All matching conversations")}</option>{[...groups].map(([id,rows])=><option key={id} value={id}>{rows[0].conversation.title} · {rows.length}</option>)}</select> : null}
    {visibleGroups.map(([id, rows],groupIndex) => <section className={`memory-result-group${previewFirst&&groupIndex===0?" is-best-match":""}`} key={id} aria-label={rows[0].conversation.title}>
      <header><h3>{rows[0].conversation.title}</h3><small>{l(`${rows.length} 处匹配`, `${rows.length} matches`)}</small></header>
      <ol>{rows.slice(0, limits[id] ?? (previewFirst?1:3)).map((hit,index) => <li key={hit.id}>
        <small>{l("消息", "Message")} {hit.message.messageIndex + 1} · {hit.message.role === "user" ? l("我的提问", "My question") : l("AI 回复", "AI reply")}</small>
        {previewFirst&&groupIndex===0&&index===0?<DiscussionPreview hit={hit} zh={zh}/>:<p>{hit.excerpt}</p>}{originalTime(hit) ? <time dateTime={new Date(originalTime(hit)!).toISOString()}>{new Date(originalTime(hit)!).toLocaleDateString(zh?"zh-CN":"en")}</time> : null}
        <div className="memory-result-actions">
          {canLocate(hit) ? <button type="button" aria-label={l("在原生 AI 中定位", "Locate in original AI")} disabled={!!locating} onClick={() => void locate(hit)}><LocateFixed size={14} aria-hidden="true"/>{locating === hit.id ? l("定位中…", "Locating…") : previewFirst?l("定位原文","Locate"):l("在原生 AI 中定位", "Locate in original AI")}</button> : null}
          <button type="button" aria-label={l("在 Reader 阅读", "Read in Reader")} onClick={() => onOpen(hit.conversation, hit.message, hit.sourceRange, searchFor(hit))}><BookOpen size={14} aria-hidden="true"/>{l("在 Reader 阅读", "Read in Reader")}</button>
        </div>
      </li>)}</ol>
      {rows.length > (limits[id] ?? (previewFirst?1:3)) ? <button type="button" className="sidecar-text-button memory-result-more" onClick={() => setLimits(values => ({ ...values, [id]: (values[id] ?? (previewFirst?1:3)) + 5 }))}>{l(`更多匹配（${rows.length - (limits[id] ?? (previewFirst?1:3))}）`, `More matches (${rows.length - (limits[id] ?? (previewFirst?1:3))})`)}</button> : null}
    </section>)}
    {previewFirst&&matchingGroups.length>1?<button type="button" className="sidecar-text-button memory-other-matches" aria-expanded={showOther} onClick={()=>setShowOther(value=>!value)}>{showOther?l("收起其他对话","Hide other chats"):l(`其他相关对话（${matchingGroups.length-1}）`,`Other matching chats (${matchingGroups.length-1})`)}</button>:null}
    {locating ? <p role="status" className="memory-result-notice">{l("正在查找并加载原文…", "Finding and loading the original…")}</p> : notice ? <p role={failed ? "alert" : "status"} className="memory-result-notice">{notice}</p> : null}
  </div>;
}
