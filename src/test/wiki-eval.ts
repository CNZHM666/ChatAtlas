import { LEAVES_OUT } from "../shared/negation";
/** Wiki quality evaluation over an exported Markdown document. Deterministic text
 * rules only: the labelled cases carry the judgement, scoring never calls a model.
 * Used by `npm run eval:wiki` and by the synthetic regression test. */

export type WikiEvalCase =
  /** A conclusion's status: what the reader is told about adoption. */
  | { id: string; type: "adoption"; statement: string; expected: "decision" | "proposal" | "reported"; note?: string; needsReview?: boolean; findable?: boolean }
  /** One subject explained in one chapter: where it is a subtopic or a paragraph's subject, not every mention.
   * expectedChapter is a regex on the owning chapter's title, since titles differ from run to run (技术架构|技术实现). */
  | { id: string; type: "subject"; aliases: string[]; expectedChapter?: string; minShare?: number; note?: string }
  /** The same explanation should appear once. Each term is a regex; a paragraph matching all terms counts. */
  | { id: string; type: "duplicate"; terms: string[]; maxParagraphs?: number; note?: string }
  /** A number, condition, identifier or exception that must survive. */
  /** findable: kept in the document or, with a ledger, in the knowledge units one step away. */
  | { id: string; type: "detail"; pattern: string; note?: string; findable?: boolean }
  /** Wording the sources do not support. */
  | { id: string; type: "forbidden"; pattern: string; note?: string }
  /** A replaced decision told as current beside the one that replaced it. Each is a regex; it fails when both are
   * in the prose and no sentence telling the stale one marks it as earlier or replaced. */
  | { id: string; type: "conflict"; current: string; stale: string; note?: string }
  /** Directory shape. */
  | { id: string; type: "structure"; chapters?: [number, number]; maxSubtopics?: number; forbiddenChapterTitles?: string; note?: string };

export interface WikiEvalCases { version: 1; document: string; cases: WikiEvalCase[] }
/** presence: a duplicate case's explanation appears at all; kept apart so repetition and loss are scored separately.
 * hygiene: checks every document gets without labelling (leaked ids, repeated sentences, statuses added at the end). */
export interface WikiEvalResult { id: string; type: WikiEvalCase["type"] | "presence" | "hygiene" | "reader"; pass: boolean; detail: string; needsReview?: boolean }
export interface WikiEvalRun { requests?: number; inputTokens?: number; outputTokens?: number; elapsedSeconds?: number }
export interface WikiEvalReport {
  results: WikiEvalResult[];
  byType: Record<string, { passed: number; total: number }>;
  /** Share of passed cases, 0–10: each case counts once. A mean of per-type rates let one conflict case swing the
   * score by 1.1 (a run passing 74 cases scored below one passing 67). Unreviewed adoption cases are excluded. */
  score: number;
  /** The earlier mean of per-type pass rates, 0–10, kept to compare with scores before the change. */
  typeScore: number;
  shape: { chapters: number; subtopics: number; maxSubtopics: number; averageSubtopicCharacters: number; characters: number };
  /** Share of prose paragraphs carrying a source footnote; reported, not scored (formats differ). */
  sourcedParagraphs: number;
  /** Status qualifiers ("AI 建议…", "讨论建议…") per 1000 visible characters: lower reads cleaner. */
  qualifiersPer1000: number;
  /** Explanation groups in the draft the ledger carries: reported, not scored. */
  groups?: ReturnType<typeof wikiGroupMetrics>;
  run?: WikiEvalRun;
}

interface Chapter { title: string; subtopics: string[]; paragraphs: string[]; keyLines: string[]; characters: number }
const visible = (text: string) => Array.from(text.replace(/\s+/gu, "")).length;
// Chinese text spaces Latin words inconsistently ("5 个" / "5个"): a space in a case matches any or none.
const spaced = (source: string) => source.replace(/ /gu, "\\s*");
const pattern = (source: string) => new RegExp(spaced(source), "iu");
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
import { knowledgeTerms } from "../shared/knowledge-subject";
import { assistantRequest, wikiGroupMetrics } from "../shared/wiki-knowledge";
import { statusClashes } from "../ai/wiki-draft-checks";
const sentencesOf = (text: string) => text.split(/(?:(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))/u).map(sentence => sentence.trim()).filter(sentence => sentence.length >= 20);
const sameSentence = (first: string, second: string) => {
  const a = knowledgeTerms(first), b = knowledgeTerms(second);
  return a.size >= 6 && b.size >= 6 && [...a].filter(term => b.has(term)).length / Math.min(a.size, b.size) >= .8;
};
/** Where a paragraph names something outside a list: the offsets, by sentence. A name with 、 next to it
 * (within a few characters) is one item of a list. */
function namedAt(paragraph: string, aliases: string[]) {
  return paragraph.split(/(?<=[。！？])/u).flatMap((sentence, index) => aliases.flatMap(alias => [...sentence.matchAll(new RegExp(literal(alias), "giu"))].flatMap(match => {
    const at = match.index ?? 0, around = sentence.slice(Math.max(0, at - 3), at) + sentence.slice(at + match[0].length, at + match[0].length + 3);
    return around.includes("、") ? [] : [{ sentence: index, at }];
  })));
}
/** A paragraph about a subject: it names the subject near the start of its first sentence, or twice. */
export function aboutName(paragraph: string, aliases: string[]) {
  const found = namedAt(paragraph, aliases);
  return found.some(item => item.sentence === 0 && item.at <= 30) || found.length >= 2;
}
const LEAKED_ID =/(?<![A-Za-z\d])k\d+(?![A-Za-z\d])/u;
const RETRACTION = /尚未确定|未确定|尚未决定|待确认|未见采纳/u, ASSERTED = /采用|必须|需要|应当|应该|决定|确定/u;
/** "这一定位明确了…", "这两者并存，前者…", "询问…是否…": a comment on the text, the question, or what a point achieves. */
const REMARK = /^(?:这(?:一|种|个)(?:决定|原则|定位|方向|设计|机制|方案|价值主张|约束|策略)[^。！？]{0,20}?(?:确立了|明确了|确保了|旨在|体现了|回应了|奠定了)|这(?:两|几)者(?:并存|中)|前者为|(?:用户)?(?:询问|质疑|提问)[^。！？]{0,60}(?:是否|差异|优劣|吗))/u;
const UNSETTLED = /未见(?:用户)?采纳|尚未确定|尚未决定/u, SETTLED = /(?<![未不待尚难无])(?:确定|决定)(?![性因])/u, TAGGED = /[（(](?:未见采纳|尚未确定|未确定|待确认|未采纳)[)）]/u;
/** Checks that need no labels: unit ids leaked into prose, the same sentence repeated within
 * a chapter, and statuses added after an assertion ("采用…，但尚未确定"). */
function hygiene(chapters: Chapter[]): WikiEvalResult[] {
  const leaked = chapters.flatMap(chapter => chapter.paragraphs).filter(part => LEAKED_ID.test(part)).length;
  let sentences = 0, repeated = 0;
  for (const chapter of chapters) {
    const own = chapter.paragraphs.flatMap(sentencesOf);
    sentences += own.length;
    repeated += own.filter((sentence, index) => own.some((other, at) => at !== index && sameSentence(sentence, other))).length;
  }
  const retracted = chapters.flatMap(chapter => chapter.paragraphs.flatMap(sentencesOf)).filter(sentence => { const at = sentence.search(RETRACTION); return at > 12 && ASSERTED.test(sentence.slice(0, at)); }).length;
  const share = sentences ? repeated / sentences : 0;
  // One sentence both settling and unsettling a point ("方案（未见采纳）确定…"), or a bracketed status tag.
  const contradictory = chapters.flatMap(chapter => chapter.paragraphs.flatMap(sentencesOf)).filter(sentence => TAGGED.test(sentence) || UNSETTLED.test(sentence) && SETTLED.test(sentence.replace(UNSETTLED, ""))).length;
  // Status said in words beside its mark reads as noise: at most one such word per 2000 characters.
  const prose = chapters.flatMap(chapter => chapter.paragraphs).join("\n"), proseCharacters = visible(prose);
  const qualifierRate = proseCharacters ? Math.round((prose.match(QUALIFIER) ?? []).length / proseCharacters * 1000 * 100) / 100 : 0;
  // A paragraph broken off mid-sentence: it ends on a clause mark or an ellipsis.
  const broken = chapters.flatMap(chapter => chapter.paragraphs).filter(part => /[；;，,、]$|……|…$/u.test(part.trim())).length;
  // The writer talking about its own text or the point it just made rather than the project.
  const remarks = chapters.flatMap(chapter => chapter.paragraphs.flatMap(sentencesOf)).filter(sentence => REMARK.test(sentence)).length;
  return [
    { id: "H1", type: "hygiene", pass: leaked === 0, detail: leaked ? `${leaked} paragraphs show unit ids` : "no leaked ids" },
    { id: "H2", type: "hygiene", pass: share <= .02, detail: `${repeated} of ${sentences} sentences repeat another in their chapter` },
    { id: "H3", type: "hygiene", pass: retracted <= 2, detail: `${retracted} sentences assert first and qualify at the end` },
    { id: "H4", type: "hygiene", pass: contradictory <= 1, detail: `${contradictory} sentences call a point both settled and unsettled or use a status tag` },
    { id: "H5", type: "hygiene", pass: broken === 0, detail: `${broken} paragraphs break off mid-sentence` },
    { id: "H6", type: "hygiene", pass: remarks <= 2, detail: `${remarks} sentences remark on the text instead of the project` },
    { id: "H7", type: "hygiene", pass: qualifierRate <= .5, detail: `${qualifierRate} status or holder words per 1000 characters of prose` },
  ];
}
/** How a sentence marks what it tells as no longer current. */
const EARLIER = /此前|早期|早先|曾(?:提出|建议|计划|考虑)|后(?:来)?改为|已被|被(?:替代|取代|放弃)|不再|旧方案|原方案/u;
// Status or holder wording in the prose: status has one expression, the mark after the sentence.
const QUALIFIER = /AI\s?建议|讨论建议|AI\s?推荐|AI\s?认为|未发现用户确认|(?:提供的)?资料(?:还|也)?提出|分析(?:还)?指出|据(?:资料|讨论|用户提供)|用户(?:还)?提出[：:]/gu;
/** A status mark after a sentence ("。〔已定〕"), moved inside it so the sentence carries its own mark when split. */
const MARK_AFTER = /([。！？])(〔(?:已定|未定|此前|你|资料)(?: · [^〕]+)?〕)/gu;
const withMarksInside = (text: string) => text.replace(MARK_AFTER, "$2$1");
// Plain 决定/确定 is how a decision is written ("决定优先实现…"); 未决定, 不确定, 决定性 are not decisions.
const DECISION = /当前决定|用户决定|用户采纳|已确定|(?:决定|确定)采用|用户(?:已|明确)?(?:确认|决定)采用|(?<![未不待尚难无设])(?:决定|确定|定为|选定)(?![性因])/u;
// The writer also says "AI 曾建议 / AI 曾提出 / AI 还建议" for a proposal, and "用户提供的材料指出" for what pasted material reports.
const PROPOSAL = /AI\s?(?:曾|还|另)?(?:建议|提出|推荐)|讨论建议|建议\s?·|未发现用户确认|未见用户采纳/u;
const REPORTED = /用户报告|据用户反馈|据用户提供|(?:根据)?用户提供的(?:材料|审查|资料|导出|记录)(?:指出|显示|表明|说明|中|称)/u;

/** Chapters of an export: `## ` chapters (not the overview or the source index),
 * `### ` subtopics, prose paragraphs, and the key-conclusion lines. */
export function exportChapters(markdown: string): Chapter[] {
  const body = markdown.split(/\n## (?:来源索引|Source index)\n/u)[0];
  return body.split(/\n## /u).slice(1).map(block => {
    const [title, ...rest] = block.split("\n");
    const text = rest.join("\n").replace(/^```[\s\S]*?^```/gmu, "");
    const subtopics = [...text.matchAll(/^### (.+)$/gmu)].map(match => match[1].trim());
    const keyLines = text.split("\n").filter(line => /^- \*\*[^*]+\*\*：/u.test(line));
    // A folded section's <details> and <summary> lines are layout, not prose. A table's rows are prose: each body row
    // reads as one statement ("本地全文搜索 P95，< 500ms，已预热。"); its header and rule are layout.
    const tableRows = (part: string) => part.split("\n").slice(1).filter(line => /^\|/u.test(line) && !/^\|[\s:|-]+\|?$/u.test(line))
      .map(line => `${line.replace(/^\||\|$/gu, "").split(/(?<!\\)\|/u).map(cell => cell.trim()).filter(cell => cell && cell !== "-").join("，")}。`);
    const paragraphs = text.split(/\n\s*\n/u).map(part => part.trim()).flatMap(part => /^\|/u.test(part) ? tableRows(part) : [part]).filter(part => part && !/^(?:#|>|- \*\*(?:本章来源|关键结论与来源|Chapter sources|Key conclusions)|\*\*(?:本章来源|关键结论与来源|演变记录|Chapter sources|Key conclusions)| {2}-|<\/?(?:details|summary)\b)/u.test(part));
    return { title: title.trim(), subtopics, paragraphs, keyLines, characters: paragraphs.reduce((sum, part) => sum + visible(part), 0) };
  }).filter(chapter => !/^(?:项目总览|Project overview)$/iu.test(chapter.title));
}

type Ledger = import("../shared/wiki-knowledge").WikiKnowledgeLedger;
type Unit = import("../shared/wiki-knowledge").WikiKnowledgeUnit;
const unitText = (unit: Unit) => [unit.statement, unit.evidence.quote, ...unit.details].join("\n");
/** The ledger's reading of an adoption case: decided, reported or only proposed. */
function ledgerAdoption(units: Unit[], item: Extract<WikiEvalCase, { type: "adoption" }>) {
  const matches = units.filter(unit => pattern(item.statement).test(unitText(unit)));
  const decided = matches.filter(unit => unit.adoption.status === "user_decision" || unit.adoption.status === "user_adopted").length;
  const reported = matches.filter(unit => unit.delivery === "user_reported").length;
  const pass = matches.length > 0 && (item.expected === "decision" ? decided > 0 : item.expected === "reported" ? reported > 0 : decided === 0);
  return { pass, detail: matches.length ? `${matches.length} units: ${decided} decided, ${reported} reported` : "no unit" };
}

type Reading = "decision" | "reported" | "proposal" | "unlabelled";
// A mark says the status first; prose wording is read only where no mark is.
const reading = (label: string): Reading => /〔已定(?: · [^〕]+)?〕/u.test(label) ? "decision" : /〔(?:资料|你)(?: · [^〕]+)?〕/u.test(label) ? "reported" : /〔(?:未定|此前)(?: · [^〕]+)?〕/u.test(label) ? "proposal"
  : DECISION.test(label) ? "decision" : REPORTED.test(label) ? "reported" : PROPOSAL.test(label) ? "proposal" : "unlabelled";
// What contradicts each expectation. An unlabelled mention never does, and a reported point
// may also be discussed as a proposal elsewhere.
const CONTRADICTS: Record<Extract<WikiEvalCase, { type: "adoption" }>["expected"], Reading[]> = { decision: ["proposal"], reported: ["decision"], proposal: ["decision", "reported"] };

/** A point mentioned many times is judged on every mention: at least one states the
 * expected status (for a proposal, an unlabelled mention is enough) and none contradicts it. */
function adoption(chapters: Chapter[], item: Extract<WikiEvalCase, { type: "adoption" }>, ledger?: Ledger): WikiEvalResult {
  const statement = pattern(item.statement);
  // Key-conclusion lines state status in their label; prose sentences in their own wording.
  const labels = [
    ...chapters.flatMap(chapter => chapter.keyLines).filter(line => statement.test(line)).map(line => line.slice(0, line.indexOf("："))),
    ...chapters.flatMap(chapter => chapter.paragraphs.flatMap(part => withMarksInside(part).split(/(?<=[。！？])/u))).filter(text => statement.test(text)),
  ];
  if (!labels.length && item.findable && ledger) { const found = ledgerAdoption(ledger.batches.flatMap(batch => batch.units), item); return { id: item.id, type: "adoption", pass: found.pass, detail: `not in the document; ledger: ${found.detail}`, ...(item.needsReview ? { needsReview: true } : {}) }; }
  if (!labels.length) return { id: item.id, type: "adoption", pass: false, detail: "statement not found", ...(item.needsReview ? { needsReview: true } : {}) };
  const reads = labels.map(reading), counts = new Map<Reading, number>();
  for (const read of reads) counts.set(read, (counts.get(read) ?? 0) + 1);
  const states = reads.some(read => read === item.expected || item.expected === "proposal" && read === "unlabelled");
  const pass = states && !reads.some(read => CONTRADICTS[item.expected].includes(read));
  return { id: item.id, type: "adoption", pass, detail: `read as ${[...counts].map(([read, count]) => `${read} ×${count}`).join(", ")}`, ...(item.needsReview ? { needsReview: true } : {}) };
}

function structure(item: Extract<WikiEvalCase, { type: "structure" }>, chapters: Array<{ title: string; subtopics: number }>): WikiEvalResult {
  const problems: string[] = [];
  if (item.chapters && (chapters.length < item.chapters[0] || chapters.length > item.chapters[1])) problems.push(`${chapters.length} chapters`);
  const crowded = chapters.filter(chapter => item.maxSubtopics !== undefined && chapter.subtopics > item.maxSubtopics);
  if (crowded.length) problems.push(`over ${item.maxSubtopics} subtopics: ${crowded.map(chapter => chapter.title).join(", ")}`);
  const forbidden = item.forbiddenChapterTitles ? chapters.filter(chapter => pattern(item.forbiddenChapterTitles!).test(chapter.title)) : [];
  if (forbidden.length) problems.push(`unowned chapters: ${forbidden.map(chapter => chapter.title).join(", ")}`);
  return { id: item.id, type: "structure", pass: !problems.length, detail: problems.join("; ") || "ok" };
}

/** What a reader continuing the work checks, without labelling: the passed cases alone gave an incomplete run (six of 36
 * batches unread) 8.1 against a reviewer's 6.5. */
const INCOMPLETE = /整理不完整|整理完整性部分完成|关键检查未通过\s*[1-9]/u, INCOMPLETE_CAP = 6;
const LEAVES = new RegExp(String.raw`${LEAVES_OUT}[：:]?\s*([^。；;，,\n|]+)`, "gu");
const GENERIC_ITEM = /^(?:场景|扩展|功能|系统|模型|服务|管理|数据|工具|平台|设计|开发|生成|识别|社区|代码|项目)$/u;
// "不做：不修改核心 IndexedDB、搜索" keeps code as it is; it leaves out no feature. A qualifier stays: "大型知识图谱" left out is
// not "知识图谱".
const itemsLeftOut = (text: string) => [...text.matchAll(LEAVES)].filter(match => !/^(?:不)?(?:修改|删除|增加|改动|重写|破坏|动)/u.test(match[1].trim())).flatMap(match => match[1].split(/[、/，,]|或|以及|及|和|与/u))
  .map(part => part.replace(/\*\*|`/gu, "").trim().replace(/^(?:开发|实现|支持|实时|任何)/u, "").replace(/等(?:功能)?$/u, "").trim()).filter(part => part.length >= 2 && part.length <= 16 && !GENERIC_ITEM.test(part));
/** An item named in a sentence with no leaving word just before it ("禁止涉及 PCB" leaves it out; "提供比价推荐" puts it in). */
const putsIn = (sentence: string, item: string) => {
  const at = sentence.toLocaleLowerCase().indexOf(item.toLocaleLowerCase());
  // Inside the sentence's own list of what it leaves out ("禁止涉及 PCB、STM32、高压电路等") it is left out there too.
  const inLeft = [...sentence.matchAll(LEAVES)].some(match => at >= (match.index ?? 0) && at < (match.index ?? 0) + match[0].length);
  // Or left out after it: "知识图谱和复杂 Agent 不在本阶段范围内".
  const after = sentence.slice(at + item.length, at + item.length + 16);
  return at >= 0 && !inLeft && !/(?:不|禁止|暂缓|暂不|无|未|非|免)[^，,。；;]{0,8}$/u.test(sentence.slice(0, at)) && !/^[^，,。；;]{0,12}(?:不在|不纳入|不属于|暂不|不做|除外|被排除)/u.test(after);
};
function readerChecks(markdown: string, chapters: Chapter[]): WikiEvalResult[] {
  // A mark follows its sentence's 。 ("……功能。〔已定〕"): it stays with that sentence.
  const sentences = chapters.flatMap(chapter => chapter.paragraphs.flatMap(part => part.split(/(?<=[。！？](?:〔[^〕]+〕)?)(?!〔)|\n/u))).map(sentence => sentence.trim()).filter(Boolean);
  const leftOut = [...new Set(sentences.flatMap(itemsLeftOut))];
  // A decided point putting in what another sentence leaves out: the reader cannot tell which holds now.
  const decided = sentences.filter(sentence => /〔已定(?: · [^〕]+)?〕/u.test(sentence)).map(sentence => sentence.replace(/〔[^〕]+〕/gu, ""));
  const clashes = decided.flatMap(sentence => leftOut.filter(item => putsIn(sentence, item)).map(item => `${item}: ${sentence.slice(0, 30)}`));
  const status = chapters.map(chapter => ({ id: chapter.title, title: chapter.title, question: "", group: "", body: chapter.paragraphs.join("\n\n"), problems: [] as string[], paragraphs: chapter.paragraphs.map(text => ({ subtopic: "", text, unitIds: [] })) }));
  const told = statusClashes(status);
  // The current baseline: no instruction to an AI, and no completion criterion needing what is left out now.
  const baseline = markdown.match(/### (?:当前基线|Current baseline)\n([\s\S]*?)(?=\n### |\n## |$)/u)?.[1] ?? "";
  const part = (label: RegExp) => (baseline.split(/\n(?=\*\*)/u).find(block => label.test(block)) ?? "").split("\n").filter(line => line.startsWith("- ")).map(line => line.slice(2).replace(/〔[^〕]+〕/gu, ""));
  const lines = baseline.split("\n").filter(line => line.startsWith("- ")).map(line => line.slice(2));
  const instructions = lines.filter(line => assistantRequest(line.replace(/〔[^〕]+〕/gu, "")));
  const outNow = part(/^\*\*(?:暂不做|Not now)/u).flatMap(itemsLeftOut).flatMap(item => [item, ...(/\p{Script=Han}{2}$/u.test(item) && !GENERIC_ITEM.test(item.slice(-2)) ? [item.slice(-2)] : [])]);
  const beyond = part(/^\*\*(?:完成标准|Done when)/u).filter(line => outNow.some(item => line.toLocaleLowerCase().includes(item.toLocaleLowerCase())));
  // A sentence cut inside its quotation: a mark before the closing quote ("硬件？〔已定〕”"), or a line or listed item
  // starting on one ("- ”，中央为大输入框。").
  const broken = (markdown.match(/〔[^〕]+〕[”」]|(?:^|\n)(?:- )?[”」]/gu) ?? []).length;
  return [
    { id: "RC6", type: "reader", pass: !broken, detail: broken ? `${broken} sentences cut inside their quotation` : "no sentence cut inside a quotation" },
    { id: "RC1", type: "reader", pass: !INCOMPLETE.test(markdown), detail: INCOMPLETE.test(markdown) ? `the document says it is incomplete or failed a key check; score capped at ${INCOMPLETE_CAP}` : "complete" },
    { id: "RC2", type: "reader", pass: !clashes.length, detail: clashes.length ? `${clashes.length} decided points put in what another sentence leaves out (${clashes.slice(0, 6).join(" | ")})` : "no decided point against a left-out item" },
    { id: "RC3", type: "reader", pass: !told, detail: told ? `${told} names told both as to come and as done` : "no name told as to come and as done" },
    { id: "RC4", type: "reader", pass: !instructions.length, detail: instructions.length ? `the baseline lists an instruction to an AI: ${instructions[0].slice(0, 30)}…` : "no instruction in the baseline" },
    { id: "RC5", type: "reader", pass: !beyond.length, detail: beyond.length ? `a completion criterion needs what is left out now: ${beyond[0].slice(0, 30)}…` : "completion criteria within the current scope" },
  ];
}

export function scoreWikiEvaluation(markdown: string, cases: WikiEvalCases, run?: WikiEvalRun, ledger?: Ledger): WikiEvalReport {
  const chapters = exportChapters(markdown);
  const all = chapters.flatMap(chapter => chapter.paragraphs).join("\n\n");
  const results = cases.cases.flatMap((item): WikiEvalResult | WikiEvalResult[] => {
    switch (item.type) {
      case "adoption": return adoption(chapters, item, ledger);
      case "subject": {
        // Where the subject is explained: a subtopic named after it (counted twice) or a paragraph about it.
        // Passing mentions are not counted: one late in a sentence, or one item of a 、 list.
        const names = item.aliases.map(alias => new RegExp(literal(alias), "iu")), named = (text: string) => names.some(name => name.test(text));
        const counts = chapters.map(chapter => chapter.subtopics.filter(named).length * 2 + chapter.paragraphs.filter(part => aboutName(part, item.aliases)).length);
        const total = counts.reduce((sum, count) => sum + count, 0), top = counts.indexOf(Math.max(...counts));
        const share = total ? counts[top] / total : 0, minShare = item.minShare ?? .6;
        const owner = chapters[top]?.title ?? "";
        const pass = total > 0 && share >= minShare && (!item.expectedChapter || pattern(item.expectedChapter).test(owner));
        return { id: item.id, type: "subject", pass, detail: total ? `${Math.round(share * 100)}% in 「${owner}」 across ${counts.filter(Boolean).length} chapters` : "subject not found" };
      }
      case "duplicate": {
        const terms = item.terms.map(pattern), max = item.maxParagraphs ?? 1;
        const matches = chapters.flatMap(chapter => chapter.paragraphs).filter(part => terms.every(term => term.test(part))).length;
        // Repetition and absence are different failures: a missing explanation is not a repeated one.
        return [
          { id: item.id, type: "duplicate", pass: matches <= max, detail: matches ? `${matches} paragraphs explain it` : "not explained" },
          { id: item.id, type: "presence", pass: matches > 0, detail: matches ? "explained" : "explanation missing" },
        ];
      }
      case "detail": {
        const found = pattern(item.pattern).test(all) || chapters.some(chapter => chapter.keyLines.some(line => pattern(item.pattern).test(line)));
        const inLedger = !found && item.findable && ledger?.batches.some(batch => batch.units.some(unit => pattern(item.pattern).test(unitText(unit))));
        return { id: item.id, type: "detail", pass: found || Boolean(inLedger), detail: found ? "kept" : inLedger ? "in the ledger" : "missing" };
      }
      case "forbidden": {
        const hits = (all.match(new RegExp(spaced(item.pattern), "giu")) ?? []).length;
        return { id: item.id, type: "forbidden", pass: hits === 0, detail: hits ? `${hits} occurrences` : "absent" };
      }
      case "structure": return structure(item, chapters.map(chapter => ({ title: chapter.title, subtopics: chapter.subtopics.length })));
      case "conflict": {
        const sentences = chapters.flatMap(chapter => chapter.paragraphs.flatMap(part => part.split(/(?<=[。！？])/u)));
        const current = sentences.some(text => pattern(item.current).test(text)), stale = sentences.filter(text => pattern(item.stale).test(text));
        const unmarked = stale.filter(text => !EARLIER.test(text)).length;
        return { id: item.id, type: "conflict", pass: !(current && unmarked), detail: !current ? "current decision not stated" : unmarked ? `${unmarked} sentences tell the replaced one as current` : "replaced one marked or absent" };
      }
    }
  });
  results.push(...hygiene(chapters), ...readerChecks(markdown, chapters));
  const byType: WikiEvalReport["byType"] = {};
  for (const result of results) {
    if (result.needsReview) continue;
    const row = byType[result.type] ??= { passed: 0, total: 0 };
    row.total++; if (result.pass) row.passed++;
  }
  const rates = Object.values(byType).map(row => row.passed / row.total);
  const subtopics = chapters.map(chapter => chapter.subtopics.length), characters = chapters.reduce((sum, chapter) => sum + chapter.characters, 0);
  const qualifiers = (all.match(QUALIFIER) ?? []).length;
  return {
    results, byType,
    // A document that says it is incomplete is scored at most INCOMPLETE_CAP, however many cases it passes.
    score: (score => INCOMPLETE.test(markdown) ? Math.min(INCOMPLETE_CAP, score) : score)((total => total ? Math.round(Object.values(byType).reduce((sum, row) => sum + row.passed, 0) / total * 100) / 10 : 0)(Object.values(byType).reduce((sum, row) => sum + row.total, 0))),
    typeScore: rates.length ? Math.round(rates.reduce((sum, rate) => sum + rate, 0) / rates.length * 100) / 10 : 0,
    shape: { chapters: chapters.length, subtopics: subtopics.reduce((sum, count) => sum + count, 0), maxSubtopics: Math.max(0, ...subtopics), averageSubtopicCharacters: subtopics.some(Boolean) ? Math.round(characters / subtopics.reduce((sum, count) => sum + count, 0)) : 0, characters },
    qualifiersPer1000: characters ? Math.round(qualifiers / characters * 1000 * 100) / 100 : 0,
    sourcedParagraphs: (paragraphs => paragraphs.length ? Math.round(paragraphs.filter(part => /\[\^\d+\]/u.test(part)).length / paragraphs.length * 100) / 100 : 0)(chapters.flatMap(chapter => chapter.paragraphs)),
    ...(ledger?.organization?.groups?.length && ledger.draft ? { groups: wikiGroupMetrics(ledger) } : {}),
    ...(run ? { run } : {}),
  };
}

/** P1 gate: the knowledge-unit ledger alone, before any document is written from it.
 * Adoption and detail cases apply; the rest need a document. */
export interface WikiLedgerReport {
  results: WikiEvalResult[];
  byType: Record<string, { passed: number; total: number }>;
  units: number; materials: number; coveredMaterials: number; coverage: number;
  adoption: Record<string, number>; reported: number; pastedUnits: number; failedBatches: number;
  rejected: Record<string, number>;
  /** Redesign P2, when the ledger carries an organization. */
  organization?: { subjects: number; chapters: number; subtopics: number; mergedUnits: number; relations: number; unresolved: number; report: Record<string, number> };
}
export function scoreWikiLedger(ledger: import("../shared/wiki-knowledge").WikiKnowledgeLedger, cases: WikiEvalCases): WikiLedgerReport {
  const units = ledger.batches.flatMap(batch => batch.units), plan = ledger.organization;
  const subjectChapter = new Map(plan?.chapters.flatMap(chapter => chapter.subtopics.flatMap(topic => topic.subjectIds.map(id => [id, chapter.title] as const))) ?? []);
  const chapterOf = new Map(plan?.subjects.flatMap(subject => subject.unitIds.flatMap(id => subjectChapter.has(subject.id) ? [[id, subjectChapter.get(subject.id)!] as const] : [])) ?? []);
  const live = new Set(plan ? plan.subjects.flatMap(subject => subject.unitIds) : []);
  const text = (unit: typeof units[number]) => [unit.statement, unit.evidence.quote, ...unit.details].join("\n");
  const results: WikiEvalResult[] = [];
  for (const item of cases.cases) {
    if (item.type === "adoption") {
      const matches = units.filter(unit => pattern(item.statement).test(text(unit)));
      const decided = matches.filter(unit => unit.adoption.status === "user_decision" || unit.adoption.status === "user_adopted").length;
      const reported = matches.filter(unit => unit.delivery === "user_reported").length;
      const pass = matches.length > 0 && (item.expected === "decision" ? decided > 0 : item.expected === "reported" ? reported > 0 : decided === 0);
      results.push({ id: item.id, type: "adoption", pass, detail: matches.length ? `${matches.length} units: ${decided} decided, ${reported} reported` : "no unit", ...(item.needsReview ? { needsReview: true } : {}) });
    } else if (item.type === "detail") {
      const found = units.some(unit => pattern(item.pattern).test(text(unit)));
      results.push({ id: item.id, type: "detail", pass: found, detail: found ? "kept" : "missing" });
    } else if (plan && item.type === "subject") {
      // Units naming the subject, by the chapter their subject lives in; an unplaced subject counts against the share.
      const names = item.aliases.map(alias => new RegExp(literal(alias), "iu"));
      const counts = new Map<string, number>();
      for (const unit of units) if (live.has(unit.id) && names.some(name => name.test(`${unit.subject}\n${unit.statement}`))) { const chapter = chapterOf.get(unit.id) ?? "(unplaced)"; counts.set(chapter, (counts.get(chapter) ?? 0) + 1); }
      const total = [...counts.values()].reduce((sum, count) => sum + count, 0), [owner, top] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
      const share = total ? top / total : 0, pass = total > 0 && owner !== "(unplaced)" && share >= (item.minShare ?? .6) && (!item.expectedChapter || pattern(item.expectedChapter).test(owner));
      results.push({ id: item.id, type: "subject", pass, detail: total ? `${Math.round(share * 100)}% of ${total} units in 「${owner}」 across ${counts.size} chapters` : "subject not found" });
    } else if (plan && item.type === "structure") results.push(structure(item, plan.chapters.map(chapter => ({ title: chapter.title, subtopics: chapter.subtopics.length }))));
  }
  const byType: WikiLedgerReport["byType"] = {};
  for (const result of results) { if (result.needsReview) continue; const row = byType[result.type] ??= { passed: 0, total: 0 }; row.total++; if (result.pass) row.passed++; }
  const adoption: Record<string, number> = {}, rejected: Record<string, number> = {};
  for (const unit of units) adoption[unit.adoption.status] = (adoption[unit.adoption.status] ?? 0) + 1;
  for (const batch of ledger.batches) for (const [reason, count] of Object.entries(batch.rejected)) rejected[reason] = (rejected[reason] ?? 0) + count;
  const covered = new Set(units.map(unit => unit.evidence.evidenceId)).size;
  return { results, byType, units: units.length, materials: ledger.materials, coveredMaterials: covered, coverage: ledger.materials ? Math.round(covered / ledger.materials * 100) / 100 : 0, adoption, reported: units.filter(unit => unit.delivery === "user_reported").length, pastedUnits: units.filter(unit => unit.evidence.pasted).length, failedBatches: ledger.batches.filter(batch => batch.status === "failed").length, rejected,
    ...(plan ? { organization: { subjects: plan.subjects.length, chapters: plan.chapters.length, subtopics: plan.chapters.reduce((sum, chapter) => sum + chapter.subtopics.length, 0), mergedUnits: plan.merged.reduce((sum, row) => sum + row.from.length, 0), relations: plan.relations.length, unresolved: plan.relations.filter(relation => relation.status === "unresolved").length, report: plan.report } } : {}) };
}
