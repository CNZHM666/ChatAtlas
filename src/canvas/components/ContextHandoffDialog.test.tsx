import "fake-indexeddb/auto";
import {render,screen,fireEvent,cleanup,waitFor} from "@testing-library/react";
import {beforeEach,afterEach,expect,it,vi} from "vitest";
import {ContextHandoffDialog} from "./ContextHandoffDialog";
import {getDatabase} from "../../storage/db";
import {makeContextHandoff,saveContextHandoff,readContextHandoff,validateContextHandoff} from "../../storage/context-handoff";
import * as handoffs from "../../storage/context-handoff";
const source={id:"handoff",title:"选定对话",platform:"chatgpt",url:"https://chatgpt.com/c/handoff",updatedAt:1,messageCount:1,hydrationState:"hydrated" as const,importState:"complete" as const};
const message={id:"handoff:m",conversationId:source.id,role:"user" as const,content:"只整理选定消息",preview:"",messageIndex:0,createdAt:1,updatedAt:1,contentHash:""};
beforeEach(async()=>{const db=await getDatabase();await db.clear("messages");await db.clear("conversations");await db.put("conversations",source);await db.put("messages",message);});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("restores task and scope and starts only after explicit confirmation",async()=>{
 const request=makeContextHandoff("验证约束",[{conversation:source,messages:[message]}]),start=vi.fn(),sync=vi.fn();
 render(<ContextHandoffDialog request={request} zh onClose={vi.fn()} onStart={start} onSync={sync}/>);expect(screen.getByRole("textbox",{name:"整理目标"})).toHaveValue("验证约束");expect(start).not.toHaveBeenCalled();expect(sync).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"AI 深度整理"}));await waitFor(()=>expect(start).toHaveBeenCalledExactlyOnceWith("验证约束",[source]));expect(request.scope.blocks?.[0].messageIds).toEqual([message.id]);
});
it("refuses changed roles or source text before analysis and keeps the request visible",async()=>{
 const request=makeContextHandoff("验证约束",[{conversation:source,messages:[message]}]),start=vi.fn();await(await getDatabase()).put("messages",{...message,role:"assistant"});
 render(<ContextHandoffDialog request={request} zh onClose={vi.fn()} onStart={start} onSync={vi.fn()}/>);fireEvent.click(screen.getByRole("button",{name:"AI 深度整理"}));expect(await screen.findByRole("alert")).toHaveTextContent("来源已变化");expect(start).not.toHaveBeenCalled();
});
it("does not start a late validation after closing the workbench confirmation",async()=>{
 let finish!:(value:typeof source[])=>void;vi.spyOn(handoffs,"validateContextHandoff").mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const start=vi.fn(),close=vi.fn();
 render(<ContextHandoffDialog request={makeContextHandoff("",[{conversation:source,messages:[message]}])} zh onClose={close} onStart={start} onSync={vi.fn()}/>);fireEvent.click(screen.getByRole("button",{name:"AI 深度整理"}));fireEvent.click(screen.getByRole("button",{name:"关闭面板"}));finish([source]);await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(start).not.toHaveBeenCalled();
});
it("stores only the exact scope and validates the transient handoff after reload",async()=>{
 const records:Record<string,unknown>={};vi.stubGlobal("chrome",{storage:{session:{set:async(value:Record<string,unknown>)=>Object.assign(records,value),get:async(id:string)=>({[id]:records[id]}),remove:async(id:string)=>{delete records[id];}}}});
 const request=makeContextHandoff("任务",[{conversation:source,messages:[message,message]}]);await saveContextHandoff(request);expect(await readContextHandoff(request.id)).toEqual(request);expect(JSON.stringify(records)).not.toContain(message.content);expect(request.scope.blocks?.[0].messageIds).toEqual([message.id]);await expect(validateContextHandoff(request)).resolves.toHaveLength(1);
 const db=await getDatabase();await db.delete("messages",message.id);await expect(validateContextHandoff(request)).rejects.toThrow("SOURCE_CHANGED");
});
