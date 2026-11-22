import { wikiLedgerUnits, type WikiKnowledgeLedger, type WikiKnowledgeUnit, type WikiUserAnswer } from "./wiki-knowledge";
import { replaceParagraph } from "./wiki-body-text";
import { wikiUnitChapterHomes } from "./wiki-chapter-links";
import type { WikiDraftChapter } from "./wiki-knowledge";
import { knowledgeTerms } from "./knowledge-subject";
import { wikiFlowSteps } from "./wiki-flow-steps";
import { wikiDocumentBlocks } from "./wiki-document-blocks";
import { wikiSupplementRanges } from "./wiki-source-supplements";
import { wikiTableCells } from "./wiki-table-source";
import { wikiRoadmapScope } from "./wiki-roadmap-scope";

const ORDER = /\b(Phase|Milestone|M)\s*(\d{1,2})\s*(?:[-–—~～至到]|through|to)\s*(?:\1)?\s*(\d{1,2})\b/iu;
const FAMILY = /\b(Phase|Milestone|M)\s*(\d{1,2})\b/giu;
const CHOICE = /顺序|路线|里程碑|阶段|按(?:照)?\s*(?:Phase|Milestone|[MP]\s*\d)|\b(?:order|roadmap|develop|follow)\b/iu;
const UNSETTLED = /未定|待定|不采用|暂不|两者|both|neither|undecided/iu;

export interface WikiConfirmedRoadmap {
  proposalId: string;
  order: string[];
  unitId: string;
  stages: Array<{ label: string; title: string; unitId: string }>;
}

const familyName = (value: string) => ({ phase: "Phase", milestone: "Milestone", m: "M", p: "P" })[value.toLowerCase()]!;
const labelOf = (family: string, index: number) => family.length === 1 ? family + index : family + " " + index;
const confirmedOrderLead = /^[>\s*]*(?:(?:当前|目前|(?:开发|实施|交付)顺序(?:已确认|确认为|确定为|已确认为))\s*)?(?:严格)?(?:按(?:照)?|遵循|follow|develop)\s*(?:the\s+)?(?:Phase|Milestone|M|P)\s*\d+/iu;

function namedOrder(text: string, order: string[]) {
  const match = text.trim().match(/^[^：:\n]{2,75}[：:]([^\n]+)$/u);
  const titles = match ? wikiFlowSteps(match[1].replace(/[。.]$/u, "")).steps.map(title => title.trim()) : undefined;
  if (!titles || titles.length !== order.length || titles.some(title => !title || title.length > 100 || /[…；;|]/u.test(title))
    || new Set(titles).size !== titles.length) return [];
  return titles;
}

export function roadmapStageLabels(text: string) {
  return [...text.matchAll(FAMILY)].map((match) => labelOf(familyName(match[1]), Number(match[2])));
}

/** Freeze a chosen order. A row needs a literal stage heading from the same proposal source. */
export function confirmedRoadmapChoice(ledger: WikiKnowledgeLedger, answer: WikiUserAnswer): WikiConfirmedRoadmap | undefined {
  const range = answer.answer.match(ORDER);
  if (!range || !CHOICE.test(answer.question + " " + answer.answer) || UNSETTLED.test(answer.answer)) return;
  const first = Number(range[2]), last = Number(range[3]), family = familyName(range[1]);
  if (last <= first || last - first > 20) return;
  const order = Array.from({ length: last - first + 1 }, (_, index) => labelOf(family, first + index));
  const units = wikiLedgerUnits(ledger).filter(unit => !unit.about && !unit.evidence.pasted);
  const chosen = ledger.writingQuestions?.find(question => question.id === answer.questionId)?.options.find(option => option.id === answer.optionId);
  const eligible = new Set(chosen ? chosen.actions.filter(action => action.do === "confirm").flatMap(action => action.units) : answer.unitIds);
  const source = units.find(unit => {
    const stated = (unit.statement + "\n" + unit.evidence.quote).match(ORDER);
    return eligible.has(unit.id) && ledger.decisions?.[unit.id]?.verdict !== "rejected" && stated
      && familyName(stated[1]) === family && Number(stated[2]) === first && Number(stated[3]) === last;
  });
  if (!source) return;
  const names = namedOrder(source.statement, order);
  const orderConfirmed = ledger.decisions?.[source.id]?.verdict === "confirmed";
  const staged = order.flatMap(label => {
    const candidates = new Map<string, string>();
    for (const unit of units) {
      if (unit.evidence.conversationId !== source.evidence.conversationId || unit.evidence.messageId !== source.evidence.messageId
        || ledger.decisions?.[unit.id]?.verdict === "rejected") continue;
      for (const line of unit.evidence.quote.split("\n")) {
        const heading = line.match(/^\s*#{1,6}\s+(.+)$/u)?.[1].trim();
        if (!heading || roadmapStageLabels(heading).join() !== label) continue;
        const title = heading.replace(/^(?:Phase|Milestone|M|P)\s*\d+\s*(?:[:：\-—–]\s*)?/iu, "").trim();
        if (title) candidates.set(title, unit.id);
      }
    }
    return candidates.size === 1 ? [...candidates].map(([title, unitId]) => ({ label, title, unitId })) : [];
  });
  // A complete sequence in the confirmed statement can fill missing rows.
  // Without a verdict on that statement, require the original quote to state it.
  const stages = names.length && (orderConfirmed || namedOrder(source.evidence.quote, order).join() === names.join())
    ? order.map((label, index) => ({ label, title: names[index], unitId: source.id }))
    : staged;
  return { proposalId: JSON.stringify([source.evidence.conversationId, source.evidence.messageId, order[0], order.at(-1)]), order, unitId: source.id, stages };
}

export function confirmedRoadmaps(ledger: WikiKnowledgeLedger) {
  if (!ledger.userAnswers?.length) return [];
  const units = new Set(wikiLedgerUnits(ledger).filter(unit => !unit.about && !unit.evidence.pasted).map(unit => unit.id));
  const plans = new Map<string, { plan: WikiConfirmedRoadmap; answer: WikiUserAnswer }>();
  for (const answer of [...ledger.userAnswers ?? []].sort((a, b) => b.at - a.at)) {
    const plan = answer.roadmap ?? confirmedRoadmapChoice(ledger, answer);
    if (!plan || !units.has(plan.unitId) || ledger.decisions?.[plan.unitId]?.verdict === "rejected" || ledger.decisions?.[plan.unitId]?.verdict === "open") continue;
    const derived = plan.stages.length < plan.order.length ? confirmedRoadmapChoice(ledger, answer) : undefined;
    const stages = derived?.proposalId === plan.proposalId && derived.stages.length > plan.stages.length ? derived.stages : plan.stages;
    if (!plans.has(plan.proposalId)) plans.set(plan.proposalId, {
      plan: { ...plan, stages: stages.filter(stage => units.has(stage.unitId) && ledger.decisions?.[stage.unitId]?.verdict !== "rejected") }, answer,
    });
  }
  return [...plans.values()];
}

export function wikiRoadmapScopes(ledger: WikiKnowledgeLedger, plans = confirmedRoadmaps(ledger).map(({ plan }) => plan)) {
  const memberships = new Map<string, Set<string>>();
  const replaced = new Set(ledger.organization?.relations.flatMap(relation => relation.kind === "replaces"
    && relation.status === "resolved" && relation.evidence ? [relation.older] : []));
  for (const plan of plans) for (const id of new Set([plan.unitId, ...plan.stages.map(stage => stage.unitId)])) {
    const previous = memberships.get(id) ?? new Set<string>();
    previous.add(plan.proposalId);
    memberships.set(id, previous);
  }
  return new Map(wikiLedgerUnits(ledger).flatMap(unit => {
    if (unit.about) return [];
    const schemes = memberships.get(unit.id);
    const metadata = wikiRoadmapScope(unit, {
      schemeId: schemes?.size === 1 ? [...schemes][0] : undefined,
      superseded: replaced.has(unit.id),
    });
    return metadata.rawLabels.length || metadata.priorities.length || metadata.bucket || metadata.schemeId || metadata.replacement
      ? [[unit.id, metadata] as const] : [];
  }));
}

export function confirmedRoadmapText(plan: WikiConfirmedRoadmap, zh: boolean) {
  const first = plan.order[0], last = plan.order.at(-1) ?? first;
  const order = first + "–" + (first.includes(" ") ? last.replace(/^.*\s/u, "") : last);
  return zh ? "按 " + order + " 的阶段顺序推进。" : "Follow the " + order + " delivery order.";
}

const ROADMAP_TOPIC = /路线图|里程碑|迭代顺序|开发阶段|\b(?:roadmap|milestones|delivery order)\b/iu;

function restatesOrder(text: string, plan: WikiConfirmedRoadmap) {
  const normalized = text.replace(/^>\s*/u, "").replace(/\*\*/gu, "").trim();
  const bounds = normalized.match(ORDER);
  if (!bounds || !confirmedOrderLead.test(normalized)
    || !matchesRoadmapOrder(bounds, plan)) return false;
  const names = namedOrder(normalized, plan.order);
  if (names.length) return names.every((name, index) => name === plan.stages.find(stage => stage.label === plan.order[index])?.title);
  const tail = normalized.slice(bounds.index! + bounds[0].length).trim();
  return /^(?:(?:的)?(?:阶段)?(?:顺序)?(?:进行)?(?:推进|开发|实施|执行)?|delivery order)\s*[。.]*$/iu.test(tail);
}

function matchesRoadmapOrder(bounds: RegExpMatchArray, plan: WikiConfirmedRoadmap) {
  return labelOf(familyName(bounds[1]), Number(bounds[2])) === plan.order[0]
    && labelOf(familyName(bounds[1]), Number(bounds[3])) === plan.order.at(-1);
}

export function wikiRejectedReadingOfConfirmedOrder(text: string, plan: WikiConfirmedRoadmap) {
  const bounds = text.match(ORDER);
  return Boolean(bounds && matchesRoadmapOrder(bounds, plan)
    && /^\s*(?:此前|早期|早先)(?:曾)?(?:提议|提出|讨论)的/iu.test(text)
    && /^(?:\s*(?:里程碑|阶段)?(?:顺序|路线图|规划)(?:已|曾)?被(?:否定|否决|拒绝))(?:[，,](?:已)?统一为单一(?:路线图|规划))?[。.]?$/u
      .test(text.slice(bounds.index! + bounds[0].length)));
}

/** The canonical stage table follows its own lead even if an older document
 * stored the table in the surrounding release notes. */
export function groupWikiConfirmedRoadmap(body: string, plan: WikiConfirmedRoadmap, zh: boolean) {
  const lead = confirmedRoadmapText(plan,zh);
  if (!plan.stages.length || !body.includes(lead) || !/\|\s*(?:交付主题|Delivery topic)\s*\|/iu.test(body)) return body;
  const attachments = wikiSupplementRanges(body);
  const blocks = wikiDocumentBlocks(body).filter(block => !attachments.some(([start,end])=>block.start>=start&&block.end<=end));
  const leadBlock = blocks.find(block=>block.kind==="paragraph"&&block.text===lead);
  const tables = blocks.filter(block=>{
    if(block.kind!=="table")return false;
    const [headers, , ...rows]=block.text.split("\n").map(wikiTableCells);
    return /^(?:阶段|Stage)$/iu.test(headers[0])&&/^(?:交付主题|Delivery topic)$/iu.test(headers[1]??"")
      && rows.length===plan.stages.length
      && rows.every((row,index)=>row[0]===plan.stages[index].label&&row[1]===plan.stages[index].title.replace(/\|/gu,"\\|"));
  });
  if (!leadBlock || tables.length!==1 || tables[0]===blocks[blocks.indexOf(leadBlock)+1]) return body;
  const [table]=tables;
  const caption=blocks[blocks.indexOf(table)-1];
  const start=caption?.kind==="paragraph"&&/^(?:表格来源|原文来源|Table source|Original source)\s+\[/iu.test(caption.text)?caption.start:table.start;
  const edits=[{start,end:table.end,text:""},{start:leadBlock.end,end:leadBlock.end,text:"\n\n"+body.slice(start,table.end)}];
  for(const edit of edits.sort((a,b)=>b.start-a.start))body=body.slice(0,edit.start)+edit.text+body.slice(edit.end);
  return body.replace(/\n{3,}/gu,"\n\n").trim();
}

function stripRoadmapEchoes(chapter: WikiDraftChapter, plan: WikiConfirmedRoadmap, canonical: string,
  alternative: ReadonlyMap<string, WikiKnowledgeUnit>, zh: boolean) {
  let body = chapter.body;
  const paragraphs = chapter.paragraphs.map(paragraph => {
    if (/^\s*(?:\||>|#|[-*+]\s|\d+\.\s|`{3}|~{3})|\n/u.test(paragraph.text)) return paragraph;
    const sentences = paragraph.text.split(/(?<=[。！？])/u);
    const echoes = sentences.filter(sentence => sentence.trim() !== canonical && restatesOrder(sentence, plan));
    if (!echoes.length || echoes.length === sentences.filter(Boolean).length) return paragraph;
    const sequence = (value: string) => roadmapStageLabels(value).join();
    const replacements = new Map(sentences.flatMap(sentence => {
      const labels = sequence(sentence);
      if (!labels || !/^(?:项目)?(?:早期|早先|此前)(?:曾)?(?:按|依照)|^earlier[ ,]+(?:the project )?followed/iu.test(sentence.trim())) return [];
      const matches = paragraph.unitIds.flatMap(id => alternative.get(id) ?? []).filter(unit => sequence(unit.statement) === labels);
      if (matches.length !== 1) return [];
      const statement = matches[0].statement.replace(/[。.]$/u, "");
      return [[sentence, (zh ? "此前讨论的开发顺序：" : "Earlier proposed delivery order: ") + statement + (zh ? "。" : ".")] as const];
    }));
    const revise = (value: string) => {
      let text = value;
      for (const sentence of echoes) text = text.replace(sentence.trim(), "");
      for (const [sentence, replacement] of replacements) text = text.replace(sentence.trim(), () => replacement);
      return text.trim();
    };
    const text = revise(paragraph.text);
    const claims = paragraph.claims?.flatMap(claim => {
      const revised = revise(claim.text);
      const unitIds = echoes.some(echo => claim.text.includes(echo.trim())) ? claim.unitIds.filter(id => id !== plan.unitId) : claim.unitIds;
      return revised && unitIds.length && text.includes(revised) ? [{ ...claim, text: revised, unitIds }] : [];
    });
    body = replaceParagraph(body, paragraph.text, () => text);
    return { ...paragraph, text, claims, unitIds: paragraph.unitIds.filter(id => id !== plan.unitId || claims?.some(claim => claim.unitIds.includes(id))) };
  });
  return body === chapter.body ? chapter : { ...chapter, body, paragraphs };
}

function repeatsRoadmapTable(paragraph: WikiDraftChapter["paragraphs"][number], plan: WikiConfirmedRoadmap) {
  const lines = paragraph.text.split(/\n+/u);
  if (!plan.stages.length || lines.length !== plan.stages.length || paragraph.unitIds.some(id => id !== plan.unitId && !plan.stages.some(stage => stage.unitId === id))) return false;
  return lines.every((line,index) => {
    const match = line.match(/^\s*(\d{1,2})[.)]\s+(?:\*\*)?(?:(?:第\s*[一二三四五六七八九十\d]+\s*阶段)\s*(?:\*\*)?\s*[：:]\s*)?(.+)/u);
    if (!match || Number(match[1]) !== index + 1 || /如果|仅当|必须|禁止|除非|不得|\b(?:if|unless|must|never)\b/iu.test(match[2])) return false;
    const prose = match[2].replace(/\*\*/gu,"");
    const terms = knowledgeTerms(prose);
    const title = plan.stages[index].title.trim().split(/[（(:：]/u)[0];
    const expected = knowledgeTerms(title);
    return expected.size>0 && [...expected].every(term=>terms.has(term))
      && [...prose.matchAll(/\d+(?:\.\d+)?/gu)].every(value=>plan.stages[index].title.includes(value[0]));
  });
}

/** The writer can repeat the selected roadmap as a list and append unrelated
 * scope claims to its rows. Keep those claims with their own sources. */
export function unbundleWikiRoadmapList(paragraph: WikiDraftChapter["paragraphs"][number], plan: WikiConfirmedRoadmap) {
  if (plan.stages.length !== plan.order.length || !plan.stages.length || !paragraph.claims?.length) return;
  const lines = paragraph.text.trim().split("\n");
  if (lines.length !== plan.stages.length) return;
  const stageIds = new Set([plan.unitId, ...plan.stages.map(stage => stage.unitId)]);
  const result: WikiDraftChapter["paragraphs"] = [];
  for (const [index, line] of lines.entries()) {
    const row = line.match(/^\s*\d{1,2}[.)]\s+\*\*([^*]+)\*\*\s*[：:]\s*(.+)$/u);
    if (!row || roadmapStageLabels(row[1]).join() !== plan.order[index]) return;
    const first = row[2].match(/^.+?(?:[。！？]|[.!?](?=\s|$))/u)?.[0];
    if (!first || /如果|仅当|必须|禁止|除非|不得|仅限|至少|不支持|之前|之后|\d|\b(?:if|unless|must|never|at least)\b/iu.test(first.replace(plan.stages[index].title,""))) return;
    const related = paragraph.claims.filter(claim => claim.text && row[2].includes(claim.text));
    if (!related.some(claim => claim.text.startsWith(first) && claim.unitIds.some(id => stageIds.has(id)))) return;
    const tail = row[2].slice(first.length).trim();
    if (!tail) continue;
    const claims = related.flatMap(claim => {
      const text = claim.text.startsWith(first) ? claim.text.slice(first.length).trim() : claim.text;
      const unitIds = claim.unitIds.filter(id => !stageIds.has(id));
      return text && tail.includes(text) && unitIds.length ? [{...claim,text,unitIds}] : [];
    });
    if (!claims.some(claim => claim.text === tail)) return;
    result.push({text:tail,subtopic:paragraph.subtopic,unitIds:[...new Set(claims.flatMap(claim=>claim.unitIds))],claims});
  }
  return result;
}

function separateSelectedRoadmap(chapter: WikiDraftChapter, plan: WikiConfirmedRoadmap) {
  let body=chapter.body;
  const paragraphs=chapter.paragraphs.flatMap(paragraph=>{
    if(!body.includes(paragraph.text)||body.indexOf(paragraph.text)!==body.lastIndexOf(paragraph.text))return [paragraph];
    const unpacked=unbundleWikiRoadmapList(paragraph,plan);
    if(!unpacked)return [paragraph];
    body=replaceParagraph(body,paragraph.text,()=>unpacked.map(item=>item.text).join("\n\n"));
    return unpacked;
  });
  return body===chapter.body?chapter:{...chapter,body,paragraphs};
}

export function withPinnedRoadmapChapters(chapters: WikiDraftChapter[], ledger: WikiKnowledgeLedger, zh: boolean) {
  if (!ledger.organization || ledger.documentType === "learning") return chapters;
  const homes = wikiUnitChapterHomes(ledger.organization);
  let result = chapters;
  const units = wikiLedgerUnits(ledger);
  const choices = confirmedRoadmaps(ledger);
  for (const { plan, answer } of choices) {
    result=result.map(chapter=>separateSelectedRoadmap(chapter,plan));
    const bodyText = confirmedRoadmapText(plan, zh);
    if (result.some(chapter => chapter.paragraphs.some(paragraph => paragraph.unitIds.includes(plan.unitId)))) {
      const rejected = new Set(answer.unitIds.filter(id => ledger.decisions?.[id]?.verdict === "rejected" && ledger.decisions[id].at === answer.at));
      const alternative = new Map(units.filter(unit => rejected.has(unit.id) && !unit.about && !unit.evidence.pasted).map(unit => [unit.id, unit]));
      const compact = result.map(chapter => stripRoadmapEchoes(chapter, plan, bodyText, alternative, zh));
      if (compact.some((chapter, index) => chapter !== result[index])) result = compact;
    }
    let home = result.find(chapter => chapter.paragraphs.length && chapter.id === homes.get(plan.unitId))
      ?? result.find(chapter => chapter.paragraphs.some(paragraph => paragraph.unitIds.includes(plan.unitId)))
      ?? result.find(chapter => chapter.paragraphs.some(paragraph => ROADMAP_TOPIC.test(paragraph.subtopic)));
    if (!home) continue;
    const header = zh ? "| 阶段 | 交付主题 |" : "| Stage | Delivery topic |";
    const cell = (text: string) => text.replace(/\|/gu, "\\|");
    const table = [header, "| --- | --- |", ...plan.stages.map(stage => `| ${stage.label} | ${cell(stage.title)} |`)].join("\n");
    const duplicateLists = new Set(home.paragraphs.filter(paragraph =>
      ROADMAP_TOPIC.test(paragraph.subtopic) && repeatsRoadmapTable(paragraph, plan)
      || paragraph.text !== bodyText && restatesOrder(paragraph.text, plan)
        && paragraph.unitIds.every(id => id === plan.unitId || plan.stages.some(stage => stage.unitId === id))));
    const alternativeLabel=zh?"其他阶段提案。":"Proposed stages from a separate discussion.";
    const source=units.find(unit=>unit.id===plan.unitId);
    const alternatives=source&&home.paragraphs.filter(paragraph=>ROADMAP_TOPIC.test(paragraph.subtopic)
      &&/^(?:\s*(?:[-*+]\s+|\d+[.)]\s+))?(?:\*\*)?(?:Phase|Milestone|M|P)\s*\d+\b/iu.test(paragraph.text)
      &&paragraph.unitIds.length&&paragraph.unitIds.every(id=>units.some(unit=>unit.id===id&&
          (unit.evidence.conversationId!==source.evidence.conversationId||unit.evidence.messageId!==source.evidence.messageId)
          &&ledger.decisions?.[id]?.verdict!=="confirmed")));
    if(alternatives?.length){
      const previous=home;
      home={...previous,body:alternatives.reduce((body,paragraph)=>replaceParagraph(body,paragraph.text,()=>alternativeLabel+"\n\n"+paragraph.text),previous.body),
        paragraphs:previous.paragraphs.map(paragraph=>alternatives.includes(paragraph)?{...paragraph,text:alternativeLabel+"\n\n"+paragraph.text}:paragraph)};
      result=result.map(chapter=>chapter===previous?home!:chapter);
    }
    if (home.paragraphs.some(paragraph => paragraph.text === bodyText && paragraph.unitIds.includes(plan.unitId))
      && (!plan.stages.length || home.paragraphs.some(paragraph => paragraph.text === table))) {
      if (duplicateLists.size) result=result.map(chapter=>chapter!==home?chapter:{
        ...chapter,
        body:[...duplicateLists].reduce((text,paragraph)=>replaceParagraph(text,paragraph.text,""),chapter.body).replace(/\n{3,}/gu,"\n\n").trim(),
        paragraphs:chapter.paragraphs.filter(paragraph=>!duplicateLists.has(paragraph)),
      });
      continue;
    }
    const target = zh ? "交付路线图" : "Delivery roadmap";
    result = result.map(chapter => {
      const drop = chapter.paragraphs.filter(paragraph => duplicateLists.has(paragraph)
        || paragraph.text === bodyText && paragraph.unitIds.includes(plan.unitId));
      if (!drop.length && chapter !== home) return chapter;
      let body = chapter.body;
      for (const paragraph of drop) body = replaceParagraph(body, paragraph.text, "");
      const opening = body.split(/(?=^###\s)/mu)[0];
      const openingSentences = opening.match(/[^。！？\n]+[。！？]?/gu) ?? [];
      const oldOpening = openingSentences.filter(sentence => restatesOrder(sentence, plan));
      if (chapter === home && oldOpening.length) {
        let cleaned = opening;
        for (const sentence of oldOpening) cleaned = cleaned.replace(sentence, "");
        body = cleaned.trim() + "\n\n" + body.slice(opening.length);
      }
      const paragraphs = chapter.paragraphs.filter(paragraph => !drop.includes(paragraph));
      const problems = chapter.problems.filter(problem => !drop.some(paragraph => problem.startsWith('"' + paragraph.text.slice(0, 24) + '…"')));
      if (chapter === home) {
        const additions: WikiDraftChapter["paragraphs"] = [
          { subtopic: target, text: bodyText, unitIds: [plan.unitId], claims: [{ text: bodyText, unitIds: [plan.unitId] }] },
        ];
        if (plan.stages.length) additions.push({
          subtopic: target, text: table, unitIds: [...new Set(plan.stages.map(stage => stage.unitId))],
          // The lead cites the confirmed sequence once. Rows independently
          // cite only stage details that come from a different source unit.
          claims: plan.stages.filter(stage => stage.unitId !== plan.unitId).map(stage => ({ text: cell(stage.title), unitIds: [stage.unitId], markOnly: true })),
        });
        const at = paragraphs.findIndex(paragraph => paragraph.subtopic === target);
        paragraphs.splice(at < 0 ? paragraphs.length : at, 0, ...additions);
        const heading = "### " + target, text = additions.map(item => item.text).join("\n\n");
        const position = body.indexOf(heading + "\n");
        body = position < 0 ? body + "\n\n" + heading + "\n\n" + text
          : body.slice(0, position + heading.length) + "\n\n" + text + "\n\n" + body.slice(position + heading.length).trimStart();
      }
      return { ...chapter, body: body.replace(/\n{3,}/gu, "\n\n").trim(), paragraphs, problems };
    });
  }
  for(const {plan,answer} of choices){
    const ranges=[...answer.question.matchAll(new RegExp(ORDER.source,"giu"))].filter(bounds=>!matchesRoadmapOrder(bounds,plan));
    if(ranges.length!==1)continue;
    const [other]=ranges, from=Number(other[2]), to=Number(other[3]), family=familyName(other[1]);
    if(to<=from||to-from>20)continue;
    const labels=Array.from({length:to-from+1},(_,index)=>labelOf(family,from+index));
    const alternative=units.find(unit=>{
      if(unit.about||unit.evidence.pasted||!answer.unitIds.includes(unit.id)
        ||ledger.decisions?.[unit.id]?.verdict!=="rejected"||ledger.decisions[unit.id].at!==answer.at)return false;
      return labels.every(label=>roadmapStageLabels(unit.statement).includes(label));
    });
    if(!alternative)continue;
    result=result.map(chapter=>{
      const lead=confirmedRoadmapText(plan,zh);
      const previous=chapter.paragraphs.find(paragraph=>paragraph.text===lead&&paragraph.unitIds.includes(plan.unitId));
      if(!previous||chapter.paragraphs.some(paragraph=>paragraph.unitIds.includes(alternative.id)&&/此前|早先|未选|earlier|not selected/iu.test(paragraph.text)))return chapter;
      const order=other[0].replace(/\s*[-–—~～]\s*/u,"–");
      const text=zh?`此前讨论的 ${order} 方案在这次整理中未被选为交付顺序。`
        :`The earlier ${order} proposal was not selected for this delivery order.`;
      const body=replaceParagraph(chapter.body,lead,()=>lead+"\n\n"+text);
      if(body===chapter.body)return chapter;
      return {...chapter,body,paragraphs:[...chapter.paragraphs,{subtopic:previous.subtopic,text,unitIds:[alternative.id],
        claims:[{text,unitIds:[alternative.id]}]}]};
    });
  }
  return result;
}
