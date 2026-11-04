import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import { discussionHighlightId, saveDiscussionHighlight } from "../storage/discussion-highlights";
import * as originals from "../storage/messages";
import { highlightSource, highlightMessages, highlightSession } from "../test/discussion-highlight-fixture";
import { buildDiscussionHighlights, clearDiscussionHighlightCache, discussionGroups, loadDiscussionHighlights, readDiscussionHighlight } from "./discussion-highlights";

beforeEach(async () => { vi.restoreAllMocks(); clearDiscussionHighlightCache(); const db = await getDatabase(); for (const name of ["messages", "conversations", "discussionHighlights", "conversationGraphs"] as const) await db.clear(name); });

it("reuses original source outlines and Wiki categories while preserving original order and unknown dates", () => {
  const result = buildDiscussionHighlights(highlightSource, highlightMessages(), [highlightSession()], []);
  expect(result.rows.map(row => [row.title, row.category, row.firstTurn])).toEqual([["明确目标", "产品定位", 1], ["修正方案", "技术方案", 4]]);
  expect(result.rows.every(row => row.discussedAt === undefined)).toBe(true);
  expect(result.coveredTurns).toBe(2); expect(result.totalTurns).toBe(4);
  const dated = highlightMessages(); dated[0].sourceCreatedAt = 1790000000000;
  expect(buildDiscussionHighlights(highlightSource, dated, [highlightSession()], []).rows[0].discussedAt).toBe(1790000000000);
});

it("splits distant citations and excludes material outside the confirmed goal scope", () => {
  const session = highlightSession(); session.sourceOutlines = []; session.sections = [{ ...session.sections[0], evidenceIds: ["e0", "e6"] }];
  expect(buildDiscussionHighlights(highlightSource, highlightMessages(), [session], []).rows.map(row => [row.firstTurn, row.lastTurn])).toEqual([[1, 1], [4, 4]]);
  session.scope = { kind: "goal", blocks: [{ conversationId: highlightSource.id, title: "局部", messageIds: ["highlight-m6"], messageSignatures: {} }] };
  expect(buildDiscussionHighlights(highlightSource, highlightMessages(), [session], []).rows.map(row => row.firstTurn)).toEqual([4]);
});

it("rejects changed content, roles and reordered sources without upgrading a saved Wiki into evidence", () => {
  const session = highlightSession(), messages = highlightMessages(); messages[0].content = "后来修改的问题"; messages[1].role = "user";
  const result = buildDiscussionHighlights(highlightSource, messages, [session], []);
  expect(result.rows.map(row => row.title)).toEqual(["修正方案"]); expect(result.needsUpdate).toBe(true);
  const reordered = highlightMessages(); reordered[0].messageIndex = 9;
  expect(buildDiscussionHighlights(highlightSource, reordered, [session], []).rows).toEqual([]);
});

it("preserves personal labels and hidden state across regenerated titles and marks changed manual sources", () => {
  const messages = highlightMessages(), session = highlightSession(), id = discussionHighlightId(highlightSource.id, messages[0].id);
  const edit = { id, conversationId: highlightSource.id, messageId: messages[0].id, title: "我改过的重点", category: "我的分类", updatedAt: 2 };
  session.sourceOutlines![0].chapters[0].title = "新的 AI 标题";
  expect(buildDiscussionHighlights(highlightSource, messages, [session], [edit]).rows[0]).toMatchObject({ title: edit.title, category: edit.category, personal: true });
  expect(buildDiscussionHighlights(highlightSource, messages, [session], [{ ...edit, hidden: true }]).rows).toHaveLength(1);
  const manual = { ...edit, manual: true, messageIds: messages.slice(0, 2).map(m => m.id), signatures: { [messages[0].id]: "old" } };
  expect(buildDiscussionHighlights(highlightSource, messages, [], [manual]).rows[0]).toMatchObject({ title: edit.title, stale: true });
});

it("reuses in-flight and completed projections without any model, embedding or fetch request", async () => {
  const db = await getDatabase(); await db.put("conversations", highlightSource); for (const message of highlightMessages()) await db.put("messages", message);
  const read = vi.spyOn(originals, "getMessagesForConversation"), fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  try {
    const session = highlightSession(); const [a, b] = await Promise.all([loadDiscussionHighlights(highlightSource, [session]), loadDiscussionHighlights(highlightSource, [session])]);
    expect(a).toBe(b); expect(await loadDiscussionHighlights({ ...highlightSource }, [structuredClone(session)])).toBe(a); expect(read).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
    await saveDiscussionHighlight({ id: a.rows[0].id, conversationId: highlightSource.id, messageId: a.rows[0].messageId, title: "修改后的重点", category: "个人" });
    const changed = await loadDiscussionHighlights(highlightSource, [session]); expect(changed.rows[0].title).toBe("修改后的重点"); expect(read).toHaveBeenCalledTimes(2);
    await db.put("messages", { ...highlightMessages()[0], content: "source changed" });
    expect((await loadDiscussionHighlights({ ...highlightSource, rawRevision: "v2" }, [session])).rows).toHaveLength(1);
    await expect(readDiscussionHighlight(a.rows[0])).rejects.toThrow("HIGHLIGHT_SOURCE_CHANGED"); expect(fetch).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

it("keeps explicit branch reply ownership and never publishes unconfirmed previews", () => {
  const messages = highlightMessages(); messages[5].replyToMessageId = messages[0].id;
  expect(discussionGroups(messages)[0].messages.map(m => m.id)).toEqual(["highlight-m0", "highlight-m1", "highlight-m5"]);
  expect(buildDiscussionHighlights(highlightSource, messages, [{ ...highlightSession(), status: "preview" }], []).rows).toEqual([]);
});
it("recovers a topic from the exact owning Wiki page when its group is absent and leaves ambiguous ownership unknown",()=>{
 const session=highlightSession();session.sections[1].wikiGroup="";session.sections[1].wikiDisplayTitle="需求定位";
 expect(buildDiscussionHighlights(highlightSource,highlightMessages(),[session],[]).rows[0].category).toBe("需求定位");
 session.sections.push({...session.sections[1],id:"overlap",wikiDisplayTitle:"付费方案"});
 const row=buildDiscussionHighlights(highlightSource,highlightMessages(),[session],[]).rows[0];expect(row.category).toBe("");
 const second=highlightSession();second.id="another";second.sections[1].wikiGroup="其他项目主题";
 const combined=buildDiscussionHighlights(highlightSource,highlightMessages(),[highlightSession(),second],[]);
 expect(combined.rows[0]).toMatchObject({category:"",categoryAmbiguous:true});
});
