import { describe, expect, it } from "vitest";
import type { FocusSession } from "./focus-session";
import { focusMarkdown } from "./focus-markdown";
import {leakedClaims} from "../test/claims-prose-fixture";

const session: FocusSession = {
  id: "session", locale: "zh-CN", title: "自动化学习计划", goal: "自动化学习计划", mode: "review",
  sourceConversationIds: ["conversation"],
  evidence: Array.from({ length: 40 }, (_, index) => ({ id: `e${index + 1}`, conversationId: "conversation", messageId: `message-${index}`, title: "学习讨论", excerpt: `原始问题 ${index + 1}` })),
  sections: [{ id: "chapter", title: "源码阅读", kind: "review", body: "# 源码阅读\n\n复习 / Review\n\n理解多态机制[e18]，逐层拆解代码[e20][e30]。\n\n## 工程实践\n\n先复现，再验证。", transition: "接着阅读下一部分。", evidenceIds: ["e18", "e20", "e30"] }],
  activeSectionId: "chapter", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1,
};

describe("readable Markdown export", () => {
  it("omits generated claims rows in exports but keeps personal prose and underlying evidence",()=>{
    const value={...session,sections:[{...session.sections[0],body:`保留 Notion 与 Find → Verify → Update → Reuse。\n\n${leakedClaims}`} ]},before=structuredClone(value);
    const text=focusMarkdown(value);expect(text).not.toContain("evidenceIds:");expect(text).not.toContain("Claims:");expect(text).toContain("Find → Verify → Update → Reuse");expect(text).toContain("原始问题");expect(value).toEqual(before);
    value.sections[0]={...value.sections[0],userEdited:true};expect(focusMarkdown(value)).toContain("evidenceIds:");
  });
  it("exports project and chapter responsibilities and feedback with names, without changing source evidence", () => {
    const one = { ...session.sections[0], id: "one", title: "生成模块", responsibility: "生成候选方案", understandingLinks: [{ targetId: "two", kind: "flow" as const }] };
    const two = { ...session.sections[0], id: "two", title: "校验模块", understandingLinks: [{ targetId: "one", kind: "feedback" as const }] };
    const value = { ...session, sections: [one, { ...two, understandingPath: [{ ...one, understandingLinks: [{ targetId: "two", kind: "flow" as const }] }, two] }] };
    const copy = structuredClone(value), text = focusMarkdown(value);
    expect(text).toContain("我的说明：生成候选方案");
    expect(text).toContain("我的关系：生成模块 → 输出给 → 校验模块");
    expect(text).toContain("我的关系：校验模块 → 反馈至 → 生成模块");
    expect(focusMarkdown(value, { locale: "en" })).toContain("My relation：校验模块 → Feedback to → 生成模块");
    expect(value).toEqual(copy);
  });
  it("exports personal relations as readable concept names in the selected language", () => {
    const first = { ...session.sections[0], id: "first", title: "矩阵", understandingLinks: [{ targetId: "second", kind: "requires" as const }, { targetId: "missing", kind: "contains" as const }] };
    const second = { ...session.sections[0], id: "second", title: "极点" };
    const value = { ...session, sections: [{ ...session.sections[0], understandingPath: [first, second] }] };
    expect(focusMarkdown(value)).toContain("我的关系：矩阵 → 是前提 → 极点");
    expect(focusMarkdown(value, { locale: "en" })).toContain("My relation：矩阵 → Prerequisite → 极点");
    expect(focusMarkdown(value)).not.toContain("missing");
  });
  it("has one document title, removes repeated opening headings and mode captions, and uses subordinate body headings", () => {
    const text = focusMarkdown({ ...session, sections: [{ ...session.sections[0], title: session.title, body: `# ${session.title}\n\n${session.title}\n${"=".repeat(8)}\n\n复习 / Review\n\n正文[e1]。\n\n# 实践\n\n## 验证` }] });
    expect(text.match(/^# .+$/gmu)).toEqual([`# ${session.title}`]);
    expect(text.split(session.title)).toHaveLength(2);
    expect(text).toContain("## 实践\n\n### 验证");
    expect(text).not.toMatch(/复习\s*\/\s*Review|\[e\d+\]|接着阅读下一部分/u);
    expect(text).not.toContain("整理目标");
  });

  it("replaces long numbered citation trailers with grouped, deduplicated original passages", () => {
    const text = focusMarkdown({ ...session, evidence: [...session.evidence, { ...session.evidence[0], id: "duplicate" }] }, { conversations: [{ id: "conversation", title: "学习讨论", url: "https://chatgpt.com/c/discussion" }] });
    expect(text).toContain("## 源码阅读\n\n理解多态机制，逐层拆解代码。");
    expect(text).toContain("### 工程实践");
    expect(text).toContain("### [学习讨论](https://chatgpt.com/c/discussion)");
    expect(text).toContain("<summary>引用片段 · 40</summary>");
    expect(text.match(/^> 原始问题 1$/gmu)).toHaveLength(1);
    expect(text).not.toMatch(/\[\d+\]|\[e\d+\]|conversation \/ message-/u);
  });

  it("preserves code, formulas, numeric arrays and real links while cleaning only generated annotation syntax", () => {
    const code = "```python\n# 源码阅读\na = [182, 183]\nprint('[e18]')\n```";
    const body = `${code}\n\n    # indented code [e2]\n\n公式 $x[e3]$，代码 \`value[e4]\`，数组 [1, 2]，科学计数 1e10。\n\n$$\n# math[e5]\n$$\n\n[原文 e6](https://example.com/e6) 与 [e7][reference]，真实脚注[^e8]。\n\n[e7]: https://example.com/source\n[^e8]: 原始脚注定义\n\n说明[e9]。`;
    const text = focusMarkdown({ ...session, sections: [{ ...session.sections[0], body }] });
    expect(text).toContain(code);
    expect(text).toContain("    # indented code [e2]");
    expect(text).toContain("$x[e3]$");
    expect(text).toContain("`value[e4]`");
    expect(text).toContain("数组 [1, 2]，科学计数 1e10");
    expect(text).toContain("$$\n# math[e5]\n$$");
    expect(text).toContain("[原文 e6](https://example.com/e6)");
    expect(text).toContain("[e7][reference]");
    expect(text).toContain("真实脚注[^e8]。");
    expect(text).toContain("[^e8]: 原始脚注定义");
    expect(text).not.toContain("说明[e9]");
  });

  it("keeps personal edits and old note sources, excludes deleted notes, and never creates source URLs", () => {
    const userBody = "我的标记[e99]\n\n# 自己的论证";
    const personal = { ...session.sections[0], id: "personal", title: "我的补充", body: userBody, origin: "user" as const };
    const value: FocusSession = { ...session, sections: [{ ...session.sections[0], understandingPath: [{ ...session.sections[0], id: "generated", title: "多态", body: "不重复的生成解释" }, personal] }],
      notes: "个人记录[e98]", sectionNotes: { chapter: { text: "补充说明[e97]", evidenceIds: [], sources: [{ ...session.evidence[0], messageId: "old-message", excerpt: "旧版本的原始问题" }], updatedAt: 1 } },
      detachedNotes: [{ title: "已删除", text: "不应导出", deletedAt: 2 }, { title: "独立笔记", text: "我的记录[e96]" }],
    };
    const original = structuredClone(value);
    const text = focusMarkdown(value, { conversations: [{ id: "conversation", title: "讨论", url: "javascript:alert(1)" }] });
    expect(text).toContain(userBody.replace("# 自己的论证", "##### 自己的论证"));
    expect(text).toContain("个人记录[e98]");
    expect(text).toContain("补充说明[e97]");
    expect(text).toContain("我的记录[e96]");
    expect(text).toContain("> 旧版本的原始问题");
    expect(text).not.toMatch(/不重复的生成解释|不应导出|javascript:|old-message/u);
    expect(value).toEqual(original);
  });

  it("uses one export language and retains the distinction between suggestions and confirmed history", () => {
    const text = focusMarkdown({ ...session, sections: [{ ...session.sections[0], kind: "proposal" }] }, { locale: "en" });
    expect(text).toContain("> AI proposal");
    expect(text).toContain("## Source conversations");
    expect(text).toContain("<summary>Quoted passages · 40</summary>");
    expect(text).not.toMatch(/复习\s*\/\s*Review|来源对话|引用片段/u);
  });
});
