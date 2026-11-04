import {expect,it} from "vitest";
import {mergeThinWikiChapters,mergeThinWikiSubtopics,renameWikiSubheadings,wikiProseScale,wikiSubtopicBudget} from "./wiki-subtopic-budget";
import {nameMergedSubheadings} from "./wiki-subheading-names";
import type {StructuredAIRequest} from "./provider";
import type {FocusSection} from "../shared/focus-session";

const zh=(size:number,mark="甲")=>mark.repeat(size)+"。";
const headings=(body:string)=>body.match(/^## .+$/gmu)??[];

it("joins a thin subsection with its smaller neighbour and keeps the fuller title",()=>{
 const body=["开头概述。","## 主线",zh(400),"## 片段",zh(40,"乙"),"## 另一面",zh(420,"丙")].join("\n\n");
 const result=mergeThinWikiSubtopics(body);
 expect(result.merged).toBe(1);
 expect(headings(result.body)).toEqual(["## 主线","## 另一面"]);
 // Text and order survive; only the heading line is gone.
 expect(result.body.indexOf("乙")).toBeGreaterThan(result.body.indexOf("甲"));
 expect(result.body.indexOf("乙")).toBeLessThan(result.body.indexOf("丙"));
 expect(result.body.startsWith("开头概述。")).toBe(true);
});

it("caps subtopics by chapter prose and flattens a chapter left with one",()=>{
 const crowded=Array.from({length:6},(_,index)=>`## 小节${index}\n\n${zh(200,String.fromCharCode(0x4e00+index))}`).join("\n\n");
 const capped=mergeThinWikiSubtopics(crowded);
 expect(headings(capped.body)).toHaveLength(wikiSubtopicBudget(6*201));
 const small=mergeThinWikiSubtopics(["## 一",zh(160),"## 二",zh(160,"乙")].join("\n\n"));
 expect(headings(small.body)).toEqual([]);
 expect(small.body).toContain("甲");expect(small.body).toContain("乙");
});

it("leaves supported structure, code fences and English chapters within budget alone",()=>{
 const body=["## A",zh(400),"## B","```md\n## not a heading\n```\n\n"+zh(400,"乙")].join("\n\n");
 expect(mergeThinWikiSubtopics(body)).toEqual({body,merged:0,toName:[]});
 expect(wikiProseScale("plain English prose")).toBe(2.5);
 expect(wikiProseScale(zh(20))).toBe(1);
 const english=["## Mode","word ".repeat(80),"## Note","short note."].join("\n\n");
 expect(headings(mergeThinWikiSubtopics(english).body)).toEqual([]);
});

it("skips user-owned chapters and drops merged titles from the outline",()=>{
 const body=["## 主线",zh(400),"## 片段",zh(40,"乙"),"## 另一面",zh(420,"丙")].join("\n\n");
 const section={id:"s",title:"章",body,wikiSubtopics:[{title:"主线",question:"a"},{title:"片段",question:"b"},{title:"另一面",question:"c"}]} as FocusSection;
 const edited={...section,id:"u",userEdited:true};
 const {sections,merged}=mergeThinWikiChapters([section,edited]);
 expect(merged).toBe(1);
 expect(sections[0].wikiSubtopics?.map(topic=>topic.title)).toEqual(["主线","另一面"]);
 expect(sections[1]).toBe(edited);
});

it("reports joined and duplicated headings and renames by position",()=>{
 const body=["## 主线",zh(400),"## 片段",zh(40,"乙"),"## 另一面",zh(420,"丙")].join("\n\n");
 expect(mergeThinWikiSubtopics(body).toName).toEqual([{index:0,heading:"主线",parts:["主线","片段"],excerpt:expect.stringMatching(/^甲+/u)}]);
 const duplicate=["## ProjectEvent 数据结构",zh(400),"## ProjectEvent数据结构",zh(400,"乙")].join("\n\n");
 expect(mergeThinWikiSubtopics(duplicate)).toMatchObject({merged:0,toName:[{index:1,heading:"ProjectEvent数据结构",parts:["ProjectEvent数据结构"]}]});
 const section={id:"s",title:"章",body:"## 同名\n\n甲。\n\n## 同名\n\n乙。",wikiSubtopics:[{title:"同名",question:"q"}]} as FocusSection;
 const renamed=renameWikiSubheadings(section,new Map([[1,"基准测试"]]));
 expect(renamed.body).toBe("## 同名\n\n甲。\n\n## 基准测试\n\n乙。");
 // A shared old name is ambiguous, so the outline entry keeps it.
 expect(renamed.wikiSubtopics).toEqual([{title:"同名",question:"q"}]);
});

it("names merged subsections in one request and keeps headings it cannot use",async()=>{
 const body=["## 主线",zh(400),"## 片段",zh(40,"乙"),"## 另一面",zh(420,"丙")].join("\n\n");
 const merged=mergeThinWikiChapters([{id:"s",title:"章",body,kind:"finding",transition:"",evidenceIds:[]} as FocusSection]);
 const calls:string[]=[];
 const ai=(titles:unknown)=>({id:"openai",generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls.push(request.prompt);return request.validate({titles});}});
 const named=await nameMergedSubheadings(merged.sections,merged.toName,ai([{id:"h0",title:"检索流程"}]),new AbortController().signal,"zh-CN");
 expect(named.sections[0].body).toMatch(/^## 检索流程/u);expect(named.report).toMatchObject({requested:1,renamed:1});
 expect(JSON.parse(calls[0])).toMatchObject({presentation:"wiki_subheading_names",items:[{id:"h0",parts:["主线","片段"],siblings:["另一面"]}]});
 // A paired name or a sibling's name is refused; the kept heading stays.
 for(const title of ["主线与片段","另一面"]){
  const kept=await nameMergedSubheadings(merged.sections,merged.toName,ai([{id:"h0",title}]),new AbortController().signal,"zh-CN");
  expect(kept.sections[0].body).toMatch(/^## 主线/u);expect(kept.report.renamed).toBe(0);
 }
 const demo=await nameMergedSubheadings(merged.sections,merged.toName,{...ai([]),id:"atlas-demo"},new AbortController().signal,"zh-CN");
 expect(demo.report.requested).toBe(0);
});
