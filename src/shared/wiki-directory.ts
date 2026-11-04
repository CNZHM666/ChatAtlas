import type { FocusSection } from "./focus-session";
/** Naming protection is independent of authored graphs, notes and categories. */
export const editableWikiTitle=(section:FocusSection)=>!section.origin&&!section.userEdited&&section.wikiOriginalTitle===undefined&&section.wikiDisplayTitle===undefined;
export const editableWikiTopic = (section: FocusSection) => !section.origin && !section.userEdited && !section.structureEdited && !section.wikiGroupEdited && section.wikiOriginalTitle === undefined && section.wikiDisplayTitle === undefined && !section.understandingPath?.some(step=>step.origin||step.userEdited||step.structureEdited) && !section.understandingLinks?.length && !section.personalExplanation && !section.responsibility && !section.wikiDiagram;
/** Child support may overlap within one owning parent during generated writing. */
export interface WikiSubtopic { title:string; question:string; sectionIds:string[] }
/** materialKeys: scope keys of the reading notes this chapter was planned from, so the reader can leave the chapter out. */
export interface DirectoryPage { title: string; group: string; question: string; sectionIds: string[]; subtopics?:WikiSubtopic[]; ownerId?:string; materialKeys?:string[] }
/** Reorganize generated drafts without rewriting or deleting substantive text.
 * Only exact repeated paragraphs are collapsed; all original citations survive. */
export function applyWikiDirectory(sections: FocusSection[], pages: DirectoryPage[]): FocusSection[] {
  return pages.map(page => {
    const originals = sections.filter(section => page.sectionIds.includes(section.id));
    const first = originals[0];
    const outline=page.subtopics?.map(({title,question})=>({title,question}));
    if (originals.length === 1) return { ...first, title: page.title, wikiGroup: page.group || undefined, wikiQuestion: page.question,wikiOwnerId:page.ownerId??first.wikiOwnerId??first.id,...(outline?.length?{wikiSubtopics:outline}:{}) };
    const seen = new Set<string>();
    const write=(section:FocusSection) => {
      // Code fences are indivisible. Do not deduplicate fragments inside examples.
      const paragraphs = section.body.split(/\n\s*\n/u);
      const body = /(?:^|\n)\s*(?:```|~~~)/u.test(section.body) ? section.body : paragraphs.filter(paragraph => {
        // Batches can repeat a paragraph that differs only in spacing (AI指出 / AI 指出).
        const key = paragraph.replace(/\s+/gu, "");
        if (seen.has(key)) return false;
        seen.add(key); return true;
      }).join("\n\n");
      // A shared reading subject does not make a proposal a confirmed fact.
      const mixed=originals.some(item=>item.kind!==section.kind);
      const label=section.kind==="proposal"?"待确认建议 / Proposal":section.kind==="open_question"?"待解决问题 / Open question":"";
      return mixed&&label?`### ${label}\n\n${body.trim()}`:body.trim();
    };
    // The plan defines real subtopics, rather than preserving every old chapter
    // title as a sibling page. All immutable prose and evidence remain retained.
    const pieces=page.subtopics?.length?page.subtopics.map(topic=>{
      const bodies=originals.filter(section=>topic.sectionIds.includes(section.id)).map(write).filter(Boolean);
      return bodies.length?`## ${topic.title}\n\n${bodies.join("\n\n")}`:"";
    }).filter(Boolean).join("\n\n"):originals.map(section=>{const body=write(section);return body?section.title.trim()===page.title.trim()?body:`### ${section.title}\n\n${body}`:"";}).filter(Boolean).join("\n\n");
    const claims = [...new Map(originals.flatMap(section => section.claims ?? []).map(claim => [JSON.stringify(claim), claim])).values()];
    return { ...first, title: page.title, wikiGroup: page.group || undefined, wikiQuestion: page.question,wikiOwnerId:page.ownerId??first.wikiOwnerId??first.id, body: pieces,...(outline?.length?{wikiSubtopics:outline}:{}),phase:originals.every(item=>item.phase===first.phase)?first.phase:undefined,
      relatedKnowledgeIds:[...new Set(originals.flatMap(section=>section.relatedKnowledgeIds??[]))],matterLinks:[...new Map(originals.flatMap(section=>section.matterLinks??[]).map(link=>[JSON.stringify([link.type,link.id]),link])).values()],
      kind: originals.some(section => section.kind !== first.kind) ? "review" : first.kind,
      evidenceIds: [...new Set(originals.flatMap(section => section.evidenceIds))], claims: claims.length ? claims : undefined,
      evidenceReview: {mode:"manual",status:claims.length?"anchored":"unanchored",invalidClaims:0,checkedClaims:0,totalClaims:claims.length},editorialReview:undefined,
      reviewIssue: originals.find(section=>section.reviewIssue)?.reviewIssue,
      semanticStructure: undefined, semanticBodySignature: undefined,
    };
  });
}

