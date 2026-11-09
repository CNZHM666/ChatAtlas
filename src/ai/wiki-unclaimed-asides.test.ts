import { describe, expect, it } from "vitest";
import { type WikiDraftChapter, type WikiKnowledgeUnit, type WikiUnitStatus } from "../shared/wiki-knowledge";
import { droppedEchoTables, droppedOverriddenDefaults, droppedReplacedClauses, droppedStatusAsides } from "./wiki-unclaimed-asides";

const chapter = (paragraphs: WikiDraftChapter["paragraphs"]): WikiDraftChapter => ({ id: "c", title: "界面", question: "", group: "", body: paragraphs.map(paragraph => paragraph.text).join("\n\n"), paragraphs, problems: [] });

describe("status asides", () => {
  it("drops status talk no claim gives, after an earlier plan and for a code turned into words", () => {
    const early = "早期方案中间放置宽约 600～720px 的输入框及 CTA。", button = "按钮文案定为“生成硬件方案”，避免使用 Generate IR。";
    const written = chapter([
      { subtopic: "首页", text: `${early}这一布局已被后续更紧凑的设计取代，不再作为当前标准。`, unitIds: ["u1"], claims: [{ text: early, unitIds: ["u1"] }] },
      { subtopic: "首页", text: `${button}该决策旨在保持界面语言的自然性，但具体实现细节仍需进一步澄清。`, unitIds: ["u2"], claims: [{ text: button, unitIds: ["u2"] }] },
    ]);
    expect(droppedStatusAsides([written])).toBe(2);
    expect(written.paragraphs.map(paragraph => paragraph.text)).toEqual([early, button]);
    expect(written.body).toBe(`${early}\n\n${button}`);
  });

  it("keeps a status sentence a claim states, and paragraphs with no claims", () => {
    const told = "旧的宽度已被 760~800px 取代。";
    const claimed = chapter([{ subtopic: "首页", text: `输入框居中。${told}`, unitIds: ["u1"], claims: [{ text: told, unitIds: ["u1"] }] }]);
    const unclaimed = chapter([{ subtopic: "首页", text: "输入框居中。该方案仍需确认。", unitIds: ["u1"] }]);
    expect(droppedStatusAsides([claimed, unclaimed])).toBe(0);
    expect(unclaimed.paragraphs[0].text).toBe("输入框居中。该方案仍需确认。");
  });
});

describe("echo tables", () => {
  it("drops a table telling another paragraph's units again cell by cell", () => {
    const prose = "AI 负责理解，程序负责执行，Validator 负责否决。", table = "| 模块 | 负责 |\n| --- | --- |\n| AI | 理解 |\n| 程序 | 执行 |";
    const written = chapter([{ subtopic: "原则", text: prose, unitIds: ["u1"] }, { subtopic: "原则", text: table, unitIds: ["u1"] }]);
    expect(droppedEchoTables([written])).toBe(1);
    expect(written.paragraphs.map(paragraph => paragraph.text)).toEqual([prose]);
    expect(written.body).toBe(prose);
  });

  it("keeps a table with something the prose does not say", () => {
    const table = "| 事项 | 第一版 |\n| --- | --- |\n| 数据库 | 不引入 |";
    const written = chapter([{ subtopic: "范围", text: "第一版不引入登录。", unitIds: ["u1"] }, { subtopic: "范围", text: table, unitIds: ["u1"] }]);
    expect(droppedEchoTables([written])).toBe(0);
    expect(written.paragraphs).toHaveLength(2);
  });
});

describe("replaced clauses", () => {
  it("drops the writer's own account of what replaced an earlier version, and leaves current paragraphs alone", () => {
    const statuses = new Map<string, WikiUnitStatus>([["old", "history"], ["now", "proposal"]]);
    const dark = "早期曾采用深色模式（主背景 #0D0D0D ~ #111111），现已替换为上述浅色规范。", hero = "早期曾采用极简 Hero，禁止营销文案；该方案已被当前的极简设计取代。";
    const written = chapter([
      { subtopic: "配色", text: `主背景接近 #FAFAFA。${dark}`, unitIds: ["now", "old"], claims: [{ text: "主背景接近 #FAFAFA。", unitIds: ["now"] }, { text: dark, unitIds: ["old"] }] },
      { subtopic: "首页", text: hero, unitIds: ["old"], claims: [{ text: hero, unitIds: ["old"] }] },
      { subtopic: "组件", text: "旧组件已被新的 Inspector 取代。", unitIds: ["now"], claims: [{ text: "旧组件已被新的 Inspector 取代。", unitIds: ["now"] }] },
    ]);
    expect(droppedReplacedClauses([written], statuses)).toBe(2);
    expect(written.paragraphs.map(paragraph => paragraph.text)).toEqual(["主背景接近 #FAFAFA。早期曾采用深色模式（主背景 #0D0D0D ~ #111111）。", "早期曾采用极简 Hero，禁止营销文案。", "旧组件已被新的 Inspector 取代。"]);
    expect(written.paragraphs[0].claims?.[1].text).toBe("早期曾采用深色模式（主背景 #0D0D0D ~ #111111）。");
    expect(written.body).not.toContain("现已替换");
  });
});

describe("overridden defaults", () => {
  const said = (id: string, conversationId: string, messageIndex: number, statement: string, conversationSpan?: { start?: number; end?: number }) => [id, { id, subject: "", statement, kind: "decision", details: [], evidence: { evidenceId: id, conversationId, messageId: id, messageIndex, role: "assistant", pasted: false, quote: statement, ...(conversationSpan ? { conversationSpan } : {}) }, adoption: { status: "proposal" }, delivery: "unknown" } as WikiKnowledgeUnit] as const;
  const units = new Map([
    said("byok", "c1", 50, "采用 BYOK 模式，默认仅保存在当前浏览器会话中，不保存到服务器。", { start: 1, end: 10 }),
    said("key", "c1", 53, "默认将 API Key 仅保存在运行时内存，刷新即消失。", { start: 1, end: 10 }),
    // Another conversation held at the same time: which came later cannot be told.
    said("other", "c2", 90, "默认将 API Key 仅保存在运行时内存。", { start: 5, end: 20 }),
    // One held after it ended: it came later.
    said("after", "c3", 2, "默认将 API Key 仅保存在运行时内存。", { start: 30, end: 40 }),
  ]);
  const byok = "采用 BYOK 模式，默认仅保存在当前浏览器会话中，不保存到服务器。", key = "- **Key存储**：默认将 API Key 仅保存在运行时内存，刷新即消失。";

  it("drops an earlier storage default when a later message's default is told in the same paragraph", () => {
    const written = chapter([{ subtopic: "密钥", text: `- **BYOK模式**：${byok}\n${key}`, unitIds: ["byok", "key"], claims: [{ text: byok, unitIds: ["byok"] }] }]);
    const trimmed = new Set<string>();
    expect(droppedOverriddenDefaults([written], id => units.get(id), trimmed)).toBe(1);
    // The decision check is told, so it does not write the old default back.
    expect([...trimmed]).toEqual(["byok"]);
    expect(written.paragraphs[0].text).toBe(`- **BYOK模式**：采用 BYOK 模式，不保存到服务器。\n${key}`);
    expect(written.paragraphs[0].claims?.[0].text).toBe("采用 BYOK 模式，不保存到服务器。");
    expect(written.body).toBe(written.paragraphs[0].text);
  });

  it("keeps the default when the other one is from a conversation held at the same time or not cited, and drops it for one held after", () => {
    const other = chapter([{ subtopic: "密钥", text: `${byok}\n${key}`, unitIds: ["byok", "other"], claims: [{ text: byok, unitIds: ["byok"] }] }]);
    const alone = chapter([{ subtopic: "密钥", text: `${byok}\n${key}`, unitIds: ["byok"], claims: [{ text: byok, unitIds: ["byok"] }] }]);
    expect(droppedOverriddenDefaults([other, alone], id => units.get(id))).toBe(0);
    const after = chapter([{ subtopic: "密钥", text: `${byok}
${key}`, unitIds: ["byok", "after"], claims: [{ text: byok, unitIds: ["byok"] }] }]);
    expect(droppedOverriddenDefaults([after], id => units.get(id))).toBe(1);
  });
});
