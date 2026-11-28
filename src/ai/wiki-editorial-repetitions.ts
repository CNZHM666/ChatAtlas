import type { WikiDraftChapter, WikiKnowledgeLedger, WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { knowledgeTerms } from "../shared/knowledge-subject";
import { removeParagraph, replaceParagraph } from "../shared/wiki-body-text";
import { withoutEmptyHeadings } from "../shared/wiki-empty-items";
import { wikiProjectPersonalAside } from "./wiki-knowledge-select";
import { separatedRoadmap } from "./wiki-evidence-state";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { wikiSupplementRanges } from "../shared/wiki-source-supplements";
import { wikiHistoricalHeading } from "../shared/wiki-history-layout";
import { restoreWikiWritingStatus, unsupportedWikiNumbers } from "./wiki-number-diagnostics";
import { claimSupported } from "./wiki-claim-support";
import { wikiDecisionRestatement } from "./wiki-confirmation-scope";

const sentences = (text: string) => text.match(/[^\n]+?(?:[。！？]|[.!?](?=\s|$)|$)/gu)?.map(sentence => sentence.trim()) ?? [];
const normalized = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\s\x60*_。！？!?.，,：:]+/gu, "");
const negation = /禁止|不得|不(?:允许|支持|保存|存入|持久化)|\b(?:no|never|must not|do not)\b/iu;
const condition = /仅当|除非|如果|前提|只有|\b(?:only if|unless|provided that|when)\b/iu;

function coveredClause(text: string, shown: string, answer: WikiKnowledgeUnit, question: string) {
  if (wikiDecisionRestatement(text, shown)) return true;
  // The choice often omits the object already named by the question.
  if (/API\s*Key/iu.test(question) && /sessionStorage|运行时内存/u.test(shown)) {
    const policy = (value: string) => normalized(value).replace(/^(?:在存储机制上)?(?:apikey)?/u, "")
      .replace(/内存中/u, "内存").replace(/(?:页面)?刷新后/u, "刷新")
      .replace(/(?:用户)?可选择/u, "可选").replace(/此时/u, "");
    if (policy(text) === policy(shown)) return true;
  }
  if (condition.test(text) || negation.test(text) !== negation.test(shown)) return false;
  if (Object.values(unsupportedWikiNumbers(text, shown, new Set())).some(values => values.length)) return false;
  const words = [...knowledgeTerms(text)], known = knowledgeTerms(shown);
  const literals = text.match(/[A-Za-z][\w-]{2,}/gu) ?? [];
  return words.length >= 5 && words.filter(word => known.has(word)).length / words.length >= .72
    && literals.every(value => shown.toLowerCase().includes(value.toLowerCase()))
    && claimSupported(text, [{ ...answer, statement: shown, details: [], evidence: { ...answer.evidence, quote: shown } }]);
}

/** A confirmed answer can replace repeated prose from its own inputs inside
 * the same subtopic. Independent clauses and their bindings stay in place. */
export function trimWikiEditorialRepeats(chapters: WikiDraftChapter[], ledger: WikiKnowledgeLedger, units: ReadonlyMap<string, WikiKnowledgeUnit>, checked: readonly string[] = []) {
  if (ledger.documentType === "learning") return;
  for (const chapter of chapters) {
    const previous = chapter.paragraphs;
    chapter.paragraphs = previous.filter(paragraph => {
      if (!paragraph.unitIds.length) return true;
      return !paragraph.unitIds.every(id => { const unit = units.get(id); return unit && wikiProjectPersonalAside(unit); });
    });
    if (chapter.paragraphs.length !== previous.length) {
      for (const paragraph of previous) if (!chapter.paragraphs.includes(paragraph) && !chapter.paragraphs.some(other => other.text === paragraph.text))
        chapter.body = removeParagraph(chapter.body, paragraph.text);
      chapter.body = withoutEmptyHeadings(chapter.body);
    }
    const attachments = wikiSupplementRanges(chapter.body);
    const originals = new Set(chapter.paragraphs.flatMap(paragraph => paragraph.unitIds.flatMap(id => {
      const block = units.get(id)?.evidence.code;
      return block?.language === "table" ? [block.text.trim()] : [];
    })));
    for (const paragraph of chapter.paragraphs) {
      const at = chapter.body.indexOf(paragraph.text);
      if (at < 0 || attachments.some(([start, end]) => at >= start && at < end)) continue;
      if (!paragraph.text.trimStart().startsWith("|")) {
        const before = paragraph.text;
        paragraph.claims = paragraph.claims?.map(claim => {
          const text = restoreWikiWritingStatus(claim.text, claim.unitIds.flatMap(id => units.get(id) ?? []));
          if (text !== claim.text) paragraph.text = paragraph.text.replace(claim.text, () => text);
          return text === claim.text ? claim : { ...claim, text };
        });
        if (before !== paragraph.text) chapter.body = replaceParagraph(chapter.body, before, paragraph.text);
        continue;
      }
      if (originals.has(paragraph.text.trim())) continue;
      const repaired = separatedRoadmap(paragraph.text, paragraph.claims, paragraph.unitIds.flatMap(id => units.get(id) ?? []));
      if (repaired.text === paragraph.text) continue;
      chapter.body = replaceParagraph(chapter.body, paragraph.text, repaired.text);
      Object.assign(paragraph, repaired);
    }
    const prose = wikiDocumentBlocks(chapter.body).filter(block => block.kind === "paragraph"
      && !attachments.some(([start, end]) => block.start >= start && block.end <= end)
      && !checked.some(text => text && block.text.includes(text)));
    const heading = chapter.body.search(/^#{1,6}\s/mu);
    const opening = prose.find(block => heading < 0 || block.start < heading);
    if (opening && !chapter.paragraphs.some(paragraph => paragraph.text === opening.text)) {
      const held = new Set(prose.filter(block => block !== opening).flatMap(block => sentences(block.text).map(normalized)));
      const parts = sentences(opening.text);
      const keep = parts.filter((part, index) => !index || normalized(part).length < 20 || !held.has(normalized(part)));
      if (keep.length < parts.length) chapter.body = replaceParagraph(chapter.body, opening.text, keep.join(/\p{Script=Han}/u.test(opening.text) ? "" : " "));
    }
    for (const receipt of ledger.userAnswers ?? []) {
      const receiptId = `answer:${receipt.questionId}:${receipt.optionId}`;
      const answer = [receiptId, ...receipt.unitIds].flatMap(id => {
        const unit = units.get(id), decision = ledger.decisions?.[id];
        return unit && !unit.about && decision?.verdict === "confirmed" && decision.at === receipt.at ? [unit] : [];
      })[0];
      if (!answer) continue;
      const answerId = answer.id, related = new Set(receipt.unitIds);
      let answerParagraph = chapter.paragraphs.find(paragraph => paragraph.unitIds.includes(answerId)
        && paragraph.claims?.some(claim => claim.unitIds.includes(answerId) && wikiDecisionRestatement(claim.text, answer.statement))
        && chapter.body.includes(paragraph.text) && !wikiHistoricalHeading(paragraph.subtopic));
      const answers = answer.statement.split(/[；;。！？\n]|[，,](?=\s*(?:禁止|不得|不允许))/u).map(part => part.trim()).filter(Boolean);
      const covered = (claim:NonNullable<WikiDraftChapter["paragraphs"][number]["claims"]>[number]) =>
        claim.unitIds.length && claim.unitIds.every(id => related.has(id))
        && answers.some(part => coveredClause(claim.text, part, answer, receipt.question));
      if (!answerParagraph) {
        // Legacy receipts confirmed original units, with the choice rendered
        // as separate sentences. Give the retained decision one bound home.
        const host = chapter.paragraphs.find(paragraph => paragraph.unitIds.includes(answerId)
          && !wikiHistoricalHeading(paragraph.subtopic) && chapter.body.includes(paragraph.text)
          && prose.some(block => block.text === paragraph.text) && (paragraph.claims?.filter(covered).length ?? 0) >= 2);
        if (!host) continue;
        answerParagraph = { text: answer.statement, subtopic: host.subtopic, unitIds: [answerId],
          claims: [{ text: answer.statement, unitIds: [answerId] }] };
        chapter.body = replaceParagraph(chapter.body, host.text, answer.statement + "\n\n" + host.text);
        chapter.paragraphs.splice(chapter.paragraphs.indexOf(host), 0, answerParagraph);
      }
      for (const paragraph of chapter.paragraphs) {
        const supplemental = /^(?:已确认的取舍|已确认的决定补记|Confirmed choices|Confirmed decisions retained)$/u.test(answerParagraph.subtopic);
        if (paragraph === answerParagraph || !supplemental && paragraph.subtopic !== answerParagraph.subtopic
          || !prose.some(block => block.text === paragraph.text) || !chapter.body.includes(paragraph.text)) continue;
        const claims = paragraph.claims ?? [];
        const drop = claims.filter(covered);
        if (!drop.length) continue;
        const parts = sentences(paragraph.text);
        const removed = parts.filter(part => drop.some(claim => normalized(claim.text) === normalized(part))
          && claims.filter(claim => normalized(part).includes(normalized(claim.text))).every(claim => drop.includes(claim)));
        if (!removed.length) continue;
        const text = parts.filter(part => !removed.includes(part)).join(" "), old = paragraph.text;
        const kept = claims.filter(claim => !removed.some(part => normalized(part).includes(normalized(claim.text))));
        chapter.body = replaceParagraph(chapter.body, old, text);
        paragraph.text = text;
        paragraph.claims = kept;
        paragraph.unitIds = paragraph.unitIds.filter(id => kept.some(claim => claim.unitIds.includes(id))
          || !claims.some(claim => claim.unitIds.includes(id)));
        const bound = answerParagraph.claims?.find(claim => claim.unitIds.includes(answerId));
        if (bound) {
          const accepted = drop.filter(claim => !kept.includes(claim)).flatMap(claim => claim.unitIds)
            .filter(id => ledger.decisions?.[id]?.verdict === "confirmed");
          bound.unitIds = [...new Set([...bound.unitIds, ...accepted])];
          answerParagraph.unitIds = [...new Set([...answerParagraph.unitIds, ...accepted])];
        }
      }
    }
    const keyPolicy = new Set<string>();
    for (const paragraph of chapter.paragraphs) {
      if (!paragraph.claims?.length || !prose.some(block => block.text === paragraph.text) || wikiHistoricalHeading(paragraph.subtopic)) continue;
      const ownsKey = /\bBYOK\b/iu.test(paragraph.text) && /(?:用户自行配置(?:模型)?服务商|用户(?:提供|管理|拥有).{0,20}(?:API\s*Key|API\s*密钥|Key|密钥))/iu.test(paragraph.text);
      if (!ownsKey) continue;
      if (!keyPolicy.has(paragraph.subtopic)) {
        keyPolicy.add(paragraph.subtopic);
        continue;
      }
      const copy = paragraph.text.match(/^采用\s*BYOK(?:\s*[（(]Bring Your Own Key[）)])?模式[，,]\s*由用户提供\s*API\s*(?:Key|密钥)[，,]\s*而非仅依赖(服务端环境变量)[。.]$/iu);
      if (!copy || !paragraph.claims.some(claim => claim.text === paragraph.text)) continue;
      const prior = paragraph.text, text = "模型调用不只依赖" + copy[1] + "。";
      chapter.body = replaceParagraph(chapter.body, prior, text);
      paragraph.text = text;
      paragraph.claims = paragraph.claims.map(claim => claim.text === prior ? { ...claim, text } : claim);
    }
    chapter.paragraphs = chapter.paragraphs.filter(paragraph => paragraph.text);
  }
}
