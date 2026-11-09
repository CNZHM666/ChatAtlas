import type { LearningRole, WikiDocumentType } from "./wiki-document-type";
import { knowledgeTerms } from "./knowledge-subject";
/** Knowledge-unit ledger (redesign P1). Produced next to the Wiki behind a
 * developer switch; nothing reads it into the document yet. */

export type WikiUnitKind = "mechanism" | "decision" | "constraint" | "fact" | "question" | "plan" | "report" | "history";
/** user_decision: the user states the choice; user_adopted: the user accepts an
 * assistant proposal in a later reply; proposal: only the assistant proposes. */
export type WikiUnitAdoption = "user_decision" | "user_adopted" | "rejected" | "proposal" | "unknown";

export interface WikiKnowledgeUnit {
  /** Stable across runs: original message, quotation and subject, never wording. */
  id: string;
  subject: string;
  facet?: string;
  statement: string;
  kind: WikiUnitKind;
  /** Numbers, versions, modes, identifiers and exceptions copied from the original. */
  details: string[];
  /** conversationSpan: when its conversation was held, by the platform's own times (wikiSaidLater reads it). */
  evidence: { evidenceId: string; conversationId: string; messageId: string; messageIndex: number; role: "user" | "assistant"; pasted: boolean; quote: string; conversationSpan?: WikiConversationSpan; /** The heading its quote stands under in its message (首页 Header), when the statement does not name it. */ section?: string; /** The code block its quote stands in or introduces (a file tree, a schema), as written. */ code?: { language: string; text: string }; /** A learning record's exercise: code the learner wrote, in their message or quoted back by the AI marking it. */ learnerCode?: true; /** The AI's review of that exercise, from the message quoting it: what it said of the code, and the code it gave instead. */ review?: { said: string; code?: { language: string; text: string }; /** A block the AI's words lead into ("这样不行，因为："). */ shows?: { language: string; text: string } }; /** The task the exercise answers, as the AI set it: its rule, and the data it gave. */ task?: { said: string; code?: { language: string; text: string } } };
  adoption: { status: WikiUnitAdoption; approval?: { evidenceId: string; messageId: string; quote: string } };
  delivery: "unknown" | "planned" | "user_reported";
  relation?: { kind: "replaces" | "narrows" | "supplements" | "coexists" | "rejects"; hint: string };
  /** Set when the knowledge describes something other than this project: a competitor, a
   * reference product or technology, or another project of the user. Absent on older ledgers. */
  about?: { name: string; role: WikiUnitAboutRole };
}
/** Where a ledger step is: requests done of the stage's total, for a progress bar. */
export interface WikiProgress { stage: "extract" | "name" | "attach" | "split" | "same" | "merge" | "group" | "plan" | "write"; done: number; total: number }
export type WikiProgressFn = (progress: WikiProgress) => void;
export type WikiUnitAboutRole = "competitor" | "reference" | "other_project";
export const ABOUT_ROLES: WikiUnitAboutRole[] = ["competitor", "reference", "other_project"];

export interface WikiUnitBatch {
  sourceIds: string[];
  /** The batch's request content (texts, roles, pasted flags, the replies judging adoption);
   * an update reuses the batch while it is unchanged. Absent on older ledgers. */
  signature?: string;
  status: "ok" | "failed";
  /** The user chose to leave this material out: it was not read. */
  skipped?: true;
  units: WikiKnowledgeUnit[];
  /** Units the model returned that failed local checks, with the reasons counted. */
  rejected: Record<string, number>;
  /** The first few rejected rows, for diagnosing extraction; never read into documents. */
  rejectedSamples?: Array<{ reason: string; statement?: string; subject?: string; keys?: string; detail?: string }>;
  error?: string;
  /** The batch's own user messages that produced no unit even when asked again. */
  uncovered?: string[];
  /** The version of the sentence check this batch passed: each of the user's own sentences stating a choice
   * is covered by a unit, or was asked for once more. A reused batch without it is checked on the next update. */
  sentenceChecked?: number;
  /** The version of the product check this batch passed: passages comparing other products were read once more for
   * each product they name. A reused batch without it is checked on the next run. */
  productsChecked?: number;
  /** The version of the cover check this batch passed: the user's own messages it left without a unit were read once
   * more. A reused batch without it is checked on the next run. */
  coverChecked?: number;
  /** Such sentences still without a unit after that request, counted. */
  uncoveredSentences?: number;
}

export interface WikiKnowledgeLedger {
  version: 1;
  generatedAt: number;
  status: "complete" | "partial";
  /** Materials offered to extraction; coverage is units' share of them. */
  materials: number;
  batches: WikiUnitBatch[];
  /** Redesign P2: subjects, merges and the subject directory. Batches stay as extracted. */
  organization?: WikiKnowledgeOrganization;
  /** Redesign P3: chapters written from the organized units, beside the current Wiki. */
  draft?: WikiUnitDraft;
  /** The last step that produced nothing usable (a directory with no chapter, a draft with no paragraph):
   * the result before it was kept. Cleared when that step next succeeds. */
  lastFailure?: { step: "organize" | "write"; at: number };
  /** The user's own verdict on key points, by unit id: confirmed makes it a decision, rejected sets it aside. It
   * outranks what the conversation shows and is kept through every later extraction, organization and update. */
  decisions?: Record<string, WikiUserDecision>;
  /** When a verdict was last given or withdrawn, so a draft written before it is known to be out of date. */
  decisionsAt?: number;
  /** The user's answers on what to read (long pastes, whole conversations), by item, and the messages they leave out:
   * kept so later runs and updates leave the same material out without asking again. */
  sourceChoices?: Record<string, "keep" | "skip">;
  skippedMessages?: string[];
  /** Two versions of a point the user said both hold ("older>newer" unit ids): written side by side, never as a change. */
  coexisting?: string[];
  /** What the user said another project named in the discussion is, by its name key (aboutNameKey). */
  scopeAnswers?: Record<string, WikiScopeAnswer>;
  /** Explanation groups the user said tell one point though written in several chapters: explained once, at home. */
  sameGroups?: string[];
  /** Explanation groups the user said are separate points: not asked again. */
  separateGroups?: string[];
  /** Questions the writer's reading of the material raised before writing, worked out for this organization. */
  writingQuestions?: WikiWritingQuestion[];
  /** The user's answers to them, in the user's own words: given to the writer beside the units they concern. */
  userAnswers?: WikiUserAnswer[];
  /** Points the user said belong to another project (unit id → its name): tagged as that project wherever it is read. */
  userOwners?: Record<string, string>;
  /** The conversations the units come from, by id, as their platform gives them: what the document names each source
   * by. Absent on older ledgers. */
  sources?: Record<string, WikiSourceConversation>;
  /** What the document organizes; absent is a project. by: the user chose it, or the run read it from the material. */
  documentType?: WikiDocumentType;
  documentTypeBy?: "user" | "auto";
  /** For a learning document: what each unit is to the learner, by unit id. */
  learningRoles?: Record<string, LearningRole>;
}
/** When a conversation was held, by the platform's own times; an import time is never one. */
export interface WikiConversationSpan { start?: number; end?: number }
/** A source conversation: its platform id (chatgpt, claude, ...), title and span. */
export interface WikiSourceConversation extends WikiConversationSpan { platform: string; title: string }
/** One action an answer takes on the ledger: a verdict on points, two versions that both hold, or the project points
 * belong to. */
export type WikiAnswerAction = { do: "confirm" | "reject" | "open"; units: string[] } | { do: "both"; units: [string, string] } | { do: "owner"; units: string[]; name: string; answer: WikiScopeAnswer };
/** A question about the material, asked in the writer's own words: what it is about, the question, the points it
 * concerns and the answers to choose from. organization: the organization it was asked of (its generatedAt). */
/** stage: writing when the writer asked it while writing a chapter, after which only that chapter is written again. */
export interface WikiWritingQuestion { id: string; about: string; ask: string; unitIds: string[]; options: Array<{ id: string; label: string; actions: WikiAnswerAction[] }>; organization: number; stage?: "writing" }
/** An answer: the option chosen, or what the user wrote instead. */
export interface WikiUserAnswer { questionId: string; unitIds: string[]; question: string; answer: string; optionId?: string; at: number }
/** project: part of this project, left where it is; related: the user's other project, a chapter of its own;
 * reference: an outside product, beside the competitors; exclude: left out of the Wiki. */
export type WikiScopeAnswer = "project" | "related" | "reference" | "exclude";
export const aboutNameKey = (name: string) => name.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, "");
/** The ledger without answers that make the project itself another project: a writing question offered "exclude" for
 * two outside suggestions with Pocket Ledger as their owner, and the whole project left its own Wiki. Read-time only:
 * the stored answers stay. */
export function withoutOwnProjectAnswers(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  const own = ledger.organization?.projectName ? aboutNameKey(ledger.organization.projectName) : "";
  if (!own || !ledger.scopeAnswers?.[own] && !Object.values(ledger.userOwners ?? {}).some(name => aboutNameKey(name) === own)) return ledger;
  const scopeAnswers = { ...ledger.scopeAnswers }, userOwners = Object.fromEntries(Object.entries(ledger.userOwners ?? {}).filter(([, name]) => aboutNameKey(name) !== own));
  delete scopeAnswers[own];
  const next: WikiKnowledgeLedger = { ...ledger, scopeAnswers, userOwners };
  if (!Object.keys(scopeAnswers).length) delete next.scopeAnswers;
  if (!Object.keys(userOwners).length) delete next.userOwners;
  return next;
}
/** The organization with the user's scope and same-point answers applied, for writing: the stored organization
 * stays as planned, so an answer can be changed or withdrawn. Units of an excluded project leave every subject;
 * subjects mostly about a related project or a reference move to a chapter for it; a group told as one point
 * gathers in its home subject. Emptied subjects, subtopics and chapters go. */
export function withUserAnswers(source: WikiKnowledgeLedger): WikiKnowledgeLedger {
  const ledger = withoutOwnProjectAnswers(source);
  const organization = ledger.organization, scope = ledger.scopeAnswers ?? {}, same = new Set(ledger.sameGroups ?? []);
  if (!organization || !Object.keys(scope).length && !same.size) return ledger;
  const units = new Map(wikiLedgerUnits(ledger).map(unit => [unit.id, unit]));
  const keyOf = (id: string) => { const about = units.get(id)?.about; return about ? aboutNameKey(about.name) : ""; };
  // A subject mostly about an excluded project goes whole, and so does a chapter named for it or mostly about it: one
  // run kept 「相关项目：ChatAtlas」 for the one untagged point left in it, written under that title.
  const excluded = (id: string) => scope[keyOf(id)] === "exclude", excludedKeys = Object.keys(scope).filter(key => scope[key] === "exclude");
  const mostlyExcluded = (ids: string[]) => ids.length > 0 && ids.filter(excluded).length * 3 >= ids.length * 2;
  const byId = new Map(organization.subjects.map(subject => [subject.id, subject]));
  const leaving = new Set(organization.chapters.filter(chapter => excludedKeys.some(key => aboutNameKey(chapter.title).includes(key)) || mostlyExcluded(chapter.subtopics.flatMap(topic => topic.subjectIds.flatMap(id => byId.get(id)?.unitIds ?? [])))).flatMap(chapter => chapter.subtopics.flatMap(topic => topic.subjectIds)));
  // A subtopic named for it goes too, with the untagged points placed there: one run kept 「相关项目：ChatAtlas」 under
  // 竞品分析 for three points extraction never tagged.
  for (const chapter of organization.chapters) for (const topic of chapter.subtopics) if (excludedKeys.some(key => aboutNameKey(topic.title).includes(key))) topic.subjectIds.forEach(id => leaving.add(id));
  let subjects = organization.subjects.map(subject => ({ ...subject, unitIds: leaving.has(subject.id) || mostlyExcluded(subject.unitIds) ? [] : subject.unitIds.filter(id => !excluded(id)) }));
  for (const group of organization.groups ?? []) {
    if (!same.has(group.id)) continue;
    const members = new Set(group.members.map(member => member.unitId).filter(id => subjects.some(subject => subject.unitIds.includes(id))));
    if (!subjects.some(subject => subject.id === group.homeSubjectId)) continue;
    subjects = subjects.map(subject => subject.id === group.homeSubjectId ? { ...subject, unitIds: [...new Set([...subject.unitIds, ...members])] } : { ...subject, unitIds: subject.unitIds.filter(id => !members.has(id)) });
  }
  let chapters = organization.chapters.map(chapter => ({ ...chapter, subtopics: chapter.subtopics.map(topic => ({ ...topic, subjectIds: [...topic.subjectIds] })) }));
  const zh = chapters.some(chapter => /\p{Script=Han}/u.test(chapter.title));
  for (const [key, answer] of Object.entries(scope)) {
    if (answer !== "related" && answer !== "reference") continue;
    const own = subjects.filter(subject => subject.unitIds.length && subject.unitIds.filter(id => keyOf(id) === key).length * 2 >= subject.unitIds.length).map(subject => subject.id);
    const name = [...units.values()].find(unit => unit.about && aboutNameKey(unit.about.name) === key)?.about?.name;
    if (!own.length || !name) continue;
    chapters = chapters.map(chapter => ({ ...chapter, subtopics: chapter.subtopics.map(topic => ({ ...topic, subjectIds: topic.subjectIds.filter(id => !own.includes(id)) })) }));
    let target = answer === "related" ? chapters.find(chapter => aboutNameKey(chapter.title).includes(key)) : chapters.find(chapter => /竞品|参考|外部|reference|competitor/iu.test(chapter.title));
    if (!target) {
      target = { id: `chapter:scope:${key}`, title: answer === "related" ? zh ? `相关项目：${name}` : `Related project: ${name}` : zh ? "外部参考" : "Outside references", question: "", group: "", subtopics: [] };
      chapters.push(target);
    }
    const topic = target.subtopics.find(item => aboutNameKey(item.title) === key);
    if (topic) topic.subjectIds.push(...own); else target.subtopics.push({ title: name, subjectIds: own });
  }
  const live = new Set(subjects.filter(subject => subject.unitIds.length).map(subject => subject.id));
  chapters = chapters.map(chapter => ({ ...chapter, subtopics: chapter.subtopics.map(topic => ({ ...topic, subjectIds: topic.subjectIds.filter(id => live.has(id)) })).filter(topic => topic.subjectIds.length) })).filter(chapter => chapter.subtopics.length);
  return { ...ledger, organization: { ...organization, subjects: subjects.filter(subject => live.has(subject.id)), chapters } };
}
/** open: the user said the point is not settled yet; it is written as still open. */
export interface WikiUserDecision { verdict: "confirmed" | "rejected" | "open"; at: number }
/** The ledger's relations with the user's answers applied: versions the user said both hold coexist. */
export function withUserRelations(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  if (!ledger.coexisting?.length || !ledger.organization) return ledger;
  const both = new Set(ledger.coexisting);
  return { ...ledger, organization: { ...ledger.organization, relations: ledger.organization.relations.map(relation => both.has(`${relation.older}>${relation.newer}`) ? { ...relation, kind: "coexists" as const, status: "resolved" as const } : relation) } };
}

/** The ledger after a step that produced nothing usable: everything it held before, marked. */
export const ledgerWithFailure = (ledger: WikiKnowledgeLedger, step: "organize" | "write"): WikiKnowledgeLedger => ({ ...ledger, lastFailure: { step, at: Date.now() } });
/** The ledger after that step succeeded: the failure mark goes. */
export function ledgerWithoutFailure(ledger: WikiKnowledgeLedger, step: "organize" | "write"): WikiKnowledgeLedger {
  if (ledger.lastFailure?.step !== step) return ledger;
  const rest = { ...ledger };
  delete rest.lastFailure;
  return rest;
}

/** How a unit may be stated: a decision the user made, this project's state as the user
 * reports it, what pasted material reports, an assistant proposal for the project, an
 * assistant's analysis of facts, the user's or pasted text, replaced history, or an open change. */
/** contested: the user confirmed it and also confirmed a conflicting choice; which one holds now is unverified. */
export type WikiUnitStatus = "confirmed" | "contested" | "reported" | "relayed" | "proposal" | "analysis" | "stated" | "history" | "open";
/** Only these kinds can be a decision; a user's view, complaint or fact is stated, not decided. */
export const DECIDING_KINDS: WikiUnitKind[] = ["decision", "constraint", "plan"];
/** Only these kinds can describe a built state; a requirement ("必须支持…") is never "reported". */
export const STATE_KINDS: WikiUnitKind[] = ["fact", "mechanism", "report", "history"];
/** A request made to the assistant itself ("为 Codex 生成一个提示词"), or the working steps given to an AI that
 * implements ("先阅读现有代码……运行现有代码检查测试与构建并说明修改结果", "检查实际代码，画出简明数据流",
 * "不要只汇报测试通过，请提供……", "向 Codex 明确传达核心价值主张"): not project knowledge. A rule for the project ("不删除已有数据") stays. */
/** The user's own direction, not the project's: what they learn, the career they aim at, where their skills lead
 * ("坚持硬件 AI 方向，结合 C++、STM32、Linux、ROS2 和 Edge AI，最终汇合到机器人领域" was marked a decided feature beside
 * 第一版禁止 STM32). Advice on what the developer should learn too. It stays in the ledger, out of the project's Wiki. */
const PERSONAL = /(?:开发者|你|我|个人)(?:需要?|应该?|要|可以)?(?:掌握|学习|补齐|提升)(?!.{0,6}(?:项目|系统|产品))|学习路线|职业(?:方向|规划|发展)|求职|简历|最终(?:汇合|发展|走向|转向)(?:到)?[^。；]{0,12}(?:领域|方向|行业)|(?:坚持|选择|确定)[^。；]{0,8}(?:技术)?方向[^。；]{0,40}(?:C\+\+|Linux|ROS2?|嵌入式|机器人|Edge AI)|\b(?:I|you|the developer) (?:should|need to|must) learn\b|\b(?:career|resume|job hunting)\b/iu;
export const personalDirection = (statement: string) => PERSONAL.test(statement);
export const assistantRequest = (statement: string) => /^(?:用户)?(?:要求|请求|让|希望|请)[^。]{0,40}(?:提示词|prompt|总结一下|写一[个份篇])/iu.test(statement.trim()) || WORKING_STEPS.test(statement);
// How to write the document or hand work to an AI ("给 Codex 的指令应包含……", "最终输出应明确当前决定并标记延期")
// is no project knowledge either: one run listed the first as a completion criterion.
const WORKING_STEPS = /\b(?:tell|ask|instruct|remind) (?:codex|claude|chatgpt|cursor|copilot|the ai|the model|the assistant)\b|\breport back\b|\bwrite (?:a|the) prompt\b|(?:最后|并|然后|完成后|之后)(?:需|需要|应|要|请)?(?:向我)?(?:汇报|报告)(?:新|修改|实现|结果|以下|下一)|向\s*(?:Codex|Claude|ChatGPT|Cursor|Copilot|AI|模型|助手)[^。]{0,8}(?:传达|交代|说明|下达|转达)|(?:生成|写|输出|给出)一[份个篇段][^。]{0,40}(?:提示词|prompt)|说明修改结果|(?:只)?汇报测试|运行(?:现有的?)?(?:代码)?(?:检查|测试|lint|typecheck|build)[^。]{0,12}(?:说明|汇报|报告)|列出(?:发现的)?问题及|画出[^。]{0,6}数据流|请提供[^。]{0,20}(?:对照|证明|报告)|给\s*(?:Codex|Claude|ChatGPT|Cursor|Copilot|AI|Agent|模型|助手)\s*的(?:指令|提示词|prompt|任务说明|说明)|最终(?:输出|综述|文档|报告)(?:中|里)?应|综述(?:中|里)?(?:应|需)(?:优先|明确|先)?(?:展示|显示|标记|区分|写)/iu;
export interface WikiDraftChapter {
  id: string; title: string; question: string; group: string;
  /** Left out on purpose, not lost: a learning record's planning chapter, told in its overview instead. */
  leftOut?: "plan";
  /** Markdown: the opening, then "### subtopic" sections. */
  body: string;
  /** claims: the paragraph's high-impact sentences (decided, done, numbers, changes), each with the units it states. */
  paragraphs: Array<{ subtopic: string; text: string; unitIds: string[]; claims?: WikiDraftClaim[] }>;
  /** The units the opening states, so its decisions carry their own footnote. */
  openingUnitIds?: string[];
  /** What the writer could not tell faithfully without the user, asked after the draft is written. */
  questions?: WikiWritingQuestion[];
  /** Local checks still failing after the one rewrite. */
  problems: string[];
  /** The chapter's inputs and the writing rules; an update keeps the chapter while it is unchanged. */
  signature?: string;
}
/** markOnly: added only so the sentence's holder mark has a place; not a statement of its own. */
export interface WikiDraftClaim { text: string; unitIds: string[]; markOnly?: true }
/** Three separate answers: did every request run (status), was the material complete, did the checks pass. */
/** uncovered: the user's own messages no unit was extracted from; a warning, since some hold no project content. */
export interface WikiDraftQuality { sources: "complete" | "partial"; failedBatches: number; uncovered?: number; organization: "complete" | "partial"; critical: number; problems: number; passed: boolean }
/** status says whether every writing request ran; quality says whether the material and the text can be relied on. */
/** What the project is doing now, leaves out now, and counts as done, from the units the draft shows: what a reader
 * continuing the work needs first. holder: decided (the user confirmed it) or user (the user said it); none for a suggestion. */
export interface WikiBaselineItem { part: "now" | "notNow" | "done"; text: string; unitIds: string[]; holder?: "decided" | "user" }
export interface WikiUnitDraft { version: 1; generatedAt: number; status: "complete" | "partial"; chapters: WikiDraftChapter[]; report: Record<string, number>; quality?: WikiDraftQuality; baseline?: WikiBaselineItem[] }

/** Planned chapters that failed writing remain visible in completeness reporting,
 * even though empty prose never becomes a saved Wiki page. */
export function wikiDraftCompleteness(ledger: WikiKnowledgeLedger | undefined) {
  const draft = ledger && scopedWikiDraft(ledger), plans = (ledger && withUserAnswers(ledger).organization?.chapters) ?? draft?.chapters ?? [];
  const written = new Set(draft?.chapters.filter(chapter => chapter.paragraphs.length && chapter.body.trim()).map(chapter => chapter.id));
  // A chapter left out on purpose was not planned to be written: "写作未完成：缺少「个人方向与学习路线」" read a learning
  // record's route, told in its overview, as lost.
  const leftOut = new Set(draft?.chapters.filter(chapter => chapter.leftOut).map(chapter => chapter.id));
  const planned = plans.filter(chapter => !leftOut.has(chapter.id));
  const missing = planned.filter(chapter => !written.has(chapter.id)).map(chapter => ({ id: chapter.id, title: chapter.title }));
  return { planned: planned.length, written: planned.length - missing.length, missing };
}

/** A failed rewrite may retain an older draft. Respect today's exclusions when
 * reading it too, without deleting that saved draft or changing source material. */
export function scopedWikiDraft(source: WikiKnowledgeLedger): WikiUnitDraft | undefined {
  const ledger = withoutOwnProjectAnswers(source);
  const draft = ledger.draft, keys = Object.entries(ledger.scopeAnswers ?? {}).filter(([, answer]) => answer === "exclude").map(([key]) => key);
  if (!draft || !keys.length) return draft;
  const answered = withUserAnswers(ledger), active = new Set(answered.organization?.subjects.flatMap(subject => subject.unitIds));
  const removed = new Set(ledger.organization?.subjects.flatMap(subject => subject.unitIds).filter(id => !active.has(id)));
  for (const unit of wikiLedgerUnits(ledger)) if (unit.about && keys.includes(aboutNameKey(unit.about.name))) removed.add(unit.id);
  const namesExcluded = (text: string) => keys.some(key => aboutNameKey(text).includes(key));
  let filtered = 0;
  const chapters = draft.chapters.flatMap(chapter => {
    if (namesExcluded(chapter.title)) { filtered += chapter.paragraphs.length; return []; }
    const paragraphs = chapter.paragraphs.filter(paragraph => !paragraph.unitIds.some(id => removed.has(id)) && !namesExcluded(paragraph.text) && !namesExcluded(paragraph.subtopic));
    filtered += chapter.paragraphs.length - paragraphs.length;
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0];
    const keepOpening = !namesExcluded(opening) && !chapter.openingUnitIds?.some(id => removed.has(id));
    if (!keepOpening && opening) filtered++;
    if (paragraphs.length === chapter.paragraphs.length && keepOpening) return [chapter];
    if (!paragraphs.length) return [];
    const topics = [...new Set(paragraphs.map(paragraph => paragraph.subtopic))];
    const body = [...keepOpening && opening ? [opening.trim()] : [], ...topics.map(title => `### ${title}\n\n${paragraphs.filter(paragraph => paragraph.subtopic === title).map(paragraph => paragraph.text).join("\n\n")}`)].join("\n\n");
    return [{ ...chapter, body, paragraphs, openingUnitIds: keepOpening ? chapter.openingUnitIds : [] }];
  });
  const baseline = draft.baseline?.filter(item => !item.unitIds.some(id => removed.has(id)) && !namesExcluded(item.text));
  if (!filtered && baseline?.length === draft.baseline?.length) return draft;
  return { ...draft, status: "partial", chapters, baseline, report: { ...draft.report, scope_filtered: filtered }, ...(draft.quality ? { quality: { ...draft.quality, passed: false } } : {}) };
}
/** A local check failure that makes a claim unreliable: a borrowed decision, a wrong holder, a number or change no source states. */
export const CRITICAL_PROBLEM = /says 已决定|borrows|credits the user|states as decided|numbers its units do not state|states the range|drops the negation of|done what only|tells a change|has no claim|claim .* not in the paragraph|has no supported source|changes the counted object|could not be written|a project you left out|you confirmed is not written/u;

/** ChatGPT's inline markers, kept by its export: U+E200 kind U+E202 argument … U+E201. A link (url, entity)
 * reads as its name; a search citation or any other marker says nothing to a reader and goes. */
export function chatMarkers(text: string) {
  return text.replace(/([^-]*)((?:[^-]*)*)/gu, (_, kind: string, args: string) => {
    const parts = args.split("").slice(1).map(part => part.trim()).filter(Boolean);
    // An entity carries ["type","name",…]; a url carries its title, then the address.
    let label = parts[0] ?? "";
    if (label.startsWith("[")) { try { const value = JSON.parse(label) as unknown; label = Array.isArray(value) && typeof value[1] === "string" ? value[1] : ""; } catch { label = ""; } }
    return /^(?:url|entity|link)$/u.test(kind.trim()) && label && !/^https?:/u.test(label) ? ` ${label} ` : " ";
  }).replace(/[-]/gu, "").replace(/ {2,}/gu, " ");
}

/** The draft as a document to hand over: "## chapter", "### subtopic", a footnote on every
 * paragraph and a source index of the original messages, so it is checkable on its own.
 * The scope note says what the draft can and cannot claim. messages: the full original
 * texts by message id, so an excerpt is not limited to the stored quote. */
export function wikiDraftMarkdown(ledger: WikiKnowledgeLedger, title: string, locale = "zh-CN", conversationTitles: Record<string, string> = {}, messages: Record<string, string> = {}): string {
  const draft = scopedWikiDraft(ledger)!, units = new Map(wikiLedgerUnits(ledger).map(unit => [unit.id, unit])), zh = locale !== "en";
  // One footnote per paragraph, listing the messages it draws on; a message lists one excerpt for
  // each distinct point it supports, so a second claim from the same message keeps its own evidence.
  const sources: WikiKnowledgeUnit["evidence"][] = [], seen = new Set<string>(), notes: Array<Array<{ source: WikiKnowledgeUnit["evidence"]; units: WikiKnowledgeUnit[] }>> = [];
  const cite = (ids: string[]) => {
    const messages = new Map<string, { source: WikiKnowledgeUnit["evidence"]; units: WikiKnowledgeUnit[] }>();
    for (const id of ids) {
      const unit = units.get(id), evidence = unit?.evidence;
      if (!unit || !evidence) continue;
      if (!seen.has(evidence.evidenceId)) { seen.add(evidence.evidenceId); sources.push(evidence); }
      const key = `${evidence.conversationId}\u0000${evidence.messageId}`;
      messages.set(key, { source: messages.get(key)?.source ?? evidence, units: [...messages.get(key)?.units ?? [], unit] });
    }
    // The user's own words first, then the messages most of the paragraph rests on, then discussion order.
    const rank = (source: WikiKnowledgeUnit["evidence"]) => source.role === "user" && !source.pasted ? 1 : 0;
    return [...messages.values()].sort((a, b) => rank(b.source) - rank(a.source) || b.units.length - a.units.length || a.source.messageIndex - b.source.messageIndex);
  };
  const chapters = draft.chapters.map(chapter => {
    let body = chapter.body;
    // The opening's decisions are footnoted like any paragraph.
    const opening = body.startsWith("### ") ? "" : body.split("\n\n")[0];
    const marked = [...(opening && chapter.openingUnitIds?.length ? [{ text: opening, unitIds: chapter.openingUnitIds }] : []), ...chapter.paragraphs];
    for (const paragraph of marked) {
      const cited = cite(paragraph.unitIds);
      if (!cited.length) continue;
      notes.push(cited);
      body = body.replace(paragraph.text, `${paragraph.text}[^${notes.length}]`);
    }
    // Drafts written before unit ids were removed at writing time are cleaned here too, with the empty brackets
    // ("[]", "[, ]") an earlier cleanup left.
    return `## ${chapter.title}\n\n${body.replace(/\s*[（([]\s*k\d+(?:\s*[、,，/]\s*k\d+)*\s*[)）\]]|(?<![A-Za-z\d])k\d+(?![A-Za-z\d])|[ \t]*\[(?:\]|[ \t]*[,，、][ \t,，、]*\])(?!\()/gu, "")}`;
  });
  const conversations = new Set(sources.map(source => source.conversationId)).size;
  const note = zh
    ? `> 本稿整理自所选的 ${conversations} 段对话，记录的是这些讨论的历史，现行产品方向以项目最新的文档为准。标为建议或方案的内容是讨论中的提议，未见用户采纳，不代表现行要求；材料之后的决定不在本稿范围内。`
    : `> Compiled from ${conversations} selected conversations: a record of those discussions; the project's latest documents state its current direction. Points marked as proposals were discussed, not adopted, and are not current requirements; decisions made after these sources are out of scope.`;
  // The excerpt is the run of sentences that best supports every cited claim from the source,
  // taken from the full message when it is available, without markup.

  // Markdown escapes, as exports of exports carry them (\_, \[, \\\>), undone level by level; a backslash
  // left before anything but a letter is noise.
  const unescape = (text: string) => { let out = text, last = ""; while (out !== last) { last = out; out = out.replace(/\\([\\`*_{}[\]()#+\-.!>|~<"'])/gu, "$1"); } return out.replace(/\\(?![A-Za-z])/gu, ""); };
  // Tables read as "cell：cell；" rows; fenced code is dropped. A tag cut by the quote's edges goes too.
  const plainText = (text: string) => unescape(chatMarkers(text).replace(/```[\s\S]*?(?:```|$)/gu, " "))
    .replace(/^[^<>\n]*?\b[\w-]+="[^"\n]*"[^<>\n]*>/u, " ").replace(/<\/?[A-Za-z][^>\n]*$/u, " ")
    .split("\n").filter(line => !/^\s*\|?\s*:?-{2,}/u.test(line))
    .map(line => /^\s*\|.*\|\s*$/u.test(line) ? `${line.trim().slice(1, -1).split("|").map(cell => cell.trim()).filter(Boolean).join("：")}；` : line).join("\n")
    .replace(/<[^>\n]*>/gu, " ").replace(/\*\*|__|`|^#{1,6}\s+|^\s*>\s?|^\s*[-*+]\s+/gmu, "")
    // Emphasis around a run of text, and a quote marker left inside a joined line.
    .replace(/(^|[^\w*])[*_](?=\S)([^*_\n]+?)(?<=\S)[*_](?![\w*])/gu, "$1$2").replace(/(^|\s)>\s+/gu, "$1")
    // A pasted document's own citation numbers ([30]), list markers left inside a joined line, and a leading separator.
    .replace(/\s*\[\d{1,3}\]/gu, "").replace(/([：:。；;])\s*[-*+•]\s+/gu, "$1").replace(/^[\s·•|]+/u, "")
    // Headings and rules inside a joined line; a table row joined into the text reads as "cell；cell".
    .replace(/(^|\s)#{1,6}\s+/gu, "$1").replace(/(^|\s)-{3,}(?=\s|$)/gu, "$1")
    .replace(/(?:\s*\|\s*){1,}(?=[^|]*\|)|\s*\|\s*$/gu, match => match.trim() ? "；" : match).replace(/；(?:\s*；)+/gu, "；")
    .replace(/\s+/gu, " ").trim();
  // Code outside a fence: many braces, quotes and operators for its length.
  const code = (sentence: string) => /[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\s*\(|=>|\b(?:function|const|let|var)\s+[A-Za-z_$][\w$]*\s*[=(]|[{}]/u.test(sentence) || (sentence.match(/[<>=;"$#()[\]]/gu) ?? []).length / Math.max(sentence.length, 1) > .06;
  const LIMIT = 220, QUOTE_ANCHOR = 1000;
  const excerpt = (unit: WikiKnowledgeUnit) => {
    const source = unit.evidence;
    const quote = plainText(source.quote), full = messages[source.messageId] ? plainText(messages[source.messageId]) : "";
    const plain = full && full.includes(quote.slice(0, 40)) ? full : quote;
    const sentences = plain.split(/(?:(?<=[。！？!?；;])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))/u).filter(sentence => sentence.trim() && !code(sentence)), terms = knowledgeTerms(unit.statement);
    const score = (sentence: string) => [...knowledgeTerms(sentence)].filter(term => terms.has(term)).length;
    // Ties go to the sentence nearest the stored quote.
    const at = plain.indexOf(quote.slice(0, 40)), offsets = sentences.map(sentence => plain.indexOf(sentence));
    if (!sentences.length) return zh ? "（原文为代码或表格，见原消息）" : "(code or a table; see the original message)";
    const distance = (index: number) => at < 0 ? index : Math.abs(offsets[index] - at);
    let best = 0;
    // Sentences inside the stored quote are what extraction pinned the claim to; they rank first.
    const inQuote = (index: number) => at >= 0 && offsets[index] < at + Math.max(quote.length, 1) && offsets[index] + sentences[index].length > at ? QUOTE_ANCHOR : 0;
    const rank = (index: number) => score(sentences[index]) + inQuote(index);
    sentences.forEach((_, index) => { const gain = rank(index) - rank(best); if (gain > 0 || !gain && distance(index) < distance(best)) best = index; });
    let text = "";
    let listing = false;
    for (const [step, sentence] of sentences.slice(best).entries()) {
      // A lead-in ending with a colon always continues into what it introduces; otherwise the
      // excerpt ends with its own quote, so it does not run into another claim's evidence.
      const leadIn: boolean = listing || /[:：]\s*$/u.test(text), beyond = at >= 0 && inQuote(best) > 0 && offsets[best + step] >= at + quote.length;
      listing = leadIn;
      if (text && !leadIn && (beyond || text.length + sentence.length > LIMIT || !score(sentence))) break;
      text += sentence;
      // A colon followed by a space or line end introduces a list (table cells joined by a colon do not);
      // its items follow until one ends the sentence.
      if (/[:：](?:\s|$)/u.test(sentence)) listing = true;
      else if (listing && /[。！？!?]\s*$/u.test(sentence)) break;
      if (text.length >= LIMIT) break;
    }
    const cut = text.length > LIMIT || !/[。！？!?；;]$/u.test(text.trim()) && plain.length > text.length;
    // A sentence split at ； can open with the closing mark of the one before ("」 而是：").
    const opened = (value: string) => value.replace(/^[\s」』”’）)\]】》,，、。；;：:！!？?]+/u, "");
    return text ? `${opened(text.slice(0, LIMIT)).trim()}${cut ? "…" : ""}` : opened(plain.slice(0, LIMIT));
  };
  const role = (source: WikiKnowledgeUnit["evidence"]) => source.role === "user" ? source.pasted ? (zh ? "用户粘贴" : "pasted by user") : (zh ? "用户" : "user") : "AI";
  const where = (source: WikiKnowledgeUnit["evidence"]) => `${role(source)} · ${conversationTitles[source.conversationId] ?? source.conversationId.slice(0, 8)} · #${source.messageIndex + 1}`;
  // Up to SHOWN sources are quoted; the rest are listed by message number, still checkable in the original.
  const SHOWN = 3;
  // A message's distinct excerpts, joined; a message shows at most two, enough to check its points.
  const quotes = (entry: { units: WikiKnowledgeUnit[] }) => [...new Set(entry.units.map(excerpt))].slice(0, 2).map(text => `“${text}”`).join(" / ");
  const index = notes.map((cited, position) => {
    if (cited.length === 1) return `[^${position + 1}]: ${where(cited[0].source)} · ${quotes(cited[0])}`;
    const rest = cited.slice(SHOWN), more = rest.length ? `\n    ${zh ? `另见 ${rest.map(entry => `#${entry.source.messageIndex + 1}`).join("、")}` : `See also ${rest.map(entry => `#${entry.source.messageIndex + 1}`).join(", ")}`}` : "";
    return `[^${position + 1}]: ${zh ? `${cited.length} 条来源` : `${cited.length} sources`}\n${cited.slice(0, SHOWN).map(entry => `    - ${where(entry.source)} · ${quotes(entry)}`).join("\n")}${more}`;
  });
  // What the draft could not finish or verify is said where the reader starts.
  const quality = draft.quality, gaps = quality && (!quality.passed || quality.uncovered) ? [
    quality.failedBatches ? (zh ? `${quality.failedBatches} 批原文未能读取，材料不完整，相关结论可能缺少后续确认` : `${quality.failedBatches} source batches could not be read; later confirmations may be missing`) : "",
    quality.organization === "partial" ? (zh ? "整理有步骤失败，部分主题或关系可能不完整" : "some organizing steps failed; subjects or relations may be incomplete") : "",
    quality.uncovered ? (zh ? `用户本人的 ${quality.uncovered} 条消息未抽出知识点，其中的决定可能未体现` : `${quality.uncovered} of the user's own messages produced no unit; decisions in them may be missing`) : "",
    quality.critical ? (zh ? `正文仍有 ${quality.critical} 项关键校验未通过（决定归属、来源角色、数字或变化依据）` : `${quality.critical} key checks still fail (decisions, holders, numbers or changes)`) : "",
  ].filter(Boolean) : [];
  const warning = gaps.length ? `> ${zh ? "质量提示：" : "Quality: "}${gaps.join(zh ? "；" : "; ")}${zh ? "。" : "."}` : "";
  return [`# ${title}`, note, ...(warning ? [warning] : []), ...chapters, `## ${zh ? "来源索引" : "Source index"}`, ...index].join("\n\n") + "\n";
}

/** One subject a reader would look up; every live unit belongs to exactly one. */
export interface WikiSubject { id: string; name: string; aliases: string[]; unitIds: string[] }
/** Older and newer statements of one subject. replaces/rejects are resolved only
 * when the user's own later words make the change; otherwise they stay unresolved. */
/** evidence: the user's own words that settle a replaces or rejects relation. */
export interface WikiUnitRelation { older: string; newer: string; kind: "replaces" | "narrows" | "supplements" | "coexists" | "rejects"; status: "resolved" | "unresolved"; evidence?: string }
/** Chapter → subtopic → subjects; each subject has exactly one home. */
export interface WikiChapterPlan { id: string; title: string; question: string; group: string; subtopics: Array<{ title: string; subjectIds: string[] }> }
/** Redesign phase 2: knowledge units that state one core, explained once. The group carries no status:
 * the core's status comes from the members supporting it, each condition's from the member adding it.
 * Units in no group are groups of one. */
export interface WikiExplanationGroup {
  /** Assigned when the group is created and kept while members change; moves are recorded in groupMoves. */
  id: string;
  /** What every supporting member states, in one sentence. */
  core: string;
  /** Where the group is explained; set apart from its identity so it can stay put. */
  homeSubjectId: string;
  /** The most reliable member for now; may change without changing the id. */
  anchorUnitId: string;
  /** support: the member's own words backing the core (empty when it only adds); adds: whole clauses only
   * this member states, copied with their object and scope; restates: nothing beyond the core. */
  members: Array<{ unitId: string; support: string; adds: string[]; role: "restates" | "adds" }>;
  /** Members' statements and the rules version; a change in either recomputes the group. */
  signature: string;
}
export interface WikiKnowledgeOrganization {
  version: 1;
  generatedAt: number;
  /** Reuse only with the same complete source inputs and unchanged directory. */
  inputSignature?: string;
  layoutSignature?: string;
  layoutContext?: true;
  unitSignatures?: Record<string, string>;
  status: "complete" | "partial";
  subjects: WikiSubject[];
  /** Same-statement units folded into one; the kept unit carries the union of details. */
  merged: Array<{ id: string; from: string[]; details: string[] }>;
  /** Units the merge found to state one point but kept apart, since one adds a number or a name the other lacks:
   * written as one point that keeps what each adds, instead of a paragraph each. Absent on older ledgers. */
  restated?: string[][];
  relations: WikiUnitRelation[];
  chapters: WikiChapterPlan[];
  /** The project's own name as the sources call it, from directory planning; names a new document no one named. */
  projectName?: string;
  /** Explanation groups (phase 2); absent on older ledgers, where every unit stands alone. */
  groups?: WikiExplanationGroup[];
  /** Groups split or joined by an update: the ids before and after. */
  groupMoves?: Array<{ from: string[]; to: string[] }>;
  /** Request counts and local repairs, for diagnostics. */
  report: Record<string, number>;
}

/** A user message the user pasted rather than wrote: long structured text such
 * as a report, another AI's answer or an exported document. It can report the
 * state of the project but is never the user's own decision or approval. */
export function pastedUserText(text: string): boolean {
  const body = text.trim();
  // Report and reference markers decide at any length; people paste short reviews too.
  if (/```|以下是(?:历史)?参考资料|审查发现/u.test(body)) return true;
  // A message that is only attached files ("【附件 专注计时器 Focus Timer — V0.1 产品规划与完整用户流程.txt】") carries a
  // document, not the user's words: a point read from its name was marked 〔你〕.
  if (/^(?:【附件[^】\n]*】\s*)+$/u.test(body)) return true;
  if (body.length < 40) return false;
  const lines = body.split("\n");
  const structured = lines.filter(line => /^\s*(?:#{1,6}\s|>|[-*]\s|\d+[.)]\s|\|)/u.test(line)).length;
  // Typed chat rarely carries Markdown emphasis or several code spans; another AI's answer does.
  const formatted = /\*\*[^*\n]+\*\*/u.test(body) || (body.match(/`[^`\n]+`/gu) ?? []).length >= 2;
  return body.length > 1500 || formatted || body.length >= 400 && (structured >= 3 || /^\s*(?:#|\*\*)/u.test(body));
}

/** Spacing, width, case and the joiners of an identifier aside: "Needs Review" is NEEDS_REVIEW. */
const detailKey = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/[\s_]+/gu, "");
/** Identifiers and counts the original quote states beside a unit's own wording:
 * `code`, camelCase or snake_case names, and numbers with a unit (10 个, 90 秒, 128 px). */
export function quotedDetails(quote: string, own: string, identifiers = false, counts = true): string[] {
  const known = detailKey(own);
  // Rendering markup in an answer (<caption textAlign="center">, maxWidth={120}) is layout, not knowledge.
  const plain = quote.replace(/<[^>\n]*>/gu, " ").replace(/\{[^}\n]*\}/gu, " ");
  const found = [...plain.matchAll(/`([^`\n]{2,40})`/gu)].map(match => match[1].trim())
    .concat(identifiers ? plain.match(/\b(?:[a-z]+[A-Z][A-Za-z\d]*|[A-Za-z]+_[A-Za-z\d_]+|[A-Z][A-Z\d]*_[A-Z\d_]+)\b/gu) ?? [] : [])
    .concat(!counts ? [] : plain.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?\s*(?:颗|个|条|名|人|次|倍|秒|分钟|小时|天|周|万|%|px|ms|KB|MB|GB)|\d+(?:\.\d+)?\s*(?:颗|个|条|名|人|次|倍|秒|分钟|小时|天|周|万|%|px|ms|KB|MB|GB)/gu) ?? []);
  return [...new Map(found.filter(value => !known.includes(detailKey(value))).map(value => [detailKey(value), value])).values()];
}
/** A unit's details for writing: what extraction copied, and the identifiers and counts its
 * own statement states. A quote's other code and numbers may belong to a different point. */
export const wikiUnitDetails = (unit: WikiKnowledgeUnit) => [...new Map([...unit.details.filter(detail => !foreignDetail(unit, detail)), ...quotedDetails(unit.statement, unit.details.join(" "), true), ...quoteCodes(unit)].map(value => [detailKey(value), value])).values()].slice(0, 8);
/** Codes a short quote about this one point gives in plain text ("应该：error: LOAD_REQUIRES_DRIVER", "两个设备声明 0x3C"):
 * the error code or address a reader looks up, which the statement summed up as 负载驱动 or 地址冲突. Only from the quote's
 * own section, at most two. A long quote spans other points and gives none. */
const QUOTE_CODE = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]{3,}\b|\b0x[0-9A-Fa-f]{2,}\b/gu, QUOTE_CODE_REACH = 600, QUOTE_CODES = 2;
function quoteCodes(unit: WikiKnowledgeUnit): string[] {
  const section = ownSection(unit.evidence.quote, unit.statement);
  if (section.length > QUOTE_CODE_REACH) return [];
  return [...new Set(section.match(QUOTE_CODE) ?? [])].filter(code => !unit.statement.includes(code)).slice(0, QUOTE_CODES);
}
/** A quote running over a section break (---, ===, a heading) carries the end of the section before: a code there
 * ("> `LOAD_REQUIRES_DRIVER ERROR` 技术 code 可以内部保留。--- # 第九阶段……仿真") is that section's, not this unit's. */
const SECTION_BREAK = /\n\s*(?:-{3,}|={3,}|#{1,6}\s)/u;
export function foreignDetail(unit: WikiKnowledgeUnit, detail: string): boolean {
  const sections = unit.evidence.quote.split(SECTION_BREAK).filter(section => section.trim());
  if (sections.length < 2 || detailKey(unit.statement).includes(detailKey(detail))) return false;
  const own = ownSection(unit.evidence.quote, unit.statement), key = detailKey(detail), holders = sections.filter(section => detailKey(section).includes(key));
  return holders.length > 0 && !holders.includes(own);
}
/** The section of a quote that states the statement: the one sharing most of its terms. The whole quote when it has
 * no section break. */
export function ownSection(quote: string, statement: string): string {
  const sections = quote.split(SECTION_BREAK).filter(section => section.trim());
  if (sections.length < 2) return quote;
  const terms = knowledgeTerms(statement), score = (section: string) => [...knowledgeTerms(section)].filter(term => terms.has(term)).length;
  return sections.reduce((best, section) => score(section) > score(best) ? section : best, sections[0]);
}
/** A detail a paragraph must keep verbatim: a number, a Latin name or identifier, or code.
 * Phrases ("产品设计", "后续增加向量检索") are context for the writer, not exact values. */
export const exactDetail = (detail: string) => /[\d`A-Za-z]/u.test(detail);
/** Two statements of nearly the same point: half of the shorter one's terms recur in the other. */
// Words the term matcher drops, grouped by what they say: an obligation, a prohibition, a stop, a limit or an option.
const MODALITY: Array<[string, RegExp]> = [
  ["must", /必须|务必|应当|应该|需要|一定要|\b(?:must|should|required?)\b/iu],
  ["never", /禁止|不得|不能|不要|严禁|不允许|不可|不引入|不使用|不采用|\b(?:never|must not|cannot|don't)\b/iu],
  ["stop", /不再|暂不|停止|取消|\b(?:no longer|stop)\b/iu],
  ["only", /仅|只(?:做|保留|支持|用|在|需|显示|允许)|\bonly\b/iu],
  ["optional", /可选|无需|不需要|可以不|\b(?:optional|not required)\b/iu],
];
const modality = (text: string) => MODALITY.filter(([, pattern]) => pattern.test(text)).map(([name]) => name).join(",");
/** One statement requires what the other forbids: never the same point, nor one explanation. */
export const modalityConflict = (first: string, second: string) => { const a = modality(first).split(","), b = modality(second).split(","); return a.includes("must") && b.includes("never") || a.includes("never") && b.includes("must"); };
const figures = (text: string) => [...new Set(text.match(/\d+(?:\.\d+)?/gu) ?? [])].sort().join(",");
// Names and versions written in Latin letters (Orama, SQLite, v0.2, GPT-4o), lowercased; the product's own
// name and generic words (AI, LLM) say nothing about which option a statement takes.
const GENERIC_NAMES = new Set(["atlas", "chatatlas", "ai", "llm", "app", "api"]);
const identifiers = (text: string) => [...new Set((text.match(/[A-Za-z][A-Za-z0-9.#-]*/gu) ?? []).map(word => word.toLowerCase().replace(/[.#-]+$/u, "")).filter(word => word && !GENERIC_NAMES.has(word)))].sort().join(",");
/** Two statements that look alike but say something different: a different obligation or prohibition,
 * different numbers or the same numbers given to different objects, or different names and versions.
 * Word overlap never makes these the same, so no stage skips, merges or removes one of them as a repeat of the other. */
export function protectedDifference(first: string, second: string) {
  return modality(first) !== modality(second) || figures(first) !== figures(second) || identifiers(first) !== identifiers(second) || swappedFigures(first, second);
}
/** Any negation of what a clause does ("不自动发送", "避免使用 margin-left", "未实现"), beyond the listed
 * prohibitions; 不仅/不同/不断 and the like negate nothing. */
export const NEGATION = /不(?!仅|但|同|断|少|久|论|管|过|错|如|止|妨)|未(?!来)|禁止|严禁|避免|勿|无需|并非|\b(?:not|never|no|avoid|without)\b/iu;
/** A statement told again inside a fuller one, the direction a merge keeps: every number and name the shorter one
 * gives is in the kept one (its details included), and both forbid or stop alike. "宽度 720–850px" is inside
 * "宽度 720–850px，字号 15–16px"; "30 秒" is not inside "60 秒", "使用 Orama" not inside "使用 SQLite", and
 * "不引入 X" never inside "引入 X". A must beside a plain statement is wording, not another point. */
export function restatedWithin(kept: string, other: string) {
  if (opposed(kept, other)) return false;
  const within = (part: string, whole: string) => !part || part.split(",").every(value => whole.split(",").includes(value));
  return within(figures(other), figures(kept)) && within(identifiers(other), identifiers(kept)) && !swappedFigures(kept, other);
}
/** One forbids, stops or negates what the other does not. */
function opposed(first: string, second: string) {
  const a = modality(first).split(","), b = modality(second).split(",");
  return modalityConflict(first, second) || ["never", "stop"].some(name => a.includes(name) !== b.includes(name)) || NEGATION.test(first) !== NEGATION.test(second);
}
/** Two statements that cannot be told as one point: a clause of one forbids, stops or negates what a clause of the
 * other states ("不自动发送" against "自动发送"), or they give one thing different numbers ("全文 30 秒" against
 * "全文 60 秒"). A clause, number or name only one of them gives is no conflict: "IndexedDB + Orama，避免引入新数据库"
 * and "IndexedDB → Search Index Manager → Orama" tell one architecture. */
export function statementsConflict(first: string, second: string) {
  if (modalityConflict(first, second) || opposedClauses(first, second) || swappedFigures(first, second)) return true;
  const left = numberClauses(first), right = numberClauses(second);
  return left.some(item => !right.some(other => other.value === item.value) && right.some(other => overlap(item.about, other.about) >= SAME_CLAUSE));
}
const negated = (clause: string) => NEGATION.test(clause) || /never|stop/u.test(modality(clause));
function opposedClauses(first: string, second: string) {
  const clauses = (text: string) => text.split(/[，,；;。！!？?\n]/u).filter(clause => clause.trim());
  const against = (a: string[], b: string[]) => a.some(clause => negated(clause) && b.some(other => !negated(other) && overlap(knowledgeTerms(clause), knowledgeTerms(other)) >= SAME_CLAUSE));
  const a = clauses(first), b = clauses(second);
  return against(a, b) || against(b, a);
}
/** A number's clause this close to one in the other statement is about the same thing. */
const SAME_CLAUSE = .6;
const NUMBER = /\d+(?:\.\d+)?/gu;
/** Each number with the clause it sits in, the numbers blanked: what the number is about. */
const numberClauses = (text: string) => text.split(/[，,；;。！!？?\n]|\.(?=\s|$)/u).flatMap(clause => (clause.match(NUMBER) ?? []).map(value => ({ value, about: knowledgeTerms(clause.replace(NUMBER, " ")) })));
const overlap = (a: Set<string>, b: Set<string>) => a.size && b.size ? [...a].filter(term => b.has(term)).length / Math.min(a.size, b.size) : 0;
/** The same numbers given to different objects ("全文 30 秒、向量 60 秒" against "全文 60 秒、向量 30 秒"):
 * a number whose clause in one statement matches another number's clause in the other better than its own,
 * or one wording with the numbers in another order. */
function swappedFigures(first: string, second: string) {
  const left = numberClauses(first), right = numberClauses(second);
  if (new Set(left.map(item => item.value)).size < 2) return false;
  const order = (items: typeof left) => items.map(item => item.value).join(",");
  if (first.replace(NUMBER, "#") === second.replace(NUMBER, "#") && order(left) !== order(right)) return true;
  return left.some(item => {
    const own = right.filter(other => other.value === item.value).reduce((best, other) => Math.max(best, overlap(item.about, other.about)), 0);
    return right.some(other => other.value !== item.value && overlap(item.about, other.about) > own + SWAP_MARGIN);
  });
}
const SWAP_MARGIN = .2;
/** Phase 2: what an explanation group's member states beyond the core. Only clauses of its own statement count;
 * one taken from a detail (a code name, a field) is context like any other detail. A member that could not be
 * split keeps its whole support as its condition. */
const bareText = (text: string) => text.replace(/[\s，,。．.；;：:！!？?、“”"'‘’（）()]/gu, "");
export const groupMemberConditions = (member: WikiExplanationGroup["members"][number], unit: WikiKnowledgeUnit) => member.role === "restates" ? [] : member.adds.length ? member.adds.filter(add => bareText(unit.statement).includes(bareText(add))) : [member.support || unit.statement];
/** A sentence stating most of a core: the core's explanation, wherever it appears. */
/** English terms read alike in their forms: trailing punctuation off, plurals folded, a hyphened word also read by its
 * parts ("apps" = "app", "web-only" = "web" and "only"). Without it "v1 is web only, with no native mobile app" did
 * not state itself in "… a web-only application with no native iOS or Android apps", and was restored again. */
function foldedTerms(text: string, whole: boolean): Set<string> {
  const fold = (term: string) => { const bare = term.replace(/[.,;:!?]+$/u, ""); return /^[a-z]{4,}$/u.test(bare) ? bare.replace(/ies$/u, "y").replace(/(?<=[^s])s$/u, "") : bare; };
  // The core counts a hyphened word by its parts; the sentence reads it both ways.
  return new Set([...knowledgeTerms(text)].flatMap(term => /^[a-z]+(?:-[a-z]+)+$/u.test(term) ? [...whole ? [term] : [], ...term.split("-").map(fold)] : [fold(term)]));
}
export function statesCore(core: string, sentence: string) {
  const terms = foldedTerms(core, false), own = foldedTerms(sentence, true);
  return terms.size >= 4 && [...terms].filter(term => own.has(term)).length / terms.size >= .6;
}
/** A condition written in a text: half of its terms (or its words, when short) and every number it gives. */
export function conditionKept(condition: string, text: string) {
  condition = readableDetail(condition); text = readableDetail(text);
  const own = knowledgeTerms(condition), terms = knowledgeTerms(text), figures = condition.match(/\d+(?:\.\d+)?/gu) ?? [];
  return (own.size >= 2 ? [...own].filter(term => terms.has(term)).length / own.size >= .5 : bareText(text).includes(bareText(condition))) && figures.every(figure => text.includes(figure));
}
/** Design section 8: how a written draft uses the explanation groups. explainedTwice: groups whose core is the
 * subject of two or more paragraphs, among groups the draft cites; conditionsLost: conditions only one member
 * states that no paragraph citing that member writes. rejected: members organizing kept out, by reason. */
export function wikiGroupMetrics(ledger: WikiKnowledgeLedger) {
  const groups = ledger.organization?.groups ?? [], paragraphs = ledger.draft?.chapters.flatMap(chapter => chapter.paragraphs) ?? [];
  const units = new Map(wikiLedgerUnits(ledger).map(unit => [unit.id, unit]));
  let cited = 0, twice = 0, conditions = 0, lost = 0;
  for (const group of groups) {
    const members = new Set(group.members.map(member => member.unitId)), citing = paragraphs.filter(paragraph => paragraph.unitIds.some(id => members.has(id)));
    if (!citing.length) continue;
    cited++;
    if (citing.filter(paragraph => paragraph.text.split(/(?:(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))/u).some(sentence => statesCore(group.core, sentence))).length > 1) twice++;
    for (const member of group.members) {
      const unit = units.get(member.unitId), where = paragraphs.filter(paragraph => paragraph.unitIds.includes(member.unitId)).map(paragraph => paragraph.text).join(" ");
      if (!unit || !where) continue;
      for (const condition of groupMemberConditions(member, unit)) { conditions++; if (!conditionKept(condition, where)) lost++; }
    }
  }
  const rate = (part: number, whole: number) => whole ? Math.round(part / whole * 1000) / 1000 : 0;
  const rejected = Object.fromEntries(Object.entries(ledger.organization?.report ?? {}).filter(([key]) => /^group_rejected_|^group_core_unsupported$/u.test(key)));
  return { groups: groups.length, cited, explainedTwice: twice, explainedTwiceRate: rate(twice, cited), conditions, conditionsLost: lost, conditionLossRate: rate(lost, conditions), rejected };
}
/** Whether a text holds every number, name and obligation a core states: a core may say less than its
 * members, never something one of them does not. */
export function coreHeldBy(core: string, text: string) {
  const subset = (part: string, whole: string) => !part || part.split(",").every(item => whole.split(",").includes(item));
  return subset(modality(core), modality(text)) && subset(figures(core), figures(text)) && subset(identifiers(core), identifiers(text));
}
/** Likely the same point by wording, and nothing protected differs; a candidate signal, not proof. */
export function similarStatements(first: string, second: string) {
  if (protectedDifference(first, second)) return false;
  const a = knowledgeTerms(first), b = knowledgeTerms(second);
  return a.size >= 4 && b.size >= 4 && [...a].filter(term => b.has(term)).length / Math.min(a.size, b.size) >= .5;
}
/** Whether a text keeps a detail, ignoring spacing and width (128 px = 128px). */
const DETAIL_WORDS: Record<string, string> = { typography: "排版", layout: "布局", hierarchy: "层级" };
/** Ordinary design vocabulary may be translated. Code, identifiers, measurements
 * and version names retain the exact check. This is deliberately a small vocabulary. */
// 绕过 and skip say 跳过: "不得用 skip 绕过失败测试" keeps "不得跳过测试".
const readableDetail = (text: string) => text.split(/(`[^`]*`)/u).map(part => part.startsWith("`") ? part : part.replace(/\b(?:typography|layout|hierarchy)\b/giu, word => DETAIL_WORDS[word.toLocaleLowerCase()]).replace(/\bskip(?:ped|ping|s)?\b|绕过/giu, "跳过")).join("");
export const keepsDetail = (text: string, detail: string) => detailKey(readableDetail(text)).includes(detailKey(readableDetail(detail)));

export function wikiLedgerUnits(ledger: WikiKnowledgeLedger | undefined): WikiKnowledgeUnit[] {
  return ledger?.batches.flatMap(batch => batch.units) ?? [];
}

/** An exception limiting a rule: 除非, 仅当, 只有……才, unless. */
export const WIKI_EXCEPTION = /除非|仅当|只有[^。；;]{0,12}才|仅在[^。；;]{0,12}(?:时|情况下)|\b(?:unless|except when|only when|only if)\b/iu;
/** What the user answered about each unit, for the writer: "问题 → 回答". */
export function userAnswersByUnit(ledger: WikiKnowledgeLedger): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const answer of ledger.userAnswers ?? []) for (const id of answer.unitIds) by.set(id, [...by.get(id) ?? [], `${answer.question} → ${answer.answer}`]);
  return by;
}
