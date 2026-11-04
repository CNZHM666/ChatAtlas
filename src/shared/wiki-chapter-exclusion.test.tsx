import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {excludeWikiChapter,excludeWikiMaterial} from "./wiki-scope-review";
import {WikiScopeNotice} from "../canvas/components/WikiScopeNotice";
import {contextKnowledge} from "../test/context-fixture";
import type {FocusSession} from "./focus-session";
afterEach(cleanup);

const session=():FocusSession=>{
 const base=contextKnowledge().session;
 return {...base,goal:"整理硬件项目",wikiScopeReview:{version:1,goal:"整理硬件项目",includeKeys:["k2","other"],materials:[]},
  sections:[{...base.sections[0],id:"keep",title:"系统架构",wikiMaterialKeys:["k1"]},{...base.sections[0],id:"out",title:"知识管理优化",wikiMaterialKeys:["k2","k3"]}],activeSectionId:"out"};
};

it("leaves a chapter out locally and records its notes as exclusions",()=>{
 const next=excludeWikiChapter(session(),"out",true);
 expect(next.sections.map(section=>section.id)).toEqual(["keep"]);expect(next.activeSectionId).toBe("keep");
 expect(next.wikiScopeReview).toMatchObject({includeKeys:["other"],excludeKeys:["k2","k3"],materials:[{key:"k2",keys:["k2","k3"],title:"知识管理优化",userExcluded:true}]});
 // Personal chapters and chapters without known notes stay.
 const personal={...session(),sections:session().sections.map(section=>({...section,userEdited:true}))};
 expect(excludeWikiChapter(personal,"out",true)).toBe(personal);
});

it("brings every note of a left-out chapter back when the reader includes it again",()=>{
 const apply=vi.fn();
 render(<WikiScopeNotice session={excludeWikiChapter(session(),"out",true)} zh onApply={apply} onSource={vi.fn()}/>);
 fireEvent.click(screen.getByText(/^旁支/u,{selector:"summary"}));
 fireEvent.click(screen.getByRole("button",{name:"保留本项目"}));
 fireEvent.click(screen.getByRole("button",{name:/应用 1 项选择/u}));
 expect(apply).toHaveBeenCalledWith({includeKeys:expect.arrayContaining(["other","k2","k3"]),excludeKeys:[]});
});

it("records a declined flagged material as an exclusion without touching the chapters",()=>{
 const base:FocusSession={...session(),wikiScopeReview:{version:1,goal:"整理硬件项目",includeKeys:["m1"],materials:[{id:"n",key:"m1",title:"旅行计划",body:"",evidenceIds:[],kind:"other",reason:"独立讨论",quote:""},{id:"r",key:"r1",title:"竞品",body:"",evidenceIds:[],kind:"reference",reason:"参考",quote:""}]}};
 const next=excludeWikiMaterial(base,"m1");
 expect(next.sections).toBe(base.sections);
 expect(next.wikiScopeReview).toMatchObject({includeKeys:[],excludeKeys:["m1"],materials:[{key:"m1",userExcluded:true},{key:"r1"}]});
 // A reference is in the Wiki; removing it re-plans, so it is not declined here.
 expect(excludeWikiMaterial(base,"r1")).toBe(base);
 const uncertain={...base,wikiScopeReview:{...base.wikiScopeReview!,materials:base.wikiScopeReview!.materials.map(item=>({...item,kind:"uncertain" as const}))}};
 expect(excludeWikiMaterial(uncertain,"m1")).toBe(uncertain);
});
