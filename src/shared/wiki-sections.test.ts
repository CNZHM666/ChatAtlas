import { expect, it } from "vitest";
import type { WikiKnowledgeLedger, WikiKnowledgeUnit } from "./wiki-knowledge";
import { messageSection, withWikiSections } from "./wiki-sections";

const SEP = "==================================================";
const message = [
  "# 14. 产品整体布局", "", "工作台顶部工具栏高度约 44~50px。", "",
  SEP, "九、首页 Header", SEP, "", "Header 高度：", "", "约 56~64px。", "", "左侧：极简 Logo", "",
  SEP, "十二、圆角", SEP, "", "统一控制：", "", "6px~8px", "",
  SEP, "", "标题：", "", "需要这些零件", "", "改成 Compact Component Rows。", "", "圆角 10~12px，内边距 14~16px。", "",
  "1. 纯黑背景", "2. 霓虹线条",
].join("\n");

it("finds the heading a quote stands under, above it or opening it", () => {
  // The quote starts at the separator closing the heading: the heading is above.
  expect(messageSection(message, `${SEP}\n\nHeader 高度：\n\n约 56~64px。`)).toBe("首页 Header");
  // The quote opens with the heading block.
  expect(messageSection(message, `${SEP}\n十二、圆角\n${SEP}\n\n统一控制：\n\n6px~8px`)).toBe("圆角");
  // A title label names what follows.
  expect(messageSection(message, `${SEP}\n\n标题：\n\n需要这些零件\n\n改成 Compact Component Rows。`)).toBe("需要这些零件");
  // A markdown heading above; numbered list items are not headings.
  expect(messageSection(message, "工作台顶部工具栏高度约 44~50px。")).toBe("产品整体布局");
  expect(messageSection(message, "2. 霓虹线条")).toBe("需要这些零件");
  // Whitespace may differ between the quote and the message.
  expect(messageSection(message, "Header 高度： 约 56~64px。")).toBe("首页 Header");
  expect(messageSection(message, "不在消息里的一句话。")).toBeUndefined();
});

it("gives each unit its section unless its statement names it already", () => {
  const unit = (id: string, statement: string, quote: string): WikiKnowledgeUnit => ({ id, subject: "Header", statement, kind: "constraint", details: [], evidence: { evidenceId: id, conversationId: "c", messageId: "m", messageIndex: 3, role: "assistant", pasted: false, quote }, adoption: { status: "proposal" }, delivery: "unknown" });
  const ledger = { version: 1, generatedAt: 0, status: "complete", materials: 1, batches: [{ sourceIds: [], signature: "", status: "complete", units: [
    unit("a", "高度约56~64px，左侧为Logo。", `${SEP}\n\nHeader 高度：\n\n约 56~64px。`),
    unit("b", "首页 Header 高度约56~64px。", `${SEP}\n\nHeader 高度：\n\n约 56~64px。`),
  ] }] } as unknown as WikiKnowledgeLedger;
  const out = withWikiSections(ledger, [{ id: "other", conversationId: "c", messageIndex: 3, content: message }]);
  expect(out.batches[0].units.map(item => item.evidence.section)).toEqual(["首页 Header", undefined]);
  expect(withWikiSections(ledger, [])).toBe(ledger);
});
