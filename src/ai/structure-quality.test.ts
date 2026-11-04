import { describe, expect, it } from "vitest";
import { evaluateStructureQuality } from "./structure-quality";

describe("structure quality judge", () => {
  it("rejects over-segmentation and generic chapter titles", () => {
    const result = evaluateStructureQuality({ questionCount: 10, chapterTitles: ["学习研究", "继续讨论", "A", "B", "C", "D", "E", "F"], relationCount: 18, bridgeCount: 7, coveredQuestionCount: 10 });
    expect(result).toMatchObject({ accepted: false, overSegmented: true, poorCompression: true, tooManyRelations: true, tooManyBridges: true });
    expect(result.genericTitles).toEqual(["学习研究", "继续讨论"]);
  });

  it("accepts a compact, fully traced backbone", () => {
    expect(evaluateStructureQuality({ questionCount: 66, chapterTitles: ["产品定位", "Canvas 架构", "历史导入", "自动整理", "知识空间", "发布验证"], relationCount: 8, bridgeCount: 2, coveredQuestionCount: 66 }).accepted).toBe(true);
  });

  it("rejects adjacent duplicate and question-like titles before display", () => {
    const result = evaluateStructureQuality({ questionCount: 20, chapterTitles: ["产品定位", "产品定位", "Canvas结构", "Canvas 架构", "你有没有更大胆更有想象力"], relationCount: 4, bridgeCount: 0, coveredQuestionCount: 20 });
    expect(result.accepted).toBe(false);
    expect(result.duplicateChapters).toEqual([["产品定位", "产品定位"], ["Canvas结构", "Canvas 架构"]]);
    expect(result.questionLikeTitles).toEqual(["你有没有更大胆更有想象力"]);
  });

  it("allows a topic to return after a different reading stage", () => {
    const result = evaluateStructureQuality({ questionCount: 20, chapterTitles: ["产品定位", "界面设计", "产品定位"], relationCount: 2, bridgeCount: 0, coveredQuestionCount: 20 });
    expect(result.duplicateChapters).toEqual([]);
    expect(result.accepted).toBe(true);
  });
});
