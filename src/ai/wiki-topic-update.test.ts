import { afterEach, expect, it, vi } from "vitest";
import type { FocusSession } from "../shared/focus-session";
import type { ConversationMessage } from "../shared/types";
import { projectSession } from "../test/project-fixture";
import { generateFocusSession } from "./focus-session";
import { reconcileWikiTopics,validateTopicImpacts } from "./wiki-topic-update";

vi.mock("./focus-session", () => ({ generateFocusSession: vi.fn() }));
vi.mock("../storage/knowledge-graph", () => ({ getAISettings: async () => ({}) }));
vi.mock("./atlas-ai", () => ({ createAtlasAI: () => ({ modelId: "fixture", capabilities: { maxConcurrency: 2 }, decide: vi.fn(async () => []) }) }));
afterEach(() => vi.mocked(generateFocusSession).mockReset());
function fixtures() {
  const previous = projectSession(); previous.sections = ["architecture", "product"].map(id => ({ id, title: id, body: `Original ${id}`, transition: "", evidenceIds: [`old-${id}`], kind: "finding" }));
  const patch: FocusSession = { ...previous, id: "patch", sections: previous.sections.map(section => ({ ...section, id: `new-${section.id}`, body: `Updated ${section.id}`, evidenceIds: [`new-${section.id}`] })) };
  previous.evidence = previous.sections.map(section => ({ id: `old-${section.id}`, conversationId: "source", messageId: `old-${section.id}`, title: section.title, excerpt: section.body }));
  patch.evidence = patch.sections.map(section => ({ id: section.id, conversationId: "source", messageId: section.id, title: section.title, excerpt: section.body }));
  const messages: ConversationMessage[] = [...previous.evidence, ...patch.evidence].map((ref, index) => ({ id: ref.messageId, conversationId: "source", role: "user", messageIndex: index, content: ref.excerpt, preview: "", contentHash: "", createdAt: 1, updatedAt: 1 }));
  return { previous, patch, messages, sources: [{ id: "source", title: "Source", platform: "chatgpt" as const, url: "", messageCount: 4, updatedAt: 1 }] };
}
it("starts independent page revisions together and commits ordered results only after both finish", async () => {
  const { previous, patch, messages, sources } = fixtures();
  const finish: Array<() => void> = [];
  vi.mocked(generateFocusSession).mockImplementation(async (...args) => new Promise(resolve => {
    const old = args[5]!.sections[0];
    finish.push(() => resolve({ ...patch, sections: [{ ...old, body: `Revised ${old.id}`, evidenceIds: [`new-${old.id}`] }], evidence: patch.evidence.filter(ref => ref.id === `new-${old.id}`) }));
  }));
  let published = false;
  const running = reconcileWikiTopics(previous, patch, messages, sources, new AbortController().signal).then(value => { published = true; return value; });
  await vi.waitFor(() => expect(finish).toHaveLength(2));
  finish[1](); await Promise.resolve(); expect(published).toBe(false);
  finish[0](); const next = await running;
  expect(next.patch.sections.map(section => section.id)).toEqual(["architecture", "product"]);
  expect(next.patch.sections.map(section => section.body)).toEqual(["Revised architecture", "Revised product"]);
  expect(previous.sections[0].body).toBe("Original architecture");
  expect(patch.sections.map(section => section.id)).toEqual(["new-architecture", "new-product"]);
});
it("preserves a personal page while collecting a suggestion and applying the other independent revision", async () => {
  const { previous, patch, messages, sources } = fixtures(); previous.sections[0].userEdited = true;
  vi.mocked(generateFocusSession).mockImplementation(async (...args) => ({ ...patch, sections: [{ ...args[5]!.sections[0], body: "Revised product", evidenceIds: ["new-product"] }], evidence: patch.evidence.filter(ref => ref.id === "new-product") }));
  const next = await reconcileWikiTopics(previous, patch, messages, sources, new AbortController().signal);
  expect(next.patch.wikiSuggestions?.architecture.body).toBe("Updated architecture");
  expect(next.patch.sections.map(section => section.id)).toEqual(["product"]);
  expect(previous.sections[0].body).toBe("Original architecture");
  expect(generateFocusSession).toHaveBeenCalledOnce();
});

it("updates every exact owner beyond the former eight-page cap",async()=>{
 const {previous,patch,messages,sources}=fixtures();
 previous.sections=Array.from({length:10},(_,index)=>({...previous.sections[0],id:`old${index}`,title:`模块${index}`,evidenceIds:[`old-proof${index}`]}));
 previous.evidence=previous.sections.map((section,index)=>({...previous.evidence[0],id:`old-proof${index}`,messageId:messages[0].id}));
 patch.sections=previous.sections.map((section,index)=>({...section,id:`new${index}`,wikiOwnerId:section.id,evidenceIds:[`new-proof${index}`]}));
 patch.evidence=patch.sections.map((section,index)=>({...patch.evidence[0],id:`new-proof${index}`,messageId:messages[0].id}));
 vi.mocked(generateFocusSession).mockImplementation(async(...args)=>{const old=args[5]!.sections[0];return {...patch,sections:[{...old,evidenceIds:["fresh"]}],evidence:[{...patch.evidence[0],id:"fresh"}]};});
 const result=await reconcileWikiTopics(previous,patch,messages,sources,new AbortController().signal);
 expect(generateFocusSession).toHaveBeenCalledTimes(10);expect(result.affectedIds).toEqual(previous.sections.map(section=>section.id));expect(result.patch.sections).toHaveLength(10);
});

it("rejects a new page assigned to competing old owners",()=>{
 const {previous,patch}=fixtures();
 expect(()=>validateTopicImpacts({updates:previous.sections.map(section=>({sectionId:section.id,patchSectionIds:[patch.sections[0].id]}))},previous,patch)).toThrow("dependency");
});

it.each([false,true])("improves generated titles while preserving owner identity and personal labels (%s)",async personal=>{
 const {previous,patch,messages,sources}=fixtures();if(personal)previous.sections[0].wikiDisplayTitle="我的架构";
 vi.mocked(generateFocusSession).mockImplementation(async(...args)=>{const old=args[5]!.sections[0];expect(args[5]!.instruction).toContain("Improve a mechanical generated title");return {...patch,sections:[{...old,title:old.id==="architecture"?"技术架构与数据模型":"产品战略与定位",evidenceIds:[`new-${old.id}`]}],evidence:patch.evidence.filter(ref=>ref.id===`new-${old.id}`)};});
 const next=await reconcileWikiTopics(previous,patch,messages,sources,new AbortController().signal);
 expect(next.patch.sections.map(section=>section.id)).toEqual(["architecture","product"]);
 expect(next.patch.sections.map(section=>section.title)).toEqual([personal?"architecture":"系统架构","产品定位"]);
});
