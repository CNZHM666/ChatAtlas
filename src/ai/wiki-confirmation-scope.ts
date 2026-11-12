import { knowledgeTerms } from "../shared/knowledge-subject";
import { wikiUnitConditions, type WikiKnowledgeLedger, type WikiKnowledgeUnit, type WikiUnitStatus } from "../shared/wiki-knowledge";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { claimSupported } from "./wiki-claim-support";

const normalize = (text: string) => text.normalize("NFKC").toLowerCase();
const compact = (text: string) => normalize(text).replace(/[\s*_`“”「」"']/gu, "");
const NUMBER = String.raw`[+−-]?\d+(?:\.\d+)?`;
const VALUE = String.raw`(?:[<>≤≥]=?\s*)?${NUMBER}(?:\s*[-–—~至到]\s*${NUMBER})?`;
const DETAILS = new RegExp(String.raw`#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b|[$¥€£]\s*${NUMBER}|${VALUE}(?:\s*(?:毫秒|分钟|小时|秒|天|日(?!活)|周|个月|年|元|次|个|条|人|%|(?:usd|cny|eur|ms|px|gb|mb|kb|days?|weeks?|months?|years?|seconds?|minutes?|hours?)\b))?`, "giu");
const CONDITION = /(?:^|[，,；;：:]\s*)((?:如果|若(?!干)|仅当|除非|只在|一旦|当|待|(?:if|only if|unless|when|once|after|upon)\b)[^，,。；;！？\n]{2,65}|[^，,。；;！？\n]{2,22}(?:完成|通过|验证|触发)[^，,。；;！？\n]{0,16}后)(?=[，,。；;！？：:]|$)/giu;
const ADDITIONAL = /(?:^|[，,；;：:]\s*)(?:同时|并且|另需|还需|(?:and also|additionally)\b)\s*([^，,。；;！？\n]{3,65})/giu;
const ADOPTION = /确认|决定|已定|敲定|\b(?:confirmed|decided|approved|agreed|settled)\b/iu;
const CHOSEN_DIRECTION = /采用|使用|启用|选用|\b(?:adopt\w*|use|enable\w*)\b/iu;
const NEGATED_CHOICE = /(?:不(?:再)?|禁止|拒绝)(?:采用|启用|使用|保留|支持|开放|加入|执行|增加|引入|提供)|\b(?:not|never|without|reject\w*|disabl\w*)\b/iu;
const TENTATIVE = /(?:^|[：:；;，,]\s*)(?:AI[^。！？\n]{0,18}建议|AI\s+(?:proposal|suggestion)\b|建议|提议|未确认|待确认|待核对|暂定|\b(?:suggest\w*|propos\w*|tentative|unconfirmed|pending review)\b)|细节待核对|details requiring review|（AI 建议，待确认）|\(AI proposal, pending confirmation\)/iu;
const CONFIRMED_CELL = /^(?:已定|已确认|已通过|confirmed|approved|decided)$/iu;
const SENTENCE = /(?<=[。！？])|(?<=[.!?])(?=\s+\D)/u;
const CLAUSE = /[：:；;，]|,(?!\d{3}\b)|\s+[—–]\s+/gu;

/** Compare the value with its unit and keep triggers as phrases. A bare 30
 * cannot authorize 30 days, a price, or a differently timed action. */
export function wikiConfirmationDetails(text: string): string[] {
  const normalized = normalize(text).replace(/\bv\d+(?:\.\d+)*/giu, "");
  return [...new Set([
    ...[...normalized.matchAll(DETAILS)].map(match => compact(match[0]).replace(/−/gu, "-").replace(/(?<=\d)[–—~至到](?=[+-]?\d)/gu, "-")),
    ...[...normalized.matchAll(CONDITION)].map(match => compact(match[1])),
    ...[...normalized.matchAll(ADDITIONAL)].map(match => compact(match[1])),
  ])];
}

export function wikiUnitConfirmationDetails(unit: WikiKnowledgeUnit): string[] {
  return [...new Set([...wikiConfirmationDetails(unit.statement), ...wikiUnitConditions(unit).map(compact)])];
}

export interface WikiConfirmationScope { decision: WikiKnowledgeUnit; proposal: WikiKnowledgeUnit; choice: string }

/** Use the selected action, not every alternative mentioned in the question. */
export function wikiConfirmationScopes(ledger: WikiKnowledgeLedger, units: Map<string, WikiKnowledgeUnit>, statuses: ReadonlyMap<string, WikiUnitStatus>): WikiConfirmationScope[] {
  const proposed = (unit: WikiKnowledgeUnit | undefined): unit is WikiKnowledgeUnit => Boolean(unit && statuses.get(unit.id) === "proposal" && unit.evidence.role === "assistant" && !unit.evidence.pasted && !unit.about);
  const selected = (ledger.userAnswers ?? []).flatMap(answer => {
    const option = ledger.writingQuestions?.find(question => question.id === answer.questionId)?.options.find(item => item.id === answer.optionId);
    const id = `answer:${answer.questionId}:${answer.optionId}`, decision = units.get(id);
    if (!option || !decision || statuses.get(id) !== "confirmed") return [];
    return option.actions.flatMap(action => action.do === "confirm" || action.do === "both" ? action.units : []).flatMap(id => {
      const proposal = units.get(id);
      return proposed(proposal) ? [{ decision, proposal, choice: answer.answer || option.label }] : [];
    });
  });
  for (const relation of ledger.organization?.relations ?? []) {
    if (relation.status !== "resolved" || relation.kind !== "supplements" && relation.kind !== "narrows") continue;
    const [decisionId, proposalId] = statuses.get(relation.older) === "confirmed" ? [relation.older, relation.newer] : [relation.newer, relation.older];
    const decision = units.get(decisionId), proposal = units.get(proposalId);
    if (decision && statuses.get(decisionId) === "confirmed" && proposed(proposal) && !selected.some(scope => scope.decision.id === decisionId && scope.proposal.id === proposalId)) {
      selected.push({ decision, proposal, choice: decision.statement });
    }
  }
  return selected;
}

const stop = (text: string, zh: boolean) => /[。！？.!?]$/u.test(text) ? text : `${text}${zh ? "。" : "."}`;
const sharesCore = (text: string, core: string) => {
  const own = knowledgeTerms(text), chosen = knowledgeTerms(core);
  const shared = [...chosen].filter(term => own.has(term)).length;
  return shared >= 2 && shared / chosen.size >= .65;
};
export const wikiConfirmationCovers = (text: string, details: string[]) => {
  const key = compact(text), known = new Set(wikiConfirmationDetails(text));
  return details.every(detail => known.has(detail) || /[^\d\s.%]/u.test(detail) && !/\d/u.test(detail) && key.includes(detail));
};

export interface WikiScopedClaim { before: string; parts: Array<{ text: string; unit?: WikiKnowledgeUnit }> }

/** Confirmation may cover the leading choice while the following clause names
 * terms from an unadopted proposal. Repair only the generated assertion. */
export function reviewWikiScopedClaims(text: string, scopes: WikiConfirmationScope[], confirmed: WikiKnowledgeUnit[], zh: boolean, table = false): WikiScopedClaim[] {
  if (!scopes.length) return [];
  return (table ? text.split("\n").slice(2) : text.split(SENTENCE)).flatMap(raw => {
    const before = raw.trim();
    if (!before || (table ? before.split("|").some(cell => TENTATIVE.test(cell.trim())) : TENTATIVE.test(before))) return [];
    // A list item keeps its marker ahead of what is said of it: the label went before 「- 」 and the item read as prose.
    const marker = table ? "" : before.match(/^(?:[-*+]|\d+[.)])\s+/u)?.[0] ?? "";
    const content = table ? before.split("|").map(cell => cell.trim()).filter(cell => cell && !CONFIRMED_CELL.test(cell)).join("，") : before.slice(marker.length);
    const clauses = table ? [] : [...content.matchAll(CLAUSE)];
    for (const scope of scopes) {
      const boundary = clauses.find(mark => {
        const head = content.slice(0, mark.index);
        return (ADOPTION.test(head) || CHOSEN_DIRECTION.test(head)) && NEGATED_CHOICE.test(head) === NEGATED_CHOICE.test(scope.choice) && sharesCore(head, scope.choice);
      });
      const lead = boundary ? content.slice(0, boundary.index).trim() : "";
      const leadCovered = wikiConfirmationCovers(scope.decision.statement, wikiConfirmationDetails(lead));
      const head = leadCovered ? lead : scope.decision.statement;
      const detail = boundary && leadCovered ? content.slice(boundary.index + boundary[0].length).trim() : content;
      const anchors = wikiConfirmationDetails(detail);
      if (!anchors.length) continue;
      if (confirmed.some(unit => wikiConfirmationCovers(unit.statement, anchors) && NEGATED_CHOICE.test(unit.statement) === NEGATED_CHOICE.test(detail)
        && sharesCore(unit.statement, detail) && claimSupported(detail, [unit]))) continue;
      const supported = wikiConfirmationCovers(`${scope.proposal.statement} ${wikiUnitConditions(scope.proposal).join("；")}`, anchors) && claimSupported(detail, [scope.proposal]);
      if (!supported && !head) continue;
      if (table) {
        const suffix = zh ? "（AI 建议，待确认）" : " (AI proposal, pending confirmation)";
        const cells = before.split("|"), standing = cells.findIndex(cell => CONFIRMED_CELL.test(cell.trim()));
        let compound = false;
        for (const [index, cell] of cells.entries()) {
          if (!ADOPTION.test(cell)) continue;
          const edits = reviewWikiScopedClaims(cell, [scope], confirmed, zh);
          for (const edit of edits) {
            cells[index] = cells[index].replace(edit.before, () => edit.parts.map(part => part.text).join(zh ? "" : " "));
            compound = true;
          }
        }
        if (standing >= 0) cells[standing] = zh ? " AI 建议，待确认 " : " AI proposal, pending confirmation ";
        const text = standing >= 0 || compound ? cells.join("|") : before.replace(/\s*\|$/u, `${suffix} |`);
        return [{ before, parts: [{ text, unit: scope.proposal }] }];
      }
      const label = supported ? zh ? "AI 对具体细节的建议：" : "AI proposal for the details: " : zh ? "以下细节待核对：" : "Details requiring review: ";
      const topic = !head && zh ? detail.match(/^[^，,。]{2,18}(?:方面|部分|环节)[，,]\s*/u)?.[0] ?? "" : "";
      // A list under the label starts on its own line: 「AI 对具体细节的建议：- **模块顺序**：……」 read the first item as prose.
      const listed = /^(?:[-*+]|\d+[.)])\s/u.test(detail.slice(topic.length)) ? "\n" : "";
      const parts = [...(head ? [{ text: stop(head, zh), unit: scope.decision }] : []), { text: `${topic}${label}${listed}${stop(detail.slice(topic.length), zh)}`, ...(supported ? { unit: scope.proposal } : {}) }];
      return [{ before, parts: parts.map((part, index) => index ? part : { ...part, text: `${marker}${part.text}` }) }];
    }
    return [];
  });
}

const UNDER_LABEL = /(?:AI 对具体细节的建议|以下细节待核对|AI proposal for the details|Details requiring review)[：:]$/u;

export function applyWikiConfirmationScope(text: string, scopes: WikiConfirmationScope[], confirmed: WikiKnowledgeUnit[], zh: boolean, originals = new Set<string>()) {
  const edits: WikiScopedClaim[] = [];
  if (!scopes.length) return { text, edits };
  for (const block of wikiDocumentBlocks(text).reverse()) {
    if (block.kind !== "paragraph" && block.kind !== "table" && block.kind !== "list" || originals.has(block.text.trim())) continue;
    // A list a label already leads is told as proposals: labelling its items again repeated the label on each run.
    if (block.kind === "list" && UNDER_LABEL.test(text.slice(0, block.start).trimEnd())) continue;
    const parts = block.kind === "list" ? block.text.split("\n").flatMap(line => reviewWikiScopedClaims(line, scopes, confirmed, zh))
      : reviewWikiScopedClaims(block.text, scopes, confirmed, zh, block.kind === "table");
    if (!parts.length) continue;
    let revised = block.text;
    for (const edit of parts) revised = revised.replace(edit.before, () => edit.parts.map(part => part.text).join(zh ? "" : " "));
    text = text.slice(0, block.start) + revised + text.slice(block.end);
    edits.unshift(...parts);
  }
  return { text, edits };
}
