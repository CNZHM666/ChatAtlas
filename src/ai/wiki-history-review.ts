import type { FocusSection } from "../shared/focus-session";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { wikiHistoricalHeading, wikiHistoricalTransition } from "../shared/wiki-history-layout";
import { wikiHolderOf } from "../shared/wiki-holder";
import type { WikiDraftChapter, WikiKnowledgeUnit, WikiUnitStatus } from "../shared/wiki-knowledge";
import { isSourceCaption } from "../shared/wiki-source-code";
import { outgrownCentralBy } from "../shared/wiki-differing-plans";

const EARLIER_PROPOSAL = /^(?:此前|早先|早期)(?:曾)?(?=建议|提出|考虑|计划)|^(?:Previously|Earlier),?\s+(?=(?:it was |the assistant )?(?:proposed|suggested|considered))/iu;
const OLD_CAPTION = /\s*·\s*(?:早期版本[，,]\s*已被替换|早期方案[，,]\s*已被替换|Earlier version, superseded)(?=\*?$)/iu;
const ORIGINAL = /^(?:原文来源|Original source|Source references?)\s+\[/iu;
const bare = (text:string) => text.replace(/\*\*|__/gu,"").trim();

/** Saved headings are a layout hint. Validate the blocks and their badges
 * against the same status evidence used for the rest of the Wiki. */
export function reviewWikiHistory(section:FocusSection,chapter:WikiDraftChapter,units:WikiKnowledgeUnit[],
  status:ReadonlyMap<string,WikiUnitStatus>,hasSource:(unit:WikiKnowledgeUnit)=>boolean,zh:boolean):FocusSection {
  const blocks = wikiDocumentBlocks(section.body);
  if (!blocks.some(block => block.kind === "heading" && wikiHistoricalHeading(block.text))
    && !section.claims?.some(claim => claim.holder === "earlier")) return section;
  const scoped=units.filter(hasSource);
  const available = new Set(scoped.map(unit => unit.id));
  const outgrown = outgrownCentralBy(scoped,id=>status.get(id));
  const standings = (ids:string[]) => ids.map(id => available.has(id) ? outgrown.has(id)?"history" as const:status.get(id) : undefined);
  const earlier = (ids:string[]) => ids.length > 0 && standings(ids).every(value => value === "history");
  const comparison = (text:string,ids:string[]) => {
    if(!wikiHistoricalTransition(text))return false;
    const values=standings(ids);
    return values.some(value=>value==="history")&&values.every(value=>value==="history"||value==="confirmed");
  };
  const knownClaims = section.claims ?? [];
  const localClaims = (text:string) => knownClaims.filter(claim => !claim.markOnly
    && [claim.text,...claim.formulations??[]].some(form => form && bare(text).includes(bare(form))));
  const claims = knownClaims.map(claim => {
    if (claim.holder !== "earlier" || earlier(claim.unitIds ?? []) || comparison(claim.text,claim.unitIds??[])) return claim;
    const live = standings(claim.unitIds ?? []).filter((value):value is WikiUnitStatus => Boolean(value && value !== "history"));
    const holder = wikiHolderOf(live);
    return {...claim,holder:holder==="decided"&&!claim.userDecided?"user" as const:holder,holderMark:holder&&holder!=="ai"?claim.holderMark:false};
  });
  const statements = new Map(knownClaims.map((claim,index)=>[claim,claims[index]]));
  const revisions = new Map<string,string>();
  const ranges: Array<{start:number;end:number;text:string}> = [];
  for (const [index, heading] of blocks.entries()) {
    if (heading.kind !== "heading" || !wikiHistoricalHeading(heading.text)) continue;
    const nextHeading = blocks.findIndex((block,at)=>at>index&&block.kind==="heading");
    const contents = blocks.slice(index+1,nextHeading<0?undefined:nextHeading);
    if (!contents.length) continue;
    const level=heading.text.match(/^#+/u)?.[0]??"###";
    const discussionHeading=`${level} ${zh?"讨论记录":"Discussion records"}`;
    if (contents.some(block=>block.kind==="html")) {
      ranges.push({start:heading.start,end:heading.end,text:discussionHeading});
      continue;
    }
    const before: string[] = [], discussion: string[] = [];
    let caption = "", group = discussion;
    for (const [at,block] of contents.entries()) {
      const next = contents[at+1];
      if (block.kind==="paragraph" && next && isSourceCaption(block.text,{type:next.kind,text:next.text})) {
        caption=block.text;
        continue;
      }
      if (block.kind==="paragraph" && ORIGINAL.test(block.text) && group.length) {
        group[group.length-1]=[group.at(-1),block.text].filter(Boolean).join("\n\n");
        continue;
      }
      const pieces=block.kind==="list"&&!/^[ \t]{2,}\S|[`~]{3}/mu.test(block.text)?block.text.split(/\n(?=[-*+]\s)/u):[block.text];
      for (const piece of pieces) {
        const points=localClaims(piece);
        const exactIds=chapter.paragraphs.filter(item=>bare(item.text)===bare(piece)||caption&&bare(item.text)===bare(caption+"\n\n"+piece)).flatMap(item=>item.unitIds);
        const tableIds=block.kind==="table"?scoped.filter(unit=>unit.evidence.code?.language==="table"
          && unit.evidence.code.text.replace(/\r\n/gu,"\n").trim()===piece.trim()).map(unit=>unit.id):[];
        const ids=[...points.flatMap(claim=>claim.unitIds??[]),...exactIds,...tableIds];
        const isEarlier=earlier(ids)||comparison(piece,ids);
        group=isEarlier?before:discussion;
        let text=piece;
        if (!isEarlier && (block.kind==="paragraph"||block.kind==="list")) {
          for (const claim of points) {
            if (statements.get(claim)?.holder==="earlier" || !text.includes(claim.text)) continue;
            const revised=claim.text.replace(EARLIER_PROPOSAL,"");
            if(revised!==claim.text){revisions.set(claim.text,revised);text=text.replace(claim.text,revised);}
          }
        }
        group.push(caption?`${isEarlier?caption:caption.replace(OLD_CAPTION,"")}\n\n${text}`:text);
        caption="";
      }
    }
    if (!discussion.length) continue;
    const rest=`${discussionHeading}\n\n${discussion.join("\n\n")}`;
    const old=before.length?`${heading.text}\n\n${before.join("\n\n")}`:"";
    ranges.push({start:heading.start,end:contents.at(-1)!.end,text:[rest,old].filter(Boolean).join("\n\n")});
  }
  const body=ranges.reverse().reduce((text,edit)=>text.slice(0,edit.start)+edit.text+text.slice(edit.end),section.body);
  const adjusted=claims.map(claim=>revisions.has(claim.text)?{...claim,text:revisions.get(claim.text)!,formulations:undefined}:claim);
  return body!==section.body||claims.some((claim,index)=>claim!==knownClaims[index])?{...section,body,claims:adjusted}:section;
}
