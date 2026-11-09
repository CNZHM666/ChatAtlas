import { expect, it } from "vitest";
import { droppedContainedRepeats, splitUnrelatedSentences } from "./wiki-paragraph-repeats";
import { claimSupported } from "./wiki-claim-support";
import { pastCapabilityWords, plannedCapabilityWords } from "./wiki-capability-state";
import { mergeOverlappingRows } from "./wiki-draft-checks";
import { withHolderMarks } from "../shared/wiki-holder";
import type { WikiDraftChapter, WikiKnowledgeUnit, WikiUnitStatus } from "../shared/wiki-knowledge";

const unit = (id: string, statement: string, index = 1, role: "user" | "assistant" = "assistant"): WikiKnowledgeUnit => ({ id, statement, subject: "界面", kind: "constraint", details: [], adoption: { status: "proposal" }, delivery: "unknown", evidence: { evidenceId: id, messageId: id, conversationId: "c", messageIndex: index, role, pasted: false, quote: statement } });
const chapterOf = (text: string, claims: Array<{ text: string; unitIds: string[] }>, body = text): WikiDraftChapter => ({ id: "ch", title: "界面", question: "", group: "", body, paragraphs: [{ subtopic: "界面", text, unitIds: [...new Set(claims.flatMap(claim => claim.unitIds))], claims }], problems: [] });

it("drops a sentence its paragraph already says in full, and a condition the next clause repeats", () => {
  const first = "界面标签统一为中文，保留 ESP32、GPIO、I²C、BOM、MOSFET 等标准技术词的英文写法。", second = "标准技术词如 ESP32、I²C、GPIO、BOM 在中文界面中继续保留英文。";
  const chapter = chapterOf(first + second, [{ text: first, unitIds: ["a"] }, { text: second, unitIds: ["b"] }]);
  expect(droppedContainedRepeats([chapter])).toBe(1);
  expect(chapter.body).toBe(first);
  expect(chapter.paragraphs[0].claims).toEqual([{ text: first, unitIds: ["a", "b"] }]);
  const said = "若识别出市电、高压、膨胀电池等危险部件，疑似市电、裸高压、膨胀电池等危险部件返回安全提示并停止生成。";
  const danger = chapterOf(said, [{ text: said, unitIds: ["c"] }]);
  expect(droppedContainedRepeats([danger])).toBe(1);
  expect(danger.body).toBe("疑似市电、裸高压、膨胀电池等危险部件返回安全提示并停止生成。");
  // A sentence giving another value is not said already.
  const more = "主按钮圆角为 8px，悬停时保持克制的过渡。次按钮圆角为 12px，悬停时保持克制的过渡。";
  expect(droppedContainedRepeats([chapterOf(more, [{ text: more, unitIds: ["d"] }])])).toBe(0);
});

it("gives a sentence about something else its own paragraph, and keeps a sentence leaning on the one before", () => {
  const a = "页面切换使用 200ms 淡入淡出，面板展开不超过 250ms。", b = "本轮仅预留建模接口，不开发 CAD 与外壳模型。";
  const chapter = chapterOf(a + b, [{ text: a, unitIds: ["a"] }, { text: b, unitIds: ["b"] }]);
  expect(splitUnrelatedSentences([chapter])).toBe(1);
  expect(chapter.body).toBe(`${a}\n\n${b}`);
  expect(chapter.paragraphs.map(paragraph => paragraph.unitIds)).toEqual([["a"], ["b"]]);
  const leaning = "统一定义视觉相关错误码，便于前端提示。涉及 VISION_TIMEOUT 与 VISION_BLOCKED 两种。";
  expect(splitUnrelatedSentences([chapterOf(leaning, [{ text: "统一定义视觉相关错误码，便于前端提示。", unitIds: ["a"] }, { text: "涉及 VISION_TIMEOUT 与 VISION_BLOCKED 两种。", unitIds: ["b"] }])])).toBe(0);
});

it("lets a value come from the cited unit its own clause is about, and a palette from its colours", () => {
  const radius = unit("r", "全局圆角 6px~8px，保持克制。"), input = unit("i", "输入框圆角 20~26px，组件卡片圆角 10~12px。");
  expect(claimSupported("全局圆角 6px~8px；但输入框 20~26px、组件卡片圆角 10~12px 另有取值。", [radius, input])).toBe(true);
  expect(claimSupported("全局圆角 6px~8px；但输入框 30~36px 另有取值。", [radius, input])).toBe(false);
  const dark = unit("d", "Dark 主背景 #0F0F10，面板 #111112，卡片 #151516，边框 #27272A。");
  expect(claimSupported("Dark / #0F0F10 / #111112 / #151516 / #27272A", [dark])).toBe(true);
  // A cell of one colour is the unit's that gives it.
  expect(claimSupported("#111112", [dark])).toBe(true);
  expect(claimSupported("#222223", [dark])).toBe(false);
});

it("tells a lack the discussion went past as earlier, and a check still missing as planned", () => {
  const report = unit("rep", "Validator 不完全检查电压和 GPIO 冲突。", 5, "user");
  const said = "当前画布仅为架构预览，Validator 尚未完全检查电压和 GPIO 冲突。";
  const past = chapterOf(said, [{ text: said, unitIds: [report.id] }]);
  // The paragraph is also the chapter's opening: both change.
  expect(pastCapabilityWords([past], new Map([[report.id, "Validator"]]))).toBe(2);
  expect(past.body).toBe("此前画布仅为架构预览，Validator 尚未完全检查电压和 GPIO 冲突。");
  const opening = "规则引擎实时检查电压和 GPIO 冲突以发现常见错误。";
  const chapter = chapterOf("Validator 不完全检查电压和 GPIO 冲突。", [{ text: "Validator 不完全检查电压和 GPIO 冲突。", unitIds: [report.id] }], `${opening}\n\n### 现状\n\nValidator 不完全检查电压和 GPIO 冲突。`);
  expect(plannedCapabilityWords([chapter], [report], new Map<string, WikiUnitStatus>([[report.id, "reported"]]))).toBe(1);
  expect(chapter.body.startsWith("规则引擎计划实时检查电压")).toBe(true);
  const identifies = chapterOf("Validator 不完全检查电压和 GPIO 冲突。", [{ text: "Validator 不完全检查电压和 GPIO 冲突。", unitIds: [report.id] }], "规则引擎在确保结构一致的同时识别电压、GPIO 冲突等常见错误。\n\n### 现状\n\nValidator 不完全检查电压和 GPIO 冲突。");
  expect(plannedCapabilityWords([identifies], [report], new Map<string, WikiUnitStatus>([[report.id, "reported"]]))).toBe(1);
  expect(identifies.body).toContain("同时计划识别电压");
});

it("merges a two-column row told twice with one verdict", () => {
  const table = "| 事项 | 第一版 |\n| --- | --- |\n| 数据库 | 不引入，项目数据暂存于 localStorage |\n| 实时全网比价 | 不实现，仅提供 Procurement Spec、中英文搜索词和 Marketplace Adapter 接口，引导用户自行购买缺失零件 |\n| 比价 API 对接 | 不实现，输出缺件清单及对应的中英文标准化搜索关键词，提供复制按钮供用户自行搜索 |";
  const { text, merged } = mergeOverlappingRows(table);
  expect(merged).toBe(1);
  expect(text).toContain("| 实时全网比价、比价 API 对接 | 不实现，");
  expect(text).toContain("| 数据库 |");
});

it("marks a list row on its own line, not after the next paragraph's first sentence", () => {
  const text = "- Dark / #0F0F10 / #111112\n\n新的配色更暗。后来定稿。";
  expect(withHolderMarks(text, [{ text: "Dark / #0F0F10 / #111112", holder: "earlier" }], true)).toBe("- Dark / #0F0F10 / #111112〔此前〕\n\n新的配色更暗。后来定稿。");
});
