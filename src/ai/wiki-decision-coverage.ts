import { claimSupported } from "./wiki-claim-support";
import { replaceParagraph } from "../shared/wiki-body-text";
import { wikiUnitHome } from "./wiki-unit-routing";
import { isSourceCodeParagraph } from "../shared/wiki-source-code";
import { openingSentenceMarks, saysMostOf } from "./wiki-ledger-document";
import { knowledgeTerms } from "../shared/knowledge-subject";
import { assistantRequest, personalDirection, statesCore, type WikiDraftChapter, type WikiKnowledgeOrganization, type WikiKnowledgeUnit, type WikiUnitStatus } from "../shared/wiki-knowledge";

/** The user's own direction (personalDirection) is not the project's, confirmed or not: restored, it was listed among the
 * project's decisions beside 第一版禁止 STM32. */
/** trimmed: decisions whose sentence lost a default a later message changed; what is left of it covers them. */
/** A citation alone does not cover a decision. It must have a sentence of its
 * own that can carry its own adoption and source, apart from proposed details. */
/** added: the paragraphs it writes, which a later pass dropping repeats leaves: one run's "Pocket Ledger v1 supports USD
 * only; …" went again as said by the feedback naming it, and "CSV export moves to Milestone 2." as said by an opening that
 * carries no mark for it, and neither decision showed 〔已定〕. */
/** sameAs: the units one answer confirmed together ("25分钟专注，5分钟休息" confirmed three points saying it), one decision:
 * once one of them is written, the others are said by it. Restored apart, 25/5 stood three times in one subtopic. */
export function ensureWikiDecisions(chapters: WikiDraftChapter[], organization: WikiKnowledgeOrganization, units: WikiKnowledgeUnit[], statuses: Map<string, WikiUnitStatus>, trimmed: Set<string> = new Set(), added: Set<WikiDraftChapter["paragraphs"][number]> = new Set(), sameAs: Map<string, string[]> = new Map()): number {
  const live = new Set(organization.subjects.flatMap(subject => subject.unitIds)), byId = new Map(units.map(unit => [unit.id, unit]));
  let restored = 0;
  for (const unit of units) {
    if (!live.has(unit.id) || unit.about || statuses.get(unit.id) !== "confirmed" || assistantRequest(unit.statement) || personalDirection(unit.statement)) continue;
    const covered = chapters.flatMap(chapter => chapter.paragraphs).flatMap(paragraph => paragraph.claims ?? []).find(claim => claim.unitIds.includes(unit.id)
      && claimSupported(claim.text, [unit]) && (trimmed.has(unit.id) || statesCore(unit.statement, claim.text) && mostlyOf(claim.text, unit.statement, true)) && claim.unitIds.every(id => statuses.get(id) === "confirmed"));
    if (covered) { if (covered.markOnly) { delete covered.markOnly; restored++; } continue; }
    const mates = sameAs.get(unit.id) ?? [];
    const host = mates.length ? chapters.flatMap(chapter => chapter.paragraphs).find(paragraph => (paragraph.claims ?? []).some(claim => claim.unitIds.some(id => mates.includes(id)) && claim.unitIds.every(id => statuses.get(id) === "confirmed"))) : undefined;
    if (host) {
      const claim = host.claims!.find(claim => claim.unitIds.some(id => mates.includes(id)))!;
      claim.unitIds = [...new Set([...claim.unitIds, unit.id])];
      host.unitIds = [...new Set([...host.unitIds, unit.id])];
      continue;
    }
    // The decision, then the earlier values it set aside, in one claim ("Standard UI components use a global corner radius
    // of 8px; earlier specifications for larger card (16px) and dialog (24px) radii are ignored."): each part keeps its own
    // mark when read, so the decision is said. Written again, 8px stood twice in its list.
    const setAside = chapters.flatMap(chapter => chapter.paragraphs).flatMap(paragraph => paragraph.claims ?? []).some(claim => claim.unitIds.includes(unit.id)
      && !claim.unitIds.some(id => ["open", "contested"].includes(statuses.get(id) ?? "")) && claim.unitIds.some(id => statuses.get(id) === "history")
      && /^(?:[^;；]+)[;；]\s*(?:(?:replacing|superseding|in place of)\s+)?(?:the\s+)?(?:earlier|previous|prior|former|older|original|此前|之前|原先|早先|最初)/iu.test(claim.text)
      && (([head]) => statesCore(unit.statement, head) && claimSupported(head, [unit]))(claim.text.split(/[;；]/u)));
    if (setAside) continue;
    // Told in a claim whose other units only say the same point ("The platform is strictly Web only; there are no native
    // iOS or Android apps.", cited with the AI's "V1 is Web only; no native iOS or Android apps."): the claim is the
    // decision's, marked after the sentence. Added again, "v1 is web only, with no native mobile app." stood twice in V1
    // Scope and twice among the key decisions.
    const restating = chapters.flatMap(chapter => chapter.paragraphs).flatMap(paragraph => paragraph.claims ?? []).find(claim => claim.unitIds.includes(unit.id)
      && claimSupported(claim.text, [unit]) && statesCore(unit.statement, claim.text) && claim.unitIds.some(id => id !== unit.id && statuses.get(id) !== "confirmed")
      && claim.unitIds.every(id => id === unit.id || statuses.get(id) === "confirmed" || !["open", "contested", "history"].includes(statuses.get(id) ?? "") && (other => Boolean(other) && saysMostOf(knowledgeTerms(other!.statement), unit.statement) && saysMostOf(knowledgeTerms(unit.statement), other!.statement))(byId.get(id))));
    if (restating) { restating.unitIds = restating.unitIds.filter(id => id === unit.id || statuses.get(id) === "confirmed"); restored++; continue; }
    // Told as steps ("1. 首屏：…… 2. 对话层：…… 5. 仿真：最后进行仿真操作。"), each step a claim of the decision: together
    // they state it. Added again as a sentence, the decision stood twice and the overview counted it six times.
    const steps = chapters.flatMap(chapter => chapter.paragraphs).some(paragraph => {
      const own = (paragraph.claims ?? []).filter(claim => claim.unitIds.includes(unit.id) && claim.unitIds.every(id => statuses.get(id) === "confirmed"));
      const joined = own.map(claim => claim.text).join("");
      return own.length > 1 && claimSupported(joined, [unit]) && statesCore(unit.statement, joined);
    });
    if (steps) continue;
    // A chapter's opening already telling it ("系统采用 BYOK 模式管理 API Key，默认仅保存在当前浏览器会话中且不写入服务器。"):
    // the opening cites it, and its sentence carries the mark. Added again, BYOK stood three times in one chapter.
    // Supported by the decisions the opening cites with it: "The dashboard top bar is fixed at 48px …, while standard UI
    // components use an 8px global corner radius" was no statement of the 48px decision alone, and 48px was told again.
    const openers = (chapter: WikiDraftChapter) => [unit, ...(chapter.openingUnitIds ?? []).flatMap(id => id !== unit.id && statuses.get(id) === "confirmed" ? byId.get(id) ?? [] : [])];
    // And marked there when exported: an opening telling it among much else shows no mark, and the decision is lost.
    const confirmedOf = (chapter: WikiDraftChapter) => [...new Set([...chapter.openingUnitIds ?? [], ...chapter.paragraphs.flatMap(paragraph => paragraph.unitIds)])].flatMap(id => statuses.get(id) === "confirmed" ? byId.get(id) ?? [] : []);
    const told = chapters.find(chapter => openingSentences(chapter).some(sentence => statesCore(withoutReason(unit.statement), sentence) && claimSupported(sentence, openers(chapter)) && openingSentenceMarks(sentence, unit, confirmedOf(chapter))));
    if (told) { told.openingUnitIds = [...new Set([...told.openingUnitIds ?? [], unit.id])]; restored++; continue; }
    // An opening sentence that opens on the decision and goes on to other points ("V0.1 版本明确决定不做数据云同步，所有数据
    // 仅存储在本地，禁止使用……网络请求。"): marked as a whole it says too much else, so it showed no mark and the decision was
    // added again below. The decision's clauses become a sentence of their own, which carries the mark.
    const split = chapters.flatMap(chapter => openingSentences(chapter).flatMap(sentence => {
      const clauses = sentence.split(/(?<=[，,])/u);
      for (let count = 1; count < clauses.length; count++) {
        const lead = clauses.slice(0, count).join("").replace(/[，,]\s*$/u, ""), rest = clauses.slice(count).join("").trim();
        if (rest.length >= 6 && statesCore(withoutReason(unit.statement), lead) && claimSupported(lead, openers(chapter)) && openingSentenceMarks(lead, unit, confirmedOf(chapter))) return [{ chapter, sentence, text: `${lead}${/\p{Script=Han}/u.test(lead) ? "。" : ". "}${rest}` }];
      }
      return [];
    }))[0];
    if (split && split.chapter.body.includes(split.sentence)) {
      split.chapter.body = split.chapter.body.replace(split.sentence, split.text);
      split.chapter.openingUnitIds = [...new Set([...split.chapter.openingUnitIds ?? [], unit.id])];
      restored++;
      continue;
    }
    const home = wikiUnitHome(organization, unit), chapter = chapters.find(chapter => chapter.id === home?.id);
    // A line already saying it while citing another point ("- Shared budgets are dropped entirely from the roadmap and v1
    // scope.", cited to a proposal): that line states the decision and carries its mark. Added again, one run told shared
    // budgets, bank syncing and the never-send rule twice each, the second time at a subtopic's end.
    const said = statedLine([...(chapter ? [chapter] : []), ...chapters.filter(other => other !== chapter)], unit);
    if (said) {
      const { paragraph: host, text } = said;
      host.unitIds = [...new Set([...host.unitIds, unit.id])];
      host.claims = [...(host.claims ?? []).filter(claim => !text.includes(claim.text) && !claim.text.includes(text)), { text, unitIds: [unit.id] }];
      restored++;
      continue;
    }
    if (!chapter?.paragraphs.length) continue; // A failed chapter remains a failed chapter.
    const topic = home!.subtopics.find(topic => topic.subjectIds.some(id => organization.subjects.find(subject => subject.id === id)?.unitIds.includes(unit.id)))?.title ?? chapter.paragraphs[0].subtopic;
    const text = unit.statement.trim(), paragraph = { subtopic: topic, text, unitIds: [unit.id], claims: [{ text, unitIds: [unit.id] }] };
    // A paragraph opening with the decision's own lead ("首屏采用 ChatGPT 式简洁欢迎页，用户输入需求后不直接生成 Canvas……")
    // tells how it goes on: the decision goes before it and the lead is not said twice. Added at the subtopic's end, the
    // decision repeated that paragraph's first words ten lines below it.
    const opened = leadParagraph(chapter, text);
    if (opened) {
      const { host, rest, lead } = opened, before = host.text;
      host.text = rest;
      host.claims = host.claims?.flatMap(claim => { const bare = claim.text.replace(lead, "").trim(); return rest.includes(claim.text) ? [claim] : bare.length >= 6 && rest.includes(bare) ? [{ ...claim, text: bare }] : []; });
      const placed = { ...paragraph, subtopic: host.subtopic };
      chapter.paragraphs.splice(chapter.paragraphs.indexOf(host), 0, placed);
      added.add(placed);
      chapter.body = replaceParagraph(chapter.body, before, `${text}\n\n${rest}`);
      restored++;
      continue;
    }
    // A short paragraph citing this decision alone, in other words ("Shared budget functionality has been removed from
    // the project's future plans …" for "Shared budgets are dropped entirely from the roadmap and v1 scope."): the
    // decision takes its place, as stated. Added after it, the decision was told twice in a row.
    const alone = chapter.paragraphs.find(paragraph => paragraph.unitIds.length === 1 && paragraph.unitIds[0] === unit.id && !/^\s*(?:[-*+]\s|\d+\.\s|\||>|`{3}|~{3}|\*[^*\s])/u.test(paragraph.text) && !/\n/u.test(paragraph.text.trim())
      && paragraph.text.split(/(?<=[。！？!?])|(?<=[a-z0-9)]\.)\s/u).filter(Boolean).length <= 2 && chapter.body.includes(paragraph.text)
      // Not one about another point that names the decision in its own words: "External feedback … conflicts with the
      // confirmed v1 constraint that Pocket Ledger supports USD only, …" was replaced by the rule, the feedback lost.
      && !(statesCore(unit.statement, paragraph.text) && !mostlyOf(paragraph.text, unit.statement, true))
      // Nor one saying much more than the decision: an answer kept as 「380px.」 took the place of the whole paragraph on
      // the popup's size, and the chapter was left with the bare number.
      && text.length * 3 >= paragraph.text.trim().length);
    if (alone) {
      const before = alone.text;
      chapter.body = replaceParagraph(chapter.body, before, () => text);
      Object.assign(alone, { text, claims: [{ text, unitIds: [unit.id] }] });
      restored++;
      continue;
    }
    const last = chapter.paragraphs.map(paragraph => paragraph.subtopic).lastIndexOf(topic);
    chapter.paragraphs.splice(last < 0 ? chapter.paragraphs.length : last + 1, 0, paragraph);
    added.add(paragraph);
    const heading = `### ${topic}`, at = chapter.body.indexOf(heading), next = at < 0 ? -1 : chapter.body.indexOf("\n### ", at + heading.length);
    // Before the subtopic's closing note ("> 4 more related points in the ledger"): after it, the decision read as one
    // of the points the note says are left in the ledger.
    const end = next < 0 ? chapter.body.length : next, before = chapter.body.slice(0, end).trimEnd(), note = before.match(/\n\n(> (?:相关讨论 \d+ 条[^\n]*|\d+ more related points in the ledger))$/u);
    if (at < 0) chapter.body += `\n\n${heading}\n\n${text}`;
    else if (note && note.index! > at) chapter.body = `${before.slice(0, note.index)}\n\n${text}\n\n${note[1]}${next < 0 ? "" : `\n${chapter.body.slice(next)}`}`;
    else if (next < 0) chapter.body += `\n\n${text}`;
    else chapter.body = `${chapter.body.slice(0, next).trimEnd()}\n\n${text}\n${chapter.body.slice(next)}`;
    restored++;
  }
  return restored;
}

/** The first sentence or list line of the chapters that states a unit's point in full, as its own claim text: list
 * marks and an item's label left off, so it is found in its paragraph. Source code blocks are not read. */
function statedLine(chapters: WikiDraftChapter[], unit: WikiKnowledgeUnit) {
  const core = withoutReason(unit.statement), answered = unit.statement.trim().match(/^([^：:。]{2,24}?)\s*[：:]\s*([^：:。]{1,24}?)\s*[。.]?$/u);
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    if (isSourceCodeParagraph(paragraph.text)) continue;
    const sentences = paragraph.text.split(/(?:(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))|\n/u);
    // A decision told across two sentences ("Chrome Popup 的宽度固定为 360px，高度根据内容自适应……。首页的目标高度约为
    // 460px，建议控制在 420–480px 范围内。") is said by the two together: read one at a time, neither stated it, and
    // "宽度固定为360px，高度按内容自适应。" was added again three lines below.
    const pairs = sentences.slice(0, -1).flatMap((sentence, index) => /\n$/u.test(sentence) || /^\s*(?:[-*+]|\d+\.|\|)/u.test(sentence) || /^\s*(?:[-*+]|\d+\.|\|)/u.test(sentences[index + 1]) ? [] : [`${sentence}${sentences[index + 1]}`]);
    for (const sentence of [...sentences, ...pairs]) {
      const item = sentence.trim().replace(/^(?:[-*+]|\d+\.)\s+/u, ""), label = item.match(/^\*\*([^*\n]+)\*\*\s*[：:]\s*/u)?.[1] ?? "";
      const text = item.replace(/^\*\*[^*\n]+\*\*\s*[：:]\s*/u, "").replace(/\s*(?:〔[^〕]+〕|\[[A-Z][a-z]+\])\s*$/u, "").trim();
      // Read without its bold ("**The frontend stack is confirmed as React + Vite + TypeScript**, ..."); kept as written.
      // An item's label may be its subject ("**Dashboard top bar height**: Confirmed as 48px …"): read with it.
      const plain = text.replace(/\*\*/gu, ""), labelled = label ? `${label} ${plain}` : plain;
      if (text.length >= 8 && !/^\|/u.test(text) && paragraph.text.includes(text) && (statesCore(core, plain) || statesCore(core, labelled)) && claimSupported(labelled, [unit]) && (mostlyOf(plain, unit.statement, true) || mostlyOf(labelled, unit.statement, true))) return { paragraph, text };
      // A choice kept as "subject：value" ("Popup 宽度：380px。", the user's answer) is said by a sentence naming both that
      // in a clause that does not tell it as earlier or proposed: "……两案并存的提议，但最终确认 Popup 宽度为 380px。".
      // Added again, the chapter closed on the bare choice one line below it.
      if (answered && text.length >= 8 && !/^\|/u.test(text) && paragraph.text.includes(text) && plain.split(/[，,；;]/u).some(clause => clause.toLowerCase().includes(answered[1].toLowerCase()) && clause.toLowerCase().includes(answered[2].toLowerCase()) && !/曾|早期|此前|之前|原先|建议|提出|并存|未定|待定|尚未|earlier|previous|suggest|propos/iu.test(clause))) return { paragraph, text };
    }
  }
  return undefined;
}

/** fromStart: the part opens the line. A claim citing the decision alone covers it only so: "External feedback suggests
 * supporting multiple currencies … and syncing across devices …, but Pocket Ledger v1 supports USD only; …" told it
 * after the feedback, was read as the AI's, and USD only showed no mark and no row among the key decisions.
 * Whether an English line has a part saying mostly the statement, not only a point of its own that names it:
 * "External feedback suggesting multi-currency support and cloud sync from day one conflicts with the confirmed v1
 * constraint that Pocket Ledger supports USD only, …" was taken for the USD decision's own line, and the decision showed
 * no mark anywhere, the line's 〔已定〕 lost to the feedback it is about. Read part by part, at commas and semicolons:
 * "Standard UI components use a global corner radius of 8px; earlier specifications … are ignored." says its decision
 * before the semicolon. A part must say most of the statement too, so "with multi-currency functionality explicitly
 * excluded" alone is not the USD decision. Chinese lines are read as before. */
const LINE_WORDS = /^(?:a|an|the|is|are|was|were|be|been|to|of|and|or|for|in|on|at|by|with|as|from|it|its|this|that|which|while|only)$/u;
const MOSTLY = 0.6, MOST_OF = 0.5;
function mostlyOf(line: string, statement: string, fromStart = false): boolean {
  if (/\p{Script=Han}/u.test(line) || !/[A-Za-z]{3}/u.test(line)) return true;
  const words = (text: string) => (text.toLowerCase().match(/[a-z0-9][a-z0-9-]*/gu) ?? []).filter(word => !LINE_WORDS.test(word));
  const own = new Set(words(statement));
  if (!own.size) return true;
  const parts = line.split(/[;,]/u);
  // Parts read together from the first, so a decision told across a comma ("V1 is web-only, with no native apps") counts.
  return parts.some((_, start) => (!fromStart || start === 0) && parts.slice(start).some((__, length) => {
    const said = words(parts.slice(start, start + length + 1).join(" "));
    const shared = said.filter(word => own.has(word));
    return said.length > 0 && shared.length / said.length >= MOSTLY && new Set(shared).size / own.size >= MOST_OF;
  }));
}

/** A statement without the clause giving its reason ("……，以降低运营成本并保护用户隐私"): an opening tells what was chosen. */
function withoutReason(statement: string): string {
  // Nor a closing "decide later" ("……不做数据云同步，后续再根据用户需求评估"): an opening saying "V0.1 版本明确决定不做数据
  // 云同步" states the decision, and adding it again told no cloud sync four times in two chapters.
  return statement.split(/(?<=[，,；;])/u).filter((clause, index) => !/^\s*(?:以|为了|旨在|从而|以便|以免)/u.test(clause) && !(index > 0 && /^\s*(?:后续|以后|之后|将来|未来|日后)(?:再|可|会)?/u.test(clause))).join("").replace(/[，,；;]\s*$/u, "");
}

/** The sentences of a chapter's opening, before its first subtopic. */
function openingSentences(chapter: WikiDraftChapter): string[] {
  const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0];
  return opening.split(/(?:(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))/u).map(sentence => sentence.trim()).filter(Boolean);
}

/** The plain paragraph of a chapter that opens with a statement's lead clause (eight characters or more, spaces aside),
 * and its text without that lead. */
const LEAD_MIN = 8;
function leadParagraph(chapter: WikiDraftChapter, statement: string) {
  const lead = statement.split(/[，,；;。]/u)[0].trim(), bare = (text: string) => text.replace(/\s+/gu, "");
  if (bare(lead).length < LEAD_MIN) return undefined;
  const pattern = new RegExp(`^\\s*${[...bare(lead)].map(char => char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("\\s*")}\\s*[，,；;]\\s*`, "u");
  for (const host of chapter.paragraphs) {
    if (/^\s*(?:[-*+]\s|\d+\.\s|\||>)/u.test(host.text)) continue;
    const match = host.text.match(pattern);
    if (!match) continue;
    const rest = host.text.slice(match[0].length).trim();
    if (rest.length >= 6) return { host, rest, lead: new RegExp(pattern.source.slice(1), "u") };
  }
  return undefined;
}

/** A legacy merge must not hide the only explicit adoption behind an unconfirmed
 * canonical wording. Re-expose that point without deleting either source. */
export function preserveMergedWikiDecisions(organization: WikiKnowledgeOrganization, statuses: Map<string, WikiUnitStatus>, report: Record<string, number>): WikiKnowledgeOrganization {
  const restore = new Map(organization.merged.flatMap(row => row.from.filter(id => statuses.get(id) === "confirmed" && statuses.get(row.id) !== "confirmed").map(id => [id, row.id] as const)));
  if (!restore.size) return organization;
  const subjects = organization.subjects.map(subject => ({ ...subject, unitIds: [...subject.unitIds, ...[...restore].filter(([, into]) => subject.unitIds.includes(into)).map(([id]) => id)] }));
  report.confirmed_merge_restored = restore.size;
  return { ...organization, subjects, merged: organization.merged.map(row => ({ ...row, from: row.from.filter(id => !restore.has(id)) })) };
}
