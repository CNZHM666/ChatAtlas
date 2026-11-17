import type { FocusEvidence, FocusSession } from "./focus-session";

export const WIKI_EVIDENCE_LINK = "#atlas-original-";
export const wikiEvidenceHref = (ref: FocusEvidence, table?:string) =>
  WIKI_EVIDENCE_LINK + encodeURIComponent(ref.id).replace(/\(/gu,"%28").replace(/\)/gu,"%29") + (table ? `/table/${table}` : "");

export function wikiEvidenceTarget(href:string) {
  if(!href.startsWith(WIKI_EVIDENCE_LINK))return;
  const parts=href.slice(WIKI_EVIDENCE_LINK.length).split("/table/");
  if(!parts[0]||parts.length>2||parts.length===2&&!/^\d+:[a-z0-9]+$/u.test(parts[1]))return;
  try{return {id:decodeURIComponent(parts[0]),table:parts[1]};}catch{return;}
}
export const wikiEvidenceKey = (ref: Pick<FocusEvidence, "conversationId" | "messageId" | "excerpt">) =>
  JSON.stringify([ref.conversationId, ref.messageId, ref.excerpt.trim()]);

export function availableWikiEvidence(session: FocusSession, ref: FocusEvidence) {
  const current = session.sourceSignatures?.[ref.conversationId]?.[ref.messageId];
  return session.sourceConversationIds.includes(ref.conversationId)
    && (!current || !ref.sourceSignature || current === ref.sourceSignature)
    && (session.scope?.kind !== "goal" || session.scope.blocks?.some(block =>
      block.conversationId === ref.conversationId && block.messageIds.includes(ref.messageId)));
}

export function currentWikiEvidence(session: FocusSession) {
  const excludedKeys=new Set([...session.wikiScopeReview?.excludeKeys??[],...session.wikiScopeReview?.ignoredKeys??[]]);
  const excluded=new Set(session.wikiScopeReview?.materials.filter(item=>(item.keys??[item.key]).every(key=>excludedKeys.has(key))).flatMap(item=>item.evidenceIds));
  return session.evidence.filter(ref=>!excluded.has(ref.id)&&availableWikiEvidence(session,ref));
}
