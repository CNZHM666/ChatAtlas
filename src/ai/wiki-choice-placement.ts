import {knowledgeTerms} from "../shared/knowledge-subject";
import {wikiDocumentBlocks} from "../shared/wiki-document-blocks";
import {wikiHistoricalHeading} from "../shared/wiki-history-layout";
import {wikiSupplementRanges} from "../shared/wiki-source-supplements";
import {wikiLedgerUnits,type WikiDraftChapter,type WikiKnowledgeLedger} from "../shared/wiki-knowledge";
import {wikiDecisionRestatement} from "./wiki-confirmation-scope";

type Block=ReturnType<typeof wikiDocumentBlocks>[number];

/** Exact, independently evidenced choices have one body home. Openings and
 * generic supplements can omit the duplicate; literal sources are untouched. */
export function placeWikiChoices(chapters:WikiDraftChapter[],ledger:WikiKnowledgeLedger):WikiDraftChapter[]{
 if(!ledger.organization||ledger.documentType==="learning")return chapters;
 const units=new Map(wikiLedgerUnits(ledger).map(unit=>[unit.id,unit]));
 const out:WikiDraftChapter[]=chapters.map(chapter=>({...chapter,paragraphs:[...chapter.paragraphs]}));
 for(const answer of ledger.userAnswers??[]){
  const id=`answer:${answer.questionId}:${answer.optionId}`,choice=units.get(id);
  if(!choice||ledger.decisions?.[id]?.verdict!=="confirmed")continue;
  const anchors=new Set(answer.unitIds);
  const subjectIds=new Set(ledger.organization.subjects.filter(subject=>subject.unitIds.includes(id)||subject.unitIds.some(unit=>anchors.has(unit))).map(subject=>subject.id));
  const choiceHomes=new Set(ledger.organization.subjects.filter(subject=>subject.unitIds.includes(id)).map(subject=>subject.id));
  const routes:Array<{chapter:WikiDraftChapter|undefined;topic:string;direct:boolean}>=ledger.organization.chapters.flatMap(plan=>plan.subtopics.filter(topic=>topic.subjectIds.some(subject=>subjectIds.has(subject))&&!wikiHistoricalHeading(topic.title))
   .map(topic=>({chapter:out.find(item=>item.id===plan.id),topic:topic.title,direct:topic.subjectIds.some(subject=>choiceHomes.has(subject))})));
  const direct=routes.filter(route=>route.direct);
  const route=direct.length===1?direct[0]:routes.length===1?routes[0]:undefined;
  if(!route?.chapter)continue;
  const {chapter,topic}=route,supplements=wikiSupplementRanges(chapter.body);
  const all=wikiDocumentBlocks(chapter.body).filter(block=>!supplements.some(([start,end])=>block.start>=start&&block.end<=end));
  const heading=all.find(block=>block.kind==="heading"&&block.text.replace(/^#+\s+/u,"")===topic);
  if(!heading)continue;
  const sentences=(text:string)=>text.split(/(?<=[。！？])\s*|(?<=[.!?])\s+/u).filter(part=>part.trim());
  const restates=(text:string)=>wikiDecisionRestatement(text,choice.statement)||sentences(text).every(part=>wikiDecisionRestatement(part,choice.statement));
  const isBound=(text:string)=>chapter.paragraphs.some(p=>p.text.includes(text)&&p.claims?.some(c=>c.unitIds.includes(id)&&restates(c.text)));
  let active="",level=0;
  const copies:Array<{block:Block;topic:string}>=[];
  const openingEdits:Array<{start:number;end:number;text:string}>=[];
  const matrices:Block[]=[];
  for(const block of all){
   if(block.kind==="heading"){
    const depth=block.text.match(/^#+/u)?.[0].length??3;
    if(!level||depth<=level||wikiHistoricalHeading(block.text)){active=block.text.replace(/^#+\s+/u,"");level=depth;}
    continue;
   }
   if(block.kind==="table"&&active===topic)matrices.push(block);
   if(block.kind!=="paragraph"||wikiHistoricalHeading(active))continue;
   if(!restates(block.text)){
    if(!active){
     const remaining=sentences(block.text).filter(sentence=>!wikiDecisionRestatement(sentence,choice.statement));
     if(remaining.length<sentences(block.text).length)openingEdits.push({start:block.start,end:block.end,text:remaining.join(/\p{Script=Han}/u.test(block.text)?"":" ")});
    }
    continue;
   }
   if(isBound(block.text)||!active||/^(?:已确认的取舍|已确认的决定补记|Confirmed choices|Confirmed decisions retained)$/u.test(active))copies.push({block,topic:active});
  }
  const savedHome=ledger.draft?.chapters.find(item=>item.id===chapter.id)?.paragraphs.some(p=>p.subtopic===topic&&p.claims?.some(claim=>claim.unitIds.includes(id)&&restates(claim.text)));
  if(!copies.length&&!(savedHome&&openingEdits.length))continue;
  const terms=knowledgeTerms(choice.statement);
  const edits=[...openingEdits];
  const keep=copies.find(copy=>copy.topic===topic&&isBound(copy.block.text));
  const removed=copies.filter(copy=>copy!==keep);
  if(!keep){
   // Preserve chapter leads unless we have a known home and a repeated copy.
   if(!savedHome&&copies.length===1&&copies[0].topic===""&&!openingEdits.length)continue;
   edits.push({start:heading.end,end:heading.end,text:`\n\n${choice.statement}`});
  }
  for(const {block} of removed)edits.push({start:block.start,end:block.end,text:""});
  chapter.paragraphs=chapter.paragraphs.filter(p=>keep&&p.text===keep.block.text&&p.subtopic===topic||!removed.some(copy=>p.text===copy.block.text&&(p.subtopic===copy.topic||copy.topic===""&&p.subtopic!==topic)));
  if(!keep)chapter.paragraphs.push({text:choice.statement,subtopic:topic,unitIds:[id],claims:[{text:choice.statement,unitIds:[id]}]});
  if(openingEdits.length||removed.some(copy=>!copy.topic))chapter.openingUnitIds=chapter.openingUnitIds?.filter(unit=>unit!==id);
  for(const block of matrices){
   const paragraph=chapter.paragraphs.find(p=>p.text===block.text);
   if(!paragraph?.claims?.length)continue;
   const rows=block.text.split("\n");
   if(!/^\|[^|]+\|\s*(?:第一版|首版|本阶段|V\d+(?:\.\d+)*|first release)\s*\|$/iu.test(rows[0]))continue;
   const omitted=rows.slice(2).filter(row=>{
    const label=row.match(/^\|\s*([^|]+?)\s*\|\s*(?:做|支持|included|yes)\s*\|$/iu)?.[1];
    if(!label||/\d/u.test(choice.statement.replace(/^(?:V\d+(?:\.\d+)*\s*)/iu,"")))return false;
    const claims=paragraph.claims!.filter(claim=>row.includes(claim.text)&&claim.text!=="做"&&claim.text!=="支持");
    const own=[...knowledgeTerms(label)];
    const shared=own.filter(term=>terms.has(term)).length;
    return claims.length>0&&claims.every(claim=>claim.unitIds.length===1&&claim.unitIds[0]===id)&&shared>=2&&shared/own.length>=.65;
   });
   if(!omitted.length||rows.length-omitted.length<=2)continue;
   const next=rows.filter(row=>!omitted.includes(row)).join("\n");
   edits.push({start:block.start,end:block.end,text:next});
   const claims=paragraph.claims.filter(claim=>!omitted.some(row=>row.includes(claim.text)&&claim.unitIds.every(unit=>unit===id)));
   const index=chapter.paragraphs.indexOf(paragraph);
   chapter.paragraphs[index]={...paragraph,text:next,claims,unitIds:paragraph.unitIds.filter(unit=>unit!==id||claims.some(claim=>claim.unitIds.includes(unit)))};
  }
  for(const edit of edits.sort((a,b)=>b.start-a.start))chapter.body=chapter.body.slice(0,edit.start)+edit.text+chapter.body.slice(edit.end);
  chapter.body=chapter.body.replace(/\n\n### (?:已确认的取舍|已确认的决定补记|Confirmed choices|Confirmed decisions retained)(?=\s*(?:#{1,6} |$))/gu,"").trim();
 }
 return out;
}
