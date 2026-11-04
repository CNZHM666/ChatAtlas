import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { mergeFocusUpdate, planFocusUpdate, planWikiEditionUpdate, generateFocusUpdate } from "./focus-update";
import { generateFocusSession } from "./focus-session";
import { sourceMessageSignature } from "../shared/source-signature";
import type { FocusSession } from "../shared/focus-session";
import type { ConversationMessage } from "../shared/types";
import { getDatabase } from "../storage/db";
import { readWikiSources, wikiSourceReading } from "../shared/wiki-source-reading";
vi.mock("./focus-session", () => ({ generateFocusSession: vi.fn() }));
const messages: ConversationMessage[] = ["Initial question", "First answer", "New question", "Second answer"].map((content, index) => ({ id: `m${index}`, conversationId: "source", messageIndex: index, role: index % 2 ? "assistant" : "user", content, contentHash: "", preview: "", createdAt: 1, updatedAt: 1 }));
const previous: FocusSession = { id: "old", goal: "Review", mode: "review", title: "Project", scope: { kind: "all" }, coverage: { method: "full_batched", sourceCount: 1, processedSegments: 4, totalSegments: 4 }, sourceConversationIds: ["source"], sourceSignatures: { source: Object.fromEntries(messages.map(item => [item.id, sourceMessageSignature(item.content)])) }, sourceMessageOrder: { source: messages.map(item => item.id) }, sourceRoles: { source: Object.fromEntries(messages.map(item => [item.id, item.role])) }, sourceOutlines: [{ conversationId: "source", chapters: [{ id: "first", title: "First", summary: "First answer", messageIds: ["m0", "m1"] }, { id: "second", title: "Second", summary: "Second answer", messageIds: ["m2", "m3"] }] }], evidence: [0, 2].map(index => ({ id: `e${index}`, conversationId: "source", messageId: `m${index}`, title: "Source", excerpt: "Original" })), sections: [0, 2].map(index => ({ id: `s${index}`, title: `Stage ${index}`, body: `Body ${index}`, kind: "review", transition: "", evidenceIds: [`e${index}`] })), activeSectionId: "s0", completedSectionIds: ["s0", "s2"], visitedSectionIds: ["s0"], notes: "Keep project notes", sectionNotes: { s2: { text: "Keep chapter note", evidenceIds: ["e2"], updatedAt: 1 } }, createdAt: 1, updatedAt: 1 };
const appended = [...messages, { ...messages[0], id: "m4", messageIndex: 4, content: "Additional correction" }];
const patch: FocusSession = { ...previous, id: "patch", evidence: [{ id: "new-e", conversationId: "source", messageId: "m4", title: "Source", excerpt: "Additional correction" }], sections: [{ id: "generated", title: "Updated last stage", body: "Corrected", transition: "", kind: "review", evidenceIds: ["new-e"] }], sourceOutlines: [{ conversationId: "source", chapters: [{ id: "new", title: "Later discussion", summary: "Corrected", messageIds: ["m2", "m3", "m4"] }] }] };
it("limits an append to its chapter and leaves unchanged chapters, progress and notes intact", () => {
  const plan = planFocusUpdate(previous, appended);
  expect(plan.fallback).toBe(false); expect(plan.scope.blocks?.[0].messageIds).toEqual(["m2", "m3", "m4"]); expect(plan.affectedSectionIds).toEqual(["s2"]);
  const merged = mergeFocusUpdate(previous, patch, plan, appended, "en");
  expect(merged.sections[0]).toEqual(previous.sections[0]); expect(merged.sections[1].id).toBe("s2"); expect(merged.completedSectionIds).toEqual(["s0"]); expect(merged.activeSectionId).toBe("s0");
  expect(merged.sectionNotes?.s2.text).toBe("Keep chapter note"); expect(merged.notes).toBe(previous.notes); expect(merged.sourceOutlines?.[0].chapters[0].id).toBe("first");
  expect(merged.evidence.some(item => item.id === merged.sections[1].evidenceIds[0] && item.messageId === "m4")).toBe(true);
  expect(merged.sourceSignatures?.source.m4).toBe(sourceMessageSignature("Additional correction"));
});
it("adds a selected new conversation without regenerating unchanged conversations", () => {
  const added = [{ ...messages[0], id: "fresh-user", conversationId: "new-source", content: "New source" }];
  const plan = planFocusUpdate(previous, [...messages, ...added]);
  expect(plan.fallback).toBe(false); expect(plan.affectedSectionIds).toEqual([]);
  expect(plan.scope.blocks).toEqual([expect.objectContaining({ conversationId: "new-source", messageIds: ["fresh-user"] })]);
  const fresh = { ...patch, evidence: [{ ...patch.evidence[0], conversationId: "new-source", messageId: "fresh-user" }], sourceOutlines: [{ conversationId: "new-source", chapters: [] }] };
  const result = mergeFocusUpdate(previous, fresh, plan, [...messages, ...added], "en");
  expect(result.sourceConversationIds).toEqual(["source", "new-source"]);
  expect(result.sections.slice(0, 2)).toEqual(previous.sections);
  expect(result.sourceRoles?.["new-source"]["fresh-user"]).toBe("user");
});
it("does not clear unresolved questions just because the updated discussion omits them", () => {
  const old = { ...previous, brief: { summary: "", confirmed: [], turningPoints: [], openQuestions: ["发布范围？"] } };
  const fresh = { ...patch, brief: { summary: "", confirmed: [], turningPoints: [], openQuestions: ["校验范围？"] } };
  expect(mergeFocusUpdate(old, fresh, planFocusUpdate(old, appended), appended, "en").brief?.openQuestions).toEqual(["发布范围？", "校验范围？"]);
});
it("preserves edited bodies and personal route cards, flagging changed sources for review", () => {
  const old = { ...previous, sections: previous.sections.map(item => item.id === "s2" ? { ...item, userEdited: true, body: "My explanation", understandingPath: [{ ...item, id: "personal", origin: "user" as const }] } : item) };
  const merged = mergeFocusUpdate(old, patch, planFocusUpdate(old, appended), appended, "en");
  expect(merged.sections.find(item => item.id === "s2")?.body).toBe("My explanation"); expect(merged.sections.find(item => item.id === "s2")?.understandingPath?.[0].id).toBe("personal"); expect(merged.reviewNeeds?.s2).toContain("edits are preserved"); expect(merged.sections.some(item => item.body === "Corrected")).toBe(true);
});

it("preserves personal structure independently of source text edits and flags an affected chapter", () => {
  const old = { ...previous, sections: previous.sections.map(section => section.id === "s2" ? { ...section, structureEdited: true, responsibility: "My responsibility", understandingLinks: [{ targetId: "s0", kind: "feedback" as const }] } : section) };
  const result = mergeFocusUpdate(old, patch, planFocusUpdate(old, appended), appended, "en");
  expect(result.sections.find(section => section.id === "s2")).toMatchObject({ responsibility: "My responsibility", understandingLinks: [{ targetId: "s0", kind: "feedback" }] });
  expect(result.reviewNeeds?.s2).toContain("edits are preserved");
});
it("detects role/order changes and uses a full fallback without a reliable baseline", () => {
  expect(planFocusUpdate(previous, messages.map(item => item.id === "m2" ? { ...item, role: "assistant" } : item)).changed).toBe(true);
  expect(planFocusUpdate(previous, messages.map(item => ({ ...item, messageIndex: 3 - item.messageIndex }))).affectedSectionIds).toEqual(["s0", "s2"]);
  expect(planFocusUpdate({ ...previous, sourceSignatures: undefined, sourceOutlines: undefined }, appended).fallback).toBe(true);
  expect(planFocusUpdate(previous, messages).changed).toBe(false);
});
it("revisits later corrections after deletion without losing personal notes when chapter matching is ambiguous", () => {
  const current = messages.filter(item => item.id !== "m2");
  const plan = planFocusUpdate(previous, current);
  expect(plan.removedKeys).toContain(JSON.stringify(["source", "m2"])); expect(plan.affectedSectionIds).toContain("s2");
  const multiple = { ...patch, sections: [patch.sections[0], { ...patch.sections[0], id: "another", title: "Different new stage" }] };
  const result = mergeFocusUpdate(previous, multiple, plan, current, "en");
  expect(result.sectionNotes?.s2).toBeUndefined(); expect(result.detachedNotes?.some(note => note.text.includes("Keep chapter note"))).toBe(true);
  expect(result.sections.every(section => section.id !== "s2")).toBe(true);
  expect(result.brief?.confirmed).toEqual([]);
});
it("keeps authored overview content and supplies original turn headings after a direct short update", () => {
  const old = { ...previous, briefUserEdited: true, brief: { summary: "My overview", confirmed: [], turningPoints: [], openQuestions: ["My question"] } };
  const direct = { ...patch, sourceOutlines: [{ conversationId: "source", chapters: [] }] };
  const result = mergeFocusUpdate(old, direct, planFocusUpdate(old, appended), appended, "en");
  expect(result.brief).toEqual(old.brief); expect(result.sourceOutlines?.[0].chapters.flatMap(chapter => chapter.messageIds)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
});
it("keeps a user's custom chapter order and interleaved personal card during replacement", () => {
  const user = { ...previous.sections[0], id: "user", origin: "user" as const, body: "My card" };
  const old = { ...previous, sections: [previous.sections[1], user, previous.sections[0]] };
  const fresh = { ...patch, evidence: previous.evidence, sections: previous.sections.map(section => ({ ...section, body: "Updated " + section.id })) };
  const result = mergeFocusUpdate(old, fresh, { ...planFocusUpdate(previous, appended), affectedSectionIds: ["s0", "s2"] }, appended, "en");
  expect(result.sections.map(section => section.id)).toEqual(["s2", "user", "s0"]); expect(result.sections[1].body).toBe("My card");
  expect(planFocusUpdate({ ...previous, sourceMessageOrder: undefined, sourceRoles: undefined }, messages).fallback).toBe(true);
});
it("calls generation only for selected changed material and avoids AI completely when unchanged", async () => {
  const db = await getDatabase(); await db.clear("messages"); for (const message of messages) await db.put("messages", message);
  const sources = [{ id: "source", title: "Source", platform: "chatgpt" as const, url: "", messageCount: 4, updatedAt: 1 }];
  vi.mocked(generateFocusSession).mockClear().mockResolvedValue(patch);
  await generateFocusUpdate(previous, sources, "en", new AbortController().signal);
  expect(generateFocusSession).not.toHaveBeenCalled();
  await db.put("messages", appended.at(-1)!);
  await generateFocusUpdate(previous, sources, "en", new AbortController().signal);
  expect(generateFocusSession).toHaveBeenCalledWith(previous.goal, previous.mode, sources, "en", expect.any(AbortSignal), undefined, undefined, undefined, undefined, expect.objectContaining({ scope: expect.objectContaining({ kind: "goal", blocks: [expect.objectContaining({ messageIds: ["m2", "m3", "m4"] })] }) }));
});

it("plans an explicit one-time current-edition rebuild within the existing source scope",()=>{
 const old={...previous,mode:"work" as const,wikiEdition:undefined};
 const plan=planWikiEditionUpdate(old,messages,planFocusUpdate(old,messages));expect(plan.fallback).toBe(true);expect(plan.changed).toBe(true);expect(plan.affectedSectionIds).toEqual(old.sections.map(section=>section.id));expect(plan.scope.blocks?.flatMap(block=>block.messageIds)).toEqual(messages.map(message=>message.id));
 const current={...old,wikiEdition:"current-v2" as const,wikiMainlineVersion:1 as const},unchanged=planFocusUpdate(current,messages);expect(planWikiEditionUpdate(current,messages,unchanged)).toBe(unchanged);
});

it("rebuilds legacy generated pages with snapshots and aliases while keeping personal pages",()=>{
 const old={...previous,mode:"work" as const,wikiEdition:undefined,sections:[...previous.sections,{...previous.sections[0],id:"personal",userEdited:true,body:"我的原始说明"}]};
 const fresh={...patch,wikiEdition:"current-v1" as const,mode:"work" as const,evidence:[{...previous.evidence[0],id:"fresh0"},{...previous.evidence[1],id:"fresh2"}],sections:[{...patch.sections[0],id:"new-parent",title:"系统架构",evidenceIds:["fresh0","fresh2"]}]};
 const plan=planWikiEditionUpdate(old,messages,planFocusUpdate(old,messages));
 const result=mergeFocusUpdate(old,fresh,plan,messages,"en");expect(result.sections).toHaveLength(2);expect(result.sections.find(section=>section.id==="personal")?.body).toBe("我的原始说明");expect(result.wikiMergeHistory?.at(-1)?.sections).toEqual(old.sections);expect(result.wikiSectionAliases?.s0).toBe(result.sections.find(section=>section.title==="系统架构")?.id);expect(result.wikiEdition).toBe("current-v1");
});

it("backfills paragraph routing once on an explicit update and retains the saved project identity",()=>{
 const old={...previous,mode:"work" as const,wikiEdition:"current-v2" as const,title:"AI Hardware Builder",wikiProjectBoundary:{name:"AI Hardware Builder",purpose:"模块级硬件创作平台。"}};
 const plan=planWikiEditionUpdate(old,messages,planFocusUpdate(old,messages));
 expect(plan.changed).toBe(true);expect(plan.fallback).toBe(true);expect(plan.scope.blocks?.[0].messageIds).toEqual(messages.map(message=>message.id));
 const fresh={...patch,mode:"work" as const,wikiMainlineVersion:1 as const,wikiEdition:"current-v2" as const};
 const result=mergeFocusUpdate(old,fresh,plan,messages,"en");
 // The name carries over; a purpose the user did not write is not saved identity.
 expect(result.wikiProjectBoundary).toEqual({name:"AI Hardware Builder"});expect(result.wikiMainlineVersion).toBe(1);expect(result.wikiMergeHistory?.at(-1)?.sections).toEqual(old.sections);
 const unchanged=planFocusUpdate(result,messages);expect(planWikiEditionUpdate(result,messages,unchanged)).toBe(unchanged);
});
it("keeps a saved source receipt valid after the update namespaces evidence IDs", () => {
  const proposal = { ...messages[1], id: "m4", messageIndex: 4, content: "我建议采用 Orama 作为搜索引擎。" }, approval = { ...messages[0], id: "m5", messageIndex: 5, content: "我确认采用 Orama 作为搜索引擎。" };
  const input = [...messages, proposal, approval];
  const evidence = [{ id: "e1", conversationId: "source", messageId: "m4", title: "Source", excerpt: proposal.content }, { id: "e2", conversationId: "source", messageId: "m5", title: "Source", excerpt: approval.content }];
  const claim = { text: "采用 Orama 作为搜索引擎", quote: "我建议采用 Orama 作为搜索引擎。", evidenceIds: ["e1"] };
  const receipt = readWikiSources(claim, evidence, input);
  const fresh: FocusSession = { ...patch, evidence, sections: [{ id: "generated", title: "Updated last stage", body: "采用 Orama 作为搜索引擎。", transition: "", kind: "review", evidenceIds: ["e1", "e2"], claims: [{ ...claim, sourceReading: receipt }] }] };
  const merged = mergeFocusUpdate(previous, fresh, planFocusUpdate(previous, input), input, "en");
  const updated = merged.sections.find(section => section.claims?.length)!.claims![0];
  expect(updated.evidenceIds).toEqual(["update:patch:e1"]);
  expect(updated.sourceReading?.sources.every(source => source.id.startsWith("update:patch:"))).toBe(true);
  const reading = wikiSourceReading(merged, updated);
  expect(reading).toBeDefined(); expect(reading?.status).toBe(receipt.status);
  // A receipt citing an approval that the remap cannot follow is re-read, not trusted.
  const lost = mergeFocusUpdate(previous, { ...fresh, evidence: [evidence[0]], sections: [{ ...fresh.sections[0], evidenceIds: ["e1"] }] }, planFocusUpdate(previous, input), input, "en");
  expect(lost.sections.find(section => section.claims?.length)!.claims![0].sourceReading).toBeUndefined();
});
