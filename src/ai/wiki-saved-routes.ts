import type { FocusSection, FocusSession } from "../shared/focus-session";
import type { WikiClaim } from "../shared/wiki-claims";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { withoutEmptyWikiHeadings } from "../shared/wiki-editorial-cleanup";
import { currentWikiEvidence, wikiEvidenceKey } from "../shared/wiki-evidence-link";
import { wikiSupplementRanges } from "../shared/wiki-source-supplements";
import { wikiMisplacedTechnicalRole, wikiTechnicalReadingHome } from "./wiki-unit-routing";
import type { resolveWikiReading } from "./wiki-knowledge-reading";
import { knowledgeOverlap, knowledgeScopesAgree } from "../shared/knowledge-subject";
import { restatedWithin } from "../shared/wiki-knowledge";
import { wikiUnitChapterHomes } from "../shared/wiki-chapter-links";
import { wikiConfirmationCovers, wikiConfirmationDetails } from "./wiki-confirmation-scope";
import { wikiSourceBlockMarkdown } from "../shared/wiki-source-code";

type Route = { from: string; to: string; heading: string; text: string; claim: WikiClaim; literal?: boolean };

/** Move a saved, source-bound sentence or list item without touching the
 * surrounding prose, the original message, or a user-authored chapter. */
export function savedWikiRoutes(session: FocusSession, reading: ReturnType<typeof resolveWikiReading>) {
  if (reading.ledger.documentType === "learning") return [];
  const source = new Map(currentWikiEvidence(session).map(ref => [ref.id, ref]));
  const known = new Map(reading.units.map(unit => [unit.id, unit]));
  const active = new Set(reading.ledger.draft?.chapters.map(chapter => chapter.id));
  const chapters = session.sections.filter(page => !page.userEdited && !page.origin && active.has(page.id)).map(page => {
    const blocks=wikiDocumentBlocks(page.body,page.claims);
    return {id:page.id,title:page.title,page,blocks,subtopics:blocks
      .filter(block=>block.kind==="heading").map(block=>({title:block.text.replace(/^#+\s+/u,"")}))};
  });
  const routes: Route[] = [];
  const repeats=new Map<string,Array<{page:FocusSection;claim:WikiClaim}>>();
  for (const { page, blocks } of chapters) {
    const supplements = wikiSupplementRanges(page.body);
    let topic = "";
    for (const [index,block] of blocks.entries()) {
      if (supplements.some(([start,end]) => block.start>=start && block.end<=end)) continue;
      if (block.kind === "heading") { topic=block.text.replace(/^#+\s+/u,""); continue; }
      if (!["paragraph","list"].includes(block.kind) || block.claims.some(claim=>claim.checked)) continue;
      const sentences=block.kind==="list"?block.text.split("\n").filter(line=>/^\s*[-*+]\s+/u.test(line))
        :block.text.split(/(?<=[。！？])|(?<=[.!?])(?=\s)/u).map(line=>line.trim()).filter(Boolean);
      const claims=(page.claims??[]).filter(claim=>!claim.markOnly&&claim.verification!=="uncertain"&&!claim.checked&&block.text.includes(claim.text));
      if(block.kind==="paragraph")for(const claim of claims){
        const id=claim.unitIds?.[0];
        if(id&&claim.unitIds?.length===1&&claim.holder==="decided"&&reading.statuses.get(id)==="confirmed"
          &&sentences.includes(claim.text)&&claim.evidenceIds.length&&claim.evidenceIds.every(ref=>source.has(ref))
          &&page.body.indexOf(claim.text)===page.body.lastIndexOf(claim.text))
          repeats.set(id,[...repeats.get(id)??[],{page,claim}]);
      }
      for (const text of sentences) {
        const role = wikiMisplacedTechnicalRole(text, page.title, topic);
        const home = role && wikiTechnicalReadingHome(role, chapters);
        if (!home || home.chapter.id===page.id && home.title===topic || text===topic
          || page.body.indexOf(text)!==page.body.lastIndexOf(text)) continue;
        const usable=claims.filter(claim=>text.includes(claim.text)||claim.text.includes(text)).sort((a,b)=>a.text.length-b.text.length);
        const bound=usable.flatMap(claim=>{
          const units=(claim.unitIds??[]).flatMap(id=>known.get(id)??[]).filter(unit=>{
            const status=reading.statuses.get(unit.id);
            return status&&status!=="history"&&!unit.about&&knowledgeOverlap(text,unit.statement).length>=2;
          });
          const proof=units.flatMap(unit=>claim.evidenceIds.flatMap(id=>{
            const ref=source.get(id);
            const versions=session.sourceSignatures?.[unit.evidence.conversationId];
            const role=session.sourceRoles?.[unit.evidence.conversationId]?.[unit.evidence.messageId];
            return ref&&(!versions||versions[unit.evidence.messageId])&&(!role||role===unit.evidence.role)
              &&wikiEvidenceKey(ref)===wikiEvidenceKey({...unit.evidence,excerpt:unit.evidence.quote})?[{unit,id,ref}]:[];
          }));
          if(!proof.length)return [];
          const covered=proof.filter(({unit})=>wikiMisplacedTechnicalRole(unit.statement,page.title,topic)?.id===role.id);
          const match=covered.length?covered:proof;
          if(usable.length>1&&claim.text.length>text.length&&!covered.length)return [];
          const keptText=text.includes(claim.text)?claim.text:text;
          return [{...claim,text:keptText,formulations:undefined,sourceReading:undefined,quote:match[0].ref.excerpt,
            unitIds:[...new Set(match.map(item=>item.unit.id))],evidenceIds:[...new Set(match.map(item=>item.id))]}];
        })[0];
        if(bound){
          const route={from:page.id,to:home.chapter.id,heading:home.title,text,claim:bound};
          routes.push(route);
          const codes=bound.unitIds?.flatMap(id=>known.get(id)?.evidence.code??[]).map(wikiSourceBlockMarkdown)??[];
          const caption=blocks[index+1], example=blocks[index+2];
          if(caption?.kind==="paragraph"&&/^(?:\*)?(?:讨论中的原文(?:代码|表格)|(?:Code|Table) from the discussion)/iu.test(caption.text)
            &&example?.kind==="code"&&codes.includes(example.text)&&!routes.some(item=>item.from===page.id&&item.literal&&item.text.includes(example.text))){
            routes.push({...route,text:page.body.slice(caption.start,example.end),literal:true});
          }
        }
      }
    }
  }
  const homes=wikiUnitChapterHomes(reading.organization);
  for(const [id,items] of repeats){
    const owner=items.find(item=>item.page.id===homes.get(id))??items[0];
    for(const item of items){
      const {text}=item.claim, canonical=owner.claim.text;
      if(item.page===owner.page||!item.claim.evidenceIds.every(ref=>owner.claim.evidenceIds.includes(ref))
        ||!knowledgeScopesAgree(canonical,text)||knowledgeOverlap(canonical,text).length<2||!restatedWithin(canonical,text)
        ||!wikiConfirmationCovers(canonical,wikiConfirmationDetails(text)))continue;
      routes.push({from:item.page.id,to:"",heading:"",text,claim:item.claim});
    }
  }
  return routes;
}

export function applySavedWikiRoutes(section: FocusSection, routes: readonly Route[]): FocusSection {
  if (section.origin || section.userEdited) return section;
  const outgoing=routes.filter(route=>route.from===section.id&&section.body.includes(route.text));
  const incoming=routes.filter(route=>route.to===section.id);
  if (!outgoing.length&&!incoming.length) return section;
  const pieces=new Map<string,Route[]>();
  for(const route of incoming)pieces.set(route.heading,[...pieces.get(route.heading)??[],route]);
  let body=section.body;
  for(const route of outgoing)body=body.replace(route.text,()=>"");
  for(const [title,items] of pieces){
    const text=[...new Set(items.map(route=>route.text))].filter(item=>!body.includes(item)).join("\n\n");
    if(!text)continue;
    const heading=wikiDocumentBlocks(body).find(block=>block.kind==="heading"&&block.text.replace(/^#+\s+/u,"")===title);
    body=heading?body.slice(0,heading.end)+"\n\n"+text+body.slice(heading.end):body.trimEnd()+`\n\n### ${title}\n\n${text}`;
  }
  body=withoutEmptyWikiHeadings(body.trim());
  return {...section,body,claims:[...section.claims?.flatMap(claim=>{
    const kept=outgoing.filter(route=>!route.literal).reduce((text,route)=>text.replace(route.text,()=>"").replace(route.claim.text,()=>"").trim(),claim.text);
    if(kept===claim.text)return [claim];
    return kept&&body.includes(kept)?[{...claim,text:kept,formulations:undefined,sourceReading:undefined}]:[];
  })??[],
    ...incoming.filter(route=>!route.literal).map(route=>route.claim)],evidenceIds:[...new Set([...section.evidenceIds,...incoming.flatMap(route=>route.claim.evidenceIds)])]};
}
