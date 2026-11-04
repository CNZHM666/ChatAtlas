import {afterEach,expect,it,vi} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import {WikiRewritePreview} from "./WikiRewritePreview";
import {projectSession} from "../../test/project-fixture";
afterEach(cleanup);
it("shows the proposed title and the shared restrained emphasis before applying a rewrite",()=>{
 const previous=projectSession().sections[0],phrase="保留原始内容及个人笔记";
 const next={...previous,title:"失败保护",body:`## 失败处理\n\n${phrase}。\n\n${Array.from({length:9},(_,step)=>`第 ${step+1} 段原始讨论按照发生顺序保存，阅读时逐步恢复以前形成的理解。`).join("")}`,claims:[{text:phrase,quote:phrase,evidenceIds:["e1"]}]};
 const {container}=render(<WikiRewritePreview previous={previous} next={next} zh busy={false} onApply={vi.fn()} onDiscard={vi.fn()}/>);
 expect(screen.getByRole("heading",{name:"新稿 · 失败保护"})).toBeVisible();expect([...container.querySelectorAll("strong")].some(node=>node.textContent===phrase)).toBe(true);
 expect(previous.title).toBe("核心流程");
});
it("shows a failed name review while keeping the candidate prose available",()=>{
 const previous=projectSession().sections[0],next={...previous,body:"可用的新正文。",wikiTitleReview:{version:2 as const,status:"failed" as const,requested:1,accepted:0,rejected:[{id:"c:0",reason:"missing"}]}};
 render(<WikiRewritePreview previous={previous} next={next} zh busy={false} onApply={vi.fn()} onDiscard={vi.fn()}/>);
 expect(screen.getByRole("status")).toHaveTextContent("标题未整理完成");expect(screen.getByText("可用的新正文。")).toBeVisible();expect(screen.getByRole("button",{name:"采用这次整理"})).toBeEnabled();
});
