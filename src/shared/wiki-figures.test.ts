import { expect, it } from "vitest";
import { daysIn, figuresIn, withoutDays } from "./wiki-figures";

it("never reads a day as a figure, in brackets or not, and keeps a span of days whole", () => {
  expect(figuresIn("当时日活稳定在22人（6月14日—7月7日），其中15人为核心用户。")).toEqual(["22", "15"]);
  expect(figuresIn("6月6日日活仅25，留存40%。", { percent: true })).toEqual(["25", "40%"]);
  expect(figuresIn("2026-08-18 记录日活40。")).toEqual(["40"]);
  expect(daysIn("此前（6月14日—7月7日）与8月18日")).toEqual(["6月14日—7月7日", "8月18日"]);
  expect(withoutDays("日活约40（8月18日反馈），付费率较低。")).toBe("日活约40，付费率较低。");
});

it("leaves out figures counting time or times when asked, and keeps a figure before 日活", () => {
  expect(figuresIn("坚持30天后日活约30人，3个月内复盘2次，约40日活。", { counts: true })).toEqual(["30", "40"]);
  expect(figuresIn("坚持30天", { counts: true })).toEqual([]);
});
