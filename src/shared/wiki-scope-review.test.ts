import {expect,it} from "vitest";
import {mergeWikiScopeReview,applyWikiMembership} from "./wiki-scope-review";
import {contextKnowledge} from "../test/context-fixture";
import type {FocusSession} from "./focus-session";
const base=():FocusSession=>{
 const session=contextKnowledge().session;
 return {...session,evidence:[{...session.evidence[0],id:"e-old",conversationId:"c",messageId:"old"},{...session.evidence[0],id:"e-changed",conversationId:"c",messageId:"changed"}],wikiScopeReview:{version:1,goal:"项目",includeKeys:["explicit-choice"],materials:["old","changed"].map(id=>({id,key:id,title:id,kind:"other" as const,reason:"旁支",quote:"已保留的讨论",body:"完整笔记",evidenceIds:[`e-${id}`]}))}};
};
it("keeps unrelated routing decisions across an incremental update and remaps new provenance",()=>{
 const previous=base(),patch:FocusSession={...previous,wikiScopeReview:{version:1,goal:"项目",includeKeys:["new-choice"],materials:[{...previous.wikiScopeReview!.materials[1],id:"new-note",key:"new-body",evidenceIds:["new-proof"]}]}};
 const next=mergeWikiScopeReview(previous,patch,{kind:"goal",blocks:[{conversationId:"c",title:"",messageIds:["changed"],messageSignatures:{}}]},[],false,new Map([["new-proof","remapped-proof"]]))!;
 expect(next.materials.map(item=>item.key)).toEqual(["old","new-body"]);expect(next.materials[1].evidenceIds).toEqual(["remapped-proof"]);expect(next.includeKeys).toEqual(["explicit-choice","new-choice"]);expect(previous.wikiScopeReview?.materials[1].key).toBe("changed");
});
it("drops deleted or fully replaced scope suggestions, retaining explicit user choices",()=>{
 const previous=base(),patch={...previous,wikiScopeReview:undefined};
 expect(mergeWikiScopeReview(previous,patch,{kind:"all"},[JSON.stringify(["c","changed"])],false,new Map())?.materials.map(item=>item.key)).toEqual(["old"]);
 expect(mergeWikiScopeReview(previous,patch,{kind:"all"},[],true,new Map())).toMatchObject({materials:[],includeKeys:["explicit-choice"]});
});
it("keeps the latest exclusions, which win over an older inclusion of the same material",()=>{
 const previous=base();previous.wikiScopeReview={...previous.wikiScopeReview!,excludeKeys:["removed-earlier"]};
 const patch:FocusSession={...previous,wikiScopeReview:{version:1,goal:"项目",includeKeys:[],excludeKeys:["explicit-choice"],materials:[]}};
 const next=mergeWikiScopeReview(previous,patch,{kind:"all"},[],true,new Map())!;
 expect(next.excludeKeys).toEqual(["explicit-choice"]);expect(next.includeKeys).toEqual([]);
 // Without a fresh routing receipt, earlier exclusions are retained.
 expect(mergeWikiScopeReview(previous,{...previous,wikiScopeReview:undefined},{kind:"all"},[],true,new Map())).toMatchObject({excludeKeys:["removed-earlier"],includeKeys:["explicit-choice"]});
});

it("persists project-only removal separately from side material and restores without losing other choices",()=>{
 const previous=base(),next=applyWikiMembership(previous,{includeKeys:["explicit-choice"],excludeKeys:["old"],ignoredKeys:["old"]})!;
 expect(next.wikiScopeReview).toMatchObject({excludeKeys:["old"],ignoredKeys:["old"],materials:[expect.objectContaining({key:"old",userExcluded:true}),expect.anything()]});
 expect(previous.wikiScopeReview?.ignoredKeys).toBeUndefined();
 const merged=mergeWikiScopeReview(next,{...next,wikiScopeReview:undefined},{kind:"all"},[],true,new Map())!;
 expect(merged.ignoredKeys).toEqual(["old"]);expect(merged.excludeKeys).toEqual(["old"]);
 expect(applyWikiMembership(next,{includeKeys:["explicit-choice","old"],excludeKeys:[],ignoredKeys:[]})).toBeUndefined();
});

it("does not remove retained or edited prose merely by changing its routing metadata",()=>{
 const previous=base();previous.sections=[{...previous.sections[0],wikiMaterialKeys:["old"],userEdited:true}];
 expect(applyWikiMembership(previous,{includeKeys:[],excludeKeys:["old"],ignoredKeys:["old"]})).toBeUndefined();
});

it("requires a preview before excluding uncertain prose even when a legacy chapter has no material keys",()=>{
 const previous=base();previous.wikiScopeReview!.materials[0].kind="uncertain";
 expect(applyWikiMembership(previous,{includeKeys:[],excludeKeys:["old"]})).toBeUndefined();
 expect(applyWikiMembership(previous,{includeKeys:["old"],excludeKeys:[]})).toBeUndefined();
});
