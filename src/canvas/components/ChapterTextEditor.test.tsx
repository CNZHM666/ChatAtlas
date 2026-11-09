import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChapterTextEditor } from "./ChapterTextEditor";
import { locateInMarkdown } from "../markdown-locate";

afterEach(cleanup);
const body = "## 范围\n\n第一版只做计时。\n\n**首版**先不做书签，后续再看。\n\n- 支持 `暂停` 与继续\n\n后续再看书签同步。";

it("finds rendered text in the Markdown around it", () => {
  const [start, end] = locateInMarkdown(body, "首版先不做书签，后续再看。")!;
  expect(body.slice(start, end)).toBe("首版**先不做书签，后续再看");
  // A reworded ending still lands on the sentence by its opening words.
  expect(body.slice(...locateInMarkdown(body, "支持 暂停 与继续和重置")!)).toContain("支持 `暂停");
  expect(locateInMarkdown(body, "完全没有的话")).toBeUndefined();
  // From a position: the next one, then over the top again unless told not to.
  const first = locateInMarkdown(body, "后续再看")!, second = locateInMarkdown(body, "后续再看", first[1])!;
  expect(second[0]).toBeGreaterThan(first[0]);
  expect(locateInMarkdown(body, "后续再看", second[1])).toEqual(first);
  expect(locateInMarkdown(body, "后续再看", second[1], false)).toBeUndefined();
});

it("opens with the sentence to change selected, and finds the next place a word appears", () => {
  const onBody = vi.fn();
  render(<ChapterTextEditor title="范围" body={body} target="首版先不做书签，后续再看。" zh onTitle={() => {}} onBody={onBody} />);
  const area = screen.getByRole("textbox", { name: "章节内容" }) as HTMLTextAreaElement;
  expect(body.slice(area.selectionStart, area.selectionEnd)).toBe("首版**先不做书签，后续再看");
  const find = screen.getByRole("searchbox", { name: "在本章查找" });
  fireEvent.change(find, { target: { value: "书签" } });
  fireEvent.keyDown(find, { key: "Enter" });
  expect(area.selectionStart).toBe(body.lastIndexOf("书签"));
  fireEvent.change(find, { target: { value: "没有的词" } });
  fireEvent.keyDown(find, { key: "Enter" });
  expect(screen.getByRole("status")).toHaveTextContent("没有找到");
  fireEvent.change(area, { target: { value: "改过" } });
  expect(onBody).toHaveBeenCalledWith("改过");
});
