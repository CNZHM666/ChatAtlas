import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDatabase } from "../../storage/db";
import { getConversation } from "../../storage/conversations";
import { getMessagesForConversation } from "../../storage/messages";
import { importConversationExport } from "../export-import";
import { readImportRecords } from "../zip-import";
import { importerFor, recordsFromJson, recordsFromMarkdown } from ".";
import { geminiHtmlText } from "./gemini";

const file = (name: string, body: unknown) => ({ name, text: async () => typeof body === "string" ? body : JSON.stringify(body) }) as File;
const normalize = async (records: ReturnType<typeof recordsFromJson>) => Promise.all(records!.map(async record => importerFor(record).normalize(record.raw, "rev", 1_800_000_000_000)));

const claudeExport = [{
  uuid: "c-1", name: "Import design", created_at: "2025-03-01T10:00:00Z", updated_at: "2025-03-01T10:05:00Z",
  chat_messages: [
    { uuid: "m1", sender: "human", text: "How should imports work?", content: [{ type: "text", text: "How should imports work?" }], created_at: "2025-03-01T10:00:00Z", parent_message_uuid: "00000000-0000-4000-8000-000000000000", attachments: [{ file_name: "notes.txt", extracted_content: "Pasted requirements" }] },
    { uuid: "m2", sender: "assistant", text: "", content: [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: "Normalize first." }, { type: "tool_use", name: "artifacts", input: { title: "Plan", type: "text/markdown", content: "# Plan\n1. Detect" } }, { type: "tool_use", name: "web_search", input: { query: "x" } }], created_at: "2025-03-01T10:01:00Z", parent_message_uuid: "m1" },
    // An abandoned regenerated answer on another branch.
    { uuid: "m2-old", sender: "assistant", text: "Old answer", content: [{ type: "text", text: "Old answer" }], created_at: "2025-03-01T10:00:30Z", parent_message_uuid: "m1" },
  ],
}];

const geminiActivity = [
  { header: "Gemini Apps", title: "Prompted Second question", time: "2025-04-02T08:10:00.000Z", products: ["Gemini Apps"], safeHtmlItem: [{ html: "<p>Answer <strong>two</strong> &amp; more</p><ul><li>a</li><li>b</li></ul>" }] },
  { header: "Gemini Apps", title: "Prompted First question", time: "2025-04-02T08:00:00.000Z", products: ["Gemini Apps"], safeHtmlItem: [{ html: "<p>Answer one</p><pre><code>const x = 1;</code></pre>" }] },
  { header: "Gemini Apps", title: "Prompted Next day", time: "2025-04-03T09:00:00.000Z", products: ["Gemini Apps"], safeHtmlItem: [{ html: "<p>Later</p>" }] },
];

const deepseekExport = [{
  id: "d-1", title: "Search ranking", inserted_at: "2025-02-01T00:00:00Z", updated_at: "2025-02-01T00:10:00Z",
  mapping: {
    root: { id: "root", parent: null, children: ["1"], message: null },
    1: { id: "1", parent: "root", children: ["2", "3"], message: { inserted_at: "2025-02-01T00:00:00Z", fragments: [{ type: "REQUEST", content: "How to rank?" }] } },
    2: { id: "2", parent: "1", children: [], message: { fragments: [{ type: "RESPONSE", content: "First draft" }] } },
    3: { id: "3", parent: "1", children: [], message: { fragments: [{ type: "THINK", content: "hidden" }, { type: "RESPONSE", content: "Use RRF." }] } },
  },
}];

describe("format detection", () => {
  it("tells ChatGPT, Claude and DeepSeek apart by content even with the same file name", () => {
    expect(recordsFromJson(claudeExport, "conversations.json")![0].platform).toBe("claude");
    expect(recordsFromJson(deepseekExport, "conversations.json")![0].platform).toBe("deepseek");
    expect(recordsFromJson([{ id: "g", mapping: { a: { message: { author: { role: "user" } } } } }], "conversations.json")![0].platform).toBe("chatgpt");
    // Unrecognized ChatGPT shards keep reporting per-record errors, as before.
    expect(recordsFromJson([{ id: "part-1" }], "conversations-1.json")![0].platform).toBe("chatgpt");
    expect(recordsFromJson([{ uuid: "p", name: "project", docs: [] }], "projects.json")).toBeUndefined();
  });

  it("reads generic JSON transcripts and labels known platforms", async () => {
    const records = recordsFromJson({ title: "Kimi chat", platform: "Kimi", messages: [{ role: "user", content: "Q" }, { role: "assistant", content: [{ type: "text", text: "A" }] }, { role: "system", content: "ignored" }] }, "kimi.json")!;
    const [capture] = await normalize(records);
    expect(capture.conversation).toMatchObject({ platform: "kimi", title: "Kimi chat", source: "file_import" });
    expect(capture.messages.map(message => [message.role, message.content])).toEqual([["user", "Q"], ["assistant", "A"]]);
    expect(recordsFromJson({ notes: "nothing here" }, "data.json")).toBeUndefined();
  });

  it("reads Markdown transcripts, keeps code blocks intact and ignores ordinary notes", async () => {
    const markdown = "# Orama index\n\n## User\nWhy Orama?\n\n## Claude\nIt runs in the browser.\n\n```ts\nUser: not a speaker inside code\n```\n\n**You said:** And vectors?\n\n**Claude said:** Later.";
    const records = recordsFromMarkdown(markdown, "orama.md")!;
    const [capture] = await normalize(records);
    expect(capture.conversation).toMatchObject({ platform: "claude", title: "Orama index" });
    expect(capture.messages.map(message => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(capture.messages[1].content).toContain("User: not a speaker inside code");
    expect(recordsFromMarkdown("# Notes\n\nQ: one line only\nSome text", "notes.md")).toBeUndefined();
    expect(recordsFromMarkdown("用户：怎么导入？\n豆包：先导出文件。", "doubao.txt")![0].raw).toMatchObject({ platform: "doubao" });
    for(const name of ["千问","通义千问","Qianwen","Qwen"])
      expect(recordsFromMarkdown(`用户：怎么导入？\n${name}：保留顺序。`, "qianwen.txt")![0].raw).toMatchObject({platform:"qwen",messages:[{role:"user",content:"怎么导入？"},{role:"assistant",content:"保留顺序。"}]});
  });

  it("reads nested export collections and structured sender labels without user conversion", async () => {
    const data={result:{data:{chats:[
      {title:"First chat",platform:"qwen",chatHistory:[{sender:{role:"user"},text:"Question one"},{sender:{name:"assistant"},text:"Answer one"}]},
      {title:"Second chat",platform:"grok",messages:[{role:"user",content:"Question two"},{role:"assistant",content:"Answer two"}]},
    ]}}};
    const captures=await normalize(recordsFromJson(data,"original-export.json"));
    expect(captures.map(capture=>[capture.conversation.platform,capture.conversation.title])).toEqual([["qwen","First chat"],["grok","Second chat"]]);
    expect(captures.map(capture=>capture.messages.map(message=>message.content))).toEqual([["Question one","Answer one"],["Question two","Answer two"]]);
    expect(recordsFromJson({data:{items:[{text:"Without speaker metadata"},{text:"Still no speaker"}]}},"notes.json")).toBeUndefined();
  });

  it("reads bold and inline Markdown speaker headings while retaining fenced examples", async () => {
    const markdown="# Exported chat\n## **用户**\n问题一\n### **Kimi:** 回答一\n```md\n## User: this is code\n```\n## User: Question two\n## Kimi: Answer two";
    const [capture]=await normalize(recordsFromMarkdown(markdown,"original.md"));
    expect(capture.conversation.platform).toBe("kimi");
    expect(capture.messages.map(message=>message.role)).toEqual(["user","assistant","user","assistant"]);
    expect(capture.messages[1].content).toContain("## User: this is code");
    expect(capture.messages[2].content).toBe("Question two");
  });
});

describe("platform normalization", () => {
  it("keeps Claude's active branch, artifacts and attachments, and drops thinking and tools", async () => {
    const [capture] = await normalize(recordsFromJson(claudeExport, "conversations.json"));
    expect(capture.conversation).toMatchObject({ id: "claude:c-1", platform: "claude", url: "https://claude.ai/chat/c-1", title: "Import design", source: "claude_export", sourceRevision: "rev" });
    expect(capture.messages.map(message => message.platformMessageId)).toEqual(["m1", "m2"]);
    expect(capture.messages[0].content).toContain("Pasted requirements");
    expect(capture.messages[1].content).toContain("Normalize first.");
    expect(capture.messages[1].content).toContain("# Plan");
    expect(capture.messages[1].content).not.toMatch(/private reasoning|web_search|Old answer/u);
    expect(capture.messages[1].replyToMessageId).toBe(capture.messages[0].id);
    expect(capture.messages[0].sourceCreatedAt).toBe(Date.parse("2025-03-01T10:00:00Z"));
  });

  it("groups Gemini Takeout activity into chronological sessions with readable answers", async () => {
    const records = recordsFromJson(geminiActivity, "Takeout/My Activity/Gemini Apps/MyActivity.json")!;
    expect(records.map(record => record.platform)).toEqual(["gemini", "gemini"]);
    const [first, second] = await normalize(records);
    expect(first.conversation).toMatchObject({ platform: "gemini", title: "First question", url: "", source: "gemini_takeout" });
    expect(first.messages.map(message => message.content)).toEqual(["First question", "Answer one\n\n```\nconst x = 1;\n```", "Second question", "Answer **two** & more\n\n- a\n- b"]);
    expect(second.messages).toHaveLength(2);
    // The same activity yields the same session ID on a later export.
    const again = await normalize(recordsFromJson([...geminiActivity].reverse(), "MyActivity.json"));
    expect(again[0].conversation.id).toBe(first.conversation.id);
  });

  it("decodes Gemini HTML entities without a DOM", () => {
    expect(geminiHtmlText("<p>a&lt;b &#x4E2D;&#25991;</p><br>c")).toBe("a<b 中文\n\nc");
  });

  it("follows DeepSeek's latest regenerated answer and skips reasoning", async () => {
    const [capture] = await normalize(recordsFromJson(deepseekExport, "conversations.json"));
    expect(capture.conversation).toMatchObject({ id: "deepseek:d-1", platform: "deepseek", title: "Search ranking" });
    expect(capture.messages.map(message => [message.role, message.content])).toEqual([["user", "How to rank?"], ["assistant", "Use RRF."]]);
  });
});

describe("end-to-end import", () => {
  beforeEach(async () => {
    const db = await getDatabase();
    await db.clear("conversations");
    await db.clear("messages");
  });

  it("saves Claude, Gemini and Markdown conversations and skips unchanged re-imports", async () => {
    const first = await importConversationExport(file("conversations.json", claudeExport), undefined, true);
    expect(first).toMatchObject({ added: 1, failed: 0, platforms: { claude: 1 } });
    expect(await getConversation("claude:c-1")).toMatchObject({ platform: "claude", importState: "complete", messageCount: 2 });
    expect(await getMessagesForConversation("claude:c-1")).toHaveLength(2);
    expect(await importConversationExport(file("conversations.json", claudeExport), undefined, true)).toMatchObject({ added: 0, unchanged: 1 });

    expect(await importConversationExport(file("MyActivity.json", geminiActivity), undefined, true)).toMatchObject({ added: 2, platforms: { gemini: 2 } });
    expect(await importConversationExport(file("chat.md", "## User\nHi\n## Assistant\nHello"), undefined, true)).toMatchObject({ added: 1, platforms: { other: 1 } });
  });

  it("rejects files that contain no conversations without touching saved data", async () => {
    await importConversationExport(file("conversations.json", claudeExport), undefined, true);
    await expect(importConversationExport(file("notes.md", "# Just notes"), undefined, true)).rejects.toThrow("No conversations");
    expect(await getMessagesForConversation("claude:c-1")).toHaveLength(2);
  });

  it("lists records from a plain JSON file without the worker", async () => {
    const platforms: string[] = [];
    for await (const record of readImportRecords(file("conversations.json", deepseekExport))) platforms.push(record.platform);
    expect(platforms).toEqual(["deepseek"]);
  });
});
