import { describe, expect, it } from "vitest";
import { moduleSignature, projectStateChanges, projectStateModel, projectStateSignature, projectVersionSignature, validateProjectState } from "./project-state";
import { projectSession, projectFixture, projectWire, projectText } from "../test/project-fixture";
import { carryReviewNotes } from "../canvas/review-notes";
it("moves edited-module relations to historical review without inheriting old proof",()=>{
 const session=projectSession(),original=structuredClone(session.projectState),module=session.projectState!.modules[0];session.projectMaintenance={modules:{[module.id]:{...module,purpose:"个人付款方案"}}};
 const model=projectStateModel(session)!;expect(model.modules[0]).toMatchObject({quote:"",evidenceIds:[],userEdited:true});expect(model.relations).toEqual([]);expect(model.pendingRelations).toHaveLength(1);expect(session.projectState).toEqual(original);
});
it("preserves fact provenance when only stable Wiki links are maintained",()=>{
 const session=projectSession(),module=session.projectState!.modules[0];session.projectMaintenance={modules:{[module.id]:{...module,wikiSectionIds:["one"]}}};
 const model=projectStateModel(session)!;expect(model.modules[0].userEdited).toBe(false);expect(model.modules[0].evidenceIds).toEqual(module.evidenceIds);expect(model.relations).toHaveLength(1);
});

it("requires a later original user approval and derives positions locally rather than trusting model metadata",()=>{
  const session=projectSession();session.sourceMessageOrder={source:["plan","approval"]};session.evidence=[{id:"plan",conversationId:"source",messageId:"plan",title:"讨论",excerpt:"v0.2 缺件清单"},{id:"approval",conversationId:"source",messageId:"approval",title:"讨论",excerpt:"确认采用缺件清单"}];
  const event={id:"history:release",title:"采购",version:"v0.2",before:"",after:"缺件清单",reason:"",status:"documented",decisionStatus:"confirmed",quote:"v0.2 缺件清单",evidenceIds:["plan"],beforeQuote:"",beforeEvidenceIds:[],confirmationQuote:"确认采用缺件清单",confirmationEvidenceIds:["approval"],position:{conversationId:"spoofed",messageIndex:999}};
  const wire={...projectWire,modules:[],relations:[],decisions:[],constraints:[],actions:[],history:[event]};
  const sources=[{id:"plan",text:"v0.2 缺件清单",role:"assistant",conversationId:"source",messageId:"plan",messageIndex:1},{id:"approval",text:"确认采用缺件清单",role:"user",conversationId:"source",messageId:"approval",messageIndex:2}];
  expect(validateProjectState(wire,sources,session).history![0].position).toMatchObject({conversationId:"source",messageIndex:1});
  expect(()=>validateProjectState(wire,[sources[0],{...sources[1],role:"assistant"}],session)).toThrow("later original user");
  expect(()=>validateProjectState(wire,[sources[0],{...sources[1],messageIndex:0}],session)).toThrow("later original user");
});

describe("maintained project state", () => {
  it("does not revalidate old choices merely because structure was regenerated",()=>{
    const session=projectSession(),state=session.projectState!;
    session.projectMaintenance={decisions:{[state.decisions[0].id]:{text:state.decisions[0].text,confirmed:true}}};
    state.partSignatures={architecture:state.signature,decisions:"older-material"};
    const model=projectStateModel(session)!;
    expect(model.architectureStale).toBe(false);expect(model.decisionsStale).toBe(true);expect(model.decisions[0].confirmed).toBe(false);
    state.partSignatures.decisions=state.signature;expect(projectStateModel(session)?.decisions[0].confirmed).toBe(true);
  });
  it("requires known scoped evidence and literal quotations for modules and relationships", () => {
    const validate = (value: unknown) => validateProjectState(value, [{ id: "e1", text: projectText }], projectFixture);
    expect(validate(projectWire).modules).toHaveLength(2);
    expect(() => validate({ ...projectWire, modules: [{ ...projectWire.modules[0], quote: "Invented implementation" }] })).toThrow("evidence");
    expect(() => validate({ ...projectWire, relations: [{ ...projectWire.relations[0], to: "unknown" }] })).toThrow("relationship");
    expect(() => validate({ ...projectWire, modules: [{ ...projectWire.modules[0], evidenceIds: ["unknown"] }] })).toThrow("evidence");
    expect(() => validateProjectState(projectWire, [{ id: "e1", text: projectText }], { ...projectFixture, scope: { kind: "goal", blocks: [] } })).toThrow("evidence");
  });
  it("never treats documented AI output as approval, and invalidates acceptance when the actual plan changes", () => {
    const session = projectSession();
    expect(projectStateModel(session)?.decisions[0].confirmed).toBe(false);
    session.projectMaintenance = { acceptedSignature: projectVersionSignature(session.projectState!) };
    expect(projectStateModel(session)?.accepted).toBe(true);
    session.projectState = { ...session.projectState!, summary: "A different plan from the same sources" };
    expect(projectStateModel(session)?.accepted).toBe(false);
  });
  it("separates personal module edits and records conflicts with a later AI version", () => {
    const session = projectSession(), original = session.projectState!.modules[0];
    session.projectMaintenance = { modules: { [original.id]: { ...original, purpose: "我的职责定义", basisSignature: moduleSignature(original) } } };
    session.projectState!.modules[0] = { ...original, purpose: "New AI responsibility" };
    expect(projectStateModel(session)?.modules[0]).toMatchObject({ purpose: "我的职责定义", userEdited: true, changed: true });
    session.projectState!.modules = [];
    expect(projectStateModel(session)?.modules[0]).toMatchObject({ purpose: "我的职责定义", missing: true });
  });
  it("preserves task records and edits across revisions without making stale AI actions look completed", () => {
    const previous = projectSession();
    previous.projectMaintenance = { actions: { "action:test": { text: "完成规则校验测试", done: true }, "user:task": { text: "联系试用者", done: false } } };
    const next = { ...projectFixture, id: "new", sections: [{ ...projectFixture.sections[0], body: "新的讨论内容" }] };
    const carried = { ...next, ...carryReviewNotes(previous, next) };
    expect(projectStateModel(carried)?.stale).toBe(true);
    expect(projectStateModel(carried)?.actions[0].done).toBe(false);
    expect(projectStateModel(carried)?.actions.some(item => item.personal && item.text === "联系试用者")).toBe(true);
    expect(carried.projectMaintenance?.actions?.["action:test"].done).toBe(true);
  });
  it("ignores query excerpts and personal cards in the material signature, but invalidates source/body edits", () => {
    const session = projectSession(), signature = projectStateSignature(session);
    session.evidence.push({ ...session.evidence[0], id: "query:extra" });
    session.sections.push({ ...session.sections[0], id: "user:card", origin: "user", body: "Personal query excerpt" });
    expect(projectStateSignature(session)).toBe(signature);
    session.sections[0].body += "修正约束";
    expect(projectStateSignature(session)).not.toBe(signature);
  });
  it("exposes actual module and decision changes before replacing a version", () => {
    const before = projectSession(), after = projectSession();
    after.projectState!.modules[0].purpose = "Changed purpose";
    after.projectState!.decisions[0].text = "Changed choice";
    expect(projectStateChanges(before, after)).toMatchObject({ changed: [{ id: "module:input" }], decisions: [{ id: "decision:scope" }] });
  });
});
