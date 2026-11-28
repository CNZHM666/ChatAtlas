import { knowledgeTerms } from "../shared/knowledge-subject";
import { NEGATION, keepsDetail, quotedDetails, statementsConflict, wikiUnitConditions, type WikiKnowledgeLedger, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { measuredSourceScope } from "./wiki-source-scope";
import { sourceMessageSignature } from "../shared/source-signature";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { messageSection } from "../shared/wiki-sections";
import { messageCode } from "../shared/wiki-source-code";
import { wikiFlowSteps } from "../shared/wiki-flow-steps";
import { wikiSourceWithoutCitations } from "../shared/source-quote-text";

/** Bumped when these checks change: a batch checked under the same rules is not asked to repair again. */
export const FIDELITY_RULES = 9;

/** Words that make a point a hard rule, and words that tell it as already chosen. A statement may use one only when its
 * source does: 「不要通过外部链接……绕开」 was extracted as 「严禁通过外部链接……绕开」 and listed among the project's limits,
 * 「我更推荐左边作为正式首页」 as 「最终选择左侧结构作为正式首页」. */
const HARD = /必须|严禁|禁止|(?<!不)不得(?!不)|不准|一律|务必|绝不|决不|\b(?:must|never|forbidden|prohibited|shall not|is not allowed)\b/iu;
const DECIDED = /最终(?:选择|确定|决定|采用)|已(?:经)?(?:决定|确定|选定)|(?<![不未没难])(?:决定|确定)(?:采用|使用|选择|了)?|定为|\b(?:decided|chose|chosen|final(?:ly)? (?:chose|decided|picked))\b/iu;
/** The source around its quote that may carry a word the 350-character quote cut off. */
const NEAR = 80;
const REFERENCE_LICENSE = /(?:[，,；;]\s*|^)(?:(?:采用|使用|遵循|基于)\s*(?<zh>[A-Za-z][\w.+-]*)\s*(?:许可证|许可协议|许可|协议)|licensed under\s+(?:the\s+)?(?<en>[A-Za-z][\w.+-]*)(?:\s+license)?|uses the\s+(?<enUses>[A-Za-z][\w.+-]*)\s+license)[。.]?$/iu;

/** Bold numbered source headings often appear as a paragraph followed by a
 * hard break. Scope a license to its named entry inside the admitted material. */
function namedReferenceExcerpt(unit: WikiKnowledgeUnit, body: string) {
  if (unit.about?.role !== "reference") return;
  const anchors = wikiDocumentBlocks(body).flatMap(block => {
    if (block.kind === "heading") return [{ start: block.start, heading: block.text.replace(/^#+\s*/u, "") }];
    if (block.kind !== "paragraph" && block.kind !== "list") return [];
    // Capture adapters can preserve an entry as plain numbered Markdown, bold text,
    // or a title line within a paragraph. Labels require a title separator.
    return [...block.text.matchAll(/^[ \t]*(?:(?:\*\*)?\d+[.)、][ \t]+(?:\*\*)?([^\r\n]+?)[ \t]+[—–][ \t]*[^\r\n]+|\*\*\d+[.)、][ \t]+([^*\r\n]+)\*\*\\?)[ \t]*$/gmu)]
      .map(match => ({ start: block.start + match.index, heading: (match[1] ?? match[2]).replace(/\*\*/gu, "").trim() }));
  });
  const offset = body.indexOf(unit.evidence.quote);
  if (offset < 0 || offset !== body.lastIndexOf(unit.evidence.quote)) return;
  const labelStart = wikiSourceWithoutCitations(unit.evidence.quote, true).search(/[\p{L}\p{N}]/u);
  const quotedAt = offset + Math.max(0, labelStart);
  const index = anchors.findIndex((anchor, at) => anchor.start <= quotedAt && (anchors[at + 1]?.start ?? Infinity) > quotedAt);
  if (index < 0) return;
  const { start, heading } = anchors[index];
  const name = heading.replace(/^\d+[.)、]\s*/u, "").split(/\s+[—–-]\s*|\s*[:：]/u, 1)[0].trim().toLowerCase();
  if (name !== unit.about.name.trim().toLowerCase()) return;
  const quote = body.slice(start, anchors[index + 1]?.start).trimEnd();
  if (quote.length <= 1800 && body.indexOf(quote) === body.lastIndexOf(quote)) return quote;
}

const licenseCode = (statement: string) => {
  const clause = statement.match(REFERENCE_LICENSE);
  return { clause, license: clause?.groups?.zh ?? clause?.groups?.en ?? clause?.groups?.enUses };
};
const hasLicense = (text: string, license: string) => text.split(/\r?\n/u).some(line =>
  /协议|许可|\blicen[cs]e[ds]?\b|\bSPDX\b/iu.test(line) && !NEGATION.test(line)
  && line.toLowerCase().split(/[^a-z0-9_.+-]+/u).some(part => part.replace(/\.$/u, "") === license.toLowerCase()));

const HAN_DIGIT: Record<string, string> = { 零: "0", 一: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10" };
/** Han numerals counting something (三个, 两周, 十分钟) read as digits; others (一定, 统一) stay words. */
const digits = (text: string) => text.normalize("NFKC").replace(/(\d),(?=\d{3}\b)/gu, "$1").replace(/[零一二两三四五六七八九十](?=\s*(?:个|条|项|天|日|周|月|年|次|步|人|名|位|分钟|秒|小时|倍|组|档|种|类|级|版|阶段|期))/gu, digit => HAN_DIGIT[digit]);
const figures = (text: string) => new Set(digits(text).match(/\d+(?:\.\d+)?/gu) ?? []);

/** A count of days, weeks or steps told as a length (前3天, 3天内, first 3 days), and the same figure told only as a
 * place in a sequence (第3天, 第1—3天, Day 3): 「第1—3天 Agent 免费安排任务，第3天展示报告」 read as 「前3天免费体验」. */
const UNIT = "(?:天|日|周|个月|月|次|步|轮|期)";
const lengthsIn = (text: string) => [...digits(text).matchAll(new RegExp(`(?:前|头|首|最初)\\s*(\\d+)\\s*${UNIT}|(\\d+)\\s*${UNIT}\\s*(?:内|之内|以内)|\\b(?:first|for|within)\\s+(\\d+)\\s+(?:days?|weeks?|months?|steps?)`, "giu"))].map(match => ({ phrase: match[0].replace(/\s+/gu, "").toLowerCase(), figure: match[1] ?? match[2] ?? match[3] }));
const placed = (text: string, figure: string) => new RegExp(`第\\s*(?:\\d+\\s*[—\\-–~～至到]\\s*)?${figure}\\s*${UNIT}|\\b(?:day|week|step)\\s*${figure}\\b|\\b${figure}(?:st|nd|rd|th)\\s+(?:day|week|step)`, "iu").test(digits(text));

const assertions = (text: string) => text.split(/[，；;。！？\n]|,(?!\d{3}\b)|\b(?:and then|but)\b/iu).map(part => part.trim()).filter(Boolean);
const COLOR = /红色|蓝色|绿色|黄色|紫色|橙色|灰色|白色|黑色|\b(?:red|blue|green|yellow|purple|orange|grey|gray|white|black)\b/giu;
const FORBIDS = /不要|禁止|严禁|不得|不应|不允许|勿|\b(?:never|do not|must not|not allowed|avoid)\b/iu;
const GRANTS = /允许|必须|统一启用|\b(?:is allowed|must enable|always use)\b/iu;
const PRECISE = /\b(?:[a-z]+[A-Z][A-Za-z]+|[A-Z][\dA-Z]*(?:_[A-Z0-9]+)+)\b/gu;
const compare = (text: string) => text.toLowerCase().replace(/\bnode\b/gu, "节点").replace(/\s|[*`_]/gu, "");

type UnitAssertion = Pick<WikiKnowledgeUnit, "statement" | "evidence"> & Partial<Pick<WikiKnowledgeUnit, "subject" | "facet" | "about">>;

function wrongSection(unit: UnitAssertion, quote: string) {
  if (!unit.subject || !unit.evidence.section) return false;
  const subject = knowledgeTerms(unit.subject), claims = knowledgeTerms(unit.statement);
  if (!subject.size || [...subject].some(term => claims.has(term))) return false;
  const section = knowledgeTerms(unit.evidence.section);
  const firstHeading = quote.match(/^ {0,3}#{1,6}\s+(?:\d+[.)、]\s*)?(.+)$/mu);
  const namedSubject = unit.subject.match(/^[A-Z][a-zA-Z\d_-]{2,}\b/u)?.[0]?.toLowerCase();
  if (namedSubject && firstHeading?.index === 0 && !knowledgeTerms(quote).has(namedSubject)
    && !section.has(namedSubject) && [...section].some(term => /^[a-z][a-z\d_-]{3,}$/u.test(term) && claims.has(term))) return true;
  if (firstHeading && quote.indexOf(firstHeading[0]) === 0 && [...knowledgeTerms(firstHeading[1])].some(term => subject.has(term) && section.has(term))
    && /^(?:按|按照|严格\s*按|遵循|follow)\s*(?:Phase|Milestone|Stage)\b/iu.test(unit.statement)) {
    const headings = wikiDocumentBlocks(quote).filter(block => block.kind === "heading").slice(1);
    const depth = firstHeading[0].match(/^\s*#+/u)?.[0].trim().length ?? 0;
    if (headings.every(block => (block.text.match(/^#+/u)?.[0].length ?? 0) > depth)
      && supportedStageOrder(unit.statement, headings.map(block => block.text)) !== undefined) return false;
  }
  const displaced = [...quote.matchAll(/^ {0,3}#{1,6}\s+(?:\d+[.)、]\s*)?(.+)$/gmu)].some(([, heading]) => {
    const terms = knowledgeTerms(heading);
    return terms.size >= 2 && [...terms].some(term => claims.has(term))
      && ![...terms].some(term => subject.has(term) || section.has(term));
  });
  if (displaced) return true;
  if (!/^(?:待确认事项|待决事项|open questions?)$/iu.test(unit.facet ?? "")) return false;
  const source = knowledgeTerms(quote);
  return /\b[A-Z][A-Za-z]{2,}\s+[A-Z][A-Za-z]{2,}\b/u.test(unit.evidence.section)
    && ![...subject].some(term => source.has(term) || section.has(term))
    && [...section].some(term => /^[a-z][a-z\d_-]{3,}$/u.test(term) && claims.has(term) && source.has(term));
}

/** Each assertion needs its own support. Evidence for a second action
 * cannot authorize a color, a prohibition, or an unrelated first action. */
export function wikiUnitAssertionIssues(unit: UnitAssertion, nearby = unit.evidence.quote): string[] {
  const quote = unit.evidence.quote;
  if (wrongSection(unit, quote)) return ["assertion topic: the statement belongs to a different source heading"];
  const at = nearby.indexOf(quote);
  const preceding = at > 0 ? nearby.slice(Math.max(0, at - 40), at) : "";
  if (/(?:不要|禁止|不应|不得|勿|\b(?:avoid|do not|never))\s*[:：]\s*(?:[-*+]\s+)?$/iu.test(preceding)
    && !NEGATION.test(unit.statement)) return ["assertion polarity: the quote follows an explicit prohibition"];
  const original = compare(quote);
  if (!original) return [];
  if (original.includes(compare(unit.statement)) && !FORBIDS.test(nearby) && !NEGATION.test(unit.statement)) return [];
  const clauses = assertions(unit.statement), sources = assertions(quote);
  return clauses.flatMap(clause => {
    const sameColor = [...clause.matchAll(COLOR)].map(match => match[0].toLowerCase());
    const own = knowledgeTerms(compare(clause));
    const polarity = assertions(nearby).some(source => {
      if (NEGATION.test(clause) === NEGATION.test(source) || !(FORBIDS.test(source) || FORBIDS.test(clause) && GRANTS.test(source))
        || !sources.includes(source) && !sameColor.some(color => source.toLowerCase().includes(color))) return false;
      const words = knowledgeTerms(compare(source)), common = [...own].filter(word => words.has(word)).length;
      if (!NEGATION.test(clause) && FORBIDS.test(source) && compare(source).includes(compare(clause))) return true;
      return common >= 2 && common / Math.min(own.size, words.size) >= .6 && statementsConflict(compare(clause), compare(source));
    });
    if (polarity) return [`assertion polarity: "${clause}" conflicts with the source`];
    if (original.includes(compare(clause))) return [];
    const identifiers = clause.match(PRECISE) ?? [];
    if (sameColor.length && !sameColor.every(color => quote.toLowerCase().includes(color))
      || clauses.length > 1 && identifiers.length && identifiers.every(token => !quote.includes(token))
        && /写入|调用|返回|切换|启用|禁用|\b(?:write|call|return|enable|disable)\b/iu.test(clause)
        && clauses.some(other => other !== clause && original.includes(compare(other)))) {
      return [`assertion evidence: "${clause}" is not supported by its quote`];
    }
    return [];
  });
}

/** What a statement says beyond its source, as reasons a repair can act on:
 * - a hard-rule word, or (for a point not the user's own) a word telling it as chosen, its source near the quote lacks;
 * - a figure its whole message never gives;
 * - a length its message gives only as a place in a sequence.
 * Empty when the statement keeps to its source. */
export function statementDrift(unit: UnitAssertion, body: string): string[] {
  const statement = unit.statement, quote = unit.evidence.quote;
  const at = body.indexOf(quote.slice(0, 40)), near = at < 0 ? quote : body.slice(Math.max(0, at - NEAR), at + quote.length + NEAR);
  const reasons: string[] = [];
  const own = unit.evidence.role === "user" && !unit.evidence.pasted;
  const hard = statement.match(HARD)?.[0];
  if (hard && !HARD.test(near)) reasons.push(`strength: the statement says "${hard}", the source does not say it this strongly`);
  const decided = !own && statement.match(DECIDED)?.[0];
  if (decided && !DECIDED.test(near)) reasons.push(`decided: the statement says "${decided}", the source only proposes or recommends`);
  // A named technology may occur just outside the quote. Match the full identifier in
  // the same message and keep standalone quantities subject to the nearby-source check.
  const namedVersion = /\b(?:[A-Z][A-Z-]{1,15}\s+\d+(?:\.\d+)*|[A-Za-z][A-Za-z_-]*\d+(?:\.\d+)*[A-Za-z\d_-]*)(?![A-Za-z\d])/gu;
  const identifierKey = (text: string) => text.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
  const sourceNames = new Set([...body.matchAll(namedVersion)].map(match => identifierKey(match[0])));
  const measuredStatement = statement.replace(namedVersion, name => sourceNames.has(identifierKey(name)) ? " " : name);
  const given = figures(near), extra = [...figures(measuredStatement)].filter(figure => !given.has(figure));
  if (extra.length) reasons.push(`figures: ${extra.join(", ")} not in the source`);
  const license = unit.about?.role === "reference" && licenseCode(statement).license;
  if (license && !hasLicense(quote, license)) reasons.push(`reference license: ${license} is not in the bound excerpt`);
  const told = digits(body).replace(/\s+/gu, "").toLowerCase();
  for (const length of lengthsIn(statement)) if (!told.includes(length.phrase) && placed(body, length.figure)) { reasons.push(`role: "${length.phrase}" is a length, the source gives ${length.figure} as a place in a sequence (第${length.figure}…), not as a length`); break; }
  if (measuredSourceScope(statement, quote)?.conflict) reasons.push("scope: preserve the quoted audience, measured action and threshold together");
  reasons.push(...wikiUnitAssertionIssues(unit, near));
  return reasons;
}

/** Detail fragments are poor requirements even when they occur verbatim in a nearby sentence. */
export function wikiCompleteDetail(detail: string, statement: string): boolean {
  if (keepsDetail(statement, detail)) return true;
  const value = detail.normalize("NFKC").trim();
  return /[\p{L}\p{N}]/u.test(value) && !/^[，,。；;：:、]|[。！？]\s*\*{0,2}\s*\S|(?:后面|前面|右边|左边|上边|下面|旁边)?的\s*$/u.test(value)
    && (value.match(/\(/gu)?.length ?? 0) === (value.match(/\)/gu)?.length ?? 0)
    && (detail.match(/(?<!\\)[`]/gu)?.length ?? 0) % 2 === 0;
}

const STAGE_ORDER = /^(?:按|按照|严格\s*按|遵循|follow)\s*(Phase|Milestone|Stage)\s*(\d+)\s*[-–—~～至到]\s*(\d+)\s*(?:执行|实施)?\s*[：:]\s*(.+?)[。.]*$/iu;

function supportedStageOrder(statement: string, headings: readonly string[]) {
  const range = STAGE_ORDER.exec(statement);
  if (!range) return;
  const [, family, start, end, steps] = range;
  const names = wikiFlowSteps(steps).steps;
  if (names.length < 2 || names.length !== Number(end) - Number(start) + 1 || names.length > 16) return;
  const headingPattern = new RegExp(`^#{1,6}\\s+${family}\\s*(\\d+)\\s*[-–—：:]\\s*(.+?)\\s*$`, "iu");
  const actual = headings.flatMap((heading, index) => {
    const parts = headingPattern.exec(heading);
    return parts ? [{ number: Number(parts[1]), name: compare(parts[2]), index }] : [];
  });
  if (actual.length !== names.length || names.some((name, index) => actual[index].number !== Number(start) + index || actual[index].name !== compare(name))) return;
  return actual.at(-1)?.index;
}

export function wikiSourceBackedStageOrder(unit: WikiKnowledgeUnit) {
  return STAGE_ORDER.test(unit.statement)
    && supportedStageOrder(unit.statement,wikiDocumentBlocks(unit.evidence.quote).filter(block=>block.kind==="heading").map(block=>block.text))!==undefined;
}

/** Salvage a self-contained part of the existing quote. Markdown headings
 * after that part cannot supply missing terms, figures, or action examples. */
function localAssertionSpan(unit:WikiKnowledgeUnit) {
  const original=unit.evidence.quote;
  const headings=wikiDocumentBlocks(original).filter(block=>block.kind==="heading");
  if(!headings.length)return unit;
  const spans=[0,...headings.map(block=>block.start).filter(Boolean),original.length];
  const clauses=assertions(unit.statement);
  const operation=(text:string)=>[
    /删除|移除|\b(?:delete|remove)\b/iu.test(text),
    /换成|更换|替换|\b(?:replace|swap)\b/iu.test(text),
  ];
  const termsOf=(text:string)=>knowledgeTerms(text.replace(/(?:修改设计图|改图|修改图纸)/gu,"修改图")
    .replace(/真正|真的/gu,"确实").replace(/略深|变深/gu,"加深"));
  const candidates=spans.slice(0,-1).flatMap((start,index)=>{
    const quote=original.slice(start,spans[index+1]).trim().replace(/\n\s*---+\s*$/u,"").trim();
    if(quote.length<45||quote===original||FORBIDS.test(quote)&&!NEGATION.test(unit.statement))return [];
    const supported=termsOf(quote), knownNumbers=figures(quote), ops=operation(quote);
    const lines=quote.split(/\n|[。！？]/u).map(line=>termsOf(line));
    if(clauses.some(clause=>{
      const terms=termsOf(clause), own=operation(clause), names=clause.match(/\b[A-Za-z][\w+-]{2,}\b/gu)??[];
      const shared=[...terms].filter(word=>supported.has(word)).length;
      const local=Math.max(...lines.map(line=>[...terms].filter(word=>line.has(word)).length));
      const namedExamples=own.filter(Boolean).length===2&&ops.every(Boolean)&&/固定命令|\bfixed commands?\b/iu.test(quote);
      const coverage=/^(?:以|用于|to )/iu.test(clause)||namedExamples ? .28 : .42;
      return shared<2||local<2||shared/Math.max(1,terms.size)<coverage
        || names.some(name=>!compare(quote).includes(compare(name)))
        || [...figures(clause)].some(value=>!knownNumbers.has(value))
        || own.some((present,at)=>present&&!ops[at]);
    })||wikiUnitConditions(unit).some(condition=>!keepsDetail(quote,condition)))return [];
    const {code:_code,...evidence}=unit.evidence;
    void _code;
    const candidate={...unit,evidence:{...evidence,quote,section:messageSection(quote,quote)??unit.evidence.section}};
    return statementDrift(candidate,quote).length?[]:[candidate];
  });
  return candidates.length===1?candidates[0]:unit;
}

/** Try an intact section of the same original message before rejecting an assertion.
 * Require each clause and its figures in that section, and a unique matching home. */
export function reanchorWikiUnit(unit: WikiKnowledgeUnit, body: string, pendingLicense?: string): WikiKnowledgeUnit {
  if (unit.evidence.role !== "assistant" || unit.evidence.pasted || unit.adoption.status === "user_adopted" || !body) return unit;
  const original = unit.evidence.quote;
  const { license, clause } = licenseCode(unit.statement);
  if (!license && pendingLicense && unit.about?.role === "reference") {
    const excerpt = namedReferenceExcerpt(unit, body);
    if (excerpt && hasLicense(excerpt, pendingLicense)) {
      const zh = /\p{Script=Han}/u.test(unit.statement);
      const statement = unit.statement.replace(/[。.]$/u, "") + (zh ? `，采用 ${pendingLicense} 协议。` : `, licensed under ${pendingLicense}.`);
      const expanded = { ...unit, statement, evidence: { ...unit.evidence, quote: excerpt } };
      if (!statementDrift(expanded, body).length) return expanded;
    }
  }
  if (unit.about?.role === "reference" && license && clause?.index && !hasLicense(original, license)) {
    const excerpt = namedReferenceExcerpt(unit, body);
    if (excerpt && hasLicense(excerpt, license)) {
      const expanded = { ...unit, evidence: { ...unit.evidence, quote: excerpt } };
      if (!statementDrift(expanded, body).length) return expanded;
    }
    // An unverified trailing license does not erase the independently supported mechanism.
    const statement = unit.statement.slice(0, clause.index).trimEnd();
    const mechanism = { ...unit, statement: /[。.!?]$/u.test(statement) ? statement : statement + (clause.groups?.zh ? "。" : "."),
      details: unit.details.filter(detail => !detail.toLowerCase().includes(license.toLowerCase())) };
    if (statement.length > 16 && !statementDrift(mechanism, body).length) return mechanism;
  }
  const section = unit.evidence.section ?? (/^\s*#{1,6}\s/mu.test(original) ? messageSection(body, original) : undefined);
  const scoped = section ? { ...unit, evidence: { ...unit.evidence, section } } : unit;
  const issues=statementDrift(scoped,body);
  if(!issues.length)return unit;
  if(issues.every(issue=>issue.startsWith("assertion topic:"))){
    const local=localAssertionSpan(scoped);
    if(local!==scoped&&!statementDrift(local,body).length)
      return {...local,details:unit.details.filter(detail=>keepsDetail(local.evidence.quote,detail))};
  }
  const text = compare(unit.statement);
  const sections = wikiDocumentBlocks(body).filter(block => block.kind === "heading");
  const subject = knowledgeTerms(unit.subject), clauses = assertions(unit.statement);
  const overlap = (terms: ReadonlySet<string>, source: ReadonlySet<string>) => [...terms].filter(term => source.has(term)).length;
  const candidates = sections.flatMap((heading, index) => {
    const label = messageSection(heading.text, heading.text);
    if (!label) return [];
    const headingTerms = knowledgeTerms(label), named = overlap(subject, headingTerms);
    if (!named || named / Math.min(subject.size, headingTerms.size) < .6) return [];
    const depth = heading.text.match(/^#+/u)?.[0].length ?? 2;
    const next = sections.findIndex((other, at) => at > index && (other.text.match(/^#+/u)?.[0].length ?? 2) <= depth);
    const children = sections.slice(index + 1, next < 0 ? undefined : next);
    const lastStage = supportedStageOrder(unit.statement, children.map(child => child.text));
    const end = lastStage === undefined ? sections[next]?.start ?? body.length : children[lastStage].end;
    const quote = body.slice(heading.start, end).trimEnd().replace(/\n\s*---+\s*$/u, "").trimEnd();
    // Do not absorb the next independent heading or let a clipped cell supply a whole assertion.
    if (quote.length > (lastStage === undefined ? 1800 : 4200) || quote === original || body.indexOf(quote) !== body.lastIndexOf(quote)) return [];
    const normalized = compare(quote);
    const passages = assertions(quote).map(passage => ({ text: compare(passage), terms: knowledgeTerms(passage), figures: figures(passage), negative: NEGATION.test(passage) }));
    if (lastStage === undefined && !normalized.includes(text) && clauses.some(clause => {
      const key = compare(clause), terms = knowledgeTerms(clause);
      const properNames = clause.match(/\b[A-Za-z][A-Za-z\d_+-]{2,}\b/gu) ?? [];
      const values = [...figures(clause)], negative = NEGATION.test(clause);
      return !normalized.includes(key) && !passages.some(passage => {
        const shared = overlap(terms, passage.terms);
        return shared >= Math.min(2, terms.size) && shared / Math.max(1, terms.size) >= .58
          && properNames.every(name => passage.text.includes(compare(name))) && values.every(value => passage.figures.has(value))
          && negative === passage.negative;
      });
    })) return [];
    const { code: _code, section: _section, ...evidence } = unit.evidence;
    void _code; void _section;
    const code = messageCode(body, quote);
    const scoped = { ...unit, evidence: { ...evidence, quote, section: label, ...(code ? { code } : {}) } };
    if (wikiUnitConditions(unit).some(condition => !keepsDetail(quote, condition)) || statementDrift(scoped, body).length) return [];
    return [scoped];
  });
  if (candidates.length !== 1) return unit;
  const choice = candidates[0];
  return { ...choice, details: [...new Set([...unit.details.filter(detail => wikiCompleteDetail(detail, unit.statement)
    && keepsDetail(choice.evidence.quote, detail)), ...quotedDetails(choice.evidence.quote, unit.statement, false, false)])].slice(0, 8) };
}

/** A quote of several blocks opening or closing on blocks that share nothing with its statement (the compliance
 * paragraph before 「我的最终建议：先免费开放7天……」): those blocks go, so the quote is what states the point. Only when
 * a kept block plainly states it. The result is a slice of the quote, so it stays a span of the source. */
const STATES = .3;
export function trimmedQuote(statement: string, quote: string): string {
  const own = knowledgeTerms(statement);
  if (own.size < 3) return quote;
  const blocks: Array<{ start: number; end: number; shared: number; cover: number }> = [];
  for (const match of quote.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]*)*/gu)) {
    const text = match[0];
    if (!text.trim()) continue;
    const theirs = knowledgeTerms(text);
    let shared = 0; for (const term of own) if (theirs.has(term)) shared++;
    blocks.push({ start: match.index ?? 0, end: (match.index ?? 0) + text.length, shared, cover: shared / own.size });
  }
  if (blocks.length < 2 || !blocks.some(block => block.cover >= STATES)) return quote;
  let first = 0, last = blocks.length - 1;
  while (first < last && blocks[first].shared === 0) first++;
  while (last > first && blocks[last].shared === 0) last--;
  if (first === 0 && last === blocks.length - 1) return quote;
  return quote.slice(blocks[first].start, blocks[last].end).trim();
}

export const fidelitySignature = (unit: WikiKnowledgeUnit) => sourceMessageSignature(JSON.stringify([FIDELITY_RULES, unit.subject, unit.facet, unit.statement, unit.evidence.conversationId, unit.evidence.messageId, unit.evidence.evidenceId, unit.evidence.role, unit.evidence.section, unit.evidence.quote]));

export function withWikiLocalFidelity(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  let changed = false;
  const batches = ledger.batches.map(batch => {
    const recovered=new Map<string,WikiKnowledgeUnit>();
    const blocked = batch.units.flatMap(unit => {
      const prior = batch.fidelityResults?.[unit.id];
      if (prior?.version === FIDELITY_RULES && prior.signature === fidelitySignature(unit)) return [];
      const issues = wikiUnitAssertionIssues(unit);
      if(prior?.blocked&&prior.version===5&&issues.length&&issues.every(issue=>issue.startsWith("assertion topic:"))){
        const restored=reanchorWikiUnit(unit,unit.evidence.quote);
        if(restored!==unit){
          recovered.set(unit.id,restored);
          return [[unit.id,{version:FIDELITY_RULES,signature:fidelitySignature(restored)}] as const];
        }
      }
      if (prior?.blocked && prior.version < FIDELITY_RULES) return [[unit.id, { ...prior, version: FIDELITY_RULES, signature: fidelitySignature(unit) }] as const];
      return issues.length ? [[unit.id, { version: FIDELITY_RULES, signature: fidelitySignature(unit), remaining: issues.length, blocked: true as const }] as const] : [];
    });
    if (!blocked.length) return batch;
    changed = true;
    return { ...batch, units:recovered.size?batch.units.map(unit=>recovered.get(unit.id)??unit):batch.units,
      fidelityResults: { ...batch.fidelityResults, ...Object.fromEntries(blocked) } };
  });
  return changed ? { ...ledger, batches } : ledger;
}
