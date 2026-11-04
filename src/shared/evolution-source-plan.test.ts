import { expect,it } from "vitest";
import { evolutionSourcePlan,shortDecisionReply } from "./evolution-source-plan";
import type { ConversationMessage } from "./types";
import type { ProjectHistoryAnalysis } from "./project-history";
const message=(id:string,content:string,index:number):ConversationMessage=>({id,conversationId:"c",role:"user",content,messageIndex:index,createdAt:1000+index,updatedAt:1,contentHash:"",preview:""});
it("detects additions, edits, deletion and adjacent dependencies without storing source text",()=>{
 const messages=Array.from({length:8},(_,index)=>message(`m${index}`,`原文 ${index}`,index)),first=evolutionSourcePlan(messages);
 const saved={sourceManifest:first.manifest,events:[{id:"event",quote:"原文 3",evidenceIds:["e"]}],sources:[{id:"e",conversationId:"c",messageId:"m3"}]} as ProjectHistoryAnalysis;
 const next=[...messages.map(item=>item.id==="m4"?{...item,content:"先不改了"}:item),message("new","继续讨论",8)].filter(item=>item.id!=="m7");
 const plan=evolutionSourcePlan(next,saved);expect(plan.added).toHaveLength(1);expect(plan.removed).toHaveLength(1);expect(plan.affectedEventIds).toEqual(["event"]);expect(plan.context("c","m0")).toBe(first.context("c","m0"));expect(plan.context("c","m3")).not.toBe(first.context("c","m3"));expect(JSON.stringify(plan.manifest)).not.toContain("先不改了");
});
it("does not let old imported conversation timestamps alter existing message context",()=>{
 const rows=[message("m","确认采用",0)],first=evolutionSourcePlan(rows),old={...message("old","原来的讨论",0),conversationId:"other",createdAt:1};
 expect(evolutionSourcePlan([old,...rows]).context("c","m")).toBe(first.context("c","m"));
});
it.each(["可以","好","先不改了，继续沿用现有方案。","就这么改","还是用原来的","not now","okay"])("keeps short decision context for %s without asserting confirmation",content=>{expect(shortDecisionReply(message("m",content,0))).toBe(true);});
it.each(["帮我执行P0-P1优化","可以帮我进行优化了","请直接实现这个方案"])("recalls explicit implementation requests with their preceding context: %s",content=>{expect(shortDecisionReply(message("m",content,0))).toBe(true);});
