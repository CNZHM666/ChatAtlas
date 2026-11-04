import {useEffect,useState,type ReactNode} from "react";
import {createPortal} from "react-dom";
import {ChevronDown,RotateCw} from "lucide-react";
import type {FocusEvidence,FocusSession,WikiScopeReview} from "../../shared/focus-session";
import {wikiScopeConflictChapters} from "../../shared/wiki-scope-conflicts";
import {WikiScopeReaderPanel} from "./WikiScopeReaderPanel";

export interface WikiScopeChoice { includeKeys:string[]; excludeKeys:string[]; ignoredKeys?:string[] }
type Material=WikiScopeReview["materials"][number];
type Decision="include"|"exclude"|"ignore";

/** Only explicit outside-project suggestions appear in the primary list.
 * Unchecked/uncertain material is not evidence of irrelevance. Decisions are
 * staged together and retained history stays recoverable. The reading pane
 * opens only when the user asks to read a material, and stays closed after. */
export function WikiScopeNotice({session,zh,busy,reviewing,onApply,onRetry,onSource,readerHost,onRead}:{session:FocusSession;zh:boolean;busy?:boolean;reviewing?:boolean;onApply:(choice:WikiScopeChoice)=>void;onExclude?:(key:string)=>void;onRetry?:()=>void;onSource:(ref:FocusEvidence)=>void;readerHost?:HTMLElement|null;onRead?:()=>void}){
 const review=session.wikiScopeReview;
 const [staged,setStaged]=useState<Record<string,Decision>>({});
 const [readingKey,setReadingKey]=useState<string|null>(null),[showUncertain,setShowUncertain]=useState(false);
 // A new review clears staged choices only; it never reopens a closed reading pane.
 useEffect(()=>{setStaged({});},[review]);
 const l=(cn:string,en:string)=>zh?cn:en;
 const ignoredKeys=new Set(review?.ignoredKeys??[]);
 const ignored=(review?.materials??[]).filter(item=>(item.keys??[item.key]).every(key=>ignoredKeys.has(key)));
 const materials=(review?.materials??[]).filter(item=>!ignored.includes(item)),incomplete=review?.status!=="complete";
 const conflicts:Material[]=wikiScopeConflictChapters(session.sections).filter(chapter=>!(chapter.wikiMaterialKeys?.length&&chapter.wikiMaterialKeys.every(key=>review?.includeKeys.includes(key)||materials.some(item=>item.key===key&&item.kind==="reference")))).map(chapter=>({id:chapter.id,key:chapter.wikiMaterialKeys?.[0]??`chapter:${chapter.id}`,keys:chapter.wikiMaterialKeys,title:chapter.title,body:chapter.body,evidenceIds:chapter.evidenceIds,kind:"uncertain",reason:l("目录把本章描述为项目外内容，但它仍在正文中。请确认是本项目的相关参考，还是应移出的旁支。","The outline describes this chapter as outside the project, yet it remains in the Wiki. Decide whether it is a relevant reference or side material."),quote:""}));
 const conflictKeys=new Set(conflicts.flatMap(item=>item.keys??[]));
 const unchecked:Material[]=(review?.unreviewed??[]).filter(item=>!conflictKeys.has(item.key)&&!ignoredKeys.has(item.key)).map(item=>({...item,kind:"uncertain",quote:"",reason:item.reason==="context_omitted"?l("核对上下文不完整，尚未确定归属。","Review context is incomplete; membership is undecided."):item.reason==="invalid_receipt"?l("范围核对记录无效，尚未确定归属。","The scope receipt is invalid; membership is undecided."):l("缺少范围核对记录，尚未确定归属。","No scope receipt is available; membership is undecided.")}));
 const pending=materials.filter(item=>item.kind==="other"&&!item.userExcluded&&!(item.keys??[item.key]).every(key=>review?.includeKeys.includes(key)));
 const uncertain=materials.filter(item=>item.kind==="uncertain"&&!item.userExcluded&&!(item.keys??[item.key]).every(key=>review?.includeKeys.includes(key)));
 const excluded=materials.filter(item=>item.userExcluded);
 const choices=[...materials,...ignored,...conflicts,...unchecked];
 const candidates=[...conflicts,...pending];
 const reviewable=[...candidates,...uncertain];
 const archived=[...excluded,...ignored];
 const reading=readingKey?[...reviewable,...archived].find(item=>item.key===readingKey):undefined;
 const readingMaterials=reading&&reviewable.includes(reading)?reviewable:archived;
 const read=(key:string)=>{setReadingKey(key);onRead?.();};
 // The header names only what needs a decision first; the other counts wait in
 // one footnote below. Related material is never counted; unchecked stays in the Wiki.
 const counts=candidates.length?l(`项目外 ${candidates.length} 项待确认`,`${candidates.length} outside-project suggestions`):"";
 const uncertainCount=uncertain.length?l(`归属不确定 ${uncertain.length} 项`,`${uncertain.length} uncertain`):"",uncheckedCount=unchecked.length?l(`未核对 ${unchecked.length} 项`,`${unchecked.length} unchecked`):"";
 const status=reviewing?l("正在核对","Reviewing"):counts||uncertainCount||uncheckedCount||(incomplete?l("核对未完成","Review incomplete"):l("AI 未提出旁支内容","No side material proposed by AI"));
 const changes=Object.keys(staged).length;
 const toggle=(key:string,decision:Decision)=>setStaged(current=>{const next={...current};if(next[key]===decision)delete next[key];else next[key]=decision;return next;});
 const apply=()=>{
  const include=new Set(review?.includeKeys??[]),exclude=new Set(review?.excludeKeys??[]),ignored=new Set(review?.ignoredKeys??[]);
  // A whole chapter left out in the preview covers several notes; bringing it back restores all of them.
  for(const [key,decision] of Object.entries(staged))for(const each of choices.find(item=>item.key===key)?.keys??[key]){
   (decision==="include"?include:exclude).add(each);(decision==="include"?exclude:include).delete(each);
   if(decision==="ignore")ignored.add(each);else ignored.delete(each);
  }
  onApply({includeKeys:[...include],excludeKeys:[...exclude],...(ignored.size||review?.ignoredKeys?.length?{ignoredKeys:[...ignored]}:{})});
 };
 const action=(item:Material,decision:Decision,label:string)=><button type="button" className="wiki-scope-action" aria-pressed={staged[item.key]===decision} disabled={busy||item.key.startsWith("chapter:")} onClick={()=>toggle(item.key,decision)}>{label}</button>;
 const tag=(item:Material)=>conflicts.includes(item)?l("目录标为项目外","Outline says outside"):pending.includes(item)?l("AI 建议移出本项目","AI suggests moving out"):"";
 const group=(item:Material,actions:ReactNode)=><div className="wiki-scope-actions" role="group" aria-label={l(`${item.title}的归属`,`${item.title} membership`)}>{actions}</div>;
 // Title and AI tag, the reason in one line, then the choice and a quiet read link.
 const row=(item:Material,actions:ReactNode)=>{
  return <li className="wiki-scope-material" key={item.key} data-staged={staged[item.key]??undefined}>
   <div className="wiki-scope-material-text">
    <div className="wiki-scope-material-heading"><strong>{item.title}</strong>{tag(item)?<span className="wiki-scope-tag">{tag(item)}</span>:null}</div>
    {item.reason?<p className="wiki-scope-reason">{item.reason}</p>:null}
    {item.keys&&item.keys.length>1?<small className="wiki-scope-unit">{l(`整章 · ${item.keys.length} 项材料`,`Whole chapter · ${item.keys.length} materials`)}</small>:null}
   </div>
   <div className="wiki-scope-material-controls">{group(item,actions)}<button type="button" className="wiki-scope-read" aria-label={l(`阅读材料：${item.title}`,`Read material: ${item.title}`)} aria-pressed={reading?.key===item.key} onClick={()=>read(item.key)}>{l("查看原文","Read originals")}</button></div>
  </li>;
 };
 const needsReview=Boolean(reviewable.length||incomplete&&!reviewing);
 // Opens by itself only for an explicit suggestion or a review that never ran;
 // uncertain and unchecked counts are in the header and wait for the user.
 const opensItself=Boolean(candidates.length||incomplete&&!reviewing&&!uncertain.length&&!unchecked.length);
 const hasChoices=Boolean(reviewable.length);
 const retryControl=!reviewing&&onRetry?<button type="button" className="wiki-scope-retry" title={changes?l("先应用或撤销当前选择，再重新核对","Apply or reset your selections before rechecking"):l("重新核对内容范围","Recheck content scope")} disabled={busy||changes>0} onKeyDown={event=>event.stopPropagation()} onClick={event=>{event.preventDefault();event.stopPropagation();onRetry();}}><RotateCw size={14} strokeWidth={1.8} aria-hidden="true"/>{l("重新核对","Recheck")}</button>:null;
 const reviewActions=(item:Material)=><>{action(item,"include",l("保留本项目","Keep in project"))}{action(item,"exclude",l("移到旁支","Move to side material"))}{action(item,"ignore",l("从本项目移除","Remove from project"))}</>;
 const reader=reading?<WikiScopeReaderPanel key={session.id} material={reading} materials={readingMaterials} session={session} zh={zh} tag={tag(reading)} decision={group(reading,reviewActions(reading))} onSelect={read} onClose={()=>setReadingKey(null)} onSource={onSource}/>:null;
 const footnote=[candidates.length&&uncertain.length?<button key="uncertain" type="button" className="wiki-scope-more" aria-expanded={showUncertain} onClick={()=>setShowUncertain(value=>!value)}>{uncertainCount}</button>:null,
  unchecked.length&&!reviewing?<span key="unchecked">{(counts||uncertainCount)?l(`${uncheckedCount}，仍保留在 Wiki 中，可重新核对`,`${uncheckedCount}, kept in the Wiki; recheck to review`):l("未核对的材料仍保留在 Wiki 中，可重新核对","Unchecked material stays in the Wiki; recheck to review it")}</span>:null].filter(Boolean);
 return <><details className="wiki-scope-notice" data-attention={needsReview||undefined} open={opensItself||undefined}>
  <summary><span className="wiki-scope-counts"><span className="wiki-scope-label">{l("内容范围","Content scope")}</span><span className="wiki-scope-state">{status}</span></span><span className="wiki-scope-header-actions">{retryControl}<span className="wiki-scope-collapse-icon" aria-hidden="true"><ChevronDown className="wiki-scope-chevron" size={16} strokeWidth={1.8}/></span></span></summary>
  {!hasChoices&&incomplete?<div className="wiki-scope-incomplete"><p>{reviewing?l("正在核对内容范围。","Reviewing content scope."):l("范围尚未核对，请重新检查。","Scope has not been reviewed. Recheck it first.")}</p></div>:null}
  {!counts&&!uncertain.length&&!incomplete?<p className="muted">{l("未提出旁支候选，不代表全部内容已确认。","No side material proposed; membership is not guaranteed.")}</p>:null}
  {conflicts.length?<section aria-label={l("章节归属待确认","Chapter scope review")}><ul>{conflicts.map(item=>row(item,reviewActions(item)))}</ul>{conflicts.some(item=>!item.keys?.length)?<p className="muted">{l("请先重新核对，再调整归属。","Recheck scope before changing membership.")}</p>:null}</section>:null}
  {pending.length?<section aria-label={l("待你确认","Needs review")}><ul>{pending.map(item=>row(item,reviewActions(item)))}</ul></section>:null}
  {/* Alone, uncertain rows are the list itself; beside suggestions they stay one level down. */}
  {uncertain.length&&!candidates.length?<section aria-label={l("归属不确定","Uncertain membership")}><p className="muted">{l("逐项确认是否属于本项目；不处理也不影响阅读。","Decide item by item; leaving them does not affect reading.")}</p><ul>{uncertain.map(item=>row(item,reviewActions(item)))}</ul></section>:null}
  {/* Beside suggestions, uncertain rows open from the footnote, at the same level. */}
  {uncertain.length&&candidates.length&&showUncertain?<section aria-label={l("归属不确定","Uncertain membership")}><ul>{uncertain.map(item=>row(item,reviewActions(item)))}</ul></section>:null}
  {footnote.length?<p className="wiki-scope-status">{footnote.flatMap((part,index)=>index?[<span key={`dot:${index}`} aria-hidden="true"> · </span>,part]:[part])}{l("。","")}</p>:null}
  {excluded.length?<details className="wiki-scope-excluded"><summary>{l(`旁支 ${excluded.length}`,`Side material ${excluded.length}`)}</summary><ul>{excluded.map(item=>row(item,reviewActions(item)))}</ul></details>:null}
  {ignored.length?<details className="wiki-scope-excluded"><summary>{l(`已从本项目移除 ${ignored.length} 项`,`Removed from project ${ignored.length}`)}</summary><p className="muted">{l("后续整理继续忽略，原始聊天保留。","Ignored on future updates. Original chats are kept.")}</p><ul>{ignored.map(item=>row(item,reviewActions(item)))}</ul></details>:null}
  {changes?<footer className="wiki-scope-apply"><button type="button" className="primary" disabled={busy} onClick={apply}>{l(`应用 ${changes} 项选择`,`Apply ${changes} selection${changes>1?"s":""}`)}</button><button type="button" className="wiki-scope-reset" disabled={busy} onClick={()=>setStaged({})}>{l("撤销选择","Reset choices")}</button><small>{l("更新预览可能调用模型","Updating the preview may use AI")}</small></footer>:null}
 </details>{readerHost?createPortal(reader,readerHost):readerHost===undefined?reader:null}</>;
}
