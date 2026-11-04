import { expect, it } from "vitest";
import { projectEvidenceAliases, validateProjectDraft } from "./project-output";
import { projectFixture, projectText, projectWire } from "../test/project-fixture";
const sources = [{ id: "e1", conversationId: "source", messageId: "message", signature: "v1", role: "assistant" as const, messageIndex: 1, discussedAt: 1, text: projectText, partial: false }];

it("isolates an invalid claim while keeping independently valid architecture and canonical provenance", () => {
  const result = validateProjectDraft({ ...projectWire, constraints: [{ ...projectWire.constraints[0], evidenceIds: ["invented"] }] }, sources, projectFixture);
  expect(result.modules).toHaveLength(2); expect(result.relations).toHaveLength(1); expect(result.constraints).toEqual([]);
  expect(result.reviewNotes).toHaveLength(1); expect(result.reviewNotes![0].key).toBe("constraints:0");
  expect(result.modules[0].evidenceIds).toEqual(["e1"]); expect(projectWire.constraints).toHaveLength(1);
});
it("does not publish an entirely invented plan or accept a malformed structure", () => {
  expect(() => validateProjectDraft({ summary: "fiction", modules: [{ ...projectWire.modules[0], evidenceIds: ["fake"] }], relations: [] }, sources, projectFixture)).toThrow("no valid facts");
  expect(() => validateProjectDraft({ ...projectWire, relations: "bad" }, sources, projectFixture)).toThrow();
});
it("rejects relations whose endpoints were removed, keeping sound peers", () => {
  const result = validateProjectDraft({ ...projectWire, modules: [projectWire.modules[0], { ...projectWire.modules[1], quote: "does not occur" }] }, sources, projectFixture);
  expect(result.modules).toHaveLength(1); expect(result.relations).toEqual([]);
  expect(result.reviewNotes!.map(note => note.key)).toEqual(["modules:1", "relations:0"]);
});
it("shortens only evidence references, restores originals and avoids canonical ID collisions", () => {
  const aliases = projectEvidenceAliases([{ id: "s1" }, { id: "original-long-id" }]);
  const value = { id: "s1", text: "s1 is a literal", evidenceIds: ["s1", "original-long-id"], history: [{ beforeEvidenceIds: ["s1"], reasonEvidenceIds: ["original-long-id"] }] };
  expect(aliases.id("s1")).toBe("xs1");
  expect(aliases.encode(value)).toMatchObject({ id: "s1", text: "s1 is a literal", evidenceIds: ["xs1", "xs2"] });
  expect(aliases.decode(aliases.encode(value))).toEqual(value); expect(aliases.decode(value)).toEqual(value);
});

it.each(["not a list", null, { id: "question:bad", text: "Invalid project records" }])("isolates a malformed matter collection without turning it into a task: %j", questions => {
  const snapshot = structuredClone(projectWire);
  const result = validateProjectDraft({ ...projectWire, questions }, sources, projectFixture);
  expect(result.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ id: "decision:scope" })]));
  expect(result.questions).toEqual([]);
  expect(result.reviewNotes).toEqual([expect.objectContaining({ key: "questions", reason: "Invalid project records: questions must be an array" })]);
  expect(JSON.stringify([...result.decisions, ...result.constraints, ...result.questions!])).not.toContain("Invalid project records");
  expect(projectWire).toEqual(snapshot);
});

it("does not report an entirely malformed matter response as a successful empty analysis", () => {
  expect(() => validateProjectDraft({ summary: "项目事项", modules: [], relations: [], decisions: [], constraints: [], questions: "Invalid project records" }, sources, projectFixture)).toThrow("Invalid project records: questions must be an array");
});

it("rejects oversized collections explicitly without silently truncating them or losing valid peers", () => {
  const questions = Array.from({ length: 129 }, (_, index) => ({ ...projectWire.decisions[0], id: `question:${index}` }));
  const result = validateProjectDraft({ ...projectWire, questions }, sources, projectFixture);
  expect(result.questions).toEqual([]);
  expect(result.constraints).toHaveLength(1);
  expect(result.reviewNotes).toEqual([expect.objectContaining({ key: "questions", reason: "Invalid project records: questions exceeds 128 items" })]);
});


it("preserves confirmation and work evidence through compact wire aliases",()=>{
 const aliases=projectEvidenceAliases([{id:"actual:proposal"},{id:"actual:user-approval"}]);
 const value={confirmationEvidenceIds:["actual:user-approval"],workEvidenceIds:["actual:user-approval"],evidenceIds:["actual:proposal"]};
 expect(aliases.decode(aliases.encode(value))).toEqual(value);
 expect(aliases.encode(value)).not.toEqual(value);
});

it.each([
 {role:"assistant" as const,quote:"建议采用卡片式首页。"},
 {role:"user" as const,quote:"我喜欢使用卡片式首页，但还没有正式定案。"},
])("rejects generated adoption language unsupported by the original speaker: $role",({role,quote})=>{
 const source={id:"approval-test",conversationId:"source",messageId:"approval",signature:"v1",role,messageIndex:2,discussedAt:2,text:quote,partial:false};
 const session={...projectFixture,evidence:[...projectFixture.evidence,{id:source.id,conversationId:source.conversationId,messageId:source.messageId,title:"决策讨论",excerpt:quote}]};
 const result=validateProjectDraft({...projectWire,decisions:[{id:"decision:inflated",text:"团队确认了卡片式首页作为正式设计基准。",reason:"",status:"documented",quote,evidenceIds:[source.id]}]},[...sources,source],session);
 expect(result.decisions).toEqual([]);
 expect(result.modules).toHaveLength(2);
 expect(result.reviewNotes?.some(note=>note.reason.includes("status attribution"))).toBe(true);
});

it("accepts an original explicit user decision without implying implementation",()=>{
 const quote="我决定采用卡片式首页。",source={id:"approval-test",conversationId:"source",messageId:"approval",signature:"v1",role:"user" as const,messageIndex:2,discussedAt:2,text:quote,partial:false};
 const session={...projectFixture,evidence:[...projectFixture.evidence,{id:source.id,conversationId:source.conversationId,messageId:source.messageId,title:"决策讨论",excerpt:quote}]};
 const result=validateProjectDraft({...projectWire,decisions:[{id:"decision:actual",text:"用户已确认采用卡片式首页。",reason:"",status:"documented",quote,evidenceIds:[source.id]}]},[...sources,source],session);
 expect(result.decisions).toHaveLength(1);
 expect(result.decisions[0].quote).toBe(quote);
});
