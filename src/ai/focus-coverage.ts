import type {WikiPreviousChapter} from "./wiki-topic-plan";
import {trimWikiClaimOverflow,wikiClaimIssues,withWikiClaimDetails,wikiClaimRepairRequest} from "./wiki-claim-repair";
import {applyWikiTitleEdits,renameWikiHeadings,wikiTitleEdits} from "./wiki-title-pass";
import {wikiExistingExplanations,wikiWritingJobs} from "./wiki-writing-context";
import {WIKI_COMPOSITION_INSTRUCTIONS,EDITION6_WIKI_COMPOSITION_INSTRUCTIONS,EDITION5_WIKI_COMPOSITION_INSTRUCTIONS,EDITION4_WIKI_COMPOSITION_INSTRUCTIONS,EDITION2_WIKI_COMPOSITION_INSTRUCTIONS,EDITION3_WIKI_COMPOSITION_INSTRUCTIONS,LEGACY_WIKI_COMPOSITION_INSTRUCTIONS,V4_WIKI_COMPOSITION_INSTRUCTIONS} from "./wiki-composition-instructions";
import {withCrossChapterDuplicates} from "../shared/wiki-cross-duplicates";
import {refreshWikiChapterOpenings,type WikiOpeningReport} from "./wiki-chapter-openings";
import {assignGuideOwners,wikiChapterGuide,wikiChapterGuideAllowance,wikiCurrentGuide,wikiGuideCatalogue,type WikiGuideCatalogue} from "./wiki-current-guide";
import {measureAILocalStep,recordAISkippedStep} from "./pipeline-timing";
import { executeBatches } from "./batch-executor";
import { createRequestQueue } from "./directory-request-queue";
import { REVIEW_DOCUMENT_INSTRUCTIONS } from "./review-instructions";
import type { Conversation } from "../shared/types";
import { GENERATED_PROSE_INSTRUCTIONS } from "./wiki-instructions";
import type { AnalysisMode } from "./semantic-analysis";
import type { FocusBrief, FocusEvidence, FocusMode, FocusSection, FocusSourceOutline } from "../shared/focus-session";
import { sourceMessageSignature } from "../shared/source-signature";
import type { TranscriptPassage } from "../search/transcript-index";
import type { AtlasAI } from "./atlas-ai";
import type {StructuredAIRequest} from "./provider";
import { normalizeFocusOutput, focusOutputIssue, focusOutputDiagnostics } from "../shared/atlas/tasks.js";
import { AIProviderValidationError,AIProviderResponseError } from "./provider-errors";
import { requestBudget } from "./request-policy";
import { focusStrategy, MAX_FOCUS_PASSAGES } from "../shared/atlas/policy.js";
import type { FocusAnalysisProgress } from "../shared/focus-progress";
import { outputSplitStrategy, outputWasTruncated, rememberOutputSplit } from "./focus-output-recovery";
import {validateWikiWritingCoverage,splitWikiWritingBatch,splitWikiOwnerBatch,wikiMissingTopicBatch,batchSubtopics} from "./wiki-writing-coverage";
import { stableReadingBatches } from "./focus-reading-plan";
import { stabilizeMaterialIdentity } from "./focus-material-identity";
import { readingTitle } from "../shared/reading-title";
import { mapSemanticEvidence } from "../shared/semantic-structure";
import { readProjectKnowledge } from "./project-knowledge";
import type { ProjectKnowledgeBatch } from "../shared/project-knowledge";
import type { ProjectState } from "../shared/project-state";
import { createWikiTopicPlanner, topicPlanInstructions, type WikiPlanReceipt } from "./wiki-topic-plan";
import {scopeWikiFacts,wikiBoundaryContext,wikiMaterialKey,wikiScopeWritingRouting} from "./wiki-project-scope";
import {WIKI_PROJECT_WRITING_BOUNDARY} from "./wiki-project-scope";
import type {WikiProjectBoundary} from "../shared/wiki-project-boundary";
import type {WikiTitleReview,WikiScopeReview} from "../shared/focus-session";
import { type DirectoryPage } from "./wiki-directory";
import {assertWikiOutline,wikiOutlineError} from "./wiki-outline-policy";
import { PROJECT_KNOWLEDGE_POLICY } from "../shared/project-knowledge-policy";
import {enrichWikiWritingNotes,refreshWikiWritingNotes,wikiWritingUnits,wikiNoteEvidenceText} from "./wiki-writing-details";
import {assignWikiOwners,wikiWritingOrder,wikiBudgetedCompletionLimit,opensWikiChapter} from "./wiki-writing-batches";
import {wikiOutlineSections,withWikiOutline} from "./wiki-outline-preview";
import {joinWikiOwnerProse} from "../shared/wiki-owner-prose";
import {applyWikiDirectory,editableWikiTopic} from "../shared/wiki-directory";
import {currentWikiFacts,retiredWikiClaim,type WikiRetiredProof} from "../shared/wiki-current-facts";
import {wikiWritingQuality} from "./wiki-writing-quality";
import {mergeThinWikiChapters,renameWikiSubheadings} from "./wiki-subtopic-budget";
import {nameMergedSubheadings,type WikiSubheadingNameReport} from "./wiki-subheading-names";
import {createWikiPlanningCheckpoints} from "./wiki-planning-checkpoint";
import {validateWikiDirectory} from "./wiki-directory";
import {writingInputScale,validInputScale} from "./token-calibration";
import {MAX_CONCURRENCY} from "./model-routing";
import {RECOVERY_POLICY} from "./recovery-policy";
import {wikiQuoteRange} from "../shared/wiki-claims";
const WRITING_RECOVERY=RECOVERY_POLICY.writing;
import {writeWikiRequest,type WritingAllowance} from "./wiki-writing-request";
import {CROSS_AI_WRITING,colocateSameQuestions,isCrossPlatform,keepSameQuestionsTogether,sameQuestionAnnotations,sameQuestionGroups} from "./cross-ai";

export interface CoverageMaterial {
  role?: string;
  id: string;
  conversationId: string;
  sourceConversationIds: string[];
  title: string;
  messageId: string;
  date?: number;
  text: string;
  rawEvidenceIds: string[];
  precedingContext?: string;
  wikiOwnerId?:string;
  messageIndex?:number;
  discussedAt?:number;
  /** Source AI platform; set only when a scope mixes platforms, so single-platform requests stay identical. */
  platform?:string;
}

export type OwnedMaterial = CoverageMaterial & {wikiOwnerId:string};

export interface CoverageResult {
  projectFacts?: ProjectState;
  title: string;
  sections: FocusSection[];
  brief?: FocusBrief;
}
interface CompositionCheckpoint {
 current:CoverageMaterial[];topicPlan:DirectoryPage[];wikiScopeReview?:WikiScopeReview;
 retired:WikiRetiredProof[];globalWritingGuide:string;sourceOutlines:FocusSourceOutline[];
 /** Owned fact rows rendered per writing request; absent in older checkpoints, which keep globalWritingGuide verbatim. */
 factCatalogue?:WikiGuideCatalogue;guideExtras?:string;
 knowledgeBatches:ProjectKnowledgeBatch[];batchCount:number;
 /** Writing input scale frozen for this composition, so a resumed run rebuilds the same batches. */
 writingScale?:number;
 writingEdition?:1|2|3|4|5|6|7;
}
interface WritingCheckpoint {result?:CoverageResult;draft?:CoverageResult;parts?:CoverageResult[];claimDraft?:unknown}

interface CoveragePayload {
  [key: string]: unknown;
  intent: string;
  mode: FocusMode;
  strategy: "review" | "answer" | "work";
  locale: string;
  analysisMode: AnalysisMode;
  coverage: { confirmedSourceCount: number; includedSourceCount: number; sampled: boolean; stage: "reading" | "synthesis"; final: boolean; sourceSegmentCount: number; precedingContext?: string };
  passages: Array<{ id: string; conversationId: string; sourceConversationIds: string[]; title: string; messageId: string; date?: number; text: string; wikiOwnerId?:string; platform?:string; sameQuestion?:string[] }>;
}

const unique = (values: string[]) => [...new Set(values)];
const MATERIAL_CHARACTERS = 4000;
const SOURCE_NOTE_INTENT = "Preserve the complete chronological discussion for later reuse.";
const SOURCE_NOTE_SYSTEM = `Read every supplied passage in order. Summarize the user's questions, reasoning, corrections, decisions and open questions with exact passage citations. Keep notes concise and grounded. ${GENERATED_PROSE_INSTRUCTIONS} ${PROJECT_KNOWLEDGE_POLICY}`;
const synthesisSystem = (mode: FocusMode,workInstructions=WIKI_COMPOSITION_INSTRUCTIONS) => mode === "work" ? workInstructions+WIKI_PROJECT_WRITING_BOUNDARY : `Compose the final source-grounded reading result. ${PROJECT_KNOWLEDGE_POLICY} ${GENERATED_PROSE_INSTRUCTIONS} Preserve citations and distinguish user-confirmed decisions from old AI suggestions. ${REVIEW_DOCUMENT_INSTRUCTIONS}`;
const MAX_READING_RECOVERY_DEPTH = 3;
/** Automatic planning continuations after a resumable failure, each with progress. */
const MAX_PLANNING_CONTINUATIONS = 2;
/** A progress key for a planning failure worth continuing: ownership or grouping
 * ran out of its allowance with checkpointed progress. Undefined for anything
 * else (cancellation, transport, invalid input), which still fails as before. */
function planningProgress(error:unknown):string|undefined {
  if(!(error instanceof AIProviderValidationError))return undefined;
  const resume=error.wikiPlanningResume;
  if(resume)return `${resume.phase}:${resume.completed}:${resume.remaining}`;
  return /_ownership_(?:incomplete|target)$/u.test(error.code)?error.code:undefined;
}

function textParts(text: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + MATERIAL_CHARACTERS);
    // Avoid breaking an emoji or other surrogate pair at a block boundary.
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

/** Reconstruct chronological message text losslessly; search overlaps are not generation material. */
export function coverageMaterials(passages: TranscriptPassage[], sources: Conversation[]): { materials: CoverageMaterial[]; evidence: FocusEvidence[] } {
  const materials: CoverageMaterial[] = [];
  const evidence: FocusEvidence[] = [];
  const bySource = new Map<string, TranscriptPassage[]>();
  const crossPlatform = isCrossPlatform(sources.map(source => source.platform));
  for (const passage of passages) { const group = bySource.get(passage.document.conversationId) ?? []; group.push(passage); bySource.set(passage.document.conversationId, group); }
  for (const source of sources) {
    const messages = new Map<string, TranscriptPassage[]>();
    for (const passage of (bySource.get(source.id) ?? []).sort((a, b) => a.evidence.messageIndex - b.evidence.messageIndex || (a.start ?? 0) - (b.start ?? 0))) {
      const group = messages.get(passage.evidence.messageId) ?? [];
      group.push(passage); messages.set(passage.evidence.messageId, group);
    }
    let precedingContext = "";
    let previousIndex: number | undefined;
    for (const group of messages.values()) {
      let text = "";
      let end = 0;
      for (const passage of group) {
        const start = passage.start ?? 0;
        if (start > end || group.length > 1 && passage.start === undefined) throw new Error("Source text has a gap. Reimport this conversation before organizing it.");
        text += passage.text.slice(Math.max(0, end - start));
        end = Math.max(end, passage.end ?? start + passage.text.length);
      }
      const first = group[0];
      // Unselected gaps are not continuous discussions; never invent adjacency.
      if (previousIndex !== undefined && first.evidence.messageIndex > previousIndex + 1) precedingContext = "";
      for (const [partIndex, part] of textParts(text).entries()) {
        const id = `e:${encodeURIComponent(source.id)}:${first.evidence.messageIndex}:${partIndex + 1}`;
        materials.push({ id, role: first.role, conversationId: source.id, sourceConversationIds: [source.id], title: source.title.slice(0, 140), messageId: first.evidence.messageId,messageIndex:first.evidence.messageIndex,
          date: source.sourceCreatedAt, text: `${first.role}: ${part}`, rawEvidenceIds: [id], precedingContext,discussedAt:first.discussedAt,...(crossPlatform?{platform:source.platform}:{}) });
        evidence.push({ id, conversationId: source.id, messageId: first.evidence.messageId, title: source.title, excerpt: part.slice(0, 240) });
        precedingContext = `${first.role}: ${part.slice(-320)}`;
      }
      previousIndex = first.evidence.messageIndex;
    }
  }
  return { materials, evidence };
}

function payloadFor(materials: CoverageMaterial[], goal: string, mode: FocusMode, locale: string, sourceCount: number, sourceSegmentCount: number, stage: "reading" | "synthesis", analysisMode: AnalysisMode = "balanced"): CoveragePayload {
  const includedSourceCount = new Set(materials.flatMap((item) => item.sourceConversationIds)).size;
  return { intent: goal, mode, strategy: focusStrategy(goal, mode), locale, analysisMode, semanticStructure: true,
    coverage: { confirmedSourceCount: stage === "reading" ? includedSourceCount : sourceCount, includedSourceCount, sampled: stage === "synthesis", stage, final: false,
      sourceSegmentCount: stage === "reading" ? materials.length : sourceSegmentCount, ...(materials[0]?.precedingContext ? { precedingContext: materials[0].precedingContext } : {}) },
    passages: materials.map(({ id, conversationId, sourceConversationIds, title, messageId, date, text, wikiOwnerId, platform }) => ({ id, conversationId, sourceConversationIds, title, messageId, date, text, ...(wikiOwnerId?{wikiOwnerId}:{}), ...(platform?{platform}:{}) })) };
}

function requestFits(payload: CoveragePayload, modelId?: string, compactBudget = true, topicGuide = "",workInstructions=WIKI_COMPOSITION_INSTRUCTIONS,inputScale=1): boolean {
  if (payload.passages.length > MAX_FOCUS_PASSAGES) return false;
  const prompt = JSON.stringify(payload);
  const budget = requestBudget({ taskType: "focus_session", system: payload.coverage.final ? synthesisSystem(payload.mode,workInstructions) + topicGuide : SOURCE_NOTE_SYSTEM, prompt }, modelId, undefined, !compactBudget && !payload.coverage.final, !compactBudget);
  // Partition by the real wire budget, without an extra latency cap that creates
  // additional paid reading requests. Output truncation retains local recovery.
  return budget.inputTokens * inputScale <= budget.maxInputTokens - 500
    && prompt.length <= 90_000 && new TextEncoder().encode(prompt).length <= 160_000;
}

/** Split a generated note without removing characters if one note is unusually long. */
function splitLongNotes(materials: CoverageMaterial[]): CoverageMaterial[] {
  return materials.flatMap((item) => {
    if (item.text.length <= MATERIAL_CHARACTERS + 20) return [item];
    return textParts(item.text).map((text, index) => ({ ...item, id: `${item.id}:${index + 1}`, text }));
  });
}

/** Smaller requests preserve every character and the original evidence identity. */
function splitOutputBatch(batch: CoverageMaterial[]): CoverageMaterial[][] | undefined {
  if (batch.length > 1) {
    const middle = Math.ceil(batch.length / 2);
    return [batch.slice(0, middle), batch.slice(middle)];
  }
  const item = batch[0];
  if (!item || item.text.length <= 256) return;
  let middle = Math.ceil(item.text.length / 2);
  if (/[\uD800-\uDBFF]/u.test(item.text[middle - 1])) middle--;
  return [
    [{ ...item, id: `${item.id}:output-0`, text: item.text.slice(0, middle) }],
    [{ ...item, id: `${item.id}:output-1`, text: item.text.slice(middle), precedingContext: item.text.slice(Math.max(0, middle - 320), middle) }],
  ];
}

export function joinedResults(results: CoverageResult[], locale: string): CoverageResult {
  if (results.length === 1) return { ...results[0], title: readingTitle(results[0].title) };
  const seen = new Set<string>();
  const sections = results.flatMap(result => result.sections).filter(section => {
    const key = JSON.stringify([section.title, section.body, section.kind, [...new Set(section.evidenceIds)].sort(), section.transition,section.wikiOwnerId,section.phase,section.claims]);
    if (seen.has(key)) return false; seen.add(key); return true;
  }).map((section, index, all) => ({ ...section, id: `section-${index + 1}`, transition: index === all.length - 1 ? "" : section.transition || (locale === "zh-CN" ? "接着阅读下一部分。" : "Continue with the next part.") }));
  const briefs = results.flatMap(result => result.brief ? [result.brief] : []);
  return { title: readingTitle(results[0].title), sections,
    // A partition describes the same project, not another paragraph of its
    // introduction. Keep one stable introduction; all other knowledge remains
    // in its owning pages and evidence instead of concatenated brief summaries.
    ...(briefs.length ? { brief: { summary: briefs.find(brief => brief.summary.trim())?.summary ?? "", turningPoints: briefs.flatMap(brief => brief.turningPoints), confirmed: briefs.flatMap(brief => brief.confirmed), openQuestions: unique(briefs.flatMap(brief => brief.openQuestions)) } } : {}) };
}

/** Collapse repeated fragments of a validated owner before showing a preview.
 * No title-prefix guessing; fact status stays in prose, not duplicate pages. */
export function coalesceWikiOwners(result:CoverageResult):CoverageResult {
  const owners=new Map<string,FocusSection[]>();
  for(const section of result.sections){if(!section.wikiOwnerId||!editableWikiTopic(section))continue;const key=section.wikiOwnerId;owners.set(key,[...owners.get(key)??[],section]);}
  const replacements=new Map<string,FocusSection>(),removed=new Set<string>();
  for(const sections of owners.values())if(sections.length>1){const first=sections[0];replacements.set(first.id,{...applyWikiDirectory(sections,[{title:first.title,group:first.wikiGroup??"",question:first.wikiQuestion??first.title,sectionIds:sections.map(section=>section.id)}])[0],body:joinWikiOwnerProse(sections)});sections.slice(1).forEach(section=>removed.add(section.id));}
  return {...result,sections:result.sections.filter(section=>!removed.has(section.id)).map(section=>replacements.get(section.id)??section)};
}

function* coverageBatchIterator(materials: CoverageMaterial[], goal: string, mode: FocusMode, locale: string, sourceCount: number, sourceSegmentCount: number, stage: "reading" | "synthesis", modelId?: string, analysisMode: AnalysisMode = "balanced", final = false, compactBudget = true, topicGuide = "",workInstructions=WIKI_COMPOSITION_INSTRUCTIONS,inputScale=1): Generator<CoverageMaterial[]> {
  const items = splitLongNotes(materials);
  for (let start = 0; start < items.length;) {
    let maximum = Math.min(MAX_FOCUS_PASSAGES, items.length - start);
    // Keep the exact same source boundaries and greedy prefix as before. Only
    // change how often the expensive wire prompt/token budget is reconstructed.
    if (stage === "reading") {
      let sourceEnd = start + 1;
      while (sourceEnd < start + maximum && items[sourceEnd].conversationId === items[start].conversationId) sourceEnd++;
      maximum = sourceEnd - start;
    }
    const fits = (count: number) => {
      const payload = payloadFor(items.slice(start, start + count), goal, mode, locale, sourceCount, sourceSegmentCount, stage, analysisMode);
      payload.coverage.final = final;
      if (final && payload.strategy === "review") payload.presentation = "reading_route";
      return requestFits(payload, modelId, compactBudget, topicGuide,workInstructions,final?inputScale:1);
    };
    if (!fits(1)) throw new Error(locale === "zh-CN" ? "单段材料超出安全输入范围，请调整来源。" : "One passage exceeds the safe input budget. Adjust the sources.");
    let accepted = 1;
    let rejected = maximum + 1;
    for (let count = Math.min(2, maximum); count > accepted;) {
      if (!fits(count)) { rejected = count; break; }
      accepted = count;
      if (accepted === maximum) break;
      count = Math.min(maximum, count * 2);
    }
    while (accepted + 1 < rejected) {
      const middle = (accepted + rejected) >>> 1;
      if (fits(middle)) accepted = middle;
      else rejected = middle;
    }
    yield items.slice(start, start + accepted);
    start += accepted;
  }
}

export function coverageBatches(materials: CoverageMaterial[], goal: string, mode: FocusMode, locale: string, sourceCount: number, sourceSegmentCount: number, stage: "reading" | "synthesis", modelId?: string, analysisMode: AnalysisMode = "balanced", final = false, compactBudget = true, topicGuide = "",workInstructions=WIKI_COMPOSITION_INSTRUCTIONS,inputScale=1): CoverageMaterial[][] {
  return [...coverageBatchIterator(materials, goal, mode, locale, sourceCount, sourceSegmentCount, stage, modelId, analysisMode, final, compactBudget, topicGuide,workInstructions,inputScale)];
}

async function responsiveCoverageBatches(signal: AbortSignal, ...args: Parameters<typeof coverageBatches>): Promise<CoverageMaterial[][]> {
  const batches: CoverageMaterial[][] = [];
  let lastYield = performance.now();
  for (const batch of coverageBatchIterator(...args)) {
    signal.throwIfAborted();
    batches.push(batch);
    if (performance.now() - lastYield >= 12) { await new Promise((resolve) => setTimeout(resolve, 0)); lastYield = performance.now(); }
  }
  return batches;
}

function notesFromResult(result: CoverageResult, batch: CoverageMaterial[], level: number, batchIndex: number, locale: string, preserveExamples = false): CoverageMaterial[] {
  const byId = new Map(batch.map((item) => [item.id, item]));
  // Only content actually carried into a note can replace its original evidence.
  const carried = new Set<string>();
  const notes = result.sections.filter((section) => (section.kind === "review" || section.kind === "finding") && section.evidenceIds.length).map((section, index): CoverageMaterial => {
    const source = byId.get(section.evidenceIds[0])!;
    section.evidenceIds.forEach((id) => carried.add(id));
    return { id: `n${level}-${batchIndex}-${index + 1}`, conversationId: source.conversationId, sourceConversationIds: unique(section.evidenceIds.flatMap((id) => byId.get(id)?.sourceConversationIds ?? [])), title: section.title, messageId: source.messageId, date: source.date,
      text: `${section.title}\n${section.body}${section.transition ? `\nNext: ${section.transition}` : ""}${section.semanticStructure ? `\nSource concept structure: ${JSON.stringify({ nodes: section.semanticStructure.nodes.map(node => Object.fromEntries(Object.entries(node).filter(([key]) => !["evidenceIds", "sectionIds"].includes(key)))), relations: section.semanticStructure.relations.map(edge => Object.fromEntries(Object.entries(edge).filter(([key]) => key !== "evidenceIds"))) })}\nSupporting quotations:\n${[...section.semanticStructure.nodes, ...section.semanticStructure.relations].map(item => item.quote).join("\n")}` : ""}`,
      rawEvidenceIds: unique(section.evidenceIds.flatMap((id) => byId.get(id)?.rawEvidenceIds ?? [])), ...(source.platform ? { platform: source.platform } : {}) };
  });
  if (!notes.length) throw new Error(locale === "zh-CN" ? "AI 未能生成带来源的阶段笔记，请重试。" : "AI did not return a source-grounded reading note. Please retry.");
  const brief = result.brief;
  if (brief) {
    const claims = [...brief.turningPoints, ...brief.confirmed];
    for (const [index, claim] of claims.entries()) {
      const source = byId.get(claim.evidenceIds[0]);
      if (!source) continue;
      claim.evidenceIds.forEach((id) => carried.add(id));
      const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();
      // Keep the explicit user-confirmed label even when its wording repeats.
      if (index < brief.turningPoints.length && result.sections.some((section) => ["review", "finding"].includes(section.kind) && normalize(section.body).includes(normalize(claim.text)) && claim.evidenceIds.every((id) => section.evidenceIds.includes(id)))) continue;
      notes.push({ id: `n${level}-${batchIndex}-claim-${index + 1}`, conversationId: source.conversationId, sourceConversationIds: unique(claim.evidenceIds.flatMap((id) => byId.get(id)?.sourceConversationIds ?? [])), title: source.title, messageId: source.messageId, date: source.date,
        text: `${index < brief.turningPoints.length ? "Turning point" : "Generated Brief claim (verify original approval)"}: ${claim.text}`,
        rawEvidenceIds: unique(claim.evidenceIds.flatMap((id) => byId.get(id)?.rawEvidenceIds ?? [])), ...(source.platform ? { platform: source.platform } : {}) });
    }
    if (brief.openQuestions.length) notes[0].text += `\nOpen questions: ${brief.openQuestions.join("; ")}`;
  }
  // Omitted source segments stay intact. Review derivations and code examples
  // also carry their original text: compressed notes cannot replace their steps.
  for (const item of batch) if (!carried.has(item.id) || preserveExamples && /(?:\$[^\n$]+\$|\$\$|\\\(|\\\[|(?:^|\n)\s*(?:```|~~~))/u.test(item.text)) notes.push(item);
  // The intermediate note protocol binds each note to the same batch. Keep its
  // complete text once in one material instead of repeating the citation set.
  const compact = new Map<string, CoverageMaterial>();
  for (const note of notes) {
    const key = JSON.stringify(preserveExamples?note.rawEvidenceIds:[note.title,note.text,note.rawEvidenceIds]);
    const existing = compact.get(key);
    if (existing && preserveExamples) existing.text += `\n\n${note.text}`;
    else if (existing) continue;
    else compact.set(key, { ...note });
  }
  return [...compact.values()];
}

function expandResult(result: CoverageResult, materials: CoverageMaterial[], rawEvidence: FocusEvidence[]): CoverageResult {
  const byId = new Map(materials.map((item) => [item.id, item.rawEvidenceIds]));
  const evidenceById = new Map(rawEvidence.map((item) => [item.id, item]));
  const expand = (ids: string[]) => {
    return unique(ids.flatMap((id) => byId.get(id) ?? [])).filter((id) => evidenceById.has(id));
  };
  return { ...result, sections: result.sections.map((section) => ({ ...section, evidenceIds: expand(section.evidenceIds), ...(section.claims ? { claims: section.claims.map(claim => ({ ...claim, evidenceIds: expand(claim.evidenceIds) })) } : {}), ...(section.semanticStructure ? { semanticStructure: mapSemanticEvidence(section.semanticStructure, expand) } : {}) })),
    brief: result.brief ? { ...result.brief,
      turningPoints: result.brief.turningPoints.map((claim) => ({ ...claim, evidenceIds: expand(claim.evidenceIds) })),
      confirmed: result.brief.confirmed.map((claim) => ({ ...claim, evidenceIds: expand(claim.evidenceIds) })) } : undefined };
}

export interface CoverageInput {
  runId?:string;
  goal: string; mode: FocusMode; locale: string; sources: Conversation[]; passages: TranscriptPassage[]; modelId?: string; analysisMode?: AnalysisMode;
  scopeKind?: "goal" | "all";
  wikiScopeIncludeKeys?:string[];
  wikiScopeExcludeKeys?:string[];
  wikiScopeIgnoredKeys?:string[];
  wikiProjectBoundary?:WikiProjectBoundary;
  /** An update's existing chapters; planning keeps them where material still fits. */
  wikiPreviousDirectory?:WikiPreviousChapter[];
  collectProjectKnowledge?: boolean;
  ai: Partial<Pick<AtlasAI,"id"|"generateStructured"|"supportsCacheMissGuard"|"recordLocalFailure">> & Pick<AtlasAI, "synthesize" | "prepareFocus" | "hasCachedSynthesis" | "getAnalysisKey" | "usesContentTokenEstimates" | "canReuseProjectKnowledge"> & { capabilities?: Pick<AtlasAI["capabilities"], "maxConcurrency"> };
  signal: AbortSignal; validate: (value: unknown, evidence: FocusEvidence[], structureSources?: Array<{ id: string; text: string; secondary?: boolean }>) => CoverageResult;
  onPartial?: (result:CoverageResult,evidence:FocusEvidence[],scopeReview?:WikiScopeReview)=>void|Promise<void>;
  /** The chapter the reader is looking at; its writing job is started next. */
  priorityOwner?: () => string | undefined;
  onProgress?: (completed: number, total: number, stage: "reading" | "synthesis", detail?: FocusAnalysisProgress) => void;
}
export type CoveredFocusResult = { result: CoverageResult; wikiScopeReview?:WikiScopeReview; wikiTitleReview?:WikiTitleReview; topicPlanApplied?:boolean; knowledgeBatches?: ProjectKnowledgeBatch[]; evidence: FocusEvidence[]; sourceOutlines: FocusSourceOutline[]; segmentCount: number; method: "full_direct" | "full_batched"; batchCount: number; sourceCharacters: number };

export async function synthesizeCoveredFocus(input: CoverageInput): Promise<CoveredFocusResult> {
 const pipeline=await createCoveragePipeline(input);
 if(pipeline.savedPreparation)return pipeline.writeWiki(pipeline.savedPreparation);
 if(pipeline.canWriteDirect())return pipeline.writeDirect();
 const reading=await pipeline.readSources();
 const preparation=await prepareWikiWriting(input,reading);
 return pipeline.writeWiki(preparation);
}

/** Shared execution services keep cache/recovery semantics identical across stages. */
async function createCoveragePipeline(input:CoverageInput) {
  const prepared = coverageMaterials(input.passages, input.sources);
  const { materials: raw, evidence } = await stabilizeMaterialIdentity(prepared.materials, prepared.evidence, input.signal);
  if (!raw.length) throw new Error(input.locale === "zh-CN" ? "没有可阅读的来源材料。" : "No readable source material.");
  const analysisKey = await input.ai.getAnalysisKey?.();
  // The same question asked on several AIs is written once, as a comparison.
  const sameQuestions = input.mode === "work" ? sameQuestionGroups(raw) : [];
  const excludeKeys = new Set([...(input.wikiScopeExcludeKeys ?? []),...(input.wikiScopeIgnoredKeys ?? [])]);
  const userExcluded: Array<{ id: string; title: string; body: string; kind: "finding"; transition: string; evidenceIds: string[] }> = [];
  const checkpoints=analysisKey?createWikiPlanningCheckpoints(async()=>analysisKey,input.signal):undefined;
  // Re-plan pre-review preparations, retaining all neutral source-reading caches.
  // v16: directory acceptance limits subtopics and chapters; an older plan is not replayed.
  const compositionId=input.mode==="work"?await checkpoints?.key("composition-editorial-v16",[input.goal,input.locale,input.analysisMode,input.scopeKind,input.wikiProjectBoundary,input.wikiScopeIncludeKeys,input.wikiScopeIgnoredKeys,...(input.wikiScopeExcludeKeys?.length?[input.wikiScopeExcludeKeys]:[]),...(input.wikiPreviousDirectory?.length?[input.wikiPreviousDirectory]:[]),input.sources.map(source=>[source.id,source.title,source.sourceCreatedAt]),raw]):undefined;
  const reuseKnowledge = input.mode === "work" && input.collectProjectKnowledge === true && input.ai.canReuseProjectKnowledge === true;
  const knowledgeBatches: ProjectKnowledgeBatch[] = [];
  const compactBudget = input.ai.usesContentTokenEstimates !== false;
  const cacheChecks = new Map<string, Promise<boolean>>();
  const cachedSynthesis = input.ai.hasCachedSynthesis ? (request: Parameters<NonNullable<AtlasAI["hasCachedSynthesis"]>>[0]) => {
    const key = JSON.stringify([request.system, request.prompt]);
    let check = cacheChecks.get(key);
    if (!check) { check = input.ai.hasCachedSynthesis!(request); cacheChecks.set(key, check); }
    return check;
  } : undefined;
  let savedPreparation:WritingPreparation|undefined;
  let batchCount = 0;
  let reusedBatches = 0;
  let resumed=false;
  const sourceOutlines: FocusSourceOutline[] = input.sources.map((source) => {
    const messages = new Map<string, string>();
    for (const material of raw.filter((item) => item.conversationId === source.id)) messages.set(material.messageId, (messages.get(material.messageId) ?? "") + material.text.replace(/^\w+: /u, ""));
    return { conversationId: source.id, messageSignatures: Object.fromEntries([...messages].map(([id, text]) => [id, sourceMessageSignature(text)])), messageOrder: [...messages.keys()], messageRoles: Object.fromEntries(input.passages.filter(item => item.document.conversationId === source.id).flatMap(item => item.role ? [[item.evidence.messageId, item.role]] : [])), chapters: [] };
  });
  const startedAt = performance.now();
  const completedRaw = new Set<string>();
  const sourceTotals = new Map(input.sources.map((source) => [source.id, raw.filter((item) => item.conversationId === source.id).length]));
  const sourceCompleted = new Map<string, number>();
  const saved=compositionId?await checkpoints?.read<CompositionCheckpoint>(compositionId):undefined;
  if(saved){try{
   savedPreparation=restoreWikiWriting(saved,raw);
   sourceOutlines.splice(0,sourceOutlines.length,...saved.sourceOutlines);knowledgeBatches.push(...saved.knowledgeBatches);batchCount=saved.batchCount;resumed=true;
   raw.forEach(item=>completedRaw.add(item.id));sourceTotals.forEach((count,id)=>sourceCompleted.set(id,count));
  }catch{await checkpoints?.remove(compositionId!,saved);}}
  // Tiny single-source discussions fit intact into one final response. Long,
  // multi-source and deep analyses keep the reusable neutral-note pipeline.
  let shortDirect = input.sources.length === 1 && raw.length <= 8 && input.analysisMode !== "deep" && raw.reduce((sum, item) => sum + item.text.length, 0) <= 2400;
  if (shortDirect && input.scopeKind !== "goal" && cachedSynthesis) {
    const notePayload = payloadFor(raw, SOURCE_NOTE_INTENT, "review", input.locale, input.sources.length, raw.length, "reading", input.analysisMode);
    // Existing neutral notes are cheaper than rereading even a short source.
    if (await cachedSynthesis({ taskType: "focus_session", system: SOURCE_NOTE_SYSTEM, prompt: JSON.stringify(notePayload), validate: value => value })) shortDirect = false;
  }
  const directPayload=(materials:CoverageMaterial[],stage:"reading"|"synthesis")=>{
    const direct = payloadFor(materials, input.goal, input.mode, input.locale, input.sources.length, raw.length, stage, input.analysisMode);
    direct.coverage.final = true;
    if (input.mode === "work") Object.assign(direct,{semanticStructure:false,overviewFromWiki:true,projectBoundary:wikiBoundaryContext({goal:input.goal,project:input.wikiProjectBoundary,sourceTitles:input.sources.map(source=>source.title)})});
    // Only composition depends on scope intent; neutral source notes remain reusable.
    if (input.scopeKind) Object.assign(direct.coverage, { scope: input.scopeKind });
    if (direct.strategy === "review") direct.presentation = "reading_route";
    return direct;
  };
  // Project Wikis need the same scope review for short and long discussions.
  const canWriteDirect=()=>(input.mode!=="work"||!input.ai.generateStructured)&&((input.mode!=="work"&&input.scopeKind === "goal")||!reuseKnowledge&&shortDirect)&&requestFits(directPayload(raw,"reading"),input.modelId,compactBudget,"",WIKI_COMPOSITION_INSTRUCTIONS);
  const executeStage=async(phase:{kind:"reading"|"direct"}|{kind:"writing";preparation:WritingPreparation}):Promise<CoveredFocusResult|PreparationContext>=>{
    input.signal.throwIfAborted();
    const preparation=phase.kind==="writing"?phase.preparation:undefined;
    const level=phase.kind==="writing"?1:0,final=phase.kind!=="reading";
    const stage=phase.kind==="writing"?"synthesis":"reading";
    const topicPlan=preparation?.topicPlan,wikiScopeReview=preparation?.wikiScopeReview;
    // Paired titles are renamed beside writing, which keeps the planned titles
    // and its cache identity; a failed rename keeps the plan's own titles.
    let titleReview:WikiTitleReview|undefined;
    const titleEdits=final&&topicPlan&&input.mode==="work"&&input.ai.generateStructured?wikiTitleEdits(topicPlan,input.locale,{generateStructured:request=>input.ai.generateStructured!(request)},input.signal,{runId:input.runId,onReport:value=>{titleReview=value;},...(!input.wikiProjectBoundary?{project:{goal:input.goal,sourceTitles:input.sources.map(source=>source.title)}}:{})}):undefined;
    // Writing can fail before joining the parallel title work. Observe that
    // rejection now; awaiting the original promise below still propagates abort.
    void titleEdits?.catch(()=>undefined);
    const current=preparation?(topicPlan?assignWikiOwners(preparation.current,topicPlan):preparation.current):raw;
    const retired=preparation?.retired??[],globalWritingGuide=preparation?.globalWritingGuide??"",writingScale=preparation?.writingScale??1;
    const writingEdition=preparation?preparation.writingEdition:7;
    const workInstructions=writingEdition===7?WIKI_COMPOSITION_INSTRUCTIONS:writingEdition===6?EDITION6_WIKI_COMPOSITION_INSTRUCTIONS:writingEdition===5?EDITION5_WIKI_COMPOSITION_INSTRUCTIONS:writingEdition===4?EDITION4_WIKI_COMPOSITION_INSTRUCTIONS:writingEdition===3?EDITION3_WIKI_COMPOSITION_INSTRUCTIONS:writingEdition===2?EDITION2_WIKI_COMPOSITION_INSTRUCTIONS:writingEdition===1?V4_WIKI_COMPOSITION_INSTRUCTIONS:LEGACY_WIKI_COMPOSITION_INSTRUCTIONS;
    const factCatalogue=topicPlan?preparation?.factCatalogue:undefined,ownerTitles=new Map(topicPlan?.map(page=>[page.ownerId??page.sectionIds[0],page.title]));
    // Batch sizing reserves the largest per-request catalogue, never less than the
    // full one. A Han filler is estimated at the highest per-character rate.
    const sizingGuide=globalWritingGuide+(factCatalogue?"一".repeat(wikiChapterGuideAllowance(factCatalogue,ownerTitles)):"");
    const batchGuide=(batch:CoverageMaterial[])=>factCatalogue?wikiChapterGuide(factCatalogue,new Set(batch.flatMap(item=>item.wikiOwnerId?[item.wikiOwnerId]:[])),ownerTitles)+(preparation?.guideExtras??""):globalWritingGuide;
    const writingGuide=()=>sizingGuide+(topicPlan?topicPlanInstructions(topicPlan):"");
    const direct=directPayload(current,stage);
    const writtenSections:FocusSection[]=[];
    const writingGroups=final&&topicPlan?wikiWritingOrder(assignWikiOwners(current,topicPlan),topicPlan):undefined;
    const openingIds=new Map<string|undefined,string>(writingGroups?.map(group=>[group[0].wikiOwnerId,group[0].id]));
    // Intermediate notes describe evidence, not today's goal. Exact-input cache
    // reuse then works across goals and for unchanged prefix batches after edits.
    const directWriting = level === 0 && final;
    const requestFromPayload = (batch:CoverageMaterial[],payload:CoveragePayload,missing?:Array<{ownerId:string;titles:string[]}>) => {
      const batchEvidence = batch.map((item): FocusEvidence => ({ id: item.id, conversationId: item.conversationId, messageId: item.messageId, title: item.title, excerpt: item.text.slice(0, 240) }));
      return { taskType: "focus_session" as const, conversationIds: unique(batch.flatMap((item) => item.sourceConversationIds)),
        coveragePlan: { method: directWriting ? "full_direct" as const : "full_batched" as const, sourceCharacters: raw.reduce((sum, item) => sum + item.text.length, 0), materialBlocks: raw.length, plannedBatches: batchCount },
        system: final ? synthesisSystem(input.mode,workInstructions)+batchGuide(batch)+(topicPlan?topicPlanInstructions(topicPlan.filter(page=>batch.some(item=>item.wikiOwnerId===(page.ownerId??page.sectionIds[0])))):"")+(missing?" TARGETED COMPLETION: earlier verified prose is retained locally. Write ONLY the subtopics in THIS request's wikiTopics, using their exact ## titles and the supplied original support. Return valid evidenceIds explicitly; never infer citations, repeat completed subtopics or add an overview.":"") : SOURCE_NOTE_SYSTEM + (payload.projectKnowledge === true ? " In the same projectFacts output also extract concrete unanswered project questions into questions, with stable ids, text, status, reason and original quoteKey/quoteKeys. Preserve the complete questions in THIS batch; empty questions means none are present. A rhetorical question is not a blocker; a suggestion, generic continuation or silence is not an answer or resolution. No extra request or automatically generated diagram is required." : ""),
        ...(final && input.mode === "work" ? { temperature: 0.1 } : {}),
        ...(final && writingScale < 1 ? { inputBudgetScale: writingScale } : {}),
        prompt: JSON.stringify(payload),
        validate: (value: unknown) => {
          const normalized = trimWikiClaimOverflow(normalizeFocusOutput(value, payload));
          let result: CoverageResult;
          try { result = input.validate(normalized, batchEvidence, batch.map(item => ({ id: item.id, text: item.text, secondary: stage === "synthesis" }))); }
          catch(cause) { if(cause instanceof AIProviderValidationError)throw cause;throw withWikiClaimDetails(new AIProviderValidationError(focusOutputIssue(normalized, payload) ?? (wikiClaimIssues(normalized).length?"invalid_wiki_claim":"invalid_focus_output"), focusOutputDiagnostics(normalized, payload)),normalized); }
          if(final&&input.mode==="work"&&retired.length){
            const expand=(ids:string[])=>ids.flatMap(id=>batch.find(item=>item.id===id)?.rawEvidenceIds??[]);
            const claims=[...result.sections.flatMap(section=>section.claims??[]),...result.brief?.confirmed??[],...result.brief?.turningPoints??[]];
            if(claims.some(claim=>"quote" in claim&&typeof claim.quote==="string"&&retiredWikiClaim({quote:claim.quote,evidenceIds:expand(claim.evidenceIds)},retired)))throw new AIProviderValidationError("wiki_retired_proof_used_as_current");
          }
          if(final&&topicPlan){
            const owners=(payload.wikiTopics as Array<{ownerId:string}>).map(page=>page.ownerId);
            const validationPages=topicPlan.filter(page=>owners.includes(page.ownerId??page.sectionIds[0])).map(page=>missing?{...page,subtopics:page.subtopics?.filter(topic=>missing.some(item=>item.ownerId===(page.ownerId??page.sectionIds[0])&&item.titles.includes(topic.title)))}:page);
            result={...result,sections:result.sections.map((section,index)=>{
              const page=topicPlan!.find(page=>(page.ownerId??page.sectionIds[0])===section.wikiOwnerId);
              if(!page||owners.length&&!owners.includes((page.ownerId??page.sectionIds[0]))){const error=new AIProviderValidationError("wiki_owner_missing_or_unknown");error.fieldPaths=[`sections[${index}].wikiOwnerId`];throw error;}
              if(!section.evidenceIds.some(id=>batch.some(item=>item.id===id&&item.wikiOwnerId===section.wikiOwnerId))){const error=new AIProviderValidationError("wiki_owner_evidence_mismatch");error.fieldPaths=[`sections[${index}].evidenceIds`];throw error;}
              return {...section,wikiOwnerId:(page.ownerId??page.sectionIds[0]),wikiQuestion:page.question,wikiGroup:page.group,...(page.subtopics?{wikiSubtopics:page.subtopics.map(({title,question})=>({title,question}))}:{})};
            })};
            try{result={...result,sections:validateWikiWritingCoverage(result.sections,validationPages,batch).map(section=>wikiWritingQuality({...section,title:validationPages.find(page=>(page.ownerId??page.sectionIds[0])===section.wikiOwnerId)!.title},batch))};}
            catch(error){if(error instanceof AIProviderValidationError&&error.code==="PROVIDER_SCHEMA_wiki_subtopic_missing")error.wikiWritingDraft=result;throw error;}
            const returned=new Set(result.sections.map(section=>section.wikiOwnerId));
            if(owners.some(owner=>!returned.has(owner)))throw wikiOutlineError("missing_owner","sections.wikiOwnerId");
          }
          if (!final && !result.sections.some((section) => ["review", "finding"].includes(section.kind) && section.evidenceIds.length)) throw new Error("AI did not return usable source notes.");
          if (payload.projectKnowledge === true && normalized && typeof normalized === "object") {
            const wire=(normalized as {projectFacts?:{questions?:unknown}}).projectFacts;
            const facts=readProjectKnowledge(wire,batch);
            result.projectFacts=facts&&Array.isArray(wire?.questions)?{...facts,matterAnalysisVersion:1}:facts;
          }
          return result;
        } };
    };
    const readingRequest = (batch:CoverageMaterial[],legacy=false,factCache=false,oldMode=false) => {
      // Neutral review, semantic legacy and fact-bearing variants reuse paid source-note caches.
      const payload=payloadFor(batch,SOURCE_NOTE_INTENT,(oldMode||!compactBudget)?"review":input.mode,input.locale,input.sources.length,raw.length,"reading",input.analysisMode);
      if(input.mode === "work"&&!legacy)payload.semanticStructure=false;
      if(legacy)payload.semanticStructure=true;
      if((reuseKnowledge||factCache)&&!legacy){payload.projectKnowledge=true;payload.semanticStructure=false;}
      return requestFromPayload(batch,payload);
    };
    const compositionRequest = (batch:CoverageMaterial[],missing?:Array<{ownerId:string;titles:string[]}>) => {
      const payload = batch === current ? direct : payloadFor(batch,input.goal,input.mode,input.locale,input.sources.length,raw.length,stage,input.analysisMode);
      payload.coverage.final = true;
      if(input.mode === "work")Object.assign(payload,{semanticStructure:false,overviewFromWiki:true,projectBoundary:direct.projectBoundary,sourceRouting:wikiScopeWritingRouting(wikiScopeReview,batch)});
      if(input.scopeKind)Object.assign(payload.coverage,{scope:input.scopeKind});
      if(payload.strategy === "review")payload.presentation="reading_route";
      if(topicPlan){const owners=new Set(batch.flatMap(item=>item.wikiOwnerId?[item.wikiOwnerId]:[]));payload.wikiTopics=topicPlan.filter(page=>owners.has((page.ownerId??page.sectionIds[0]))).map(page=>({ownerId:(page.ownerId??page.sectionIds[0]),title:page.title,question:page.question,opening:!missing&&batch.some(item=>opensWikiChapter(item.id,openingIds.get(item.wikiOwnerId))),chapterOutline:page.subtopics?.map(({title,question})=>({title,question})),...(page.subtopics?{subtopics:page.subtopics.flatMap(topic=>{const evidenceIds=batch.filter(item=>topic.sectionIds.some(id=>item.id===id||item.id.startsWith(`${id}:`))).map(item=>item.id);return evidenceIds.length?[{title:topic.title,question:topic.question,evidenceIds}]:[];})}:{})}));}
      if(input.mode==="work"&&sameQuestions.length){
        const {passageKeys,questions}=sameQuestionAnnotations(sameQuestions,batch);
        if(questions.length){payload.passages=payload.passages.map(passage=>passageKeys.has(passage.id)?{...passage,sameQuestion:passageKeys.get(passage.id)}:passage);payload.crossAIQuestions=questions;}
      }
      if(missing)payload.wikiTopics=(payload.wikiTopics as Array<{ownerId:string;subtopics?:Array<{title:string}>}>).filter(page=>missing.some(item=>item.ownerId===page.ownerId)).map(page=>({...page,subtopics:page.subtopics?.filter(topic=>missing.some(item=>item.ownerId===page.ownerId&&item.titles.includes(topic.title)))}));
      if(input.mode==="work"&&retired.length)payload.wikiExcludedProofs=retired.flatMap(proof=>{const ids=batch.filter(item=>item.rawEvidenceIds.some(id=>proof.evidenceIds.includes(id))).map(item=>item.id);return ids.length?[{quote:proof.quote,evidenceIds:ids,reason:proof.reason}]:[];});
      if(topicPlan&&!missing&&writtenSections.length){
        const topics=payload.wikiTopics as Array<{ownerId:string;subtopics?:Array<{title:string}>;existingExplanations?:ReturnType<typeof wikiExistingExplanations>}>;
        for(const topic of topics)topic.existingExplanations=wikiExistingExplanations(writtenSections.filter(section=>section.wikiOwnerId===topic.ownerId),topic.subtopics?.map(item=>item.title)??[],1800,writingEdition!==undefined,writingEdition!==undefined&&writingEdition>=2);
        // Context is optional navigation. Shrink whole context paragraphs only;
        // raw material and evidence must never be cut to make it fit.
        while(topics.some(topic=>topic.existingExplanations?.length)){
          const budget=requestBudget({taskType:"focus_session",system:synthesisSystem(input.mode,workInstructions)+sizingGuide+topicPlanInstructions(topicPlan),prompt:JSON.stringify(payload)},input.modelId);
          if(budget.inputTokens*writingScale<=budget.maxInputTokens-500)break;
          [...topics].reverse().find(topic=>topic.existingExplanations?.length)!.existingExplanations!.pop();
        }
      }
      return requestFromPayload(batch,payload,missing);
    };
    const writingRequest = (batch:OwnedMaterial[],missing?:Array<{ownerId:string;titles:string[]}>) => compositionRequest(batch,missing);
    const requestFor = (batch:CoverageMaterial[],legacy=false,factCache=false,oldMode=false,missing?:Array<{ownerId:string;titles:string[]}>) => final?(topicPlan?writingRequest(assignWikiOwners(batch,topicPlan),missing):compositionRequest(batch,missing)):readingRequest(batch,legacy,factCache,oldMode);
    const requests = new Map<CoverageMaterial[], ReturnType<typeof requestFor>>();
    const preparedRequest = (batch: CoverageMaterial[]) => {
      let request = requests.get(batch);
      if (!request) { request = requestFor(batch); requests.set(batch, request); }
      return request;
    };
    const adoptCached = cachedSynthesis ? async (batch: CoverageMaterial[]) => {
      if (await cachedSynthesis(preparedRequest(batch))) return true;
      // Optional facts do not justify re-reading already paid legacy notes.
      if (!final && level === 0 && input.mode === "work") {
        const neutral=requestFor(batch,false,false,true);if(await cachedSynthesis(neutral)){requests.set(batch,neutral);return true;}
        const old = requestFor(batch, true,false,true);
        if (await cachedSynthesis(old)) { requests.set(batch, old); return true; }
        if (input.ai.canReuseProjectKnowledge) { const facts = requestFor(batch,false,true,true); if (await cachedSynthesis(facts)) { requests.set(batch,facts); return true; } }
      }
      return false;
    } : undefined;
    const partition = (items: CoverageMaterial[], legacy = false) => responsiveCoverageBatches(input.signal, items, final ? input.goal : SOURCE_NOTE_INTENT, !final&&(legacy||!compactBudget)?"review":input.mode, input.locale, input.sources.length, raw.length, stage, input.modelId, input.analysisMode, final, legacy ? false : compactBudget, writingGuide(),workInstructions,final?writingScale:1);
    // Ownership controls where facts belong, not how many paid requests to make.
    let batches = final ? requestFits(direct, input.modelId, compactBudget, writingGuide(),workInstructions,writingScale) ? [writingGroups?.flat()??current] : writingGroups ? (await Promise.all(writingGroups.map(group=>partition(group)))).flat() : await partition(current)
      : await stableReadingBatches(current, { namespace: analysisKey ? JSON.stringify([analysisKey, input.locale, input.analysisMode ?? "balanced"]) : undefined, signal: input.signal, partial: input.scopeKind === "goal", partition,
        fits: batch => requestFits(payloadFor(batch, SOURCE_NOTE_INTENT, input.mode, input.locale, input.sources.length, raw.length, stage, input.analysisMode), input.modelId, compactBudget),
        cached: adoptCached });
    input.signal.throwIfAborted();
    // Reuse a known partition before calling the model or estimating quota.
    const expandKnown = async (batch: CoverageMaterial[], depth = 0): Promise<CoverageMaterial[][]> => {
      input.signal.throwIfAborted();
      // Writing context belongs to the original logical batch. Expand learned
      // splits at execution, after that context is fixed, so a resumed child
      // keeps the same prompt/cache identity as its first successful write.
      if(final&&topicPlan)return [batch];
      if (depth >= (final ? 2 : 8))return [batch];
      const strategy=await outputSplitStrategy(preparedRequest(batch).prompt,input.modelId);if(!strategy)return [batch];
      const parts = strategy==="owner"?splitWikiOwnerBatch(batch)??splitOutputBatch(batch):strategy==="topic"&&topicPlan?splitWikiWritingBatch(batch,topicPlan)??splitOutputBatch(batch):splitOutputBatch(batch);
      return parts ? (await Promise.all(parts.map(part => expandKnown(part, depth + 1)))).flat() : [batch];
    };
    const fitActual=async(batch:CoverageMaterial[]):Promise<CoverageMaterial[][]>=>{
      const request=preparedRequest(batch),budget=requestBudget(request,input.modelId);
      if(budget.inputTokens*(final?writingScale:1)<=budget.maxInputTokens-500)return expandKnown(batch);
      const parts=splitOutputBatch(batch);if(!parts)throw new Error("Source request exceeds input budget");
      return (await Promise.all(parts.map(fitActual))).flat();
    };
    batches = (await Promise.all(batches.map(fitActual))).flat();
    if(final&&topicPlan&&sameQuestions.length)batches=keepSameQuestionsTogether(batches,sameQuestions,batch=>{const budget=requestBudget(preparedRequest(batch),input.modelId);return budget.inputTokens*writingScale<=budget.maxInputTokens-500;});
    requests.clear(); batchCount += batches.length;
    if (adoptCached && input.mode === "work" && !final) await Promise.all(batches.map(adoptCached));
    if (level === 0 && !final) await input.ai.prepareFocus?.(batches.map(preparedRequest), { goal: input.goal, mode: input.mode, analysisMode: input.analysisMode });
    input.signal.throwIfAborted();
    const next: CoverageMaterial[] = [];
    let completed = 0;
    let totalWork = batches.length;
    let recoverySplits = 0;
    const writingRecovery={requests:0,tokens:0};
    // Scale the guard to real material count so a long conversation can recover
    // across many batches; depth and minimum-piece guards still bound retries.
    const splitLimit = Math.max(32, Math.min(256, current.length * 2));
    const expectedRaw = new Map<string, number>();
    const finishedRaw = new Map<string, number>();
    const rawById = new Map(raw.map(item => [item.id, item]));
    if (level === 0) for (const item of batches.flat()) for (const id of item.rawEvidenceIds) expectedRaw.set(id, (expectedRaw.get(id) ?? 0) + 1);
    const requestDurations: number[] = [];
    let readyChapters=0,firstPreviewMs:number|undefined;
    let directoryProgress:import("../shared/focus-progress").WikiPlanningProgress|undefined;
    const report = () => input.onProgress?.(completed, totalWork, stage, {
      completed, total: totalWork, stage, final, round: level + 1, remainingSteps: Math.max(0, totalWork - completed) + Number(!final), stepsEstimated: !final, recoverySplits,
      completedSourceIds: input.sources.filter((source) => (sourceCompleted.get(source.id) ?? 0) === sourceTotals.get(source.id) && (sourceTotals.get(source.id) ?? 0) > 0).map((source) => source.id),
      totalSources: input.sources.length, processedSegments: completedRaw.size, totalSegments: raw.length,
      elapsedMs: performance.now() - startedAt, reusedBatches,readyChapters,firstPreviewMs,
      resumed,directory:directoryProgress,
      ...(!final&&directoryProgress&&completedRaw.size===raw.length?{phase:"directory" as const}:{}),
      ...(requestDurations.length >= 2 && completed < totalWork && !final ? { remainingMs: requestDurations.reduce((sum, value) => sum + value, 0) / requestDurations.length * Math.ceil((totalWork - completed) / width()) } : {}),
    });
    report();
    // Refill each free slot immediately. Preserve result order, stop scheduling
    // on failure and settle in-flight requests so their receipts/cache survive.
    const width = () => Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(input.ai.capabilities?.maxConcurrency || 1)));
    const results = new Array<Array<{ batch: CoverageMaterial[]; result: CoverageResult }>>(batches.length);
    const readingQueue = !final && input.mode === "work" && input.ai.generateStructured ? createRequestQueue(width, input.signal) : undefined;
    let directoryReceipt:WikiPlanReceipt|undefined;
    // Every catalogue chunk is recorded so a fresh planner can replay it in the same
    // order: same windows, same checkpoint keys, so finished work is reused.
    const appendedCatalogue:FocusSection[][]=[];
    const makeDirectory = () => createWikiTopicPlanner(input.locale, {
      modelId:input.modelId, capabilities:input.ai.capabilities,
      getAnalysisKey:input.ai.getAnalysisKey?()=>input.ai.getAnalysisKey!():undefined,
      supportsCacheMissGuard:input.ai.supportsCacheMissGuard,
      generateStructured:request=>readingQueue!.run(()=>{if(failed)throw failure;return input.ai.generateStructured!(request);}),
    },input.signal,value=>{directoryReceipt=value;},{goal:input.goal,includeKeys:input.wikiScopeIncludeKeys,excludeKeys:[...excludeKeys],ignoredKeys:input.wikiScopeIgnoredKeys,project:input.wikiProjectBoundary,sourceTitles:input.sources.map(source=>source.title)},{refine:true,conversations:input.sources.length,...(input.wikiPreviousDirectory?.length?{previousDirectory:input.wikiPreviousDirectory}:{}),onProgress:value=>{directoryProgress=value;report();}});
    const directory = readingQueue ? makeDirectory() : undefined;
    const continueDirectory = readingQueue ? () => { const planner = makeDirectory(); for (const chunk of appendedCatalogue) planner.append(chunk); return planner; } : undefined;
    const preparedNotes = new Map<CoverageMaterial[],CoverageMaterial[]>();
    let catalogueBatch=0,catalogueNoteIndex=0;
    const appendReadyCatalogue = () => {
      if(!directory)return;
      // Completion order must not change note IDs, window boundaries or cache
      // identities. Only the contiguous successful reading prefix is appended.
      while(results[catalogueBatch]){
        for(const {batch,result} of results[catalogueBatch++]){
          const notes=wikiWritingUnits(notesFromResult(result,batch,level,catalogueNoteIndex++,input.locale));
          const catalogue=enrichWikiWritingNotes(notes,result.projectFacts,batch);
          preparedNotes.set(batch,catalogue);
          // Materials the user removed never reach the planner: no tokens, no influence on chapters.
          const sections=catalogue.map(note=>({id:note.id,title:note.title,body:note.text,kind:"finding" as const,transition:"",evidenceIds:note.rawEvidenceIds}));
          for(const section of sections)if(excludeKeys.has(wikiMaterialKey(section)))userExcluded.push(section);
          const chunk=sections.filter(section=>!excludeKeys.has(wikiMaterialKey(section)));
          appendedCatalogue.push(chunk);directory.append(chunk);
        }
      }
    };
    let previewChain=Promise.resolve();
    let failed = false;
    let failure: unknown;
    const scheduledAt=performance.now();
    const write=<T,>(request:StructuredAIRequest<T>,allowance:WritingAllowance,extra:boolean,onCacheHit:()=>void)=>writeWikiRequest(input,batches.length,writingRecovery,request,allowance,extra,onCacheHit);
    const recover = async (batch: CoverageMaterial[], depth = 0, parentOperationId?:string,recoveryReason?:"output_truncation"|"schema"|"transport",topicRecovery=false,allowance:WritingAllowance={count:0,tokens:0},correction?:string): Promise<Array<{ batch: CoverageMaterial[]; result: CoverageResult }>> => {
      input.signal.throwIfAborted();
      if (failed) throw failure;
      let reused = false;
      const began = performance.now();
      const baseRequest=preparedRequest(batch);
      const request=correction?{...baseRequest,system:baseRequest.system+` TARGETED FORMAT CORRECTION: previous output failed ${correction}. Return every required section with explicit evidenceIds from this request. Do not guess citations or remove source conditions.${/_wiki_owner_(?:missing_or_unknown|evidence_mismatch)$/u.test(correction)?" Copy wikiOwnerId exactly from the requested wikiTopics ownerId into every section. Cite at least one passage whose wikiOwnerId equals that section's owner. Do not use a title, topic key, ordinal or evidence ID as the owner. Cross-chapter citations are supporting context only; never change their owner or invent citations.":""}${correction==="PROVIDER_SCHEMA_invalid_wiki_claim"?" Each section has at most 12 claims. Each claim needs nonempty text (at most 400 characters), a nonempty literal original quote (at most 350 characters), and an explicit nonempty evidenceIds array using this request's support. Keep all substantive prose; never invent, drop or replace source evidence to repair metadata.":""}`}:baseRequest;
      let result: CoverageResult;
      let compositionParts:CoverageResult[]|undefined;
      // A model response is bounded by its wire schema. A local article may
      // contain many such responses: revalidate each original piece, then
      // check their combined topic coverage without applying wire size limits
      // to the accumulated body/claims or discarding any of its evidence.
      const validateComposition=(parts:CoverageResult[]):CoverageResult=>{
        const pages=topicPlan?.filter(page=>batch.some(item=>item.wikiOwnerId===(page.ownerId??page.sectionIds[0])));
        if(!final||!pages?.length||!Array.isArray(parts)||!parts.length||parts.length>1+pages.reduce((sum,page)=>sum+batchSubtopics(page,batch).length,0))throw new AIProviderValidationError("wiki_writing_checkpoint_invalid");
        const verified=parts.map(part=>{
          try{return baseRequest.validate(part);}catch(error){
            if(error instanceof AIProviderValidationError&&error.code==="PROVIDER_SCHEMA_wiki_subtopic_missing"&&error.wikiWritingDraft)return error.wikiWritingDraft as CoverageResult;
            throw error;
          }
        });
        const merged=coalesceWikiOwners(joinedResults(verified,input.locale));
        try{return {...merged,sections:validateWikiWritingCoverage(merged.sections,pages,batch)};}catch(error){
          if(error instanceof AIProviderValidationError&&error.code==="PROVIDER_SCHEMA_wiki_subtopic_missing")error.wikiWritingDraft=merged;
          throw error;
        }
      };
      const operationId=crypto.randomUUID();
      const writingId=final?await checkpoints?.key("writing",[baseRequest.system,baseRequest.prompt,batch]):undefined;
      const retained=writingId?await checkpoints?.read<WritingCheckpoint>(writingId):undefined;
      let retainedFailure:AIProviderValidationError|undefined;
      if(retained){try{
        if(retained.parts){
          compositionParts=retained.parts;
          try{result=validateComposition(retained.parts);reused=true;}catch(error){
            if(error instanceof AIProviderValidationError&&error.wikiWritingDraft)retainedFailure=error;else throw error;
          }
        }
        else if(retained.claimDraft){try{result=baseRequest.validate(retained.claimDraft);reused=true;}catch(error){if(error instanceof AIProviderValidationError&&error.wikiClaimDraft)retainedFailure=error;else throw error;}}
        else if(retained.result){result=baseRequest.validate(retained.result);reused=true;}
        else if(retained.draft){try{result=baseRequest.validate(retained.draft);reused=true;}catch(error){if(error instanceof AIProviderValidationError&&error.wikiWritingDraft)retainedFailure=error;else throw error;}}
      }catch{compositionParts=undefined;await checkpoints?.remove(writingId!,retained);}}
      if(final&&topicPlan&&!reused&&!retainedFailure&&depth<2){
        const strategy=await outputSplitStrategy(baseRequest.prompt,input.modelId);
        const parts=strategy==="owner"?splitWikiOwnerBatch(batch)??splitOutputBatch(batch):strategy==="topic"?splitWikiWritingBatch(batch,topicPlan)??splitOutputBatch(batch):strategy?splitOutputBatch(batch):undefined;
        if(parts){
          totalWork+=parts.length-1;recoverySplits++;report();
          const recovered:Array<{batch:CoverageMaterial[];result:CoverageResult}>=[];
          for(const part of parts)recovered.push(...await recover(part,depth+1,operationId,strategy==="topic"?"schema":"output_truncation",strategy==="topic",allowance));
          return recovered;
        }
      }
      try {
        if(retainedFailure)throw retainedFailure;
        if(!reused){const traced={...request,trace:{feature:"wiki" as const,operation:`wiki:${stage}${final?":final":""}`,operationId,parentOperationId,recoveryReason,recoveryDepth:depth,schedulingMs:Math.round(began-scheduledAt)}};
          const synthesize=()=>final&&topicPlan?write(traced,allowance,Boolean(recoveryReason),()=>{reused=true;}):input.ai.synthesize({...traced,signal:input.signal,onCacheHit:()=>{reused=true;}});
          result=await(readingQueue?readingQueue.run(()=>{if(failed)throw failure;return synthesize();}):synthesize());
        }
      }
      catch (originalCause) {
        let cause=originalCause;
        input.signal.throwIfAborted();
        let metadataRepaired=false;
        if(final&&topicPlan&&!("id" in input.ai&&input.ai.id==="atlas-demo")&&cause instanceof AIProviderValidationError&&cause.wikiClaimDraft&&!allowance.claims){
          const repair=wikiClaimRepairRequest(cause.wikiClaimDraft,batch,baseRequest.validate,raw);
          const repairBudget=repair?requestBudget(repair.request,input.modelId):undefined;
          if(repair&&repairBudget&&repairBudget.inputTokens<=repairBudget.maxInputTokens-500){
            if(writingId)await checkpoints?.write<WritingCheckpoint>(writingId,{claimDraft:cause.wikiClaimDraft});
            allowance.claims=true;
            try{
              const patch=await write({...repair.request,trace:{feature:"wiki",operation:"wiki:writing:claims",operationId:crypto.randomUUID(),parentOperationId:operationId,recoveryReason:"schema",recoveryDepth:depth+1}},allowance,true,()=>{reused=true;});
              result=repair.apply(patch);metadataRepaired=true;
            }catch(error){
              input.signal.throwIfAborted();
              if(!(error instanceof AIProviderValidationError)||error.code==="PROVIDER_SCHEMA_wiki_writing_recovery_limit")throw error;
              if(writingId)await checkpoints?.remove(writingId,{claimDraft:cause.wikiClaimDraft});
              if(error instanceof AIProviderValidationError&&error.wikiWritingDraft)cause=error;
            }
          }
        }
        if(!metadataRepaired){
        // One interrupted final response may retry its retained notes once.
        // Timeouts below shrink only the affected write, never raw reading.
        if(final&&topicPlan&&depth===0&&cause instanceof AIProviderResponseError&&cause.code==="PROVIDER_STREAM_INCOMPLETE"&&!allowance.transport){
          allowance.transport=true;return recover(batch,depth+1,operationId,"transport",false,allowance);
        }
        const formatFailure = cause instanceof AIProviderValidationError && /_(?:missing_section_text|invalid_sections|invalid_section_type|invalid_json)$/u.test(cause.code);
        const missingTopic=final&&topicPlan&&cause instanceof AIProviderValidationError&&cause.code==="PROVIDER_SCHEMA_wiki_subtopic_missing";
        // Metadata-only repair can still fail when a response mixes chapters.
        // Retry with original support partitioned by owner, under the existing
        // recovery allowance; never assign ownership from title or position.
        const writingFailure=final&&topicPlan&&cause instanceof AIProviderValidationError&&/_(?:wiki_owner_missing_or_unknown|wiki_owner_evidence_mismatch|wiki_directory_missing_owner|missing_evidence_ids|unknown_evidence_id|invalid_wiki_claim)$/u.test(cause.code);
        const timedOut=final&&topicPlan&&cause instanceof AIProviderResponseError&&cause.code==="PROVIDER_TIMEOUT";
        const recoverable = outputWasTruncated(cause) || formatFailure || missingTopic || writingFailure || timedOut;
        const ownerParts=writingFailure?splitWikiOwnerBatch(batch):undefined;
        const topicParts=missingTopic?splitWikiWritingBatch(batch,topicPlan!):undefined;
        if(missingTopic&&topicPlan&&cause instanceof AIProviderValidationError&&cause.wikiWritingDraft&&cause.wikiMissingSubtopics){
          // Retain existing prose even when its sources could be partitioned.
          // Complete missing scopes together when bounded, never re-author
          // successful topics merely because another heading was omitted.
          let draft=cause.wikiWritingDraft as CoverageResult,missing=cause.wikiMissingSubtopics;
          compositionParts??=[draft];
          while(true){
            if(writingId)await checkpoints?.write<WritingCheckpoint>(writingId,{draft,parts:compositionParts});
            input.signal.throwIfAborted();if(failed)throw failure;
            let target=[{ownerId:missing[0].ownerId,titles:missing[0].titles.slice(0,3)}];
            let support=wikiMissingTopicBatch(batch,topicPlan,target);
            if(!support.length)throw cause;
            let baseSupplement=requestFor(support,false,false,false,target);
            let supplementBudget=requestBudget(baseSupplement,input.modelId);
            const available=Math.min(WRITING_RECOVERY.stageOutputTokens-writingRecovery.tokens,WRITING_RECOVERY.batchOutputTokens-allowance.tokens);
            // Narrow optional multi-topic recovery before trying to fit the
            // last allowance. Whole original support is always retained.
            while(target[0].titles.length>1&&(supplementBudget.inputTokens*writingScale>supplementBudget.maxInputTokens-500||wikiBudgetedCompletionLimit(supplementBudget.maxOutputTokens,support,target[0].titles.length,available)>available)){
              target=[{...target[0],titles:target[0].titles.slice(0,-1)}];
              support=wikiMissingTopicBatch(batch,topicPlan,target);
              baseSupplement=requestFor(support,false,false,false,target);
              supplementBudget=requestBudget(baseSupplement,input.modelId);
            }
            const supplement={...baseSupplement,maxOutputTokens:wikiBudgetedCompletionLimit(supplementBudget.maxOutputTokens,support,target[0].titles.length,available)};
            let added:CoverageResult;
            try{added=await write({...supplement,trace:{feature:"wiki",operation:"wiki:writing:complete",operationId:crypto.randomUUID(),parentOperationId:operationId,recoveryReason:"schema",recoveryDepth:depth+1}},allowance,true,()=>{reused=true;});}
            catch(error){
              // A supplement may itself cover only some requested scopes.
              // Its already source-validated prose is useful; merge it before
              // continuing, with the same strict budget and progress checks.
              if(!(error instanceof AIProviderValidationError)||!error.wikiWritingDraft||!error.wikiMissingSubtopics)throw error;
              added=error.wikiWritingDraft as CoverageResult;
            }
            const nextParts:CoverageResult[]=[...compositionParts!,added];
            try{result=validateComposition(nextParts);compositionParts=nextParts;break;}catch(error){
              if(!(error instanceof AIProviderValidationError)||!error.wikiWritingDraft||!error.wikiMissingSubtopics)throw error;
              const before=missing.flatMap(item=>item.titles).length,after=error.wikiMissingSubtopics.flatMap(item=>item.titles).length;
              if(after>=before)throw error;
              compositionParts=nextParts;draft=error.wikiWritingDraft as CoverageResult;missing=error.wikiMissingSubtopics;
            }
          }
        }else{
        const parts = recoverable && depth < (formatFailure||missingTopic||writingFailure ? 2 : final ? 2 : MAX_READING_RECOVERY_DEPTH) && recoverySplits < (formatFailure||writingFailure||missingTopic ? Math.min(32, splitLimit) : splitLimit) ? ownerParts??topicParts??splitOutputBatch(batch) : undefined;
        // Missing prose cannot be repaired without originals. Re-extract only
        // this small batch; do not regenerate successful batches or invent text.
        if (!parts && (formatFailure||writingFailure||timedOut) && depth === 0 && !failed) return recover(batch, depth + 1,operationId,timedOut?"transport":"schema",false,allowance,cause instanceof AIProviderValidationError?cause.code:undefined);
        if (!parts || failed) throw cause;
        totalWork += parts.length - 1; batchCount += parts.length - 1; recoverySplits++;
        if (level === 0) {
          for (const item of batch) for (const id of item.rawEvidenceIds) expectedRaw.set(id, (expectedRaw.get(id) ?? 0) - 1);
          for (const item of parts.flat()) for (const id of item.rawEvidenceIds) expectedRaw.set(id, (expectedRaw.get(id) ?? 0) + 1);
        }
        report();
        // Each worker keeps its concurrency slot. Do not multiply provider concurrency.
        const recovered: Array<{ batch: CoverageMaterial[]; result: CoverageResult }> = [];
        for (const part of parts) {
          if (failed) throw failure;
          recovered.push(...await recover(part, depth + 1,operationId,formatFailure||missingTopic||writingFailure?"schema":timedOut?"transport":"output_truncation",Boolean(topicRecovery||missingTopic),allowance,final&&topicPlan&&(formatFailure||writingFailure)&&cause instanceof AIProviderValidationError?cause.code:undefined));
          // Remember a partition only after a child actually succeeds. A fully
          // failing branch must not grow deeper on every manual retry.
          await rememberOutputSplit(request.prompt, input.modelId,ownerParts?"owner":topicParts?"topic":"split");
        }
        return recovered;
        }
      }
      }
      if(writingId)await checkpoints?.write<WritingCheckpoint>(writingId,{result:result!,...(compositionParts?{parts:compositionParts}:{})});
      if (reused) reusedBatches++; else requestDurations.push(performance.now() - began);
      input.signal.throwIfAborted();
      completed++;
      if (level === 0) for (const item of batch) for (const id of item.rawEvidenceIds) {
        const count = (finishedRaw.get(id) ?? 0) + 1; finishedRaw.set(id, count);
        if (count === expectedRaw.get(id) && !completedRaw.has(id)) {
          completedRaw.add(id);
          const sourceId = rawById.get(id)!.conversationId;
          sourceCompleted.set(sourceId, (sourceCompleted.get(sourceId) ?? 0) + 1);
        }
      }
      report();
      return [{ batch, result:result! }];
    };
    const jobs=final&&topicPlan?wikiWritingJobs(batches.map(batch=>assignWikiOwners(batch,topicPlan!))):batches.map((_,index)=>[index]);
    // Outline first: as soon as the plan exists, readers see every chapter's
    // title, question and key points; prose replaces each one as it is written.
    const outlining=final&&input.mode==="work"&&Boolean(topicPlan)&&Boolean(input.onPartial);
    const zh=input.locale==="zh-CN",outlineTitle=input.wikiProjectBoundary?.name??(zh?"项目知识":"Project knowledge");
    if(outlining){
      const outline=expandResult({title:outlineTitle,sections:wikiOutlineSections(topicPlan!,current,zh)},current,evidence);
      if(outline.sections.length)previewChain=previewChain.then(async()=>{input.signal.throwIfAborted();await input.onPartial?.(outline,evidence,wikiScopeReview);input.signal.throwIfAborted();firstPreviewMs??=Math.round(performance.now()-startedAt);report();});
      await previewChain;
    }
    // Workers take the next job when they free up, preferring the chapter being read.
    const pendingJobs=jobs.map((_,index)=>index);
    const jobOwners=jobs.map(indexes=>new Set(indexes.flatMap(index=>(topicPlan?assignWikiOwners(batches[index],topicPlan):batches[index]).flatMap(item=>item.wikiOwnerId?[item.wikiOwnerId]:[]))));
    const nextJob=()=>{const wanted=input.priorityOwner?.(),at=wanted?pendingJobs.findIndex(job=>jobOwners[job].has(wanted)):-1;return jobs[pendingJobs.splice(Math.max(0,at),1)[0]];};
    try { await executeBatches(jobs,{capabilities:{textGeneration:true,structuredOutput:"prompt-only",embeddings:false,get maxConcurrency(){return width();}}},async()=>{
     const indexes=nextJob();
     for(const index of indexes){
      const batch=batches[index];
      try{results[index]=await recover(batch);
        if(final&&topicPlan)writtenSections.push(...results[index].flatMap(item=>item.result.sections));
        appendReadyCatalogue();
        if(final&&input.onPartial){
          const complete=results.filter(Boolean).flat();
          const merged=coalesceWikiOwners(joinedResults(complete.map(item=>item.result),input.locale));
          const chapters=input.mode==="work"?merged.sections.map(section=>wikiWritingQuality(section,complete.flatMap(item=>item.batch))):merged.sections;
          const partial=expandResult({...merged,sections:outlining?withWikiOutline(chapters,topicPlan!,current,zh):chapters},[...complete.flatMap(item=>item.batch),...current],evidence);
          // Serialize callbacks; never publish an older partial after a newer one.
          previewChain=previewChain.then(async()=>{input.signal.throwIfAborted();await input.onPartial?.(partial,evidence,wikiScopeReview);input.signal.throwIfAborted();readyChapters=partial.sections.length;firstPreviewMs??=Math.round(performance.now()-startedAt);report();});
          await previewChain;
        }
      }
      catch(cause){
        // Siblings may receive this same failure while draining. Only its
        // originating batch supplies context; never mutate it once per sibling.
        if(!failed){
          if(cause instanceof Error&&!input.signal.aborted)cause.message+=` (${final?(input.locale==="zh-CN"?"Wiki 正文批次":"Wiki writing batch"):(input.locale==="zh-CN"?"材料批次":"Source batch")} ${index+1}/${batches.length})`;
          failure=cause;failed=true;
        }
        directory?.stop(failure);throw failure;
      }
     }
    },input.signal); input.signal.throwIfAborted(); } catch(cause) { directory?.stop(cause); await directory?.drain(); throw cause; }
    input.signal.throwIfAborted();
    if (failed) throw failure;
    const ordered = results.flat();
    if (final) {
      let joined=joinedResults(ordered.map(item=>item.result),input.locale);
      const edits=await titleEdits,titled=topicPlan&&edits?applyWikiTitleEdits(topicPlan,edits):topicPlan;
      if(topicPlan)joined={...joined,title:input.wikiProjectBoundary?.name??edits?.documentTitle??(topicPlan.length===1?joined.title:input.locale==="zh-CN"?"项目知识":"Project knowledge"),sections:joined.sections.map(section=>{
        const index=topicPlan!.findIndex(page=>section.wikiOwnerId===(page.ownerId??page.sectionIds[0])||!section.wikiOwnerId&&section.title===page.title);
        if(index<0)return section;
        const planned=topicPlan![index],page=titled![index];
        return {...section,body:renameWikiHeadings(section.body,planned,page),wikiOwnerId:(page.ownerId??page.sectionIds[0]),title:page.title,wikiQuestion:page.question,wikiGroup:page.group,...(page.materialKeys?.length?{wikiMaterialKeys:page.materialKeys}:{}),...(page.subtopics?{wikiSubtopics:page.subtopics.map(({title,question})=>({title,question}))}:{})};
      })};
      const consolidated=coalesceWikiOwners(joined);
      // Thin or surplus subsections join a neighbour before openings summarize the chapter.
      let naming:Promise<Map<string,Map<number,string>>>|undefined;
      if(input.mode==="work"){
        const merged=mergeThinWikiChapters(consolidated.sections);consolidated.sections=merged.sections;
        // A joined subsection still carries one part's heading; name it by what it now explains.
        // Naming changes only heading lines and openings only the first paragraph, so both run at once.
        if(merged.toName.length){
          let report:WikiSubheadingNameReport|undefined;
          const sections=consolidated.sections;
          const name=async()=>{const value=await nameMergedSubheadings(sections,merged.toName,input.ai,input.signal,input.locale);report=value.report;return value;};
          naming=(input.runId?measureAILocalStep(input.runId,"wiki","wiki:subheading-names",name,()=>report?{requested:report.requested,renamed:report.renamed,...Object.fromEntries(Object.entries(report.rejected).map(([reason,count])=>[`rejected_${reason}`,count]))}:{}):name()).then(value=>value.names);
          // Awaited below; a failure here must not surface as an unhandled rejection meanwhile.
          naming.catch(()=>undefined);
        }
      }
      if(input.mode==="work"&&topicPlan){
        // Openings are written last, from each finished chapter's own conclusions.
        const writtenMaterials=ordered.flatMap(item=>item.batch);
        const refresh=()=>refreshWikiChapterOpenings(consolidated.sections,input.ai,input.signal,input.locale,4,{
          sources:claim=>{const support=new Set(writtenMaterials.filter(note=>claim.evidenceIds.includes(note.id)).flatMap(note=>note.rawEvidenceIds));return raw.filter(source=>support.has(source.id)&&wikiQuoteRange(source.text,claim.quote)).map(({role,conversationId,messageIndex,discussedAt})=>({role:role??"unknown",conversationId,messageIndex,...(discussedAt?{discussedAt}:{})}));},
          routing:section=>wikiScopeWritingRouting(wikiScopeReview,writtenMaterials.filter(note=>section.evidenceIds.includes(note.id))),
        });
        let report:WikiOpeningReport|undefined;
        const refreshed=input.runId?await measureAILocalStep(input.runId,"wiki","wiki:chapter-openings",async()=>{const value=await refresh();report=value.report;return value;},()=>report?{requested:report.requested,accepted:report.accepted,dropped:report.dropped,stripped:report.stripped,...(report.replacedLead?{replaced_lead:report.replacedLead}:{}),...(report.retried?{retried:report.retried}:{}),...Object.fromEntries(Object.entries(report.rejected).map(([reason,count])=>[`rejected_${reason}`,count]))}:{}):await refresh();
        consolidated.sections=refreshed.sections;
      }
      if(naming){const names=await naming;consolidated.sections=consolidated.sections.map(section=>renameWikiSubheadings(section,new Map(names.get(section.id)??[])));}
      if(input.mode==="work")consolidated.sections=withCrossChapterDuplicates(consolidated.sections.map(section=>wikiWritingQuality(section,ordered.flatMap(item=>item.batch),{completeChapter:true})));
      if(topicPlan){
        assertWikiOutline(topicPlan);
        if(consolidated.sections.length!==topicPlan.length)throw wikiOutlineError("publication_count","sections");
      }
      const expanded=expandResult(consolidated,ordered.flatMap(item=>item.batch),evidence);
      return { result: expanded, wikiScopeReview, wikiTitleReview:titleReview, topicPlanApplied: Boolean(topicPlan), ...(knowledgeBatches.length ? { knowledgeBatches } : {}), evidence, sourceOutlines, segmentCount: raw.length, method: level === 0 ? "full_direct" : "full_batched", batchCount, sourceCharacters: raw.reduce((sum, item) => sum + item.text.length, 0) };
    }
    const writing:Array<{notes:CoverageMaterial[];facts:ProjectState|undefined;batch:CoverageMaterial[]}>=[];
    for (const [index, { batch, result }] of ordered.entries()) {
      if (level === 0) {
        if (reuseKnowledge || result.projectFacts) {
          const mapRefs = (value: unknown): unknown => Array.isArray(value) ? value.map(mapRefs) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, field]) => [key, ["evidenceIds", "beforeEvidenceIds", "reasonEvidenceIds", "confirmationEvidenceIds", "workEvidenceIds"].includes(key) && Array.isArray(field) ? unique(field.flatMap(id => batch.find(item => item.id === id)?.rawEvidenceIds ?? [])) : mapRefs(field)])) : value;
          knowledgeBatches.push({ sourceIds: unique(batch.flatMap(item => item.rawEvidenceIds)), ...(result.projectFacts ? { facts: mapRefs(result.projectFacts) as ProjectState } : {}) });
        }
        const outline = sourceOutlines.find((item) => item.conversationId === batch[0].conversationId)!;
        for (const note of result.sections) {
          const ids = new Set(note.evidenceIds);
          const messageIds = unique(batch.filter((item) => ids.has(item.id)).map((item) => item.messageId));
          if (!messageIds.length) continue;
          const previous = outline.chapters.at(-1);
          // Older cached notes use whole-batch provenance: show one truthful
          // group instead of pretending repeated notes define separate ranges.
          if (previous && JSON.stringify(previous.messageIds) === JSON.stringify(messageIds)) { previous.summary += `\n\n## ${note.title}\n\n${note.body}`; }
          else outline.chapters.push({ id: `source-stage:${outline.conversationId}:${outline.chapters.length}`, title: note.title, summary: note.body, messageIds, ...(note.phase ? { phase: note.phase } : {}), ...(note.transition ? { transition: note.transition } : {}) });
        }
      }
      const sourceNotes=preparedNotes.get(batch)??notesFromResult(result, batch, level, index, input.locale, input.mode === "review");
      const notes=preparedNotes.has(batch)||input.mode!=="work"?sourceNotes:wikiWritingUnits(sourceNotes);
      next.push(...notes);writing.push({notes,facts:result.projectFacts,batch});
    }
    if (!next.length) throw new Error(input.locale === "zh-CN" ? "阶段笔记无法放入 AI 输入预算，请缩小本次目标。" : "The reading notes could not fit the AI input budget. Narrow this goal.");
    return {next,writing,raw,directory,continueDirectory,directoryReceipt:()=>directoryReceipt,userExcluded,excludeKeys,sameQuestions,sourceCompleted,sourceTotals,completedRaw,startedAt,reusedBatches,level,sourceOutlines,knowledgeBatches,batchCount,writingEdition,compositionId,checkpoints};
  };
  const write=async(phase:{kind:"direct"}|{kind:"writing";preparation:WritingPreparation})=>{
    const result=await executeStage(phase);
    if(!("result" in result))throw new Error("Writing stage returned source notes");
    return result;
  };
  return {
    savedPreparation,canWriteDirect,
    readSources:async()=>{
      const reading=await executeStage({kind:"reading"});
      if(!("next" in reading))throw new Error("Reading stage returned a final result");
      return reading;
    },
    writeWiki:(preparation:WritingPreparation)=>write({kind:"writing",preparation}),
    writeDirect:()=>write({kind:"direct"}),
  };
}

const validGuideCatalogue=(value:unknown):value is WikiGuideCatalogue=>{
 const catalogue=value as WikiGuideCatalogue|undefined;
 return Boolean(catalogue&&Number.isInteger(catalogue.omitted)&&Array.isArray(catalogue.facts)&&catalogue.facts.every(fact=>fact&&typeof fact.value==="object"&&Array.isArray(fact.evidenceIds)&&(fact.ownerId===undefined||typeof fact.ownerId==="string")));
};

/** Validate old editions before reusing their exact writing prompts. */
function restoreWikiWriting(saved:CompositionCheckpoint,raw:CoverageMaterial[]):WritingPreparation {
   if(saved.wikiScopeReview?.unreviewed?.some(item=>item.reason!=="context_omitted"))throw new Error("Scope metadata needs a new review");
   if(saved.writingEdition!==undefined&&saved.writingEdition!==1&&saved.writingEdition!==2&&saved.writingEdition!==3&&saved.writingEdition!==4&&saved.writingEdition!==5&&saved.writingEdition!==6&&saved.writingEdition!==7)throw new Error("Unknown writing edition");
   const known=new Set(raw.map(item=>item.id));
   if(!Array.isArray(saved.current)||!saved.current.length||saved.current.some(item=>!item||typeof item.id!=="string"||typeof item.text!=="string"||!Array.isArray(item.rawEvidenceIds)||!item.rawEvidenceIds.length||item.rawEvidenceIds.some(id=>!known.has(id)))||!Array.isArray(saved.sourceOutlines)||!Array.isArray(saved.knowledgeBatches)||!Array.isArray(saved.retired)||typeof saved.globalWritingGuide!=="string"||!Number.isInteger(saved.batchCount))throw new Error("Invalid composition checkpoint");
   const valid=validateWikiDirectory({pages:saved.topicPlan},saved.current.map(item=>({id:item.id,title:item.title,body:item.text,kind:"finding",transition:"",evidenceIds:item.rawEvidenceIds})),true);assertWikiOutline(valid);
 return {current:saved.current,topicPlan:valid,wikiScopeReview:saved.wikiScopeReview,retired:saved.retired,globalWritingGuide:saved.globalWritingGuide,...(validGuideCatalogue(saved.factCatalogue)&&typeof saved.guideExtras==="string"?{factCatalogue:saved.factCatalogue,guideExtras:saved.guideExtras}:{}),writingScale:validInputScale(saved.writingScale),writingEdition:saved.writingEdition,sourceOutlines:saved.sourceOutlines,knowledgeBatches:saved.knowledgeBatches,batchCount:saved.batchCount};
}

interface WritingPreparation {
 current:CoverageMaterial[];topicPlan?:DirectoryPage[];wikiScopeReview?:WikiScopeReview;
 retired:WikiRetiredProof[];globalWritingGuide:string;writingScale:number;factCatalogue?:WikiGuideCatalogue;guideExtras?:string;
 writingEdition:1|2|3|4|5|6|7|undefined;sourceOutlines:FocusSourceOutline[];knowledgeBatches:ProjectKnowledgeBatch[];batchCount:number;
}
interface PreparationContext {
 next:CoverageMaterial[];writing:Array<{notes:CoverageMaterial[];facts:ProjectState|undefined;batch:CoverageMaterial[]}>;
 raw:CoverageMaterial[];directory?:ReturnType<typeof createWikiTopicPlanner>;continueDirectory?:()=>ReturnType<typeof createWikiTopicPlanner>;directoryReceipt:()=>WikiPlanReceipt|undefined;
 userExcluded:Array<{id:string;title:string;body:string;kind:"finding";transition:string;evidenceIds:string[]}>;
 excludeKeys:Set<string>;sameQuestions:ReturnType<typeof sameQuestionGroups>;
 sourceCompleted:Map<string,number>;sourceTotals:Map<string,number>;completedRaw:Set<string>;
 startedAt:number;reusedBatches:number;level:number;sourceOutlines:FocusSourceOutline[];
 knowledgeBatches:ProjectKnowledgeBatch[];batchCount:number;writingEdition:1|2|3|4|5|6|7|undefined;
 compositionId?:string;checkpoints?:ReturnType<typeof createWikiPlanningCheckpoints>;
}

async function prepareWikiWriting(input:CoverageInput,context:PreparationContext):Promise<WritingPreparation> {
 const {next,writing,raw,directory,continueDirectory,directoryReceipt,userExcluded,excludeKeys,sameQuestions,sourceCompleted,sourceTotals,completedRaw,startedAt,reusedBatches,level,sourceOutlines,knowledgeBatches,batchCount,writingEdition,compositionId,checkpoints}=context;
    let current = next;
    let topicPlan:DirectoryPage[]|undefined,wikiScopeReview:WikiScopeReview|undefined;
    let retired:WikiRetiredProof[]=[],globalWritingGuide="",writingScale=1,factCatalogue:WikiGuideCatalogue|undefined,guideExtras="";
    if(input.mode === "work" && next.length >= 1 && input.ai.generateStructured) {
      let receipt:WikiPlanReceipt|undefined;
      input.onProgress?.(0,0,"synthesis",{completed:0,total:0,stage:"synthesis",phase:"directory",directory:directory?.progress(),final:false,round:level+2,completedSourceIds:input.sources.filter(source=>(sourceCompleted.get(source.id)??0)===sourceTotals.get(source.id)).map(source=>source.id),totalSources:input.sources.length,processedSegments:completedRaw.size,totalSegments:raw.length,elapsedMs:performance.now()-startedAt,reusedBatches,remainingSteps:1,stepsEstimated:true});
      // A planning failure that kept its progress continues automatically with a fresh
      // planner (and a fresh repair allowance) instead of failing after the whole read.
      let planner=directory!,continuations=0,lastProgress:string|undefined;
      const plan=async():Promise<DirectoryPage[]>=>{
        for(;;){
          try{return await planner.finish();}
          catch(error){
            const progress=planningProgress(error);
            if(!continueDirectory||continuations>=MAX_PLANNING_CONTINUATIONS||progress===undefined||progress===lastProgress)throw error;
            input.signal.throwIfAborted();
            lastProgress=progress;continuations++;planner=continueDirectory();
          }
          finally{receipt=directoryReceipt();}
        }
      };
      topicPlan=input.runId?await measureAILocalStep(input.runId,"wiki","wiki:topic-planning",plan,()=>({inputCount:next.length,...(receipt?.mainCount===undefined?{}:{mainCount:receipt.mainCount}),requests:receipt?.requests??0,repairCount:receipt?.repairCount??0,nameRepairCount:receipt?.nameRepairCount??0,outputRecoveryCount:receipt?.outputRecoveryCount??0,outputRecoveryTokens:receipt?.outputRecoveryTokens??0,convergenceCount:receipt?.convergenceCount??0,convergenceTokens:receipt?.convergenceTokens??0,candidateCount:receipt?.candidateCount??0,maxMainCount:receipt?.maxMainCount??7,subtopicCount:receipt?.subtopicCount??0,planningContinuations:continuations,quarantinedReferences:receipt?.quarantinedReferences??0,completedWindows:receipt?.completedWindows??0,reusedWindows:receipt?.reusedWindows??0,subjectGroups:receipt?.subjectGroups??0,finalOverlaps:receipt?.finalOverlaps??0,overlapMerges:receipt?.overlapMerges??0,pairedRefined:receipt?.pairedRefined??0,placementMoves:receipt?.placementMoves??0,mergedGroups:receipt?.mergedGroups??0,...(receipt?.chapterTarget===undefined?{}:{chapterTarget:receipt.chapterTarget}),...Object.fromEntries(Object.entries(receipt?.refineReasons??{}).map(([reason,count])=>[`refine_${reason}`,count])),...Object.fromEntries(Object.entries(receipt?.scope??{}).map(([field,count])=>[`scope_${field}`,count]))}),planner.timing()):await plan();
      wikiScopeReview=planner.scopeReview();
      if(userExcluded.length){
        // Removed materials stay listed so the user can bring them back.
        const base=wikiScopeReview??{version:1 as const,goal:input.goal,includeKeys:[...input.wikiScopeIncludeKeys??[]],materials:[]};
        wikiScopeReview={...base,excludeKeys:[...excludeKeys],materials:[...base.materials,...userExcluded.map(section=>({id:section.id,key:wikiMaterialKey(section),title:section.title,body:section.body,evidenceIds:[...section.evidenceIds],kind:"other" as const,reason:input.locale==="zh-CN"?"你已移出 Wiki":"You removed this from the Wiki",quote:"",userExcluded:true as const}))]};
      }
      const omitted=new Set(wikiScopeReview?.materials.filter(item=>item.kind==="other").map(item=>item.id));
      if(sameQuestions.length){
        // One question answered by several AIs must be written in one place to be compared.
        const colocated=colocateSameQuestions(topicPlan,next.filter(note=>!omitted.has(note.id)),sameQuestions);
        try{if(colocated.moved){assertWikiOutline(colocated.pages);topicPlan=colocated.pages;}}catch{/* An invalid adjustment keeps the planner's own outline. */}
      }
      // Each chapter remembers its notes' scope keys, so the preview can leave it out.
      // Same key as the planner input built from each note above, so an exclusion matches it.
      topicPlan=topicPlan.map(page=>({...page,materialKeys:next.filter(note=>page.sectionIds.includes(note.id)&&!omitted.has(note.id)).map(note=>wikiMaterialKey({id:note.id,title:note.title,body:note.text,kind:"finding",transition:"",evidenceIds:note.rawEvidenceIds}))}));
      current=next.filter(note=>!omitted.has(note.id)).map(note=>{const owner=topicPlan!.find(page=>page.sectionIds.includes(note.id));if(!owner)throw wikiOutlineError("unassigned_material");return {...note,wikiOwnerId:owner.ownerId??owner.sectionIds[0]};});
    }
    else if(input.mode==="work"&&next.length>=2)throw wikiOutlineError("provider_unavailable");
    else if(input.mode==="work"&&input.runId)await recordAISkippedStep(input.runId,"wiki","wiki:topic-planning","single_material");
    if(input.mode==="work"){
      // Source coverage stays complete. Only project-scoped material contributes
      // to prose and the shared fact guide; neutral cached analysis is untouched.
      const messages=new Map<string,string>();
      for(const item of raw){const key=JSON.stringify([item.conversationId,item.messageId]);messages.set(key,(messages.get(key)??"")+item.text.replace(/^(user|assistant|system|tool): /u,""));}
      const originals=raw.map(item=>({...item,text:messages.get(JSON.stringify([item.conversationId,item.messageId]))!}));
      const ids=new Set(current.map(item=>item.id));
      // Retained uncertainty is not permission to turn a source into a shared
      // project decision/constraint. Keep it in its qualified writing passage.
      const unconfirmedIds=new Set([...(wikiScopeReview?.materials??[]).map(item=>item.id),...(wikiScopeReview?.unreviewed??[]).map(item=>item.id)]);
      const projectIds=new Set(wikiScopeReview?[...ids].filter(id=>!unconfirmedIds.has(id)):[]);
      const scoped=writing.map(item=>scopeWikiFacts(item.facts,wikiNoteEvidenceText(item.notes.filter(note=>projectIds.has(note.id))),item.notes.some(note=>!projectIds.has(note.id))));
      const projection=currentWikiFacts(scoped,originals);
      retired=projection.retired;globalWritingGuide=wikiCurrentGuide(projection.states,originals,projection.history);
      const catalogue=wikiGuideCatalogue(projection.states,originals,projection.history);
      const owners=new Map(current.map(note=>[note.id,note.wikiOwnerId]));
      current=writing.flatMap((item,index)=>{
        const retained=item.notes.filter(note=>ids.has(note.id));
        const refreshed=new Map(refreshWikiWritingNotes(retained.filter(note=>projectIds.has(note.id)),projection.states[index],item.batch).map(note=>[note.id,note]));
        // Membership uncertainty must not lose its original inventory merely
        // because it cannot contribute to the shared project-fact catalogue.
        return retained.map(note=>refreshed.get(note.id)??note);
      }).map(note=>({...note,wikiOwnerId:owners.get(note.id)}));
      // Scoped facts refresh only existing catalogue IDs; checkpoints still validate ownership.
      if(topicPlan){
        current=assignWikiOwners(current,topicPlan);
        // One owning chapter per shared fact; other chapters see only a pointer to it.
        factCatalogue=assignGuideOwners(catalogue,current,topicPlan.map(page=>page.ownerId??page.sectionIds[0]));
      }
      for(const batch of knowledgeBatches){const item=writing.find(item=>JSON.stringify(unique(item.batch.flatMap(note=>note.rawEvidenceIds)))===JSON.stringify(batch.sourceIds));if(item&&wikiScopeReview)batch.facts=scopeWikiFacts(batch.facts,wikiNoteEvidenceText(item.notes.filter(note=>projectIds.has(note.id))),item.notes.some(note=>!projectIds.has(note.id)));}
      const references=wikiScopeReview?.materials.filter(item=>item.kind==="reference");
      if(isCrossPlatform(raw.map(item=>item.platform)))guideExtras+=CROSS_AI_WRITING;
      if(references?.length)guideExtras+="\nATTRIBUTED REFERENCES (editorial scope, not facts): "+JSON.stringify(references.map(({title,reason,quote})=>({title,reason,quote})))+". Keep the external example attributed and explain only its relevance to this project; do not present its features as this project's decisions.";
      globalWritingGuide+=guideExtras;
    }
    if(input.mode==="work"&&topicPlan){
      // Size writing by the provider's real token counts; frozen with the checkpoint below.
      writingScale=writingInputScale(input.modelId);
      if(input.runId)await recordAISkippedStep(input.runId,"wiki","wiki:writing-calibration",`scale=${writingScale}`);
    }
    if(compositionId&&topicPlan)await checkpoints?.write<CompositionCheckpoint>(compositionId,{current,topicPlan,wikiScopeReview,retired,globalWritingGuide,...(factCatalogue?{factCatalogue,guideExtras}:{}),sourceOutlines,knowledgeBatches,batchCount,writingEdition,...(writingScale<1?{writingScale}:{})});
 return {current,topicPlan,wikiScopeReview,retired,globalWritingGuide,...(factCatalogue?{factCatalogue,guideExtras}:{}),writingScale,writingEdition,sourceOutlines,knowledgeBatches,batchCount};
}
