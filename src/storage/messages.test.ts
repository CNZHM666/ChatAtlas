import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { ConversationCapture, ConversationMessage } from "../shared/types";
import { getDatabase } from "./db";
import { getMessagesForConversation, saveConversationCapture, searchStoredDiscussions, invalidateStoredMessageSearchIndex } from "./messages";
import { onMessageSearchInvalidation } from "../search/message-search-invalidation";

const message = (id: string, index: number, content: string, capturedAt: number): ConversationMessage => ({
  id,
  conversationId: "conversation-storage",
  platformMessageId: id,
  messageIndex: index,
  role: index % 2 ? "assistant" : "user",
  content,
  preview: content,
  contentHash: `hash-${content}`,
  createdAt: capturedAt,
  updatedAt: capturedAt,
});

it("preserves known provider message dates when a DOM capture has only capture time", async () => {
  const db = await getDatabase();
  await db.put("messages", { ...message("dated", 0, "question", 1), sourceCreatedAt: 1700000000000 });
  await saveConversationCapture({ conversation: { id: "conversation-storage", title: "Dates", platform: "chatgpt", url: "", updatedAt: 2, messageCount: 1 }, messages: [message("dated", 0, "question", 2)], capturedAt: 2 }, { warmIndex: false });
  expect((await db.get("messages", "dated"))?.sourceCreatedAt).toBe(1700000000000);
});

const capture = (messages: ConversationMessage[], capturedAt: number): ConversationCapture => ({
  conversation: {
    id: "conversation-storage",
    platform: "chatgpt",
    title: "Storage test",
    url: "https://chatgpt.com/c/conversation-storage",
    updatedAt: capturedAt,
    messageCount: messages.length,
  },
  messages,
  capturedAt,
});

describe("conversation capture storage", () => {
  it("merges visible multi-AI windows by saved message anchors without mixing new replies into old turns",async()=>{
    const original=Array.from({length:4},(_,index)=>message(`web-${index}`,index,`Original ${index}`,1));
    const first=capture(original,1);first.conversation={...first.conversation,platform:"claude",source:"claude_export"};await saveConversationCapture(first,{warmIndex:false});
    const window=capture([{...original[3],messageIndex:0},message("web-new",1,"New answer",2)],2);window.conversation={...window.conversation,platform:"claude",source:"claude_dom"};
    await saveConversationCapture(window,{replace:false,warmIndex:false});
    expect((await getMessagesForConversation("conversation-storage",{cache:false})).map(item=>[item.id,item.messageIndex])).toEqual([["web-0",0],["web-1",1],["web-2",2],["web-3",3],["web-new",4]]);
    expect((await(await getDatabase()).get("conversations","conversation-storage"))?.messageCount).toBe(5);
    await saveConversationCapture(window,{replace:false,warmIndex:false});expect(await getMessagesForConversation("conversation-storage",{cache:false})).toHaveLength(5);
  });
  it("inserts newly loaded older multi-AI messages before an existing anchor while retaining unseen later messages",async()=>{
    const first=capture([message("anchor",0,"Known question",1),message("later",1,"Later answer",1)],1);first.conversation={...first.conversation,platform:"deepseek",source:"deepseek_dom"};await saveConversationCapture(first,{warmIndex:false});
    const older=capture([message("older",0,"Older question",2),message("anchor",1,"Known question",2)],2);older.conversation={...older.conversation,platform:"deepseek",source:"deepseek_dom"};await saveConversationCapture(older,{replace:false,warmIndex:false});
    expect((await getMessagesForConversation("conversation-storage",{cache:false})).map(item=>item.id)).toEqual(["older","anchor","later"]);
  });
  it("does not renumber imported late questions when a virtualized visible capture starts from zero",async()=>{
    const original=Array.from({length:6},(_,index)=>message(`order-${index}`,index,`Original ${index}`,1));await saveConversationCapture(capture(original,1),{warmIndex:false});
    await saveConversationCapture(capture([{...original[4],messageIndex:0,updatedAt:2},{...original[5],messageIndex:1,updatedAt:2}],2),{replace:false,warmIndex:false});
    expect((await getMessagesForConversation("conversation-storage",{cache:false})).map(item=>[item.id,item.messageIndex])).toEqual(original.map(item=>[item.id,item.messageIndex]));
    const db=await getDatabase();await db.put("messages",{...original[4],messageIndex:0});
    const full=capture(original,3);full.conversation={...full.conversation,hydrationState:"hydrated",source:"chatgpt_live"};await saveConversationCapture(full,{replace:false,warmIndex:false});
    expect((await db.get("messages",original[4].id))?.messageIndex).toBe(4);
  });
  it("notifies search only after original messages have committed", async () => {
    const db = await getDatabase(), saved = message("commit-notice", 0, "Committed source", 1);
    const observations: Array<Promise<ConversationMessage | undefined>> = [];
    const remove = onMessageSearchInvalidation(() => { observations.push(db.get("messages", saved.id)); });
    try {
      await saveConversationCapture(capture([saved], 1), { warmIndex: false });
      expect(observations).toHaveLength(1);
      expect(await observations[0]).toMatchObject({ id: saved.id, content: "Committed source" });
    } finally { remove(); }
  });
  it("preserves component data on an unchanged visible capture, but invalidates it when its article changes", async () => {
    const uiParts = [{ ordinal: 0, raw: '{"html":"<p>原组件</p>"}' }];
    const original = { ...message("ui-message", 1, "【原平台交互内容】", 1), uiParts };
    await saveConversationCapture(capture([original], 1), { warmIndex: false });
    await saveConversationCapture(capture([message("ui-message", 1, original.content, 2)], 2), { replace: false, warmIndex: false });
    expect((await getMessagesForConversation("conversation-storage"))[0].uiParts).toEqual(uiParts);
    await saveConversationCapture(capture([message("ui-message", 1, "Changed answer", 3)], 3), { replace: false, warmIndex: false });
    expect((await getMessagesForConversation("conversation-storage"))[0].uiParts).toBeUndefined();
  });
  beforeEach(async () => {
    invalidateStoredMessageSearchIndex();
    const db = await getDatabase();
    const tx = db.transaction(["messages", "conversations"], "readwrite");
    await tx.objectStore("messages").clear();
    await tx.objectStore("conversations").clear();
    await tx.done;
  });
  it("searches answers in the selected source pool and retains their preceding question", async () => {
    const question = message("late-key-q", 0, "How do I check stability?", 1);
    const answer = message("early-key-a", 1, "The real parts of eigenvalues must be negative.", 1);
    await saveConversationCapture(capture([answer, question], 1), { warmIndex: false });
    const db = await getDatabase();
    for (let index = 0; index < 40; index++) await db.put("messages", { ...answer, id: `unselected-${index}`, conversationId: "unselected", content: "eigenvalues eigenvalues" });
    invalidateStoredMessageSearchIndex();
    const matches = await searchStoredDiscussions("eigenvalues", new Set([question.conversationId]));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ message: { id: answer.id }, question: { id: question.id } });
    expect(await searchStoredDiscussions("eigenvalues", new Set(["missing"])) ).toEqual([]);
    await saveConversationCapture(capture([question, { ...answer, content: "A replacement explanation." }], 2), { warmIndex: false });
    expect(await searchStoredDiscussions("eigenvalues", new Set([question.conversationId]))).toEqual([]);
  });
  it("updates existing messages, preserves createdAt, and removes stale branch messages", async () => {
    await saveConversationCapture(capture([
      message("message-1", 0, "Question", 100),
      message("message-2", 1, "Old answer", 100),
    ], 100));

    await saveConversationCapture(capture([
      message("message-1", 0, "Question edited", 200),
    ], 200));

    const stored = await getMessagesForConversation("conversation-storage");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: "message-1", content: "Question edited", createdAt: 100, updatedAt: 200 });
    expect((await (await getDatabase()).get("conversations", "conversation-storage"))?.messageCount).toBe(1);
  });

  it("merges a partial DOM capture without deleting older imported messages", async () => {
    await saveConversationCapture(capture([message("stable-1", 0, "Question", 300), message("stable-2", 1, "Answer", 300)], 300));
    await saveConversationCapture(capture([{ ...message("dom-hash-id", 0, "Question", 400), platformMessageId: undefined }], 400), { replace: false });
    const stored = await getMessagesForConversation("conversation-storage");
    expect(stored.map((item) => item.id)).toEqual(["stable-1", "stable-2"]);
  });

  it("remaps a DOM reply relation when equivalent imported messages keep their stable IDs", async () => {
    await saveConversationCapture(capture([message("stable-1", 0, "Question", 300), message("stable-2", 1, "Answer", 300)], 300));
    await saveConversationCapture(capture([
      { ...message("dom-user", 0, "Question", 400), platformMessageId: undefined },
      { ...message("dom-answer", 1, "Answer", 400), platformMessageId: undefined, replyToMessageId: "dom-user" },
    ], 400), { replace: false });
    expect(await getMessagesForConversation("conversation-storage")).toMatchObject([
      { id: "stable-1" },
      { id: "stable-2", replyToMessageId: "stable-1" },
    ]);
  });

  it("keeps existing graph-facing message IDs when a later full import supplies platform IDs", async () => {
    await saveConversationCapture(capture([{ ...message("dom-user", 0, "Question", 100), platformMessageId: undefined }], 100), { replace: false });
    await saveConversationCapture(capture([message("web-user", 0, "Question", 200), { ...message("web-answer", 1, "Answer", 200), replyToMessageId: "web-user" }], 200));
    expect(await getMessagesForConversation("conversation-storage")).toMatchObject([
      { id: "dom-user", platformMessageId: "web-user" },
      { id: "web-answer", replyToMessageId: "dom-user" },
    ]);
  });
});
