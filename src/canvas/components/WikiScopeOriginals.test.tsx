import {act,cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {WikiScopeOriginals} from "./WikiScopeOriginals";
import {WikiScopeReaderPanel} from "./WikiScopeReaderPanel";
import {contextKnowledge} from "../../test/context-fixture";
import {readSessionSource} from "../../storage/source-versions";
import type {ConversationMessage} from "../../shared/types";
vi.mock("../../storage/source-versions",()=>({readSessionSource:vi.fn()}));
beforeEach(()=>vi.resetAllMocks());afterEach(cleanup);

it("loads the full retained original automatically instead of requiring an excerpt button",async()=>{
 const {session,messages}=contextKnowledge();
 const reference={...session.evidence[0],excerpt:"只有一段摘录",sourceVersionId:"retained-v1"};session.evidence=[reference];
 const full={...messages[0],content:"完整原文开头。\n\n摘录之外的最后一段也直接显示。"};
 vi.mocked(readSessionSource).mockResolvedValue([full]);
 const material={id:"m",key:"m",title:"材料",body:"AI 整理摘要",kind:"uncertain" as const,reason:"归属待核对",quote:"",evidenceIds:[reference.id]};
 render(<WikiScopeReaderPanel session={session} material={material} materials={[material]} zh onSelect={vi.fn()} onClose={vi.fn()} onSource={vi.fn()}/>);
 const originals=screen.getByRole("region",{name:"材料原文"});
 expect(await within(originals).findByText("摘录之外的最后一段也直接显示。")).toBeVisible();
 expect(within(originals).getByText("完整原文开头。")).toBeVisible();
 expect(screen.getByText("AI 整理摘要")).not.toBeVisible();
 expect(readSessionSource).toHaveBeenCalledExactlyOnceWith(session,reference.conversationId,reference.messageId,"retained-v1");
 expect(screen.queryByRole("button",{name:"查看原文"})).toBeNull();
});

it("does not display a late result from the previously selected material",async()=>{
 const {session,messages}=contextKnowledge();let resolveOld!:(value:ConversationMessage[])=>void;
 vi.mocked(readSessionSource).mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockResolvedValueOnce([{...messages[1],content:"新的材料原文"}]);
 const props={session,zh:true,onSource:vi.fn()};
 const {rerender}=render(<WikiScopeOriginals {...props} references={[session.evidence[0]]}/>);
 rerender(<WikiScopeOriginals {...props} references={[session.evidence[1]]}/>);
 expect(await screen.findByText("新的材料原文")).toBeVisible();
 await act(async()=>resolveOld([{...messages[0],content:"上一项的旧原文"}]));
 expect(screen.queryByText("上一项的旧原文")).toBeNull();expect(screen.getByText("新的材料原文")).toBeVisible();
});

it("labels unavailable sources as excerpts and supports a failed local read retry",async()=>{
 const {session,messages}=contextKnowledge();
 vi.mocked(readSessionSource).mockRejectedValueOnce(new Error("storage unavailable")).mockResolvedValueOnce([{...messages[0],content:"重试后的完整原文"}]);
 render(<WikiScopeOriginals session={session} references={[session.evidence[0]]} zh onSource={vi.fn()}/>);
 expect(await screen.findByText("原文读取失败，以下为已保存摘录。")).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"重新读取原文"}));
 expect(await screen.findByText("重试后的完整原文")).toBeVisible();expect(screen.queryByText("原文读取失败，以下为已保存摘录。")).toBeNull();
});

it("deduplicates multiple excerpts of the same original and reports a missing original honestly",async()=>{
 const {session}=contextKnowledge(),ref=session.evidence[0];
 vi.mocked(readSessionSource).mockResolvedValue([]);
 const {container}=render(<WikiScopeOriginals session={session} references={[ref,{...ref,id:"same-source",excerpt:"另一个摘录"}]} zh onSource={vi.fn()}/>);
 expect(await screen.findByText("原文暂不可用，以下仅为已保存摘录。")).toBeVisible();
 expect(container.querySelectorAll(".wiki-scope-original-message")).toHaveLength(1);expect(readSessionSource).toHaveBeenCalledTimes(1);
});
