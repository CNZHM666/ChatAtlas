import { expect, it } from "vitest";
import { evolutionKnowledge } from "../test/evolution-fixture";
import { effectiveProjectEvolution } from "./project-evolution";
import { projectFactState, factTextKey } from "./project-fact-state";

it("does not merge version numbers, quantities or different facts sharing a short confirmation quote", () => {
  expect(factTextKey("采用 v1.2。")).not.toBe(factTextKey("采用 v12。"));
  expect(factTextKey("失败率必须低于 1.5%。")).not.toBe(factTextKey("失败率必须低于 15%。"));
  const knowledge = evolutionKnowledge(), effective = effectiveProjectEvolution(knowledge.session, knowledge.messages);
  const previous = effective[0].previous[0];
  expect(projectFactState(knowledge.session,effective).retiredClaim({text:"另一个模块的独立决定",quote:previous.quote,evidenceIds:previous.evidenceIds})).toBe(false);
});
it("does not retire existing knowledge because a related new suggestion exists", () => {
  const knowledge = evolutionKnowledge();
  const record = knowledge.session.projectHistoryAnalysis!.events[1]; record.decisionStatus = "proposed"; record.status = "proposal";
  const facts = projectFactState(knowledge.session, effectiveProjectEvolution(knowledge.session, knowledge.messages));
  expect(facts.retired("数据库使用 SQLite")).toBe(false);
});
it("never treats an assistant plan or completion statement as user approval or a user work report", () => {
  const session = evolutionKnowledge().session, facts = projectFactState(session);
  const claim = { text: "完成检索", quote: "完成检索", evidenceIds: ["e"] };
  expect(facts.claimStatus({ ...claim, workStatus: "reported" }, [], ["assistant"])).toBe("recorded");
  expect(facts.claimStatus({ ...claim, workStatus: "planned" }, [], ["assistant"])).toBe("proposal");
  expect(facts.claimStatus({ ...claim, workStatus: "reported" }, [], ["user"])).toBe("reported");
  expect(facts.claimStatus({ ...claim, overviewRole: "decision" }, [], ["user"])).toBe("uncertain");
});
