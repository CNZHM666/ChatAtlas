import { expect, it } from "vitest";
import { rowFields } from "./wiki-row-sentence";

it("tells a row as one sentence: no empty field, no catch-all column name, a short figure after its name, a full stop", () => {
  expect(rowFields(["日活 (DAU)", "核心用户数", "备注"], ["约40", "-", "活跃留存率略高于40%，付费率较低"], true)).toBe("日活 (DAU)约40；活跃留存率略高于40%，付费率较低。");
  expect(rowFields(["复盘时长与内容", "数据保留策略"], ["提供30秒结构化复盘（时间、场景、情绪、诱因）", "生成预防方案"], true)).toBe("复盘时长与内容：提供30秒结构化复盘（时间、场景、情绪、诱因）；数据保留策略：生成预防方案。");
  expect(rowFields([undefined], ["正常状态显示“开启今晚守护”。"], true)).toBe("正常状态显示“开启今晚守护”。");
  expect(rowFields(["Include", "Leave out"], ["10-second logging", "-"], false)).toBe("Include: 10-second logging");
});
