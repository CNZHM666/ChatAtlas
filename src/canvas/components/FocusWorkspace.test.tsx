import "fake-indexeddb/auto";
import { act,cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences";
import { FocusWorkspace } from "./FocusWorkspace";
import { generateFocusSession } from "../../ai/focus-session";
import { DemoApiError } from "../../ai/demo-api";
import { AIProviderResponseError, AIProviderValidationError } from "../../ai/provider";
import { getDatabase } from "../../storage/db";
import type { FocusSession } from "../../shared/focus-session";
import type { Conversation } from "../../shared/types";
import { StrictMode } from "react";
import * as focusStorage from "../../storage/focus-sessions";
import type { FocusScope } from "../../shared/focus-session";
import { projectSession } from "../../test/project-fixture";
import { contextKnowledge } from "../../test/context-fixture";
import * as wikiRewriteAI from "../../ai/wiki-section-rewrite";
import * as wikiRevisionAI from "../../ai/wiki-revision";

vi.mock("../../ai/focus-session", () => ({ generateFocusSession: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
vi.mock("../../ai/knowledge-source-retrieval", async (original) => ({ ...await original<typeof import("../../ai/knowledge-source-retrieval")>(), rankKnowledgeSources: () => [], retrieveKnowledgeSources: async () => [] }));
const conversation: Conversation = { id: "c", title: "Control discussion", platform: "chatgpt", url: "", messageCount: 2, importState: "complete", hydrationState: "hydrated", updatedAt: 1 };
const session: FocusSession = { id: "s", goal: "Review poles", mode: "answer", title: "Stability review", sourceConversationIds: ["c"], evidence: [{ id: "e1", conversationId: "c", messageId: "m1", title: "Control discussion", excerpt: "Why poles?" }], sections: [{ id: "one", title: "Understanding poles", body: "Read the original explanation.", kind: "review", transition: "", evidenceIds: ["e1"] }], activeSectionId: "one", completedSectionIds: [], notes: "Keep my edits", createdAt: 1, updatedAt: 1 };
beforeEach(async () => { vi.clearAllMocks(); localStorage.setItem("atlas-locale", "en"); localStorage.removeItem("atlas-wiki-categories:s"); const db = await getDatabase(); await db.clear("canvases"); await db.clear("projectQueryThreads"); await db.clear("focusGenerationTasks"); await db.clear("focusSessions"); await db.clear("conversations"); await db.clear("aiSettings"); await db.put("aiSettings", { id: "ai-settings", mode: "byok", provider: "openai", baseUrl: "https://api.example/v1", apiKey: "fixture", model: "fixture", updatedAt: 1 }); await db.clear("messages"); await db.put("messages", { id: "m1", conversationId: "c", messageIndex: 0, role: "user", content: "Why poles?", preview: "Why poles?", contentHash: "hash", createdAt: 1, updatedAt: 1 }); });

async function confirmDiscussionScope() { const button = await screen.findByRole("button", { name: "Generate preview" }); await waitFor(() => expect(screen.queryByText("Finding discussions…")).not.toBeInTheDocument()); if ((button as HTMLButtonElement).disabled) { fireEvent.click(screen.getByRole("button", { name: "Browse other discussions" })); fireEvent.click(screen.getAllByRole("checkbox")[0]); } fireEvent.click(button); }

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

it.each(["ready","preview"] as const)("opens scope reading directly in the workspace's right pane and shares it with evidence (%s)",async status=>{
 const project:FocusSession={...session,mode:"work",status,wikiScopeReview:{version:1,status:"complete",goal:session.goal,includeKeys:[],materials:[{id:"note",key:"note",title:"Prompt material",body:"Complete material body.\n\n================\n========== PHASE 1 — Welcome\n\nLast paragraph remains visible.",kind:"other",reason:"Check the project boundary.",quote:"",evidenceIds:["e1"]}]}};
 const {container}=render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 // The pane opens only when the user reads a material.
 expect(screen.queryByLabelText("Material reading")).toBeNull();
 fireEvent.click(await screen.findByRole("button",{name:"Read material: Prompt material"}));
 const pane=await screen.findByLabelText("Material reading");
 expect(pane.parentElement).toHaveClass(status==="preview"?"focus-preview":"focus-workspace");
 expect(within(pane).getByText("Last paragraph remains visible.")).not.toBeVisible();
 const originals=within(pane).getByRole("region",{name:"Material originals"});
 await waitFor(()=>expect(originals).toHaveAttribute("aria-busy","false"));
 expect(within(originals).getByText("Why poles?")).toBeVisible();
 expect(container.querySelector(".wiki-scope-notice .workspace-source-panel")).toBeNull();
 fireEvent.click(within(pane).getByRole("button",{name:"View in conversation"}));
 const evidence=await screen.findByLabelText("Original evidence");
 expect(screen.queryByLabelText("Material reading")).toBeNull();
 fireEvent.click(within(evidence).getByRole("button",{name:"Close original evidence"}));
 expect(await screen.findByLabelText("Material reading")).toBeVisible();
 expect(generateFocusSession).not.toHaveBeenCalled();
});

it("keeps exactly one scope notice in overview and none in chapters across repeated navigation",async()=>{
 const project:FocusSession={...session,mode:"work",status:"ready",wikiScopeReview:{version:1,goal:session.goal,includeKeys:[],materials:[{id:"note",key:"reference",title:"Reference",body:"Original reference",kind:"reference",reason:"Comparison",quote:"Original",evidenceIds:["e1"]}]}};
 const errors=vi.spyOn(console,"error").mockImplementation(()=>undefined);
 const {container}=render(<StrictMode><PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider></StrictMode>);
 const navigation=screen.getByRole("navigation",{name:"Conversation chapters"});
 for(let index=0;index<5;index++){
  expect(container.querySelectorAll(".wiki-scope-notice")).toHaveLength(1);
  fireEvent.click(within(navigation).getByRole("button",{name:/Understanding poles/}));
  expect(container.querySelectorAll(".wiki-scope-notice")).toHaveLength(0);
  fireEvent.click(within(navigation).getByRole("button",{name:"Document overview"}));
 }
 expect(container.querySelectorAll(".wiki-scope-notice")).toHaveLength(1);
 expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key|unique.*key/i);
 expect(generateFocusSession).not.toHaveBeenCalled();
});


it("restores a scoped discussion through a separate preview while preserving personal Wiki edits",async()=>{
 const project:FocusSession={...session,mode:"work",status:"ready",locale:"en",scope:{kind:"all"},sections:[{...session.sections[0],userEdited:true,body:"My exact personal Wiki edit."}],wikiScopeReview:{version:1,goal:session.goal,includeKeys:["old-choice"],materials:[{id:"n2",key:"travel-key",title:"Other discussion",body:"Travel notes",kind:"other",reason:"Separate discussion",quote:"Travel notes",evidenceIds:["e1"]}]}};
 vi.mocked(generateFocusSession).mockResolvedValueOnce({...project,id:"restored",sections:[{...session.sections[0],id:"new",title:"Restored knowledge",body:"Restored material."}],wikiScopeReview:{version:1,goal:session.goal,includeKeys:["old-choice","travel-key"],materials:[]}});
 render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 // A flagged discussion waits in the open review list, outside the Wiki.
 fireEvent.click(within(screen.getByRole("region",{name:"Needs review"})).getByRole("button",{name:"Keep in project"}));fireEvent.click(screen.getByRole("button",{name:"Apply 1 selection"}));
 await screen.findByRole("button",{name:"Save and view"});
 expect(vi.mocked(generateFocusSession).mock.calls.at(-1)?.[9]).toMatchObject({wikiScopeIncludeKeys:["old-choice","travel-key"],wikiScopeExcludeKeys:[]});
 expect(screen.getByText("My exact personal Wiki edit.")).toBeInTheDocument();expect(screen.getByText("Restored material.")).toBeInTheDocument();
 const original=await (await getDatabase()).get("focusSessions",project.id);expect(original?.sections[0].body).not.toBe("Restored material.");
});

it("saves project-only removal locally without a model call or changing the original chapter",async()=>{
 const project:FocusSession={...session,mode:"work",status:"ready",wikiScopeReview:{version:1,status:"complete",goal:session.goal,includeKeys:[],materials:[{id:"outside",key:"other-project",title:"Other project",body:"A separate product's design.",kind:"other",reason:"Separate project",quote:"",evidenceIds:[]}]}};
 render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 fireEvent.click(within(screen.getByRole("region",{name:"Needs review"})).getByRole("button",{name:"Remove from project"}));
 fireEvent.click(screen.getByRole("button",{name:"Apply 1 selection"}));
 await screen.findByText("Removed from project 1");
 await waitFor(async()=>expect((await (await getDatabase()).get("focusSessions",project.id))?.wikiScopeReview).toMatchObject({excludeKeys:["other-project"],ignoredKeys:["other-project"]}));
 expect(generateFocusSession).not.toHaveBeenCalled();
 expect((await (await getDatabase()).get("focusSessions",project.id))?.sections).toEqual(project.sections);
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
 expect(generateFocusSession).not.toHaveBeenCalled();
});

it("opens selected project file export directly from the toolbar without running a model",async()=>{
 const project={...session,mode:"work" as const,status:"ready" as const};
 render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 expect(screen.getByRole("button",{name:"Save project"})).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"Export"}));
 const dialog=await screen.findByRole("dialog",{name:"Export project files"});expect(within(dialog).getByRole("checkbox",{name:"Wiki chapters"})).toBeChecked();fireEvent.click(within(dialog).getByRole("button",{name:"Choose Wiki chapters"}));expect(within(dialog).getByRole("checkbox",{name:"Understanding poles"})).toBeChecked();expect(within(dialog).queryByRole("checkbox",{name:"Project matters"})).toBeNull();expect(within(dialog).getByRole("combobox",{name:"File format"})).toHaveValue("md");expect(generateFocusSession).not.toHaveBeenCalled();
});

it("offers an explicit side-material decision for a contradictory chapter in the final preview",async()=>{
 const preview:FocusSession={...session,id:"scope-preview",mode:"work",status:"preview",sections:[{...session.sections[0],wikiMaterialKeys:["main"]},{...session.sections[0],id:"outside",title:"Knowledge references",wikiQuestion:"Which discussions are outside this project?",wikiMaterialKeys:["side-a","side-b"]}],wikiScopeReview:{version:1,status:"complete",goal:session.goal,includeKeys:[],materials:[]}};
 vi.mocked(generateFocusSession).mockResolvedValueOnce({...preview,id:"new-scope-preview",sections:preview.sections.slice(0,1)});
 render(<PreferencesProvider><FocusWorkspace initialSession={preview} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 expect(generateFocusSession).not.toHaveBeenCalled();expect(screen.getByRole("region",{name:"Chapter scope review"})).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"Move to side material"}));expect(generateFocusSession).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Apply 1 selection"}));
 await waitFor(()=>expect(generateFocusSession).toHaveBeenCalledOnce());
 expect(vi.mocked(generateFocusSession).mock.calls[0][9]).toMatchObject({wikiScopeExcludeKeys:["side-a","side-b"]});
 expect(preview.sections).toHaveLength(2);
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
    expect(within(chapter).getByText("Read the original explanation.")).toBeVisible();
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
    expect(screen.getAllByText("Read the original explanation.")[0]).toBeVisible(); expect(screen.getByRole("button", {name:"Save and view"})).toBeEnabled();
    fireEvent.click(screen.getByRole("button", {name:"Save and view"}));
    await waitFor(() => expect(screen.queryByText("Project plan preview")).toBeNull());
    expect(save).toHaveBeenCalledTimes(2); expect(generateFocusSession).not.toHaveBeenCalled();
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
    expect(within(dialog).getByRole("checkbox",{name:"Project overview"})).toBeChecked();
    expect(within(dialog).getByRole("checkbox",{name:"Wiki chapters"})).toBeChecked();
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
    expect(within(dialog).getByRole("checkbox",{name:"Wiki chapters"})).toBeDisabled();
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
    expect(screen.queryByRole("button", { name: "Update chapter understanding" })).toBeNull();expect(screen.getByRole("button", { name: "Reorganize · Preview" })).toBeVisible();expect(screen.queryByRole("button", { name: "Revise with AI" })).toBeNull();
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
  it("saves project responsibilities and feedback without leaving overview or generating, then restores them", async () => {
    const reading = { ...session, sections: [session.sections[0], { ...session.sections[0], id: "two", title: "Validation" }] };
    const props = { conversations: [conversation], canvases: [], settingsRevision: 0, onClose: vi.fn(), onReturnToWorkbench: vi.fn(), onSettings: vi.fn(), onSaved: vi.fn() };
    const { unmount } = render(<PreferencesProvider><FocusWorkspace {...props} initialSession={reading} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Reading overview" }));
    fireEvent.click(screen.getByRole("tab", { name: "Knowledge structure" }));
    const route = screen.getByRole("region", { name: "Project structure" });
    fireEvent.click(within(route).getByRole("button", { name: "Edit structure" }));
    fireEvent.click(await within(route).findByRole("button", { name: /^Understanding poles/ }));
    const editor = screen.getByRole("dialog", { name: "Edit understanding" });
    fireEvent.click(within(editor).getByText("More options"));
    fireEvent.change(within(editor).getByRole("textbox", { name: "Responsibility" }), { target: { value: "Explain conditions" } });
    fireEvent.click(within(editor).getByText("Personal relationships", { selector: "summary" }));
    fireEvent.click(within(editor).getByRole("button", { name: "+ Relation" }));
    fireEvent.change(within(editor).getByRole("combobox", { name: "Relation 1" }), { target: { value: "feedback" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await (await getDatabase()).get("focusSessions", "s"))?.projectUnderstanding?.nodes[0]).toMatchObject({ responsibility: "Explain conditions", sectionIds: ["one"], links: [{ targetTitle: "Validation", kind: "feedback" }] }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Responsibility" })).toBeNull());
    expect(screen.getByRole("region", { name: "Reading overview" })).toBeVisible();
    const saved = (await (await getDatabase()).get("focusSessions", "s"))!;
    unmount();
    render(<PreferencesProvider><FocusWorkspace {...props} initialSession={saved} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Reading overview" }));
    fireEvent.click(screen.getByRole("tab", { name: "Knowledge structure" }));
    fireEvent.click(await within(screen.getByRole("region", { name: "Structure map" })).findByRole("button", { name: /^Understanding poles/ }));
    const detail = screen.getByRole("region", { name: "Structure detail" });
    expect(screen.getByRole("region", { name: "Project structure" })).toHaveTextContent("Explain conditions");
    expect(detail).toHaveTextContent("My relation");
    expect(saved.sections).toEqual(reading.sections);
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
  it("opens notes and deduplicated citations on demand, restoring keyboard focus without AI", async () => {
    const props = { initialSession: { ...session, evidence: [...session.evidence, { ...session.evidence[0], id: "duplicate" }], sections: [{ ...session.sections[0], evidenceIds: ["e1", "duplicate"] }] }, conversations: [conversation], canvases: [], settingsRevision: 0, onClose: vi.fn(), onReturnToWorkbench: vi.fn(), onSettings: vi.fn(), onSaved: vi.fn() };
    const { container } = render(<PreferencesProvider><FocusWorkspace {...props} /></PreferencesProvider>);
    expect(screen.queryByRole("complementary", { name: "My notes panel" })).not.toBeInTheDocument();
    expect(container.querySelector(".reader-content .reader-notes")).toBeNull();
    expect(container.querySelector(".chapter-step-explanation")).toBeNull();
    const more = screen.getByText("More"); more.focus(); fireEvent.click(more);
    fireEvent.click(screen.getByRole("button", { name: "Chapter sources" }));
    const panel = screen.getByRole("complementary", { name: "Chapter sources" });
    await waitFor(()=>expect(within(panel).getAllByRole("button", { name: /Why poles\?/ })).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Close sources" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "Close sources" }), { key: "Escape" });
    expect(more).toHaveFocus();
    const notesButton = within(screen.getByRole("navigation", { name: "Conversation chapters" })).getByRole("button", { name: "My notes" }); notesButton.focus(); fireEvent.click(notesButton);
    expect(screen.getByRole("complementary", { name: "My notes panel" })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "Chapter notes" }), { target: { value: "My chapter understanding" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(async () => expect((await (await getDatabase()).get("focusSessions", session.id))?.sectionNotes?.one.text).toBe("My chapter understanding"));
    fireEvent.click(screen.getByRole("button", { name: "Close notes" }));
    expect(notesButton).toHaveFocus(); fireEvent.click(notesButton);
    expect(screen.getByRole("textbox", { name: "Chapter notes" })).toHaveValue("My chapter understanding");
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
  it("keeps the chapter route local and persists personal steps without changing project chapters", async () => {
    const local = { ...session, mode:"review" as const, id: "chapter-route", sections: [{ ...session.sections[0], body: "## Matrix\nMatrix explanation\n### Eigenvalues\nTheir connection\n## Stability\nStable condition" }, { ...session.sections[0], id: "two", title: "Other project chapter" }] };
    const props = { initialSession: local, conversations: [conversation], canvases: [], settingsRevision: 0, onClose: vi.fn(), onReturnToWorkbench: vi.fn(), onSettings: vi.fn(), onSaved: vi.fn() };
    const first = render(<PreferencesProvider><FocusWorkspace {...props} /></PreferencesProvider>);
    expect(screen.queryByRole("region", { name: "Chapter understanding path" })).toBeNull();
    fireEvent.click(screen.getByText("My notes", { selector: ".chapter-personal-notes > summary" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add note" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "My missing link" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Explanation" }), { target: { value: "My personal explanation" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Edit understanding" })).getByText("More options"));
    fireEvent.change(screen.getByRole("textbox", { name: "Group" }), { target: { value: "My foundation" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Relation" }));
    expect(screen.getByRole("combobox", { name: "Linked concept 1" })).toHaveTextContent("Matrix");
    expect(screen.getByRole("combobox", { name: "Linked concept 1" })).not.toHaveTextContent("Other project chapter");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const db = await getDatabase();
    await waitFor(async () => expect((await db.get("focusSessions", local.id))?.sections[0].understandingPath?.at(-1)).toMatchObject({ title: "My missing link", origin: "user", phase: "My foundation", understandingLinks: [{ targetId: "chapter-step:one:0", kind: "requires" }] }));
    const saved = (await db.get("focusSessions", local.id))!;
    expect(saved.sections.map(item => item.id)).toEqual(["one", "two"]); expect(saved.sections[0].body).toBe(local.sections[0].body);
    first.unmount(); render(<PreferencesProvider><FocusWorkspace {...props} initialSession={saved} /></PreferencesProvider>);
    fireEvent.click(screen.getByText("My notes", { selector: ".chapter-personal-notes > summary" }));
    expect(within(document.querySelector(".chapter-personal-notes")! as HTMLElement).getByRole("button", { name: /^My missing link/ })).toBeVisible();
    expect(focusStorage.focusMarkdown(saved)).toContain("My personal explanation");
    expect(generateFocusSession).not.toHaveBeenCalled();
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
  it("creates and edits personal route cards in an empty project without AI and restores them on reload", async () => {
    const empty = { ...session, id: "empty-project", sections: [], activeSectionId: "", evidence: [], sourceConversationIds: [], canvasId: "project" };
    const props = { initialSession: empty, conversations: [], canvases: [], settingsRevision: 0, onClose: vi.fn(), onReturnToWorkbench: vi.fn(), onSettings: vi.fn(), onSaved: vi.fn() };
    const first = render(<PreferencesProvider><FocusWorkspace {...props} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "+ Understanding card" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Understanding card title" }), { target: { value: "My own reasoning" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Understanding card content" }), { target: { value: "An explanation I wrote" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const db = await getDatabase();
    await waitFor(async () => expect((await db.get("focusSessions", empty.id))?.sections[0]).toMatchObject({ origin: "user", title: "My own reasoning", body: "An explanation I wrote", evidenceIds: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Reading overview" }));
    fireEvent.click(screen.getByRole("tab", { name: "Knowledge structure" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit structure" }));
    fireEvent.click(screen.getByText("Adjust reading order"));
    fireEvent.click(screen.getByRole("button", { name: "Edit path" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit My own reasoning" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Understanding card content" }), { target: { value: "My later correction" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await db.get("focusSessions", empty.id))?.sections[0].body).toBe("My later correction"));
    first.unmount();
    render(<PreferencesProvider><FocusWorkspace {...props} initialSession={await db.get("focusSessions", empty.id)} /></PreferencesProvider>);
    expect(screen.getByText("My later correction")).toBeVisible();
    expect(generateFocusSession).not.toHaveBeenCalled();
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
    const scopeReview:FocusSession["wikiScopeReview"]={version:1,status:"complete",goal:"Review stability",includeKeys:[],materials:[{id:"foreign",key:"foreign",kind:"other",title:"Other project discussion",body:"Original note",reason:"Belongs to a different product",quote:"Original",evidenceIds:["e1"]}]};
    act(()=>call[9]?.onPartial?.({...session,mode:"work",wikiScopeReview:scopeReview,sections:[{...session.sections[0],title:"Completed draft chapter",body:"Source-checked partial text."}]}));
    expect(screen.getByRole("region",{name:"Chapter draft preview"})).toHaveTextContent("Source-checked partial text.");
    expect(screen.getByRole("region",{name:"Needs review"})).toHaveTextContent("Other project discussion");
    expect(screen.getByRole("button",{name:"Keep in project"})).toBeDisabled();
    expect(host.querySelector(".focus-header-progress")).not.toBeNull();
    expect(workspace.container.querySelector(".focus-generation-panel")).toBeNull();
    expect(workspace.container.querySelector(".focus-generation-progress")).toBeNull();
    expect(host.querySelector("details")).not.toHaveAttribute("open");
    expect(screen.queryByRole("button",{name:"Save and view"})).toBeNull();expect(onSaved).not.toHaveBeenCalled();
    finish({ ...session, mode: "work", wikiScopeReview:scopeReview, sections: [{ ...session.sections[0], body: "Opening paragraph.\n\n" + "Full chapter details. ".repeat(80) + "End of the complete chapter." }] });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ status: "preview", scope })));
    expect(host).toBeEmptyDOMElement();
    expect(screen.getByRole("region",{name:"Needs review"})).toHaveTextContent("Other project discussion");
    expect(screen.getByRole("button",{name:"Keep in project"})).toBeEnabled();
    expect(screen.queryByText("Read chapter")).not.toBeInTheDocument();
    expect(screen.getByText(/End of the complete chapter/).closest("details")).toBeNull();
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
  it("reopens an automatically saved preview without regenerating, then accepts it locally", async () => {
    vi.mocked(generateFocusSession).mockResolvedValue(session);
    const onSaved = vi.fn();
    const props = { conversations: [conversation], canvases: [], settingsRevision: 0, onClose: vi.fn(), onReturnToWorkbench: vi.fn(), onSettings: vi.fn(), onSaved };
    const first = render(<PreferencesProvider><FocusWorkspace {...props} request={{ id: "recover-preview", goal: "Review poles", mode: "answer", sourceIds: ["c"], scope: { kind: "all", sourceConversationIds: ["c"] } }} /></PreferencesProvider>);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ status: "preview" })));
    first.unmount();
    const stored = await (await getDatabase()).get("focusSessions", "s"); expect(stored?.status).toBe("preview");
    render(<PreferencesProvider><FocusWorkspace {...props} initialSession={stored} /></PreferencesProvider>);
    expect(screen.getByRole("button", { name: "Confirm and start" })).toBeInTheDocument();
    expect(screen.getByText("Read the original explanation.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and start" }));
    await screen.findByRole("region", { name: "Reading overview" });
    expect((await (await getDatabase()).get("focusSessions", "s"))?.status).toBe("ready");
    expect(generateFocusSession).toHaveBeenCalledOnce();
  });
  it("retains generated text when saving fails and retries storage without another AI call", async () => {
    const save = vi.spyOn(focusStorage, "saveFocusSession").mockRejectedValueOnce(new Error("Disk unavailable"));
    vi.mocked(generateFocusSession).mockResolvedValue(session);
    render(<PreferencesProvider><FocusWorkspace request={{ id: "save-failure", goal: "Review poles", mode: "answer", sourceIds: ["c"], scope: { kind: "all", sourceConversationIds: ["c"] } }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    const retry = await screen.findByRole("button", { name: "Retry save" });
    expect(screen.getByText("Read the original explanation.")).toBeVisible();
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
  it("navigates without marking understanding and marks only the current section", async () => {
    const reading = { ...session, mode:"review" as const, sections: [session.sections[0], { ...session.sections[0], id: "two", title: "Next stage" }] };
    render(<PreferencesProvider><FocusWorkspace initialSession={reading} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Chapter understanding path" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Chapter guide" })).toBeNull();
    expect(screen.getByText("My notes", { selector: ".chapter-personal-notes > summary" })).toBeVisible();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Conversation chapters" })).getByRole("button", { name: /Next stage/ }));
    await waitFor(async () => expect((await (await getDatabase()).get("focusSessions", "s"))?.activeSectionId).toBe("two"));
    expect((await (await getDatabase()).get("focusSessions", "s"))?.completedSectionIds).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Mark understood" }));
    await waitFor(async () => expect((await (await getDatabase()).get("focusSessions", "s"))?.completedSectionIds).toEqual(["two"]));
    expect((await (await getDatabase()).get("focusSessions", "s"))?.activeSectionId).toBe("two");
    expect(screen.queryByText("Saved locally")).not.toBeInTheDocument();
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
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(vi.mocked(generateFocusSession).mock.calls[0][4]?.aborted).toBe(true);
    expect(onReturnToWorkbench).toHaveBeenCalledWith("Review", ["c"], "answer");
    expect(generateFocusSession).toHaveBeenCalledOnce();
  });
  it("requires an explicit action for complete reading and preserves that choice when retrying", async () => {
    const sampled = { ...session, coverage: { method: "sampled" as const, sourceCount: 1, processedSegments: 5, totalSegments: 100 } };
    vi.mocked(generateFocusSession).mockRejectedValue(new Error("Failed once"));
    render(<PreferencesProvider><FocusWorkspace initialSession={sampled} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    expect(generateFocusSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reading overview" }));
    fireEvent.click(screen.getByRole("button", { name: "Analyze all sources" }));
    await screen.findByText("Failed once");
    fireEvent.click(screen.getByRole("button", { name: "Retry generation" }));
    await waitFor(() => expect(generateFocusSession).toHaveBeenCalledTimes(2));
    for (const call of vi.mocked(generateFocusSession).mock.calls) expect(call[9]).toEqual({ complete: true });
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
      return new Promise(() => undefined);
    });
    const onSaved = vi.fn();
    render(<PreferencesProvider><FocusWorkspace request={{ id: "stream-progress", goal: "Review poles", mode: "answer", sourceIds: ["c"] }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={onSaved} /></PreferencesProvider>);
    await confirmDiscussionScope();
    expect(await screen.findByText("Compose answer", { exact: true, selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText(/Receiving model output/)).not.toBeInTheDocument();
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

  it("opens a cited Brief claim in continuous context, returns, and remembers an unresolved question", async () => {
    const work: FocusSession = { ...session, mode: "answer", sections: [{ ...session.sections[0], kind: "finding", transition: "This led to the next decision." }, { id: "two", title: "Next decision", body: "The next stage.", kind: "open_question", transition: "", evidenceIds: [] }], brief: { summary: "The project changed direction.", turningPoints: [{ text: "Reading became central.", evidenceIds: ["e1"] }], confirmed: [], openQuestions: ["What remains unclear?"] } };
    render(<PreferencesProvider><FocusWorkspace initialSession={work} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Reading overview" }));
    expect(screen.getByRole("region", { name: "Review summary" })).toHaveTextContent("The project changed direction.");
    fireEvent.click(screen.getByRole("button", { name: "Read discussion" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Original discussion reader" })).toHaveTextContent("Why poles?"));
    fireEvent.keyDown(screen.getByRole("region", { name: "Original discussion reader" }), { key: "Escape" });
    expect(screen.getByRole("region", { name: "Review summary" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit overview" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Review summary" }), { target: { value: "My corrected summary" } });
    await waitFor(async () => expect((await (await getDatabase()).get("focusSessions", "s"))?.brief?.summary).toBe("My corrected summary"));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Conversation chapters" })).getByRole("button", { name: /Understanding poles/ }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Conversation chapters" })).getByRole("button", { name: "My notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Review question" }));
    fireEvent.change(screen.getByRole("textbox", { name: "What still needs review?" }), { target: { value: "Why did this change?" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisit later" }));
    await waitFor(async () => expect((await (await getDatabase()).get("focusSessions", "s"))?.reviewNeeds?.one).toBe("Why did this change?"));
    expect(screen.getByRole("navigation", { name: "Conversation chapters" })).toHaveTextContent("Revisit · Why did this change?");
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

  it("saves previews before acceptance, reads original text, and saves progress independently", async () => {
    vi.mocked(generateFocusSession).mockResolvedValue(session);
    const onSaved = vi.fn();
    render(<PreferencesProvider><FocusWorkspace request={{ id: "request", goal: "Review poles", mode: "answer", sourceIds: ["c"] }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={onSaved} /></PreferencesProvider>);
    await confirmDiscussionScope();
    expect(screen.queryByLabelText("Knowledge Space name")).not.toBeInTheDocument();
    await screen.findByRole("button", { name: "Confirm and start" });
    expect(generateFocusSession).toHaveBeenCalledWith("Review poles", "answer", [conversation], "en", expect.any(AbortSignal), undefined, expect.any(Function), "request", expect.any(Function), expect.objectContaining({ scope: expect.objectContaining({ kind: "all" }) }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ status: "preview" })));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and start" }));
    expect(screen.queryByText("Why poles?")).not.toBeInTheDocument();
    const overview = await screen.findByRole("region", { name: "Reading overview" });
    fireEvent.click(overview.querySelector("[data-point-id]")!);
    fireEvent.click(within(screen.getByRole("region", { name: "Structure detail" })).getByRole("button", { name: /Understanding poles Read chapter/ }));
    expect(screen.queryByRole("complementary", { name: "Chapter sources" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("More")); fireEvent.click(screen.getByRole("button", { name: "Chapter sources" }));
    fireEvent.click(await within(screen.getByRole("complementary", { name: "Chapter sources" })).findByRole("button", { name: /Why poles\?/ }));
    await within(screen.getByRole("region", { name: "Original discussion reader" })).findByText("Why poles?");
    fireEvent.keyDown(screen.getByRole("region", { name: "Original discussion reader" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close sources" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark understood" }));
    await waitFor(async () => expect((await (await getDatabase()).get("focusSessions", "s"))?.completedSectionIds).toEqual(["one"]));
    expect(await (await getDatabase()).getAll("canvases")).toEqual([]);
  });

  it("keeps the original result and user notes when a follow-up fails", async () => {
    vi.mocked(generateFocusSession).mockRejectedValue(new Error("Provider unavailable"));
    const onSaved = vi.fn();
    render(<PreferencesProvider><FocusWorkspace initialSession={session} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={onSaved} /></PreferencesProvider>);
    fireEvent.click(screen.getByText("More")); fireEvent.click(screen.getByRole("button", { name: "Edit content" })); fireEvent.click(screen.getByRole("button", { name: "Revise with AI" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Revision instructions" }), { target: { value: "Shorten this" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview revision" }));
    await screen.findByText("Provider unavailable");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Conversation chapters" })).getByRole("button", { name: "My notes" }));
    fireEvent.click(screen.getByText("Shared review notes"));
    expect(screen.getByRole("textbox", { name: "Shared review notes" })).toHaveValue("Keep my edits");
    expect(onSaved).not.toHaveBeenCalled();
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
  it("saves understanding per chapter with its original question, and keeps old shared notes separate", async () => {
    const reading = { ...session, sections: [session.sections[0], { ...session.sections[0], id: "two", title: "Later correction" }] };
    render(<PreferencesProvider><FocusWorkspace initialSession={reading} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Conversation chapters" })).getByRole("button", { name: "My notes" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Chapter notes" }), { target: { value: "Only valid under condition B" } });
    fireEvent.blur(screen.getByRole("textbox", { name: "Chapter notes" }));
    await waitFor(async () => expect((await (await getDatabase()).get("focusSessions", "s"))?.sectionNotes?.one.text).toBe("Only valid under condition B"));
    const saved = await (await getDatabase()).get("focusSessions", "s");
    expect(saved?.sectionNotes?.one.sources?.[0].messageId).toBe("m1");
    expect(saved?.notes).toBe("Keep my edits");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Conversation chapters" })).getByRole("button", { name: /Later correction/ }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Conversation chapters" })).getByRole("button", { name: "My notes" }));
    expect(screen.getByRole("textbox", { name: "Chapter notes" })).toHaveValue("");
  });
  it("opens the exact chapter and note from search without generating or losing the record", async () => {
    const reading = { ...session, sections: [session.sections[0], { ...session.sections[0], id: "two", title: "Later correction" }], sectionNotes: { two: { text: "My later understanding", evidenceIds: ["e1"], updatedAt: 1 } } };
    render(<PreferencesProvider><FocusWorkspace initialSession={reading} searchTarget={{ sectionId: "two", note: true, nonce: 1 }} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()} /></PreferencesProvider>);
    expect(await screen.findByRole("heading", { level: 1, name: "Later correction" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Chapter notes" })).toHaveValue("My later understanding");
    await waitFor(async () => expect((await (await getDatabase()).get("focusSessions", "s"))?.activeSectionId).toBe("two"));
    expect(generateFocusSession).not.toHaveBeenCalled();
  });
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
 const project:FocusSession={...projectSession(),id:"s",status:"ready",locale:"en",sourceConversationIds:["c"],evidence:session.evidence,sections:[...session.sections,edited],wikiScopeReview:{version:1,goal:"",includeKeys:["k-in"],excludeKeys:["k-out"],materials:[]},wikiKnowledge:savedLedger};
 await (await getDatabase()).put("focusSessions",project);
 vi.mocked(generateFocusSession).mockResolvedValue({...project,id:"reorganized",wikiKnowledge:undefined,sections:session.sections.map(chapter=>({...chapter,body:"Rewritten."}))});
 render(<PreferencesProvider><FocusWorkspace initialSession={project} conversations={[conversation]} canvases={[]} settingsRevision={0} onClose={vi.fn()} onReturnToWorkbench={vi.fn()} onSettings={vi.fn()} onSaved={vi.fn()}/></PreferencesProvider>);
 fireEvent.click(screen.getByText("More",{exact:true}));fireEvent.click(screen.getByRole("button",{name:"Regenerate · Preview"}));
 await waitFor(async()=>expect((await (await getDatabase()).get("focusSessions","reorganized"))?.status).toBe("preview"));
 const summary=await screen.findByRole("region",{name:"Reorganization summary"}),scope=document.querySelector(".wiki-scope-notice")!;
 expect(summary.compareDocumentPosition(scope)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(document.querySelectorAll(".update-preview-summary")).toHaveLength(1);
 const call=vi.mocked(generateFocusSession).mock.calls[0];
 expect(call[2].map(source=>source.id)).toEqual(["c"]);
 expect(call[9]?.wikiPreviousLedger).toEqual(savedLedger);
 expect(call.find(arg=>arg&&typeof arg==="object"&&"wikiScopeExcludeKeys" in arg)).toMatchObject({wikiScopeIncludeKeys:["k-in"],wikiScopeExcludeKeys:["k-out"]});
 // The saved Wiki is untouched, and the preview keeps the user's own chapter.
 expect(await (await getDatabase()).get("focusSessions","s")).toEqual(project);
 const preview=await (await getDatabase()).get("focusSessions","reorganized");
 expect(preview?.sections.find(chapter=>chapter.title==="My chapter")?.body).toBe("My own words.");
});
