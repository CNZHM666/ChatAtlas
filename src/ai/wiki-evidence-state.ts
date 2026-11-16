import {replaceParagraph} from "../shared/wiki-body-text";
import {wikiDocumentBlocks} from "../shared/wiki-document-blocks";
import {wikiSupplementRanges} from "../shared/wiki-source-supplements";
import {wikiLedgerUnits,type WikiDraftChapter,type WikiKnowledgeLedger,type WikiKnowledgeUnit} from "../shared/wiki-knowledge";
import {knowledgeTerms} from "../shared/knowledge-subject";
import {wikiReleaseDeferral} from "./wiki-confirmation-scope";

const COMPLETE=/已(?:经)?(?:完成|实现|建立|部署|上线)|建立了|实现了|\b(?:has|have) (?:implemented|built|deployed|completed)\b/iu;
const TENTATIVE=/建议|计划|拟|待(?:确认|核验|核对)|尚未|未实现|\b(?:propos|planned|unverified|not yet)/iu;
const COUNTS=/(?:\d+(?:\s*[-–～~至]\s*\d+)?|[一二两三四五六七八九十百]+)\s*(?:个|种|人|条|项|items?\b|users?\b|records?\b)/giu;
const compact=(s:string)=>s.replace(/[\s*_]/gu,"");
const counts=(s:string)=>new Set([...s.matchAll(COUNTS)].filter(m=>!/^\s*(?:测试|样例|示例|演示|test\b|sample\b|demo\b)/iu.test(s.slice((m.index??0)+m[0].length))).map(m=>compact(m[0])));

/** Separate the meaning of a requirement from evidence of implementation.
 * This local pass never invents a release assignment or repository result. */
export function reviewWikiEvidenceStates(chapters:WikiDraftChapter[],ledger:WikiKnowledgeLedger):WikiDraftChapter[]{
 if(ledger.documentType==="learning")return chapters;
 const units=new Map(wikiLedgerUnits(ledger).map(unit=>[unit.id,unit]));
 const deferred=(ledger.userAnswers??[]).flatMap(answer=>{
  const id=`answer:${answer.questionId}:${answer.optionId}`;
  const scope=units.has(id)&&ledger.decisions?.[id]?.verdict==="confirmed"&&wikiReleaseDeferral(answer.question,answer.answer);
  return scope?[scope]:[];
 });
 const heldCapabilities=[...units.values()].flatMap(unit=>{
  if(unit.about||unit.kind==="history")return [];
  const feature=unit.statement.match(/预留[^。\n]{1,65}?[，,；;]\s*但?\s*(?:本|当时|第一)阶段(?:禁止|暂不|不)开发\s*([^、，。；;\n]{2,24})/u)?.[1];
  return feature?[feature]:[];
 });
 const capabilityKey=(text:string)=>compact(text).replace(/拍照|照片|视觉/gu,"图像").toLowerCase();
 const credentialStore=[...units.values()].some(unit=>!unit.about&&/(?:API.?Key|凭据|密钥|\btoken\b)/iu.test(unit.statement)&&/(?:保存|存储|store|persist)/iu.test(unit.statement)&&/sessionStorage|localStorage|IndexedDB|credential store/iu.test(unit.statement));
 const alternatives=new Map<string,Set<string>>();
 for(const answer of ledger.userAnswers??[]){
  const question=ledger.writingQuestions?.find(q=>q.id===answer.questionId);
  if(!question||!/规模|数量|限额|容量|\b(?:count|size|limit|capacity)\b/iu.test(question.about))continue;
  const decision=units.get(`answer:${question.id}:${answer.optionId}`);
  if(!decision||ledger.decisions?.[decision.id]?.verdict!=="confirmed")continue;
  const chosen=counts(answer.answer);if(!chosen.size)continue;
  const anchors=new Set([...answer.unitIds,decision.id]);
  const siblings=ledger.organization?.subjects.filter(subject=>subject.unitIds.some(id=>anchors.has(id))).flatMap(subject=>subject.unitIds)??[];
  for(const id of siblings){const unit=units.get(id);if(unit&&id!==decision.id&&ledger.decisions?.[id]?.verdict!=="confirmed"&&[...counts(unit.statement)].some(n=>!chosen.has(n)))alternatives.set(id,chosen);}
 }
 const qualify=(text:string,sources:WikiKnowledgeUnit[])=>{
  if(!sources.length||/^[“「>]|^\s*(`{3}|~{3})/u.test(text))return text;
  if(credentialStore&&!/允许保存的位置|permitted storage/iu.test(text)&&/(?:各|所有|全部).{0,8}(?:存储层|存储).{0,12}(?:无|不得|不能|不含).{0,12}(?:API.?Key|密钥|凭据)|all storage.{0,25}(?:no|without|must not).{0,20}(?:key|secret|token)/iu.test(text))return text+(/\p{Script=Han}/u.test(text)?" 该验收项与文中的凭据存储方案范围尚未统一，需先确认允许保存的位置。":" This check and the credential policy need reconciliation of permitted storage.");
  if(COMPLETE.test(text)&&sources.every(unit=>unit.delivery!=="user_reported"&&unit.kind!=="report"&&!COMPLETE.test(unit.statement)&&!COMPLETE.test(unit.evidence.quote))){
   const qualified=text.split(/(?<=[。！？])|(?<=[.!?])(?=\s+[A-Z])/u).map(sentence=>TENTATIVE.test(sentence)?sentence:sentence.replace(/已(?:经)?建立|建立了/gu,"计划建立").replace(/已(?:经)?实现|实现了/gu,"计划实现").replace(/已(?:经)?完成/gu,"计划完成").replace(/已(?:经)?部署/gu,"计划部署").replace(/已(?:经)?上线/gu,"计划上线").replace(/\b(?:has|have) (implemented|built|deployed|completed)\b/giu,(_all,verb:string)=>`plans to ${{implemented:"implement",built:"build",deployed:"deploy",completed:"complete"}[verb.toLowerCase()]}`)).join("");
   if(qualified!==text)return qualified;
  }
  if(!text.includes("|")&&!TENTATIVE.test(text)&&!/^(?:其他候选记录|范围待核对的候选建议|Alternative record|Alternative proposal)/iu.test(text)&&sources.some(unit=>alternatives.has(unit.id))&&[...counts(text)].some(n=>sources.some(unit=>alternatives.has(unit.id)&&!alternatives.get(unit.id)!.has(n)))){
   return /\p{Script=Han}/u.test(text)?`范围待核对的候选建议：${text}`:`Alternative proposal; its relation to the confirmed scope needs review: ${text}`;
  }
  return text;
 };
 return chapters.map(chapter=>{
  let body=chapter.body;
  const ranges=wikiSupplementRanges(body);
  const originals=[...units.values()].flatMap(unit=>unit.evidence.code?.language==="table"?[unit.evidence.code.text.trim()]:[]);
  const historical=chapter.paragraphs.flatMap(paragraph=>[...new Set(paragraph.unitIds)].flatMap(id=>{
   const unit=units.get(id);
   if(!unit||unit.about||unit.evidence.role!=="user"||!unit.evidence.pasted&&unit.kind!=="report"&&unit.delivery!=="user_reported")return [];
   const clause=unit.statement.split(/[；;。]/u).map(item=>item.trim()).find(item=>/不检查|未实现|不支持|\b(?:does not check|not implemented|does not support)\b/iu.test(item));
   return clause?[{topic:paragraph.subtopic,clause}]:[];
  }));
  const historyAt=(topic:string,text:string)=>{
   const terms=knowledgeTerms(text);
   return historical.filter(item=>item.topic===topic&&[...knowledgeTerms(item.clause)].filter(term=>terms.has(term)).length>=2);
  };
  const separate=(text:string,sources:WikiKnowledgeUnit[],topic:string)=>{
   const proposed=sources.length&&sources.every(unit=>unit.evidence.role==="assistant"&&unit.delivery!=="user_reported"&&ledger.decisions?.[unit.id]?.verdict!=="confirmed");
   if(proposed&&/^(?:优先(?:开发|实施|建设|扩展)|prioriti[sz]e (?:implementation|development)\b)/iu.test(text)){
    return /\p{Script=Han}/u.test(text)?`讨论中的建议，优先级待确认：${text}`:`Discussion proposal. Priority pending. ${text}`;
   }
   if(credentialStore&&/sessionStorage/u.test(text)&&/(?:API\s*Key|密钥|凭据)/iu.test(text)&&sources.some(unit=>/sessionStorage/u.test(`${unit.statement} ${unit.evidence.quote}`))){
    const corrected=text.replace(/关闭(?:浏览器|标签页)后(?:即|会)?(?:消失|清除|失效)/gu,"按标签页会话管理，刷新和恢复会话时的行为需单独验证");
    if(corrected!==text)return corrected;
   }
   const unassigned=deferred.some(({feature,stage})=>{
    const name=feature.replace(/^(?:[\w.-]+\s+)+(?=\p{Script=Han})/u,"");
    return text.toLowerCase().includes(name.toLowerCase())&&!text.toLowerCase().includes(stage.toLowerCase());
   });
   if(proposed&&unassigned&&/^\s*(?:[-+*]\s+)?(?:\*\*)?[^\n：:]{2,48}(?:\*\*)?\s*[：:]\s*(?:>=|<=|>|<|≥|≤)\s*\d+(?:\.\d+)?\s*%\s*$/u.test(text)){
    return `${text}${/\p{Script=Han}/u.test(text)?"（建议指标，适用版本待核对）":" (proposed metric; applicable release unconfirmed)"}`;
   }
   if(/^(?:第一阶段|首版|本阶段|first phase|first release)/iu.test(text)&& /\d+\s*%/u.test(text)
    &&proposed&&unassigned)return text.replace(/^(?:第一阶段|首版|本阶段)(?=.{0,30}[：:])[^。！？：:]*[：:]\s*/u,"早期提案提出以下指标，适用版本待核对：")
     .replace(/^(?:first phase|first release)[^.?!:]{0,45}:\s*/iu,"Earlier proposed metrics (applicable release unconfirmed): ");
   if(/当前状态显示|current status shows/iu.test(text)&&historyAt(topic,text).length)return text.replace(/当前状态显示/gu,"当时的资料记录").replace(/current status shows/giu,"the historical report states");
   return text;
  };
  const paragraphs=chapter.paragraphs.map(paragraph=>{
   if(!body.includes(paragraph.text)||/[`~]{3}/u.test(paragraph.text))return paragraph;
   const at=chapter.body.indexOf(paragraph.text);
   if(ranges.some(([start,end])=>at>=start&&at+paragraph.text.length<=end))return paragraph;
   let text=paragraph.text;
   let claims=paragraph.claims?.map(claim=>{
    if(!text.includes(claim.text))return claim;
    const sources=claim.unitIds.flatMap(id=>units.get(id)??[]);
    const next=separate(qualify(claim.text,sources),sources,paragraph.subtopic);
    if(next===claim.text)return claim;
    text=text.replace(claim.text,()=>next);return {...claim,text:next};
   });
   if(!paragraph.claims?.length)text=qualify(text,paragraph.unitIds.flatMap(id=>units.get(id)??[]));
   if(!/^(?:\s*[-*+>]|\s*\|)/u.test(text)&&!text.includes("两份提案的阶段关系待核对")){
    const restriction=text.match(/^(?:在[^。\n]{2,24}方面[，,]\s*)?(?:第一版|首版)仅(?:支持|提供|识别)[^。\n]+[。]/u)?.[0];
    const cited=paragraph.unitIds.flatMap(id=>units.get(id)??[]);
    const feature=restriction&&heldCapabilities.find(capability=>capabilityKey(restriction).includes(capabilityKey(capability))
     &&cited.some(unit=>unit.evidence.role==="assistant"&&ledger.decisions?.[unit.id]?.verdict!=="confirmed"&&capabilityKey(unit.statement).includes(capabilityKey(capability))));
    if(restriction&&feature&&!cited.some(unit=>ledger.decisions?.[unit.id]?.verdict==="confirmed")){
     const qualified=restriction.replace(/(?:第一版|首版)仅/u,"另一份第一版提案建议仅");
     text=text.replace(restriction,`${qualified}另有只预留该能力的方案，两份提案的阶段关系待核对。`);
     claims=claims?.map(claim=>restriction.includes(claim.text)?{...claim,text:claim.text.replace(/(?:第一版|首版)仅/u,"另一份第一版提案建议仅")}:claim);
    }
   }
   // A generated capability matrix specifies requirements. Conversation evidence
   // alone cannot populate a column called implemented/current implementation.
   for(const block of wikiDocumentBlocks(text).reverse()){
    if(block.kind!=="table"||originals.includes(block.text.trim()))continue;
    const rows=block.text.split("\n").map(row=>row.trim().replace(/^\||\|$/gu,"").split(/(?<!\\)\|/u).map(cell=>cell.trim()));
    if(rows[0]?.length!==2||! /^(?:第一版|首版|本阶段|V\d+(?:\.\d+)*|目标要求|requirements?|first (?:version|release)|current phase)$/iu.test(rows[0][1]))continue;
    const evidence = [...new Set([...paragraph.unitIds, ...claims?.flatMap(claim=>claim.unitIds)??[]])].flatMap(id=>units.get(id)??[]);
    // “Supports” and “checks” can describe working software. Only transform a
    // table whose bound evidence is consistently about requirements or plans.
    const reports=historyAt(paragraph.subtopic,block.text);
    const targetRows=rows.slice(2).every(row=>row.length===2&&/^(?:做[：:]|至少(?:支持|检查)|应(?:当)?|需|必须|should|must|required)/iu.test(row[1]));
    if(!evidence.length||!evidence.every(unit=>unit.delivery!=="user_reported"&&unit.kind!=="report"
      && (unit.delivery==="planned"||unit.kind==="plan"||unit.kind==="constraint"||targetRows&&reports.length>0)))continue;
    const header=rows[0][1],zh=/\p{Script=Han}/u.test(block.text);
    const target=/目标要求|requirements?/iu.test(header)?header:zh?`目标要求（原表：${header}）`:`Target requirement (source: ${header})`;
    const matrix=[`| ${rows[0][0]} | ${target} |${reports.length?` ${zh?"历史报告":"Historical report"} |`:""} ${zh?"实现核验":"Implementation evidence"} |`,
     `| --- | --- |${reports.length?" --- |":""} --- |`,...rows.slice(2).map(row=>{
      const reported=reports.length?` ${[...new Set(historyAt(paragraph.subtopic,row[1]).map(item=>item.clause))].join(" / ").replace(/\|/gu,"\\|")|| (zh?"无对应记录":"No matching report")} |`:"";
      return `| ${row.join(" | ")} |${reported} ${zh?"待核验":"Unverified"} |`;
     })].join("\n");
    text=text.slice(0,block.start)+matrix+text.slice(block.end);
   }
   if(text===paragraph.text)return {...paragraph,claims};
   body=replaceParagraph(body,paragraph.text,()=>text);
   return {...paragraph,text,claims};
  });
  // Generated openings are not always stored as paragraph claims.
  const first=wikiDocumentBlocks(body).find(block=>block.kind==="paragraph");
  if(first&&chapter.openingUnitIds?.length&&!paragraphs.some(p=>p.text.includes(first.text))){
   const next=qualify(first.text,chapter.openingUnitIds.flatMap(id=>units.get(id)??[]));
   if(next!==first.text)body=body.slice(0,first.start)+next+body.slice(first.end);
  }
  return body===chapter.body?chapter:{...chapter,body,paragraphs};
 });
}
