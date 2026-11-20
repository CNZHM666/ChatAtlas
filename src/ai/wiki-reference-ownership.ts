import { knowledgeOverlap } from "../shared/knowledge-subject";
import type { WikiKnowledgeLedger, WikiKnowledgeUnit } from "../shared/wiki-knowledge";

const keyOf = ({ evidence }: WikiKnowledgeUnit) => JSON.stringify([evidence.conversationId, evidence.messageId, evidence.section]);
const PROJECT_CHOICE = /本项目(?:明确)?(?:采用|改用|将|应|要|不)|我们(?:决定|将|采用)|\b(?:our project|we (?:will|adopt|decided))\b/iu;
const originalText = (text: string) => text.replace(/\s+/gu, " ").trim();

function sharedOriginal(first: WikiKnowledgeUnit, second: WikiKnowledgeUnit) {
  const a = originalText(first.evidence.quote), b = originalText(second.evidence.quote);
  if (Math.min(a.length, b.length) >= 24 && (a.includes(b) || b.includes(a))) return true;
  const block = first.evidence.code?.text.trim();
  return Boolean(block && block.length >= 24 && block === second.evidence.code?.text.trim());
}

/** An exact original heading in the same message can carry a reference's
 * owner across nearby excerpts. A product mention alone cannot. */
export function withReferenceOwnership(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  const units = ledger.batches.flatMap(batch => batch.units);
  const headings = new Map<string, WikiKnowledgeUnit[]>();
  for (const unit of units) {
    const name = unit.about?.name;
    if (!name || unit.about?.role === "other_project" || !unit.evidence.section?.toLowerCase().includes(name.toLowerCase())) continue;
    const key = keyOf(unit);
    const peers = headings.get(key);
    if (peers) peers.push(unit);
    else headings.set(key, [unit]);
  }
  if (!headings.size) return ledger;
  const owners = new Map<string, NonNullable<WikiKnowledgeUnit["about"]>>();
  for (const unit of units) {
    if (unit.about || unit.evidence.role !== "assistant" || unit.evidence.pasted || !["unknown", "proposal"].includes(unit.adoption.status)
      || unit.kind === "decision" || unit.kind === "constraint" || unit.kind === "report" || PROJECT_CHOICE.test(unit.evidence.quote)
      || ledger.userOwners?.[unit.id] || ledger.decisions?.[unit.id]?.verdict === "confirmed") continue;
    const peers = headings.get(keyOf(unit));
    if (!peers || new Set(peers.map(peer => peer.about!.name.toLowerCase())).size !== 1) continue;
    const peer = peers.find(other => sharedOriginal(other, unit) || knowledgeOverlap(other.statement, unit.statement).length >= 3);
    if (peer?.about) owners.set(unit.id, peer.about);
  }
  if (!owners.size) return ledger;
  return { ...ledger, batches: ledger.batches.map(batch => batch.units.some(unit => owners.has(unit.id))
    ? { ...batch, units: batch.units.map(unit => {
      const about = owners.get(unit.id);
      return about ? { ...unit, about } : unit;
    }) } : batch) };
}
