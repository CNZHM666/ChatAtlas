import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EvidenceReviewButton } from "./EvidenceReviewButton";
import { WorkspaceEvidenceContext } from "../workspace-evidence-context";
import { projectSession } from "../../test/project-fixture";

afterEach(cleanup);
it("opens the exact cited evidence and its group without replacing the caller or confirming data",()=>{
 const session=projectSession(),before=structuredClone(session),ref=session.evidence[0],second={...ref,id:"second",excerpt:"真正的修改依据"},open=vi.fn(),navigate=vi.fn();
 render(<WorkspaceEvidenceContext.Provider value={{open}}><input aria-label="原编辑稿" defaultValue="我的草稿"/><EvidenceReviewButton sources={[ref,second]} zh onLocate={navigate} quote="真正的修改依据"/></WorkspaceEvidenceContext.Provider>);
 fireEvent.click(screen.getByRole("button",{name:"核对依据"}));
 expect(open).toHaveBeenCalledWith(second,{references:[ref,second],quote:"真正的修改依据",claim:undefined});
 expect(navigate).not.toHaveBeenCalled();expect(screen.getByLabelText("原编辑稿")).toHaveValue("我的草稿");expect(session).toEqual(before);
});
it("keeps historical reading separate from confirmation and hides entries without a message",()=>{
 const locate=vi.fn(),ref=projectSession().evidence[0];
 const view=render(<EvidenceReviewButton sources={[ref]} zh historical claim="个人改写的结论" onLocate={locate}/>);
 fireEvent.click(screen.getByRole("button",{name:"回看历史依据"}));expect(locate).toHaveBeenCalledWith(ref);
 view.rerender(<EvidenceReviewButton sources={[]} zh onLocate={locate}/>);expect(screen.queryByRole("button")).toBeNull();
});
