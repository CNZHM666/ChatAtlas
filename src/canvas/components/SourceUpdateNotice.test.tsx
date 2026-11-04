import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { projectSession } from "../../test/project-fixture";
import { SourceUpdateNotice } from "./SourceUpdateNotice";
afterEach(cleanup);
it("shows newly associated conversations without treating them as already analyzed or starting AI",()=>{
 const update=vi.fn(),session={...projectSession(),sidecarConversationIds:["new","new","source"]};
 render(<SourceUpdateNotice session={session} zh changes={[]} conversations={[]} onUpdate={update}/>);
 expect(screen.getByText("有 1 条新对话加入项目")).toBeVisible();expect(screen.getByText(/尚未纳入项目知识/)).toBeVisible();expect(update).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"整理更新"}));expect(update).toHaveBeenCalledOnce();expect(session.sourceConversationIds).toEqual(["source"]);
});
it("shows source counts before updating and exposes affected chapters without starting analysis", () => {
  const update = vi.fn();
  render(<SourceUpdateNotice zh changes={[{ conversationId: "c", added: 4, changed: 1, removed: 0, unknown: false, affectedChapterTitles: ["稳定条件"] }]} conversations={[]} onUpdate={update} />);
  expect(screen.getByText("新增 4 段 · 修改或缺失 1 段")).toBeVisible();
  expect(screen.getByText("涉及章节：稳定条件")).not.toBeVisible();
  fireEvent.click(screen.getByText("1 条对话需要更新回顾")); expect(screen.getByText("涉及章节：稳定条件")).toBeVisible();
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "更新预览" })); expect(update).toHaveBeenCalledOnce();
});
