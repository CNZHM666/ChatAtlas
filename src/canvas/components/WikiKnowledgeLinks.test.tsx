import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { projectSession } from "../../test/project-fixture";
import { projectMatters } from "../../shared/project-matters";
import { projectQuestionKey } from "../../shared/project-state";
import { linkMatterKnowledge, matterKnowledgeSignature } from "../../shared/project-knowledge-links";
import { ProjectKnowledgeActions } from "../project-knowledge-actions";
import { WikiKnowledgeLinks } from "./WikiKnowledgeLinks";
afterEach(cleanup);
it("keeps caveats visible, moves management to details, and only unlinks after confirmation",async()=>{
 let stored=projectSession();const text="核心流程是否可用？";
 stored.projectMaintenance={questions:{[projectQuestionKey(text)]:{text,originalText:text,resolved:true,resolution:"已验证输入与预览。",resolutionReason:"实物测试仍未完成。"}}};
 const matter=projectMatters(stored).find(item=>item.text===text)!;
 stored=linkMatterKnowledge(stored,matter,stored.sections[0].id,matterKnowledgeSignature(matter));const originalBody=stored.sections[0].body;
 const locate=vi.fn();
 function Harness(){const [session,setSession]=useState(stored);return <ProjectKnowledgeActions.Provider value={{read:vi.fn(),matter:locate,save:async update=>{stored=update(stored);setSession(stored);}}}><WikiKnowledgeLinks editing session={session} section={session.sections[0]} zh/></ProjectKnowledgeActions.Provider>;}
 render(<Harness/>);
 expect(screen.getByText(/已验证输入与预览。 实物测试仍未完成。/)).toBeVisible();
 expect(screen.getByRole("button",{name:"移除关联"})).not.toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"查看依据"}));expect(locate).toHaveBeenCalledWith(expect.objectContaining({id:matter.id}));
 fireEvent.click(screen.getByLabelText("事项关联操作"));fireEvent.click(screen.getByRole("button",{name:"移除关联"}));
 expect(screen.getByRole("dialog")).toBeVisible();expect(stored.sections[0].matterLinks).toHaveLength(1);
 fireEvent.click(screen.getByRole("button",{name:"取消"}));expect(stored.sections[0].matterLinks).toHaveLength(1);
 fireEvent.click(screen.getByLabelText("事项关联操作"));fireEvent.click(screen.getByRole("button",{name:"移除关联"}));fireEvent.click(screen.getByRole("button",{name:"确认移除关联"}));
 await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
 expect(stored.sections[0].matterLinks).toEqual([]);expect(stored.sections[0].body).toBe(originalBody);expect(projectMatters(stored).find(item=>item.id===matter.id)?.resolution).toBe("已验证输入与预览。");
});
