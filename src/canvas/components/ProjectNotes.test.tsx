import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FocusSession } from "../../shared/focus-session";
import { projectSession } from "../../test/project-fixture";
import { FocusNotes } from "./FocusNotes";
import { carryReviewNotes } from "../review-notes";
import { ProjectNotes } from "./ProjectNotes";

afterEach(cleanup);

it("writes a contextual note with one field and keeps its draft when another location opens", async () => {
  const session = { ...projectSession(), notes: "" }, save = vi.fn().mockResolvedValue(undefined);
  const props = { session, zh: true, open: true, onOpen: vi.fn(), onSave: save, onRead: vi.fn(), onLocate: vi.fn() };
  const view = render(<ProjectNotes {...props} composeRequest={{ nonce: 1, moduleId: "module:input" }} />);
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(screen.queryByRole("combobox", { name: "笔记位置" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "笔记内容" }), { target: { value: "验证空输入\n保留这次观察" } });
  view.rerender(<ProjectNotes {...props} open={false} composeRequest={{ nonce: 1, moduleId: "module:input" }} />);
  view.rerender(<ProjectNotes {...props} composeRequest={{ nonce: 2, sectionId: "one" }} />);
  expect(screen.getByRole("textbox", { name: "笔记内容" })).toHaveValue("验证空输入\n保留这次观察");
  fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].detachedNotes[0]).toMatchObject({ title: "验证空输入", module: { id: "module:input", title: "需求采集" }, sources: session.evidence });
});

it("opens one original conversation for repeated references without showing a sources list", () => {
  const session = { ...projectSession(), notes: "", detachedNotes: [{ title: "DD", text: "项目判断", sources: [projectSession().evidence[0], { ...projectSession().evidence[0], id: "e2", messageId: "another" }] }] };
  const locate = vi.fn();
  render(<FocusNotes session={session} zh open onOpen={vi.fn()} onRead={vi.fn()} onLocate={locate} onSave={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /DD 项目整体/ }));
  fireEvent.click(screen.getByRole("button", { name: "查看原对话" }));
  expect(locate).toHaveBeenCalledWith(session.evidence[0]);
  expect(screen.queryByText(/来源 ·/)).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "选择原对话" })).not.toBeInTheDocument();
});
it("moves a legacy chapter note to the selected location without losing its original references", async () => {
  let saved = { ...projectSession(), notes: "", sectionNotes: { one: { title: "验证笔记", text: "保留条件", evidenceIds: ["e1"], updatedAt: 1 } } } as FocusSession;
  function Fixture() {
    const [session, setSession] = useState(saved);
    return <FocusNotes session={session} sectionId="one" zh open onOpen={vi.fn()} onRead={vi.fn()} onLocate={vi.fn()} onSave={async patch => { saved = { ...session, ...patch }; setSession(saved); }} />;
  }
  render(<Fixture />);
  fireEvent.click(screen.getByRole("button", { name: /验证笔记 核心流程/ }));
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.click(screen.getByText("标题与归属（可选）"));
  fireEvent.change(screen.getByRole("combobox", { name: "笔记位置" }), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
  await waitFor(() => expect(saved.sectionNotes?.one).toBeUndefined());
  expect(saved.detachedNotes?.[0]).toMatchObject({ title: "验证笔记", text: "保留条件", sources: saved.evidence });
  expect(screen.getByRole("heading", { name: "验证笔记" })).toBeVisible();
  expect(screen.getByText("项目整体")).toBeVisible();
});

it("keeps an edited AI excerpt and failed draft through panel closure, even when its module disappears", async () => {
  const session: FocusSession = { ...projectSession(), notes: "", detachedNotes: [{ title: "原摘录", text: "原回答", origin: "query", sources: projectSession().evidence, module: { id: "module:removed", title: "旧模块" } }] };
  const save = vi.fn().mockRejectedValueOnce(new Error("disk")).mockResolvedValue(undefined);
  const props = { session, zh: true, onOpen: vi.fn(), onRead: vi.fn(), onLocate: vi.fn(), onSave: save };
  const view = render(<FocusNotes {...props} open />);
  fireEvent.change(screen.getByRole("combobox", { name: "筛选笔记" }), { target: { value: "all" } });
  fireEvent.click(screen.getByRole("button", { name: /原摘录 旧模块/ }));
  expect(screen.queryByRole("button", { name: "查看模块" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.click(screen.getByText("标题与归属（可选）"));
  fireEvent.change(screen.getByRole("textbox", { name: "笔记标题" }), { target: { value: "我的补充" } });
  fireEvent.change(screen.getByRole("textbox", { name: "笔记内容" }), { target: { value: "保留的修改" } });
  fireEvent.click(screen.getByRole("button", { name: "保存笔记" })); await screen.findByRole("alert");
  view.rerender(<FocusNotes {...props} open={false} />); view.rerender(<FocusNotes {...props} open />);
  expect(screen.getByRole("textbox", { name: "笔记内容" })).toHaveValue("保留的修改");
  fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][0].detachedNotes[0]).toMatchObject({ title: "我的补充", text: "保留的修改", origin: "query", sources: session.evidence, module: { id: "module:removed", title: "旧模块" } });
});

it("keeps existing chapter notes editable and their module associations when a chapter is removed", async () => {
  const session = projectSession();
  session.sectionNotes = { one: { title: "验证记录", text: "原笔记", module: { id: "module:input", title: "需求采集" }, evidenceIds: ["e1"], updatedAt: 1 } };
  const save = vi.fn().mockResolvedValue(undefined), read = vi.fn();
  render(<FocusNotes session={session} sectionId="one" zh open onOpen={vi.fn()} onRead={read} onLocate={vi.fn()} onSave={save} />);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /验证记录 需求采集/ }));
  fireEvent.click(screen.getByRole("button", { name: "查看内容" })); expect(read).toHaveBeenCalledWith("one");
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.change(screen.getByRole("textbox", { name: "笔记内容" }), { target: { value: "更新记录" } });
  fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0].sectionNotes.one).toMatchObject({ text: "更新记录", evidenceIds: ["e1"], module: session.sectionNotes.one.module });
  expect(carryReviewNotes(session, { ...session, sections: [] }).detachedNotes?.[0].module).toEqual(session.sectionNotes.one.module);
});
