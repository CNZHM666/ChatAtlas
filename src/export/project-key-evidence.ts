import type {FocusSection,FocusSession} from "../shared/focus-session";
import type {WikiClaim} from "../shared/wiki-claims";
import {factTextKey} from "../shared/project-fact-state";
import {wikiQuoteRange} from "../shared/wiki-claims";
import {wikiSourceReading} from "../shared/wiki-source-reading";
import {resolveWikiReading} from "../ai/wiki-knowledge-reading";
import {wikiLocalAnswer} from "../ai/wiki-question-parse";
import {knowledgeTerms,knowledgeVersion} from "../shared/knowledge-subject";
import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type {Nodes} from "mdast";

type Reading=ReturnType<typeof resolveWikiReading>;
type EvidenceStatus="confirmed"|"open"|"scope"|"historical";
const MAX_ENTRIES=24;
const MAX_PER_CHAPTER=4;
const bounded=(value:string,limit:number)=>{
 const chars=Array.from(value.replace(/\s+/gu," ").trim());
 return chars.length<=limit?chars.join(""):`${chars.slice(0,limit).join("")}…`;
};
const importantScope=/\bv\d+(?:\.\d+)*\b|\b(?:alpha|beta|milestone|phase|scope|release)\b|首版|第一版|第一阶段|版本范围|适用版本|暂缓|阶段边界/iu;
const boundaryDecision=/暂缓|暂不(?:开发|实现|开放)|不纳入|\b(?:defer|postpone|out of scope)\b/iu;
const timestamp=(value:number|undefined)=>value&&Number.isFinite(new Date(value).getTime())?new Date(value).toISOString():undefined;
const markdown=unified().use(remarkParse).use(remarkGfm);
const genericTerms=new Set(["level","layer","tier","版本","范围","层级","开发","现状","目标","结果"]);
const evidenceTerms=(text:string)=>[...knowledgeTerms(text)].filter(term=>!genericTerms.has(term));
const numberedLayer=/\b(?:level|layer|tier)\s*([0-9]+)\b\s*(?:\(([^)\n]{2,40})\))?/iu;
const mentionedVersions=/\bv\d+(?:\.\d+)*(?:-[a-z\d]+(?:[.-][a-z\d]+)*)?/giu;

function visibleText(node:Nodes):string{
 if(node.type==="text"||node.type==="inlineCode")return node.value;
 if(node.type==="break")return " ";
 if(node.type==="image")return node.alt??"";
 return "children" in node?node.children.map(visibleText).join(""):"";
}

function relevantExcerpt(original:string,claim:string,answer?:string){
 const limit=260;
 const terms=new Set(evidenceTerms(claim));
 const answerTerms=answer?evidenceTerms(answer).filter(term=>terms.has(term)):[];
 const hasAnswerContext=(words:readonly string[])=>answerTerms.length<3
  ||answerTerms.filter(term=>words.includes(term)).length>=Math.ceil(answerTerms.length*2/3);
 const layer=numberedLayer.exec(claim);
 const alias=layer?.[2]?.trim().toLowerCase();
 const matchesLayer=(value:string)=>{
  if(!layer)return false;
  const named=numberedLayer.exec(value);
  return named?named[1]===layer[1]:Boolean(alias&&value.toLowerCase().includes(alias));
 };
 const blocks:Array<string|undefined>=[];
 let example:string|undefined;
 const collect=(node:Nodes)=>{
  if(node.type==="paragraph"){
   const text=visibleText(node).trim();
   if(text)blocks.push(text);
  }else if(node.type==="tableRow"){
   const text=node.children.map(cell=>visibleText(cell).trim()).filter(Boolean).join(" · ");
   if(text)blocks.push(text);
  }else if(node.type==="code"){
   example??=node.value;
   blocks.push(undefined);
  }else if(node.type==="heading"||node.type==="thematicBreak")blocks.push(undefined);
  else if(node.type==="root"||node.type==="blockquote"||node.type==="list"||node.type==="listItem"||node.type==="table")node.children.forEach(collect);
 };
 collect(markdown.parse(original));
 const passages=blocks.flatMap((text,index)=>{
  if(!text)return [];
  const next=blocks[index+1];
  // A blockquote or list item often supplies the value introduced by a colon.
  if(!/[：:]$/u.test(text))return [text];
  return next&&text.length+next.length<limit?[`${text} ${next}`]:[];
 });
 if(!passages.length&&example?.trim()&&(!layer||matchesLayer(example))&&hasAnswerContext(evidenceTerms(example))){
  const preview=example.trimEnd().split("\n").slice(0,8).join("\n");
  const chars=Array.from(preview),truncated=preview.length<example.trimEnd().length||chars.length>limit;
  return {excerpt:chars.slice(0,limit).join("")+(truncated?"\n…":""),format:"code" as const};
 }
 const version=knowledgeVersion(claim);
 const candidates=passages.flatMap(passage=>passage.length<=limit?[passage]:passage.split(/(?<=[。！？!?])|(?<=\.)\s+(?=[A-Z])/u));
 let best="",score=0;
 for(const value of candidates){
  const matchingLayer=matchesLayer(value);
  if(layer&&!matchingLayer)continue;
  const words=evidenceTerms(value);
  if(!hasAnswerContext(words))continue;
  const shared=words.filter(word=>terms.has(word)).length;
  // Versions are excluded from ordinary knowledge terms. A matching version
  // strengthens a topical match, but does not make generic prose evidence.
  const matchingVersion=Boolean(version&&shared&&value.normalize("NFKC").toLowerCase().match(mentionedVersions)?.includes(version));
  if(!matchingLayer&&!matchingVersion&&shared<Math.min(2,Math.max(1,terms.size)))continue;
  const relevance=shared*2+shared/Math.max(1,words.length)+(matchingLayer||matchingVersion?4:0);
  if(relevance>score){best=value;score=relevance;}
 }
 return {excerpt:bounded(best,limit),format:"prose" as const};
}

/** Select bounded evidence from the selected chapters by using saved claims and their receipts. */
export function projectKeyEvidence(session:FocusSession,pages:readonly FocusSection[],reading?:Reading){
 if(!pages.length)return [];
 reading??=session.wikiKnowledge&&session.wikiKnowledge.documentType!=="learning"?resolveWikiReading(session.wikiKnowledge):undefined;
 const units=new Map(reading?.units.map(unit=>[unit.id,unit]));
 const blockedKeys=new Set([...session.wikiScopeReview?.ignoredKeys??[],...session.wikiScopeReview?.excludeKeys??[]]);
 const blockedEvidence=new Set(session.wikiScopeReview?.materials.filter(material=>(material.keys??[material.key]).every(key=>blockedKeys.has(key))).flatMap(material=>material.evidenceIds));
 const refs=new Map(session.evidence.filter(ref=>{
  const current=session.sourceSignatures?.[ref.conversationId];
  return !blockedEvidence.has(ref.id)&&session.sourceConversationIds.includes(ref.conversationId)
   &&(!current||Boolean(current[ref.messageId])&&(!ref.sourceSignature||current[ref.messageId]===ref.sourceSignature))
   &&(session.scope?.kind!=="goal"||session.scope.blocks?.some(block=>block.conversationId===ref.conversationId&&block.messageIds.includes(ref.messageId)));
 }).map(ref=>[ref.id,ref]));
 const selectedUnits=new Set(pages.flatMap(page=>(page.claims??[]).flatMap(claim=>claim.unitIds??[])));
 const refsByMessage=new Map<string,Array<(typeof session.evidence)[number]>>();
 const messageKey=(conversationId:string,messageId:string)=>JSON.stringify([conversationId,messageId]);
 for(const ref of refs.values()){
  const key=messageKey(ref.conversationId,ref.messageId);
  const group=refsByMessage.get(key);
  if(group)group.push(ref);else refsByMessage.set(key,[ref]);
 }
 const originalRefs=(conversationId:string,messageId:string)=>refsByMessage.get(messageKey(conversationId,messageId))??[];
 const hasOriginal=(id:string)=>{
  const unit=units.get(id);
  return unit&&originalRefs(unit.evidence.conversationId,unit.evidence.messageId).some(ref=>wikiQuoteRange(ref.excerpt,unit.evidence.quote));
 };
 const replacements=new Map(reading?.organization?.relations.filter(relation=>relation.kind==="replaces"&&relation.status==="resolved"&&Boolean(relation.evidence)
  &&selectedUnits.has(relation.newer)&&hasOriginal(relation.newer)&&reading?.statuses.get(relation.newer)==="confirmed").map(relation=>[relation.older,relation.newer]));
 const subjects=new Map(reading?.organization?.subjects.map(subject=>[subject.id,subject.unitIds]));
 const seen=new Set<string>();
 const chapters=pages.map(page=>{
  if(page.userEdited||page.origin)return [];
  const owned=reading?.organization?.chapters.find(chapter=>chapter.id===page.id||chapter.id===page.wikiOwnerId);
  const routed=new Set(owned?.subtopics.flatMap(topic=>topic.subjectIds.flatMap(id=>subjects.get(id)??[])));
  const savedChoices:WikiClaim[]=[...routed].flatMap(id=>{
   const unit=units.get(id);
   if(!unit||!id.startsWith("answer:")||!reading||reading.statuses.get(id)!=="confirmed"||!wikiLocalAnswer(reading.ledger,id))return [];
   const ref=originalRefs(unit.evidence.conversationId,unit.evidence.messageId).find(ref=>page.evidenceIds.includes(ref.id)&&wikiQuoteRange(ref.excerpt,unit.evidence.quote));
   return ref?[{text:unit.statement,quote:unit.evidence.quote,evidenceIds:[ref.id],unitIds:[id],holder:"decided"}]:[];
  });
  const rows=[...savedChoices,...page.claims??[]].flatMap(claim=>{
   if(claim.markOnly||claim.verification==="uncertain"||!claim.text.trim()||claim.text.length<8)return [];
   const ids=claim.unitIds??[];
   const status:EvidenceStatus|undefined=claim.holder==="earlier"?"historical":claim.holder==="decided"||claim.userDecided?"confirmed":claim.holder==="open"?"open"
    :["scope","constraint","stage"].includes(claim.overviewRole??"")||importantScope.test(claim.text)?"scope":undefined;
   if(!status)return [];
   const confirmedUnits=status==="confirmed"&&reading?ids.filter(id=>reading?.statuses.get(id)==="confirmed"):[];
   const answer=reading?confirmedUnits.flatMap(id=>wikiLocalAnswer(reading.ledger,id)??[])[0]:undefined;
   const verified=wikiSourceReading(session,claim);
   const proofIds=[...new Set([...claim.evidenceIds,...verified?.sources.map(source=>source.id)??[]])];
   // An in-conversation approval may be bound by the ledger even on older saved pages.
   const boundUnits=ids.flatMap(id=>units.get(id)??[]);
   const approvals=boundUnits.flatMap(unit=>unit.adoption.status==="user_adopted"&&unit.adoption.approval?[{unit,approval:unit.adoption.approval}]:[]);
   for(const {unit,approval} of approvals){
    const ref=originalRefs(unit.evidence.conversationId,approval.messageId).find(source=>wikiQuoteRange(source.excerpt,approval.quote));
    if(ref&&!proofIds.includes(ref.id))proofIds.push(ref.id);
   }
   const sources=proofIds.flatMap(id=>{
    const ref=refs.get(id);
    if(!ref||!ref.excerpt.trim())return [];
    const receipt=verified?.sources.find(source=>source.id===id);
    const unit=boundUnits.find(unit=>unit.evidence.conversationId===ref.conversationId&&unit.evidence.messageId===ref.messageId);
    const approval=approvals.find(item=>item.unit.evidence.conversationId===ref.conversationId&&item.approval.messageId===ref.messageId)?.approval;
    const author=receipt?.role??session.sourceRoles?.[ref.conversationId]?.[ref.messageId]??unit?.evidence.role??(approval?"user":undefined);
    const confirmation=author==="user"&&(!claim.evidenceIds.includes(id)||Boolean(approval));
    const excerpt=confirmation?approval?.quote??(receipt&&session.scope?.kind!=="goal"?ref.excerpt:undefined)
     :claim.quote&&(receipt||wikiQuoteRange(ref.excerpt,claim.quote))?claim.quote:undefined;
    if(!excerpt)return [];
    // The approving reply can be a short “yes”, which is still a valid receipt.
    const display=confirmation?{excerpt:bounded(excerpt,260),format:"prose" as const}:relevantExcerpt(excerpt,claim.text,answer?.answer);
    return [{messageId:ref.messageId,conversationId:ref.conversationId,author,...display,confirmation,discussedAt:timestamp(receipt?.discussedAt)}];
   });
   const original=sources.find(source=>!source.confirmation&&source.excerpt)||sources.find(source=>!source.confirmation);
   const approval=sources.find(source=>source.confirmation);
   if(!original)return [];
   const recorded=reading?confirmedUnits.map(id=>reading?.ledger.decisions?.[id]?.at).find(Boolean):undefined;
   const confirmation=answer?{question:bounded(answer.question,260),answer:bounded(answer.answer,260),at:timestamp(answer.at)}
    :recorded?{at:timestamp(recorded)}:undefined;
   const newer=ids.map(id=>replacements.get(id)).find(Boolean);
   return [{chapter:page.wikiDisplayTitle??page.title,text:bounded(claim.text,360),status,sources:approval?[original,approval]:[original],confirmation,
    replacedBy:newer?bounded(units.get(newer)?.statement??"",220):undefined}];
  });
  const confirmed=rows.filter(row=>row.status==="confirmed").sort((a,b)=>Number(boundaryDecision.test(b.text))-Number(boundaryDecision.test(a.text)));
  const unique=confirmed.filter((row,index)=>!row.confirmation?.question||!confirmed.slice(0,index).some(other=>other.confirmation?.question===row.confirmation?.question&&other.confirmation?.at===row.confirmation?.at));
  const preferred=rows.filter(row=>row.status==="open"||row.status==="scope").sort((a,b)=>Number(b.status==="open")-Number(a.status==="open"));
  const ordered=[...unique.slice(0,3),...preferred,...unique.slice(3),...rows.filter(row=>row.status==="historical")];
  const chosen:typeof rows=[];
  for(const row of ordered){
   const key=factTextKey(row.text);
   if(!key||seen.has(key))continue;
   seen.add(key);
   chosen.push(row);
   if(chosen.length===MAX_PER_CHAPTER)break;
  }
  return chosen;
 });
 // Give each selected chapter a place before adding its next entry.
 const selected=new Set(chapters.flatMap(chapter=>chapter.slice(0,1)));
 while(selected.size<MAX_ENTRIES){
  const count=selected.size;
  for(const chapter of chapters){
   const entry=chapter.find(row=>!selected.has(row));
   if(entry&&selected.size<MAX_ENTRIES)selected.add(entry);
  }
  if(count===selected.size)break;
 }
 return chapters.flat().filter(row=>selected.has(row)).slice(0,MAX_ENTRIES);
}

export function keyEvidenceMarkdown(entries:ReturnType<typeof projectKeyEvidence>,zh:boolean,sourceLink?:(source:ReturnType<typeof projectKeyEvidence>[number]["sources"][number])=>string){
 const l=(cn:string,en:string)=>zh?cn:en;
 const escape=(value:string)=>value.replace(/[\\`*_[\]<>|]/gu,"\\$&");
 const labels={confirmed:l("已确认","Confirmed"),open:l("待决","Open"),scope:l("范围记录","Scope"),historical:l("历史记录","Earlier record")};
 const shortDate=(at:string)=>`${at.slice(0,10)} ${at.slice(11,16)} UTC`;
 const messages=new Map<string,{number:number;id:string}>();
 let chapter="";
 const sections=entries.flatMap(entry=>{
  const heading=chapter===entry.chapter?[]:[`### ${escape(entry.chapter)}`];
  chapter=entry.chapter;
  const details=entry.sources.map(source=>{
   const role=source.author==="user"?l("用户","User"):source.author==="assistant"?"AI":l("作者未记录","Author unrecorded");
   const label=source.confirmation?l("原对话确认","Confirmation in conversation"):source.excerpt?l("原始摘录","Original excerpt"):l("原始消息","Original message");
   const key=JSON.stringify([source.conversationId,source.messageId]);
   const message=messages.get(key)??{number:messages.size+1,id:source.messageId};
   messages.set(key,message);
   let quote=`> ${escape(source.excerpt)}`;
   if(source.format==="code"){
    const fence="~".repeat(Math.max(3,...[...source.excerpt.matchAll(/~+/gu)].map(match=>match[0].length+1)));
    quote=`> ${fence}text\n${source.excerpt.split("\n").map(line=>`> ${line}`).join("\n")}\n> ${fence}`;
   }
   const location=sourceLink?sourceLink(source):`${l("来源","Source")} ${message.number}`;
   const meta=[`**${label}**`,role,location,source.discussedAt&&shortDate(source.discussedAt)].filter(Boolean).join(" · ");
   if(source.excerpt)return `${meta}\n\n${quote}`;
   const note=entry.confirmation?l("结论依据见下方整理确认。","See the organization confirmation below for the decision.")
    :l("原文摘录与本条结论的对应关系待核对。","The connection to this conclusion needs review.");
   return `${meta}\n\n${note}`;
  });
  const confirmation=entry.confirmation;
  return [...heading,`**${labels[entry.status]}** · ${escape(entry.text)}`,...details,
   ...confirmation?[`**${l("整理确认","Confirmed during organization")}**${confirmation.at?` · ${shortDate(confirmation.at)}`:""}${confirmation.question?`\n\n- ${l("问题","Question")} ${escape(confirmation.question)}\n- **${l("选择","Selection")}** ${escape(confirmation.answer??"")}`:""}`]:[],
   ...entry.replacedBy?[`${l("后续决定","Later decision")} · ${escape(entry.replacedBy)}`]:[]];
 });
 if(!sourceLink&&messages.size)sections.push(`### ${l("消息索引","Message index")}`,Array.from(messages.values(),message=>`${message.number}. \`${message.id.replace(/[`\n]/gu,"")}\``).join("\n"));
 return sections.join("\n\n");
}
