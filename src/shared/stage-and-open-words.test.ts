import { expect, it } from "vitest";
import { UNDECIDED } from "./open-words";
import { PHASE } from "./stage-words";
import { stageOf } from "../ai/wiki-draft-checks";

it("tells a choice still to make from one shared set of words, and not what is only not built yet", () => {
  for (const text of ["每4轮后的长休息尚待决定", "宽度 360px 与 380px 两案并存", "存储方案仍在讨论", "是否加入任务名称尚未确定", "还没想好统计范围", "The cadence remains undecided.", "Budget period is TBD."]) expect(UNDECIDED.test(text), text).toBe(true);
  for (const text of ["导出功能尚未实现", "V0.1 确定默认专注 25 分钟", "The export is decided."]) expect(UNDECIDED.test(text), text).toBe(false);
});

it("tells the phase or version a statement is about from one shared set of words", () => {
  for (const text of ["首版不做账号系统", "当前阶段不包含比价", "V0.1 仅保留本地存储", "MVP 只做导入", "初期暂不上线", "In the first version, only USD."]) expect(PHASE.test(text), text).toBe(true);
  expect(PHASE.test("用户可以随时导出数据")).toBe(false);
  expect(stageOf("本阶段不做比价")).toEqual({ level: "iteration", label: "current" });
  expect(stageOf("首版不做比价")).toEqual({ level: "version", label: "first" });
});
