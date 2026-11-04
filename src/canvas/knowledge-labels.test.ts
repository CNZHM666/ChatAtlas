import { describe, expect, it } from "vitest";
import { shortDomainTitle } from "./knowledge-labels";

describe("overview title", () => {
  it("keeps long knowledge-space names within the overview card", () => {
    expect(shortDomainTitle("AI对话知识沉淀与学习路线管理", "zh-CN")).toBe("AI对话知识沉淀");
    expect(shortDomainTitle("控制理论", "zh-CN")).toBe("控制理论");
  });
});
