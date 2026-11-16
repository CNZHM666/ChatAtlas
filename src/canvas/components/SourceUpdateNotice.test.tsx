import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { projectSession } from "../../test/project-fixture";
import { SourceUpdateNotice } from "./SourceUpdateNotice";
afterEach(cleanup);
it("shows newly associated conversations without treating them as already analyzed or starting AI",()=>{
 const update=vi.fn(),session={...projectSession(),sidecarConversationIds:["new","new","source"]};
 render(<SourceUpdateNotice session={session} zh changes={[]} conversations={[]} onUpdate={update}/>);
 expect(screen.getByText("项目有新材料")).toBeVisible();expect(screen.getByText("1 条新关联对话待整理")).toBeVisible();expect(update).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"选择材料"}));expect(update).toHaveBeenCalledOnce();expect(session.sourceConversationIds).toEqual(["source"]);
});
it("shows source details immediately without starting analysis", () => {
  const update = vi.fn();
  render(<SourceUpdateNotice zh changes={[{ conversationId: "c", added: 4, changed: 1, removed: 0, unknown: false, affectedChapterTitles: ["稳定条件"] }]} conversations={[]} onUpdate={update} />);
  expect(screen.getByRole("status")).toHaveTextContent("新增 4 条 · 修改 1 条");
  expect(screen.getByText("涉及章节：稳定条件")).toBeVisible();
  expect(screen.queryByRole("button",{name:"明细"})).toBeNull();
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "预览更新" })); expect(update).toHaveBeenCalledOnce();
});

it("remembers dismissal after reopening and shows different changes with the same count", () => {
  const session = { ...projectSession(), id: "workspace-notice-dismiss" };
  const key = `atlas-workspace-source-update:${session.id}`;
  const change = { conversationId: "source", added: 0, changed: 10, removed: 0, unknown: false, fingerprint: "first" };
  const onUpdate = vi.fn();
  const notice = (fingerprint: string) => <SourceUpdateNotice session={session} zh changes={[{ ...change, fingerprint }]} conversations={[]} onUpdate={onUpdate} />;
  localStorage.removeItem(key);
  try {
    const first = render(notice("first"));
    fireEvent.click(screen.getByRole("button", { name: "关闭更新提醒" }));
    expect(screen.queryByText("来源有更新")).toBeNull();
    first.unmount();

    const reopened = render(notice("first"));
    expect(screen.queryByRole("button", { name: "预览更新" })).toBeNull();
    reopened.rerender(notice("second"));
    expect(screen.getByText("修改 10 条")).toBeVisible();
    expect(onUpdate).not.toHaveBeenCalled();
  } finally {
    localStorage.removeItem(key);
  }
});
