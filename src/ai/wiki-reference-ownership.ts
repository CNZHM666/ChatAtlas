import { knowledgeOverlap } from "../shared/knowledge-subject";
import type { WikiKnowledgeLedger, WikiKnowledgeUnit } from "../shared/wiki-knowledge";

const keyOf = ({ evidence }: WikiKnowledgeUnit) => JSON.stringify([evidence.conversationId, evidence.messageId, evidence.section]);
const PROJECT_CHOICE = /本项目(?:明确)?(?:采用|改用|将|应|要|不)|我们(?:决定|将|采用)|\b(?:our project|we (?:will|adopt|decided))\b/iu;
const originalText = (text: string) => text.replace(/\s+/gu, " ").trim();
const DESIGN_ARTIFACT = /设计稿|设计需求|界面稿|页面稿|原型稿|静态图片|组件化|\b(?:design spec|mockups?|wireframes?|design files?)\b/iu;
const PROJECT_ARTIFACT = /代码|需求文档|实现计划|技术方案|提示词|\b(?:implementation plan|requirements doc|codebase|source files?)\b/iu;
const TOOL_HANDOFF = /(?:喂给|交给|交由|发给|提交给|导入到)\s*[`“「"']?(?:[A-Z][\w.+-]{1,32}|设计工具|编程助手|AI\s*助手)|\b(?:hand (?:it|the design|the code) off to|send (?:it|the design|the code) to|pass (?:it|the design|the code) to)\s+[A-Z][\w.+-]*/iu;
const COMPARISON = /竞品|对标|区别于|与.{1,20}(?:相比|比较)|\b(?:competitor|compared with|versus)\b/iu;
export const wikiProjectStandardText = /(?:安全|隐私|合规|干预|无障碍|内容审核)(?:的)?(?:标准|规范|规则)(?:对齐)?\s*[：:]?\s*(?:严格)?(?:遵循|采用|按)/u;

export function wikiProjectUsesStandard(unit: WikiKnowledgeUnit) {
  return !unit.about && !unit.evidence.pasted && (unit.kind === "decision" || unit.kind === "constraint")
    && wikiProjectStandardText.test(unit.statement) && !COMPARISON.test(unit.statement);
}

/** Naming a tool as the destination of our project artifact does not make
 * the point a claim about that tool's own product. */
export function wikiProjectToolHandoff(unit: WikiKnowledgeUnit): "design" | "development" | undefined {
  const text = unit.statement.trim();
  if (unit.evidence.pasted || unit.about?.role === "other_project" || COMPARISON.test(text) || !TOOL_HANDOFF.test(text)
    || unit.about?.name && text.toLowerCase().startsWith(unit.about.name.toLowerCase())) return;
  return DESIGN_ARTIFACT.test(text) ? "design" : PROJECT_ARTIFACT.test(text) ? "development" : undefined;
}

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
  const projectHandoffs = new Set(units.filter(unit => wikiProjectToolHandoff(unit) && !ledger.userOwners?.[unit.id]).map(unit => unit.id));
  const headings = new Map<string, WikiKnowledgeUnit[]>();
  for (const unit of units) {
    const name = unit.about?.name;
    if (!name || projectHandoffs.has(unit.id) || unit.about?.role === "other_project" || !unit.evidence.section?.toLowerCase().includes(name.toLowerCase())) continue;
    const key = keyOf(unit);
    const peers = headings.get(key);
    if (peers) peers.push(unit);
    else headings.set(key, [unit]);
  }
  const owners = new Map<string, NonNullable<WikiKnowledgeUnit["about"]>>();
  for (const unit of units) {
    if (!headings.size || projectHandoffs.has(unit.id) || unit.about || unit.evidence.role !== "assistant" || unit.evidence.pasted || !["unknown", "proposal"].includes(unit.adoption.status)
      || unit.kind === "decision" || unit.kind === "constraint" || unit.kind === "report" || PROJECT_CHOICE.test(unit.evidence.quote)
      || ledger.userOwners?.[unit.id] || ledger.decisions?.[unit.id]?.verdict === "confirmed") continue;
    const peers = headings.get(keyOf(unit));
    if (!peers || new Set(peers.map(peer => peer.about!.name.toLowerCase())).size !== 1) continue;
    const peer = peers.find(other => sharedOriginal(other, unit) || knowledgeOverlap(other.statement, unit.statement).length >= 3);
    if (peer?.about) owners.set(unit.id, peer.about);
  }
  const untag = (unit: WikiKnowledgeUnit) => projectHandoffs.has(unit.id) && Boolean(unit.about);
  if (!owners.size && !units.some(untag)) return ledger;
  return { ...ledger, batches: ledger.batches.map(batch => batch.units.some(unit => owners.has(unit.id) || untag(unit))
    ? { ...batch, units: batch.units.map(unit => {
      const about = owners.get(unit.id);
      return about ? { ...unit, about } : untag(unit) ? { ...unit, about: undefined } : unit;
    }) } : batch) };
}
