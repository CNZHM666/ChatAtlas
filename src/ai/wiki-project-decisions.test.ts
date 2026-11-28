import { expect, it } from "vitest";
import { contextKnowledge } from "../test/context-fixture";
import { projectDocument } from "../export/project-document";
import { continuationContext } from "../shared/project-continuation";
import { wikiLedgerAtPublishedDraft, reopenWikiDecision } from "../shared/wiki-decision-receipts";
import type { WikiKnowledgeLedger, WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { answerProjectQuestion, wikiPrewritingProjectQuestions, wikiProjectQuestions } from "./wiki-project-decisions";
import { pendingLedgerDecisions, withDecision } from "./wiki-key-decisions";
import { addOverviewDecision, projectOverviewWorkspace, saveOverviewChoice, updateOverviewDecision } from "../canvas/project-overview-workspace";
import { projectCurrentPlan } from "../shared/project-current-plan";
import type { WikiHolder } from "../shared/wiki-holder";
import { resolveWikiReading } from "./wiki-knowledge-reading";

function decisionProject() {
  const { session } = contextKnowledge();
  const section = session.sections[0];
  const units: WikiKnowledgeUnit[] = ["第一版采用本地索引。", "第一版采用云端索引。"].map((statement, index) => ({
    id: `index-${index}`, statement, subject: "索引范围", kind: "plan", details: [], adoption: { status: "proposal" }, delivery: "planned",
    evidence: { conversationId: "c", messageId: `index-msg-${index}`, evidenceId: `index-ref-${index}`, messageIndex: index,
      role: "assistant", pasted: false, quote: statement },
  }));
  session.evidence.push(...units.map(unit => ({ id: unit.evidence.evidenceId, conversationId: "c", messageId: unit.evidence.messageId,
    excerpt: unit.statement, title: "索引讨论" })));
  section.body = units[0].statement;
  section.evidenceIds = [units[0].evidence.evidenceId];
  section.claims = [{ text: section.body, quote: section.body, evidenceIds: section.evidenceIds, unitIds: [units[0].id] }];
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 1, status: "complete", materials: 2,
    batches: [{ sourceIds: [], status: "ok", rejected: {}, units }],
    organization: { version: 1, generatedAt: 1, status: "complete", subjects: [{ id: "s", name: "索引范围", aliases: [], unitIds: units.map(unit => unit.id) }],
      merged: [], relations: [], report: {}, chapters: [{ id: section.id, title: section.title, group: "", question: "", subtopics: [{ title: "索引范围", subjectIds: ["s"] }] }] },
    draft: { version: 1, generatedAt: 1, status: "complete", report: {}, chapters: [{ id: section.id, title: section.title, group: "", question: "",
      body: section.body, problems: [], paragraphs: [{ subtopic: "索引范围", text: section.body, unitIds: [units[0].id] }] }] },
    writingQuestions: [{ id: "release-index", about: "首版索引范围", ask: "第一版采用本地索引还是云端索引？", organization: 1, unitIds: units.map(unit => unit.id),
      options: units.map(unit => ({ id: unit.id, label: unit.statement, actions: [{ do: "confirm", units: [unit.id] }] })) }],
  };
  return { session: { ...session, wikiKnowledge: ledger }, section, ledger, units };
}

it("carries a skipped prewriting question into the overview, saves it once, and separates the published draft", () => {
  const { session, section, ledger, units } = decisionProject();
  const [question] = wikiPrewritingProjectQuestions(ledger, true);
  expect(question.question.id).toBe(wikiProjectQuestions(ledger, true)[0].question.id);
  const text = "首版仅保留本地全文索引，后续另行评估共享功能。";
  const saved = answerProjectQuestion(ledger, question, { text, location: { chapterId: section.id, evidenceIds: section.evidenceIds } });
  expect(wikiProjectQuestions(saved, true)).toEqual([]);
  expect(pendingLedgerDecisions(saved)?.unapplied[0].chapterId).toBe(section.id);
  const deferred = { ...session, wikiKnowledge: saved };
  expect(continuationContext(deferred, true)).toContain(text);
  expect(resolveWikiReading(saved).statuses.get("decision:release-index")).toBe("confirmed");
  expect(resolveWikiReading(wikiLedgerAtPublishedDraft(saved)).units.some(unit => unit.statement === text)).toBe(false);
  const summary = projectDocument(deferred, { overview: true, wikiIds: [], history: false, matters: false, sources: false, preset: "brief" }, "md").text;
  expect(summary).toContain(text);
  const chapter = projectDocument(deferred, { overview: false, wikiIds: [section.id], history: false, matters: false, sources: false }, "md").text;
  expect(chapter).toContain(units[0].statement);
  expect(chapter).not.toContain(text);
  const changed = structuredClone(saved);
  changed.batches[0].units[0].evidence.quote = "来源已经修改。";
  expect(continuationContext({ ...session, wikiKnowledge: changed }, true)).not.toContain(text);
  expect(wikiProjectQuestions(changed, true).map(item => item.question.id)).toContain("release-index");
});

it("projects a reviewed sentence to overview, both Markdown exports, and continuation before a rewrite", () => {
  const { session, section, ledger, units } = decisionProject(), unit = units[0];
  // The whole ledger unit also has an unreviewed implementation detail.
  const text = "第一版采用本地索引。";
  const extra = "索引增量更新方案还可继续讨论。";
  unit.statement = text + extra;
  const review = (holder: WikiHolder) => ({
    ...session, sections: [{ ...section, claims: [{ ...section.claims![0], checked: true, holder,
      // Preserve a stale boolean to exercise older persisted claims after changing a status.
      userDecided: true }] }],
    wikiKnowledge: withDecision(ledger, [unit.id], holder === "decided" ? "confirmed" : holder === "earlier" ? "rejected" : undefined,
      10, [text], { locallyApplied: true }),
  });
  const options = { overview: true, history: false, matters: false, sources: false };
  const full = (value: typeof session) => projectDocument(value, { ...options, wikiIds: [section.id] }, "md").text;
  const brief = (value: typeof session) => projectDocument(value, { ...options, wikiIds: [] }, "md").text;
  const confirmed = review("decided");
  expect(projectOverviewWorkspace(confirmed, true)?.decisions).toEqual([expect.objectContaining({ text })]);
  expect(projectOverviewWorkspace(confirmed, true)?.chapterCards[section.id]).toEqual({ summary: text, decidedCount: 1, pendingReviewCount: 0 });
  expect(full(confirmed)).toContain("已定的关键决定");
  expect(brief(confirmed)).toContain(text);
  expect(continuationContext(confirmed, true)).toContain(`[已定] ${text}`);
  expect(continuationContext(confirmed, true)).not.toContain(extra);
  for (const [holder, mark] of [["ai", "AI 建议"], ["earlier", "此前"]] as const) {
    const demoted = review(holder);
    expect(projectOverviewWorkspace(demoted, true)?.decisions.some(item => item.text === text)).toBe(false);
    expect(projectOverviewWorkspace(demoted, true)?.chapterCards[section.id].decidedCount).toBe(0);
    expect(full(demoted)).not.toContain("已定的关键决定");
    expect(brief(demoted)).not.toContain("已定的关键决定");
    const json = JSON.parse(projectDocument(demoted, { ...options, wikiIds: [section.id], sources: true }, "json").text);
    expect(json.sections.flatMap((part: { claims?: unknown[] }) => part.claims ?? [])).toContainEqual(expect.objectContaining({ text, holder, checked: true }));
    expect(continuationContext(demoted, true)).toContain(`[${mark}] ${text}`);
    expect(continuationContext(demoted, true)).not.toContain(`[已定] ${text}`);
  }
});

it("keeps AI proposals out of decisions and projects recent progress separately from pending plans", () => {
  const { session, ledger, units } = decisionProject();
  units[0].adoption = { status: "user_decision" };
  units[1].adoption = { status: "user_adopted", approval: { evidenceId: "u", messageId: "unrelated", quote: "这个有没有其他建议？" } };
  units[0].statement = "下一阶段优先完成离线索引。";
  units[1].statement = "下一步验证索引恢复流程。";
  const reportAt = Date.UTC(2026, 10, 25);
  const report: WikiKnowledgeUnit = { ...units[0], id: "ship", kind: "report", delivery: "user_reported", statement: "已完成本地数据库迁移。",
    adoption: { status: "unknown" }, evidence: { ...units[0].evidence, evidenceId: "ship-ref", messageId: "ship-msg", role: "user",
      messageIndex: 8, discussedAt: reportAt, quote: "我已完成本地数据库迁移。" } };
  ledger.batches[0].units.push(report);
  session.evidence.push({ id: report.evidence.evidenceId, conversationId: "c", messageId: report.evidence.messageId,
    excerpt: report.evidence.quote, title: "进展" });
  expect(projectOverviewWorkspace(session, true)?.decisions).toEqual([]);
  const plan = projectCurrentPlan(session);
  expect(plan?.items).toEqual([]);
  expect(plan?.reportedProgress).toMatchObject({ date: reportAt, items: [report.statement], source: { id: "ship-ref" } });
  expect(plan?.proposals?.map(item => item.id)).toEqual([units[1].id, units[0].id]);
  expect(plan?.proposals?.[0]).toMatchObject({ source: { id: units[1].evidence.evidenceId }, chapter: { id: session.sections[0].id } });
});

it("edits, downgrades and reopens key decisions with and without a receipt while preserving published prose", () => {
  const { session, ledger } = decisionProject();
  const manual = addOverviewDecision(session, "禁止将索引上传到第三方。", true);
  const [created] = projectOverviewWorkspace(manual, true)!.decisions;
  expect(created).toMatchObject({ origin: "manual", tier: "core" });
  expect(continuationContext(manual, true)).toContain("[已定] 禁止将索引上传到第三方。");
  const edited = updateOverviewDecision(manual, created.id, { kind: "edit", text: "索引只保存在本机。" }, true);
  expect(projectOverviewWorkspace(edited, true)?.decisions.map(item => item.text)).toEqual(["索引只保存在本机。"]);
  expect(projectDocument(edited, { overview: true, wikiIds: [], history: false, matters: false, sources: false }, "md").text).toContain("索引只保存在本机。");
  const reopened = updateOverviewDecision(edited, created.id, { kind: "reopen" }, true);
  const question = projectOverviewWorkspace(reopened, true)!.questions.find(item => item.text === "索引只保存在本机。")!;
  expect(projectOverviewWorkspace(reopened, true)?.decisions).toEqual([]);
  expect(continuationContext(reopened, true)).toContain("[待决] 索引只保存在本机。");
  const decided = saveOverviewChoice(reopened, question, "confirm", true);
  expect(continuationContext(decided, true)).toContain("[已定] 索引只保存在本机。");
  const [original] = wikiProjectQuestions(ledger, true);
  const text = "首版索引只保存在本机。";
  const withReceipt = { ...session, wikiKnowledge: answerProjectQuestion(ledger, original, { text }) };
  const receipt = projectOverviewWorkspace(withReceipt, true)?.decisions.find(item => item.text === text);
  expect(receipt?.receiptId).toBeDefined();
  const downgraded = updateOverviewDecision(withReceipt, receipt!.id, { kind: "downgrade_ai" }, true);
  expect(downgraded.sections).toBe(session.sections);
  expect(projectOverviewWorkspace(downgraded, true)?.decisions.some(item => item.text === text)).toBe(false);
  expect(continuationContext(downgraded, true)).toContain(`[AI 建议] ${text}`);
  expect(continuationContext(downgraded, true)).not.toContain(`[已定] ${text}`);
});

it("reopens an already published decision without overwriting a newer verdict on another point", () => {
  const { ledger, units } = decisionProject();
  const [question] = wikiProjectQuestions(ledger, true);
  const saved = answerProjectQuestion(ledger, question, { choice: units[0].id });
  const receipt = saved.decisionArbitrations![question.question.id];
  const published = { ...saved, draft: { ...saved.draft!, generatedAt: receipt.at }, decisions: { ...saved.decisions,
    [units[1].id]: { verdict: "open" as const, at: receipt.at + 1 } } };
  const reopened = reopenWikiDecision(published, question.question.id);
  expect(reopened.decisions?.[units[1].id]?.verdict).toBe("open");
  expect(reopened.decisions?.[units[0].id]).toBeUndefined();
  expect(pendingLedgerDecisions(reopened)).toBeDefined();
  expect(wikiLedgerAtPublishedDraft(reopened).decisions?.[units[0].id]?.verdict).toBe("confirmed");
});
