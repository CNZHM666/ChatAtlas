import type { FocusSection, FocusSession } from "./focus-session";
import { evidencePresentation } from "./evidence-presentation";
import { wikiDocumentBlocks } from "./wiki-document-blocks";
import { editableWikiTopic } from "./wiki-directory";
import { wikiQuoteRange, type WikiClaim } from "./wiki-claims";
import { factTextKey } from "./project-fact-state";
import { currentWikiEvidence } from "./wiki-evidence-link";
import { withoutStaleWikiDecisionReceipts } from "./wiki-decision-receipts";
import { wikiLedgerUnits } from "./wiki-knowledge";
import { wikiUnitDecisionOrigin } from "../ai/wiki-knowledge-state";

export const projectIdentity = (project: FocusSession) => project.canvasId ?? project.rootSessionId ?? project.id;
export const sameProject = (a: FocusSession, b: FocusSession) => projectIdentity(a) === projectIdentity(b);
export const replaceableContinuation = (section: FocusSection) => Boolean(section.continuation && editableWikiTopic({ ...section, continuation: undefined }));

const contextStart = "[ChatAtlas project context ";
const contextEnd = "[/ChatAtlas project context]";

export function withoutInsertedProjectContext(text: string) {
  const start = text.indexOf(contextStart), end = text.indexOf(contextEnd, start);
  if (start < 0 || end < 0) return text;
  return (text.slice(0, start) + text.slice(end + contextEnd.length)).trim();
}

export const continuationTextKey = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim().replace(/[。.!?！？]+$/u, "");

function sectionStatus(section: FocusSection, hasDecisions: boolean, zh: boolean) {
  if (hasDecisions) return zh ? "已定" : "Decided";
  if (section.userEdited || section.origin === "user") return zh ? "用户编辑" : "User edit";
  if (section.kind === "open_question") return zh ? "待决" : "Open";
  if (section.kind === "proposal") return zh ? "建议" : "Proposal";
  return zh ? "讨论记录" : "Discussion";
}

function visibleClaimText(section: FocusSection, claim: WikiClaim) {
  return [claim.text, ...claim.formulations ?? []].find(text => wikiQuoteRange(section.body, text));
}

/** Saved verdicts belong to the exact reviewed sentence, even if it cites compound ledger units. */
export function projectReviewedClaims(project: FocusSession) {
  const available = new Map(currentWikiEvidence(project).map(ref => [ref.id, ref]));
  const overrides = Object.entries(project.projectMaintenance?.overviewDecisions ?? {});
  const originalTexts = new Set(overrides.flatMap(([, entry]) => [entry.originalText, entry.text].filter(Boolean).map(text => factTextKey(text!))));
  const overriddenReceipts = new Set(overrides.flatMap(([, entry]) => entry.receiptId ?? []));
  const storedIds = new Set(overrides.map(([id]) => id));
  const reviewed = project.sections.flatMap(section => (section.claims ?? []).flatMap((claim, index) => {
    if (claim.markOnly || !claim.checked || !claim.holder) return [];
    const text = visibleClaimText(section, claim);
    const references = claim.evidenceIds.flatMap(id => available.get(id) ?? []);
    if (!text || !references.length) return [];
    const id = claim.id ?? `reviewed:${section.id}:${index}`;
    if (storedIds.has(id) || originalTexts.has(factTextKey(text))) return [];
    return [{ id, sectionId: section.id, text, quote: claim.quote,
      holder: claim.holder, unitIds: claim.unitIds ?? [], references }];
  }));
  const entries = [
    ...overrides.map(([id, entry]) => ({
      id, sectionId: entry.sectionId ?? "", heading: entry.heading, text: entry.text, quote: undefined,
      holder: entry.status, unitIds: entry.unitIds ?? [],
      references: !entry.originalText || factTextKey(entry.text) === factTextKey(entry.originalText)
        ? (entry.evidenceIds ?? []).flatMap(id => available.get(id) ?? []) : [],
      overview: entry,
    })),
    ...reviewed.map(entry => ({ ...entry, heading: undefined, overview: undefined })),
  ];
  const reviewedText = new Set([...originalTexts, ...entries.map(entry => factTextKey(entry.text))]);
  const reviewedUnits = new Set(entries.flatMap(entry => entry.unitIds));
  return { entries, overriddenReceipts, shadows: (unitId: string | undefined, text: string) =>
    Boolean(unitId && reviewedUnits.has(unitId)) || reviewedText.has(factTextKey(text)) };
}

export function currentDecisions(section: FocusSection) {
  return (section.claims ?? []).flatMap(claim => {
    if (claim.markOnly || (claim.checked && claim.holder ? claim.holder !== "decided" : !claim.userDecided && claim.holder !== "decided")) return [];
    if (!section.userEdited && !claim.checked) return [claim.text];
    const text = visibleClaimText(section, claim);
    return text ? [text] : [];
  });
}

export function continuationStatus(section: FocusSection, zh: boolean) {
  return sectionStatus(section, currentDecisions(section).length > 0, zh);
}

export function sidecarRecordStatus(section: FocusSection, zh: boolean) {
  if (currentDecisions(section).length) return zh ? "已确认" : "Confirmed";
  if (section.kind === "open_question") return zh ? "待决" : "Open";
  if (section.kind === "proposal") return zh ? "提案" : "Proposal";
}

export function continuationBullet(section: FocusSection, zh: boolean, citation = "") {
  const [first, ...rest] = section.body.trim().split(/\r?\n/u);
  return [`- **${continuationStatus(section, zh)}** · ${first}${rest.length ? "" : citation}`,
    ...rest.map(line => line ? `  ${line}` : ""), ...(rest.length && citation ? [`  ${citation.trimStart()}`] : [])].join("\n");
}

export function replacementPoint(section: FocusSection, change: { kind: string; targetText?: string; operation?: string }) {
  if (change.kind === "open_question" || !editableWikiTopic({ ...section, continuation: undefined })) return undefined;
  if (section.continuationLoose && !section.wikiOwnerId && !section.body.includes("\n") && (section.claims?.length ?? 0) <= 1 &&
    (!change.operation || Boolean(change.targetText && continuationTextKey(change.targetText) === continuationTextKey(section.body)))) return { text: section.body };
  if (!change.targetText) return undefined;
  const key = continuationTextKey(change.targetText);
  const paragraphs = wikiDocumentBlocks(section.body).filter(block => block.kind === "paragraph" && continuationTextKey(block.text) === key);
  if (paragraphs.length === 1) return { text: paragraphs[0].text, block: paragraphs[0] };
  const claims = section.claims?.filter(claim => continuationTextKey(claim.text) === key && !claim.markOnly) ?? [];
  const lines = section.body.split("\n").filter(line => line.startsWith("- **") && line.endsWith(`** · ${change.targetText}`));
  if (claims.length === 1 && lines.length === 1) return { text: claims[0].text, line: lines[0], claim: claims[0] };
}

/** A bounded, local projection of the saved document. Private notes and original transcripts stay local. */
export function continuationContext(project: FocusSession, zh: boolean) {
  const goal = project.goal.trim() || project.title;
  const lines = [
    `${contextStart}${project.id}]`,
    `# ${project.title.replace(/\s+/gu, " ")}`,
    zh ? "以下是当前项目上下文。基于已定约束继续，保留待决事项的状态。" : "Continue this project using its current decisions and constraints. Keep open items open.",
    `**${zh ? "目标" : "Goal"}** ${goal.slice(0, 420)}`,
  ];
  const seen = new Set<string>();
  let omitted = false;
  const add = (status: string, text: string) => {
    const summary = evidencePresentation(text).replace(/\s+/gu, " ").trim();
    const key = continuationTextKey(summary);
    if (!key || seen.has(key)) return;
    const row = `- [${status}] ${summary}`;
    if (lines.join("\n").length + row.length > 3200 || summary.length > 700) { omitted = true; return; }
    seen.add(key);
    lines.push(row);
  };
  const ledger = project.wikiKnowledge && withoutStaleWikiDecisionReceipts(project.wikiKnowledge);
  const reviewed = projectReviewedClaims(project);
  const statusLabels = {
    decided: zh ? "已定" : "Decided", earlier: zh ? "此前" : "Earlier", ai: zh ? "AI 建议" : "AI suggestion",
    open: zh ? "待决" : "Open", user: zh ? "用户陈述" : "User statement",
    material: zh ? "资料" : "Material", corrected: zh ? "已纠正" : "Corrected",
  };
  const affected = new Set<string>();
  const receipts = Object.entries(ledger?.decisionArbitrations ?? {}).filter(([id]) => !reviewed.overriddenReceipts.has(id)).map(([, receipt]) => receipt).filter(receipt => receipt.deferredToDraft && receipt.text
    && receipt.scope?.targets.every(target => project.sourceConversationIds.includes(target.conversationId)
      && (project.scope?.kind !== "goal" || project.scope.blocks?.some(block => block.conversationId === target.conversationId && block.messageIds.includes(target.messageId)))));
  for (const receipt of receipts.sort((a, b) => b.at - a.at)) {
    for (const [id] of Object.entries(receipt.previousVerdicts ?? {})) if (ledger?.decisions?.[id]?.verdict === "rejected") affected.add(id);
    if (!reviewed.shadows(undefined, receipt.text!) && !receipt.scope?.targets.some(target => reviewed.shadows(target.unitId, receipt.text!))) {
      add(zh ? "已定" : "Decided", receipt.text!);
    }
  }
  const earlier = new Set(wikiLedgerUnits(ledger).filter(unit => affected.has(unit.id)).map(unit => continuationTextKey(unit.statement)));
  for (const previous of Object.values(ledger?.publishedDecisionRevisions ?? {})) {
    if (previous.draftAt === ledger?.draft?.generatedAt && previous.receipt.text) earlier.add(continuationTextKey(previous.receipt.text));
  }
  const reviewedBySection = new Map<string, typeof reviewed.entries>();
  for (const entry of reviewed.entries) {
    const entries = reviewedBySection.get(entry.sectionId) ?? [];
    entries.push(entry);
    reviewedBySection.set(entry.sectionId, entries);
    if (entry.holder === "decided") add(statusLabels.decided, entry.text);
  }
  const units = new Map(wikiLedgerUnits(ledger).map(unit => [unit.id, unit]));
  const confirmed = (id: string) => ledger?.decisions?.[id]?.verdict === "confirmed"
    || !ledger?.decisions?.[id] && units.has(id) && Boolean(wikiUnitDecisionOrigin(units.get(id)!));
  const recent = [...project.sections].reverse().map(section => ({ section, claims: currentDecisions(section).filter(text =>
    !reviewed.shadows(undefined, text) && section.claims?.some(claim => {
      if (visibleClaimText(section, claim) !== text && claim.text !== text) return false;
      if (claim.unitIds?.some(id => reviewed.shadows(id, text))) return false;
      return claim.checked && claim.holder === "decided" || claim.continuation && claim.userDecided
        || !ledger || Boolean(claim.unitIds?.length && claim.unitIds.every(confirmed));
    })) }));
  for (const { section, claims } of recent) {
    for (const text of claims) {
      if (section.userEdited || section.origin || !earlier.has(continuationTextKey(text))) add(statusLabels.decided, text);
    }
  }
  for (const entry of reviewed.entries) {
    if (entry.holder !== "decided") add(statusLabels[entry.holder], entry.text);
  }
  for (const { section, claims } of recent) {
    if (claims.length) continue;
    const excerpt = wikiDocumentBlocks(section.body).find(block => block.kind === "paragraph" || block.kind === "list")?.text;
    if (!excerpt || reviewedBySection.get(section.id)?.some(entry => wikiQuoteRange(excerpt, entry.overview?.originalText ?? entry.text))) continue;
    if (!section.userEdited && !section.origin && earlier.has(continuationTextKey(excerpt))) continue;
    add(sectionStatus(section, false, zh), excerpt);
  }
  if (omitted) lines.push(zh ? "此处为节选，完整内容见项目文档。" : "This brief is an excerpt. See the saved document for the full context.");
  lines.push(contextEnd);
  return lines.join("\n\n");
}
