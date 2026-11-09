import "fake-indexeddb/auto";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HistoryWorkbench } from "./HistoryWorkbench";
import { PreferencesProvider,usePreferences } from "../preferences";
import type { Conversation } from "../../shared/types";
import { getDatabase } from "../../storage/db";

const sources: Conversation[] = Array.from({ length: 7 }, (_, index) => ({ id: `c${index}`, title: `数据库讨论 ${index + 1}`, platform: "chatgpt", url: "", messageCount: 2, updatedAt: 1, importState: "complete", hydrationState: "hydrated" }));
const projectGoal = "把全部已选对话整理成一个项目";
const summaryGoal = "总结全部已选对话的主要结论、决策和未解决问题";
beforeEach(async () => { localStorage.setItem("atlas-locale", "zh-CN"); await (await getDatabase()).clear("aiSettings"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function LanguageSwitch(){const{locale,setLocale}=usePreferences();return <button type="button" aria-label="Switch language" onClick={()=>setLocale(locale==="zh-CN"?"en":"zh-CN")}>EN / 中文</button>;}
function mount(initialIds: string[] = [], initialGoal = "", locale = "zh-CN", discovery = false, experimentalActions = true) {
  localStorage.setItem("atlas-locale", locale);
  const request = vi.fn(), showSources = vi.fn(), discoverGoal=vi.fn();
  function Harness() {
    const [selected, setSelected] = useState(new Set(initialIds)), [goal, setGoal] = useState(initialGoal);
    return <><LanguageSwitch/><HistoryWorkbench experimentalActions={experimentalActions} conversations={sources} selectedIds={selected} onSelectedIds={setSelected} goal={goal} onGoal={setGoal} onRequest={request} onDiscoverGoal={discoverGoal} onSources={showSources} onHydrate={vi.fn()} onDiscover={vi.fn()} discovery={discovery} />
      <div role="group" aria-label="材料列表">{sources.map(source => <label key={source.id}><input type="checkbox" checked={selected.has(source.id)} onChange={event => setSelected(new Set(event.target.checked ? [...selected, source.id] : [...selected].filter(id => id !== source.id)))} />{source.title}</label>)}</div></>;
  }
  render(<PreferencesProvider><Harness /></PreferencesProvider>);
  return { request, showSources, discoverGoal, input: () => screen.getByRole("textbox", { name: /^(搜索或整理历史对话|Search or organize past conversations)$/ }) };
}
it("fills a full-selection task on selection without starting until the user acts", () => {
  const { request, input } = mount();
  fireEvent.click(screen.getByRole("checkbox", { name: sources[0].title }));
  expect(input()).toHaveValue(projectGoal); expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: sources[1].title }));
  // The chosen materials show as chips above the input; no separate count below it.
  expect(screen.getAllByRole("button", { name: /^移除材料/ })).toHaveLength(2);
  expect(screen.queryByRole("button", { name: /已选 \d+ 条/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /开始整理|搜索历史/ }));
  expect(request).toHaveBeenCalledOnce(); expect(request).toHaveBeenCalledWith(projectGoal, undefined, "project");
  expect(screen.getByRole("checkbox", { name: sources[1].title })).toBeChecked();
});
it("does not add materials on input focus and clears explicitly attached materials in one action", () => {
  const { input } = mount(["c0", "c1", "c2"]);
  fireEvent.focus(input());
  expect(within(screen.getByRole("group", { name: "已选材料" })).getAllByRole("button", { name: /移除材料/ })).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "清空材料" }));
  expect(screen.queryByRole("group", { name: "已选材料" })).toBeNull();
  fireEvent.focus(input());
  expect(screen.queryByRole("group", { name: "已选材料" })).toBeNull();
});
it("starts project or summary directly from selected materials without typing", () => {
  const { request, input } = mount(["c0", "c1"]);
  fireEvent.click(screen.getByRole("button", { name: "总结历史讨论" }));
  expect(input()).toHaveValue(summaryGoal); expect(request).toHaveBeenLastCalledWith(summaryGoal, undefined, "answer");
  fireEvent.click(screen.getByRole("button", { name: "整理成项目" }));
  expect(request).toHaveBeenLastCalledWith(projectGoal, undefined, "project");
});
it("removes attached materials and clears only its automatic draft when the pool becomes empty", () => {
  const { input, request } = mount(["c0", "c1"]);
  fireEvent.click(screen.getByRole("button", { name: `移除材料：${sources[0].title}` }));
  expect(screen.getByRole("checkbox", { name: sources[0].title })).not.toBeChecked();
  expect(input()).toHaveValue(projectGoal);
  fireEvent.click(screen.getByRole("button", { name: `移除材料：${sources[1].title}` }));
  expect(input()).toHaveValue(""); expect(screen.getByRole("button", { name: /开始整理|搜索历史/ })).toBeDisabled(); expect(request).not.toHaveBeenCalled();
});
it("preserves custom requirements across selection changes and avoids repeating summary prefixes", () => {
  const { input, request } = mount(["c0"]);
  fireEvent.change(input(), { target: { value: "总结硬件 AI 的数据库方案" } });
  fireEvent.click(screen.getByRole("checkbox", { name: sources[1].title }));
  expect(input()).toHaveValue("总结硬件 AI 的数据库方案");
  fireEvent.click(screen.getByRole("button", { name: "总结历史讨论" }));
  expect(request).toHaveBeenLastCalledWith("总结硬件 AI 的数据库方案", undefined, "answer");
  fireEvent.click(screen.getByRole("button", { name: `移除材料：${sources[0].title}` }));
  fireEvent.click(screen.getByRole("button", { name: `移除材料：${sources[1].title}` }));
  expect(input()).toHaveValue("总结硬件 AI 的数据库方案");
});
it("find focuses an empty query rather than searching the automatic project instruction", () => {
  const { input, request } = mount(["c0"]);
  fireEvent.click(screen.getByRole("button", { name: "找回历史对话" }));
  expect(input()).toHaveValue(""); expect(input()).toHaveFocus(); expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: sources[1].title }));
  expect(input()).toHaveValue("");
  fireEvent.change(input(), { target: { value: "之前为什么选 IndexedDB？" } });
  fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true, isComposing: true });
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(request).not.toHaveBeenCalled();
  fireEvent.keyDown(input(), { key: "Enter", metaKey: true });
  expect(request).toHaveBeenCalledOnce(); expect(request).toHaveBeenLastCalledWith("之前为什么选 IndexedDB？", undefined, "answer", true);
});
it("shows a nonblocking incomplete-import hint only after find or discovery and hides it when fully synced", () => {
  const pending={...sources[1],importState:"discovered" as const,hydrationState:"metadata_only" as const,messageCount:null}, stale={...sources[2],sourceUpdatedAt:20,hydratedSourceUpdatedAt:10};
  const request=vi.fn(),hydrate=vi.fn(),callbacks={goal:"Orama",onGoal:vi.fn(),onRequest:request,onSources:vi.fn(),onHydrate:hydrate,onDiscover:vi.fn(),onDiscoverGoal:vi.fn()};
  const view=render(<PreferencesProvider><HistoryWorkbench experimentalActions {...callbacks} conversations={[sources[0],pending,stale]}/></PreferencesProvider>);
  expect(screen.queryByText(/可能遗漏结果/)).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"找回历史对话"}));expect(screen.getByText(/还有 2 条已发现对话/)).toBeVisible();expect(screen.queryByRole("alert")).toBeNull();expect(request).not.toHaveBeenCalled();expect(hydrate).not.toHaveBeenCalled();
  expect(screen.getByRole("button",{name:"搜索历史"})).not.toBeDisabled();fireEvent.click(screen.getByRole("button",{name:"同步全部正文"}));expect(hydrate).toHaveBeenCalledWith([pending.id,stale.id]);
  fireEvent.click(screen.getByRole("button",{name:"发现整理主题"}));expect(screen.getByText(/可能遗漏结果/)).toBeVisible();expect(callbacks.onDiscoverGoal).not.toHaveBeenCalled();
  view.rerender(<PreferencesProvider><HistoryWorkbench experimentalActions {...callbacks} conversations={sources}/></PreferencesProvider>);expect(screen.queryByText(/可能遗漏结果/)).toBeNull();expect(screen.queryByRole("button",{name:"同步全部正文"})).toBeNull();
});
it("collapses large selections and can remove a previously hidden material", () => {
  const { showSources } = mount(sources.map(source => source.id));
  const attachments = screen.getByRole("group", { name: "已选材料" });
  expect(within(attachments).getAllByRole("button", { name: /^移除材料：/ })).toHaveLength(4);
  fireEvent.click(within(attachments).getByRole("button", { name: "+ 3 条" }));
  fireEvent.click(within(attachments).getByRole("button", { name: `移除材料：${sources[6].title}` }));
  expect(screen.getByRole("checkbox", { name: sources[6].title })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "添加材料" })); expect(showSources).toHaveBeenCalledOnce();
});
it("supports English default tasks and Ctrl Enter without widening the selection", () => {
  const { request, input } = mount(["c0"], "", "en");
  expect(input()).toHaveValue("Create a project from all selected conversations");
  fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true });
  expect(request).toHaveBeenCalledWith("Create a project from all selected conversations", undefined, "project");
  expect(screen.getByRole("checkbox", { name: sources[1].title })).not.toBeChecked();
});
it("exposes four direct shortcuts and asks for sources before discovering with fewer than two conversations", () => {
  const { showSources, request } = mount(["c0"], "", "zh-CN", true);
  const shortcuts=screen.getByRole("group",{name:"快捷入口"});
  expect(within(shortcuts).getAllByRole("button").map(button=>button.textContent)).toEqual(["找回历史对话","整理成项目","总结历史讨论","发现整理主题"]);
  expect(shortcuts.querySelector("details")).toBeNull();
  fireEvent.click(within(shortcuts).getByRole("button",{name:"发现整理主题"}));
  expect(screen.queryByRole("alert")).toBeNull();expect(showSources).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
  const input=screen.getByRole("textbox",{name:"搜索或整理历史对话"});fireEvent.change(input,{target:{value:"找出共同数据库项目"}});fireEvent.click(screen.getByRole("button",{name:"发现主题"}));expect(showSources).toHaveBeenCalledOnce();expect(screen.getByRole("alert")).toHaveTextContent("至少选择两条");
});
it("selects discovery without running it and submits only the user's entered goal",()=>{
 const {input,discoverGoal,request}=mount(["c0","c1"],"","zh-CN",true);
 fireEvent.click(screen.getByRole("button",{name:"发现整理主题"}));expect(input()).toHaveValue("");expect(input()).toHaveFocus();expect(screen.getByRole("button",{name:"发现主题"})).toBeDisabled();expect(discoverGoal).not.toHaveBeenCalled();
 fireEvent.change(input(),{target:{value:"找出值得继续的数据库项目"}});fireEvent.keyDown(input(),{key:"Enter",ctrlKey:true});expect(discoverGoal).toHaveBeenCalledWith("找出值得继续的数据库项目",["c0","c1"]);expect(request).not.toHaveBeenCalled();expect(screen.queryByText("为你发现")).toBeNull();
});
it.each(["zh-CN","en"])("keeps public %s shortcuts limited to history and projects",locale=>{
 mount([],"",locale,true,false);
 const shortcuts=screen.getByRole("group",{name:locale==="zh-CN"?"快捷入口":"Shortcuts"});
 expect(within(shortcuts).getAllByRole("button").map(button=>button.textContent)).toEqual(locale==="zh-CN"?["找回历史对话","整理成项目"]:["Find history","Organize as project"]);
});
it("blocks typed experimental actions and excludes summary from public intent choices",()=>{
 const {input,request,discoverGoal}=mount(["c0"],"","zh-CN",true,false);
 for(const goal of ["总结全部历史讨论","发现共同主题"]){fireEvent.change(input(),{target:{value:goal}});fireEvent.keyDown(input(),{key:"Enter",ctrlKey:true});expect(screen.getByRole("alert")).toHaveTextContent("暂未开放");}
 expect(request).not.toHaveBeenCalled();expect(discoverGoal).not.toHaveBeenCalled();
 fireEvent.change(input(),{target:{value:"希望处理这些内容"}});fireEvent.keyDown(input(),{key:"Enter",ctrlKey:true});
 expect(screen.queryByRole("button",{name:"总结讨论"})).toBeNull();
 expect(within(screen.getByRole("group",{name:"选择执行方式"})).getAllByRole("button")).toHaveLength(2);
});

it("switches an automatic project prompt both ways without changing sources or submitting a task",()=>{
 const{input,request}=mount(["c0"]);
 expect(input()).toHaveValue(projectGoal);
 fireEvent.click(screen.getByRole("button",{name:"Switch language"}));
 expect(input()).toHaveValue("Create a project from all selected conversations");
 expect(input()).toHaveAttribute("placeholder","e.g. Organize the hardware AI project we discussed earlier");
 expect(screen.getByRole("button",{name:"Organize project"})).toBeEnabled();
 expect(screen.getByRole("button",{name:"Organize as project"})).toHaveAttribute("aria-pressed","true");
 expect(screen.getByRole("checkbox",{name:sources[0].title})).toBeChecked();expect(request).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Switch language"}));expect(input()).toHaveValue(projectGoal);
 fireEvent.click(screen.getByRole("button",{name:"Switch language"}));
 fireEvent.click(screen.getByRole("button",{name:`Remove material: ${sources[0].title}`}));expect(input()).toHaveValue("");
 expect(request).not.toHaveBeenCalled();
});
it("keeps an automatic summary in its own mode when language changes without running it again",()=>{
 const{input,request}=mount(["c0"]);
 fireEvent.click(screen.getByRole("button",{name:"总结历史讨论"}));expect(request).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole("button",{name:"Switch language"}));
 expect(input()).toHaveValue("Summarize the conclusions, decisions and open questions in all selected conversations");
 expect(input()).toHaveAttribute("placeholder","Which topic would you like to summarize?");
 expect(screen.getByRole("button",{name:"Summarize discussions"})).toHaveAttribute("aria-pressed","true");
 fireEvent.click(screen.getByRole("button",{name:"Switch language"}));expect(input()).toHaveValue(summaryGoal);expect(request).toHaveBeenCalledOnce();
});
it.each([
 ["en",projectGoal,"Create a project from all selected conversations"],
 ["zh-CN","Summarize the conclusions, decisions and open questions in all selected conversations",summaryGoal],
])("localizes a saved built-in draft when reopened in %s",(locale,saved,expected)=>{
 const{input,request}=mount(["c0"],saved,locale);expect(input()).toHaveValue(expected);expect(request).not.toHaveBeenCalled();
});
it("preserves edited requirements and never reclaims a user-edited draft as an automatic template",()=>{
 const{input,request}=mount(["c0"]),custom=projectGoal+"，只整理搜索模块，并保留英文术语。";
 fireEvent.change(input(),{target:{value:custom}});fireEvent.click(screen.getByRole("button",{name:"Switch language"}));expect(input()).toHaveValue(custom);
 fireEvent.click(screen.getByRole("checkbox",{name:sources[1].title}));expect(input()).toHaveValue(custom);
 // Even restoring the exact built-in text by hand does not grant overwrite permission.
 fireEvent.change(input(),{target:{value:projectGoal}});fireEvent.click(screen.getByRole("button",{name:"Switch language"}));fireEvent.click(screen.getByRole("button",{name:"Switch language"}));expect(input()).toHaveValue(projectGoal);expect(request).not.toHaveBeenCalled();
});
it("updates find and discovery placeholders without filling an empty query or starting analysis",()=>{
 const{input,request,discoverGoal}=mount(["c0","c1"],"","zh-CN",true);
 fireEvent.click(screen.getByRole("button",{name:"找回历史对话"}));fireEvent.click(screen.getByRole("button",{name:"Switch language"}));
 expect(input()).toHaveValue("");expect(input()).toHaveAttribute("placeholder","e.g. Where did we discuss the Orama search index?");
 fireEvent.click(screen.getByRole("button",{name:"Discover topics"}));expect(input()).toHaveValue("");expect(input()).toHaveAttribute("placeholder",expect.stringContaining("What topics"));
 fireEvent.click(screen.getByRole("button",{name:"Switch language"}));expect(input()).toHaveValue("");expect(input()).toHaveAttribute("placeholder",expect.stringContaining("想从历史讨论"));expect(request).not.toHaveBeenCalled();expect(discoverGoal).not.toHaveBeenCalled();
});
