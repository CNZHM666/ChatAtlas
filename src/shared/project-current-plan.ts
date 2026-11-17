import { resolveWikiReading } from "../ai/wiki-knowledge-reading";
import type { FocusEvidence, FocusSession } from "./focus-session";
import { factTextKey } from "./project-fact-state";
import { wikiDocumentBlocks } from "./wiki-document-blocks";
import { currentWikiEvidence, wikiEvidenceKey } from "./wiki-evidence-link";
import { wikiStatementWithConditions, type WikiKnowledgeUnit } from "./wiki-knowledge";
import { wikiSections } from "./wiki-navigation";

const ROADMAP = /路线图|版本规划|里程碑计划|版本范围|\b(?:roadmap|release plan|milestone plan)\b/iu;
const RELEASE = /首版|第一版|本版|当前版本|本(?:轮|期|版本)范围|\b(?:MVP|v\d+(?:\.\d+)*|first release|initial release|current release|this release)\b/iu;

function discussionRoadmap(session: FocusSession) {
  for (const section of wikiSections(session)) {
    const heading = wikiDocumentBlocks(section.body).find(block => block.kind === "heading"
      && ROADMAP.test(block.text) && !/早先|早期|此前|历史|\b(?:early|earlier|historic)\b/iu.test(block.text));
    if (heading) return {sectionId: section.id, heading: heading.text.replace(/^#+\s+|\n[=-]+$/gu,"").replace(/\*\*|__/gu,"").trim()};
    if (ROADMAP.test(section.title) || /规划与安全合规|Planning and compliance/iu.test(section.title)) return {sectionId: section.id};
  }
}

/** A plan belongs to the user. Until they set one, show only the specific
 * release commitments that can independently be traced to a confirmation. */
export function projectCurrentPlan(session: FocusSession, reading?: ReturnType<typeof resolveWikiReading>) {
  if (session.mode !== "work" || session.wikiKnowledge?.documentType === "learning") return;
  const discussion = discussionRoadmap(session), personal = session.projectMaintenance?.currentPlan?.trim();
  const items: Array<{text:string; source:FocusEvidence; unit:WikiKnowledgeUnit}> = [];
  if (personal) return {personal, discussion, items};
  if (session.wikiKnowledge) {
    const resolved = reading ?? resolveWikiReading(session.wikiKnowledge);
    const sources = new Map(currentWikiEvidence(session).map(ref => [wikiEvidenceKey(ref), ref]));
    const conflicts = new Set(resolved.organization?.relations.filter(link => link.status === "unresolved"
      && ["replaces", "rejects"].includes(link.kind) && resolved.statuses.get(link.older) === "confirmed" && resolved.statuses.get(link.newer) === "confirmed")
      .flatMap(link => [link.older, link.newer]));
    const seen = new Set<string>();
    for (const unit of resolved.units) {
      if (items.length === 5) break;
      if (unit.about || unit.evidence.pasted || !["plan","decision","constraint"].includes(unit.kind)
        || resolved.statuses.get(unit.id) !== "confirmed" || conflicts.has(unit.id) || !RELEASE.test(unit.statement)) continue;
      const source = sources.get(wikiEvidenceKey({...unit.evidence, excerpt:unit.evidence.quote}));
      const text = wikiStatementWithConditions(unit, session.locale !== "en");
      const key = factTextKey(text);
      if (!source || !key || seen.has(key)) continue;
      seen.add(key);
      items.push({text, source, unit});
    }
  }
  if (discussion || items.length) return {personal, discussion, items};
}
