import { expect, it } from "vitest";
import { discussionStageTags } from "./discussion-stage-tags";

it("uses explicit versions and topics from headings", () => {
  expect(discussionStageTags("V0.1 架构与 UI 规范", undefined, true)).toEqual(["V0.1", "界面与体验", "架构设计"]);
  expect(discussionStageTags("Milestone 4 开发路线", undefined, true)).toEqual(["Milestone 4", "开发计划"]);
  expect(discussionStageTags("V0.2 最终版本", undefined, true)).toEqual(["V0.2", "最终版本"]);
});
it("does not invent confirmation or a final version for an ordinary last stage or a question", () => {
  expect(discussionStageTags("项目讨论阶段 64", undefined, true)).toEqual([]);
  expect(discussionStageTags("是否采用最终方案", undefined, true)).not.toContain("最终版本");
  expect(discussionStageTags("非最终版本 V0.2", undefined, true)).not.toContain("最终版本");
});
