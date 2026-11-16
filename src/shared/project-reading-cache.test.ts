import { expect, it, vi } from "vitest";
import { createProjectReadingCache } from "./project-reading-cache";
import { contextKnowledge } from "../test/context-fixture";

it("reuses projections across navigation and page remounts while keeping different projects isolated", () => {
 const session=contextKnowledge().session,cache=createProjectReadingCache(),build=vi.fn(()=>({body:session.sections[0].body}));
 const first=cache.get(session,"chapter",build);
 const moved={...session,activeSectionId:"sidebar",visitedSectionIds:["sidebar"],wikiCollapsedGroups:{other:false},updatedAt:Date.now()};
 expect(cache.get(moved,"chapter",build)).toBe(first);expect(build).toHaveBeenCalledOnce();
 expect(cache.get({...moved,id:"other-project"},"chapter",build)).not.toBe(first);
 expect(build).toHaveBeenCalledTimes(2);
});

it("invalidates on an edit, changed source receipts, scope or a user answer", () => {
 let session=contextKnowledge().session;
 const cache=createProjectReadingCache(),build=vi.fn(()=>({}));
 let last=cache.get(session,"overview",build);
 const check=()=>{const next=cache.get(session,"overview",build);expect(next).not.toBe(last);last=next;};
 session.sections[0].body="编辑后的正文。";check();
 session.evidence[0].excerpt="修订后的来源。";check();
 session={...session,sourceSignatures:{c:{"m-db":"updated"}}};check();
 session={...session,scope:{kind:"goal",taskUnderstanding:"仅整理接口",sourceConversationIds:["c"]}};check();
 session={...session,wikiKnowledge:{version:1,status:"complete",generatedAt:1,materials:0,batches:[],userAnswers:[{questionId:"q",question:"是否采纳",unitIds:["u"],answer:"暂不采纳",at:1}]}};check();
 expect(build).toHaveBeenCalledTimes(6);
});
