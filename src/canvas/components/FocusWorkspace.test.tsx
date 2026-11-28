import "fake-indexeddb/auto";
import { act,cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences";
import { FocusWorkspace } from "./FocusWorkspace";
import { generateFocusSession } from "../../ai/focus-session";
import { DemoApiError } from "../../ai/demo-api";
import { AIProviderResponseError, AIProviderValidationError } from "../../ai/provider";
import { getDatabase } from "../../storage/db";
import { sourceMessageSignature } from "../../shared/source-signature";
import type { FocusSession } from "../../shared/focus-session";
import type { Conversation } from "../../shared/types";
import { StrictMode } from "react";
import * as focusStorage from "../../storage/focus-sessions";
import type { FocusScope } from "../../shared/focus-session";
import type { WikiKnowledgeUnit } from "../../shared/wiki-knowledge";
import { projectSession } from "../../test/project-fixture";
import { contextKnowledge } from "../../test/context-fixture";
import * as wikiRewriteAI from "../../ai/wiki-section-rewrite";
import * as wikiRevisionAI from "../../ai/wiki-revision";
import * as focusUpdates from "../../ai/focus-update";
import { startWorkbenchRequest } from "../../ai/workbench-run-activity";
import { recordAIUsage } from "../../storage/ai-usage";

vi.mock("../../ai/focus-session", () => ({ generateFocusSession: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
vi.mock("../../ai/knowledge-source-retrieval", async (original) => ({ ...await original<typeof import("../../ai/knowledge-source-retrieval")>(), rankKnowledgeSources: () => [], retrieveKnowledgeSources: async () => [] }));
const conversation: Conversation = { id: "c", title: "Control discussion", platform: "chatgpt", url: "", messageCount: 2, importState: "complete", hydrationState: "hydrated", updatedAt: 1 };
const session: FocusSession = { id: "s", goal: "Review poles", mode: "answer", title: "Stability review", sourceConversationIds: ["c"], evidence: [{ id: "e1", conversationId: "c", messageId: "m1", title: "Control discussion", excerpt: "Why poles?" }], sections: [{ id: "one", title: "Understanding poles", body: "Read the original explanation.", kind: "review", transition: "", evidenceIds: ["e1"] }], activeSectionId: "one", completedSectionIds: [], notes: "Keep my edits", createdAt: 1, updatedAt: 1 };
beforeEach(async () => { vi.clearAllMocks(); localStorage.setItem("atlas-locale", "en"); localStorage.removeItem("atlas-wiki-categories:s"); const db = await getDatabase(); await db.clear("canvases"); await db.clear("projectQueryThreads"); await db.clear("focusGenerationTasks"); await db.clear("focusSessions"); await db.clear("conversations"); await db.clear("aiSettings"); await db.put("aiSettings", { id: "ai-settings", mode: "byok", provider: "openai", baseUrl: "https://api.example/v1", apiKey: "fixture", model: "fixture", updatedAt: 1 }); await db.clear("messages"); await db.put("messages", { id: "m1", conversationId: "c", messageIndex: 0, role: "user", content: "Why poles?", preview: "Why poles?", contentHash: "hash", createdAt: 1, updatedAt: 1 }); });

async function confirmDiscussionScope() { const button = await screen.findByRole("button", { name: "Generate preview" }); await waitFor(() => expect(screen.queryByText("Finding discussions…")).not.toBeInTheDocument()); if ((button as HTMLButtonElement).disabled) { fireEvent.click(screen.getByRole("button", { name: "Browse other discussions" })); fireEvent.click(screen.getAllByRole("checkbox")[0]); } fireEvent.click(button); }

it("offers a sidebar version that arrives while an older workbench version remains open", async () => {
  const initial = { ...projectSession(), canvasId: "sidecar-project", createdAt: 10, updatedAt: 10 };
  const saved = { ...initial, id: "sidecar-saved", previousSessionId: initial.id, createdAt: 20, updatedAt: 20,
    continuationUpdate: { at: 20, conversationId: "c", sectionIds: [initial.sections[0].id] } };
  const onOpenSession = vi.fn();
  const view = (availableSessions: FocusSession[]) => <PreferencesProvider><FocusWorkspace initialSession={initial} availableSessions={availableSessions}
    conversations={[]} canvases={[]} settingsRevision={0} onOpenSession={onOpenSession} onClose={vi.fn()}
    onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>;
  const { rerender } = render(view([initial]));
  expect(screen.queryByRole("button", { name: "Open latest version" })).not.toBeInTheDocument();
  rerender(view([saved, initial]));
  expect(screen.getByText("The sidebar saved a new version")).toBeVisible();
  expect(onOpenSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open latest version" }));
  await waitFor(() => expect(onOpenSession).toHaveBeenCalledWith(saved.id, undefined, false));
});

it("opens the previous-version comparison from More and lets the reader switch changed chapters", () => {
  const base = projectSession();
  const shared = "First shared passage.\n\nSecond shared passage.\n\nThird shared passage.";
  const unchanged = { ...base.sections[0], id: "unchanged", title: "Stable chapter", body: "Same note." };
  const previous = { ...base, id: "comparison-prev", sections: [{ ...base.sections[0], body: `${shared}\n\nOld approach.` }, unchanged, { ...base.sections[0], id: "old", title: "Retired chapter", body: "Old note only." }] };
  const current = { ...base, id: "comparison-current", previousSessionId: previous.id,
    sections: [{ ...base.sections[0], body: `${shared}\n\n**Updated** approach.` }, unchanged] };
  render(<PreferencesProvider><FocusWorkspace initialSession={current} projectSessions={[previous, current]} conversations={[]} canvases={[]} settingsRevision={0}
    onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
  fireEvent.click(screen.getByText("More", { exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Compare with previous version" }));
  const dialog = screen.getByRole("dialog", { name: "Compare with previous version" });
  expect(within(dialog).getByText("Updated").closest("[data-kind=added]")).not.toBeNull();
  expect(within(dialog).getByText("2 changed · 1 unchanged")).toBeInTheDocument();
  const toggle = within(dialog).getByRole("button", { name: "Show 3 unchanged passages" });
  const sharedBody = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  expect(sharedBody).not.toBeVisible();
  fireEvent.click(toggle);
  expect(toggle).toHaveAccessibleName("Hide unchanged passages");
  expect(sharedBody).toBeVisible();
  expect(Array.from(sharedBody.children, row => Array.from(row.children, cell => cell.textContent))).toEqual(
    shared.split("\n\n").map(line => [line, line]),
  );
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(sharedBody).not.toBeVisible();
  fireEvent.click(within(dialog).getByRole("button", { name: "Retired chapter Removed" }));
  expect(within(dialog).getByText("Old note only.").closest("[data-kind=removed]")).not.toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close comparison" }));
  expect(dialog).not.toBeInTheDocument();
});

it("collapses the Wiki directory with the Reader control and restores its selected tab", () => {
  const key = "atlas-project-navigation-layout";
  localStorage.setItem(key, JSON.stringify({ side: "right", width: 280, collapsed: false }));
  try {
    render(<PreferencesProvider><FocusWorkspace initialSession={projectSession()} conversations={[]} canvases={[]} settingsRevision={0}
      onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    const nav = screen.getByRole("navigation", { name: "Conversation chapters" });
    fireEvent.click(within(nav).getByRole("tab", { name: /Sources/ }));
    fireEvent.click(within(nav).getByRole("button", { name: "Collapse sidebar" }));
    expect(nav).toHaveAttribute("hidden");
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ width: 280, collapsed: true });
    fireEvent.click(screen.getByText("More", { exact: true }));
    expect(screen.queryByRole("button", { name: /Move project sidebar/ })).not.toBeInTheDocument();
    const open = within(document.querySelector(".project-navigation-rail") as HTMLElement).getByRole("button", { name: "Expand sidebar" });
    expect(open).toHaveAttribute("aria-controls", nav.id);
    fireEvent.click(open);
    expect(nav).not.toHaveAttribute("hidden");
    expect(within(nav).getByRole("tab", { name: /Sources/, selected: true })).toBeVisible();
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ width: 280, collapsed: false });
  } finally { localStorage.removeItem(key); }
});

it("waits for a choice before writing and starts in the selected mode", async () => {
 const book = { version: 1, generatedAt: 1, status: "complete", materials: 1, batches: [] } as const;
 const wrote = vi.fn();
 vi.mocked(generateFocusSession).mockImplementationOnce(async (...args) => {
  const onMode = args[9]?.onWritingMode;
  expect(onMode).toBeDefined();
  const mode = await onMode!("concise");
  wrote(mode);
  return { ...session, mode: "work", wikiKnowledge: { ...book, batches: [], writingMode: mode } };
 });
 const scope: FocusScope = { kind: "all", sourceConversationIds: ["c"], documentType: "project" };
 render(<PreferencesProvider><FocusWorkspace request={{ id: "writing-mode", goal: "Write a project Wiki", mode: "work", sourceIds: ["c"], scope }}
  conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 expect(await screen.findByRole("radio", { name: /Concise Wiki/ })).toBeChecked();
 expect(screen.getByRole("radio", { name: /Full audit/ })).toBeVisible();
 expect(wrote).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("radio", { name: /Development spec/ }));
 fireEvent.click(screen.getByRole("button", { name: "Start writing" }));
 await waitFor(() => expect(wrote).toHaveBeenCalledWith("handoff"));
});

it("lets a saved project choose a new writing mode from More and shows a preview", async () => {
 const project:FocusSession = { ...session, mode:"work", status:"ready", locale:"en",
  wikiKnowledge:{version:1,generatedAt:1,status:"complete",materials:1,batches:[],writingMode:"concise",
    organization:{version:1,generatedAt:1,status:"complete",subjects:[],relations:[],merged:[],chapters:[],report:{}},
    draft:{version:1,generatedAt:1,status:"complete",chapters:[],report:{},writingMode:"concise"}} };
 const load = vi.spyOn(focusUpdates,"generateFocusUpdate").mockResolvedValueOnce({...project,id:"spec-preview"});
 await (await getDatabase()).put("focusSessions",project);
 const dialog = HTMLDialogElement.prototype;
 const original = { showModal: dialog.showModal, close: dialog.close };
 Object.assign(dialog, {
  showModal(this: HTMLDialogElement) { this.open = true; },
  close(this: HTMLDialogElement) { this.open = false; },
 });
 try {
  render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[]} settingsRevision={0}
   onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
  fireEvent.click(screen.getByText("More",{exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"Change writing mode"}));
  expect(screen.getByRole("radio",{name:/Concise Wiki/})).toBeChecked();
  fireEvent.click(screen.getByRole("radio",{name:/Development spec/}));
  fireEvent.click(screen.getByRole("button",{name:"Generate preview"}));
  expect(await screen.findByRole("button",{name:"Save and view"})).toBeVisible();
  expect(load.mock.calls[0].at(-1)).toMatchObject({writingMode:"handoff"});
  expect(generateFocusSession).not.toHaveBeenCalled();
 } finally { cleanup(); Object.assign(dialog, original); }
});

it("reviews unlabelled and default AI points individually, decrementing the count before leaving the chapter",async()=>{
 const db=await getDatabase();
 const texts=["全文检索保留各候选消息的位置。","混合检索支持使用模糊描述定位原始对话。"];
 const original=(await db.get("messages","m1"))!;
 await db.put("messages",{...original,content:texts.join("\n\n")});
 await db.put("conversations",conversation);
 const page={...session.sections[0],title:"Search sources",body:texts.join("\n\n"),claims:texts.map((text,index)=>({
  text,quote:text,evidenceIds:["e1"],...(index?{holder:"ai" as const,holderMark:true}:{})
 }))};
 const project:FocusSession={...session,mode:"work",status:"ready",sections:[page],evidence:[{...session.evidence[0],excerpt:"索引设置。"}]};
 await db.put("focusSessions",project);
 render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 fireEvent.click(await screen.findByRole("button",{name:"Check evidence · 2 to confirm"}));
 expect(await screen.findByText("Review 1 of 2")).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"Source is fine"}));
 expect(screen.getByText("Review 2 of 2")).toBeVisible();
 expect(screen.getByRole("button",{name:"Check evidence · 1 to confirm"})).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"Change"}));
 fireEvent.click(screen.getByRole("button",{name:"Decided"}));
 expect(screen.getAllByText("Chapter reviewed").length).toBeGreaterThan(0);
 expect(screen.queryByRole("button",{name:"Check evidence · 1 to confirm"})).toBeNull();
 await waitFor(async()=>{
  const saved=await db.get("focusSessions",project.id);
  expect(saved?.sections[0].claims?.map(claim=>[claim.checked,claim.holder])).toEqual([[true,undefined],[true,"decided"]]);
 });
});

it("checks the local source before previewing an update and leaves the Wiki alone when text is unchanged",async()=>{
 const db=await getDatabase(),canvas={id:"space",name:"Project",createdAt:1,updatedAt:1};
 const project:FocusSession={...session,mode:"work",status:"ready",canvasId:canvas.id,
  sourceSignatures:{c:{m1:sourceMessageSignature("Why poles?")}}};
 await db.put("conversations",{...conversation,updatedAt:123});
 await db.put("canvases",canvas);
 await db.put("focusSessions",project);
 render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[canvas]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Update"}));
 expect(await screen.findByText("The document is up to date.")).toBeVisible();
 expect(screen.queryByText("Sources changed")).toBeNull();
 expect(generateFocusSession).not.toHaveBeenCalled();
});

it.each(["coverage", "writing"] as const)("retries incomplete Wiki %s through Update even when the original message is unchanged",async(incomplete)=>{
 const db=await getDatabase(),canvas={id:"space",name:"Project",createdAt:1,updatedAt:1};
 const project:FocusSession={...session,mode:"work",status:"ready",canvasId:canvas.id,
  sourceSignatures:{c:{m1:sourceMessageSignature("Why poles?")}},
  scope:{kind:"goal",blocks:[{conversationId:"c",title:"Stability",messageIds:["m1"],messageSignatures:{m1:sourceMessageSignature("Why poles?")}}]},
  wikiKnowledge:{version:1,status:"complete",generatedAt:1,materials:1,batches:[{sourceIds:["e:c:0:1"],units:[],rejected:{},status:"ok",...(incomplete==="coverage"?{uncovered:["e:c:0:1"]}:{})}],
    ...(incomplete==="writing"?{draft:{version:1,status:"partial",generatedAt:1,chapters:[],report:{write_parts_lost:1}}}:{})}};
 await db.put("conversations",conversation);
 await db.put("canvases",canvas);
 await db.put("focusSessions",project);
 let finish!: (result:FocusSession) => void;
 const update=vi.spyOn(focusUpdates,"generateFocusUpdate").mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[canvas]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Update"}));
 await waitFor(()=>expect(update).toHaveBeenCalledOnce());
 const [previous, sources, , , , , onProgress, callbacks] = update.mock.calls[0];
 expect(previous.id).toBe(project.id);
 expect(sources.map(source=>source.id)).toEqual(["c"]);
 act(()=>onProgress?.(1,2,"reading",{completed:1,total:2,stage:"reading",final:false,round:1,completedSourceIds:[],totalSources:1,processedSegments:0,totalSegments:0,elapsedMs:1,ledger:{stage:"extract",done:1,total:2}}));
 expect(screen.getByText("Read conversations and extract knowledge")).toBeVisible();
 act(()=>callbacks?.onPartial?.({...project,sections:[{...project.sections[0],wikiOutline:true}]}));
 expect(screen.getByRole("region",{name:"Chapter draft preview"})).toBeVisible();
 await act(async()=>finish({...project,id:"retry-preview"}));
 expect(await screen.findByRole("button",{name:"Save and view"})).toBeVisible();
 await waitFor(async()=>expect((await db.get("focusSessions","retry-preview"))?.scope).toEqual(project.scope));
 expect(screen.queryByText("The document is up to date.")).toBeNull();
});

it("reviews a question inline and uses the sidebar only for its source", async () => {
  const db = await getDatabase();
  const choice = "Enable Markdown export.";
  const unit: WikiKnowledgeUnit = { id:"markdown", subject:"Export", statement:choice, kind:"plan", details:[],
    adoption:{status:"proposal"}, delivery:"planned",
    evidence:{evidenceId:"option-source",conversationId:"c",messageId:"export-source",messageIndex:1,role:"assistant",pasted:false,quote:choice} };
  const section={...session.sections[0],title:"Export chapter",body:choice,evidenceIds:[unit.evidence.evidenceId]};
  const chapter={id:section.id,title:section.title,question:"What can be exported?",group:"",subtopics:[{title:"Export",subjectIds:["s-export"]}]};
  const ask="Should the first release enable Markdown export?";
  const project:FocusSession={...session,mode:"work",status:"ready",sections:[section],evidence:[{
    id:unit.evidence.evidenceId,conversationId:"c",messageId:unit.evidence.messageId,title:conversation.title,excerpt:choice,
  }],wikiKnowledge:{version:1,status:"complete",generatedAt:1,materials:1,documentType:"project",
    batches:[{sourceIds:[unit.evidence.evidenceId],units:[unit],rejected:{},status:"ok"}],
    organization:{version:1,generatedAt:1,status:"complete",chapters:[chapter],subjects:[{id:"s-export",name:"Export",aliases:[],unitIds:[unit.id]}],merged:[],relations:[],report:{}},
    draft:{version:1,generatedAt:1,status:"complete",report:{},chapters:[{...chapter,body:choice,problems:[],paragraphs:[{text:choice,subtopic:"Export",unitIds:[unit.id]}]}]},
    writingQuestions:[{id:"export",about:"Markdown export",ask,unitIds:[unit.id],organization:1,options:[
      {id:"enable",label:choice,actions:[{do:"confirm",units:[unit.id]}]},
      {id:"defer",label:"Not yet decided",actions:[{do:"open",units:[unit.id]}]},
    ]}],
  }};
  await db.put("conversations",conversation);
  await db.put("messages",{id:unit.evidence.messageId,conversationId:"c",messageIndex:1,role:"assistant",content:choice,preview:choice,contentHash:"export",createdAt:2,updatedAt:2});
  await db.put("focusSessions",project);
  const update=vi.spyOn(focusUpdates,"generateFocusUpdate");
  vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockReturnValue(new DOMRect(0,0,1280,840));
  render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
  fireEvent.click(screen.getByRole("button",{name:"Document overview"}));
  fireEvent.click((await screen.findByText(ask)).closest("summary")!);
  const overview=within(screen.getByRole("region",{name:"Open questions"}));
  expect(overview.getByRole("radio",{name:choice})).toBeVisible();
  expect(screen.queryByRole("complementary",{name:"Original evidence"})).toBeNull();
  fireEvent.click(overview.getByRole("button",{name:"Source 1"}));
  const pane=screen.getByRole("complementary",{name:"Original evidence"});
  expect(within(pane).queryByRole("radio")).toBeNull();
  expect(screen.getByRole("button",{name:"Document overview"})).toHaveAttribute("aria-current","page");
  fireEvent.click(overview.getByRole("radio",{name:choice}));
  fireEvent.click(overview.getByRole("button",{name:"Confirm choice"}));
  await waitFor(async()=>expect((await db.get("focusSessions",project.id))?.wikiKnowledge?.decisions?.[unit.id]?.verdict).toBe("confirmed"));
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(await overview.findByRole("button",{name:"Undo"}));
  await waitFor(async()=>expect((await db.get("focusSessions",project.id))?.wikiKnowledge?.decisions?.[unit.id]).toBeUndefined());
});

it("uses the project update action from a chapter and returns there after applying a saved decision", async () => {
  const db = await getDatabase();
  const chapter = { ...session.sections[0], title: "Decision chapter" };
  const canvas = { id: "decision-space", name: "Decision project", createdAt: 1, updatedAt: 1 };
  const project: FocusSession = { ...session, mode: "work", status: "ready", canvasId: canvas.id, sections: [chapter],
    sourceSignatures: { c: { m1: sourceMessageSignature("Why poles?") } },
    wikiKnowledge: { version: 1, status: "partial", generatedAt: 1, materials: 1,
      batches: [{ sourceIds: ["pending"], units: [], rejected: {}, status: "ok", uncovered: ["pending"] }],
      organization: { version: 1, generatedAt: 1, status: "complete", chapters: [], subjects: [], merged: [], relations: [], report: {} },
      draft: { version: 1, status: "complete", generatedAt: 1, chapters: [], report: {} },
      decisionsAt: 2, decisionArbitrations: { scope: { choice: "custom", mode: "custom", at: 2, chapterId: chapter.id, text: "Keep the new scope." } } } };
  await db.put("conversations", conversation);
  await db.put("canvases", canvas);
  await db.put("focusSessions", project);
  const savedDraft = { ...project.wikiKnowledge!, draft: { ...project.wikiKnowledge!.draft!, generatedAt: 3 } };
  const update = vi.spyOn(focusUpdates, "generateFocusUpdate").mockResolvedValue({ ...project, id: "decision-preview", activeSectionId: chapter.id, wikiKnowledge: savedDraft });
  render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[canvas]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
  fireEvent.click(within(screen.getByRole("navigation", { name: "Conversation chapters" })).getByRole("button", { name: /Decision chapter/ }));
  expect(screen.queryByRole("button", { name: "Preview article update" })).toBeNull();
  const apply = await screen.findByRole("button", { name: "Update" });
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(apply);
  fireEvent.click(await screen.findByRole("button", { name: "Save and view" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: chapter.title })).toBeVisible());
  expect(update).toHaveBeenCalledOnce();
  expect(update.mock.calls[0][7]).toMatchObject({ reorganize: false });
  expect(screen.queryByRole("button", { name: "Preview article update" })).toBeNull();
});

it.each([true, false])("docks update progress before the first draft during writing confirmation (header available: %s)", async inHeader => {
 const db = await getDatabase(), canvas = { id: "space", name: "Project", createdAt: 1, updatedAt: 1 };
 const ledger = { version: 1 as const, status: "complete" as const, generatedAt: 1, materials: 1, batches: [], scopeAnswers: { chatatlas: "exclude" as const } };
 const project: FocusSession = { ...session, mode: "work", status: "ready", canvasId: canvas.id,
   sourceSignatures: { c: { m1: sourceMessageSignature("Why poles?") } }, wikiKnowledge: ledger };
 await db.put("conversations", conversation);
 await db.put("canvases", canvas);
 await db.put("focusSessions", project);
 let finish!: (value: FocusSession) => void;
 const update = vi.spyOn(focusUpdates, "generateFocusUpdate").mockImplementation(async (...args) => {
   const [onProgress, callbacks] = [args[6], args[7]];
   onProgress?.(1, 1, "synthesis", { completed: 1, total: 1, stage: "synthesis", final: true, round: 1, completedSourceIds: ["c"], totalSources: 1,
     processedSegments: 1, totalSegments: 1, elapsedMs: 98000, ledger: { stage: "group", done: 238, total: 238 } });
   await callbacks?.onKeyDecisions?.(ledger);
   onProgress?.(0, 2, "synthesis", { completed: 0, total: 2, stage: "synthesis", final: true, round: 1, completedSourceIds: ["c"], totalSources: 1,
     processedSegments: 1, totalSegments: 1, elapsedMs: 98000, ledger: { stage: "write", done: 0, total: 2 } });
   return new Promise(resolve => { finish = resolve; });
 });
 const { container: header } = render(<header/>);
 const host = header.querySelector("header")!;
 const workspace = render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[canvas]} settingsRevision={0}
   headerProgressTarget={inHeader ? host : undefined} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 fireEvent.click(screen.getByRole("button", { name: "Update" }));
 const confirmation = await screen.findByRole("heading", { name: "The discussion also names these" });
 expect(update).toHaveBeenCalledOnce();
 const progressRoot = inHeader ? host : workspace.container.querySelector<HTMLElement>(".focus-progress-fallback")!;
 const summary = within(progressRoot).getByLabelText("View generation progress");
 expect(summary).toHaveTextContent("Awaiting confirmation");
 expect(summary).not.toHaveTextContent("100%");
 expect(workspace.container.querySelector(".focus-generation-panel")).toBeNull();
 expect(screen.queryByRole("region", { name: "Chapter draft preview" })).toBeNull();
 if (!inHeader) expect(progressRoot.compareDocumentPosition(confirmation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 fireEvent.click(summary);
 expect(within(progressRoot).getByRole("button", { name: "Cancel" })).toBeVisible();
 fireEvent.click(screen.getByRole("button", { name: "Start writing" }));
 await waitFor(() => expect(summary).toHaveTextContent("Write chapters"));
 expect(workspace.container.querySelector(".focus-generation-panel")).toBeNull();
 await act(async () => finish({ ...project, id: "confirmed-update-preview" }));
 expect(await screen.findByRole("button", { name: "Save and view" })).toBeVisible();
 expect(screen.queryByLabelText("View generation progress")).toBeNull();
});

it("asks only for the affected scope before sending changed discussions into the update pipeline",async()=>{
 const db=await getDatabase(),canvas={id:"space",name:"Project",createdAt:1,updatedAt:1};
 const oldSignature=sourceMessageSignature("Why poles?"), newText="Why do poles matter?";
 const project:FocusSession={...session,mode:"work",status:"ready",canvasId:canvas.id,sourceSignatures:{c:{m1:oldSignature}},
  scope:{kind:"goal",blocks:[{conversationId:"c",title:"Stability",messageIds:["m1"],messageSignatures:{m1:oldSignature}}]}};
 await db.put("conversations",conversation);
 await db.put("canvases",canvas);
 await db.put("focusSessions",project);
 const message=(await db.get("messages","m1"))!;
 await db.put("messages",{...message,content:newText,preview:newText,updatedAt:2});
 const update=vi.spyOn(focusUpdates,"generateFocusUpdate").mockResolvedValue({...project,id:"changed-preview"});
 render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[canvas]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 const start=await screen.findByRole("button",{name:"Start update"});
 expect(start.closest("aside")!.compareDocumentPosition(screen.getByRole("article",{name:"Document overview"})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(update).not.toHaveBeenCalled();
 fireEvent.click(start);
 expect(await screen.findByRole("heading",{name:"Confirm update scope"})).toBeVisible();
 expect(screen.queryByRole("heading",{name:"What would you like to do?"})).toBeNull();
 const confirm=screen.getByRole("button",{name:"Update and preview"});
 await waitFor(()=>expect(confirm).toBeEnabled());
 fireEvent.click(confirm);
 await waitFor(()=>expect(update.mock.calls[0]?.[7]?.scope?.blocks?.[0].messageSignatures).toEqual({m1:sourceMessageSignature(newText)}));
 expect(generateFocusSession).not.toHaveBeenCalled();
});

it("keeps the plan preview heading free of a version picker",()=>{
 const old:FocusSession={...session,mode:"work",id:"unsaved-old",createdAt:1,status:"ready"};
 const current:FocusSession={...old,id:"unsaved-new",createdAt:2,status:"preview",rootSessionId:old.id,previousSessionId:old.id};
 render(<PreferencesProvider><FocusWorkspace initialSession={current} availableSessions={[old]} onOpenSession={vi.fn()} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 expect(document.querySelector(".focus-preview-title-row select")).toBeNull();
});
it.each(["ready"] as const)("switches versions of an unsaved result without attaching or accepting a project (%s)",async status=>{
 const old:FocusSession={...session,mode:"work",id:"unsaved-old",createdAt:1,status:"ready"};
 const current:FocusSession={...old,id:"unsaved-new",createdAt:2,status,rootSessionId:old.id,previousSessionId:old.id};
 const unrelated:FocusSession={...old,id:"unrelated",goal:"Different intent"},open=vi.fn(),attach=vi.spyOn(focusStorage,"attachFocusSession");
 render(<PreferencesProvider><FocusWorkspace initialSession={current} availableSessions={[old,unrelated]} onOpenSession={open} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Result versions"}));
 const options=screen.getByRole("group",{name:"Choose or delete a version"});
 expect(within(options).getAllByRole("button")).toHaveLength(2);
 fireEvent.click(within(options).getAllByRole("button")[1]);await waitFor(()=>expect(open).toHaveBeenCalledWith(old.id));
 expect(attach).not.toHaveBeenCalled();expect(await(await getDatabase()).getAll("canvases")).toHaveLength(0);expect(generateFocusSession).not.toHaveBeenCalled();expect(current.status).toBe(status);
});






it("saves the whole-project name and keeps manual renaming aligned with exported session metadata",async()=>{
 const project={...session,mode:"work" as const,status:"ready" as const,title:"Knowledge workspace",wikiSuggestedTitle:"Suggested name"},onSaved=vi.fn();
 render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={onSaved}/></PreferencesProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Save project"}));
 await waitFor(()=>expect(onSaved).toHaveBeenCalled());
 const saved=onSaved.mock.calls.at(-1)![0] as FocusSession,db=await getDatabase();
 expect(await db.get("canvases",saved.canvasId!)).toMatchObject({name:project.title,title:project.title});
 fireEvent.click(screen.getByText("More",{exact:true}));fireEvent.click(screen.getByRole("button",{name:"Rename project"}));
 expect(screen.queryByRole("button",{name:/Use the project name/})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Use suggested name"}));
 expect(screen.getByRole("textbox",{name:"Project title"})).toHaveValue("Suggested name");
 expect(await db.get("canvases",saved.canvasId!)).toMatchObject({title:project.title});
 fireEvent.change(screen.getByRole("textbox",{name:"Project title"}),{target:{value:"My project name"}});fireEvent.click(screen.getByRole("button",{name:"Save"}));
 await waitFor(async()=>expect((await db.get("focusSessions",project.id))?.title).toBe("My project name"));
 expect((await db.get("focusSessions",project.id))?.wikiSuggestedTitle).toBeUndefined();
 expect(await db.get("canvases",saved.canvasId!)).toMatchObject({name:"My project name",title:"My project name"});
 expect(await within(screen.getByRole("navigation",{name:"Conversation chapters"})).findByRole("heading",{name:"My project name"})).toBeVisible();
 expect(generateFocusSession).not.toHaveBeenCalled();
});

it("keeps Rename project available before attaching a Wiki",async()=>{
 const project={...session,mode:"work" as const,status:"ready" as const};
 const onSaved=vi.fn();
 render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={onSaved}/></PreferencesProvider>);
 fireEvent.click(screen.getByRole("button",{name:"More"}));
 fireEvent.click(screen.getByRole("button",{name:"Rename project"}));
 expect(screen.getByRole("textbox",{name:"Project title"})).toHaveValue(project.title);
 fireEvent.change(screen.getByRole("textbox",{name:"Project title"}),{target:{value:"Renamed draft"}});
 fireEvent.click(screen.getByRole("button",{name:"Save"}));
 await waitFor(()=>expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({title:"Renamed draft"})));
 expect(screen.getByRole("button",{name:"Save project"})).toBeVisible();
});

it("shows the current project name when opening an older Wiki version",()=>{
 const canvas={id:"project",name:"New project name",title:"New project name",type:"topic" as const,createdAt:1,updatedAt:2};
 const older={...session,mode:"work" as const,status:"ready" as const,canvasId:canvas.id};
 render(<PreferencesProvider><FocusWorkspace initialSession={older} conversations={[conversation]} canvases={[canvas]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 expect(within(screen.getByRole("navigation",{name:"Conversation chapters"})).getByRole("heading",{name:canvas.title})).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"More"}));
 fireEvent.click(screen.getByRole("button",{name:"Rename project"}));
 expect(screen.getByRole("textbox",{name:"Project title"})).toHaveValue(canvas.title);
});

it("opens selected project file export directly from the toolbar without running a model",async()=>{
 const project={...session,mode:"work" as const,status:"ready" as const};
 render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 expect(screen.getByRole("button",{name:"Save project"})).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"Export"}));
 const dialog=await screen.findByRole("dialog",{name:"Export project files"});expect(within(dialog).getByRole("checkbox",{name:"Project Wiki"})).toBeChecked();fireEvent.click(within(dialog).getByRole("button",{name:"Choose Wiki chapters"}));expect(within(dialog).getByRole("checkbox",{name:"Understanding poles"})).toBeChecked();expect(within(dialog).queryByRole("checkbox",{name:"Project matters"})).toBeNull();expect(within(dialog).getByRole("combobox",{name:"File format"})).toHaveValue("md");expect(generateFocusSession).not.toHaveBeenCalled();
});


it("combines chapter understanding and revision with explicit multi-chapter selection and a separate preview",async()=>{
  const project:FocusSession={...session,mode:"work",status:"ready",locale:"en",sections:[session.sections[0],{...session.sections[0],id:"two",title:"Second chapter"},{...session.sections[0],id:"personal",title:"Personal chapter",userEdited:true}]};
  const revise=vi.spyOn(wikiRevisionAI,"reviseWikiChapters").mockImplementation(async base=>({...base,sections:base.sections.map(chapter=>chapter.id==="two"?{...chapter,body:"Revised second chapter"}:chapter)}));
  // Project Wikis reach instruction-based revision through a revision request, not the More menu.
  render(<PreferencesProvider><FocusWorkspace initialSession={project} revisionRequest={{instruction:"",nonce:1}} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
  fireEvent.click(screen.getByText("More",{exact:true}));
  expect(screen.queryByRole("button",{name:"Check knowledge"})).toBeNull();expect(screen.queryByRole("button",{name:"Update chapter understanding"})).toBeNull();expect(screen.queryByRole("button",{name:"Revise with AI"})).toBeNull();
  const dialog=screen.getByRole("dialog",{name:"Revise with AI"});
  fireEvent.change(within(dialog).getByRole("combobox",{name:"Revision scope"}),{target:{value:"selected"}});
  fireEvent.click(within(dialog).getByRole("button",{name:"Clear"}));
  fireEvent.click(within(dialog).getByRole("checkbox",{name:"Second chapter"}));
  expect(within(dialog).getByRole("checkbox",{name:/Personal chapter/})).toBeDisabled();expect(revise).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button",{name:/Preview revision/}));
  await screen.findByRole("button",{name:"Save and view"});
  expect(revise).toHaveBeenCalledOnce();expect(revise.mock.calls[0][1]).toEqual(["two"]);expect(generateFocusSession).not.toHaveBeenCalled();
  await waitFor(async()=>expect((await (await getDatabase()).getAll("focusSessions")).some(item=>item.previousSessionId===project.id)).toBe(true));
  const candidate=(await (await getDatabase()).getAll("focusSessions")).find(item=>item.previousSessionId===project.id);
  expect(candidate?.status).toBe("preview");expect(project.sections[1].body).toBe("Read the original explanation.");
});

describe("goal reading workflow", () => {
  it("does not expose the removed manual merge workflow or incomplete-directory notice",async()=>{
    const draft:FocusSession={...session,mode:"work",status:"preview",wikiDirectoryReview:{status:"pending",reason:"analysis"},sections:[session.sections[0],{...session.sections[0],id:"two",title:"Second chapter"},{...session.sections[0],id:"three",title:"Third chapter"}]};
    const before=structuredClone(draft);
    render(<PreferencesProvider><FocusWorkspace initialSession={draft} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
    expect(screen.getByRole("heading",{name:draft.title,level:1})).toBeVisible();
    expect(screen.queryByRole("button",{name:/Merge overlapping chapters|合并重复章节/})).toBeNull();
    expect(screen.queryByText(/Directory review is incomplete|目录去重尚未全部完成/)).toBeNull();
    expect(screen.getByRole("button",{name:"Save and view"})).toBeEnabled();
    expect(generateFocusSession).not.toHaveBeenCalled();expect(draft).toEqual(before);
  });
  it("keeps the document workspace free of independent project analyses, even with legacy state",async()=>{
 const project={...projectSession(),id:"s",sourceConversationIds:["c"],evidence:session.evidence,sections:session.sections};
 const before=structuredClone(project);
 render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 const navigation=screen.getByRole("navigation",{name:"Conversation chapters"});
 expect(within(navigation).getByRole("button",{name:"Document overview"})).toBeVisible();
 for(const name of ["Project conversation","Project items","Project evolution"])expect(within(navigation).queryByRole("button",{name})).toBeNull();
 expect(screen.queryByRole("textbox",{name:"Project question"})).toBeNull();expect(screen.queryByLabelText("More project features")).toBeNull();
 fireEvent.click(within(navigation).getByRole("button",{name:/Understanding poles/}));
 fireEvent.click(within(navigation).getByRole("button",{name:"Document overview"}));
 fireEvent.click(screen.getByRole("button",{name:"Export"}));await screen.findByRole("dialog",{name:"Export project files"});
 expect(generateFocusSession).not.toHaveBeenCalled();expect(project).toEqual(before);
});
  it("keeps chapter controls beside their own text and returns from the original sidebar without losing input or scroll", async () => {
    const draft:FocusSession={...session,mode:"work",status:"preview",sections:[session.sections[0],{...session.sections[0],id:"two",title:"Second chapter",body:"Other body"}]};
    const rewrite=vi.spyOn(wikiRewriteAI,"rewriteWikiSection");
    render(<PreferencesProvider><FocusWorkspace initialSession={draft} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
    const chapter=screen.getByRole("region",{name:"Understanding poles"});
    expect(screen.queryByText(/This preview does not run an additional evolution analysis/)).toBeNull();
    expect(await within(chapter).findByText("Read the original explanation.")).toBeVisible();
    // A clean preview: no preview tag, status tag or per-chapter sources button.
    expect(within(chapter).queryByRole("button",{name:"View sources"})).toBeNull();expect(screen.queryByText("Preview")).toBeNull();
    // The preview has no per-chapter review panel: claims are checked from their markers.
    expect(screen.queryByRole("button",{name:"Review chapter"})).toBeNull();
    expect(rewrite).not.toHaveBeenCalled();expect(generateFocusSession).not.toHaveBeenCalled();
  });
  it("shows a failed Save and view next to the button, retains the preview and retries without generation", async () => {
    const save = vi.spyOn(focusStorage, "saveFocusSession").mockRejectedValueOnce(new Error("Unavailable"));
    render(<PreferencesProvider><FocusWorkspace initialSession={{...session, mode:"work", status:"preview", sections:[{...session.sections[0], reviewIssue:"Review optional"}]}} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    const button = screen.getByRole("button", {name:"Save and view"}); expect(button).toBeEnabled(); fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your draft is retained");
    expect((await screen.findAllByText("Read the original explanation."))[0]).toBeVisible(); expect(screen.getByRole("button", {name:"Save and view"})).toBeEnabled();
    fireEvent.click(screen.getByRole("button", {name:"Save and view"}));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("button", {name:"Save and view"})).toBeNull());
    expect(generateFocusSession).not.toHaveBeenCalled();
  });

  it("keeps project More direct, removes duplicate source and chapter edit entries and keeps only conversation addition in source management",()=>{
    const project=projectSession(),before=structuredClone(project),onReturn=vi.fn();
    render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={onReturn} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
    fireEvent.click(screen.getByText("More",{exact:true}));const menu=screen.getByLabelText("Project actions");
    expect(within(menu).getByRole("button",{name:"Edit directory"})).toBeVisible();expect(within(menu).queryByRole("button",{name:"Check knowledge"})).toBeNull();
    for(const name of ["Edit content","Project sources","Chapter sources","Change project materials","Edit this section"]){expect(within(menu).queryByRole("button",{name})).toBeNull();}
    fireEvent.click(within(menu).getByRole("button",{name:"Edit directory"}));expect(menu.closest("details")).not.toHaveAttribute("open");
    const nav=screen.getByRole("navigation",{name:"Conversation chapters"});fireEvent.click(within(nav).getByRole("button",{name:"Done"}));
    fireEvent.click(within(nav).getByRole("tab",{name:/Sources/}));expect(within(nav).getAllByRole("button",{name:"Add conversations"})).toHaveLength(1);
    expect(within(nav).queryByRole("button",{name:"Reselect source scope"})).toBeNull();expect(onReturn).not.toHaveBeenCalled();
    expect(generateFocusSession).not.toHaveBeenCalled();expect(project).toEqual(before);
  });
  it("does not reopen a cached matters analysis when opening a saved document",async()=>{
 const project={...projectSession(),id:"s",sourceConversationIds:["c"],evidence:session.evidence,sections:session.sections};
 render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 expect(screen.getByRole("article",{name:"Document overview"})).toBeVisible();
 expect(screen.queryByRole("button",{name:"Use new plan"})).toBeNull();expect(screen.queryByRole("button",{name:"Organize project matters"})).toBeNull();
});
  it("offers no add-chapter button in the Wiki directory: chapters come from the conversations",()=>{
    const work:FocusSession={...structuredClone(session),mode:"work"};
    render(<PreferencesProvider><FocusWorkspace initialSession={work} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
    expect(screen.queryByRole("button",{name:"Add chapter"})).toBeNull();
  });
  it("opens the existing project exporter from the primary toolbar without context entry points or AI calls", async () => {
    const knowledge=contextKnowledge(),db=await getDatabase();
    await db.put("focusSessions",knowledge.session);
    render(<PreferencesProvider><FocusWorkspace initialSession={knowledge.session} conversations={knowledge.conversations} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
    expect(screen.queryByRole("button",{name:"Use project context"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Export"}));
    const dialog=await screen.findByRole("dialog",{name:"Export project files"});
    expect(within(dialog).getByRole("checkbox",{name:"Project Wiki"})).toBeChecked();
    expect(within(dialog).getByRole("button",{name:"Choose Wiki chapters"})).toHaveAttribute("aria-expanded","false");
    expect(within(dialog).getByRole("combobox",{name:"File format"})).toHaveValue("md");
    expect(within(dialog).queryByRole("textbox",{name:"Current task"})).toBeNull();
    fireEvent.click(within(dialog).getByRole("button",{name:"Close export"}));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(generateFocusSession).not.toHaveBeenCalled();expect(await db.get("focusSessions",knowledge.session.id)).toEqual(knowledge.session);
  });
  it("opens the existing exporter for an empty project without inventing Wiki chapters",async()=>{
    const empty:FocusSession={...session,mode:"work",sections:[],evidence:[],sourceConversationIds:[],notes:""};
    render(<PreferencesProvider><FocusWorkspace initialSession={empty} conversations={[]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button",{name:"Export"}));
    const dialog=await screen.findByRole("dialog",{name:"Export project files"});
    expect(within(dialog).getByRole("checkbox",{name:"Project Wiki"})).toBeChecked();
    expect(within(dialog).queryByRole("button",{name:"Choose Wiki chapters"})).toBeNull();
    expect(within(dialog).queryByRole("checkbox",{name:"Reference examples"})).toBeNull();
    expect(generateFocusSession).not.toHaveBeenCalled();
  });
  it("uses the shared document layout for review, with section navigation, source evidence and review progress", () => {
    const reading: FocusSession = { ...session, mode:"review" as const, sections: [{ ...session.sections[0], body: "## Original difficulty\n\nSource problem.\n\n## Conditions\n\nOnly when applicable.\n\n## Worked example\n\nStep by step." }] };
    render(<PreferencesProvider><FocusWorkspace initialSession={reading} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    const article = screen.getByRole("article", { name: "Review document" });
    expect(article).toHaveClass("wiki-document");
    expect(article.querySelector(".wiki-document-heading")).toHaveTextContent("Understanding poles");
    expect(within(article).queryByText("On this page")).toBeNull();
    expect(screen.getByRole("navigation",{name:"Chapter navigation"})).toBeVisible();
    expect(within(article).getByText("Original discussions")).toBeVisible();
    fireEvent.click(within(article).getByText("Original discussions"));
    expect(within(article).getByRole("button", { name: /Control discussion Why poles\? Read original/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Mark understood" })).toBeVisible();
    expect(document.querySelector(".reader-section-heading")).toBeNull();
    expect(generateFocusSession).not.toHaveBeenCalled();
  });
  it("starts new Wiki pages at top, preserves the current page position and keeps analysis in More", () => {
    const project: FocusSession = { ...projectSession(), projectState: undefined, sections: [
      { ...session.sections[0], title: "Project architecture" },
      { ...session.sections[0], id: "two", title: "Next actions" },
    ] };
    render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    const body = document.querySelector<HTMLElement>(".focus-reading-body")!;
    const navigation = within(screen.getByRole("navigation", { name: "Conversation chapters" }));
    body.scrollTop = 420;
    fireEvent.click(navigation.getByRole("button", { name: "1 Project architecture" }));
    expect(body.scrollTop).toBe(0);
    expect(screen.getByRole("article", { name: "Wiki document" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Chapter diagram" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Chapter guide" })).toBeNull();
    expect(screen.queryByText("My notes", { selector: ".chapter-personal-notes > summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Note" })).not.toBeInTheDocument();
    expect(screen.queryByText(/left to check/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark checked/ })).not.toBeInTheDocument();
    body.scrollTop = 680;
    expect(navigation.queryByRole("button", { name: "Uncategorized" })).toBeNull();
    fireEvent.click(navigation.getByRole("button", { name: "2 Next actions" }));
    expect(body.scrollTop).toBe(0);
    body.scrollTop = 140;
    expect(navigation.queryByRole("button", { name: "Uncategorized" })).toBeNull();
    fireEvent.click(navigation.getByRole("button", { name: "2 Next actions" }));
    expect(body.scrollTop).toBe(140);
    fireEvent.click(screen.getByText("More"));
    expect(screen.queryByRole("button", { name: "Edit content" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reanalyze architecture" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update chapter understanding" })).toBeNull();expect(screen.getByRole("button", { name: "Reorganize all chapters" })).toBeVisible();expect(screen.queryByRole("button", { name: "Revise with AI" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reconcile project plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create project plan" })).not.toBeInTheDocument();
    expect(generateFocusSession).not.toHaveBeenCalled();
  });
  it("omits the retired personal-notes block while preserving its data when editing the document description",async()=>{
 const project={...session,mode:"work" as const,detachedNotes:[{title:"Saved answer",text:"My retained answer",sources:[]}]};
 render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 expect(screen.queryByText("Saved personal notes")).toBeNull();expect(screen.queryByText("My retained answer")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:/Add description|Edit description/}));fireEvent.change(screen.getByLabelText("Project description"),{target:{value:"My personal document description"}});fireEvent.click(screen.getByRole("button",{name:"Save"}));
 await waitFor(async()=>expect((await(await getDatabase()).get("focusSessions","s"))?.projectMaintenance?.overview).toBe("My personal document description"));
 const saved=await(await getDatabase()).get("focusSessions","s");expect(saved?.notes).toBe(project.notes);expect(saved?.detachedNotes).toEqual(project.detachedNotes);expect(generateFocusSession).not.toHaveBeenCalled();
});
  it("continues through the saved chapter order without marking understanding or requesting AI", async () => {
    const reading: FocusSession = { ...session, activeSectionId: "two", sections: [
      { ...session.sections[0], id: "two", title: "Personal first step" },
      session.sections[0],
      { ...session.sections[0], id: "three", title: "Last step" },
    ] };
    render(<PreferencesProvider><FocusWorkspace initialSession={reading} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    const navigation = within(screen.getByRole("navigation", { name: "Conversation chapters" }));
    expect(screen.queryByRole("navigation", { name: "Chapter navigation" })).not.toBeInTheDocument();
    fireEvent.click(navigation.getByRole("button", { name: "2 Understanding poles" }));
    expect(screen.getByRole("heading", { name: "Understanding poles", level: 1 })).toBeVisible();
    fireEvent.click(navigation.getByRole("button", { name: "3 Last step" }));
    expect(screen.getByRole("heading", { name: "Last step", level: 1 })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Next chapter|Previous chapter/ })).not.toBeInTheDocument();
    fireEvent.click(navigation.getByRole("button", { name: "2 Understanding poles" }));
    await waitFor(async () => {
      const saved = await (await getDatabase()).get("focusSessions", session.id);
      expect(saved?.activeSectionId).toBe("one");
      expect(saved?.completedSectionIds).toEqual([]);
      expect(saved?.sections.map(item => item.id)).toEqual(["two", "one", "three"]);
    });
    expect(generateFocusSession).not.toHaveBeenCalled();
  });
  it("keeps review editing and sources in More without the removed handoff entry",()=>{
    render(<PreferencesProvider><FocusWorkspace initialSession={session} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
    const more=screen.getByText("More");fireEvent.click(more);
    expect(within(more.closest("details")!).getAllByRole("button").map(button=>button.textContent)).toEqual(["More","Edit content","Chapter sources"]);
    expect(screen.queryByRole("button",{name:"Handoff and export"})).toBeNull();
    expect(generateFocusSession).not.toHaveBeenCalled();
  });
  it("keeps a readable citation and keyboard return when conversation metadata is missing", async () => {
    render(<PreferencesProvider><FocusWorkspace initialSession={session} conversations={[]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    fireEvent.click(screen.getByText("More")); fireEvent.click(screen.getByRole("button", { name: "Chapter sources" }));
    fireEvent.click(await within(screen.getByRole("complementary", { name: "Chapter sources" })).findByRole("button", { name: /Why poles\?/ }));
    const context = screen.getByRole("complementary", { name: "Original question and context" });
    await within(context).findByText("Why poles?");
    expect(context).toHaveFocus();
    expect(within(context).getByRole("button", { name: "Focus question" })).toBeVisible();
    fireEvent.keyDown(context, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Project question" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Understanding poles", level: 1 })).toBeVisible();
    expect(generateFocusSession).not.toHaveBeenCalled();
  });
  it("saves the project without leaving a persistent success caption", async () => {
    const onSaved = vi.fn();
    render(<PreferencesProvider><FocusWorkspace initialSession={session} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={onSaved} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Save project" }));
    expect(screen.queryByRole("combobox", { name: "Space" })).not.toBeInTheDocument();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ canvasId: expect.any(String) })));
    expect(document.querySelector(".reader-save-status")).toBeNull();
    expect(screen.queryByText("Saved to project")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("More")); fireEvent.click(screen.getByRole("button", { name: "Edit content" }));
    expect(screen.getByRole("button", { name: "Rename project" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Back Edit content/ }));
    const saved = onSaved.mock.calls.at(-1)![0] as FocusSession;
    expect(await (await getDatabase()).get("canvases", saved.canvasId!)).toMatchObject({ name: conversation.title, sourceConversationIds: ["c"] });
    fireEvent.click(screen.getByRole("button", { name: "Reading overview" }));
    expect(document.querySelector(".focus-reader-location small")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit content" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename project" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Project title" }), { target: { value: "Saved review" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await (await getDatabase()).get("canvases", saved.canvasId!)).toMatchObject({ name: "Saved review", sourceConversationIds: ["c"] }));
    expect((await (await getDatabase()).get("focusSessions", session.id))?.canvasId).toBeTruthy();
    expect(generateFocusSession).not.toHaveBeenCalled();
    const db = await getDatabase();
    for (const canvas of await db.getAll("canvases")) if (canvas.name === "Saved review") await db.delete("canvases", canvas.id);
  });
  it("prevents duplicate project creation and retries a failed save without losing edits", async () => {
    const attach = vi.spyOn(focusStorage, "attachFocusSession").mockRejectedValueOnce(new Error("Storage unavailable"));
    const onSaved = vi.fn();
    render(<PreferencesProvider><FocusWorkspace initialSession={session} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={onSaved} /></PreferencesProvider>);
    const button = screen.getByRole("button", { name: "Save project" });
    fireEvent.click(button); fireEvent.click(button);
    await screen.findByText("Storage unavailable"); expect(attach).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Save project" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Retry generation" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save project" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByText("More")); fireEvent.click(screen.getByRole("button", { name: "Edit content" }));
    await screen.findByRole("button", { name: "Rename project" });
    expect(attach).toHaveBeenCalledTimes(2);
    expect(onSaved.mock.calls.at(-1)![0]).toMatchObject({ notes: session.notes, activeSectionId: session.activeSectionId });
  });
  it("captures the selected saved version before flushing pending reader writes", async () => {
    const open = vi.fn(), other = { ...session, id: "another-version", title: "Earlier version" };
    render(<PreferencesProvider><FocusWorkspace initialSession={session} projectSessions={[session, other]} onOpenSession={open} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Result versions" }));
    fireEvent.click(screen.getByRole("button", { name: /Switch to Earlier version/ }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(other.id));
  });
  it("opens a continued organization request as an editable revision without submitting AI",()=>{
 render(<PreferencesProvider><FocusWorkspace initialSession={{...session,mode:"work"}} revisionRequest={{instruction:"Combine the repeated sections",nonce:1}} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 const dialog=screen.getByRole("dialog",{name:"Revise with AI"});expect(within(dialog).getByRole("textbox")).toHaveValue("Combine the repeated sections");
 expect(generateFocusSession).not.toHaveBeenCalled();
});
  it("navigates document chapters without mounting an independent conversation",()=>{
 render(<PreferencesProvider><FocusWorkspace initialSession={{...session,mode:"work"}} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 fireEvent.click(within(screen.getByRole("navigation",{name:"Conversation chapters"})).getByRole("button",{name:/Understanding poles/}));
 expect(screen.getByRole("article",{name:"Wiki document"})).toBeVisible();expect(document.querySelector(".project-query-thread")).toBeNull();
 
});
  it("opens an empty project in the document workspace and saves its first Markdown chapter", async () => {
    const empty = await focusStorage.createLivingProject("Empty Wiki", "", "en", "handoff");
    const props = { initialSession: empty, conversations: [conversation], canvases: [], settingsRevision: 0, onClose: vi.fn(), onReturnToWorkbench: vi.fn(), onSettings: vi.fn(), onSaved: vi.fn() };
    const first = render(<PreferencesProvider><FocusWorkspace {...props} /></PreferencesProvider>);
    const overview = screen.getByRole("article", { name: "Document overview" });
    expect(within(overview).getByRole("heading", { name: "Empty Wiki" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Chapters" })).toBeVisible();
    expect(screen.getByRole("tab", { name: /Sources/ })).toBeVisible();
    expect(screen.queryByText("Reading path")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Understanding card" })).not.toBeInTheDocument();
    fireEvent.click(within(overview).getByRole("button", { name: "Organize sources" }));
    expect(screen.getByRole("dialog", { name: "Add conversations" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close source picker" }));
    fireEvent.click(within(overview).getByRole("button", { name: "New chapter" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Section title" }), { target: { value: "First chapter" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Section content" }), { target: { value: "**An explanation I wrote**" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await within(await screen.findByRole("article", { name: "Wiki document" })).findByText("An explanation I wrote")).toBeVisible();
    const db = await getDatabase();
    const saved = (await focusStorage.listFocusSessions()).find(item => item.previousSessionId === empty.id);
    expect(saved?.sections[0]).toMatchObject({ origin: "user", userEdited: true, title: "First chapter", body: "**An explanation I wrote**", evidenceIds: [] });
    expect((await db.get("focusSessions", empty.id))?.sections).toEqual([]);
    first.unmount();
    render(<PreferencesProvider><FocusWorkspace {...props} initialSession={saved} /></PreferencesProvider>);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Conversation chapters" })).getByRole("button", { name: /First chapter/ }));
    expect(await screen.findByText("An explanation I wrote")).toBeVisible();
    expect(generateFocusSession).not.toHaveBeenCalled();
  });
  it("generates the first material-based preview inside the same empty project", async () => {
    const empty = await focusStorage.createLivingProject("Manual title", "", "en", "handoff");
    const db = await getDatabase();
    await db.put("conversations", conversation);
    vi.mocked(generateFocusSession).mockResolvedValueOnce({ ...session, id: "first-preview", mode: "work", title: "Generated title" });
    const onReturnToWorkbench = vi.fn();
    render(<PreferencesProvider><FocusWorkspace initialSession={empty} conversations={[conversation]} canvases={[]} settingsRevision={0}
      onClose={vi.fn()} onReturnToWorkbench={onReturnToWorkbench} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Organize sources" }));
    const sources = screen.getByRole("dialog", { name: "Add conversations" });
    fireEvent.click(within(sources).getByRole("checkbox", { name: conversation.title }));
    fireEvent.click(within(sources).getByRole("button", { name: "Preview update" }));
    expect(await screen.findByRole("button", { name: "Save and view" })).toBeVisible();
    await waitFor(async () => expect(await db.get("focusSessions", "first-preview")).toMatchObject({
      title: empty.title, canvasId: empty.canvasId, previousSessionId: empty.id, sidecarWritingMode: "handoff", status: "preview",
    }));
    expect(vi.mocked(generateFocusSession).mock.calls[0]?.[9]?.initialWritingMode).toBe("handoff");
    expect(onReturnToWorkbench).not.toHaveBeenCalled();
  });
  it("persists failed generation with its confirmed scope and resumes the same run", async () => {
    vi.mocked(generateFocusSession).mockRejectedValueOnce(new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED")).mockResolvedValueOnce({ ...session, runId: "saved-run" });
    const request = { id: "saved-task", runId: "saved-run", goal: "Review poles", mode: "answer" as const, sourceIds: ["c"], scope: { kind: "all" as const, sourceConversationIds: ["c"] } };
    const props = { request, conversations: [conversation], canvases: [], settingsRevision: 0, onClose: vi.fn(), onReturnToWorkbench: vi.fn(), onSettings: vi.fn(), onSaved: vi.fn() };
    const first = render(<PreferencesProvider><FocusWorkspace {...props} /></PreferencesProvider>);
    await screen.findByRole("button", { name: "Retry" });
    const db = await getDatabase();
    expect(await db.get("focusGenerationTasks", request.id)).toMatchObject({ status: "failed", runId: request.runId, goal: request.goal, sourceIds: ["c"], scope: request.scope, errorCode: "PROVIDER_OUTPUT_TRUNCATED" });
    first.unmount();
    render(<PreferencesProvider><FocusWorkspace {...props} /></PreferencesProvider>);
    await waitFor(async () => expect(await db.get("focusGenerationTasks", request.id)).toMatchObject({ status: "preview", sessionId: "s" }));
    expect(vi.mocked(generateFocusSession).mock.calls.map(args => args[7])).toEqual(["saved-run", "saved-run"]);
    expect(vi.mocked(generateFocusSession).mock.calls[1][2].map(source => source.id)).toEqual(["c"]);
  });
  it("reads checked sources directly once without model location or another topic selection", async () => {
    let finish!: (value: FocusSession) => void;
    vi.mocked(generateFocusSession).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const scope: FocusScope = { kind: "all", sourceConversationIds: ["c"] };
    const onSaved = vi.fn();
    const header = render(<header><div data-testid="generation-slot" /></header>);
    const host = header.getByTestId("generation-slot");
    const workspace = render(<StrictMode><PreferencesProvider><FocusWorkspace headerProgressTarget={host} request={{ id: "full-reading", goal: "Review stability", mode: "work", sourceIds: ["c"], scope }} conversations={[conversation, { ...conversation, id: "unchecked" }]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={onSaved} /></PreferencesProvider></StrictMode>);
    await waitFor(() => expect(generateFocusSession).toHaveBeenCalledOnce());
    const call = vi.mocked(generateFocusSession).mock.calls[0];
    expect(call[2]).toEqual([conversation]); expect(call[9]).toMatchObject({ scope, onPartial:expect.any(Function) }); expect(call[1]).toBe("work");
    expect(screen.getByRole("status")).toHaveTextContent("Prepare");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    act(()=>call[9]?.onPartial?.({...session,mode:"work",sections:[{...session.sections[0],title:"Completed draft chapter",body:"Source-checked partial text."}]}));
    await waitFor(()=>expect(screen.getByRole("region",{name:"Chapter draft preview"})).toHaveTextContent("Source-checked partial text."));
    expect(host.querySelector(".focus-header-progress")).not.toBeNull();
    expect(workspace.container.querySelector(".focus-generation-panel")).toBeNull();
    expect(workspace.container.querySelector(".focus-generation-progress")).toBeNull();
    expect(host.querySelector("details")).not.toHaveAttribute("open");
    expect(screen.queryByRole("button",{name:"Save and view"})).toBeNull();expect(onSaved).not.toHaveBeenCalled();
    finish({ ...session, mode: "work", sections: [{ ...session.sections[0], body: "Opening paragraph.\n\n" + "Full chapter details. ".repeat(80) + "End of the complete chapter." }] });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ status: "preview", scope })));
    expect(host).toBeEmptyDOMElement();
    expect(screen.queryByText("Read chapter")).not.toBeInTheDocument();
    expect((await screen.findByText(/End of the complete chapter/)).closest("details")).toBeNull();
  });
  it("cancels from header progress and removes it when leaving the workspace", async () => {
    vi.mocked(generateFocusSession).mockImplementation(() => new Promise(() => {}));
    const header = render(<header><div data-testid="generation-slot" /></header>);
    const host = header.getByTestId("generation-slot"), back = vi.fn();
    const workspace = render(<PreferencesProvider><FocusWorkspace headerProgressTarget={host} request={{ id: "cancel-header", goal: "Project", mode: "work", sourceIds: ["c"], scope: { kind: "all", sourceConversationIds: ["c"] } }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={back} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    await waitFor(() => expect(generateFocusSession).toHaveBeenCalledOnce());
    const call = vi.mocked(generateFocusSession).mock.calls[0];
    act(() => call[9]?.onPartial?.({ ...session, mode: "work" }));
    fireEvent.click(within(host).getByText("Generating"));
    fireEvent.click(within(host).getByRole("button", { name: "Cancel" }));
    expect(call[4]?.aborted).toBe(true);
    expect(back).toHaveBeenCalledWith("Project", ["c"], "work");
    workspace.unmount();
    expect(host).toBeEmptyDOMElement();
  });
  it("retains generated text when saving fails and retries storage without another AI call", async () => {
    const save = vi.spyOn(focusStorage, "saveFocusSession").mockRejectedValueOnce(new Error("Disk unavailable"));
    vi.mocked(generateFocusSession).mockResolvedValue(session);
    render(<PreferencesProvider><FocusWorkspace request={{ id: "save-failure", goal: "Review poles", mode: "answer", sourceIds: ["c"], scope: { kind: "all", sourceConversationIds: ["c"] } }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    const retry = await screen.findByRole("button", { name: "Retry save" });
    expect(await screen.findByText("Read the original explanation.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry generation" })).not.toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(async () => expect((await (await getDatabase()).get("focusSessions", "s"))?.status).toBe("preview"));
    expect(save).toHaveBeenCalledTimes(2); expect(generateFocusSession).toHaveBeenCalledOnce();
  });
  it("starts a confirmed scope exactly once and shows the standalone progress panel", async () => {
    let finish!: (value: FocusSession) => void;
    vi.mocked(generateFocusSession).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const scope = { kind: "goal" as const, sourceConversationIds: ["c"], blocks: [{ conversationId: "c", title: "Poles", messageIds: ["m1"], messageSignatures: { m1: "confirmed" } }] };
    render(<StrictMode><PreferencesProvider><FocusWorkspace request={{ id: "inline-scope", goal: "Review poles", mode: "answer", sourceIds: ["c"], scope }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider></StrictMode>);
    expect(screen.queryByRole("button", { name: "Generate preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Generation progress" }).closest(".focus-generation-panel")).not.toBeNull();
    await waitFor(() => expect(generateFocusSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(generateFocusSession).mock.calls[0][9]?.scope).toEqual(scope);
    finish(session); await screen.findByRole("button", { name: "Confirm and start" });
  });
  it("cancels inline generation and restores the goal, selected sources and work purpose", async () => {
    vi.mocked(generateFocusSession).mockImplementation(() => new Promise(() => undefined));
    const onReturnToWorkbench = vi.fn();
    render(<PreferencesProvider><FocusWorkspace request={{ id: "inline-work", goal: "Project poles", mode: "work", sourceIds: ["c"], scope: { kind: "all", sourceConversationIds: ["c"] } }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={onReturnToWorkbench} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    await waitFor(() => expect(generateFocusSession).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(vi.mocked(generateFocusSession).mock.calls[0][4]?.aborted).toBe(true);
    expect(onReturnToWorkbench).toHaveBeenCalledWith("Project poles", ["c"], "work");
  });
  it("generates with the goal and purpose edited in the large composer", async () => {
    vi.mocked(generateFocusSession).mockResolvedValue(session);
    render(<PreferencesProvider><FocusWorkspace request={{ id: "editable-goal", goal: "Review poles", mode: "work", sourceIds: ["c"] }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    const button = await screen.findByRole("button", { name: "Generate preview" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "Today's goal" }), { target: { value: "Project poles" } });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByRole("button", { name: "Confirm and start" });
    expect(vi.mocked(generateFocusSession).mock.calls[0].slice(0, 2)).toEqual(["Project poles", "work"]);
  });
  it("retains edited goal and purpose when changing materials", () => {
    const onReturnToWorkbench = vi.fn();
    render(<PreferencesProvider><FocusWorkspace request={{ id: "change-materials", goal: "Review poles", mode: "work", sourceIds: ["c"] }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={onReturnToWorkbench} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "Today's goal" }), { target: { value: "Project poles" } });
    fireEvent.click(screen.getByRole("button", { name: "Change materials" }));
    expect(onReturnToWorkbench).toHaveBeenCalledWith("Project poles", ["c"], "work");
    expect(generateFocusSession).not.toHaveBeenCalled();
  });
  it("waits for discussion-scope confirmation before starting AI and retains that scope on retry", async () => {
    vi.mocked(generateFocusSession).mockRejectedValue(new Error("Retry me"));
    render(<PreferencesProvider><FocusWorkspace request={{ id: "scope-request", goal: "Review poles", mode: "answer", sourceIds: ["c"] }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    await screen.findByRole("button", { name: "Generate preview" });
    expect(generateFocusSession).not.toHaveBeenCalled();
    await confirmDiscussionScope();
    await screen.findByText("Retry me");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(generateFocusSession).toHaveBeenCalledTimes(2));
    expect(vi.mocked(generateFocusSession).mock.calls[1][9]?.scope).toEqual(vi.mocked(generateFocusSession).mock.calls[0][9]?.scope);
    // Small material defaults to all content; the confirmed scope is what retry reuses.
    expect(vi.mocked(generateFocusSession).mock.calls[1][9]?.scope?.kind).toBe("all");
  });
  it("opens a selected conversation inside a cross-review and returns without AI or losing the current chapter", async () => {
    const reading = { ...session, sourceConversationIds: ["c", "other"], sourceOutlines: [{ conversationId: "c", chapters: [{ id: "neutral-stage", title: "Original source stage", summary: "Why poles matter", messageIds: ["m1"] }] }] };
    render(<PreferencesProvider><FocusWorkspace initialSession={reading} conversations={[conversation, { ...conversation, id: "other", title: "Other source" }]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Conversation chapters" })).getByRole("button", { name: /Understanding poles/ }));
    const body = document.querySelector<HTMLElement>(".focus-reading-body")!;
    body.scrollTop = 420;
    expect(screen.queryByRole("button", { name: "Control discussion" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Sources/ }));
    fireEvent.click(screen.getByRole("button", { name: "Control discussion" }));
    const original = await screen.findByRole("region", { name: "Original discussion reader" });
    await within(original).findByText("Why poles?");
    expect(within(original).getByRole("button", { name: "Focus question" })).toBeVisible();
    // Simulate a browser focus/scroll adjustment behind the source overlay.
    body.scrollTop = 0;
    fireEvent.keyDown(original, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Project question" })).not.toBeInTheDocument();
    expect(body.scrollTop).toBe(420);
    expect(screen.getByRole("heading", { level: 1, name: "Understanding poles" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reading overview" }));
    expect(screen.queryByRole("textbox", { name: "Project question" })).not.toBeInTheDocument();
    expect(generateFocusSession).not.toHaveBeenCalled();
  });

  it("previews translation of the whole saved result without changing the original", async () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const original = { ...session, locale: "en" as const };
    await (await getDatabase()).put("focusSessions", original);
    vi.mocked(generateFocusSession).mockResolvedValue({ ...session, id: "translated", title: "中文阅读路线", locale: "zh-CN" });
    render(<PreferencesProvider><FocusWorkspace initialSession={original} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    fireEvent.click(screen.getByText("更多", { exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "调整内容" }));
    fireEvent.click(screen.getByRole("button", { name: "转换为中文 · 先预览" }));
    await screen.findByRole("button", { name: "确认并开始" });
    const call = vi.mocked(generateFocusSession).mock.calls[0];
    expect(call[3]).toBe("zh-CN");
    expect(call[5]?.sectionId).toBeUndefined();
    expect(call[5]?.instruction).toContain("保留原有事实、章节顺序、来源引用及用户的修改");
    expect(await (await getDatabase()).get("focusSessions", "s")).toEqual(original);
    await waitFor(async () => expect((await (await getDatabase()).get("focusSessions", "translated"))?.status).toBe("preview"));
  });
  it("keeps generation focused on one progress display and cancels without changing sources", async () => {
    vi.mocked(generateFocusSession).mockImplementation(() => new Promise(() => undefined));
    const onReturnToWorkbench = vi.fn();
    render(<PreferencesProvider><FocusWorkspace request={{ id: "pending-local", goal: "Review", mode: "answer", sourceIds: ["c"] }} conversations={[conversation, { ...conversation, id: "other", title: "Unselected source" }]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={onReturnToWorkbench} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    await confirmDiscussionScope();
    await waitFor(() => expect(generateFocusSession).toHaveBeenCalledOnce());
    expect(screen.queryByText("Read selected originals while AI works")).not.toBeInTheDocument();
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Generation log" })).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(vi.mocked(generateFocusSession).mock.calls[0][4]?.aborted).toBe(true);
    expect(onReturnToWorkbench).toHaveBeenCalledWith("Review", ["c"], "answer");
    expect(generateFocusSession).toHaveBeenCalledOnce();
  });
  it("keeps a goal started inside a space attached to that space after review", async () => {
    vi.mocked(generateFocusSession).mockResolvedValue(session);
    const saved = vi.fn();
    render(<PreferencesProvider><FocusWorkspace request={{ id: "space-request", goal: "Review poles", mode: "answer", sourceIds: ["c"], scopeCanvasId: "space" }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={saved} /></PreferencesProvider>);
    await confirmDiscussionScope();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and start" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ canvasId: "space", sourceConversationIds: ["c"] })));
  });
  it("opens retired review content without any generation controls", async () => {
    render(<PreferencesProvider><FocusWorkspace initialSession={{...session,mode:"review"}} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    expect(screen.getByRole("article", {name:"Review document"})).toHaveTextContent(session.sections[0].body);
    fireEvent.click(screen.getByText("More"));
    fireEvent.click(screen.getByRole("button", {name:"Edit content"}));
    expect(screen.queryByRole("button",{name:"Revise with AI"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Explain section"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Analyze all sources"})).not.toBeInTheDocument();
    expect(generateFocusSession).not.toHaveBeenCalled();
  });

  it("shows receiving progress without presenting partial output as a confirmable preview", async () => {
    vi.mocked(generateFocusSession).mockImplementation(async (...args) => {
      args[8]?.(0, 1, "synthesis");
      args[6]?.("waiting_model", { streaming: true, firstTokenMs: 800, receivedCharacters: 42 });
      const runId = args[7]!;
      const active = startWorkbenchRequest(runId, { operationId: "live", operation: "wiki:writing", modelId: "fixture", attempt: 1, startedAt: Date.now() });
      Object.assign(active!, { excerpt: "<private-draft>", outputLength: 42 });
      await recordAIUsage({ id: "log-fixture", runId, createdAt: Date.now(), taskType: "other", operation: "wiki:topic-plan", providerId: "openai", modelId: "fixture", conversationIds: ["private-conversation"], inputTokens: 20, outputTokens: 0, tokenSource: "provider", status: "failed", attempt: 1, errorCode: "PROVIDER_TIMEOUT", timeoutStage: "first_token" });
      return new Promise(() => undefined);
    });
    const onSaved = vi.fn();
    render(<PreferencesProvider><FocusWorkspace request={{ id: "stream-progress", goal: "Review poles", mode: "answer", sourceIds: ["c"] }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={onSaved} /></PreferencesProvider>);
    await confirmDiscussionScope();
    expect(await screen.findByText("Compose answer", { exact: true, selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText(/Receiving model output/)).not.toBeInTheDocument();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Generation log" }));
      const log = screen.getByRole("dialog", { name: "Generation log" });
      expect(within(log).getByText("Receiving · 42 chars")).toBeVisible();
      expect(await within(log).findByText("PROVIDER_TIMEOUT")).toBeVisible();
      fireEvent.click(within(log).getByText("View model output excerpt"));
      expect(within(log).getByText(/<private-draft>/).tagName).toBe("PRE");
      fireEvent.click(within(log).getByRole("button", { name: "Copy diagnostics" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
      const copied = writeText.mock.calls[0][0];
      expect(copied).toContain("PROVIDER_TIMEOUT");
      expect(copied).not.toMatch(/private-draft|private-conversation/);
      fireEvent.click(within(log).getByRole("button", { name: "Close log" }));
    } finally { Reflect.deleteProperty(navigator, "clipboard"); }
    expect(screen.queryByRole("button", { name: "Confirm and start" })).not.toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("exposes the timeout code and provider request ID without applying a failed preview", async () => {
    vi.mocked(generateFocusSession).mockRejectedValue(new AIProviderResponseError("PROVIDER_TIMEOUT", "timed-request"));
    const onSaved = vi.fn();
    render(<PreferencesProvider><FocusWorkspace request={{ id: "timeout-diagnostic", goal: "Review poles", mode: "answer", sourceIds: ["c"] }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={onSaved} /></PreferencesProvider>);
    await confirmDiscussionScope();
    await screen.findByText("Diagnostic details");
    expect(screen.getByText("PROVIDER_TIMEOUT")).toBeInTheDocument();
    expect(screen.getByText("timed-request")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
  it("keeps the failed task ID available for diagnosis without applying a preview", async () => {
    vi.mocked(generateFocusSession).mockRejectedValue(new DemoApiError("TASK_NOT_FOUND", 404, undefined, "b".repeat(64)));
    const onSaved = vi.fn();
    render(<PreferencesProvider><FocusWorkspace request={{ id: "diagnostic-request", goal: "Review poles", mode: "answer", sourceIds: ["c"] }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={onSaved} /></PreferencesProvider>);
    await confirmDiscussionScope();
    const summary = await screen.findByText("Diagnostic details");
    fireEvent.click(summary);
    expect(screen.getByText("TASK_NOT_FOUND")).toBeInTheDocument();
    expect(screen.getByText("b".repeat(64))).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows a precise subtopic metadata reason while retaining diagnostics and leaving the failed draft unsaved", async () => {
    const error = new AIProviderValidationError("wiki_directory_subtopic_boundary");
    error.message = "Wiki chapter 3, subtopic 2: title exceeds 100 characters. Completed analysis is retained; the incomplete directory was not saved.";
    error.fieldPaths = ["pages[2].subtopics[1].title"];
    vi.mocked(generateFocusSession).mockRejectedValue(error);
    const onSaved = vi.fn();
    render(<PreferencesProvider><FocusWorkspace request={{ id: "wiki-subtopic-metadata", goal: "Review poles", mode: "answer", sourceIds: ["c"] }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={onSaved} /></PreferencesProvider>);
    await confirmDiscussionScope();
    expect(await screen.findByText("Wiki chapter 3, subtopic 2: title exceeds 100 characters.")).toBeVisible();
    expect(screen.getByText("Diagnostic details").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText(/Validation fields: pages\[2\].subtopics\[1\].title/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
  it("shows safe Wiki validation locations and retained reading progress without saving a failed directory", async () => {
    const error = new AIProviderValidationError("wiki_directory_subtopic_identity");
    error.message = "Wiki ownership validation failed: duplicated assignment. Completed analysis is retained.";
    error.fieldPaths = ["pages[0].subtopics[1].sectionIds", "PRIVATE SOURCE CONTENT", "https://private.invalid"];
    vi.mocked(generateFocusSession).mockImplementation(async (...args) => {
      args[8]?.(4, 4, "reading", { completed: 4, total: 4, stage: "reading", final: false, round: 1, completedSourceIds:["c"], totalSources: 1, processedSegments: 489, totalSegments: 489, elapsedMs: 1 });
      throw error;
    });
    const onSaved = vi.fn();
    render(<PreferencesProvider><FocusWorkspace request={{ id: "wiki-validation", goal: "Review poles", mode: "answer", sourceIds: ["c"] }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={onSaved} /></PreferencesProvider>);
    await confirmDiscussionScope();
    await screen.findByText("Diagnostic details");
    expect(screen.getByText(/Material analysis complete \(489 passages\)/)).toBeInTheDocument();
    expect(screen.getByText("The outline needs another pass to check chapters and source assignments.")).toBeVisible();
    expect(screen.getByText(error.message)).not.toBeVisible();
    expect(screen.getByText("Diagnostic details").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText(/Validation fields: pages\[0\].subtopics\[1\].sectionIds/)).toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE SOURCE CONTENT|https:\/\/private.invalid/)).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows live source and batch progress instead of a static onboarding checklist", async () => {
    await (await getDatabase()).put("messages", { id: "other-m", conversationId: "other", messageIndex: 0, role: "user", content: "Review poles", preview: "", contentHash: "other", createdAt: 1, updatedAt: 1 });
    vi.mocked(generateFocusSession).mockImplementation(async (...args) => {
      args[8]?.(2, 4, "reading", { completed: 2, total: 4, stage: "reading", final: false, round: 1, completedSourceIds: ["c"], totalSources: 2, processedSegments: 8, totalSegments: 16, elapsedMs: 60000, remainingMs: 60000 });
      return new Promise(() => undefined);
    });
    render(<PreferencesProvider><FocusWorkspace request={{ id: "generating-request", goal: "Review poles", mode: "answer", sourceIds: ["c", "other"] }} conversations={[conversation, { ...conversation, id: "other" }]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    await confirmDiscussionScope();
    const progress = await screen.findByRole("region", { name: "Generation progress" });
    await waitFor(() => expect(progress).toHaveTextContent("8/16 passages · 1/2 sources"));
    expect(progress).toHaveTextContent("2/4 batches");
    expect(progress).not.toHaveTextContent("~60s left");
    expect(progress).toHaveTextContent("Round 1 · 2/4 batches");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(progress.querySelectorAll("li")).toHaveLength(0);
    expect(progress.querySelector("details")).toBeNull();
    expect(progress).not.toHaveTextContent("steps remaining");
    expect(progress.querySelector("progress")).toHaveAttribute("value", "8");
  });

  it("uses sources confirmed on the Workbench without showing a second source picker", async () => {
    vi.mocked(generateFocusSession).mockResolvedValue(session);
    render(<PreferencesProvider><FocusWorkspace request={{ id: "workbench-request", goal: "Review poles", mode: "answer", sourceIds: ["c"] }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    await confirmDiscussionScope();
    expect(screen.queryByRole("heading", { name: "Choose sources" })).not.toBeInTheDocument();
    await screen.findByRole("button", { name: "Confirm and start" });
    expect(screen.queryByRole("region", { name: "AI work checklist" })).not.toBeInTheDocument();
    expect(generateFocusSession).toHaveBeenCalledWith("Review poles", "answer", [conversation], "en", expect.any(AbortSignal), undefined, expect.any(Function), "workbench-request", expect.any(Function), expect.objectContaining({ scope: expect.objectContaining({ kind: "all" }) }));
  });

  it("keeps preview headings concise and preserves complete coverage after acceptance", async () => {
    vi.mocked(generateFocusSession).mockResolvedValue({ ...session, coverage: { method: "full_batched", sourceCount: 1, processedSegments: 22, totalSegments: 22 } });
    render(<PreferencesProvider><FocusWorkspace request={{ id: "coverage-request", goal: "Review poles", mode: "answer", sourceIds: ["c"] }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    await confirmDiscussionScope();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and start" }));
    fireEvent.click(await within(await screen.findByRole("navigation", { name: "Conversation chapters" })).findByRole("button", { name: /Understanding poles/ }));
    expect(document.querySelector(".reader-source-meta")).toBeNull();
    fireEvent.click(screen.getByText("More")); fireEvent.click(screen.getByRole("button", { name: "Chapter sources" }));
    expect(screen.getByRole("complementary", { name: "Chapter sources" })).not.toHaveTextContent("Only confirmed discussions and their context were analyzed.");
  });

  it("returns to the Workbench with the current goal and sources when preview sources need changes", async () => {
    vi.mocked(generateFocusSession).mockResolvedValue(session);
    const onReturnToWorkbench = vi.fn();
    render(<PreferencesProvider><FocusWorkspace request={{ id: "adjust-workbench-request", goal: "Review poles", mode: "answer", sourceIds: ["c"] }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={onReturnToWorkbench} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    await confirmDiscussionScope();
    await screen.findByRole("button", { name: "Confirm and start" });
    fireEvent.click(screen.getByRole("button", { name: "Change sources" }));
    expect(onReturnToWorkbench).toHaveBeenCalledWith("Review poles", ["c"], "answer");
    expect(screen.queryByRole("heading", { name: "Choose sources" })).not.toBeInTheDocument();
  });

  it("shows a centered retry card when Workbench generation fails", async () => {
    vi.mocked(generateFocusSession).mockRejectedValue(new Error("Provider unavailable"));
    const onClose = vi.fn();
    render(<PreferencesProvider><FocusWorkspace request={{ id: "failed-workbench-request", goal: "Review poles", mode: "answer", sourceIds: ["c"] }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={onClose} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    await confirmDiscussionScope();
    await screen.findByText("Provider unavailable");
    expect(screen.queryByRole("heading", { name: "Choose sources" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveClass("focus-error-card");
    expect(screen.getByRole("heading", { name: "Generation paused" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to Workbench" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(generateFocusSession).toHaveBeenCalledTimes(2));
    expect(onClose).not.toHaveBeenCalled();
  });



  it("keeps work sources collapsed and persists edited work text", async () => {
    const work: FocusSession = { ...session, mode: "work", sections: [{ ...session.sections[0], kind: "finding" }] };
    render(<PreferencesProvider><FocusWorkspace initialSession={work} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Conversation chapters" })).getByRole("button", { name: "1 Understanding poles" }));
    expect(screen.getByRole("article", { name: "Wiki document" })).toBeVisible();
    expect(screen.queryByRole("complementary", { name: "Chapter sources" })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("article", { name: "Wiki document" })).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Section content" }), { target: { value: "My reviewed project brief" } });
    // A draft is not the project's text until it is saved.
    expect((await (await getDatabase()).get("focusSessions", "s"))?.sections[0].body).not.toBe("My reviewed project brief");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await (await getDatabase()).get("focusSessions", "s"))?.sections[0].body).toBe("My reviewed project brief"));
    expect((await (await getDatabase()).get("focusSessions", "s"))?.sections[0].userEdited).toBe(true);
    expect(screen.queryByRole("textbox", { name: "Section content" })).not.toBeInTheDocument();
  });

  it("returns from Reader to the same Workbench source flow when changing sources", () => {
    const onReturnToWorkbench = vi.fn();
    render(<PreferencesProvider><FocusWorkspace initialSession={session} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={onReturnToWorkbench} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    fireEvent.click(screen.getByText("More")); fireEvent.click(screen.getByRole("button", { name: "Edit content" })); fireEvent.click(screen.getByText("Check and update"));
    fireEvent.click(screen.getByRole("button", { name: "Change project materials" }));
    expect(onReturnToWorkbench).toHaveBeenCalledWith("Review poles", ["c"], "answer");
    expect(screen.queryByRole("heading", { name: "Choose sources" })).not.toBeInTheDocument();
  });

  it("saves an accepted revision separately instead of overwriting the original", async () => {
    await (await getDatabase()).put("focusSessions", session);
    vi.mocked(generateFocusSession).mockResolvedValue({ ...session, id: "revision", title: "Short review", notes: "" });
    render(<PreferencesProvider><FocusWorkspace initialSession={session} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    fireEvent.click(screen.getByText("More")); fireEvent.click(screen.getByRole("button", { name: "Edit content" })); fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Revision instructions" }), { target: { value: "Shorten this" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview revision" }));
    await screen.findByRole("button", { name: "Confirm and start" });
    await waitFor(async () => expect((await (await getDatabase()).get("focusSessions", "revision"))?.status).toBe("preview"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and start" }));
    await waitFor(async () => expect((await (await getDatabase()).get("focusSessions", "revision"))?.notes).toBe("Keep my edits"));
    expect(await (await getDatabase()).get("focusSessions", "s")).toEqual(session);
  });
});

describe("chapter records and update preview", () => {
  it("does not overwrite a stale review until its update is previewed and accepted", async () => {
    const { sourceMessageSignature } = await import("../../shared/source-signature");
    const old = { ...session, sourceSignatures: { c: { m1: sourceMessageSignature("Old question") } }, coverage: { method: "full_batched" as const, sourceCount: 1, processedSegments: 1, totalSegments: 1 } };
    await (await getDatabase()).put("focusSessions", old);
    vi.mocked(generateFocusSession).mockResolvedValue({ ...session, id: "updated", title: "Updated reading" });
    render(<PreferencesProvider><FocusWorkspace initialSession={old} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    const update = await screen.findByRole("button", { name: "Preview update" });
    expect(generateFocusSession).not.toHaveBeenCalled();
    fireEvent.click(update);
    await screen.findByRole("button", { name: "Confirm and start" });
    expect(vi.mocked(generateFocusSession).mock.calls[0][9]).toEqual({ complete: true });
    expect(await (await getDatabase()).get("focusSessions", "s")).toEqual(old);
    await waitFor(async () => expect((await (await getDatabase()).get("focusSessions", "updated"))?.status).toBe("preview"));
  });
});



it("reopens chapter selection after a local revision budget error without retrying whole-project generation",async()=>{
 const project:FocusSession={...session,mode:"work",status:"ready",locale:"en",sections:[session.sections[0],{...session.sections[0],id:"two",title:"Smaller chapter"}]};
 const failure=new wikiRewriteAI.WikiRewriteBudgetError("one",project.sections[0].title,11000,8000,1,false);
 const revise=vi.spyOn(wikiRevisionAI,"reviseWikiChapters").mockRejectedValueOnce(failure).mockImplementationOnce(async base=>({...base,sections:base.sections.map(chapter=>chapter.id==="two"?{...chapter,body:"Improved small chapter"}:chapter)}));
 const settings=vi.fn();
 render(<PreferencesProvider><FocusWorkspace initialSession={project} revisionRequest={{instruction:"",nonce:1}} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={settings} onSaved={vi.fn()}/></PreferencesProvider>);
 fireEvent.click(screen.getByRole("button",{name:/Preview revision/}));
 const notice=await screen.findByRole("alert",{name:"This chapter needs a smaller revision"});
 expect(within(notice).queryByRole("button",{name:"Retry generation"})).toBeNull();expect(within(notice).queryByRole("button",{name:"AI settings"})).toBeNull();
 fireEvent.click(within(notice).getByText("Why this happened"));expect(within(notice).getByText(/11,000/)).toBeVisible();
 fireEvent.click(within(notice).getByRole("button",{name:"Choose chapters"}));
 const dialog=screen.getByRole("dialog",{name:"Revise with AI"});expect(within(dialog).getByRole("checkbox",{name:"Understanding poles"})).not.toBeChecked();expect(within(dialog).getByRole("checkbox",{name:"Smaller chapter"})).toBeChecked();
 fireEvent.click(within(dialog).getByRole("button",{name:/Preview revision/}));await screen.findByRole("button",{name:"Save and view"});
 expect(revise.mock.calls[1][1]).toEqual(["two"]);expect(generateFocusSession).not.toHaveBeenCalled();expect(settings).not.toHaveBeenCalled();
});

it("reorganizes a project Wiki from its saved sources into a preview, keeping the saved Wiki and user edits",async()=>{
 const edited={...session.sections[0],id:"mine",title:"My chapter",body:"My own words.",userEdited:true};
 const savedLedger:NonNullable<FocusSession["wikiKnowledge"]>={version:1,generatedAt:1,status:"complete",materials:1,batches:[{sourceIds:["source-1"],signature:"test-signature",status:"ok",units:[],rejected:{}}]};
 const project:FocusSession={...projectSession(),id:"s",status:"ready",locale:"en",sourceConversationIds:["c"],evidence:session.evidence,sections:[...session.sections,edited],wikiScopeReview:{version:1,goal:"",includeKeys:["k-in"],excludeKeys:["k-out"],materials:[]},wikiKnowledge:savedLedger,
  sourceSignatures:{c:{m1:sourceMessageSignature("Why poles?")}}};
 const db=await getDatabase();
 await db.put("focusSessions",project);
 await db.put("conversations",conversation);
 const action=vi.spyOn(focusUpdates,"generateFocusUpdate").mockResolvedValue({...project,id:"reorganized",sections:[{...session.sections[0],body:"Rewritten."},edited]});
 vi.spyOn(window,"confirm").mockReturnValue(true);
 render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 fireEvent.click(screen.getByText("More",{exact:true}));fireEvent.click(screen.getByRole("button",{name:"Reorganize all chapters"}));
 fireEvent.click(screen.getByRole("button",{name:"Start reorganizing"}));
 await waitFor(async()=>expect((await db.get("focusSessions","reorganized"))?.status).toBe("preview"));
 expect(await screen.findByRole("region",{name:"Reorganization summary"})).toBeVisible();
 expect(document.querySelectorAll(".update-preview-summary")).toHaveLength(1);
 expect(action.mock.calls[0]?.[0].wikiKnowledge).toEqual(savedLedger);
 expect(action.mock.calls[0]?.[0].wikiScopeReview).toEqual(project.wikiScopeReview);
 expect(action.mock.calls[0]?.[1].map(source=>source.id)).toEqual(["c"]);
 expect(action.mock.calls[0]?.[7]).toMatchObject({reorganize:true});
 expect(generateFocusSession).not.toHaveBeenCalled();
 expect(await db.get("focusSessions","s")).toEqual(project);
 const preview=await db.get("focusSessions","reorganized");
 expect(preview?.sections.find(chapter=>chapter.title==="My chapter")?.body).toBe("My own words.");
 fireEvent.click(screen.getByRole("button",{name:"Compare with saved document"}));
 const comparison=screen.getByRole("dialog",{name:"Compare with saved document"});
 expect(within(comparison).getByText("Rewritten.")).toBeVisible();
 expect(within(comparison).getAllByText("Proposed").some(node=>node.tagName==="STRONG")).toBe(true);
});
