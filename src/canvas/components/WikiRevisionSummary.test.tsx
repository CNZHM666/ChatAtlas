import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it} from "vitest";
import {WikiRevisionSummary} from "./WikiRevisionSummary";
afterEach(cleanup);
it("shows actual reused batches and makes material left in sources reviewable",()=>{
 render(<WikiRevisionSummary zh evidence={[{id:"e1",conversationId:"c",messageId:"m",title:"原始讨论",excerpt:"原文"}]} receipt={{version:1,basisSessionId:"s",batches:6,cachedBatches:4,draftUnits:10,sourceUnits:75,references:[{conversationId:"c",messageId:"m",start:0,end:10,evidenceIds:["e1"],excerpt:"另一项目的说明。",reason:"这是另一个项目的比较示例，保留在原始来源。"}]}}/>);
 expect(screen.getByText(/复用 4 批缓存/)).toBeVisible();fireEvent.click(screen.getByText("保留在来源中的材料 1 项"));expect(screen.getByText("另一项目的说明。")).toBeVisible();expect(screen.getByText(/比较示例/)).toBeVisible();
});
