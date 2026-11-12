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
 const all=screen.getByRole("checkbox",{name:"Wiki 章节"}) as HTMLInputElement;
 expect(all).toBeChecked();fireEvent.click(screen.getByRole("button",{name:"选择 Wiki 章节"}));
 fireEvent.click(screen.getByRole("checkbox",{name:"另一章节"}));expect(all.indeterminate).toBe(true);
 fireEvent.click(all);expect(all.indeterminate).toBe(false);expect(screen.getByRole("checkbox",{name:"另一章节"})).toBeChecked();
 expect(screen.queryByText(/包含可点击目录|按项目顺序导出/)).toBeNull();expect(screen.getByRole("checkbox",{name:"附来源摘录"})).not.toBeChecked();
});
it("lets the user select an individual Wiki and exports a complete safe document",async()=>{
 const create=vi.fn().mockReturnValue("blob:fixture");vi.stubGlobal("URL",class extends URL{static createObjectURL=create;static revokeObjectURL=vi.fn();});const click=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{}),close=vi.fn();
 render(<ProjectExportDialog session={contextKnowledge().session} zh onClose={close}/>);
 expect(screen.getByRole("combobox",{name:"文件格式"})).toHaveValue("md");
 expect(screen.queryByText(/包含可点击目录/)).toBeNull();expect(screen.getByRole("button",{name:"选择 Wiki 章节"})).toHaveAttribute("aria-expanded","false");
 fireEvent.click(screen.getByRole("checkbox",{name:"项目总览"}));fireEvent.click(screen.getByRole("checkbox",{name:"Wiki 章节"}));expect(screen.getByRole("button",{name:"导出"})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"选择 Wiki 章节"}));fireEvent.click(screen.getByRole("checkbox",{name:"数据库存储"}));fireEvent.click(screen.getByRole("button",{name:"导出"}));await screen.findByText("文件已导出");
 const reader=new FileReader();reader.readAsText(create.mock.calls[0][0]);await waitFor(()=>expect(reader.result).toBeTruthy());expect(String(reader.result)).toContain("数据库使用 IndexedDB");expect(String(reader.result)).not.toContain("const action");expect(String(reader.result)).not.toContain("绝不默认带出的私人笔记");expect(click).toHaveBeenCalledOnce();
 fireEvent.keyDown(screen.getByRole("dialog"),{key:"Escape"});expect(close).toHaveBeenCalledOnce();
});
it("exports the knowledge ledger as its own JSON file when ticked, with no note under the source option",async()=>{
 const create=vi.fn().mockReturnValue("blob:fixture");vi.stubGlobal("URL",class extends URL{static createObjectURL=create;static revokeObjectURL=vi.fn();});
 const names:string[]=[];vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(function(this:HTMLAnchorElement){names.push(this.download);});
 const session={...contextKnowledge().session,title:"ChatAtlas",runId:"run-1",wikiKnowledge:{version:1,generatedAt:0,status:"complete",materials:0,batches:[]}} as Parameters<typeof ProjectExportDialog>[0]["session"];
 render(<ProjectExportDialog session={session} zh onClose={vi.fn()}/>);
 expect(screen.queryByText(/始终保留|核对原话/)).toBeNull();
 const ledger=screen.getByRole("checkbox",{name:/知识点账本/});expect(ledger).not.toBeChecked();
 // The ledger alone is enough to export.
 fireEvent.click(screen.getByRole("checkbox",{name:"项目总览"}));fireEvent.click(screen.getByRole("checkbox",{name:"Wiki 章节"}));fireEvent.click(ledger);
 fireEvent.click(screen.getByRole("button",{name:"导出"}));await screen.findByText("账本已导出");
 expect(names).toEqual(["ChatAtlas-ledger.json"]);
 const reader=new FileReader();reader.readAsText(create.mock.calls[0][0]);await waitFor(()=>expect(reader.result).toBeTruthy());
 expect(JSON.parse(String(reader.result))).toMatchObject({title:"ChatAtlas",runId:"run-1",ledger:{version:1,status:"complete"}});
 // A document without a ledger offers none.
 cleanup();render(<ProjectExportDialog session={contextKnowledge().session} zh onClose={vi.fn()}/>);
 expect(screen.queryByRole("checkbox",{name:/知识点账本/})).toBeNull();
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
 fireEvent.click(screen.getByRole("checkbox",{name:/生成记录/}));
 fireEvent.click(screen.getByRole("button",{name:"导出"}));
 expect(screen.getByText("正在准备生成记录…")).toBeInTheDocument();
 expect(post).toHaveBeenCalledWith({runId:"run-1",sourceConversationIds:session.sourceConversationIds});
 receive?.({data:{csv:"\uFEFFrun_id\r\nrun-1\r\n"}});
 await screen.findByText("文件和生成记录已导出");
 expect(names.some(name=>name.endsWith("-analysis.csv"))).toBe(true);
 expect(terminate).toHaveBeenCalledOnce();
});
