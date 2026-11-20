import { knowledgeOwner, knowledgeScopesAgree, knowledgeStage, knowledgeTerms } from "../shared/knowledge-subject";
import { replaceParagraph } from "../shared/wiki-body-text";
import { wikiUnitConditions, type WikiDraftChapter, type WikiKnowledgeOrganization, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { joinSentence } from "../shared/wiki-sentences";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { wikiSupplementRanges } from "../shared/wiki-source-supplements";
import type { FocusSection } from "../shared/focus-session";

type Paragraph = WikiDraftChapter["paragraphs"][number];
const bare = (text: string) => text.replace(/[\s*`“”"「」]/gu, "");
/** The values a sentence gives: numbers and Latin names, which a sentence dropped as said must not take with it. */
const values = (text: string) => (text.match(/\d+(?:\.\d+)?|[A-Za-z][\w.+#-]*/gu) ?? []).map(value => value.toLowerCase());
const shared = (a: Set<string>, b: Set<string>) => { let count = 0; for (const term of a) if (b.has(term)) count++; return count; };
/** A sentence another one of its paragraph says in full: most of its words and every value it gives. */
const CONTAINED_SHARED = 5, CONTAINED_COVER = .7;
const SENTENCES = /(?:(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))(?![^“”「」\n]*[”」])/u;

function dropFromClaims(paragraph: Paragraph, sentence: string, into?: string) {
  const gone = bare(sentence), home = into ? bare(into) : "";
  const kept: NonNullable<Paragraph["claims"]> = [];
  let moved: string[] = [];
  for (const claim of paragraph.claims ?? []) {
    const own = bare(claim.text);
    if (own === gone || gone.includes(own)) { moved = [...moved, ...claim.unitIds]; continue; }
    // A claim over both sentences keeps the one left.
    kept.push(own.includes(gone) ? { ...claim, text: claim.text.replace(sentence.trim(), "").trim() } : claim);
  }
  const target = kept.find(claim => home && (bare(claim.text).includes(home) || home.includes(bare(claim.text))));
  if (target && moved.length) target.unitIds = [...new Set([...target.unitIds, ...moved])];
  paragraph.claims = kept.filter(claim => claim.text.trim());
}

/** Drop a sentence of a list item or paragraph that an earlier or longer sentence of it already says ("标准技术词如
 * ESP32、I²C、GPIO、BOM在中文界面中继续保留英文" after "界面标签统一为中文，保留ESP32/GPIO/I²C/BOM/MOSFET等标准技术词……"),
 * and a condition clause the next clause says again ("若识别出市电、高压、膨胀电池等危险部件，疑似市电、裸高压、膨胀电池等
 * 不安全部件返回……"). The units of what goes are cited by what stays. Returns how many went. */
export function droppedContainedRepeats(chapters: WikiDraftChapter[]): number {
  let dropped = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    if (/^\s*\|/u.test(paragraph.text)) continue;
    const before = paragraph.text;
    const lines = before.split("\n").map(line => {
      const parts = line.split(SENTENCES);
      // A sentence said in full by another of the line: the one contained goes, whichever comes first.
      for (let changed = true; changed && parts.length > 1;) {
        changed = false;
        const read = parts.map(part => ({ part, terms: knowledgeTerms(part), values: values(part) }));
        for (const [index, item] of read.entries()) {
          if (item.part.replace(/[\s\p{P}]/gu, "").length < 10) continue;
          const holder = read.find((other, at) => at !== index && other.terms.size >= item.terms.size && shared(item.terms, other.terms) >= CONTAINED_SHARED && shared(item.terms, other.terms) / Math.max(1, item.terms.size) >= CONTAINED_COVER && item.values.every(value => other.values.includes(value) || other.part.toLowerCase().includes(value)));
          if (!holder) continue;
          dropFromClaims(paragraph, item.part, holder.part);
          parts.splice(index, 1); dropped++; changed = true; break;
        }
      }
      // A condition clause ("若识别出市电、高压、膨胀电池等危险部件") the clause after it says again in its own words.
      return parts.map(sentence => sentence.replace(/(^|[。！？!?]\s*|^[-*+]\s+(?:\*\*[^*]+\*\*[：:])?\s*)((?:若|如果|当)[^，,。；;]{6,60})[，,]\s*([^，,。；;]{6,})/u, (whole, lead: string, condition: string, next: string) => {
        const own = knowledgeTerms(condition.replace(/^(?:若|如果|当)/u, "")), theirs = knowledgeTerms(next);
        if (shared(own, theirs) < 5 || shared(own, theirs) / Math.max(1, own.size) < .5 || /^(?:则|就|才|可|需|应)/u.test(next.trim())) return whole;
        dropped++;
        return `${lead}${next}`;
      })).join("");
    });
    const text = lines.join("\n");
    if (text === before) continue;
    // A claim that held the dropped condition keeps what is left of it.
    paragraph.claims = paragraph.claims?.map(claim => text.includes(claim.text) ? claim : (() => { const rest = claim.text.replace(/^(?:若|如果|当)[^，,。；;]{6,60}[，,]\s*/u, ""); return text.includes(rest) ? { ...claim, text: rest } : claim; })());
    chapter.body = replaceParagraph(chapter.body, before, text);
    paragraph.text = text;
  }
  return dropped;
}

/** A short paragraph (one or two sentences) that another paragraph of its chapter already says: every number and name it
 * gives is there, its negation too, and most of its words ("The application must use a 48px top bar and 8px corner
 * radius." under the list giving both values). Split off from the paragraphs around it and written apart, one run told
 * 48px and 8px four times in one subtopic. It goes; the paragraph that says it cites its units, so a decision among them
 * is marked there. Returns how many went. */
const REPEAT_COVER = .6, REPEAT_SHARED = 3, CROSS_COVER = .75;
const NEGATION_WORDS = /\b(?:not|never|no|without|excluded?|excludes|only|prohibit(?:s|ed)?|forbid(?:s|den)?|disallow(?:s|ed)?)\b|不|无|仅|只|禁止/iu;
const CONTEXT_WORDS = /(?:若|如果|除非|例外|前提|仅当|当时|待确认)|\b(?:if|unless|when|except|only when|not yet verified)\b/iu;
/** The values a short paragraph must not lose: numbers, and names (USD, IndexedDB, React) rather than every English word. */
const keyValues = (text: string) => (text.match(/[㐀-鿿]/u) ? values(text) : text.match(/\d+(?:\.\d+)?|\b[A-Z]{2,}\b|\b[A-Za-z]*[a-z][A-Z]\w*/gu) ?? []).map(value => value.toLowerCase());
export function droppedRepeatedParagraphs(
  chapters: WikiDraftChapter[],
  kept: ReadonlySet<object> = new Set(),
  scopeOf?: (id: string) => string | undefined,
): number {
  let dropped = 0;
  const signatures = (ids: string[]) => new Set(ids.map(id => scopeOf?.(id)));
  const equivalentScope = (left: string[], right: string[]) => {
    if (!scopeOf) return true;
    const own = signatures(left), other = signatures(right);
    return own.size > 0 && !own.has(undefined) && own.size === other.size && [...own].every(value => other.has(value));
  };
  for (const chapter of chapters) {
    for (let index = chapter.paragraphs.length - 1; index >= 0; index--) {
      const paragraph = chapter.paragraphs[index], text = paragraph.text.trim();
      // A decision written in its own words where nothing else carried its mark (ensureWikiDecisions).
      if (kept.has(paragraph)) continue;
      if (/\n/u.test(text) || /^(?:[-*+]\s|\d+\.\s|\||>|`{3}|~{3}|\*[^*\s])/u.test(text)) continue;
      if (text.split(SENTENCES).filter(sentence => sentence.trim()).length > 2) continue;
      const own = knowledgeTerms(text), mine = keyValues(text);
      if (own.size < REPEAT_SHARED) continue;
      const says = (other: string) => {
        if (!knowledgeScopesAgree(text, other) || knowledgeStage(text) !== knowledgeStage(other)
          || NEGATION_WORDS.test(text) !== NEGATION_WORDS.test(other)
          || CONTEXT_WORDS.test(text) && !bare(other).includes(bare(text))) return false;
        const theirs = knowledgeTerms(other), values = other.toLowerCase(), both = shared(own, theirs);
        return both >= REPEAT_SHARED && both / own.size >= REPEAT_COVER && mine.every(value => values.includes(value));
      };
      const holder = chapter.paragraphs.find((other, at) => at !== index && !/^\s*(?:\*[^*\n]+\*\n\n)?(?:`{3,}|~{3,})/u.test(other.text)
        && equivalentScope(paragraph.unitIds, other.unitIds) && says(other.text));
      // The chapter's opening, which is no paragraph of it: "Data persistence relies exclusively on IndexedDB via Dexie,
      // with localStorage explicitly prohibited." opened the chapter, and "Use IndexedDB via Dexie …; do not use
      // localStorage." stood again under Implementation. Only when the opening cites every unit of the paragraph: it then
      // carries the decision's mark, and an opening merely sharing words keeps what it does not cite said below.
      const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0].trim();
      const cited = new Set(chapter.openingUnitIds ?? []);
      // Another chapter saying it with every value, and nearly all its words: "Dashboard top bar is 48px tall; global corner
      // radius is 8px." stood under the roadmap's future plans, the interface chapter opening on both values.
      const folded = stems(text), strict = (other: string) => says(other) && shared(folded, stems(other)) / Math.max(1, folded.size) >= CROSS_COVER;
      const elsewhere = !holder && mine.length >= 2 ? chapters.flatMap(other => other === chapter ? [] : [
        ...other.body.startsWith("### ") ? [] : [{ chapter: other, text: other.body.split(/\n### /u)[0].trim(), paragraph: undefined as Paragraph | undefined }],
        ...other.paragraphs.filter(item => !/^\s*(?:\*[^*\n]+\*\n\n)?(?:`{3,}|~{3,}|\|)/u.test(item.text)).map(item => ({ chapter: other, text: item.text, paragraph: item as Paragraph | undefined })),
        // Or a subtopic of it, its prose together: "Dashboard top bar is 48px tall; global corner radius is 8px." stood in
        // the roadmap while the interface subtopic gave 48px in one item and 8px in the next.
        ...[...new Set(other.paragraphs.map(item => item.subtopic))].map(title => {
          const own = other.paragraphs.filter(item => item.subtopic === title && !/^\s*(?:\*[^*\n]+\*\n\n)?(?:`{3,}|~{3,}|\|)/u.test(item.text));
          return { chapter: other, text: own.map(item => item.text).join("\n"), paragraph: own.find(item => mine.some(value => item.text.toLowerCase().includes(value))) };
        }).filter(item => item.paragraph),
      ]).find(item => item.text && equivalentScope(paragraph.unitIds, item.paragraph?.unitIds ?? item.chapter.openingUnitIds ?? [])
        && (!scopeOf || !item.paragraph || strict(item.paragraph.text)) && strict(item.text)) : undefined;
      if (!holder && opening && paragraph.unitIds.length && paragraph.unitIds.every(id => cited.has(id)) && !opening.includes(text) && says(opening)) { /* the opening says it */ }
      else if (elsewhere) {
        if (elsewhere.paragraph) elsewhere.paragraph.unitIds = [...new Set([...elsewhere.paragraph.unitIds, ...paragraph.unitIds])];
        else elsewhere.chapter.openingUnitIds = [...new Set([...elsewhere.chapter.openingUnitIds ?? [], ...paragraph.unitIds])];
      }
      else if (!holder) continue;
      else holder.unitIds = [...new Set([...holder.unitIds, ...paragraph.unitIds])];
      chapter.paragraphs.splice(index, 1);
      const before = chapter.body;
      chapter.body = before.includes(`\n\n${paragraph.text}`) ? before.replace(`\n\n${paragraph.text}`, () => "") : before.replace(paragraph.text, () => "");
      dropped++;
    }
  }
  return dropped;
}

/** A list item another item of its list says in full: every term (plurals folded) and every value and negation of it
 * ("- CSV export is not working" beside "- … CSV export is required for V1 but is not working yet."). One run listed
 * what is built three times in five items, each from another message saying it. The shorter goes; its claims are
 * cited by the item that says it. Returns how many went. */
const ITEM_COVER = .85;
const stems = (text: string) => new Set([...knowledgeTerms(text)].map(term => term.replace(/[.,;:!?]+$/u, "")).map(term => /^[a-z]{4,}$/u.test(term) ? term.replace(/(?:ies)$/u, "y").replace(/(?<=[^s])s$/u, "") : term));
export function droppedRepeatedListItems(chapters: WikiDraftChapter[]): number {
  let dropped = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    const lines = paragraph.text.split("\n");
    const items = lines.map(line => /^\s*[-*+]\s+/u.test(line) ? line.replace(/^\s*[-*+]\s+(?:\*\*[^*\n]+\*\*\s*[：:]\s*)?/u, "").trim() : undefined);
    if (items.filter(Boolean).length < 2) continue;
    const gone = new Set<number>();
    for (const [index, item] of items.entries()) {
      if (!item) continue;
      const own = stems(item), mine = keyValues(item);
      if (own.size < 3) continue;
      const holder = items.findIndex((other, at) => {
        if (!other || at === index || gone.has(at)) return false;
        const theirs = stems(other);
        if (theirs.size < own.size || theirs.size === own.size && at > index) return false;
        return shared(own, theirs) / own.size >= ITEM_COVER && mine.every(value => other.toLowerCase().includes(value)) && (!NEGATION_WORDS.test(item) || NEGATION_WORDS.test(other));
      });
      if (holder < 0) continue;
      gone.add(index);
      dropFromClaims(paragraph, lines[index].replace(/^\s*[-*+]\s+/u, ""), lines[holder].replace(/^\s*[-*+]\s+/u, ""));
    }
    if (!gone.size) continue;
    const before = paragraph.text;
    paragraph.text = lines.filter((_, at) => !gone.has(at)).join("\n");
    chapter.body = replaceParagraph(chapter.body, before, () => paragraph.text);
    dropped += gone.size;
  }
  return dropped;
}

/** A sentence of a prose paragraph that shares nothing with the paragraph's other sentences and cites units none of them
 * cite ("本轮仅预留架构接口……不开发 CAD、3D 模型" among the transitions and page widths; "右侧 AI 面板定位为 Hardware
 * Copilot" after the product's core goal): a paragraph of its own, where it stood. Returns how many paragraphs were added. */
/** Words any two sentences of a document may share without being about one thing. */
const COMMON = /^(?:ai|llm|而非|系统|用户|项目|设计|支持|需要|使用|实现|功能|进行|通过|提供|显示|保持|必须|禁止|避免|可以|当前|第一|一版)$/u;
/** A sentence leaning on the one before ("涉及 VISION_……", "具体而言……", "同时构建……"): never on its own. */
const LEANS = /^(?:涉及|具体|其中|同时|此外|另外|并且|并|且|也|但|而|因此|所以|这|该|此|其|它|上述|以上|包括|例如|比如|如|即|从而|以便|以|再|然后|随后|最后|首先)/u;
const ISLAND_SHARED = 0, ISLAND_CHARS = 20;
const PLAIN_PROSE = /^(?!\s*(?:[-*+]\s|[>#|]|\x60{3}|~{3}|(?:\*\s*){3,}$|\d+[.)]\s))[^\n]+$/u;
const EDITORIAL_STANDING = /当时|此前|早期|用户报告|项目发起人|已确认|已决定|已实现|已验证|(?<!未)明确|待确认|\b(?:reported|previously|verified|approved|decided)\b/iu;
const PROPOSAL_LEAD = /^(?:(?:AI\s*(?:对具体细节的)?|讨论中的)?建议\s*[：:]\s*|(?:AI\s+)?(?:proposal|suggestion)\s*:\s*)/iu;
const CONDITIONAL_DETAIL = /^(?:无法|未能|遇到|当|若|如果|\b(?:if|when|on failure)\b)/iu;

function paragraphSubject(paragraph: Paragraph, subjectOf: ReadonlyMap<string, string>) {
  const subjects = new Set(paragraph.unitIds.map(id => subjectOf.get(id)));
  return subjects.size === 1 ? subjects.values().next().value : undefined;
}

function coherentProse(first: string, second: string, sameGroup: boolean, sameSubject: boolean, qualifiedProposal = false) {
  if ((!qualifiedProposal && EDITORIAL_STANDING.test(first)) || EDITORIAL_STANDING.test(second) || !knowledgeScopesAgree(first, second)) return false;
  const firstStage = knowledgeStage(first), secondStage = knowledgeStage(second);
  if (firstStage && secondStage && firstStage !== secondStage) return false;
  if (sameGroup) return true;
  const terms = (text: string) => new Set([...knowledgeTerms(text)].filter(term => !COMMON.test(term)));
  const left = terms(first), right = terms(second);
  const intersection = shared(left, right);
  if (qualifiedProposal && sameSubject && intersection >= 1) return true;
  if (sameSubject && LEANS.test(second.trimStart()) && intersection >= 1) return true;
  return intersection >= (sameSubject ? 3 : 5)
    && intersection / Math.min(left.size, right.size) >= (sameSubject ? .3 : .42);
}

/** Rejoin material on the same subject, carrying each sentence's binding and
 * explicit status. Nearby intervening prose can move within its own heading. */
export function mergeWikiRelatedParagraphs(
  chapter: WikiDraftChapter,
  subjectOf: ReadonlyMap<string, string>,
  statusOf: ReadonlyMap<string, string>,
  groupOf: ReadonlyMap<string, string> = new Map(),
  conditionsOf?: (id: string) => readonly string[],
): WikiDraftChapter {
  let body = chapter.body;
  const paragraphs: Paragraph[] = [];
  const conditions = (paragraph: Paragraph) => [...new Set(paragraph.unitIds.flatMap(id => conditionsOf?.(id) ?? []))].sort().join("\n");
  const standing = (paragraph: Paragraph) => new Set(paragraph.unitIds.map(id => statusOf.get(id)));
  const numberedOrDependent = /^(?:但|然而|因此|随后|接着|最后|以上|上述|该方案|\b(?:but|however|therefore|next|afterwards|the above)\b)/iu;
  const compatible = (previous: Paragraph, current: Paragraph) => {
    const before = standing(previous), after = standing(current);
    const sameStanding = before.size === 1 && after.size === 1 && before.values().next().value === after.values().next().value;
    const subject = paragraphSubject(current, subjectOf);
    const sameSubject = Boolean(subject && paragraphSubject(previous, subjectOf) === subject);
    const group = paragraphSubject(current, groupOf);
    const sameGroup = Boolean(group && paragraphSubject(previous, groupOf) === group);
    const sameSourcePoint = current.unitIds.some(id => previous.unitIds.includes(id));
    const qualifiedProposal = after.size === 1 && after.has("proposal") && (PROPOSAL_LEAD.test(current.text) || CONDITIONAL_DETAIL.test(current.text))
      && before.has("confirmed") && [...before].every(value => value === "confirmed" || value === "proposal") && (sameSubject || sameGroup);
    if (current.subtopic !== previous.subtopic || !PLAIN_PROSE.test(previous.text) || !PLAIN_PROSE.test(current.text)
      || !/[。！？.!?]$/u.test(previous.text) || !/[。！？.!?]$/u.test(current.text)
      || previous.text.length + current.text.length > (sameGroup || sameSubject ? 280 : 235) || current.text.length > 165
      || previous.text.split(SENTENCES).filter(Boolean).length + current.text.split(SENTENCES).filter(Boolean).length > 4
      || !previous.claims?.length || !current.claims?.length
      || !sameGroup && !sameSubject && !sameSourcePoint && !(PROPOSAL_LEAD.test(previous.text) && PROPOSAL_LEAD.test(current.text))
      || !statusOf.get(current.unitIds[0]) || !sameStanding && !qualifiedProposal
      || conditions(previous) !== conditions(current)
      || !coherentProse(previous.text, current.text, sameGroup || sameSourcePoint, sameSubject, qualifiedProposal)) return false;
    return true;
  };
  const ordered = [...chapter.paragraphs];
  for (let index = 0; index < ordered.length; index++) {
    let current = ordered[index];
    let previous = paragraphs.at(-1);
    if (previous && standing(previous).has("proposal") && standing(current).has("confirmed")
      && PROPOSAL_LEAD.test(previous.text) && !LEANS.test(current.text) && compatible(current, previous)) {
      const adjacent = previous.text + "\n\n" + current.text;
      if (body.includes(adjacent) && body.indexOf(adjacent) === body.lastIndexOf(adjacent)) {
        body = replaceParagraph(body, adjacent, () => current.text + "\n\n" + previous!.text);
        paragraphs[paragraphs.length - 1] = current;
        [previous, current] = [current, previous];
      }
    }
    if (previous && !compatible(previous, current) && paragraphSubject(previous, subjectOf)) {
      for (let at = index + 1; at < Math.min(ordered.length, index + 4); at++) {
        const skipped = ordered[at - 1], candidate = ordered[at];
        if (skipped.subtopic !== previous.subtopic || !PLAIN_PROSE.test(skipped.text) || LEANS.test(skipped.text)
          || EDITORIAL_STANDING.test(skipped.text) || conditions(skipped) !== conditions(previous)
          || !skipped.claims?.length || !PLAIN_PROSE.test(candidate.text) || numberedOrDependent.test(candidate.text)) break;
        if (paragraphSubject(candidate, subjectOf) !== paragraphSubject(previous, subjectOf) || !compatible(previous, candidate)) continue;
        const before = ordered.slice(index, at + 1).map(item => item.text).join("\n\n");
        const surrounding = previous.text + "\n\n" + before;
        if (!body.includes(surrounding) || body.indexOf(surrounding) !== body.lastIndexOf(surrounding)) break;
        ordered.splice(at, 1);
        ordered.splice(index, 0, candidate);
        body = replaceParagraph(body, surrounding, () => [previous.text, ...ordered.slice(index, at + 1).map(item => item.text)].join("\n\n"));
        current = candidate;
        break;
      }
    }
    if (!previous || !compatible(previous, current)) {
      paragraphs.push(current);
      continue;
    }
    const original = `${previous.text}\n\n${current.text}`;
    if (!body.includes(original) || body.indexOf(original) !== body.lastIndexOf(original)) {
      paragraphs.push(current);
      continue;
    }
    const priorClaim = previous.claims?.at(-1);
    const proposalContinues = priorClaim?.unitIds.every(id=>statusOf.get(id)==="proposal") && standing(current).has("proposal");
    const removeLead = proposalContinues && (PROPOSAL_LEAD.test(previous.text) || PROPOSAL_LEAD.test(priorClaim?.text ?? ""));
    const needsLead = standing(previous).has("confirmed") && !proposalContinues && standing(current).has("proposal") && !PROPOSAL_LEAD.test(current.text);
    const next = removeLead ? current.text.replace(PROPOSAL_LEAD, "") : needsLead
      ? (/\p{Script=Han}/u.test(current.text) ? "建议：" : "Proposal: ") + current.text : current.text;
    const text = joinSentence(previous.text, next);
    body = replaceParagraph(body, original, () => text);
    paragraphs[paragraphs.length - 1] = {
      ...previous, text, unitIds: [...new Set([...previous.unitIds, ...current.unitIds])],
      claims: [...(previous.claims ?? []), ...(current.claims ?? []).map(claim => removeLead ? { ...claim, text: claim.text.replace(PROPOSAL_LEAD, "") } : claim)],
    };
  }
  return body === chapter.body ? chapter : { ...chapter, body, paragraphs };
}

export function wikiParagraphScope(unit: WikiKnowledgeUnit) {
  return [unit.about?.name.toLowerCase() ?? "", knowledgeStage(unit.statement) ?? knowledgeStage(unit.evidence.section ?? "") ?? "",
    knowledgeOwner(unit.statement) ?? "", ...wikiUnitConditions(unit).sort()];
}

/** Project the same composition rules onto older saved chapters. The binding
 * keeps its original quote, receipt and status when sentences share a block. */
export function composeSavedWikiParagraphs(section: FocusSection, organization: WikiKnowledgeOrganization | undefined,
  units: ReadonlyMap<string, WikiKnowledgeUnit>, status: ReadonlyMap<string, string>) {
  if (!organization || section.userEdited || section.origin || !section.claims?.length) return section;
  const subjects = new Map(organization.subjects.flatMap(subject => subject.unitIds.map(id => [id, subject.id] as const)));
  const groups = new Map(organization.groups?.flatMap(group => group.members.map(member => [member.unitId, group.id] as const)));
  const supplements = wikiSupplementRanges(section.body);
  let subtopic = "";
  const paragraphs = wikiDocumentBlocks(section.body, section.claims).map(block => {
    if (block.kind === "heading") subtopic = block.text;
    const claims = block.kind === "paragraph" && !supplements.some(([start,end]) => block.start >= start && block.end <= end)
      ? block.claims.flatMap(claim => !claim.checked && !claim.markOnly && claim.unitIds?.length && claim.unitIds.every(id=>units.has(id)) && block.text.includes(claim.text)
        ? [{text:claim.text,unitIds:claim.unitIds}] : []) : [];
    return {text:block.text,subtopic,claims,unitIds:[...new Set(claims.flatMap(claim=>claim.unitIds))]};
  });
  const draft: WikiDraftChapter = {id:section.id,title:section.title,group:"",question:"",body:section.body,paragraphs,problems:[]};
  const combined = mergeWikiRelatedParagraphs(draft, subjects, status, groups, id => {
    const unit = units.get(id);
    return unit ? [JSON.stringify(wikiParagraphScope(unit).slice(0,3))] : [];
  });
  if (combined === draft) return section;
  const revised = new Set(combined.paragraphs.flatMap(paragraph => (paragraph.claims ?? []).map(claim => claim.text)));
  return {...section,body:combined.body,claims:section.claims.map(claim => {
    const shaved = claim.text.replace(PROPOSAL_LEAD, "");
    return shaved !== claim.text && revised.has(shaved) && !combined.body.includes(claim.text)
      ? {...claim,text:shaved,formulations:undefined} : claim;
  })};
}

export function splitUnrelatedSentences(chapters: WikiDraftChapter[], groupOf?: ReadonlyMap<string, string>): number {
  let moved = 0;
  for (const chapter of chapters) {
    const next: Paragraph[] = [];
    for (const paragraph of chapter.paragraphs) {
      const sentences = paragraph.text.split(SENTENCES).filter(sentence => sentence.trim());
      if (paragraph.text.includes("\n") || /^\s*[|#>-]/u.test(paragraph.text) || sentences.length < 2 || !paragraph.claims?.length) { next.push(paragraph); continue; }
      const claimOf = (sentence: string) => paragraph.claims!.find(claim => bare(sentence).includes(bare(claim.text)) && bare(claim.text).length >= bare(sentence).length * .6);
      const read = sentences.map(sentence => ({ sentence, terms: new Set([...knowledgeTerms(sentence)].filter(term => !COMMON.test(term))), claim: claimOf(sentence) }));
      const sharesTopic = (left: readonly string[], right: readonly string[]) => left.some(id => right.includes(id)
        || Boolean(groupOf?.get(id) && right.some(other => groupOf?.get(other) === groupOf?.get(id))));
      // An island: its own claim, its own units, no word with any other sentence, and no sentence after it leaning on it.
      const island = read.map((item, index) => Boolean(item.claim) && !LEANS.test(item.sentence.trim()) && !LEANS.test(read[index + 1]?.sentence.trim() ?? "")
        && item.sentence.replace(/[\s\p{P}]/gu, "").length >= ISLAND_CHARS && read.every((other, at) => at === index
          || shared(item.terms, other.terms) <= ISLAND_SHARED && !sharesTopic(other.claim?.unitIds ?? [], item.claim!.unitIds)));
      if (!island.some(Boolean)) { next.push(paragraph); continue; }
      // In reading order: each island a paragraph of its own, the sentences between them together.
      const runs: Array<typeof read> = [];
      read.forEach((item, index) => { if (island[index] || !runs.length || island[index - 1]) runs.push([item]); else runs[runs.length - 1].push(item); });
      if (runs.length < 2) { next.push(paragraph); continue; }
      const own = (items: typeof read): Paragraph => {
        const claims = items.flatMap(item => paragraph.claims!.filter(claim => bare(item.sentence).includes(bare(claim.text))));
        const ids = new Set(claims.flatMap(claim => claim.unitIds));
        return { ...paragraph, text: items.map(item => item.sentence.trim()).join(""), unitIds: paragraph.unitIds.filter(id => ids.has(id) || !paragraph.claims!.some(claim => claim.unitIds.includes(id))), claims: [...new Set(claims)] };
      };
      const parts = runs.map(own);
      moved += runs.length - 1;
      chapter.body = replaceParagraph(chapter.body, paragraph.text, parts.map(part => part.text).join("\n\n"));
      next.push(...parts);
    }
    chapter.paragraphs = next;
  }
  return moved;
}
