import type { FocusSection } from "./focus-session";
import type { WikiClaim } from "./wiki-claims";
import { wikiDocumentBlocks } from "./wiki-document-blocks";
import type { WikiKnowledgeLedger, WikiKnowledgeUnit, WikiUnitStatus } from "./wiki-knowledge";
import { knowledgeTerms } from "./knowledge-subject";
import { wikiQuoteAsksOnlyForFeedback } from "./wiki-said-in-quote";
import { wikiStageLabels } from "./wiki-roadmap-scope";
import { repairGeneratedWikiTable } from "./wiki-table-source";

/** Reviews of a previously exported artifact stay in the source conversation. */
export function wikiIsDocumentReviewTable(text: string): boolean {
  const header = text.split("\n", 1)[0];
  return /(?:评估维度|评审维度|evaluation (?:dimension|criteria))/iu.test(header)
    && /评分|score/iu.test(header)
    && /(?:文档|稿件|导出|Codex\s*开发指导|结构与信息密度|document|draft|export)/iu.test(text)
    && /\d\s*\/\s*10\b/u.test(text);
}

const DOCUMENT_REVIEW = /(?:上一版|这版|这份|当前|本次|重新组织成.{0,8}层).{0,28}(?:文档|导出稿|知识库)|(?:文档|导出稿|知识库).{0,12}(?:评分|组织建议|重组|完整度|区分.{0,12}Implemented)|Codex\s*开发指导价值|(?:draft|export|generated document).{0,20}(?:review|rating|score)/iu;
const ARTIFACT_STATUS_TAXONOMY = /(?:知识库|导出稿|文档).{0,35}\bImplemented\b.{0,48}\bReported\b.{0,48}\bPlanned\b.{0,48}\bExperimental\b/iu;
const DOC_FILES = /\b(?:PROJECT_OVERVIEW|DECISIONS_AND_HISTORY|ARCHITECTURE)\.md\b/giu;
const CAREER_SECTION = /(?:你.{0,5}(?:适合|该选|最适合)的.{0,8}(?:技术栈|方向|路线)|(?:大二|大三|在校|转行).{0,16}(?:学习|就业|路线)|(?:学习|求职|就业|职业|实习).{0,6}(?:规划|路线|建议)|career(?: path| advice| plan))/iu;
const CAREER_CONTENT = /(?:大二|大三|就业|专业壁垒|职业|高薪岗位|找工作|学习路线|适合你的|行业前景|工业机器人.{0,28}(?:安装量|需求)|career|job market)/iu;

export function wikiIsProjectAside(unit: Pick<WikiKnowledgeUnit, "statement" | "subject" | "facet" | "adoption" | "about"> & {
  evidence: Pick<WikiKnowledgeUnit["evidence"], "role" | "section" | "quote" | "code">;
}): boolean {
  if (unit.adoption.status === "user_decision" || unit.adoption.status === "user_adopted") return false;
  if (unit.evidence.code?.language === "table" && wikiIsDocumentReviewTable(unit.evidence.code.text)) return true;
  const point = [unit.subject, unit.facet, unit.statement].join(" ");
  const context = [unit.evidence.section, unit.evidence.quote].join(" ");
  if (ARTIFACT_STATUS_TAXONOMY.test(point) && unit.evidence.role === "assistant" && /评审|导出|文档结构|重新组织|计划做什么.{0,25}已经做了什么/u.test(context)) return true;
  const review = DOCUMENT_REVIEW.test(point)
    && (DOCUMENT_REVIEW.test(context) || /\d\s*\/\s*10\b/u.test(point))
    && (/\bImplemented\b.{0,45}\b(?:Reported|Planned)\b/iu.test(point)
      || [...point.matchAll(DOC_FILES)].length >= 2
      || /评分|导出稿|文档组织建议|Codex\s*开发指导价值|评审维度|score|rating/iu.test(point));
  if (review) return true;
  return unit.evidence.role === "assistant" && !unit.about
    && CAREER_SECTION.test(unit.evidence.section ?? "") && CAREER_CONTENT.test(point);
}

/** Remove surviving generated sentences of projected-out units in older drafts. */
export function withoutWikiProjectAsideProse(body: string, asides: readonly WikiKnowledgeUnit[]) {
  const key = (text: string) => text.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu,"").toLowerCase();
  const anchors = asides.map(unit => key(unit.statement)).filter(text => text.length >= 24);
  for (const block of wikiDocumentBlocks(body).reverse()) {
    if (block.kind === "table" && wikiIsDocumentReviewTable(block.text)) {
      body = body.slice(0,block.start) + body.slice(block.end);
      continue;
    }
    if (block.kind !== "paragraph" && block.kind !== "list") continue;
    const sentences = block.text.split(/(?<=[。！？])|(?<=[.!?])(?=\s)|(?<=\n)(?=\s*(?:[-*+]|\d+\.)\s)/u);
    const kept = sentences.filter(sentence => {
      const value = key(sentence);
      return !anchors.some(anchor => value===anchor || value.startsWith(anchor.slice(0,18)) && value.endsWith(anchor.slice(-12)));
    }).join("");
    if (kept===block.text) continue;
    const text=kept.trim().replace(/^\s*(?:[-*+]|\d+\.)\s*$/gmu,"");
    if (text!==block.text) body = body.slice(0,block.start) + text + body.slice(block.end);
  }
  return body;
}

const PROCESS = /^(?:(?:用户|项目发起人|发起人)(?:曾)?(?:展示|上传|提供)(?:了)?(?:一张|一组|当前|现有|项目的|小程序的|页面的|当前小程序的|界面|页面|设计稿){0,4}(?:截图|图片)[。.]?|(?:the )?(?:user|project author) (?:showed|uploaded|provided) (?:a |the )?(?:(?:current|app|UI) )*screenshots?[.!]?)$/iu;
const ARTIFACT_REQUEST = /^(?:(?:用户|项目发起人|发起人)\s*)?(?:请|需要|希望|要求|可以|能否)?\s*(?:帮我|给我)?\s*(?:提供|给|写|生成|整理)\s*(?:一个|一份)?\s*(?:准确|完整|具体|最终|合适)?的?\s*(?:提示词|开发提示词)(?:[，,]\s*(?:并|可以)?\s*(?:参考|借鉴)(?:现有的?)?(?:开源)?(?:项目|方案))?[。.!？?]?$/iu;
const OBSERVATION = /^(?:(?:此外|当时)[，,]\s*)?(?:项目发起人|发起人|用户)(?:指出|表示|感觉|观察到)[^。！？\n]{0,18}(?:星期一|周一|周二|工作日)[^。！？\n]{0,24}(?:较少|更少|减少|不多)[。.]?$/u;
const PAST_REJECTION = /[，,；;]\s*(?:该|这一|此)(?:历史)?方案已被否决[。.]?$/u;
const STATIC_DECISION = /^>\s*(?:\*\*)?(?:版本未定|范围有分歧|Not settled|Scope is disputed)(?=\s|[：:*·]|$)/iu;

export function withoutWikiVersionCards(body: string) {
  const cards = wikiDocumentBlocks(body).filter(block => block.kind === "blockquote" &&
    STATIC_DECISION.test(block.text) && /^>\s*(?:\*\*)?(?:版本未定|Not settled)/iu.test(block.text));
  return cards.reverse().reduce((text, card) => text.slice(0, card.start) + text.slice(card.end), body);
}
const AUDIT_NOTE = /以上数据为讨论中引用的外部信息，未独立核验。|下文为讨论时的竞品记录。来源链接与核实日期以原文为准，未明确核实的能力仍待核验。|Competitor information reflects the discussion\. Links and verification dates come from its sources\. Capabilities without explicit verification remain unverified\./giu;
const DEFINITE = /(?<!未|尚未|并未)(?:已(?:经)?确认(?:采用)?|已决定(?:采用)?|确认为|\b(?:was|is|has been) confirmed(?: as)?\b)/iu;
const trim = (text: string) => text.trim().replace(/[\s*]/gu, "").replace(/[。.!?！？]$/u, "");
const decisionKey = (text: string) => trim(text.normalize("NFKC")).replace(/:是[,，](?:采用|使用)|(?:已)?确认为|决定采用/gu, ":")
  .replace(/:(网站|小程序|网页)形式$/u, ":$1");
const mixedLanguage = (text: string) => text.replace(/\x60[^\x60\n]+\x60|“[^”\n]+”|「[^」\n]+」|\bdated\s+分析/gu,
  match => match.startsWith("dated") ? "有日期的分析" : match);

export function wikiProcessOnly(text: string) {
  return PROCESS.test(text.trim()) || OBSERVATION.test(text.trim()) || ARTIFACT_REQUEST.test(text.trim());
}

export function withoutWikiAuditWarnings(body: string, archive: boolean, interactive: boolean) {
  if (archive && !interactive) return body;
  const edits = wikiDocumentBlocks(body).flatMap(block => {
    if (interactive && block.kind === "blockquote" && STATIC_DECISION.test(block.text)) return [{ ...block, replacement: "" }];
    if (archive || !["paragraph", "blockquote"].includes(block.kind)) return [];
    const edited = block.text.replace(AUDIT_NOTE, "").trim();
    if (edited === block.text) return [];
    return [{ ...block, replacement: /^>\s*$/u.test(edited) ? "" : edited }];
  });
  if (!edits.length) return body;
  return withoutEmptyWikiHeadings(edits.reverse().reduce((text, block) => text.slice(0, block.start) + block.replacement + text.slice(block.end), body))
    .replace(/\n{3,}/gu, "\n\n").trim();
}

export function withoutEmptyWikiHeadings(body: string) {
  const blocks = wikiDocumentBlocks(body);
  const edits = blocks.filter((block, index) => {
    if (block.kind !== "heading") return false;
    const level = block.text.match(/^#+(?=\s)/u)?.[0].length;
    if (!level) return false;
    for (const next of blocks.slice(index + 1)) {
      if (next.kind === "heading" && (next.text.match(/^#+(?=\s)/u)?.[0].length ?? 0) <= level) break;
      if (next.kind !== "heading" && next.kind !== "thematicBreak" && next.kind !== "definition") return false;
    }
    return true;
  });
  if (!edits.length) return body;
  return edits.reverse().reduce((text, block) => text.slice(0, block.start) + text.slice(block.end).replace(/^\n{3,}/u, "\n\n"), body).trim();
}

/** This projection changes generated prose while keeping the source ledger. */
export function wikiEditorialCleanup(section: FocusSection, statuses: ReadonlyMap<string, WikiUnitStatus>,
  arbitration: ReadonlyMap<string, "contested" | "history">, zh: boolean, confirmedQuestions: readonly string[] = []): FocusSection {
  if (section.userEdited || section.origin) return section;
  const claims = section.claims ?? [];
  const accepted = new Set(claims.filter(claim => claim.unitIds?.length && claim.unitIds.every(id => statuses.get(id) === "confirmed")));
  const after = new Map<WikiClaim, WikiClaim>();
  const duplicates = new Map<string, WikiClaim>();
  const removed = new Set<WikiClaim>();
  const seen = new Map<string, WikiClaim>();
  let body = section.body;
  const edits = wikiDocumentBlocks(body, claims).flatMap((block, index, blocks) => {
    if (block.kind === "table") {
      const caption = blocks[index - 1];
      if (caption?.standaloneLabel && /原文表格|Table from the discussion/iu.test(caption.text)) return [];
      const repaired = repairGeneratedWikiTable(block.text);
      return repaired === block.text ? [] : [{ ...block, replacement: repaired }];
    }
    if (block.kind !== "paragraph") return [];
    const original = block.text;
    if (wikiProcessOnly(original)) return [{ ...block, replacement: "" }];
    const actual = block.claims.filter(claim => !claim.markOnly && original.includes(claim.text));
    if (actual.length && actual.every(claim => !claim.checked && !claim.userDecided && wikiQuoteAsksOnlyForFeedback(claim.quote))) {
      return [{ ...block, replacement: "" }];
    }
    const full = actual.filter(claim => trim(claim.text) === trim(original));
    if (full.length && full.every(claim => accepted.has(claim))) {
      const claim = full[0], key = trim(original);
      const prior = duplicates.get(key);
      if (prior) {
        if (prior !== claim) {
          const retained = after.get(prior) ?? prior;
          after.set(prior, { ...retained, unitIds: [...new Set([...retained.unitIds ?? [], ...claim.unitIds ?? []])],
            evidenceIds: [...new Set([...retained.evidenceIds, ...claim.evidenceIds])], sourceReading: undefined });
          removed.add(claim);
        }
        return [{ ...block, replacement: "" }];
      }
      duplicates.set(key, claim);
    }
    let text = original;
    for (const claim of actual) {
      if (claim.checked || !claim.unitIds?.length || text.indexOf(claim.text) !== text.lastIndexOf(claim.text)) continue;
      if (accepted.has(claim) && claim.text.trim() && /[。.!?！？]$/u.test(claim.text.trim())) {
        const key = JSON.stringify([decisionKey(claim.text), claim.scope, claim.workStatus]), at = text.indexOf(claim.text);
        const previous = seen.get(key);
        if (at >= 0 && previous && previous !== claim && (at === 0 || /[。！？.!?]\s*$/u.test(text.slice(0, at)))
          && (previous.unitIds?.some(id => claim.unitIds!.includes(id)) || previous.evidenceIds.some(id => claim.evidenceIds.includes(id)))) {
          const retained = after.get(previous) ?? previous;
          after.set(previous, { ...retained, unitIds: [...new Set([...retained.unitIds ?? [], ...claim.unitIds])],
            evidenceIds: [...new Set([...retained.evidenceIds, ...claim.evidenceIds])], sourceReading: undefined });
          removed.add(claim);
          text = text.slice(0, at) + text.slice(at + claim.text.length).trimStart();
          continue;
        }
        if (!previous) seen.set(key, claim);
      }
      const scoped = claim.unitIds.flatMap(id => arbitration.get(id) ?? []);
      let next = claim;
      if (scoped.length) {
        next = { ...claim, text: claim.text.replace(DEFINITE, zh ? "曾记录" : "was recorded"), userDecided: undefined,
          holder: scoped.includes("contested") ? "open" : "earlier", holderMark: true, sourceReading: undefined };
      } else if (claim.holder === "ai" && DEFINITE.test(claim.text) && !accepted.has(claim)) {
        next = { ...claim, text: claim.text.replace(DEFINITE, zh ? "讨论建议采用" : "was proposed as") };
      }
      const corrected = mixedLanguage(next.text);
      if (corrected !== claim.text || next !== claim) {
        text = text.replace(claim.text, () => corrected);
        after.set(claim, { ...next, text: corrected, formulations: undefined });
      }
    }
    text = mixedLanguage(text);
    if (/你(?:已经|已)(?:确认|选定|决定)/u.test(text)) {
      text = text.split(/(?<=[。！？])/u).filter(sentence => {
        if (!/^\s*(?:\*\*)?你(?:已经|已)(?:确认|选定|决定)/u.test(sentence)) return true;
        const versions = wikiStageLabels(sentence).filter(label => /^v\d/iu.test(label)).map(label => label.toLowerCase());
        if (!versions.length) return true;
        return actual.some(claim => accepted.has(claim) && (sentence.includes(claim.text) || claim.text.includes(sentence.trim()))
          && versions.every(version => wikiStageLabels(claim.unitIds?.some(id => id.startsWith("answer:")) ? claim.text : claim.quote)
            .some(label => label.toLowerCase() === version)));
      }).join("").trim();
    }
    if (confirmedQuestions.length && !body.slice(0, block.start).match(/^#{1,6}\s/mu)) {
      text = withoutSettledOpeningQuestions(text, confirmedQuestions);
    }
    if (PAST_REJECTION.test(text) && /或|或者|\bor\b/iu.test(text) && [...accepted].some(claim => {
      const picked = claim.text.match(/(?:展示|显示|使用|保留)\s*([^，。；\n]{3,26}?)(?=而非|而不是|[，。；]|$)/u)?.[1];
      return picked && text.includes(picked);
    })) text = text.replace(PAST_REJECTION, "。");
    return text === original ? [] : [{ ...block, replacement: text }];
  });
  for (const edit of edits.reverse()) body = body.slice(0, edit.start) + edit.replacement + body.slice(edit.end);
  body = withoutEmptyWikiHeadings(body);
  if (edits.length) body = body.replace(/\n{3,}/gu, "\n\n").trim();
  if (body === section.body && !after.size) return section;
  return { ...section, body, claims: claims.flatMap(claim => {
    if (removed.has(claim)) return [];
    const next = after.get(claim) ?? claim;
    return body.includes(next.text) || !section.body.includes(claim.text) ? [next] : [];
  }) };
}

/** Remove an opening's stale question only when every named issue was
 * settled. Scope and figures must still match the explicit question. */
export const wikiOpenDecisionProse = /(?:是否|whether|要不要|需不需要).*(?:未决|尚未确定|待确认|remains? (?:open|undecided)|unresolved)/iu;

export function withoutSettledOpeningQuestions(text: string, questions: readonly string[]): string {
  if (!questions.length) return text;
  text = text.replace(/(?<=[、，,]|聚焦于|包括|涉及|涵盖)\s*([vV]\d+(?:\.\d+)*[^，,、。；\n]{2,26}?)\s*(?:功能确认|范围确认|功能待确认|范围待确认)(?:及|以及|和|、)\s*/gu, (whole, subject: string) => {
    const version = subject.match(/^[vV]\d+(?:\.\d+)*/u)![0];
    const words = knowledgeTerms(subject.slice(version.length));
    return words.size && questions.some(question => wikiStageLabels(question).some(label => label.toLowerCase() === version.toLowerCase())
      && [...words].every(word => knowledgeTerms(question).has(word))) ? "" : whole;
  });
  if (!wikiOpenDecisionProse.test(text)) return text;
  const topic = (value: string) => value.replace(/^(?:(?:目前关于|目前|关于|至于|以及|是否|要不要|需不需要|whether|about)[\s，,：:]*)+/giu, "")
    .replace(/(?:仍(?:然)?(?:存在|有)|还有|尚有)?\s*(?:未决(?:事项|问题)?|尚未确定|待确认|需要确认|remains? (?:open|undecided)|is (?:still )?unresolved)[。.!？?]*$/iu, "")
    .replace(/是否(?:为|是)?|要不要|需不需要|\b(?:whether|should)\b/giu, " ")
    .trim().replace(/^(?:直接)?(?:提供|包含|纳入)(?=\S{3})/u, "");
  const confirmed = questions.map(question => ({ question, words: knowledgeTerms(topic(question)) }));
  const lead = text.split(/(?<=[。！？])|(?<=[.!?])(?=\s)/u);
  return lead.filter(sentence => {
    if (!wikiOpenDecisionProse.test(sentence)) return true;
    const entries = sentence.split(/以及|[、；;]|\band (?=whether\b)/iu).filter(value => topic(value));
    const pending = entries.filter(entry => {
      const own = knowledgeTerms(topic(entry));
      const conditions = entry.match(/\b[vV]\d+(?:\.\d+)*|\d+(?:\.\d+)?\s*(?:%|px|秒|天|条)|仅|除非|之前|之后|unless|only/gu) ?? [];
      return !confirmed.some(({ question, words }) => {
        const common = [...own].filter(word => words.has(word)).length;
        return common >= 2 && common / own.size >= .5 && conditions.every(condition => question.includes(condition));
      });
    });
    return !entries.length || Boolean(pending.length);
  }).join("").trim();
}

type WikiDecisionAction = NonNullable<WikiKnowledgeLedger["decisionArbitrations"]>[string];

function wikiDecisionParagraphs(blocks: ReturnType<typeof wikiDocumentBlocks>, action: WikiDecisionAction) {
  const ids = new Set(action.unitIds), labels = new Set(action.optionTexts?.map(trim));
  return blocks.filter(block => block.kind === "paragraph" && (
    labels.has(trim(block.text)) && (!block.claims.length || block.claims.every(claim => claim.unitIds?.length && claim.unitIds.every(id => ids.has(id))))
    || block.claims.length > 0 && block.claims.every(claim => claim.unitIds?.length
      && claim.unitIds.every(id => ids.has(id)) && trim(block.text) === trim(claim.text))));
}

/** A choice changes only original option prose in its own generated
 * chapter. Technical clauses and mixed-status paragraphs remain intact. */
export function wikiAppliedDecisions(section: FocusSection, ledger: WikiKnowledgeLedger, zh: boolean, reopened: ReadonlySet<string> = new Set()): FocusSection {
  if(section.userEdited||section.origin)return section;
  const actions=Object.entries(ledger.decisionArbitrations??{}).flatMap(([id,action])=>
    action.chapterId===section.id&&action.mode&&!action.deferredToDraft&&!reopened.has(id)?[action]:[]);
  if(!actions.length)return section;
  let body=section.body, claims=[...section.claims??[]];
  for(const action of actions){
    const blocks=wikiDocumentBlocks(body,claims), removable=wikiDecisionParagraphs(blocks,action);
    const evidenceIds=[...new Set(action.evidenceIds??[])];
    const text=action.text?.trim();
    // A short scope option needs its question's subject to read on its own.
    const subject=action.question?.match(/^([^。！？?，,\n]{2,30}?)(?=是否|，现在按|\s+does it apply)/iu)?.[1]?.trim();
    const standalone=text&&/^(?:(?:先|优先)(?:发布|交付|上线|完成)[\p{Script=Han}\w]{2,}|(?:ship|release)\s+\S+(?:\s+\S+)+)/iu.test(text);
    const suffix=text&&subject&&action.mode==="choose"&&text.length<18&&!standalone?subject+(zh?"：":": ")+text:text;
    const current=suffix&&!/[。.!?！？]$/u.test(suffix)?suffix+(zh?"。":"."):suffix;
    const replacement=action.mode!=="defer"&&current?current:"";
    if(replacement){
      // Render user-entered language as literal prose; the linked sources
      // are the chosen discussion, while the saved choice is its own record.
      const wording=replacement.replace(/[[\]<>]/gu,"\\$&");
      if(!body.includes(wording)||removable.some(block=>block.text.includes(wording))){
        const spot=removable[0];
        if(spot){
          for(const block of [...removable].reverse())body=body.slice(0,block.start)+(block===spot?wording:"")+body.slice(block.end);
        }else{
          const heading=action.heading&&blocks.find(block=>block.kind==="heading"&&block.text.replace(/^#+\s+/u,"")===action.heading);
          body=heading?body.slice(0,heading.end)+"\n\n"+wording+body.slice(heading.end):body.trimEnd()+"\n\n"+wording;
        }
        claims=[...claims,{text:wording,quote:"",evidenceIds,holder:"decided",holderMark:true,userDecided:true}];
      }
    }else{
      for(const block of [...removable].reverse())body=body.slice(0,block.start)+body.slice(block.end);
    }
  }
  if(body===section.body)return section;
  body=withoutEmptyWikiHeadings(body.replace(/\n{3,}/gu,"\n\n").trim());
  return {...section,body,claims:claims.filter(claim=>body.includes(claim.text)||!section.body.includes(claim.text)),
    evidenceIds:[...new Set([...section.evidenceIds,...claims.flatMap(claim=>claim.evidenceIds)])]};
}
