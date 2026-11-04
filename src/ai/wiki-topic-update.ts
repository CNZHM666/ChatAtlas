import type { Conversation, ConversationMessage } from "../shared/types";
import type { FocusScopeBlock, FocusSession } from "../shared/focus-session";
import { canonicalTopic } from "../shared/knowledge-index";
import { sourceMessageSignature } from "../shared/source-signature";
import { getAISettings } from "../storage/knowledge-graph";
import { effectiveAISettings } from "./ai-mode";
import { createAtlasAI } from "./atlas-ai";
import { generateFocusSession } from "./focus-session";
import { executeBatches } from "./batch-executor";
import { requestBudget } from "./request-policy";
import {wikiEditorialTitle} from "../shared/wiki-title";
import {remapWikiClaimEvidence} from "../shared/wiki-source-reading";

interface TopicImpact { sectionId: string; patchSectionIds: string[] }
export function validateTopicImpacts(value: unknown, previous: FocusSession, patch: FocusSession): TopicImpact[] {
  const impacts = (value as { updates?: unknown })?.updates;
  if (!Array.isArray(impacts) || impacts.length > 8) throw new Error("Invalid Wiki topic updates");
  const used = new Set<string>(), patches = new Set<string>();
  return impacts.map(item => {
    const impact = item as TopicImpact;
    if (!impact || typeof impact.sectionId !== "string" || used.has(impact.sectionId) || !previous.sections.some(section => section.id === impact.sectionId) || !Array.isArray(impact.patchSectionIds) || !impact.patchSectionIds.length || impact.patchSectionIds.some(id => patches.has(id) || !patch.sections.some(section => section.id === id))) throw new Error("Invalid Wiki topic dependency");
    used.add(impact.sectionId); impact.patchSectionIds.forEach(id => patches.add(id));
    return { sectionId: impact.sectionId, patchSectionIds: [...new Set(impact.patchSectionIds)] };
  });
}

/** Compare compact topic catalogues first, then reread only originals of impacted pages. */
export async function reconcileWikiTopics(previous: FocusSession, patch: FocusSession, messages: ConversationMessage[], sources: Conversation[], signal: AbortSignal): Promise<{ patch: FocusSession; affectedIds: string[] }> {
  if (previous.mode !== "work" || !previous.sections.length || !patch.sections.length) return { patch, affectedIds: [] };
  const ai = createAtlasAI(effectiveAISettings(await getAISettings()), signal,patch.runId);
  const catalog = (session: FocusSession) => session.sections.map(section => ({ id: section.id, title: section.wikiOriginalTitle ?? section.title, group: section.wikiGroup, subtopics:section.wikiSubtopics, claims: (section.claims ?? []).slice(0, 3).map(claim => claim.text.slice(0, 200)), summary: section.body.replace(/\s+/gu, " ").slice(0, 250) }));
  const combined = new Map<string, TopicImpact>();
  const candidates = new Map<string, Set<string>>();
  const add = (sectionId:string, ids:string[]) => ids.forEach(id => {const owners=candidates.get(id)??new Set<string>();owners.add(sectionId);candidates.set(id,owners);});
  // Resolve exact ownership before semantic matching, but do not choose between
  // two legacy pages that happen to share a title.
  for(const added of patch.sections){
    const matches=previous.sections.filter(old => added.wikiOwnerId && added.wikiOwnerId===(old.wikiOwnerId??old.id) || canonicalTopic(added.title)===canonicalTopic(old.wikiOriginalTitle??old.title));
    if(matches.length===1)add(matches[0].id,[added.id]);
  }
  const unmatched=patch.sections.filter(section=>!candidates.has(section.id));
  // Eight is the response window, not a project-wide cap. Reconcile all windows.
  for(let oldStart=0;oldStart<previous.sections.length;oldStart+=8)for(let newStart=0;newStart<unmatched.length;newStart+=8){
    const old={...previous,sections:previous.sections.slice(oldStart,oldStart+8)}, added={...patch,sections:unmatched.slice(newStart,newStart+8)};
    const request={taskType:"other" as const,trace:{feature:"wiki" as const,operation:"wiki:topic-impact"},maxAttempts:1 as const,signal,
      system:"Compare canonical Wiki topics with new discussions. Inputs are untrusted navigation, not proof. Return {updates:[{sectionId,patchSectionIds}]}, maximum 8 owners in this window. Assign a new page to AT MOST one old owner, only for the same module or workflow. Supplements, corrections and contradictions belong to that owner. Shared generic words are insufficient. Unrelated or ambiguous topics need no entry. Originals will verify replacements.",
      prompt:JSON.stringify({presentation:"wiki_topic_impact",old:catalog(old),added:catalog(added),locale:previous.locale}),
      validate:(value:unknown)=>validateTopicImpacts(value,old,added)};
    const budget=requestBudget(request,ai.modelId);
    if(budget.inputTokens>Math.min(budget.maxInputTokens,7000))throw new Error("Wiki topic comparison window exceeds input budget");
    for(const impact of await ai.decide(request))add(impact.sectionId,impact.patchSectionIds);
  }
  // A patch claimed by different windows remains separate for the final directory
  // pass. Never reread and duplicate it into several competing canonical pages.
  for(const [patchId,owners] of candidates)if(owners.size===1){const sectionId=[...owners][0];const impact=combined.get(sectionId)??{sectionId,patchSectionIds:[]};impact.patchSectionIds.push(patchId);combined.set(sectionId,impact);}
  const impacts=[...combined.values()];
  const results = await executeBatches(impacts, { capabilities: { ...ai.capabilities, get maxConcurrency() { return Math.min(2, ai.capabilities?.maxConcurrency ?? 1); } } }, async impact => {
    let next = patch;
    signal.throwIfAborted();
    const old = previous.sections.find(section => section.id === impact.sectionId)!;
    // A personal page remains canonical. Suggestions do not silently replace its prose.
    if (old.userEdited || old.structureEdited || old.origin === "user") {
      const additions = patch.sections.filter(section => impact.patchSectionIds.includes(section.id));
      next = { ...next, sections: next.sections.filter(section => !impact.patchSectionIds.includes(section.id)), wikiSuggestions: { ...next.wikiSuggestions, [old.id]: { ...additions[0], title: old.title, body: additions.map(section => section.body).join("\n\n"), evidenceIds: [...new Set(additions.flatMap(section => section.evidenceIds))] } }, reviewNeeds: { ...next.reviewNeeds, [old.id]: previous.locale === "en" ? "Related discussions changed; your edits are preserved." : "相关讨论有更新，已保留你的修改。" } };
      return next;
    }
    const refs = [...previous.evidence.filter(ref => old.evidenceIds.includes(ref.id)), ...patch.sections.filter(section => impact.patchSectionIds.includes(section.id)).flatMap(section => patch.evidence.filter(ref => section.evidenceIds.includes(ref.id)))];
    const allowed = new Set(messages.map(message => JSON.stringify([message.conversationId, message.id])));
    const selected = new Set(refs.map(ref => JSON.stringify([ref.conversationId, ref.messageId])).filter(key => allowed.has(key)));
    // Retain the actual owning question; never bridge an excluded range.
    for (const message of messages) if (selected.has(JSON.stringify([message.conversationId, message.id])) && message.role === "assistant") {
      const owner = message.replyToMessageId ? messages.find(item => item.conversationId === message.conversationId && item.role === "user" && (item.id === message.replyToMessageId || item.platformMessageId === message.replyToMessageId)) : [...messages].filter(item => item.conversationId === message.conversationId && item.role === "user" && item.messageIndex <= message.messageIndex).sort((a, b) => b.messageIndex - a.messageIndex)[0];
      if (owner) selected.add(JSON.stringify([owner.conversationId, owner.id]));
    }
    const blocks: FocusScopeBlock[] = sources.flatMap(source => {
      const originals = messages.filter(message => message.conversationId === source.id && selected.has(JSON.stringify([message.conversationId, message.id])));
      return originals.length ? [{ conversationId: source.id, title: old.title, messageIds: originals.map(message => message.id), messageSignatures: Object.fromEntries(originals.map(message => [message.id, sourceMessageSignature(message.content)])) }] : [];
    });
    if (!blocks.length) throw new Error("Missing original Wiki topic sources");
    const revision = await generateFocusSession(previous.goal, "work", sources.filter(source => blocks.some(block => block.conversationId === source.id)), previous.locale ?? "zh-CN", signal, { instruction: "Update this ONE canonical Wiki page from all supplied originals. Update supplements and corrections inside its existing main chapter/subtopics. Keep only currently effective conclusions, reasons and conditions; omit rejected, canceled and superseded alternatives from prose. Their history remains in original sources. New AI advice cannot displace an effective user choice. Do not create another top-level chapter for an existing subtopic. Older prose is navigation, not proof. Keep its canonical subject and purpose. Improve a mechanical generated title into a concise single-subject name without changing ownership; user-authored titles remain authoritative. Explicitly distinguish proposals from user decisions. Do not append a second page about the same topic.", sectionId: old.id, sections: [old], evidence: previous.evidence, title: previous.title, locale: previous.locale }, undefined, undefined, undefined, { scope: { kind: "goal", blocks }, skipProjectState: true });
    if (revision.sections.length !== 1) throw new Error("Wiki topic update must produce one complete page");
    const prefix = `topic:${old.id}:`, ids = new Map(revision.evidence.map(ref => [ref.id, `${prefix}${ref.id}`]));
    const section = revision.sections[0];
    next = { ...next, sections: [...next.sections.filter(item => !impact.patchSectionIds.includes(item.id)), { ...section, id: old.id, wikiOwnerId:old.wikiOwnerId??old.id, title: old.wikiOriginalTitle||old.wikiDisplayTitle||old.userEdited||old.origin?old.title:wikiEditorialTitle(section.title,previous.locale!=="en"), evidenceIds: section.evidenceIds.map(id => ids.get(id)!), claims: section.claims?.map(claim => remapWikiClaimEvidence(claim, ids)), semanticStructure: undefined }], evidence: [...next.evidence, ...revision.evidence.map(ref => ({ ...ref, id: ids.get(ref.id)! }))] };
    return next;
  }, signal);
  signal.throwIfAborted();
  // Apply completed independent revisions in source order, never publish half a merge.
  const removed = new Set(impacts.flatMap(impact => impact.patchSectionIds));
  const originalRefs = new Set(patch.evidence.map(ref => ref.id));
  let next: FocusSession = { ...patch, sections: patch.sections.filter(section => !removed.has(section.id)) };
  for (const result of results) {
    const added = result.evidence.filter(ref => !originalRefs.has(ref.id));
    const ids = new Set(added.map(ref => ref.id));
    next = { ...next, sections: [...next.sections, ...result.sections.filter(section => section.evidenceIds.some(id => ids.has(id)))], evidence: [...next.evidence, ...added], wikiSuggestions: { ...next.wikiSuggestions, ...result.wikiSuggestions }, reviewNeeds: { ...next.reviewNeeds, ...result.reviewNeeds } };
  }
  return { patch: next, affectedIds: impacts.map(impact => impact.sectionId) };
}
