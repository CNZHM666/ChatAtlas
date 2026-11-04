import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {DeveloperKnowledgeCheck} from "./DeveloperKnowledgeCheck";
import {knowledgeCheckScenario} from "../knowledge-local-checks";
const read=vi.hoisted(()=>vi.fn());vi.mock("../../storage/focus-sessions",()=>({listFocusSessions:read}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("only loads projects on request and checks saved knowledge without changing it",async()=>{
 const {session}=knowledgeCheckScenario([{text:"全部功能已经实现。",role:"assistant",kind:"progress"}]),before=structuredClone(session),onResult=vi.fn();read.mockResolvedValue([session,{...session,id:"preview",status:"preview"}]);
 render(<DeveloperKnowledgeCheck zh onResult={onResult}/>);expect(read).not.toHaveBeenCalled();fireEvent.click(screen.getByText("检查项目内容"));await screen.findByRole("combobox",{name:"选择检查项目"});
 await waitFor(()=>expect(screen.getByRole("button",{name:"检查已保存知识"})).toBeEnabled());expect(screen.queryByRole("option",{name:"preview"})).toBeNull();fireEvent.click(screen.getByRole("button",{name:"检查已保存知识"}));expect(screen.getByText(/完成描述仍缺少直接报告/u)).toBeVisible();expect(session).toEqual(before);expect(onResult).toHaveBeenCalledOnce();
});
it("shows a retryable read failure and never certifies model output",async()=>{
 read.mockRejectedValue(Error("failed"));render(<DeveloperKnowledgeCheck zh/>);fireEvent.click(screen.getByText("检查项目内容"));await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("读取项目失败"));expect(screen.queryByText("质量通过")).toBeNull();
});
