import {reviewSavedWikiEditorial} from "./wiki-saved-editorial";
import type { FocusSection, FocusSession } from "../shared/focus-session";
import type { WikiClaim } from "../shared/wiki-claims";
import { paragraphIndex } from "../shared/wiki-body-text";
import { droppedWikiConditions, missingWikiConditions, statesCore, wikiLedgerUnits, wikiStatementWithConditions, wikiUnitConditions, type WikiKnowledgeUnit, type WikiUnitStatus } from "../shared/wiki-knowledge";
import { daysIn, figuresIn } from "../shared/wiki-figures";
import { wikiMeasure, wikiSaidWhen } from "../shared/wiki-section-status";
import { knowledgeTerms } from "../shared/knowledge-subject";
import { isSourceCodeParagraph, sourceBlockResolvedProblems, withoutSourceBlockRepeats } from "../shared/wiki-source-code";
import { claimSupported, wikiLabelledThresholdClaims } from "./wiki-claim-support";
import { resolveWikiReading } from "./wiki-knowledge-reading";
import { withAnswerScope } from "./wiki-question-parse";
import { applyWikiConfirmationScope, wikiConfirmationDetails, wikiConfirmationScopes } from "./wiki-confirmation-scope";
import { measuredSourceScope, sourceScopeConflict } from "./wiki-source-scope";
import { wikiTemporalCandidate, wikiTemporalClaim } from "./wiki-claim-temporality";
import { wikiClaimStanding, wikiOpeningStanding, wikiStandingCandidate } from "./wiki-claim-standing";
import { recheckWikiTableNegation } from "./wiki-negation-review";
import { INCOMPLETE_WIKI_PROSE, restoredConditionalNegation, wikiChapterIntegrity, wikiIncompleteProse, wikiIntegrityCandidate, wikiIntegrityNote } from "./wiki-integrity";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { wikiHolderOf } from "../shared/wiki-holder";

const UNSUPPORTED_CLAIM = /^claim "(.+)…" has no supported source after final formatting$/u;
const LOST_CONDITION = /^"(.+)…" drops a source condition/u;
const ASSERTED_ADOPTION = /已(?:经)?(?:确认执行|确认采用|决定执行|决定采用|落实)|\b(?:has been approved|was approved|confirmed for implementation)\b/iu;
const NAMED_REJECTION = /^你在回答中否定了「([^」]+)」的方案。?$/u;
const ASSERTED_PLAN = /(?:^|[；;]\s*)(?:现行|当前)(?:的)?(?:策略|方案|计划)(?:为|是|采用|[:：])\s*([^\n]+)$/u;
const ASSERTED_PLAN_EN = /(?:^|;\s*)(?:the )?current (?:strategy|plan|approach) (?:is to|is)\s+([^\n]+)$/iu;
const DRAFT_EXCERPT = /(?:来源待核对的草稿原句「|Draft excerpt requiring source review “)$/u;
const excerptPending = (text: string, zh: boolean) => zh ? `来源待核对的草稿原句「${text}」` : `Draft excerpt requiring source review “${text}”`;
const normalizeDetail = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/[*_`]/gu, "").replace(/[\s，,。.!?！？；;]+$/u, "").replace(/\s+/gu, "");
const PRICED_PLAN = /[¥￥$€£]\s*\d|\d+(?:\.\d+)?\s*(?:元|USD|CNY|EUR)/iu;
const PRICE_PROPOSAL = /建议|提议|拟定|\b(?:suggest(?:ed|ion)?|proposal|recommend(?:ed|ation)?)\b/iu;
const needsPriceAttribution = (text: string) => PRICED_PLAN.test(text) && !PRICE_PROPOSAL.test(text) && !/[\n|]/u.test(text);
const offerDetail = (text: string) => text.replace(/^采用[^：。]{2,36}(?:模式|机制)：(?=先|免费)|^(?:(?:具体|现行|当前)(?:的)?(?:方案|策略|计划)(?:为|是|[:：]))\s*/u, "");
const IDEA = /^(?:我(?:们)?的想法是|我(?:们)?的建议是|我(?:们)?在考虑)[\s\S]*(?:你(?:觉得|看|认为)|怎么样|行不行|可不可以)/u;
const REPORT_NOW = /截至(?:当前|目前|现在)[，,]/u;
const OFFER_OPENING = /(?:变现|付费|定价)方面[，,]\s*(?:初期|前期|首期)以/u;
const NAMED_ARCHITECTURE = /(?:采用|使用|基于|通过)[「“"']?([\p{L}\p{N}_-]{2,16})[」”"']?\s*架构/iu;
const ARCHITECTURE_STATEMENT = /^(?:(?:本|该)?(?:项目|产品|系统))?(?:已(?:经)?)?(?=采用|使用|基于|通过)/u;
const GROUP_ACTION = /(?:分配|匹配|分组).{0,12}(?:小组|群组|守护组)|自动分组/u;
const GROUP_TRIGGER = /(?:完成)?首次打卡后|开始使用后|开始[^，。\n]{0,10}计划后/u;
const PAYMENT_TRIGGER = /(?:第\s*\d+\s*天|前\s*\d+\s*天)[^。！？\n]{0,90}(?:付费|解锁)|(?:软)?付费墙/u;
const PAYMENT_DAY = /第\s*\d+\s*天/u;
const ACTIVITY_RANGE = /^([^，。\n]*(?:日活|DAU)(?:用户)?\s*(?:约|为)?\s*)(\d+)([（(][^）)\n]+[）)])?\s*[-–—~～至到]\s*(\d+)\s*人([（(][^）)\n]+[）)])?[，,]\s*(?:其中)?([^。！？\n]+[。！？]?)$/iu;

/** Resolve a named design against the same status table used by chapter leads. */
export function qualifyWikiArchitecture(text: string, units: WikiKnowledgeUnit[], statuses: ReadonlyMap<string, WikiUnitStatus>, openingUnitIds?: ReadonlySet<string>) {
  if (!NAMED_ARCHITECTURE.test(text)) return text;
  return text.split(/(?<=[。！？])/u).map(part => {
    const sentence = part.trimStart(), name = sentence.match(NAMED_ARCHITECTURE)?.[1].toLowerCase();
    if (!name || !ARCHITECTURE_STATEMENT.test(sentence)) return part;
    const same = units.filter(unit => {
      if (unit.about || unit.evidence.pasted) return false;
      const statement = normalizeDetail(unit.statement), architecture = NAMED_ARCHITECTURE.exec(statement);
      return architecture?.[1].toLowerCase() === name && !/(?:不(?:再)?|未|拒绝|禁止|避免)$/u.test(statement.slice(0, architecture.index));
    });
    if (same.some(unit => ["confirmed", "reported"].includes(statuses.get(unit.id) ?? ""))) return part;
    if (!same.some(unit => unit.evidence.role === "assistant" && statuses.get(unit.id) === "proposal" && (!openingUnitIds || openingUnitIds.has(unit.id)) && normalizeDetail(unit.evidence.quote).includes(name))) return part;
    return `${part.slice(0, part.length - sentence.length)}AI 建议${sentence.replace(ARCHITECTURE_STATEMENT, "")}`;
  }).join("");
}

export function qualifyWikiOverviewClaims(text: string, session: FocusSession, reading?: ReturnType<typeof resolveWikiReading>) {
  if (!session.wikiKnowledge?.draft || session.wikiKnowledge.documentType === "learning" || !NAMED_ARCHITECTURE.test(text) && !wikiConfirmationDetails(text).length) return text;
  const { ledger, units, statuses } = reading ?? resolveWikiReading(session.wikiKnowledge);
  const openings = new Set(ledger.draft?.chapters.filter(chapter => session.sections.some(section => section.id === chapter.id && !section.userEdited && !section.origin))
    .flatMap(chapter => chapter.openingUnitIds ?? []));
  const scoped = units.filter(({ evidence }) => session.sourceConversationIds.includes(evidence.conversationId)
    && (session.scope?.kind !== "goal" || session.scope.blocks?.some(block => block.conversationId === evidence.conversationId && block.messageIds.includes(evidence.messageId))));
  const qualified = qualifyWikiArchitecture(text, scoped, statuses, openings);
  const byId = new Map(scoped.map(unit => [unit.id, unit]));
  return applyWikiConfirmationScope(qualified, wikiConfirmationScopes(ledger, byId, statuses), scoped.filter(unit => statuses.get(unit.id) === "confirmed"), session.locale !== "en").text;
}

function timedProposal(text: string, unit: WikiKnowledgeUnit, zh: boolean) {
  if (!zh || !claimSupported(text, [unit])) return;
  const quote = unit.evidence.quote;
  if (GROUP_ACTION.test(text)) {
    const trigger = text.match(GROUP_TRIGGER)?.[0];
    const originals = quote.split(/[。！？\n]/u).filter(sentence => GROUP_ACTION.test(sentence)).flatMap(sentence => sentence.match(GROUP_TRIGGER)?.[0] ?? []);
    if (!trigger || !originals.length) return;
    const supported = originals.some(original => original.replace(/^完成/u, "") === trigger.replace(/^完成/u, ""));
    const alternate = originals.find(original => original.startsWith("开始"));
    // The writer gave the AI's grouping a trigger its quote does not: 「完成首次打卡后自动分配」 over a quote saying 「开始戒色
    // 计划后」. The sentence takes the quote's trigger; a reviewer's note (「自动入组的触发时点待核对……」) was left in the export.
    if (!supported && /^(?:完成)?首次/u.test(trigger) && alternate) {
      return { text: `AI 建议：${text.replace(trigger, alternate)}`, retimed: true };
    }
    return PRICE_PROPOSAL.test(text) ? undefined : { text: `AI 建议：${text}` };
  }
  const day = text.match(PAYMENT_DAY)?.[0];
  if (!PRICE_PROPOSAL.test(text) && PAYMENT_TRIGGER.test(text)
    && (PAYMENT_TRIGGER.test(quote) || day && normalizeDetail(quote).includes(normalizeDetail(day)) && /付费|解锁|[¥￥$]/u.test(quote))) {
    return { text: `AI 对${day ? "付费时机" : "付费墙"}的建议：${text}` };
  }
}

function splitActivityRatio(text: string, cited: WikiKnowledgeUnit[]) {
  const range = text.match(ACTIVITY_RANGE);
  if (!range) return;
  const [, label, low, startDate, high, endDate, detail] = range;
  const rangeSource = cited.find(unit => unit.evidence.role === "user" && !unit.evidence.pasted && wikiMeasure(unit)
    && normalizeDetail(unit.statement).replace(/[–—~～至到]/gu, "-").includes(`${low}-${high}人`));
  const basis = cited.find(unit => unit.evidence.role === "assistant" && !unit.evidence.pasted && !unit.about && /日活|DAU/iu.test(unit.statement)
    && /\d+\s*[÷/]\s*\d+\s*(?:≈|=)\s*\d+(?:\.\d+)?%/u.test(unit.evidence.quote));
  const calculation = basis?.evidence.quote.match(/(\d+)\s*[÷/]\s*(\d+)\s*(?:≈|=)\s*(\d+(?:\.\d+)?)%/u);
  if (!rangeSource || !basis || !calculation) return;
  const [, count, denominator, percentage] = calculation;
  if (Number(denominator) < Number(low) || Number(denominator) > Number(high) || !detail.includes(`${count}人`) || !detail.includes(`${percentage}%`)
    || !normalizeDetail(basis.statement).includes(`${denominator}人`) || !claimSupported(detail, [basis])) return;
  const date = startDate || endDate || (wikiSaidWhen(rangeSource, true) ? `（${wikiSaidWhen(rangeSource, true)}）` : "");
  return [
    { text: `${label}${low}–${high}人${date}。`, unit: rangeSource },
    { text: `AI 按日活${denominator}人的口径计算，${detail.replace(/[。！？]$/u, "")}（${count} ÷ ${denominator}）。`, unit: basis },
  ];
}

export const wikiUserIdea = (unit: WikiKnowledgeUnit) => unit.evidence.role === "user" && !unit.evidence.pasted && !unit.about && IDEA.test(unit.evidence.quote.trim());

export function qualifiedDiscussionIdea(text: string, unit: WikiKnowledgeUnit | undefined, statuses: ReadonlyMap<string, WikiUnitStatus>, ideas: WikiKnowledgeUnit[]) {
  if (!unit || !ideas.length || /建议|提议|待确认|^(?:你|用户)(?:此前)?(?:曾)?(?:提出|考虑|询问)|[？?]$/u.test(text.trim()) || !claimSupported(text, [unit])) return;
  if (ideas.some(idea => idea.id === unit.id)) return `你曾提议：${text}`;
  if (unit.evidence.role !== "assistant" || unit.evidence.pasted || unit.about || statuses.get(unit.id) !== "proposal") return;
  const terms = knowledgeTerms(unit.statement);
  if (ideas.some(idea => {
    const own = [...knowledgeTerms(idea.statement)];
    return own.length > 0 && own.filter(term => terms.has(term)).length / own.length >= .7;
  })) return `AI 建议：${text}`;
}

export function qualifyWikiDatedReport(text: string, reports: WikiKnowledgeUnit[]) {
  return text.replace(/截至(?:当前|目前|现在)[，,]\s*([^。！？；\n]+?)(?=[，,](?:需|应|建议)|[。！？；]|$)/gu, (whole: string, detail: string) => {
    if (!/日活|DAU|MAU|留存|付费率/u.test(detail) || /目标|提升|突破|达到|达成|实现|争取|预计|计划|超过|以上/u.test(detail) || daysIn(detail).length) return whole;
    const figures = figuresIn(detail, { percent: true, counts: true });
    if (!figures.length) return whole;
    const matches = reports.filter(unit => figures.every(figure => figuresIn(unit.statement, { percent: true, counts: true }).includes(figure)));
    const dates = [...new Set(matches.map(unit => wikiSaidWhen(unit, true)))];
    return dates.length === 1 && dates[0] ? `用户在 ${dates[0]} 的讨论中报告，${detail}` : whole;
  });
}

export function qualifyWikiOpeningOffer(text: string, cited: WikiKnowledgeUnit[], statuses: ReadonlyMap<string, WikiUnitStatus>) {
  if (!OFFER_OPENING.test(text) || !/免费体验/u.test(text)) return text;
  const offers = cited.filter(unit => unit.evidence.role === "assistant" && !unit.evidence.pasted && !unit.about && statuses.get(unit.id) === "proposal" && /免费/u.test(unit.statement));
  const durationsIn = (text: string): string[] => text.replace(/\s/gu, "").match(/\d+天/gu) ?? [];
  return text.replace(/((?:变现|付费|定价)方面[，,]\s*)((?:初期|前期|首期)以[^。；\n]+)(?=[。；\n]|$)/gu, (whole: string, topic: string, offer: string) => {
    const durations = durationsIn(offer);
    const matches = (unit: WikiKnowledgeUnit) => { const values = durationsIn(unit.statement); return durations.every(value => values.includes(value)); };
    return durations.length > 1 && offers.some(matches) && !cited.some(unit => statuses.get(unit.id) === "confirmed" && matches(unit)) ? `${topic}AI 建议${offer}` : whole;
  });
}

/** Cite the offer that actually states the prices. An answer confirming a
 * billing model may also be bound to the same sentence, but states no price. */
export function qualifiedPriceProposal(text: string, cited: WikiKnowledgeUnit[], statuses: ReadonlyMap<string, WikiUnitStatus>, zh: boolean) {
  if (!needsPriceAttribution(text)) return;
  const statement = normalizeDetail(offerDetail(text));
  const exact = cited.filter(unit => normalizeDetail(offerDetail(unit.statement)) === statement);
  if (exact.some(unit => statuses.get(unit.id) !== "proposal")) return;
  const proposals = exact.filter(unit => unit.evidence.role === "assistant" && !unit.evidence.pasted && !unit.about);
  if (proposals.length !== 1) return;
  const unit = proposals[0];
  const detail = wikiStatementWithConditions(unit, zh);
  const scoped = zh ? offerDetail(detail) : detail;
  return { unit, text: zh ? `AI 建议${scoped}` : `AI proposal: ${scoped}` };
}

/** A confirmed broad direction does not change the status of a narrower
 * proposal with a prerequisite. Recover the entire sourced statement. */
export function qualifiedConditionalProposal(text: string, unit: WikiKnowledgeUnit | undefined, status: WikiUnitStatus | undefined): string | undefined {
  if (!unit || status !== "proposal" || unit.evidence.role !== "assistant" || unit.evidence.pasted || unit.about || !wikiUnitConditions(unit).length) return;
  if (!droppedWikiConditions(unit, text).length && !(ASSERTED_ADOPTION.test(text) && statesCore(unit.statement, text))) return;
  const zh = /\p{Script=Han}/u.test(unit.statement);
  const sourced = wikiStatementWithConditions(unit, zh);
  return zh ? sourced.replace(/(^|[，,]\s*)建议(?:你)?/u, "$1AI 建议") : `AI proposal: ${sourced}`;
}

/** Retain the supported proposal when the writer presents it as an adopted plan.
 * Its source must support the remaining clause, including its values and conditions. */
export function supportedProposal(text: string, unit: WikiKnowledgeUnit | undefined, status: WikiUnitStatus | undefined): string | undefined {
  if (!unit || status !== "proposal" || unit.evidence.role !== "assistant" || unit.evidence.pasted || unit.about) return;
  const zh = /\p{Script=Han}/u.test(text);
  const detail = text.match(zh ? ASSERTED_PLAN : ASSERTED_PLAN_EN)?.[1].trim();
  if (!detail || !normalizeDetail(unit.statement).includes(normalizeDetail(detail)) || !statesCore(detail, unit.statement)
    || !claimSupported(detail, [unit]) || missingWikiConditions(unit, detail).length) return;
  return zh ? `AI 建议${detail}` : `AI proposal: ${detail}`;
}

/** Older saved chapters also surface their recorded review failures at the affected
 * sentence. This projects the stored prose without editing the document or its sources. */
export function wikiChapterReviewContext(session: FocusSession) {
  const ledger = session.wikiKnowledge;
  const units = wikiLedgerUnits(ledger);
  let reading: ReturnType<typeof resolveWikiReading> | undefined;
  return { units, byId: new Map(units.map(unit => [unit.id, unit])), reading: () => ledger && (reading ??= resolveWikiReading(ledger)) };
}

export function reviewWikiChapter(section: FocusSection, session: FocusSession, zh = session.locale !== "en", diagnostics?: { resolved: Set<string>; scopeProblems: Set<string> }, context = wikiChapterReviewContext(session)): FocusSection {
  const resolvedProblems = diagnostics?.resolved;
  if (section.userEdited || section.origin) return section;
  const ledger = session.wikiKnowledge;
  const chapter = ledger?.draft?.chapters.find(item => item.id === section.id);
  if (!ledger || !chapter) return section;
  const { units: storedUnits, byId: storedById } = context;
  const selected = new Set(section.evidenceIds), conversations = new Set(session.sourceConversationIds);
  const evidence = session.evidence.filter(ref => selected.has(ref.id) && conversations.has(ref.conversationId));
  const messageKey = (conversation: string, message: string) => `${conversation}\0${message}`;
  const evidenceByMessage = new Map<string, typeof evidence>();
  for (const ref of evidence) {
    const key = messageKey(ref.conversationId, ref.messageId);
    const refs = evidenceByMessage.get(key);
    if (refs) refs.push(ref);
    else evidenceByMessage.set(key, [ref]);
  }
  const sourceOf = (unit: WikiKnowledgeUnit) => evidenceByMessage.get(messageKey(unit.evidence.conversationId, unit.evidence.messageId))?.find(ref => {
    const version = session.sourceSignatures?.[ref.conversationId]?.[ref.messageId];
    return ref.excerpt.trim() === unit.evidence.quote.trim() && (!version || !ref.sourceSignature || version === ref.sourceSignature)
      && (session.scope?.kind !== "goal" || session.scope.blocks?.some(block => block.conversationId === ref.conversationId && block.messageIds.includes(ref.messageId)));
  });
  const excludedKeys = new Set([...session.wikiScopeReview?.excludeKeys ?? [], ...session.wikiScopeReview?.ignoredKeys ?? []]);
  const excluded = session.wikiScopeReview?.materials.filter(item => (item.keys ?? [item.key]).every(key => excludedKeys.has(key))) ?? [];
  const scopeSource = (unit: WikiKnowledgeUnit) => {
    const ref = sourceOf(unit), versions = session.sourceSignatures?.[unit.evidence.conversationId];
    const role = session.sourceRoles?.[unit.evidence.conversationId]?.[unit.evidence.messageId];
    if (!ref || role && role !== unit.evidence.role || versions && !versions[unit.evidence.messageId] || excluded.some(item => item.evidenceIds.includes(ref.id) || item.evidenceIds.includes(unit.evidence.evidenceId)
      || item.quote.trim().length >= 12 && unit.evidence.quote.includes(item.quote.trim()))) return;
    return ref;
  };
  const finish=(reviewed:FocusSection)=>ledger.documentType!=="learning"?reviewSavedWikiEditorial(reviewed,context.reading()!.ledger,scopeSource):reviewed;
  if (ledger.documentType !== "learning" && wikiStandingCandidate(section.body)) {
    const reading = context.reading()!;
    const available = new Map<string, NonNullable<ReturnType<typeof sourceOf>>>();
    const scoped = reading.units.filter(unit => {
      const ref = scopeSource(unit);
      if (!ref) return false;
      available.set(unit.id, ref);
      return true;
    });
    const byId = new Map(scoped.map(unit => [unit.id, unit]));
    let body = section.body;
    const opening = body.startsWith("### ") ? "" : body.split(/\n### /u)[0];
    const lead = wikiOpeningStanding(opening, scoped, reading.statuses, zh);
    if (lead !== opening) body = lead + body.slice(opening.length);
    const prose = wikiDocumentBlocks(body).filter(block => block.kind === "paragraph" || block.kind === "list");
    const claims = section.claims?.flatMap(claim => {
      if (!claim.unitIds?.length || !wikiStandingCandidate(claim.text) || claim.userDecided
        || !prose.some(block => block.text.includes(claim.text)) || !body.includes(claim.text)) return [claim];
      const cited = claim.unitIds.flatMap(id => byId.get(id) ?? []);
      if (cited.length !== claim.unitIds.length) return [claim];
      const revised = wikiClaimStanding(claim.text, cited, reading.statuses, zh);
      if (!revised) return [claim];
      const at = body.indexOf(claim.text);
      if (at !== body.lastIndexOf(claim.text)) return [claim];
      const after = at + claim.text.length;
      const terminal = /[。.!?]/u.test(body[after] ?? "") && !/[。.!?]$/u.test(claim.text);
      const separator = prose.find(block => block.text.includes(claim.text))?.kind === "list" ? " " : "\n\n";
      const replacements = revised.map((piece, index): WikiClaim => {
        const text = terminal && index === revised.length - 1 ? piece.text.replace(/[。.!?]$/u, "") : piece.text;
        return { ...claim, text, formulations: undefined, holder: "ai", workStatus: "proposed", userDecided: undefined,
          unitIds: piece.units.map(unit => unit.id), evidenceIds: [...new Set(piece.units.map(unit => available.get(unit.id)!.id))],
          quote: piece.units[0].evidence.quote };
      });
      const rest = after + Number(terminal);
      const trailing = revised.length > 1 && !/\s/u.test(body[rest] ?? " ") ? separator : "";
      body = body.slice(0, at) + replacements.map(piece => piece.text).join(separator)
        + body.slice(after, rest) + trailing + body.slice(rest);
      return replacements;
    });
    if (body !== section.body) section = { ...section, body, claims };
  }
  if (chapter.problems.some(problem => problem.includes("drops the negation of"))) {
    const bound = chapter.paragraphs.flatMap(paragraph => paragraph.claims ?? []);
    const available = new Map([...new Set(bound.flatMap(claim => claim.unitIds))].flatMap(id => {
      const unit = storedById.get(id);
      return unit && sourceOf(unit) ? [[id, unit] as const] : [];
    }));
    for (const problem of chapter.problems) {
      if (!problem.includes("drops the negation of")) continue;
      const restored = resolvedProblems && bound.some(original => section.claims?.some(claim => {
        if (claim.text === original.text || !section.body.includes(claim.text)) return false;
        if (original.unitIds.length !== claim.unitIds?.length || !original.unitIds.every(id => claim.unitIds?.includes(id))) return false;
        const sources = original.unitIds.flatMap(id => available.get(id) ?? []);
        return sources.length === original.unitIds.length && restoredConditionalNegation(problem, original.text, claim.text, sources);
      }));
      if (restored || recheckWikiTableNegation(problem, section.body, bound, available)) resolvedProblems?.add(problem);
    }
  }
  if (wikiTemporalCandidate.test(section.body) || /^### 早先版本$/mu.test(section.body)) {
    let body = section.body;
    let repairedEarlierHeading = false;
    const prose = wikiDocumentBlocks(body).filter(block => block.kind === "paragraph" || block.kind === "list");
    const claims = section.claims?.map(claim => {
      const dualRisk=/低风险.{0,30}直接(?:执行|应用).{0,80}(?:多步|复杂|结构性).{0,80}(?:预览|Preview)/iu.test(claim.text);
      if (!claim.unitIds?.length || !dualRisk&&!wikiTemporalCandidate.test(claim.text)
        || !prose.some(block => block.text.includes(claim.text))) return claim;
      const cited = claim.unitIds.flatMap(id => storedById.get(id) ?? []);
      if (cited.length !== claim.unitIds.length || !cited.every(unit => sourceOf(unit))) return claim;
      const relations=context.reading()?.organization?.relations ?? [];
      const unsupportedHistory=dualRisk&&claim.holder==="earlier"&&cited.every(unit=>unit.evidence.role==="assistant"&&!unit.evidence.pasted&&!unit.about)
        &&!relations.some(relation=>relation.status==="resolved"&&["replaces","rejects"].includes(relation.kind)&&cited.some(unit=>unit.id===relation.older)
          &&(relation.evidence||ledger.decisions?.[relation.newer]?.verdict==="confirmed"));
      const rewrite = unsupportedHistory ? {text:claim.text.replace(/^此前(?:曾)?(?:建议)?\s*/u,"讨论中提出，"),restoredProposal:true}
        : wikiTemporalClaim(claim.text, cited, relations, zh);
      if (!rewrite || rewrite.text === claim.text) return claim;
      const text = /[。.!?]$/u.test(rewrite.text) && !/[。.!?]$/u.test(claim.text) && /[。.!?]/u.test(body[body.indexOf(claim.text) + claim.text.length] ?? "")
        ? rewrite.text.slice(0, -1) : rewrite.text;
      if (rewrite.restoredProposal) {
        const heading = body.slice(0, body.indexOf(claim.text)).match(/^#{1,6} .+$/gmu)?.at(-1);
        repairedEarlierHeading ||= /^#{1,6} (?:早先版本|Earlier versions)$/u.test(heading ?? "");
      }
      body = body.replace(claim.text, () => text);
      if (rewrite.restoredProposal && claim.holder === "earlier") return { ...claim, text, formulations: undefined, holder: "ai" as const, holderMark: false, workStatus: "proposed" as const };
      return { ...claim, text, formulations: undefined };
    });
    if (repairedEarlierHeading) body = body.replace(/^(#{1,6}) (?:早先版本|Earlier versions)$/mu, `$1 ${zh ? "早期讨论" : "Earlier discussion"}`);
    if (body !== section.body) section = { ...section, body, claims };
  }
  // Old saved sections can have formatting that differs from the original
  // writer's paragraphs. Review the actual blocks and their stored bindings.
  if (wikiIntegrityCandidate(section.body)) {
    const saved = section.claims ?? [];
    const blocks = wikiDocumentBlocks(section.body).filter(block => block.kind === "paragraph" || block.kind === "table");
    const bound = blocks.flatMap(block => {
      if (!wikiIntegrityCandidate(block.text)) return [];
      const claims = saved.flatMap(claim => [claim.text, ...claim.formulations ?? []].slice(0, 4).flatMap(text =>
        text && block.text.includes(text) && claim.unitIds?.length ? [{ text, unitIds: claim.unitIds }] : []));
      return claims.length ? [{ text: block.text, subtopic: "", unitIds: [...new Set(claims.flatMap(claim => claim.unitIds))], claims }] : [];
    });
    const trusted = new Map<string, WikiKnowledgeUnit | undefined>();
    const unitOf = (id: string) => {
      if (!trusted.has(id)) {
        const unit = storedById.get(id);
        trusted.set(id, unit && sourceOf(unit) ? unit : undefined);
      }
      return trusted.get(id);
    };
    const fixed = wikiChapterIntegrity({ ...chapter, body: section.body, paragraphs: bound }, unitOf, zh);
    if (fixed.repaired) {
      for (const problem of chapter.problems) {
        const restored=bound.some((paragraph,index)=>paragraph.claims.some((claim,position)=>{
          const next=fixed.paragraphs[index]?.claims?.[position]?.text;
          if(!next||next===claim.text)return false;
          const sources=claim.unitIds.flatMap(id=>unitOf(id)??[]);
          return sources.length===claim.unitIds.length&&restoredConditionalNegation(problem,claim.text,next,sources);
        }));
        if(restored)resolvedProblems?.add(problem);
      }
      const updated = saved.flatMap(claim => {
        if (fixed.body.includes(claim.text)) return [claim];
        const before = bound.findIndex(paragraph => paragraph.claims.some(point => point.text === claim.text));
        if (before < 0) return [claim];
        const at = bound[before].claims.findIndex(point => point.text === claim.text);
        const next = fixed.paragraphs[before]?.claims?.[at]?.text;
        return next && fixed.body.includes(next) ? [{ ...claim, text: next, formulations: undefined }] : [claim];
      });
      section = { ...section, body: fixed.body, claims: updated };
    }
    const faults = wikiIncompleteProse(section.body).filter(fault => !evidence.some(ref => ref.excerpt.includes(fault.text.trim())));
    if (faults.length) {
      let body = section.body;
      for (const fault of faults.reverse()) {
        diagnostics?.scopeProblems.add(fault.problem);
        body = body.slice(0, fault.start) + [fault.preserved, `> ${wikiIntegrityNote(zh)}`].filter(Boolean).join("\n\n") + body.slice(fault.end);
      }
      section = { ...section, body, claims: section.claims?.filter(claim => body.includes(claim.text) || !section.body.includes(claim.text)) };
    } else {
      for (const problem of chapter.problems) if (problem.endsWith(INCOMPLETE_WIKI_PROSE)) resolvedProblems?.add(problem);
    }
  }
  if (chapter.paragraphs.some(paragraph => isSourceCodeParagraph(paragraph.text))) {
    const known = new Map(storedUnits.filter(unit => unit.evidence.code && sourceOf(unit)).map(unit => [unit.id, unit]));
    const projected = withoutSourceBlockRepeats({ ...chapter, body: section.body }, id => known.get(id));
    if (projected.removed.length) {
      for (const problem of sourceBlockResolvedProblems(chapter.problems, projected.removed, projected.paragraphs)) resolvedProblems?.add(problem);
      section = { ...section, body: projected.body, claims: section.claims?.filter(claim => projected.body.includes(claim.text)
        || !projected.removed.some(paragraph => paragraph.text.includes(claim.text))) };
    }
  }
  const checks = chapter.problems.flatMap(problem => {
    const prefix = (problem.match(UNSUPPORTED_CLAIM) ?? problem.match(LOST_CONDITION))?.[1];
    return prefix ? [{ problem, prefix }] : [];
  });
  const scopedDecisions = withAnswerScope(ledger).decisions;
  const priced = chapter.paragraphs.flatMap(paragraph => /^\s*(?:```|~~~|[>|])/u.test(paragraph.text) ? []
    : (paragraph.claims ?? []).filter(claim => needsPriceAttribution(claim.text) && section.body.includes(claim.text)));
  const saved = (section.claims ?? []).flatMap(claim => {
    if (claim.unitIds?.length !== 1 || !section.body.includes(claim.text)) return [];
    const id = claim.unitIds[0];
    const rejected = NAMED_REJECTION.test(claim.text);
    const scoped = ledger.decisions?.[id]?.verdict === "confirmed" && !scopedDecisions?.[id] && !/AI\s*建议|\bAI proposal\b/iu.test(claim.text);
    return rejected || scoped ? [{ text: claim.text, unitIds: [id], rejected, scoped }] : [];
  });
  const time = zh && REPORT_NOW.test(section.body), offer = zh && OFFER_OPENING.test(section.body);
  const ideas = new Map((zh ? storedUnits.filter(wikiUserIdea) : []).map(unit => [unit.id, unit]));
  const adoptionIds = new Set(storedUnits.filter(unit => unit.adoption.status === "user_adopted" || unit.adoption.status === "user_decision").map(unit => unit.id));
  const staleDecision = (claim: NonNullable<FocusSection["claims"]>[number]) => claim.holder === "decided" && Boolean(claim.unitIds?.length && claim.unitIds.every(id => adoptionIds.has(id)));
  const ideaTopics = new Set(chapter.paragraphs.filter(paragraph => paragraph.unitIds.some(id => ideas.has(id))).map(paragraph => paragraph.subtopic));
  const recordedDecisions = section.claims?.some(staleDecision);
  const architecture = zh && NAMED_ARCHITECTURE.test(section.body);
  const workflow = zh ? chapter.paragraphs.filter(paragraph => !/^\s*(?:```|~~~|>|\|)/u.test(paragraph.text)).flatMap(paragraph => paragraph.claims ?? [])
    .filter(claim => !/[\n|]/u.test(claim.text) && section.body.includes(claim.text)
      && (NAMED_ARCHITECTURE.test(claim.text) || ACTIVITY_RANGE.test(claim.text) || PAYMENT_TRIGGER.test(claim.text) || GROUP_ACTION.test(claim.text) && GROUP_TRIGGER.test(claim.text))) : [];
  const mightExtendConfirmation = (ledger.userAnswers?.length || ledger.organization?.relations.some(relation => relation.status === "resolved" && (relation.kind === "supplements" || relation.kind === "narrows")))
    && wikiConfirmationDetails(section.body).length;
  const reviewable = chapter.paragraphs.flatMap(paragraph => {
    if (/^\s*(?:```|~~~|>)/u.test(paragraph.text)) return [];
    return (paragraph.claims ?? []).filter(claim => !/[\n|]/u.test(claim.text) && section.body.includes(claim.text));
  });
  const scopeChanges = new Set(reviewable.filter(claim => sourceScopeConflict(claim.text, claim.unitIds.flatMap(id => storedById.get(id) ?? []))).map(claim => claim.text));
  if (!checks.length && !scopeChanges.size && !saved.length && !priced.length && !time && !offer && !ideaTopics.size && !recordedDecisions && !architecture && !workflow.length && !mightExtendConfirmation) return finish(section);
  const failed = reviewable.filter(claim => scopeChanges.has(claim.text) || checks.some(({ prefix }) => claim.text.startsWith(prefix)));
  const reading = context.reading()!;
  const units = new Map(reading?.units.map(unit => [unit.id, unit]));
  let body = section.body;
  let claims = section.claims;
  if (recordedDecisions) claims = claims?.map(claim => {
    if (!staleDecision(claim)) return claim;
    const statuses = claim.unitIds!.map(id => reading.statuses.get(id));
    if (statuses.every(status => status === "proposal" || status === "stated")) return { ...claim, holder: statuses.includes("stated") ? "user" : "ai", userDecided: undefined, workStatus: "proposed", sourceReading: undefined };
    return claim;
  });
  const reports = time ? reading.units.filter(unit => !unit.about && unit.evidence.role === "user" && !unit.evidence.pasted && session.sourceConversationIds.includes(unit.evidence.conversationId) && wikiMeasure(unit)) : [];
  const opening = body.startsWith("### ") ? "" : body.split(/\n### /u)[0];
  if (opening && !/^\s*(?:```|~~~|>|\|)/u.test(opening)) {
    let text = time ? qualifyWikiDatedReport(opening, reports) : opening;
    if (offer) text = qualifyWikiOpeningOffer(text, chapter.paragraphs.flatMap(paragraph => paragraph.unitIds.flatMap(id => units.get(id) ?? [])), reading.statuses);
    if (architecture) text = qualifyWikiArchitecture(text, reading.units.filter(unit => sourceOf(unit)), reading.statuses, new Set(chapter.openingUnitIds));
    body = text + body.slice(opening.length);
  }
  for (const claim of workflow) {
    const at = paragraphIndex(body, claim.text);
    if (at < 0) continue;
    const prefix = body.slice(Math.max(0, at - 18), at).match(/(?:AI\s*建议|AI 对付费(?:时机|墙)的建议|你曾提议|建议)[：:]\s*$/u)?.[0] ?? "";
    const cited = claim.unitIds.flatMap(id => units.get(id) ?? []).filter(unit => sourceOf(unit));
    const ratio = splitActivityRatio(claim.text, cited);
    const unit = cited.length === 1 ? cited[0] : undefined;
    let proposal: ReturnType<typeof timedProposal>;
    if (unit?.evidence.role === "assistant" && !unit.evidence.pasted && !unit.about && reading.statuses.get(unit.id) === "proposal") {
      const architecture = qualifyWikiArchitecture(claim.text, [unit], reading.statuses);
      proposal = architecture === claim.text ? timedProposal(claim.text, unit, zh) : { text: architecture };
    }
    if (prefix && !proposal?.retimed) continue;
    const replacements = ratio ?? (unit && proposal ? [{ unit, text: proposal.text }] : []);
    if (!replacements.length) continue;
    body = body.slice(0, at - prefix.length) + replacements.map(replacement => replacement.text).join("") + body.slice(at + claim.text.length);
    claims = claims?.filter(point => point.text !== claim.text && point.text !== prefix + claim.text && !point.formulations?.includes(claim.text));
    claims = [...claims ?? [], ...replacements.map(({ text, unit }): WikiClaim => ({
      text, quote: unit.evidence.quote, unitIds: [unit.id], evidenceIds: [sourceOf(unit)!.id],
      holder: unit.evidence.role === "user" ? "user" : "ai", workStatus: unit.evidence.role === "user" ? "reported" : "proposed",
      ...(unit.evidence.role === "user" ? { holderMark: true } : {}),
    }))];
  }
  for (const topic of ideaTopics) {
    const paragraphs = chapter.paragraphs.filter(paragraph => paragraph.subtopic === topic && !/^\s*(?:```|~~~|>|\|)/u.test(paragraph.text));
    const alternatives = [...new Set(paragraphs.flatMap(paragraph => paragraph.unitIds))].flatMap(id => ideas.get(id) ?? [])
      .filter(unit => ["stated", "open"].includes(reading.statuses.get(unit.id) ?? "") && sourceOf(unit));
    for (const claim of paragraphs.flatMap(paragraph => paragraph.claims ?? [])) {
      const at = paragraphIndex(body, claim.text);
      if (at < 0 || /(?:你曾提议|AI\s*建议)[：:]\s*$/u.test(body.slice(Math.max(0, at - 14), at))) continue;
      const unit = claim.unitIds.length === 1 ? units.get(claim.unitIds[0]) : undefined;
      const text = qualifiedDiscussionIdea(claim.text, unit, reading.statuses, alternatives);
      if (!text) continue;
      body = body.slice(0, at) + text + body.slice(at + claim.text.length);
      claims = claims?.map(point => point.text === claim.text ? { ...point, text, ...(point.sourceReading ? { sourceReading: undefined } : {}) } : point);
    }
  }
  const repairedClaims = new Set<string>();
  const repairedMetrics = new Map<string, WikiClaim[]>();
  const unboundValues = new Set<string>();
  for (const paragraph of chapter.paragraphs) {
    if (!paragraph.claims?.length || /^\s*(?:```|~~~|>)/u.test(paragraph.text)) continue;
    const labelled = wikiLabelledThresholdClaims(paragraph.text, paragraph.claims);
    for (const [index, claim] of paragraph.claims.entries()) {
      if (!checks.some(check => UNSUPPORTED_CLAIM.test(check.problem) && claim.text.startsWith(check.prefix))) continue;
      const item = labelled[index];
      if (item === claim) {
        unboundValues.add(claim.text);
        continue;
      }
      const cited = item.unitIds.flatMap(id => units.get(id) ?? []);
      const refs = cited.flatMap(unit => scopeSource(unit) ?? []);
      const statuses = cited.flatMap(unit => reading.statuses.get(unit.id) ?? []);
      const holder = wikiHolderOf(statuses);
      if (!body.includes(item.text) || !refs.length || refs.length !== item.unitIds.length || statuses.length !== cited.length || !holder
        || cited.some(unit => droppedWikiConditions(unit, paragraph.text).length) || !claimSupported(item.text, cited)) {
        unboundValues.add(claim.text);
        continue;
      }
      const replacement: WikiClaim = { text: item.text, unitIds: item.unitIds, evidenceIds: [...new Set(refs.map(ref => ref.id))], quote: cited[0].evidence.quote,
        holder, holderMark: holder !== "ai", userDecided: holder === "decided" || undefined,
        workStatus: holder === "ai" ? "proposed" : statuses.some(status => status === "reported" || status === "relayed") ? "reported" : undefined,
        verification: "supported" };
      repairedMetrics.set(claim.text, [...repairedMetrics.get(claim.text) ?? [], replacement]);
    }
  }
  for (const [value, rows] of repairedMetrics) {
    if (unboundValues.has(value)) continue;
    repairedClaims.add(value);
    claims = [...claims?.filter(claim => claim.text !== value && !rows.some(row => row.text === claim.text)) ?? [], ...rows];
  }
  for (const claim of failed.filter(claim => scopeChanges.has(claim.text))) {
    const at = paragraphIndex(body, claim.text);
    if (at < 0 || DRAFT_EXCERPT.test(body.slice(Math.max(0, at - 80), at))) continue;
    const cited = [...new Set(claim.unitIds)].flatMap(id => units.get(id) ?? []);
    const pending: string[] = [], corrected: WikiClaim[] = [];
    const pieces = claim.text.split(/[；;]\s*/u).map(piece => piece.trim()).filter(Boolean);
    const replacement = pieces.map(piece => {
      const matches = cited.flatMap(unit => {
        if (unit.evidence.role !== "assistant" || unit.evidence.pasted || unit.about || !["proposal", "analysis"].includes(reading.statuses.get(unit.id) ?? "")) return [];
        const source = scopeSource(unit), scope = measuredSourceScope(piece, unit.evidence.quote);
        return source && scope?.conflict && scope.excerpt && scope.excerpt.length <= 300 ? [{ unit, source, excerpt: scope.excerpt }] : [];
      });
      if (matches.length !== 1) {
        pending.push(piece);
        return excerptPending(piece, zh);
      }
      const { unit, source, excerpt } = matches[0];
      const text = zh ? `AI 建议（原文）：「${excerpt}」。` : `AI proposal (source wording): “${excerpt}”.`;
      corrected.push({ text, quote: unit.evidence.quote, evidenceIds: [source.id], unitIds: [unit.id], holder: "ai", holderMark: true, workStatus: "proposed", verification: "supported" });
      return text;
    });
    body = body.slice(0, at) + replacement.join(" ") + body.slice(at + claim.text.length);
    claims = [...claims?.filter(point => ![point.text, ...point.formulations ?? []].some(text => text.trim() && (claim.text.includes(text.trim()) || text.includes(claim.text)))) ?? [], ...corrected];
    repairedClaims.add(claim.text);
    for (const piece of pending) diagnostics?.scopeProblems.add(`claim "${piece.slice(0, 36)}…" has no supported source after final formatting`);
  }
  const pricedProjections = priced.flatMap(claim => {
    const proposal = qualifiedPriceProposal(claim.text, claim.unitIds.flatMap(id => units.get(id) ?? []), reading.statuses, zh);
    return proposal ? [{ text: claim.text, unitIds: [proposal.unit.id], rejected: false, scoped: false, priceText: proposal.text }] : [];
  });
  for (const claim of [...pricedProjections, ...failed.filter(claim => !scopeChanges.has(claim.text)).map(claim => ({ ...claim, rejected: false, scoped: false, priceText: undefined })), ...saved.map(claim => ({...claim, priceText: undefined}))]) {
    if (repairedClaims.has(claim.text)) continue;
    const at = paragraphIndex(body, claim.text);
    const prefix = body.slice(Math.max(0, at - 80), at);
    if (at < 0 || DRAFT_EXCERPT.test(prefix) || claim.priceText && /(?<![不未])(?:AI\s*)?建议\s*[:：]?\s*$|\bAI proposal:\s*$/iu.test(prefix)) continue;
    const recorded = checks.filter(check => claim.text.startsWith(check.prefix));
    if (recorded.length && recorded.every(check => UNSUPPORTED_CLAIM.test(check.problem))) {
      const cited = claim.unitIds.flatMap(id => units.get(id) ?? []);
      if (cited.length && cited.length === claim.unitIds.length && cited.every(unit => scopeSource(unit) && !droppedWikiConditions(unit, claim.text).length)
        && !ASSERTED_ADOPTION.test(claim.text) && claimSupported(claim.text, cited)) {
        repairedClaims.add(claim.text);
        continue;
      }
    }
    if (recorded.length && recorded.every(check => LOST_CONDITION.test(check.problem))) {
      const cited = claim.unitIds.flatMap(id => units.get(id) ?? []);
      if (cited.length === claim.unitIds.length && cited.length && cited.every(unit => sourceOf(unit) && !droppedWikiConditions(unit, claim.text).length)
        && !ASSERTED_ADOPTION.test(claim.text) && claimSupported(claim.text, cited)) {
        repairedClaims.add(claim.text);
        continue;
      }
    }
    const unit = claim.unitIds.length === 1 ? units.get(claim.unitIds[0]) : undefined;
    const source = unit && sourceOf(unit);
    const status = unit ? reading.statuses.get(unit.id) : undefined;
    const rejected = claim.rejected ? claim.text.match(NAMED_REJECTION)?.[1] : undefined;
    if (claim.rejected && (!unit || status !== "proposal" || !rejected || normalizeDetail(rejected) !== normalizeDetail(unit.statement))) continue;
    if (claim.scoped && !claim.rejected && (!unit || status !== "proposal" || normalizeDetail(claim.text) !== normalizeDetail(unit.statement))) continue;
    const repaired = source && unit ? (claim.priceText ?? (claim.rejected || claim.scoped ? `AI 建议${wikiStatementWithConditions(unit, zh)}`
      : qualifiedConditionalProposal(claim.text, unit, status) ?? supportedProposal(claim.text, unit, status))) : undefined;
    const replacement = repaired ?? excerptPending(claim.text, zh);
    body = body.slice(0, at) + replacement + body.slice(at + claim.text.length);
    claims = claims?.filter(point => ![point.text, ...point.formulations ?? []].some(text => text.trim() && (claim.text.includes(text.trim()) || text.includes(claim.text))));
    if (repaired && source && unit) {
      repairedClaims.add(claim.text);
      claims = [...claims ?? [], { text: repaired, quote: unit.evidence.quote, unitIds: [unit.id], evidenceIds: [source.id], holder: "ai", workStatus: "proposed" }];
    }
  }
  if (resolvedProblems) for (const { problem, prefix } of checks) {
    const matching = chapter.paragraphs.flatMap(paragraph => paragraph.claims ?? []).filter(claim => claim.text.startsWith(prefix));
    if (matching.length && matching.every(claim => repairedClaims.has(claim.text))) resolvedProblems.add(problem);
  }
  const scopes = wikiConfirmationScopes(reading.ledger, units, reading.statuses).filter(scope => sourceOf(scope.proposal));
  const confirmed = reading.units.filter(unit => reading.statuses.get(unit.id) === "confirmed" && sourceOf(unit));
  const originals = new Set(storedUnits.flatMap(unit => unit.evidence.code?.language === "table" ? [unit.evidence.code.text.trim()] : []));
  const scoped = applyWikiConfirmationScope(body, scopes, confirmed, zh, originals);
  if (scoped.edits.length) {
    body = scoped.text;
    for (const edit of scoped.edits) {
      const touched = (text: string) => text.trim() && (edit.before.includes(text.trim()) || text.includes(edit.before));
      claims = claims?.filter(claim => ![claim.text, ...claim.formulations ?? []].some(touched));
      for (const { text, unit } of edit.parts) {
        const source = unit && sourceOf(unit);
        if (!unit || !source) continue;
        const decided = reading.statuses.get(unit.id) === "confirmed";
        claims = [...claims ?? [], { text, quote: unit.evidence.quote, evidenceIds: [source.id], unitIds: [unit.id], holder: decided ? "decided" : "ai",
          ...(decided ? { holderMark: true, userDecided: true } : { workStatus: "proposed" }) }];
      }
    }
  }
  if (claims && claims !== section.claims && (scopeChanges.size || scoped.edits.length)) {
    claims.sort((first, second) => {
      const at = (claim: WikiClaim) => {
        const position = body.indexOf(claim.text);
        return position < 0 ? body.length : position;
      };
      return at(first) - at(second);
    });
  }
  const reviewed=body === section.body && (!claims || claims.every((claim, index) => claim === section.claims?.[index])) ? section : { ...section, body, claims };
  return finish(reviewed);
}
