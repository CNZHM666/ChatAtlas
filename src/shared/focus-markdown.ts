import type { FocusEvidence, FocusSection, FocusSession } from "./focus-session";
import type { Conversation } from "./types";
import { evidencePresentation } from "./evidence-presentation";
import { understandingRelationLabels } from "./understanding-relations";
import { personalProjectMarkdown, analyzedProjectMarkdown } from "./project-understanding-markdown";
import { projectStateMarkdown } from "./project-state-markdown";
import { noteModuleTitle, noteSectionTitle } from "./note-context";
import {generatedProse} from "./generated-structure-prose";

type ExportOptions = { locale?: "zh-CN" | "en"; conversations?: Pick<Conversation, "id" | "title" | "url">[] };
const titleKey = (value: string) => value.normalize("NFKC").replace(/[\s*_`#]/gu, "").toLowerCase();
const oneLine = (value: string) => value.replace(/\s+/gu, " ").trim();
const join = (parts: string[]) => parts.filter(part => part.trim()).join("\n\n");

/** Normalize document headings, never interpreting fenced code, indented code or math as headings. */
function bodyMarkdown(value: string, depth: number, titles: string[], generated: boolean,originalTexts:string[]=[]): string {
  const lines = (generated ? evidencePresentation(generatedProse(value,originalTexts).body) : value).replace(/\r\n?/gu, "\n").split("\n");
  const headings = new Map<number, { depth: number; title: string }>();
  let fence = "", math = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], delimiter = line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1];
    if (delimiter) { if (!fence) fence = delimiter; else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = ""; continue; }
    if (fence || /^(?: {4}|\t)/u.test(line)) continue;
    if (line.trim() === "$$") { math = !math; continue; }
    if (math) continue;
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/u);
    if (heading) headings.set(index, { depth: heading[1].length, title: heading[2] });
    else if (line.trim() && /^ {0,3}(?:=+|-+)\s*$/u.test(lines[index + 1] ?? "")) {
      headings.set(index, { depth: lines[index + 1].trim()[0] === "=" ? 1 : 2, title: line.trim() });
      lines[index + 1] = ""; index++;
    }
  }
  // Drop only repeated opening titles/captions, keeping distinct subheadings and authored text.
  const duplicates = new Set(titles.map(titleKey));
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue;
    const heading = headings.get(index);
    if (heading && duplicates.has(titleKey(heading.title))) { lines[index] = ""; headings.delete(index); continue; }
    if (generated && /^(?:复习\s*\/\s*Review|Review\s*\/\s*复习)$/iu.test(lines[index].trim())) { lines[index] = ""; continue; }
    break;
  }
  const base = Math.min(...[...headings.values()].map(heading => heading.depth));
  for (const [index, heading] of headings) lines[index] = `${"#".repeat(Math.min(6, depth + heading.depth - base))} ${heading.title}`;
  return lines.join("\n").trim();
}

/** Readable export only. Stored source references and personal records are never rewritten. */
export function focusMarkdown(session: FocusSession, options: ExportOptions = {}): string {
  const zh = (options.locale ?? session.locale ?? (/[\u3400-\u9fff]/u.test(session.title + session.goal) ? "zh-CN" : "en")) === "zh-CN";
  const label = (cn: string, en: string) => zh ? cn : en;
  const title = oneLine(evidencePresentation(session.title)) || label("对话回顾", "Conversation review");
  const maintainedNotes = new Set(session.detachedNotes?.map(note => note.understandingNoteId));
  const sectionNotes = Object.fromEntries(Object.entries(session.sectionNotes ?? {}).filter(([, note]) => !note.deletedAt));
  const detached = (session.detachedNotes ?? []).filter(note => !note.deletedAt);
  const allEvidence = [...new Map([...session.evidence, ...Object.values(sectionNotes).flatMap(note => note.sources ?? []), ...detached.flatMap(note => note.sources ?? [])]
    .map(ref => [JSON.stringify([ref.conversationId, ref.messageId, ref.excerpt]), ref])).values()];
  const evidence = new Map(session.evidence.map(ref => [ref.id, ref]));
  const sources = new Map<string, FocusEvidence[]>();
  for (const id of session.sourceConversationIds) sources.set(id, []);
  for (const ref of allEvidence) sources.set(ref.conversationId, [...(sources.get(ref.conversationId) ?? []), ref]);
  const sourceNames = new Map([...sources].map(([id, refs], index) => [id, oneLine(evidencePresentation(options.conversations?.find(item => item.id === id)?.title || refs[0]?.title || label(`对话 ${index + 1}`, `Conversation ${index + 1}`)))]));
  const sourceLink = (id: string) => {
    const name = sourceNames.get(id)!, url = options.conversations?.find(item => item.id === id)?.url;
    try { const parsed = new URL(url ?? ""); if (["https:", "http:"].includes(parsed.protocol)) return `[${name.replace(/[[\]\\]/gu, "\\$&")}](${parsed.href.replace(/[<>()]/gu, character => encodeURIComponent(character))})`; } catch { /* Imported sources can have no original URL. */ }
    return name;
  };
  const sourceLine = (refs: FocusEvidence[]) => {
    const ids = [...new Set(refs.map(ref => ref.conversationId))];
    return sources.size > 1 && ids.length ? `${label("来源", "Sources")}：${ids.map(sourceLink).join(" · ")}` : "";
  };
  const references = (ids: string[]) => ids.flatMap(id => evidence.get(id) ? [evidence.get(id)!] : []);
  const clean = (value: string, depth = 3, titles: string[] = [], generated = true,originalTexts:string[]=[]) => bodyMarkdown(value, depth, titles, generated,originalTexts);
  const personalStructure = (step: FocusSection, peers: FocusSection[]) => join([
    step.responsibility?.trim() ? `> ${label("我的说明", "My explanation")}：${oneLine(step.responsibility)}` : "",
    ...(step.understandingLinks ?? []).flatMap(link => {
      const target = peers.find(item => item.id === link.targetId);
      const relation = understandingRelationLabels[link.kind];
      return target && target.id !== step.id && relation ? [`- ${label("我的关系", "My relation")}：${oneLine(step.title)} ${link.kind === "comparison" ? "↔" : "→"} ${relation[zh ? 0 : 1]} → ${oneLine(target.title)}`] : [];
    }),
  ]);
  const brief = session.brief ? join([
    `## ${label("项目概况", "Overview")}`, clean(session.brief.summary, 3, [title, label("项目概况", "Overview")]),
    ...([[label("关键转折", "Turning points"), session.brief.turningPoints], [label("已确认", "Confirmed"), session.brief.confirmed]] as const).map(([heading, items]) => items.length ? `### ${heading}\n\n${items.map(item => `- ${clean(item.text)}`).join("\n")}` : ""),
    session.brief.openQuestions.length ? `### ${label("待确认", "Open questions")}\n\n${session.brief.openQuestions.map(item => `- ${clean(item)}`).join("\n")}` : "",
  ]) : "";
  const chapterPath = (section: FocusSection) => section.understandingPath?.length ? join([
    `### ${label("本章理解路线", "Chapter understanding path")}`,
    section.understandingPath.map((step, index) => `${index + 1}. ${oneLine(evidencePresentation(step.title))}${step.phase ? ` (${oneLine(evidencePresentation(step.phase))})` : ""}${step.origin === "user" ? ` · ${label("我的理解", "My understanding")}` : ""}`).join("\n"),
    ...section.understandingPath.map(step => personalStructure(step, section.understandingPath!)),
    ...section.understandingPath.filter(step => (step.origin === "user" || step.userEdited) && !maintainedNotes.has(`chapter:${section.id}:${step.id}`)).map(step => join([`#### ${oneLine(step.title)}`, clean(step.body, 5, [step.title], false)])),
  ]) : "";
  const chapters = session.sections.map(section => {
    const heading = oneLine(evidencePresentation(section.title)), repeated = titleKey(heading) === titleKey(title);
    const kind = section.origin === "user" ? label("我的理解", "My understanding") : section.kind === "proposal" ? label("AI 建议", "AI proposal") : section.kind === "open_question" ? label("待确认", "Open question") : "";
    const note = sectionNotes[section.id], transition = clean(section.transition);
    return join([
      repeated ? "" : `## ${heading}`, kind ? `> ${kind}` : "", personalStructure(section, session.sections),
      clean(section.body, repeated ? 2 : 3, [title, heading], !section.userEdited && section.origin !== "user",references(section.evidenceIds).map(ref=>ref.excerpt)), chapterPath(section),
      /^(?:接着阅读下一部分[。.]?|接下来讨论[。.]?|接下来阅读下一(?:节|部分)[。.]?|continue reading (?:the )?next (?:part|section)[.!]?|next in reading order[.!]?)$/iu.test(transition) ? "" : transition,
      sourceLine(references(section.evidenceIds)),
      note?.text.trim() ? join([`### ${label("我的笔记", "My notes")}`, note.module ? `${label("关联模块", "Related module")}：${oneLine(noteModuleTitle(session, note))}` : "", clean(note.text, 4, [label("我的笔记", "My notes")], false), sourceLine(note.sources ?? references(note.evidenceIds))]) : "",
      session.reviewNeeds?.[section.id] ? `**${label("待复习", "Revisit later")}：** ${session.reviewNeeds[section.id]}` : "",
    ]);
  });
  const appendix = sources.size ? join([`## ${label("来源对话", "Source conversations")}`, ...[...sources].map(([id, refs]) => {
    const excerpts = [...new Set(refs.map(ref => evidencePresentation(ref.excerpt).trim()).filter(Boolean))];
    return join([`### ${sourceLink(id)}`, excerpts.length ? `<details>\n<summary>${label("引用片段", "Quoted passages")} · ${excerpts.length}</summary>\n\n${excerpts.map(text => text.split("\n").map(line => `> ${line}`).join("\n")).join("\n\n")}\n\n</details>` : ""]);
  })]) : "";
  const goal = clean(session.goal, 2, [title]);
  return join([
    `# ${title}`, goal && titleKey(goal) !== titleKey(title) ? `> ${label("整理目标", "Goal")}：${oneLine(goal)}` : "", session.mode === "work" ? projectStateMarkdown(session, zh) : "", brief, analyzedProjectMarkdown(session, zh), personalProjectMarkdown(session, zh), ...chapters,
    session.notes.trim() ? join([`## ${label("我的笔记", "My notes")}`, clean(session.notes, 3, [label("我的笔记", "My notes")], false)]) : "",
    detached.length ? join([`## ${label("其他笔记", "Other notes")}`, ...detached.map(note => join([`### ${oneLine(note.title)}`, note.module ? `${label("关联模块", "Related module")}：${oneLine(noteModuleTitle(session, note))}` : "", note.section ? `Wiki：${oneLine(noteSectionTitle(session, note))}` : "", clean(note.text, 4, [note.title], note.origin === "query"), sourceLine(note.sources ?? [])]))]) : "", appendix,
  ]) + "\n";
}
