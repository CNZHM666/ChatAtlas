// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import { saveConversation } from "../storage/conversations";
import { saveConversationCapture } from "../storage/messages";
import {makeContextHandoff,saveContextHandoff,readContextHandoff} from "../storage/context-handoff";
import type { AtlasMessage } from "../shared/messages";
import type { ConversationMessage, ImportJob } from "../shared/types";
import type { FocusSession } from "../shared/focus-session";
import type { GoalRequest } from "./components/FocusWorkspace";
import { PreferencesProvider } from "./preferences";
import App from "./App";
import { planHomeTask } from "../ai/home-task";

vi.mock("../ai/home-task", async importOriginal => ({ ...await importOriginal<typeof import("../ai/home-task")>(), planHomeTask: vi.fn(async () => ({ action: "project", queries: [], allSources: true })) }));

vi.mock("./views/ConversationCanvas", () => ({ ConversationCanvas: ({ onGraphVisibilityChange }: { onGraphVisibilityChange?: (visible: boolean) => void }) => {
  useEffect(() => { onGraphVisibilityChange?.(true); }, [onGraphVisibilityChange]);
  return <div data-testid="conversation-map" />;
} }));
vi.mock("./components/OriginalReader", () => ({ OriginalReader: ({ messages, reviews, onOrganize }: { messages: ConversationMessage[]; reviews?: FocusSession[]; onOrganize?: () => void }) => <div data-testid="conversation-reader" data-review-ids={reviews?.map(review => review.id).join(",")}>{messages.map((message) => message.content).join(" ")}{onOrganize ? <button onClick={onOrganize}>Organize on Workbench</button> : null}</div> }));
vi.mock("./components/FocusWorkspace", () => ({ FocusWorkspace: ({ request, initialSession, revisionRequest, projectSessions, onClose, searchTarget }: { request?: GoalRequest; initialSession?: FocusSession; revisionRequest?: {instruction: string}; projectSessions?: FocusSession[]; onClose: () => void; searchTarget?: { sectionId: string } }) => <div data-testid="submitted-focus" data-home-revision={revisionRequest?.instruction} data-project-sessions={projectSessions?.map(session => session.id).join(",")} data-reading-session={initialSession?.id} data-active-section={searchTarget?.sectionId ?? initialSession?.activeSectionId}>{JSON.stringify(request)}{initialSession ? <><h1>{initialSession.title}</h1><button onClick={onClose}>Back to Workbench</button></> : null}</div> }));
vi.mock("./components/FlowProvider", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

beforeEach(async () => {
  localStorage.setItem("atlas-locale", "en");
  localStorage.removeItem("atlas-workbench-selected-conversations");
  localStorage.removeItem("atlas-workbench-project-sources");
  window.history.replaceState({}, "", "/");
  const db = await getDatabase();
  await db.clear("conversations");
  await db.clear("messages");
  await db.clear("importJobs");
  await db.clear("focusSessions");
  await db.clear("focusGenerationTasks");
  await db.clear("aiUsageEvents");
  await db.put("aiSettings", { id: "ai-settings", mode: "byok", provider: "openai", baseUrl: "https://fixture.example/v1", apiKey: "fixture", model: "fixture", updatedAt: 1 });
  await saveConversation({ id: "entry-one", platform: "chatgpt", title: "Map entry test", url: "https://chatgpt.com/c/entry-one", updatedAt: Date.now(), messageCount: 1, importState: "complete", hydrationState: "hydrated" });
});

it("keeps sync selections out of the composer until explicitly used, and clears materials independently", async () => {
  localStorage.setItem("atlas-workbench-selected-conversations", JSON.stringify(["entry-one"]));
  render(<PreferencesProvider><App /></PreferencesProvider>);
  const input = await screen.findByRole("textbox", { name: "Search or organize past conversations" });
  fireEvent.focus(input);
  expect(screen.queryByRole("group", { name: "Selected materials" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Source materials and sync" }));
  fireEvent.click(screen.getByRole("button", { name: "Use 1 for this task" }));
  expect(screen.getByRole("group", { name: "Selected materials" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Clear materials" }));
  fireEvent.focus(input);
  expect(screen.queryByRole("group", { name: "Selected materials" })).toBeNull();
  expect(JSON.parse(localStorage.getItem("atlas-workbench-selected-conversations")!)).toEqual(["entry-one"]);
  expect(JSON.parse(localStorage.getItem("atlas-workbench-project-sources")!)).toEqual([]);
});

it("supplies earlier versions for a result that has never been attached to a project",async()=>{
 const db=await getDatabase();
 const root:FocusSession={id:"unsaved-root",title:"Hardware notes",mode:"work",goal:"Hardware",sourceConversationIds:["entry-one"],sections:[],evidence:[],activeSectionId:"",completedSectionIds:[],notes:"",createdAt:1,updatedAt:1,status:"ready"};
 await db.put("focusSessions",root);await db.put("focusSessions",{...root,id:"unsaved-next",rootSessionId:root.id,previousSessionId:root.id,status:"preview",createdAt:2,updatedAt:2});
 await db.put("focusSessions",{...root,id:"unrelated-unsaved",goal:"Other project"});
 window.history.replaceState({},"","/#review=unsaved-next");render(<PreferencesProvider><App/></PreferencesProvider>);
 const workspace=await screen.findByTestId("submitted-focus");
 await waitFor(()=>expect(workspace).toHaveAttribute("data-reading-session","unsaved-next"));
 expect(workspace).toHaveAttribute("data-project-sessions","unsaved-next,unsaved-root");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("conversation entry", () => {
  it("restores a sidecar handoff without analysis and submits its exact message scope only after confirmation",async()=>{
    const records:Record<string,unknown>={};
    vi.stubGlobal("chrome",{storage:{session:{get:async(id:string)=>({[id]:records[id]}),set:async(value:Record<string,unknown>)=>Object.assign(records,value),remove:async(id:string)=>{delete records[id];}}},runtime:{id:"test-extension",sendMessage:vi.fn().mockResolvedValue(undefined),onMessage:{addListener:vi.fn(),removeListener:vi.fn()}}});
    const db=await getDatabase(),source=(await db.get("conversations","entry-one"))!;
    const message:ConversationMessage={id:"exact-handoff-message",conversationId:source.id,role:"user",content:"只整理当前选定的问题",preview:"",messageIndex:0,contentHash:"",createdAt:1,updatedAt:1};await db.put("messages",message);
    const request=makeContextHandoff("Continue validator work",[{conversation:source,messages:[message]}]);await saveContextHandoff(request);window.history.replaceState({},"",`/#prepare=${request.id}`);
    render(<PreferencesProvider><App/></PreferencesProvider>);
    expect(await screen.findByRole("textbox",{name:"Goal"})).toHaveValue("Continue validator work");expect(screen.queryByTestId("submitted-focus")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Analyze with AI"}));
    const actual=JSON.parse((await screen.findByTestId("submitted-focus")).textContent!);expect(actual.goal).toBe(request.task);expect(actual.sourceIds).toEqual([source.id]);expect(actual.scope).toEqual(request.scope);expect(await readContextHandoff(request.id)).toBeUndefined();
  });
  it("only submits priority sync explicitly, without automatically syncing when source checkboxes change", async () => {
    const db = await getDatabase();
    await db.put("conversations", { ...(await db.get("conversations", "entry-one"))!, importState: "discovered", hydrationState: "queued", messageCount: null });
    const job: ImportJob = { id: "chatgpt-history", sessionId: "selection", status: "syncing", retryScope: "selected", phase: "syncing", pendingIds: ["other"], failedIds: [], persistedIds: [], discovered: 1, offset: 0, persisted: 0, hydrated: 0, completed: 0, failed: 0, startedAt: 1, updatedAt: 1, checkpoint: { sessionId: "selection", discoveredIds: [], persistedIds: [], failedIds: [], pendingIds: ["other"], lastCursor: "0", startedAt: 1, updatedAt: 1 } };
    const sendMessage = vi.fn(async (command: AtlasMessage) => command.type === "ATLAS_IMPORT_SELECT" ? { ...job, priorityPendingIds: ["entry-one"] } : job);
    vi.stubGlobal("chrome", { runtime: { id: "test-extension", sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
    render(<PreferencesProvider><App /></PreferencesProvider>);
    const sources = await screen.findByRole("group", { name: "Choose conversations for this task" });
    fireEvent.click(within(sources).getByRole("checkbox"));
    expect(sendMessage.mock.calls.some(([command]) => command.type === "ATLAS_IMPORT_SELECT")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Prioritize 1 selected" }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "ATLAS_IMPORT_SELECT", conversationIds: ["entry-one"] }));
  });
  it("continues organization with an editable revision request while excluding sibling results outside the chosen pool", async () => {
    const db = await getDatabase();
    const project: FocusSession = { id: "home-project", canvasId: "home-canvas", title: "Hardware project", mode: "work", goal: "Hardware", sourceConversationIds: ["entry-one"], sections: [], evidence: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 };
    await db.put("focusSessions", project);
    await db.put("focusSessions", { ...project, id: "excluded-sibling", sourceConversationIds: ["not-selected"] });
    localStorage.setItem("atlas-workbench-project-sources", JSON.stringify(["entry-one"]));
    vi.mocked(planHomeTask).mockResolvedValueOnce({ action: "continue", queries: [], projectId: project.id });
    render(<PreferencesProvider><App /></PreferencesProvider>);
    await screen.findByRole("button", { name: /^Remove material:/ });
    fireEvent.change(await screen.findByRole("textbox", { name: "Search or organize past conversations" }), { target: { value: "Continue my hardware project" } });
    fireEvent.click(screen.getByRole("button", { name:/^(Organize project|Search history|Continue project|Review)$/ }));
    const workspace = await screen.findByTestId("submitted-focus");
    expect(workspace).toHaveAttribute("data-reading-session", project.id);
    expect(workspace).toHaveAttribute("data-home-revision", "Continue my hardware project");
    expect(workspace).toHaveAttribute("data-project-sessions", project.id);
    expect(workspace.textContent).not.toContain('"sourceIds"');
    expect(JSON.parse(localStorage.getItem("atlas-workbench-project-sources")!)).toEqual(["entry-one"]);
  });
  it("opens a Sidecar saved-result link directly at the requested route chapter", async () => {
    const db = await getDatabase();
    await db.put("focusSessions", { id: "linked-result", title: "已有成果", goal: "Review", mode: "review", sourceConversationIds: ["entry-one"], sections: [{ id: "first", title: "Start", body: "", transition: "", kind: "review", evidenceIds: [] }, { id: "second", title: "Next", body: "", transition: "", kind: "review", evidenceIds: [] }], evidence: [], activeSectionId: "first", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 });
    window.history.replaceState({}, "", "/#review=linked-result&section=second");
    render(<PreferencesProvider><App /></PreferencesProvider>);
    await waitFor(() => expect(screen.getByTestId("submitted-focus")).toHaveAttribute("data-reading-session", "linked-result"));
    expect(screen.getByTestId("submitted-focus")).toHaveAttribute("data-active-section", "second");
    expect(screen.queryByTestId("conversation-reader")).not.toBeInTheDocument();
  });
  it("reloads a saved Sidecar result created while the workbench was already open", async () => {
    const listeners = new Set<(message: AtlasMessage) => void>();
    vi.stubGlobal("chrome", { runtime: { id: "test-extension", sendMessage: vi.fn(async () => null), onMessage: { addListener: (listener: (message: AtlasMessage) => void) => listeners.add(listener), removeListener: (listener: (message: AtlasMessage) => void) => listeners.delete(listener) } } });
    render(<PreferencesProvider><App /></PreferencesProvider>); await screen.findByRole("heading", { name:/What would you like to find or continue|Make past AI conversations useful again/ });
    await (await getDatabase()).put("focusSessions", { id: "new-linked", title: "New saved result", goal: "Review", mode: "review", sourceConversationIds: ["entry-one"], sections: [{ id: "first", title: "Start", body: "", transition: "", kind: "review", evidenceIds: [] }], evidence: [], activeSectionId: "first", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 });
    act(() => listeners.forEach(listener => listener({ type: "ATLAS_FOCUS_REVIEW", sessionId: "new-linked", sectionId: "first" })));
    await waitFor(() => expect(screen.getByTestId("submitted-focus")).toHaveAttribute("data-reading-session", "new-linked"));
  });
  it("opens project chapters directly and returns home without another contents or graph page", async () => {
    const db = await getDatabase();
    await db.put("canvases", { id: "direct-project", name: "My direct project", type: "topic", origin: "user", createdAt: 1, updatedAt: 1 });
    await db.put("focusSessions", { id: "direct-result", canvasId: "direct-project", title: "Saved chapters", goal: "Review", mode: "work", sourceConversationIds: ["entry-one"], sections: [{ id: "second", title: "Last read", kind: "review", body: "Body", transition: "", evidenceIds: [] }], evidence: [], activeSectionId: "second", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 });
    render(<PreferencesProvider><App /></PreferencesProvider>);
    const sidebar = await screen.findByRole("complementary", { name: "Workspace navigation" });
    expect(within(sidebar).getByText("My projects")).toBeVisible();
    expect(screen.queryByText("Knowledge workbench")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "My spaces" })).not.toBeInTheDocument();
    fireEvent.click(await within(sidebar).findByRole("button", { name: "My direct project" }));
    await waitFor(() => expect(screen.getByTestId("submitted-focus")).toHaveAttribute("data-reading-session", "direct-result"));
    expect(screen.getByTestId("submitted-focus")).toHaveAttribute("data-active-section", "second");
    expect(screen.queryByRole("button", { name: "Continue a saved result →" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Workbench" }));
    expect(await screen.findByRole("heading", { name:/What would you like to find or continue|Make past AI conversations useful again/ })).toBeVisible();
  });
  it("shows a failed generation after refresh and resumes only its original selected sources", async () => {
    const db = await getDatabase();
    await db.put("focusGenerationTasks", { id: "interrupted", runId: "same-run", goal: "Review controls", mode: "work", sourceIds: ["entry-one"], scope: { kind: "all", sourceConversationIds: ["entry-one"] }, status: "failed", createdAt: 1, updatedAt: 2 });
    await saveConversation({ id: "unselected", platform: "chatgpt", title: "Excluded conversation", url: "", updatedAt: 1, messageCount: 1, importState: "complete", hydrationState: "hydrated" });
    render(<PreferencesProvider><App /></PreferencesProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /Review controls.*Continue generation/ }));
    expect(JSON.parse((await screen.findByTestId("submitted-focus")).textContent!)).toMatchObject({ id: "interrupted", runId: "same-run", sourceIds: ["entry-one"], goal: "Review controls" });
  });
  it("asks for a missing legacy goal in the workbench and keeps the recovered task identity", async () => {
    const db = await getDatabase();
    await db.put("focusGenerationTasks", { id: "legacy", runId: "legacy-run", goal: "", mode: "work", sourceIds: ["entry-one"], needsConfirmation: true, status: "paused", createdAt: 1, updatedAt: 2 });
    render(<PreferencesProvider><App /></PreferencesProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /Unfinished organization.*Confirm goal and sources/ }));
    expect(screen.queryByTestId("submitted-focus")).not.toBeInTheDocument();
    fireEvent.change(await screen.findByRole("textbox", { name: "Search or organize past conversations" }), { target: { value: "Review the original decisions" } });
    fireEvent.click(screen.getByRole("button", { name:/^(Organize project|Search history|Continue project|Review)$/ }));
    expect(JSON.parse((await screen.findByTestId("submitted-focus")).textContent!)).toMatchObject({ id: "legacy", runId: "legacy-run", sourceIds: ["entry-one"], goal: "Review the original decisions" });
  });
  it("starts a full-content generation directly from checked Workbench sources", async () => {
    localStorage.setItem("atlas-workbench-project-sources", JSON.stringify(["entry-one"]));
    render(<PreferencesProvider><App /></PreferencesProvider>);
    await screen.findByRole("button", { name: /^Remove material:/ });
    fireEvent.change(await screen.findByRole("textbox", { name: "Search or organize past conversations" }), { target: { value: "Organize all selected conversations" } });
    fireEvent.click(screen.getByRole("button", { name:/^(Organize project|Search history|Continue project|Review)$/ }));
    const submitted = JSON.parse((await screen.findByTestId("submitted-focus")).textContent!);
    expect(submitted).toMatchObject({ goal: "Organize all selected conversations", sourceIds: ["entry-one"], scope: { kind: "all", sourceConversationIds: ["entry-one"] } });
    expect(submitted.autoLocate).toBeUndefined();
  });
  it("loads previous previews on the Workbench and supplies all source-review versions to original reading", async () => {
    const db = await getDatabase();
    const full: FocusSession = { id: "previous-full", title: "My saved project", goal: "Organize", mode: "review", sourceConversationIds: ["entry-one"], sections: [], evidence: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 };
    await db.put("focusSessions", full);
    await db.put("focusSessions", { ...full, id: "previous-preview", rootSessionId: full.id, status: "preview", scope: { kind: "goal" }, createdAt: 2, updatedAt: 2 });
    render(<PreferencesProvider><App /></PreferencesProvider>);
    expect(await screen.findByText("Preview ready")).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: "Source materials and sync" }));
    fireEvent.click(await screen.findByRole("button", { name: "Read: Map entry test" }));
    await waitFor(() => expect(screen.getByTestId("conversation-reader")).toHaveAttribute("data-review-ids", "previous-preview,previous-full"));
  });
  it("keeps a user-owned space available in the sidebar before graph cards exist", async () => {
    const db = await getDatabase();
    await db.put("canvases", { id: "space-with-sources", name: "Saved learning space", title: "Saved learning space", type: "topic", origin: "user", sourceConversationIds: ["entry-one"], createdAt: 1, updatedAt: 1 });
    render(<PreferencesProvider><App /></PreferencesProvider>);
    const sidebar = await screen.findByRole("complementary", { name: "Workspace navigation" });
    const space = await within(sidebar).findByRole("button", { name: "Saved learning space" });
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    fireEvent.click(space);
    expect(await screen.findByRole("heading", { name: "Saved learning space" })).toBeInTheDocument();
  });
  it("opens the workbench when a Sidecar linked conversation has not synced yet", async () => {
    const db = await getDatabase();
    await db.put("conversations", { ...(await db.get("conversations", "entry-one"))!, importState: "discovered", hydrationState: "queued" });
    window.history.replaceState({}, "", "/#conversation=entry-one");
    render(<PreferencesProvider><App /></PreferencesProvider>);
    expect(await screen.findByRole("heading", { name:/What would you like to find or continue|Make past AI conversations useful again/ })).toBeInTheDocument();
    expect(screen.queryByTestId("conversation-map")).not.toBeInTheDocument();
    expect(screen.queryByTestId("conversation-reader")).not.toBeInTheDocument();
    const materials = await screen.findByRole("group", { name: "Choose conversations for this task" });
    expect(await within(materials).findByText("Map entry test")).toBeInTheDocument();
    expect(await within(materials).findByText("Queued")).toBeInTheDocument();
  });

  it("routes a Sidecar focus message for an unsynced conversation to the workbench", async () => {
    const listeners = new Set<(message: AtlasMessage) => void>();
    vi.stubGlobal("chrome", { runtime: { id: "test-extension", sendMessage: vi.fn(async () => null), onMessage: { addListener: (listener: (message: AtlasMessage) => void) => listeners.add(listener), removeListener: (listener: (message: AtlasMessage) => void) => listeners.delete(listener) } } });
    const db = await getDatabase();
    await db.put("conversations", { ...(await db.get("conversations", "entry-one"))!, importState: "discovered", hydrationState: "queued" });
    render(<PreferencesProvider><App /></PreferencesProvider>);
    act(() => listeners.forEach((listener) => listener({ type: "ATLAS_FOCUS_CONVERSATION", conversationId: "entry-one" })));
    expect(await screen.findByRole("heading", { name:/What would you like to find or continue|Make past AI conversations useful again/ })).toBeInTheDocument();
    expect(screen.queryByTestId("conversation-map")).not.toBeInTheDocument();
    // The workbench heading already exists before the asynchronous IndexedDB
    // source lookup completes; await the actual message side effect.
    await waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "ATLAS_IMPORT_PRIORITY", conversationId: "entry-one" }));
  });

  it("opens a synced Sidecar deep link in the unified source reader", async () => {
    window.history.replaceState({}, "", "/#conversation=entry-one");
    render(<PreferencesProvider><App /></PreferencesProvider>);
    expect(await screen.findByTestId("conversation-reader")).toBeInTheDocument();
    expect(screen.queryByTestId("conversation-map")).not.toBeInTheDocument();
  });

  it("opens selected originals directly and keeps their existing structure available", async () => {
    render(<PreferencesProvider><App /></PreferencesProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Source materials and sync" }));
    fireEvent.click(await screen.findByRole("button", { name: "Read: Map entry test" }));
    expect(await screen.findByTestId("conversation-reader")).toBeInTheDocument();
    expect(screen.queryByTestId("conversation-map")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chapter structure" })).not.toBeInTheDocument();
  });

  it("keeps source reading separate from organizing on the Workbench", async () => {
    vi.mocked(planHomeTask).mockClear();
    render(<PreferencesProvider><App /></PreferencesProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Source materials and sync" }));
    fireEvent.click(await screen.findByRole("button", { name: "Read: Map entry test" }));
    expect(await screen.findByTestId("conversation-reader")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Organize on Workbench" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("submitted-focus")).not.toBeInTheDocument();
    expect(vi.mocked(planHomeTask)).not.toHaveBeenCalled();
    expect(screen.queryByTestId("conversation-map")).not.toBeInTheDocument();
  });

  it("refreshes an open conversation when an already persisted source is synced again", async () => {
    const listeners = new Set<(message: AtlasMessage) => void>();
    const initialJob: ImportJob = { id: "chatgpt-history", sessionId: "repeat-sync", status: "inventory_ready", phase: "syncing", offset: 1, persistedIds: ["entry-one"], pendingIds: [], discoveredIds: ["entry-one"], failedIds: [], discovered: 1, failed: 0, completed: 1, hydrated: 1, persisted: 1, startedAt: 1, updatedAt: 2, checkpoint: { sessionId: "repeat-sync", discoveredIds: ["entry-one"], persistedIds: ["entry-one"], pendingIds: [], failedIds: [], lastCursor: "1", startedAt: 1, updatedAt: 2 } };
    vi.stubGlobal("chrome", { runtime: { id: "test-extension", sendMessage: vi.fn(async () => initialJob), onMessage: { addListener: (listener: (message: AtlasMessage) => void) => listeners.add(listener), removeListener: (listener: (message: AtlasMessage) => void) => listeners.delete(listener) } } });
    const db = await getDatabase();
    const conversation = (await db.get("conversations", "entry-one"))!;
    const message: ConversationMessage = { id: "entry-message", conversationId: conversation.id, messageIndex: 0, role: "user", content: "Old body", preview: "Old body", contentHash: "old", createdAt: 1, updatedAt: 1 };
    await saveConversationCapture({ conversation, messages: [message], capturedAt: 1 });
    render(<PreferencesProvider><App /></PreferencesProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Source materials and sync" }));
    fireEvent.click(await screen.findByRole("button", { name: "Read: Map entry test" }));
    await screen.findByTestId("conversation-reader");
    await waitFor(() => expect(screen.getByTestId("conversation-reader")).toHaveTextContent("Old body"));
    act(() => listeners.forEach((listener) => listener({ type: "ATLAS_IMPORT_PROGRESS", job: { ...initialJob, status: "syncing", pendingIds: [conversation.id] } })));
    await saveConversationCapture({ conversation, messages: [{ ...message, content: "Updated body", preview: "Updated body", contentHash: "updated", updatedAt: 2 }], capturedAt: 2 });
    act(() => listeners.forEach((listener) => listener({ type: "ATLAS_IMPORT_PROGRESS", job: initialJob })));
    await waitFor(() => expect(screen.getByTestId("conversation-reader")).toHaveTextContent("Updated body"));
  });
});
