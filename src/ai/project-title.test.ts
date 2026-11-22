import { expect, it } from "vitest";
import { fallbackProjectTitle } from "./project-title";
import { wikiProjectTitleFromLedger, wikiProjectTitleSuggestion } from "../shared/wiki-project-boundary";
import { projectSession } from "../test/project-fixture";
import type { WikiKnowledgeLedger, WikiKnowledgeUnit } from "../shared/wiki-knowledge";

it("titles a project by its topic or its conversations, never by the request asking for it", () => {
  // The workbench's own request names nothing: the conversation's title.
  expect(fallbackProjectTitle("把全部已选对话整理成一个项目", ["Python 入门与开源贡献"], true)).toBe("Python 入门与开源贡献");
  expect(fallbackProjectTitle("Create a project from all selected conversations", ["Budget app", "Budget v2"], false)).toBe("Budget app and 1 more");
  expect(fallbackProjectTitle("把全部已选对话整理成一个项目", ["规划番茄钟扩展 MVP", "专注计时器V0.1评审"], true)).toBe("规划番茄钟扩展 MVP 等 2 个对话");
  // A request naming its topic gives the topic; a goal written as such stays.
  expect(fallbackProjectTitle("帮我整理成一个项目：专注计时器", ["a"], true)).toBe("专注计时器");
  expect(fallbackProjectTitle("番茄钟扩展第一版", ["a"], true)).toBe("番茄钟扩展第一版");
});

it("uses the in-scope product, preferring an author-given name over the directory's description", () => {
  const point: WikiKnowledgeUnit = {
    id: "scope", subject: "产品定位", statement: "面向初学者的 AI 硬件设计工具。", kind: "fact", details: [],
    adoption: { status: "unknown" }, delivery: "unknown",
    evidence: { evidenceId: "e", conversationId: "c", messageId: "m", messageIndex: 0, role: "user", pasted: false,
      quote: "产品是面向初学者的自然语言硬件设计工作台。" },
  };
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 1, status: "complete", materials: 1,
    batches: [{ sourceIds: ["e"], status: "ok", units: [point], rejected: {} }],
    sources: { c: { platform: "chatgpt", title: "硬件AI方向推荐" } },
    organization: { version: 1, generatedAt: 1, status: "complete", subjects: [{ id: "s", name: "产品定位", aliases: [], unitIds: [point.id] }],
      merged: [], chapters: [], relations: [], report: {}, documentTitle: "AI 硬件设计工作台" },
  };
  const titles = ["硬件AI方向推荐"];
  expect(wikiProjectTitleFromLedger(ledger, titles)).toBe("AI 硬件设计工作台");
  expect(wikiProjectTitleSuggestion({ ...projectSession(), title: titles[0], wikiKnowledge: ledger })).toBe("AI 硬件设计工作台");
  expect(wikiProjectTitleSuggestion({ ...projectSession(), title: "我的自定义项目名", wikiKnowledge: ledger })).toBeUndefined();

  const named = { ...point, evidence: { ...point.evidence, quote: "这个项目叫「画布工坊」。" } };
  const withPoint = (unit: WikiKnowledgeUnit) => ({ ...ledger, batches: [{ ...ledger.batches[0], units: [unit] }] });
  expect(wikiProjectTitleFromLedger(withPoint(named), titles)).toBe("画布工坊");
  expect(wikiProjectTitleFromLedger(withPoint({ ...named, about: { name: "画布工坊", role: "competitor" } }), titles)).toBeUndefined();
  expect(wikiProjectTitleFromLedger({ ...ledger, scopeAnswers: { "ai硬件设计工作台": "exclude" } }, titles)).toBeUndefined();
});
