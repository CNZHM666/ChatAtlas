import {expect,it} from "vitest";
import {projectSubjectGroups,projectSubjectKey,reviewedSubjectAliases} from "./project-subjects";
import {historyReplacementTargets} from "./project-history-links";
import {changeBarrier} from "./product-change-matching";
import {effectiveProjectEvolution} from "./project-evolution";
import {evolutionKnowledge} from "../test/evolution-fixture";

it("links reviewed aliases transitively while preserving separate states and unrelated subjects",()=>{
 const [a,b,c]=evolutionKnowledge().session.projectHistoryAnalysis!.events;
 a.areaAliases=["Local database"];b.area="Local database";b.areaAliases=["本地存储选型"];
 const groups=projectSubjectGroups([a,b,c]);expect(projectSubjectKey(a,groups)).toBe(projectSubjectKey(b,groups));
 expect(projectSubjectKey(a,groups)).not.toBe(projectSubjectKey(c,groups));
 expect(historyReplacementTargets(b,[a])).toEqual([a]);
 expect(historyReplacementTargets({...b,before:"未出现的旧方案"},[a])).toEqual([]);
});
it("applies a sourced replacement across a reviewed alias, retaining the old evidence",()=>{
 const knowledge=evolutionKnowledge(),events=knowledge.session.projectHistoryAnalysis!.events;
 events[0].areaAliases=["Local database"];events[1].area="Local database";
 const result=effectiveProjectEvolution(knowledge.session,knowledge.messages);
 expect(result.some(item=>item.event.id===events[0].id)).toBe(false);
 expect(result.find(item=>item.event.id===events[1].id)!.previous[0].id).toBe(events[0].id);
});
it("does not deduplicate a resumed choice across a cancellation under another reviewed name",()=>{
 const [original]=evolutionKnowledge().session.projectHistoryAnalysis!.events;
 original.areaAliases=["Local database"];
 const retired={...original,id:"stop",area:"Local database",changeKind:"retire" as const,after:"取消本地数据库"};
 expect(changeBarrier([original,retired],original,{...original,id:"resume"})).toBe(true);
});
it("keeps alias receipts stable across casing and whitespace differences",()=>{
 const [event]=evolutionKnowledge().session.projectHistoryAnalysis!.events;
 event.areaAliases=["Local database"];
 expect(reviewedSubjectAliases(event,{...event,area:"LOCAL DATABASE",areaAliases:[" local database "]})).toEqual(["Local database"]);
});
