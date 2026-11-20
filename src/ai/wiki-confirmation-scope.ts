import { knowledgeTerms } from "../shared/knowledge-subject";
import { wikiUnitConditions, type WikiKnowledgeLedger, type WikiKnowledgeUnit, type WikiUnitStatus } from "../shared/wiki-knowledge";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { wikiTableCells } from "../shared/wiki-table-source";
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
const TENTATIVE = /(?:^|[：:；;，,]\s*)(?:AI[^。！？\n]{0,18}建议|AI\s+(?:proposal|suggestion)\b|建议|提议|未确认|待确认|待核对|暂定|\b(?:suggest\w*|propos\w*|tentative|unconfirmed|pending review)\b)|细节待核对|details requiring review|（(?:AI\s*建议，)?待确认）|\(AI proposal, pending confirmation\)/iu;
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

export interface WikiConfirmationScope { decision: WikiKnowledgeUnit; proposal: WikiKnowledgeUnit; choice: string; question?: string }

/** Use the selected action, not every alternative mentioned in the question. */
export function wikiConfirmationScopes(ledger: WikiKnowledgeLedger, units: Map<string, WikiKnowledgeUnit>, statuses: ReadonlyMap<string, WikiUnitStatus>): WikiConfirmationScope[] {
  const proposed = (unit: WikiKnowledgeUnit | undefined): unit is WikiKnowledgeUnit => Boolean(unit && statuses.get(unit.id) === "proposal" && unit.evidence.role === "assistant" && !unit.evidence.pasted && !unit.about);
  const selected = (ledger.userAnswers ?? []).flatMap<WikiConfirmationScope>(answer => {
    const option = ledger.writingQuestions?.find(question => question.id === answer.questionId)?.options.find(item => item.id === answer.optionId);
    const id = `answer:${answer.questionId}:${answer.optionId}`, decision = units.get(id);
    if (!option || !decision || statuses.get(id) !== "confirmed") return [];
    return option.actions.flatMap(action => action.do === "confirm" || action.do === "both" ? action.units : []).flatMap(id => {
      const proposal = units.get(id);
      return proposed(proposal) ? [{ decision, proposal, choice: answer.answer || option.label, question: answer.question }] : [];
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

/** Compare a scoped local choice with its literal or a status-only restatement. */
export function wikiDecisionRestatement(text: string, choice: string) {
  const key = (value: string) => compact(value).replace(/[。.!?！？]$/u, "");
  const exact = key(choice);
  const framed = text.replace(/^(?:\*\*|__)*/u, "")
    .replace(/^(?:现行决定是|[^，。；：:]{1,24}?(?:已确认|确认为|已决定|决定为|确认采用)|(?:项目发起人)?(?:已确认|已决定|确认采用)|决定(?=先|采用|保留|暂缓|不))\s*[：:]?\s*/u, "");
  const named = key(text).replace(/^([^：:，。；]{1,26}?)(?:已)?确认为/u, "$1:");
  const releaseChoice = exact.match(/^发布(v\d+(?:\.\d+)+(?:-[\w.-]+)?)标签$/iu)?.[1];
  const releaseRestatement = key(text).match(/^(?:首个公开版本|首发版本|发布标签)(?:已)?确认为(v\d+(?:\.\d+)+(?:-[\w.-]+)?)标签$/iu)?.[1];
  return Boolean(exact && (key(text) === exact || key(framed) === exact || named === exact || releaseChoice && releaseChoice === releaseRestatement));
}

/** A closed list added after a confirmed rule needs its own evidence. */
export function wikiAddedDecisionList(text: string, choice: string) {
  for (const boundary of text.matchAll(/[，,；;]\s*/gu)) {
    const lead = text.slice(0, boundary.index).trim().replace(/^(?:同时|另外|此外|also)[，,\s]*/iu, "");
    if (!wikiDecisionRestatement(lead, choice)) continue;
    const tail = text.slice(boundary.index + boundary[0].length).trim();
    const list = tail.match(/^[^：:\n]{2,60}[：:]\s*(.+)$/u)?.[1] ?? tail.match(/\b(?:including|limited to|consists of)\s+(.+)$/iu)?.[1];
    const items = list?.replace(/[。.!?！？]$/u, "").split(/\s*[、，,]\s*/u).filter(Boolean);
    if (items && items.length >= 3 && items.some(item => !compact(choice).includes(compact(item)))) return tail;
  }
  return undefined;
}

export function wikiChoiceTrigger(question: string, answer: string) {
  if (!/触发|时机|何时|什么时候|\b(?:trigger|when)\b/iu.test(question)) return;
  return answer.match(/^(?:当|在)?(.{2,40}?(?:时|后|前))(?=\s*(?:自动|才|生成|执行|显示|运行|发送))/u)?.[1]
    ?? answer.match(/^((?:when|after|before|upon)\s+[^.!?]{4,80})$/iu)?.[1];
}

/** A deferral bound to the release and the capability the choice asked about. */
export function wikiReleaseDeferral(question: string, answer: string) {
  if (!/暂缓|推迟|延期|排除|不纳入|后续阶段|\b(?:defer|postpone|exclude|later release)\b/iu.test(answer)) return;
  const choice = question.match(/^([^，。！？：:\n]{2,38}?)\s*是否(?:纳入|列入|加入|计入)\s*(v\d+(?:\.\d+)*|第[一二三四五六七八九十\d]+(?:版|阶段)|首版)/iu)
    ?? question.match(/^should\s+([^,?]{2,55}?)\s+be\s+(?:part of|included in)\s+(v\d+(?:\.\d+)*)\b/iu);
  return choice ? { feature: choice[1].trim(), stage: choice[2] } : undefined;
}

/** A hold on a numbered layer cannot name the parent subsystem as its subject. */
export function wikiLayerDeferral(question: string, answer: string) {
  if (!/^(?:维持现状[，,、\s]*)?(?:暂不(?:开发|实现)|继续预留)[。]?$/u.test(answer.trim())) return;
  const layer = question.match(/^(Level\s+\d+(?:\s*\([^()\n]{2,35}\))?|第[一二三四五六七八九十\d]+层(?:\s*[（(][^）)\n]{2,35}[）)])?)\s*(?=目前|当前|现阶段|暂|仅)/iu)?.[1];
  if (!layer || !/仅预留|只预留/u.test(question)) return;
  return `${layer}：维持预留，暂不开发。`;
}

export interface WikiScopedClaim { before: string; replacement?: string; parts: Array<{ text: string; unit?: WikiKnowledgeUnit }> }

const RELEASE_CHECKLIST = /^(首版|第[一二三四五六七八九十\d]+版|v\d+(?:\.\d+)*)\s*(?:中)?是否(?:立即|优先)?(?:实施|实现|支持|启用|开展|执行|纳入|包含|进行)\s*([^？?。；;，,]+)[？?]$/iu;
const POSITIVE_CHECKLIST_CHOICE = /^(?:是|确认|同意|立即实施|优先实现|(?:实施|实现|执行|启用|纳入|开展|进行)(?:检查|校验|验证|检测))[。.!！]?$/u;
const checklistRelease = (text: string) => compact(text).replace(/^(?:首版|第1版)$/u, "第一版");
const checklistItems = (text: string) => text.replace(/、\s*(?:以及|及|和|与)/gu, "、").split(/、|以及/gu).map(item => item.trim());

function releaseChecklistChoice(question: string, choice: string) {
  const selected = question.match(RELEASE_CHECKLIST);
  if (!selected || !POSITIVE_CHECKLIST_CHOICE.test(choice.trim())) return;
  const target = selected[2].match(/^(.+?)(检查|校验|验证|检测)$/u);
  if (!target) return;
  const keys = target[1].split(/\s*(?:、|以及|与|和|及)\s*/u).map(compact);
  if (keys.length < 2 || keys.some(key => key.length < 2) || new Set(keys).size !== keys.length) return;
  return { release: selected[1], target: selected[2], keys };
}

function confirmedChecklistIndices(keys: string[], items: string[]) {
  const matches = keys.map(key => items.flatMap((item, index) => {
    const text = compact(item);
    return text.startsWith(key) && /^(?:(?:明显)?(?:不兼容|兼容性?)|(?:检查|校验|验证|检测))?$/u.test(text.slice(key.length)) ? [index] : [];
  }));
  const picked = new Set(matches.flat());
  if (matches.every(indices => indices.length === 1) && picked.size === keys.length && picked.size < items.length) return picked;
}

/** A short affirmative answer to a release checklist confirms only the
 * checks named in the question and present in its cited proposal. */
export function wikiReleaseChecklistStatement(question: string, choice: string, proposal: WikiKnowledgeUnit) {
  const selected = releaseChecklistChoice(question, choice);
  if (!selected) return;
  const release = proposal.statement.match(/^(首版|第[一二三四五六七八九十\d]+版|v\d+(?:\.\d+)*)/iu)?.[1];
  if (release && checklistRelease(release) !== checklistRelease(selected.release)) return;
  const content = proposal.statement.slice(release?.length ?? 0).trimStart();
  const listed = content.match(/^(?:应|需|要)?(?:至少|优先|首先)?(?:检查|校验|验证|检测)[：:\s]*([^。；;\n]+)[。]?$/u);
  const items = listed ? checklistItems(listed[1]) : [];
  const evidence = compact(proposal.evidence.quote);
  if (items.length < 3 || !items.every(item => item && evidence.includes(compact(item))) || !confirmedChecklistIndices(selected.keys, items)) return;
  return `${selected.release}计划实施${selected.target}。`;
}

/** Keep a selected subset on its own row, with the decision as the binding.
 * The original proposal and literal release still govern the remaining checks. */
function splitReleaseChecklist(row: string, header: string[], scopes: WikiConfirmationScope[], bound: (value: string, scope: WikiConfirmationScope) => boolean): WikiScopedClaim | undefined {
  const [topic, storedValue, extra] = wikiTableCells(row);
  if (!topic || !storedValue || extra !== undefined || header.length !== 2 || !storedValue.includes("、")) return;
  const value = storedValue.replace(/（AI\s*建议，待确认）$/u, "").trimEnd();
  const checklist = value.match(/^((?:至少|优先|首先)?(?:检查|校验|验证|检测))\s*([^。；;：:]+?)[。]?$/u);
  if (!checklist) return;
  const items = checklistItems(checklist[2]);
  if (items.length < 3 || items.some(item => !item || item.length > 40)) return;
  for (const scope of scopes) {
    const { decision, proposal, choice, question } = scope;
    const selected = question && releaseChecklistChoice(question, choice);
    if (!selected || checklistRelease(selected.release) !== checklistRelease(header[1]) || !bound(value, scope)) continue;
    const confirmed = confirmedChecklistIndices(selected.keys, items);
    if (!confirmed) continue;
    const evidence = compact(proposal.evidence.quote);
    if (!items.every(item => evidence.includes(compact(item)))) continue;
    const action = checklist[1].replace(/^(?:至少|优先|首先)/u, "");
    const agreed = action + items.filter((_, index) => confirmed.has(index)).join("、");
    const pending = checklist[1] + items.filter((_, index) => !confirmed.has(index)).join("、");
    return { before: row, replacement: `| ${topic}（已确认纳入） | ${agreed} |\n| ${topic}（待确认） | ${pending} |`,
      parts: [{ text: agreed, unit: decision }, { text: pending, unit: proposal }] };
  }
}

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

export function applyWikiConfirmationScope(text: string, scopes: WikiConfirmationScope[], confirmed: WikiKnowledgeUnit[], zh: boolean, originals = new Set<string>(),
  boundTableRow?: (value: string, scope: WikiConfirmationScope) => boolean) {
  const edits: WikiScopedClaim[] = [];
  if (!scopes.length) return { text, edits };
  for (const block of wikiDocumentBlocks(text).reverse()) {
    if (block.kind !== "paragraph" && block.kind !== "table" && block.kind !== "list" || originals.has(block.text.trim())) continue;
    // A list a label already leads is told as proposals: labelling its items again repeated the label on each run.
    if (block.kind === "list" && UNDER_LABEL.test(text.slice(0, block.start).trimEnd())) continue;
    const parts = block.kind === "list" ? block.text.split("\n").flatMap(line => reviewWikiScopedClaims(line, scopes, confirmed, zh))
      : reviewWikiScopedClaims(block.text, scopes, confirmed, zh, block.kind === "table");
    if (block.kind === "table" && zh && boundTableRow) {
      const [heading, , ...rows] = block.text.split("\n");
      const header = wikiTableCells(heading);
      for (const row of rows) {
        const split = splitReleaseChecklist(row.trim(), header, scopes, boundTableRow);
        if (!split) continue;
        const existing = parts.findIndex(part => part.before === split.before);
        if (existing >= 0) parts[existing] = split;
        else parts.push(split);
      }
    }
    if (!parts.length) continue;
    let revised = block.text;
    for (const edit of parts) revised = revised.replace(edit.before, () => edit.replacement ?? edit.parts.map(part => part.text).join(zh ? "" : " "));
    text = text.slice(0, block.start) + revised + text.slice(block.end);
    edits.unshift(...parts);
  }
  return { text, edits };
}
