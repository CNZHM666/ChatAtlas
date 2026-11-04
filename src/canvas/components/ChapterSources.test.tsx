import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {ChapterSources} from "./ChapterSources";
import {WikiSources} from "./WikiSources";
import {readSessionSource} from "../../storage/source-versions";
import {projectSession} from "../../test/project-fixture";
vi.mock("../../storage/source-versions",()=>({readSessionSource:vi.fn(async()=>[])}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("shows the source disclosure without a count of its own",()=>{
 const session=projectSession(),first=session.evidence[0];session.evidence=[first,{...first,id:"second",messageId:"other-message"}];session.sections[0].evidenceIds=session.evidence.map(ref=>ref.id);
 render(<WikiSources session={session} section={session.sections[0]} zh onLocate={()=>{}}/>);
 const title=screen.getByText("来源与原始讨论").closest("summary")!;expect(title).toHaveTextContent(/^来源与原始讨论$/u);
});
it("shows compact question links without repeating the first question header or reference-count row",async()=>{
 const session=projectSession(),ref=session.evidence[0],locate=vi.fn();
 vi.mocked(readSessionSource).mockResolvedValue([{id:ref.messageId,conversationId:ref.conversationId,role:"user",messageIndex:0,content:"为什么采用本地消息索引？",preview:"",contentHash:"",createdAt:1,updatedAt:1}]);
 render(<ChapterSources compact session={session} refs={[ref]} conversations={[]} zh onLocate={locate}/>);
 const question=await screen.findByText("为什么采用本地消息索引？");expect(question).toHaveAttribute("title","为什么采用本地消息索引？");expect(screen.queryByText(/条引用/)).toBeNull();expect(screen.queryByText("引用片段")).toBeNull();
 fireEvent.click(question);expect(locate).toHaveBeenCalledWith(ref);
});
it("groups only supplied chapter conversations, renders Markdown and preserves each original version",async()=>{
 const session=projectSession(),locate=vi.fn(),ref={...session.evidence[0],excerpt:"**保留原始消息**",sourceVersionId:"v1"};
 vi.mocked(readSessionSource).mockImplementation(async(_session,id,_message,version)=>[{id:ref.messageId,conversationId:id,messageIndex:0,role:"assistant",content:version==="v1"?"**保留原始消息**\n\n```ts\nconst stored = true;\n```":"**新版内容**",preview:"",contentHash:"",createdAt:1,updatedAt:1}]);
 render(<ChapterSources session={session} refs={[ref,{...ref,id:"duplicate"},{...ref,id:"other-version",sourceVersionId:"v2",excerpt:"**新版内容**"}]} conversations={[{id:ref.conversationId,title:"架构讨论",platform:"chatgpt",url:"",updatedAt:1,messageCount:1},{id:"unrelated",title:"未引用的对话",platform:"claude",url:"",updatedAt:1,messageCount:1}]} zh onLocate={locate}/>);
 expect(screen.queryByText("未引用的对话")).toBeNull();expect(screen.queryByRole("button",{name:"添加对话"})).toBeNull();expect(screen.queryByRole("button",{name:"调整材料"})).toBeNull();
 expect(screen.getByRole("button",{name:/用户问题待定位 ChatGPT · 2 条引用/})).toBeVisible();
 fireEvent.click(screen.getByText("引用片段"));
 await waitFor(()=>expect(screen.getByText("保留原始消息",{selector:"strong"})).toBeVisible());
 expect(screen.getByText("新版内容",{selector:"strong"})).toBeVisible();
 expect(readSessionSource).toHaveBeenCalledWith(session,ref.conversationId,ref.messageId,"v1");expect(readSessionSource).toHaveBeenCalledWith(session,ref.conversationId,ref.messageId,"v2");
 fireEvent.click(screen.getByRole("button",{name:"引用 2"}));expect(locate).toHaveBeenCalledWith(expect.objectContaining({sourceVersionId:"v2"}));
});
