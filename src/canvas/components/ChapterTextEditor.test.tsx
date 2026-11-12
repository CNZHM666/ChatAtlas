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
  const onSave = vi.fn();
  render(<ChapterTextEditor title="范围" body={body} target="首版先不做书签，后续再看。" zh onSave={onSave} onCancel={() => {}} />);
  const area = screen.getByRole("textbox", { name: "章节内容" }) as HTMLTextAreaElement;
  expect(body.slice(area.selectionStart, area.selectionEnd)).toBe("首版**先不做书签，后续再看");
  const find = screen.getByRole("searchbox", { name: "在本章查找" });
  fireEvent.change(find, { target: { value: "书签" } });
  fireEvent.keyDown(find, { key: "Enter" });
  expect(area.selectionStart).toBe(body.lastIndexOf("书签"));
  fireEvent.change(find, { target: { value: "没有的词" } });
  fireEvent.keyDown(find, { key: "Enter" });
  expect(screen.getByText("没有找到")).toBeVisible();
  fireEvent.change(area, { target: { value: "改过" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(onSave).toHaveBeenCalledWith("范围", "改过");
});

it("keeps edits as a draft: undo, redo and revert them, and leave without saving after a confirmation", () => {
  const onSave = vi.fn(), onCancel = vi.fn(), onDirty = vi.fn();
  render(<ChapterTextEditor title="范围" body="原文" zh onSave={onSave} onCancel={onCancel} onDirty={onDirty} />);
  const area = screen.getByRole("textbox", { name: "章节内容" }) as HTMLTextAreaElement;
  expect(screen.getByText("没有修改")).toBeVisible();
  fireEvent.change(area, { target: { value: "第一次" } });
  expect(screen.getByText("有未保存的修改")).toBeVisible();
  expect(onDirty).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  expect(area.value).toBe("原文");
  fireEvent.click(screen.getByRole("button", { name: "重做" }));
  expect(area.value).toBe("第一次");
  // Ctrl+Z works the same way as the button.
  fireEvent.keyDown(area, { key: "z", ctrlKey: true });
  expect(area.value).toBe("原文");
  fireEvent.change(area, { target: { value: "又改了" } });
  fireEvent.click(screen.getByRole("button", { name: /还原/ }));
  expect(area.value).toBe("原文");
  fireEvent.change(area, { target: { value: "不想要的修改" } });
  // Cancelling a draft asks first; keeping on editing keeps it.
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.getByRole("alert")).toHaveTextContent("放弃这些修改？");
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(area.value).toBe("不想要的修改");
  fireEvent.keyDown(area, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
});

it("closes without saving, or marking the chapter edited, when nothing changed", () => {
  const onSave = vi.fn(), onCancel = vi.fn();
  render(<ChapterTextEditor title="范围" body="原文" zh onSave={onSave} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
});
