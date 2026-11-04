import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FocusSession } from "../../shared/focus-session";
import { FocusNotes } from "./FocusNotes";
afterEach(cleanup);
const ref = { id: "e1", conversationId: "c", messageId: "m", title: "原始问题", excerpt: "原文" };
const session: FocusSession = { id: "s", title: "Review", goal: "Review", mode: "review", sourceConversationIds: ["c"], evidence: [ref], sections: [{ id: "a", title: "第一章", body: "解释。", transition: "", evidenceIds: ["e1"], kind: "review" }], activeSectionId: "a", completedSectionIds: [], notes: "", detachedNotes: [{ title: "原来的问题", text: "## 原来的问题\n\n完整回答。", sources: [ref, { ...ref, id: "duplicate" }], origin: "query" }], createdAt: 1, updatedAt: 1 };

it("edits one item at a time and derives optional note titles while preserving chapter drafts and sources", async () => {
  let saved = session;
  function Notes() {
    const [current, setCurrent] = useState(saved);
    return <FocusNotes session={current} sectionId="a" zh open onOpen={vi.fn()} onRead={vi.fn()} onLocate={vi.fn()} onSave={async patch => { saved = { ...current, ...patch }; setCurrent(saved); }} />;
  }
  render(<Notes />);
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  fireEvent.change(screen.getByRole("textbox", { name: "本节笔记" }), { target: { value: "尚未提交的章节草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "+ 笔记" }));
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(screen.queryByRole("textbox", { name: "笔记标题" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "笔记内容" }), { target: { value: "验证边界条件\n\n我的解释。" } });
  fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
  await waitFor(() => expect(saved.detachedNotes?.at(-1)).toMatchObject({ title: "验证边界条件", text: "验证边界条件\n\n我的解释。", sources: [ref] }));
  expect(screen.getByRole("textbox", { name: "本节笔记" })).toHaveValue("尚未提交的章节草稿");
  fireEvent.click(screen.getByRole("button", { name: "待复习问题" }));
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(screen.getByRole("textbox", { name: "待复习的问题" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.getByRole("textbox", { name: "本节笔记" })).toHaveValue("尚未提交的章节草稿");
});
it("retains a failed chapter draft through closing and allows an explicit save retry", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("disk")).mockResolvedValue(undefined);
  const props = { session, sectionId: "a", zh: true, onOpen: vi.fn(), onRead: vi.fn(), onLocate: vi.fn(), onSave: save };
  const view = render(<FocusNotes {...props} open />);
  fireEvent.change(screen.getByRole("textbox", { name: "本节笔记" }), { target: { value: "保留本章草稿" } });
  fireEvent.blur(screen.getByRole("textbox", { name: "本节笔记" }));
  await screen.findByRole("alert");
  view.rerender(<FocusNotes {...props} open={false} />); view.rerender(<FocusNotes {...props} open />);
  expect(screen.getByRole("textbox", { name: "本节笔记" })).toHaveValue("保留本章草稿");
  fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][0].sectionNotes.a.text).toBe("保留本章草稿");
});
it("saves chapter notes with their original sources and preserves a failed editor draft", async () => {
  const save = vi.fn(async () => undefined);
  const view = render(<FocusNotes session={session} sectionId="a" zh open onOpen={vi.fn()} onRead={vi.fn()} onLocate={vi.fn()} onSave={save} />);
  const input = screen.getByRole("textbox", { name: "本节笔记" }); fireEvent.change(input, { target: { value: "仅在条件 B 下成立。" } }); fireEvent.blur(input);
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ sectionNotes: expect.objectContaining({ a: expect.objectContaining({ text: "仅在条件 B 下成立。", sources: [ref] }) }) })));
  view.unmount(); render(<FocusNotes session={session} zh open onOpen={vi.fn()} onRead={vi.fn()} onLocate={vi.fn()} onSave={vi.fn(async () => { throw new Error("disk"); })} />);
  fireEvent.click(screen.getByRole("button", { name: "+ 笔记" })); fireEvent.click(screen.getByRole("button", { name: "添加标题" })); fireEvent.change(screen.getByRole("textbox", { name: "笔记标题" }), { target: { value: "保留草稿" } }); fireEvent.change(screen.getByRole("textbox", { name: "笔记内容" }), { target: { value: "这段理解不能丢。" } }); fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败"); expect(within(screen.getByRole("textbox", { name: "笔记内容" }).closest("form")!).getByRole("textbox", { name: "笔记内容" })).toHaveValue("这段理解不能丢。");
});
