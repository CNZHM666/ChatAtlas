import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {ProjectExportDialog} from "./ProjectExportDialog";
import {contextKnowledge} from "../../test/context-fixture";
import {workspaceLayoutExample} from "../workspace-layout-example";
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("offers saved legacy records only when present and never includes them by default",()=>{
 const {unmount}=render(<ProjectExportDialog session={workspaceLayoutExample()} zh onClose={vi.fn()}/>);
 const legacy=screen.getByText("以前保存的记录").closest("details")!;
 expect(legacy.open).toBe(false);fireEvent.click(screen.getByText("以前保存的记录"));
 expect(screen.getByRole("checkbox",{name:/历史事项/})).not.toBeChecked();expect(screen.getByRole("checkbox",{name:/历史演进/})).not.toBeChecked();
 unmount();const empty={...workspaceLayoutExample(),brief:undefined,projectState:undefined,projectMaintenance:undefined,projectHistoryAnalysis:undefined,projectEvolutionAnalysis:undefined,projectChanges:undefined};
 render(<ProjectExportDialog session={empty} zh onClose={vi.fn()}/>);
 expect(screen.queryByText("以前保存的记录")).toBeNull();
});
it("uses the chapter header for full and partial selection without extra explanatory blocks",()=>{
 const session=contextKnowledge().session;
 session.sections.push({...session.sections[0],id:"another-wiki",title:"另一章节"});
 render(<ProjectExportDialog session={session} zh onClose={vi.fn()}/>);
 const all=screen.getByRole("checkbox",{name:"项目 Wiki"}) as HTMLInputElement;
 expect(all).toBeChecked();fireEvent.click(screen.getByRole("button",{name:"选择 Wiki 章节"}));
 fireEvent.click(screen.getByRole("checkbox",{name:"另一章节"}));expect(all.indeterminate).toBe(true);
 fireEvent.click(all);expect(all.indeterminate).toBe(false);expect(screen.getByRole("checkbox",{name:"另一章节"})).toBeChecked();
 expect(screen.queryByText(/包含可点击目录|按项目顺序导出/)).toBeNull();
});
it("explains each conversation source option and updates the key record count with the chapter selection",()=>{
 const session=contextKnowledge().session,source=session.evidence[0];
 session.sections[0].claims=[{text:source.excerpt,quote:source.excerpt,evidenceIds:[source.id],holder:"decided"}];
 render(<ProjectExportDialog session={session} zh onClose={vi.fn()}/>);
 const sources=screen.getByRole("combobox",{name:"对话来源"});
 expect(screen.getAllByRole("option",{name:/只保留引用编号|附重点原话和确认|附章节引用的原话/})).toHaveLength(3);
 expect(sources).toHaveValue("locators");
 expect(sources).toHaveAccessibleDescription("保留引用编号，方便回到原对话查找。");
 fireEvent.change(sources,{target:{value:"key"}});
 expect(sources).toHaveAccessibleDescription(/附上 1 条重点记录/);
 const wiki=screen.getByRole("checkbox",{name:"项目 Wiki"});
 fireEvent.click(wiki);
 expect(sources).toHaveAccessibleDescription("所选章节暂无可附的重点记录。");
 expect(sources).toBeDisabled();
 fireEvent.click(wiki);
 fireEvent.change(sources,{target:{value:"excerpts"}});
 expect(sources).toHaveAccessibleDescription("附上所选章节引用的对话片段，方便逐条核对。");
});
it("lets the user select an individual Wiki and exports a complete safe document",async()=>{
 const create=vi.fn().mockReturnValue("blob:fixture");vi.stubGlobal("URL",class extends URL{static createObjectURL=create;static revokeObjectURL=vi.fn();});const click=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{}),close=vi.fn();
 render(<ProjectExportDialog session={contextKnowledge().session} zh onClose={close}/>);
 expect(screen.getByRole("combobox",{name:"文件格式"})).toHaveValue("md");
 expect(screen.queryByText(/包含可点击目录/)).toBeNull();expect(screen.getByRole("button",{name:"选择 Wiki 章节"})).toHaveAttribute("aria-expanded","false");
 fireEvent.click(screen.getByRole("checkbox",{name:"项目 Wiki"}));expect(screen.getByRole("button",{name:"导出"})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"选择 Wiki 章节"}));fireEvent.click(screen.getByRole("checkbox",{name:"数据库存储"}));fireEvent.click(screen.getByRole("button",{name:"导出"}));await screen.findByText("文件已导出");
 const reader=new FileReader();reader.readAsText(create.mock.calls[0][0]);await waitFor(()=>expect(reader.result).toBeTruthy());expect(String(reader.result)).toContain("数据库使用 IndexedDB");expect(String(reader.result)).not.toContain("const action");expect(String(reader.result)).not.toContain("绝不默认带出的私人笔记");expect(click).toHaveBeenCalledOnce();
 fireEvent.keyDown(screen.getByRole("dialog"),{key:"Escape"});expect(close).toHaveBeenCalledOnce();
});
it("exports the knowledge ledger as its own JSON file when ticked",async()=>{
 const create=vi.fn().mockReturnValue("blob:fixture");vi.stubGlobal("URL",class extends URL{static createObjectURL=create;static revokeObjectURL=vi.fn();});
 const names:string[]=[];vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(function(this:HTMLAnchorElement){names.push(this.download);});
 const session={...contextKnowledge().session,title:"ChatAtlas",runId:"run-1",wikiKnowledge:{version:1,generatedAt:0,status:"complete",materials:0,batches:[]}} as Parameters<typeof ProjectExportDialog>[0]["session"];
 render(<ProjectExportDialog session={session} zh onClose={vi.fn()}/>);
 const diagnostics=screen.getByText("诊断文件");
 expect(diagnostics.closest("details")?.open).toBe(false);
 fireEvent.click(diagnostics);
 const ledger=screen.getByRole("checkbox",{name:/知识点账本/});expect(ledger).not.toBeChecked();
 // The ledger alone is enough to export.
 fireEvent.click(screen.getByRole("checkbox",{name:"项目 Wiki"}));fireEvent.click(ledger);
 fireEvent.click(screen.getByRole("button",{name:"导出"}));await screen.findByText("账本已导出");
 expect(names).toEqual(["ChatAtlas-ledger.json"]);
 const reader=new FileReader();reader.readAsText(create.mock.calls[0][0]);await waitFor(()=>expect(reader.result).toBeTruthy());
 expect(JSON.parse(String(reader.result))).toMatchObject({title:"ChatAtlas",runId:"run-1",ledger:{version:1,status:"complete"}});
 // A document without a ledger offers none.
 cleanup();render(<ProjectExportDialog session={contextKnowledge().session} zh onClose={vi.fn()}/>);
 expect(screen.queryByRole("checkbox",{name:/知识点账本/})).toBeNull();
});

it.each(["md","html","txt","json"] as const)("includes selected examples in the same %s file",async format=>{
 const session=contextKnowledge().session;
 const example="const settings = { enabled: true };";
 session.sections[0].body="## 设置\n\n保留正文说明。\n\n~~~ts\n"+example+"\n~~~";
 const create=vi.fn().mockReturnValue("blob:fixture");
 vi.stubGlobal("URL",class extends URL{static createObjectURL=create;static revokeObjectURL=vi.fn();});
 const names:string[]=[];
 vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(function(this:HTMLAnchorElement){names.push(this.download);});
 render(<ProjectExportDialog session={session} zh onClose={vi.fn()}/>);
 expect(screen.getByRole("checkbox",{name:"项目 Wiki"})).toBeChecked();
 expect(screen.queryByRole("checkbox",{name:/参考示例/})).toBeNull();
 expect(screen.getByText("将导出 1 个文件")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"选择 Wiki 章节"}));
 const appendix=screen.getByRole("checkbox",{name:/在同一文件附参考示例/});
 expect(appendix).not.toBeChecked();
 fireEvent.click(appendix);
 fireEvent.change(screen.getByRole("combobox",{name:"文件格式"}),{target:{value:format}});
 fireEvent.click(screen.getByRole("button",{name:"导出"}));
 await screen.findByText("文件已导出");
 expect(names).toEqual([`ChatAtlas.${format}`]);
 const texts=await Promise.all(create.mock.calls.map(([blob])=>new Promise<string>((resolve,reject)=>{
  const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsText(blob);
 })));
 expect(texts[0]).toContain("项目总览");expect(texts[0]).toContain("保留正文说明");expect(texts[0]).toContain(example);
 if(format==="md")expect(texts[0]).toContain("参考示例附录");
});
it("exports this project's generation record as a CSV when ticked",async()=>{
 const create=vi.fn().mockReturnValue("blob:fixture");vi.stubGlobal("URL",class extends URL{static createObjectURL=create;static revokeObjectURL=vi.fn();});
 const names:string[]=[];vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(function(this:HTMLAnchorElement){names.push(this.download);});
 const terminate=vi.fn();
 let receive: ((event: { data: { csv: string } }) => void) | undefined;
 const post=vi.fn();
 vi.stubGlobal("Worker",class{set onmessage(callback: typeof receive){receive=callback;} postMessage=post;terminate=terminate;});
 const session={...contextKnowledge().session,title:"AI电路生成平台",runId:"run-1"} as Parameters<typeof ProjectExportDialog>[0]["session"];
 render(<ProjectExportDialog session={session} zh onClose={vi.fn()}/>);
 fireEvent.click(screen.getByText("诊断文件"));
 fireEvent.click(screen.getByRole("checkbox",{name:/生成记录/}));
 fireEvent.click(screen.getByRole("button",{name:"导出"}));
 expect(screen.getByText("正在准备生成记录…")).toBeInTheDocument();
 expect(post).toHaveBeenCalledWith({runId:"run-1",sourceConversationIds:session.sourceConversationIds,quality:expect.objectContaining({sessionId:session.id,updatedAt:session.updatedAt})});
 receive?.({data:{csv:"\uFEFFrun_id\r\nrun-1\r\n"}});
 await screen.findByText("文件和生成记录已导出");
 expect(names.some(name=>name.endsWith("-analysis.csv"))).toBe(true);
 expect(terminate).toHaveBeenCalledOnce();
});
