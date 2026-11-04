import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectSourcePicker } from "./ProjectSourcePicker";
afterEach(cleanup);
it("offers synchronization for newly linked title-only sources without pretending they are ready",()=>{
 const sync=vi.fn(),confirm=vi.fn();render(<ProjectSourcePicker conversations={[{id:"pending",title:"新增标题",platform:"chatgpt",url:"",updatedAt:1,messageCount:null,hydrationState:"metadata_only",importState:"discovered"}]} suggestedIds={["pending"]} existingIds={[]} zh onClose={vi.fn()} onConfirm={confirm} onSync={sync}/>);
 expect(screen.getByRole("checkbox",{name:/新增标题/})).toBeDisabled();expect(screen.getByRole("button",{name:"生成更新预览"})).toBeDisabled();fireEvent.click(screen.getByRole("button",{name:"同步新增对话正文"}));expect(sync).toHaveBeenCalledOnce();expect(confirm).not.toHaveBeenCalled();
});
it("selects only explicitly checked synced conversations and closes with Escape", () => {
  const base = { platform: "chatgpt" as const, url: "", messageCount: 1, updatedAt: 1, hydrationState: "hydrated" as const, importState: "complete" as const };
  const onConfirm = vi.fn(), onClose = vi.fn();
  render(<ProjectSourcePicker conversations={[{ ...base, id: "old", title: "已有讨论" }, { ...base, id: "new", title: "新方案" }, { ...base, id: "pending", title: "未同步", hydrationState: "metadata_only" }]} existingIds={["old"]} zh onClose={onClose} onConfirm={onConfirm} />);
  expect(screen.queryByText("已有讨论")).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /未同步/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "生成更新预览" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "新方案" }));
  fireEvent.click(screen.getByRole("button", { name: "生成更新预览" })); expect(onConfirm).toHaveBeenCalledWith(["new"]);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(onClose).toHaveBeenCalledOnce();
});
