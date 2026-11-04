import { describe, expect, it } from "vitest";
import { groupFocusVersions,workspaceFocusVersions } from "./focus-versions";
import type { FocusSession } from "../shared/focus-session";
const session = (id: string, createdAt: number, patch: Partial<FocusSession> = {}): FocusSession => ({ id, createdAt, updatedAt: createdAt, goal: "Review the project", mode: "work", title: "Project", sourceConversationIds: ["a", "b"], sections: [], evidence: [], completedSectionIds: [], activeSectionId: "", notes: "", ...patch });
describe("one project, recoverable versions", () => {
  it("finds unattached versions by lineage even after the goal changes, without mixing in projects",()=>{
    const root=session("root",1),next=session("next",2,{rootSessionId:"root",previousSessionId:"root",goal:"Updated intent",status:"preview"});
    const versions=workspaceFocusVersions([root,session("unrelated",3,{goal:"Other project"}),session("saved",4,{canvasId:"space"})],next);
    expect(versions.map(item=>item.id)).toEqual(["next","root"]);expect(versions.every(item=>!item.canvasId)).toBe(true);
  });
  it("keeps legacy unsaved scopes separate and leaves deleted versions out",()=>{
    const current=session("current",4);
    expect(workspaceFocusVersions([session("old",1),session("deleted",3,{deletedAt:8}),session("other-source",2,{sourceConversationIds:["c"]}),session("other-mode",2,{mode:"review"})],current).map(item=>item.id)).toEqual(["current","old"]);
  });
  it("keeps every version of an attached project available across goal changes",()=>{
    const current=session("current",4,{canvasId:"space"});
    expect(workspaceFocusVersions([session("old",1,{canvasId:"space",goal:"Original goal"}),session("unattached",3),session("other-project",2,{canvasId:"other"})],current).map(item=>item.id)).toEqual(["current","old"]);
  });
  it("groups four legacy modifications and opens the newest generated version", () => {
    const sessions = [session("original", 1, { updatedAt: 100 }), session("revision1", 2), session("revision2", 3), session("revision3", 4)];
    const groups = groupFocusVersions(sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0].latest.id).toBe("revision3");
    expect(groups[0].versions.map((item) => item.id)).toEqual(["revision3", "revision2", "revision1", "original"]);
    expect(sessions.map((item) => item.id)).toEqual(["original", "revision1", "revision2", "revision3"]);
  });
  it("preserves explicit revision lineage even when the generated title changes", () => {
    const groups = groupFocusVersions([session("root", 1), session("next", 2, { title: "Changed title", rootSessionId: "root", previousSessionId: "root" })]);
    expect(groups).toHaveLength(1); expect(groups[0].latest.title).toBe("Changed title");
  });
  it("keeps different source scopes, spaces and purposes separate", () => {
    expect(groupFocusVersions([session("a", 1), session("b", 2, { sourceConversationIds: ["c"] }), session("c", 3, { canvasId: "space" }), session("d", 4, { mode: "review" })])).toHaveLength(4);
  });
});
