import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import type { Conversation, ConversationMessage } from "../shared/types";
import { getDatabase } from "../storage/db";
import { createLivingProject, listFocusSessions, saveFocusSession, wikiPublishBasis } from "../storage/focus-sessions";
import { saveManualWikiChapter, setSidecarWritingMode } from "../storage/sidecar-projects";
import { readSessionSource } from "../storage/source-versions";
import { projectReader } from "../storage/project-reader";
import { savedFocusProjects } from "../canvas/focus-versions";
import { projectExportSelection } from "../export/project-export-presets";
import { currentSourceChange } from "../canvas/source-freshness";
import { projectDocument } from "../export/project-document";
import { requestBudget, requestMessages, validateProviderOutput } from "../ai/request-policy";
import { generateFocusUpdate } from "../ai/focus-update";
import { wikiLedgerUnits, type WikiKnowledgeLedger } from "../shared/wiki-knowledge";
import { continuationContext } from "../shared/project-continuation";
import { withWikiOutline } from "../test/wiki-outline-fixture";
import { applyProjectIncrement, previewProjectIncrement, undoProjectIncrement, type ProjectIncrementResume } from "./project-increment";

const model = vi.hoisted(() => ({ generateStructured: vi.fn() }));
vi.mock("../ai/atlas-ai", () => ({ createAtlasAI: () => model }));
vi.mock("../storage/knowledge-graph", () => ({ getAISettings: async () => ({ baseUrl: "https://example.test", apiKey: "test", model: "fixture" }) }));
vi.mock("../search/semantic-index", () => ({ refreshProjectVectors: async () => undefined }));

beforeEach(async () => {
  model.generateStructured.mockReset();
  model.generateStructured.mockImplementation(async request => {
    const data = JSON.parse(request.prompt);
    expect(data.presentation).toBe("wiki_topic_plan");
    return request.validate(withWikiOutline({ pages: data.sections.map((section: { id: string; title: string }) => ({ title: section.title, question: section.title, group: "", sectionIds: [section.id] })) }));
  });
  const db = await getDatabase();
  for (const key of ["conversations", "messages", "focusSessions", "canvases", "sourceVersions"] as const) await db.clear(key);
});

async function capture(platform: string, content: string, initialContext?: string) {
  const db = await getDatabase();
  const id = `${platform}:chat`, date = Date.now();
  const source: Conversation = { id, title: platform, platform, url: "", updatedAt: date, messageCount: initialContext ? 2 : 1, hydrationState: "hydrated", importState: "complete" };
  const messages: ConversationMessage[] = (initialContext ? [initialContext, content] : [content]).map((text, index) => ({
    id: id + index, conversationId: id, role: index ? "assistant" : "user", content: text, contentHash: text, preview: text, messageIndex: index, createdAt: date, updatedAt: date,
  }));
  await db.put("conversations", source);
  for (const message of messages) await db.put("messages", message);
  return { source, message: messages.at(-1)! };
}

const signal = new AbortController().signal;
const propose = (message: ConversationMessage, title: string, text: string) =>
  model.generateStructured.mockImplementationOnce(async request => {
    expect(requestBudget(request).maxOutputTokens).toBe(3000);
    expect(requestMessages(request)[0].content).toContain("Return JSON {changes:");
    return validateProviderOutput(request, { changes: [{ title, text, kind: "proposal", messageId: message.id, quote: message.content }] });
  });

it("creates an empty project, continues across platforms, and exports grounded changes without reprocessing a capture", async () => {
  const initial = await createLivingProject("Circuit Studio", "Preview ESP32 projects", "en", "handoff");
  expect(savedFocusProjects(await listFocusSessions()).map(item => item.id)).toEqual([initial.id]);
  const first = await capture("chatgpt", "First release supports ESP32 only.");
  propose(first.message, "First release", first.message.content);
  const progress = vi.fn();
  const firstPreview = (await previewProjectIncrement(initial, first.source.id, false, signal, progress))!;
  expect(progress.mock.calls).toEqual([[0, 1], [1, 1]]);
  expect(JSON.parse(model.generateStructured.mock.lastCall![0].prompt).writing).toContain("acceptance criteria");
  const original = await applyProjectIncrement(firstPreview, [{ item: firstPreview.changes[0], decide: true }], false);
  const context = continuationContext(original, false);
  expect(context).toContain("[Decided] First release supports ESP32 only.");

  const second = await capture("claude", "Validate operation batches before committing.", context);
  propose(second.message, "Validation", second.message.content);
  const audit = await setSidecarWritingMode(original, "audit", false);
  expect(audit.updatedAt).toBe(original.updatedAt);
  const secondPreview = (await previewProjectIncrement(audit, second.source.id, false, signal))!;
  const extraction = () => model.generateStructured.mock.calls.map(([request]) => JSON.parse(request.prompt)).filter(data => data.presentation === "sidecar_project_update");
  expect(extraction().at(-1).writing).toContain("alternatives");
  expect(extraction().at(-1).discussion).toEqual([
    expect.objectContaining({ id: second.message.id, text: second.message.content }),
  ]);
  const current = await applyProjectIncrement(secondPreview, [{ item: secondPreview.changes[0], decide: false }], false);
  expect(current.sections.at(-1)?.claims?.[0].holder).toBe("ai");
  expect(current.sections[0]).toMatchObject(original.sections[0]);
  expect(current.sourceConversationIds).toEqual([first.source.id, second.source.id]);
  const source = current.evidence.at(-1)!;
  expect(await readSessionSource(current, source.conversationId, source.messageId, source.sourceVersionId)).toContainEqual(second.message);
  expect(await previewProjectIncrement(current, second.source.id, false, signal)).toBeUndefined();
  expect(extraction()).toHaveLength(2);
  expect(projectDocument(current, { overview: true, wikiIds: current.sections.map(section => section.id), matters: false, history: false, sources: true }, "md", false).text).toContain(second.message.content);

  const restored = await undoProjectIncrement(current, false);
  expect(restored.sections).toEqual(original.sections);
  expect(restored.sidecarWritingMode).toBe("audit");
  expect(restored.sidecarConversationIds).toContain(second.source.id);
  const db = await getDatabase();
  expect((await projectReader((await db.get("canvases", initial.canvasId!))!)).id).toBe(restored.id);
});

it("writes selected additions and a decision into the workspace ledger exactly once, and undoes both stores", async () => {
  const initial = await createLivingProject("Circuit Studio", "", "en");
  const db = await getDatabase();
  const ledger: WikiKnowledgeLedger = { version: 1, status: "complete", generatedAt: initial.createdAt, materials: 0, batches: [],
    organization: { version: 1, status: "complete", generatedAt: initial.createdAt, subjects: [], chapters: [], merged: [], relations: [], report: {} },
    draft: { version: 1, status: "complete", generatedAt: initial.createdAt, chapters: [], report: {} } };
  const project = { ...initial, wikiEdition: "current-v2" as const, wikiMainlineVersion: 1 as const, wikiKnowledge: ledger };
  await db.put("focusSessions", project);
  const added = "Preview backups before replacing files.", decision = "Keep the previous backup until validation succeeds.";
  const { source, message } = await capture("chatgpt", `${added} ${decision}`, "An unrelated detail the project never adopted.");
  model.generateStructured.mockImplementationOnce(async request => request.validate({ changes: [
    { title: "Preview", text: added, kind: "proposal", messageId: message.id, quote: added },
    { title: "Retention", text: decision, kind: "proposal", messageId: message.id, quote: decision },
  ] }));
  const preview = (await previewProjectIncrement(project, source.id, false, signal))!;
  const saved = await applyProjectIncrement(preview, preview.changes.map(item => ({ item, decide: item.text === decision })), false);
  const units = wikiLedgerUnits(saved.wikiKnowledge);
  expect(units.map(unit => unit.statement)).toEqual([added, decision]);
  expect(units[1].evidence).toMatchObject({ messageId: message.id, quote: decision, role: "assistant", messageIndex: 1, sourceVersionId: preview.version.id });
  expect(saved.scope?.blocks?.find(block => block.conversationId === source.id)?.messageIds).toEqual([message.id]);
  expect(saved.wikiKnowledge?.batches[0].sourceIds).toEqual([units[0].evidence.evidenceId]);
  expect(saved.wikiKnowledge?.organization?.chapters.map(chapter => chapter.id)).toEqual(saved.sections.map(section => section.id));
  expect(saved.sections[1].claims?.[0].unitIds).toEqual([units[1].id]);
  expect(saved.wikiKnowledge?.decisions?.[units[1].id]).toMatchObject({ verdict: "confirmed", locallyApplied: true });
  const calls = model.generateStructured.mock.calls.length;
  const workspace = await generateFocusUpdate(saved, [source], "en", signal);
  expect(model.generateStructured).toHaveBeenCalledTimes(calls);
  expect(wikiLedgerUnits(workspace.wikiKnowledge)).toEqual(units);
  expect(continuationContext(workspace, false)).toContain(`[Decided] ${decision}`);
  const restored = await undoProjectIncrement(saved, false);
  expect(restored.sections).toEqual(project.sections);
  expect(restored.wikiKnowledge).toEqual(project.wikiKnowledge);
});

it("keeps previous export ratings and career asides out of a mixed update", async () => {
  const project = await createLivingProject("Circuit Studio", "", "en");
  const rating = "Codex 开发指导价值";
  const table = "| 评估维度 | 评分 | 评价 |\n| --- | --- | --- |\n| "+rating+" | 6/10 | 旧导出稿不完整 |";
  const advice = "大三学习路线优先考虑就业和实习。";
  const delivery = "当前支持在浏览器中查看端口的接线方案。";
  const {source,message} = await capture("gemini","### 旧导出稿评审\n\n"+table+"\n\n### 你最适合的技术栈\n\n"+advice+"\n\n### 项目功能\n\n"+delivery,"Evaluate the draft and suggest product updates.");
  model.generateStructured.mockImplementationOnce(async request=>request.validate({changes:[
    {title:rating,text:"旧导出稿的评分为 6/10。",quote:rating,messageId:message.id,kind:"finding"},
    {title:"个人方向",text:advice,quote:advice,messageId:message.id,kind:"proposal"},
    {title:"浏览器接线",text:delivery,quote:delivery,messageId:message.id,tableAnchor:rating,kind:"finding"},
  ]}));
  const preview=(await previewProjectIncrement(project,source.id,false,signal))!;
  expect(preview.unmatchedCitations).toBe(0);
  expect(preview.changes).toEqual([expect.objectContaining({text:delivery,table:undefined})]);
  expect(preview.version.messages.at(-1)?.content).toContain(table);
});

it("commits only one candidate when the sidebar and workbench publish against the same head", async () => {
  const project=await createLivingProject("Circuit Studio","","en","handoff");
  const {source,message}=await capture("gemini","Review the selected pins.");
  propose(message,"Pin review",message.content);
  const preview=(await previewProjectIncrement(project,source.id,false,signal))!;
  const candidate={...project,id:"workbench",rootSessionId:project.id,createdAt:project.createdAt+1,status:"preview" as const,
    notes:"Workbench candidate",wikiPublishBasis:wikiPublishBasis(project)};
  await saveFocusSession(candidate);
  const results=await Promise.allSettled([
    applyProjectIncrement(preview,[{item:preview.changes[0],decide:true}],false),
    saveFocusSession({...candidate,status:"ready"}),
  ]);
  expect(results.map(result=>result.status).sort()).toEqual(["fulfilled","rejected"]);
  expect((await listFocusSessions()).filter(item=>item.status==="ready"&&item.id!==project.id)).toHaveLength(1);
});

it("keeps a manual revision and its citations when stale editors try to save", async () => {
  const initial = await createLivingProject("Circuit Studio", "", "en");
  const { source, message } = await capture("chatgpt", "Commit only after validation.");
  propose(message, "Validation", message.content);
  const preview = (await previewProjectIncrement(initial, source.id, false, signal))!;
  const project = await applyProjectIncrement(preview, [{ item: preview.changes[0], decide: true }], false);
  const chapter = project.sections[0];
  const saved = await saveManualWikiChapter(project, chapter, chapter.title, "**Validate**, then commit.", false);
  expect(saved.sections[0]).toMatchObject({ id: chapter.id, userEdited: true, evidenceIds: chapter.evidenceIds });
  expect(saved.sourceVersionIds).toEqual(project.sourceVersionIds);
  await expect(saveManualWikiChapter(project, chapter, chapter.title, "Stale draft", false)).rejects.toThrow("version changed");
  await saveFocusSession({ ...project, updatedAt: saved.updatedAt + 10, notes: "Old workbench still open" });
  const db = await getDatabase();
  const canvas = (await db.get("canvases", saved.canvasId!))!;
  expect((await projectReader(canvas)).sections[0].body).toBe("**Validate**, then commit.");
});

it("rejects a hallucinated quote and rejects a saved preview after the document or source changes", async () => {
  const project = await createLivingProject("Circuit Studio", "", "en");
  const { source, message } = await capture("gemini", "Keep the original project on failure.");
  model.generateStructured.mockImplementationOnce(async request => request.validate({ changes: [{
    title: "Recovery", text: "Overwrite the project on failure.", kind: "finding", messageId: message.id, quote: "Overwrite the project on failure.",
  }] }));
  let checkpoint: ProjectIncrementResume["batchRun"];
  const unverified = (await previewProjectIncrement(project, source.id, false, signal, undefined, {}, false, undefined,
    async batch => { checkpoint = structuredClone(batch); }))!;
  expect(unverified).toMatchObject({ changes: [], unmatchedCitations: 1, citationFields: ["changes[0].quote"] });
  expect(await applyProjectIncrement(unverified, [], false)).toEqual(project);
  propose(message, "Recovery", message.content);
  const preview = (await previewProjectIncrement(project, source.id, false, signal, undefined, { batchRun: checkpoint }, true))!;
  expect(preview.changes).toEqual([expect.objectContaining({ quote: message.content })]);
  const changes = [{ item: preview.changes[0], decide: true }];
  const db = await getDatabase();
  await db.put("messages", { ...message, content: "The evidence changed." });
  await expect(applyProjectIncrement(preview, changes, false)).rejects.toThrow("changed");
  await db.put("messages", message);
  await saveFocusSession({ ...project, notes: "Keep my notes", updatedAt: project.updatedAt + 100 });
  await expect(applyProjectIncrement(preview, changes, false)).rejects.toThrow("changed");
  expect(await listFocusSessions()).toEqual([expect.objectContaining({ notes: "Keep my notes" })]);
});

it("recovers a mistyped source ID only when the quote has one verbatim match in the batch", async () => {
  const project = await createLivingProject("Circuit Studio", "", "en");
  const quote = "Commit only after validation.";
  const { source, message } = await capture("claude", quote, "Preview edits in a temporary copy.");
  const suggest = () => model.generateStructured.mockImplementationOnce(async request => request.validate({ changes: [{
    title: "Validation", text: quote, kind: "finding", messageId: "mistyped", quote,
  }] }));
  suggest();
  const preview = await previewProjectIncrement(project, source.id, false, signal);
  expect(preview?.changes[0]).toMatchObject({ messageId: message.id, quote });
  const db = await getDatabase();
  await db.put("messages", { ...message, id: "duplicate", messageIndex: 2 });
  suggest();
  expect(await previewProjectIncrement(project, source.id, false, signal)).toMatchObject({ changes: [], unmatchedCitations: 1 });
});

it("routes grounded additions, skips repeats, and applies a merge or removal only after explicit confirmation", async () => {
  const initial = await createLivingProject("Timer", "", "en");
  const first = "SQLite stores snapshots locally.", obsolete = "Legacy dumps include full payloads.", untouched = "Restoring requires a restart.";
  const chapter = { id:"storage", title:"Data storage and backups", kind:"finding" as const, transition:"",
    evidenceIds:["old"], body:[first,obsolete,untouched].join("\n\n"), claims:[{text:first,quote:first,evidenceIds:["old"]}] };
  const project = { ...initial, sections:[chapter], activeSectionId:chapter.id };
  const db = await getDatabase();
  await db.put("focusSessions", project);
  const { source,message } = await capture("gemini", "Keep SQLite snapshots locally and encrypt storage backups. Remove full payloads from legacy dumps.");
  const merged = "SQLite stores snapshots locally and encrypts backups.", newQuestion = "How long should data storage backups be retained?";
  model.generateStructured.mockImplementationOnce(async request => request.validate({changes:[
    { title:"Existing snapshots", text:first, kind:"finding", messageId:message.id, quote:"Keep SQLite snapshots locally" },
    { title:"Encrypted snapshots", text:merged, operation:"merge", target:chapter.id, targetText:first, kind:"finding", messageId:message.id, quote:"encrypt storage backups" },
    { title:"Withdraw legacy dumps", text:"The discussion removes full payloads from dumps.", operation:"remove", target:chapter.id, targetText:obsolete, kind:"finding", messageId:message.id, quote:"Remove full payloads from legacy dumps" },
    { title:"Retention", text:newQuestion, kind:"open_question", messageId:message.id, quote:"encrypt storage backups" },
  ]}));
  const preview = (await previewProjectIncrement(project,source.id,false,signal))!;
  const [merge, remove, question] = preview.changes;
  expect(preview.changes).toHaveLength(3);
  expect(question.appendTo).toBe(chapter.id);
  await expect(applyProjectIncrement(preview,[{item:merge,decide:true}],false)).rejects.toMatchObject({code:"SIDECAR_PREVIEW_STALE"});
  expect((await db.get("focusSessions",project.id))?.sections[0].body).toBe(chapter.body);
  const saved = await applyProjectIncrement(preview,[{item:merge,decide:false,editConfirmed:true},{item:remove,decide:false,editConfirmed:true},{item:question,decide:false}],false);
  expect(saved.sections).toHaveLength(1);
  expect(saved.sections[0].body).toContain(merged);
  expect(saved.sections[0].body).toContain(untouched);
  expect(saved.sections[0].body).toContain(newQuestion);
  expect(saved.sections[0].body).not.toContain(obsolete);
  expect(saved.sections[0].claims?.find(claim=>claim.text===merged)?.evidenceIds).toContain("old");
  expect((await undoProjectIncrement(saved,false)).sections[0].body).toBe(chapter.body);
});

it("retires a replaced full decision in the same write and restores it on undo", async () => {
  const initial = await createLivingProject("Timer", "", "en");
  const db = await getDatabase();
  const oldText = "Backups must be kept for 30 days.";
  const unitId = "storage-retention";
  const chapter = { id: "storage", title: "Backups", kind: "finding" as const, transition: "", body: oldText,
    evidenceIds: [], claims: [{ text: oldText, quote: oldText, evidenceIds: [], unitIds: [unitId], userDecided: true }] };
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 1, status: "complete", materials: 1, decisions: { [unitId]: { verdict: "confirmed", at: 1 } },
    batches: [{ sourceIds: ["material-old"], status: "ok", rejected: {}, units: [{
      id: unitId, subject: "Backups", statement: oldText, kind: "constraint", details: [], adoption: { status: "user_decision" }, delivery: "unknown",
      evidence: { evidenceId: "material-old", conversationId: "old-chat", messageId: "old-turn", messageIndex: 0, role: "user", pasted: false, quote: oldText },
    }] }] };
  const project = { ...initial, sections: [chapter], activeSectionId: chapter.id, wikiKnowledge: ledger };
  await db.put("focusSessions", project);
  const { source, message } = await capture("chatgpt", "Backups must be kept for 60 days.");
  model.generateStructured.mockImplementationOnce(async request => request.validate({ changes: [{
    title: "Backup retention", text: message.content, kind: "finding", target: chapter.id, operation: "replace",
    targetText: oldText, messageId: message.id, quote: message.content,
  }] }));
  const preview = (await previewProjectIncrement(project, source.id, false, signal))!;
  const saved = await applyProjectIncrement(preview, [{ item: preview.changes[0], decide: true, editConfirmed: true }], false);
  const [newId] = saved.sections[0].claims![0].unitIds!;
  expect(newId).not.toBe(unitId);
  expect(saved.wikiKnowledge?.decisions).toMatchObject({ [unitId]: { verdict: "rejected" }, [newId]: { verdict: "confirmed" } });
  expect(saved.sections[0].body).toBe(message.content);
  const restored = await undoProjectIncrement(saved, false);
  expect(restored.wikiKnowledge?.decisions).toEqual(ledger.decisions);
  expect(restored.sections[0].body).toBe(oldText);
});

it("reports the invalid field and retries only the failed batch while retaining completed changes", async () => {
  const project = await createLivingProject("Circuit Studio", "", "en");
  const words = "Extra background. ".repeat(420);
  const { source, message } = await capture("chatgpt", `Check recovery first. ${words}`, `Preview operations before saving. ${words}`);
  const db = await getDatabase();
  const last = `Keep the original copy. ${words}`;
  await db.put("messages", { ...message, id: "third", messageIndex: 2, content: last, contentHash: last, preview: last });
  const resume: ProjectIncrementResume = {};
  const progress = vi.fn();
  model.generateStructured.mockImplementationOnce(async request => {
    const [first] = JSON.parse(request.prompt).discussion;
    return request.validate({ changes: [{ title: "Preview", text: "Preview operations.", kind: "finding", messageId: first.id, quote: "Preview operations before saving." }] });
  }).mockImplementationOnce(async request => request.validate({ changes: [{
    title: "Recovery", text: "Check recovery first.", kind: "finding", target: "invalid-target",
  }] }));
  await expect(previewProjectIncrement(project, source.id, false, signal, progress, resume))
    .rejects.toMatchObject({ code: "PROVIDER_SCHEMA_sidecar_changes", fieldPaths: ["changes[0].target"] });
  expect(progress.mock.calls).toEqual([[0, 3], [1, 3]]);

  const retried: { id: string; size: number }[] = [];
  model.generateStructured.mockImplementation(async request => {
    const data = JSON.parse(request.prompt);
    if (data.presentation === "wiki_topic_plan") return request.validate(withWikiOutline({ pages: [{ title: "Safe writes", question: "How do writes recover?", group: "", sectionIds: data.sections.map((section: { id: string }) => section.id) }] }));
    const { discussion, alreadyProposed } = data as { discussion: { id: string; text: string }[]; alreadyProposed: string[] };
    expect(alreadyProposed).toContain("Preview operations.");
    retried.push({ id: discussion[0].id, size: discussion.reduce((sum, item) => sum + item.text.length, 0) });
    return request.validate({ changes: discussion[0].text.startsWith("Check recovery first.") ? [{
      title: "Recovery", text: "Check recovery.", kind: "finding", messageId: message.id, quote: "Check recovery first.",
    }] : [] });
  });
  const preview = await previewProjectIncrement(project, source.id, false, signal, progress, resume, true);
  expect(retried.filter(batch => batch.id === message.id).length).toBeGreaterThan(1);
  expect(retried.filter(batch => batch.id === message.id).every(batch => batch.size <= 4000)).toBe(true);
  expect(retried.at(-1)).toEqual({ id: "third", size: last.length });
  expect(retried.every(batch => batch.id === message.id || batch.id === "third")).toBe(true);
  expect(preview?.changes.map(change => change.title)).toEqual(["Preview", "Recovery"]);
});

it("keeps a conflicting version pending until chosen and protects a personally edited chapter", async () => {
  const initial = await createLivingProject("Circuit Studio", "", "en");
  const first = await capture("chatgpt", "First release supports ESP32 only.");
  propose(first.message, "Supported boards", first.message.content);
  const preview = (await previewProjectIncrement(initial, first.source.id, false, signal))!;
  const project = await applyProjectIncrement(preview, [{ item: preview.changes[0], decide: true }], false);
  const original = { ...project.sections[0], body: "My edited ESP32 constraint.", userEdited: true };
  const edited = { ...project, sections: [original], updatedAt: project.updatedAt + 1 };
  await saveFocusSession(edited);
  expect(continuationContext(edited, false)).toContain("[User edit] My edited ESP32 constraint.");
  expect(continuationContext(edited, false)).not.toContain(first.message.content);

  const second = await capture("claude", "Offer a second board in the first release.");
  model.generateStructured.mockImplementationOnce(async request => request.validate({ changes: [{
    title: "Supported boards", text: second.message.content, quote: second.message.content, messageId: second.message.id, kind: "proposal", target: original.id,
  }] }));
  const next = (await previewProjectIncrement(edited, second.source.id, false, signal))!;
  expect(next.changes[0].target).toBe(original.id);
  const saved = await applyProjectIncrement(next, [{ item: next.changes[0], decide: true }], false);
  expect(saved.sections[0]).toEqual(original);
  expect(saved.sections[1]).toMatchObject({ kind: "open_question", claims: [expect.objectContaining({ holder: "open", userDecided: false })] });
  await expect(applyProjectIncrement(next, [{ item: next.changes[0], decide: true }], false)).rejects.toThrow("changed");
});

it("offers a coherent chapter after new material arrives and moves saved notes only on approval", async () => {
  const initial = await createLivingProject("Timer", "", "en");
  const first = await capture("chatgpt", "Keep timer settings on the device.");
  propose(first.message, "Local settings", first.message.content);
  const preview = (await previewProjectIncrement(initial, first.source.id, false, signal))!;
  const saved = await applyProjectIncrement(preview, [{ item: preview.changes[0], decide: false }], false);
  expect(saved.sections[0].continuationLoose).toBe(true);
  expect(await previewProjectIncrement(saved, first.source.id, false, signal)).toBeUndefined();

  const second = await capture("claude", "Save the last selected duration. Restore preferences when reopening.");
  const updates = ["Save the last selected duration.", "Restore preferences when reopening."];
  const extract = () => model.generateStructured.mockImplementationOnce(async request => request.validate({ changes: updates.map((text, index) => ({
    title: ["Save duration", "Restore preferences"][index], text, quote: text, kind: "finding", messageId: second.message.id,
  })) }));
  extract();
  model.generateStructured.mockImplementationOnce(async request => {
    const data = JSON.parse(request.prompt);
    expect(data.presentation).toBe("wiki_topic_plan");
    expect(data.sections).toHaveLength(3);
    return request.validate(withWikiOutline({ pages: [{ title: "Local preferences", question: "How do preferences persist?", group: "", sectionIds: data.sections.map((entry: { id: string }) => entry.id) }] }));
  });
  const staged = (await previewProjectIncrement(saved, second.source.id, false, signal))!;
  expect(staged.directory[0]).toMatchObject({ title: "Local preferences", sectionIds: expect.arrayContaining([saved.sections[0].id]) });
  const selection = staged.changes.map(item => ({ item, decide: false }));
  expect((await (await getDatabase()).get("focusSessions", saved.id))?.sections).toEqual(saved.sections);
  const flat = await applyProjectIncrement(staged, selection, false);
  expect(flat.sections).toHaveLength(3);
  expect(flat.sections.every(section => section.continuationLoose)).toBe(true);
  const restored = await undoProjectIncrement(flat, false);
  const grouped = await applyProjectIncrement({ ...staged, project: restored }, selection, false, true);
  expect(grouped.sections).toHaveLength(1);
  expect(grouped.sections[0]).toMatchObject({ id: saved.sections[0].id, title: "Local preferences", evidenceIds: expect.arrayContaining(saved.sections[0].evidenceIds) });
  expect(grouped.sections[0].continuationLoose).toBeUndefined();
  for (const line of [first.message.content, ...updates]) expect(grouped.sections[0].body).toContain(line);

  const third = await capture("gemini", "Only restore preferences after the user signs in.");
  model.generateStructured.mockImplementationOnce(async request => request.validate({ changes: [{
    title: "Restore after sign-in", text: third.message.content, quote: third.message.content, messageId: third.message.id,
    kind: "finding", target: grouped.sections[0].id, targetText: updates[1],
  }] }));
  const correction = (await previewProjectIncrement(grouped, third.source.id, false, signal))!;
  const corrected = await applyProjectIncrement(correction, [{ item: correction.changes[0], decide: true }], false);
  expect(corrected.sections).toHaveLength(1);
  expect(corrected.sections[0].body).not.toContain(updates[1]);
  expect(corrected.sections[0].body).toContain(updates[0]);
  expect(corrected.sections[0].body).toContain(third.message.content);
  expect(corrected.sections[0].claims).toContainEqual(expect.objectContaining({ text: third.message.content, holder: "decided" }));
});

it("reloads sidecar table bindings and its original source version for all three export presets", async () => {
  const base=await createLivingProject("Timer","","en","audit");
  const chapter={id:"display",title:"Timer display",kind:"finding" as const,body:"### Pause\n\nKeep the timer visible.",transition:"",evidenceIds:[]};
  const draftChapter={...chapter,question:"",group:"",paragraphs:[],problems:[]};
  const ledger:WikiKnowledgeLedger={version:1,generatedAt:1,status:"complete",writingMode:"handoff",materials:0,batches:[],
    draft:{version:1,status:"complete",generatedAt:1,writingMode:"handoff",chapters:[draftChapter],report:{}}};
  const project=await saveFocusSession({...base,sections:[chapter],activeSectionId:chapter.id,wikiKnowledge:ledger});
  const statement="Show elapsed time while the timer runs.";
  const table="| State | Display |\n| --- | --- |\n| Running | Elapsed time |\n| Paused | Last recorded time |";
  const {source,message}=await capture("gemini",statement+"\n\n"+table);
  model.generateStructured.mockImplementationOnce(async request=>request.validate({changes:[
    {title:"Running display",text:statement,kind:"finding",quote:statement,tableAnchor:"Last recorded time",messageId:message.id,appendTo:chapter.id},
  ]}));
  const preview=(await previewProjectIncrement(project,source.id,false,signal))!;
  const saved=await applyProjectIncrement(preview,[{item:preview.changes[0],decide:true}],false);
  const reloaded=(await (await getDatabase()).get("focusSessions",saved.id))!;
  expect(reloaded).toMatchObject({sidecarWritingMode:"audit",wikiKnowledge:{writingMode:"handoff",draft:{writingMode:"handoff",generatedAt:1}}});
  expect(reloaded.wikiKnowledge?.draft?.chapters[0].paragraphs).toContainEqual(expect.objectContaining({text:statement}));
  expect(wikiLedgerUnits(reloaded.wikiKnowledge)[0].evidence).toMatchObject({messageId:message.id,sourceVersionId:preview.version.id,code:{language:"table",text:table}});
  expect(await currentSourceChange(reloaded,source.id)).toMatchObject({added:0,changed:0,removed:0});
  for(const preset of ["brief","handoff","archive"] as const){
    const {text}=projectDocument(reloaded,projectExportSelection(reloaded,preset),"md",false);
    expect(text).toContain(statement);
    expect(text).toContain(table);
    expect(text.split(table)).toHaveLength(2);
    expect(text).not.toContain("#atlas-original-");
    if(preset==="brief")expect(text).not.toMatch(/\[Source \d+\]/u);
    else expect(text).toMatch(/\[Source \d+\]\(#source-S-/u);
  }
});

it("uses manual chapter titles and text as context and only appends the grounded selection", async () => {
  const initial = await createLivingProject("Timer", "", "en");
  const manual = ["### Pause", "Start and pause are separate actions.", "The pause action preserves elapsed time.", "### Reset", "Reset clears the timer."].join("\n\n");
  const project = await saveManualWikiChapter(initial, undefined, "Timer controls", manual, false);
  const [chapter] = project.sections;
  const paragraph = "Show the remaining duration while paused.";
  const table = "| State | Display |\n| --- | --- |\n| Paused | Remaining duration |\n| Running | Elapsed time |";
  const { source, message } = await capture("gemini", `${paragraph}\n\n${table}`);
  model.generateStructured.mockImplementationOnce(async request => {
    expect(JSON.parse(request.prompt).existing[chapter.id]).toMatchObject({ title: chapter.title, text: manual, manual: true, kind: "chapter" });
    return request.validate({ changes: [
      { title: "Repeated introduction", text: "Start and pause are separate actions.", messageId: message.id, quote: paragraph, kind: "finding", appendTo: chapter.id },
      { title: "Pause display", text: paragraph, messageId: message.id, quote: paragraph, kind: "finding", appendTo: chapter.id,
        afterHeading: "### Pause", tableAnchor: "Remaining duration" },
    ] });
  });
  const preview = (await previewProjectIncrement(project, source.id, false, signal))!;
  const [item] = preview.changes;
  expect(preview.changes).toHaveLength(1);
  expect(item).toMatchObject({ appendTo: chapter.id, afterHeading: "### Pause", table });
  expect(preview.directory).toEqual([]);
  const saved = await applyProjectIncrement(preview, [{ item, decide: false }], false);
  expect(saved.sections).toHaveLength(1);
  expect(saved.sections[0]).toMatchObject({ id: chapter.id, title: chapter.title, userEdited: true, evidenceIds: saved.evidence.map(ref => ref.id) });
  expect(saved.sections[0].body).toContain(`The pause action preserves elapsed time.\n\n${paragraph}\n\n${table}`);
  expect(saved.sections[0].body.indexOf(table)).toBeLessThan(saved.sections[0].body.indexOf("### Reset"));
  expect(saved.evidence[1]).toMatchObject({ messageId: message.id, excerpt: table });
  const exported = projectDocument(saved, { overview: false, wikiIds: [chapter.id], matters: false, history: false, sources: false }, "md", false);
  expect(exported.text).toContain(table);
  expect(exported.text).not.toContain("#atlas-original-");
});
