import "fake-indexeddb/auto";
import {expect,it} from "vitest";
import {validateWikiWritingCoverage,splitWikiWritingBatch,wikiMissingTopicBatch} from "./wiki-writing-coverage";
import type {CoverageMaterial} from "./focus-coverage";
import type {FocusSection} from "../shared/focus-session";
const batch:CoverageMaterial[]=Array.from({length:4},(_,i)=>({id:`n${i}`,wikiOwnerId:"owner",conversationId:"c",sourceConversationIds:["c"],messageId:`m${i}`,title:"页面",text:`事实${i}`,rawEvidenceIds:[`e${i}`]}));
const page={ownerId:"owner",title:"模块",group:"",question:"如何工作？",sectionIds:batch.map(item=>item.id),subtopics:batch.map((item,i)=>({title:`主题${i}`,question:`边界${i}`,sectionIds:[item.id]}))};
const section=(body:string):FocusSection=>({id:"s",title:"模块",kind:"finding",transition:"",body,wikiOwnerId:"owner",evidenceIds:batch.map(item=>item.id)});
it("normalizes explicit heading identity and depth but requires actual body",()=>{
 const result=validateWikiWritingCoverage([section(batch.map((_,i)=>`### **主题${i}**\n\n具体条件${i}。`).join("\n\n"))],[page],batch);
 expect(result[0].body).toContain("## 主题0\n\n具体条件0。");
 expect(()=>validateWikiWritingCoverage([section(batch.map((_,i)=>`## 主题${i}`).join("\n\n"))],[page],batch)).toThrowError(expect.objectContaining({code:"PROVIDER_SCHEMA_wiki_subtopic_missing"}));
 expect(()=>validateWikiWritingCoverage([section("## 改名主题\n\n具体条件。")],[page],batch)).toThrow();
});
it("can label an unambiguous assigned single topic, never distribute one paragraph across missing topics",()=>{
 const own={...section("失败时保留原始记录。"),evidenceIds:["n0"]};
 expect(validateWikiWritingCoverage([own],[page],[batch[0]])[0].body).toBe("## 主题0\n\n失败时保留原始记录。");
 expect(validateWikiWritingCoverage([{...own,body:"## 失败处理\n\n保留记录。"}],[page],[batch[0]])[0].body).toBe("## 主题0\n\n### 失败处理\n\n保留记录。");
 expect(()=>validateWikiWritingCoverage([own],[page],batch)).toThrow();expect(own.body).toBe("失败时保留原始记录。");
});

it("accepts explicit subtopic section titles without requiring duplicate body headings, retaining scope and citations",()=>{
 const sections=batch.map((item,index)=>({...section(`条件${index}需要保留。`),id:`s${index}`,title:`主题${index}`,evidenceIds:[item.id]}));
 const before=structuredClone(sections),result=validateWikiWritingCoverage(sections,[page],batch);
 expect(result.map(item=>item.body)).toEqual(batch.map((_,index)=>`## 主题${index}\n\n条件${index}需要保留。`));expect(sections).toEqual(before);
 expect(()=>validateWikiWritingCoverage([{...sections[0],evidenceIds:["n1"]},...sections.slice(1)],[page],batch)).toThrow();
 expect(()=>validateWikiWritingCoverage([{...sections[0],title:"相似但未知的标题"},...sections.slice(1)],[page],batch)).toThrow();
 expect(()=>validateWikiWritingCoverage([{...sections[0],body:"## 主题1\n\n不能将另一主题的正文挂到主题0。"},...sections.slice(1)],[page],batch)).toThrow();
});
it("partitions materials exactly once and keeps connected shared support together",()=>{
 const parts=splitWikiWritingBatch(batch,[page]);expect(parts?.flat().map(item=>item.id)).toEqual(batch.map(item=>item.id));expect(parts?.map(items=>items.length)).toEqual([2,2]);
 const shared={...page,subtopics:[...page.subtopics,{title:"共同机制",question:"如何协作？",sectionIds:["n0","n1"]}]};
 const sharedParts=splitWikiWritingBatch(batch,[shared]);expect(sharedParts?.flat().map(item=>item.id)).toEqual(batch.map(item=>item.id));
 expect(sharedParts?.find(part=>part.some(item=>item.id==="n0"))?.map(item=>item.id)).toContain("n1");
 expect(splitWikiWritingBatch(batch,[{...page,subtopics:[{title:"共同机制",question:"如何协作？",sectionIds:page.sectionIds}]}])).toBeUndefined();
});

it("completes only missing scopes with whole original support and excludes unrelated code and owners",()=>{
 const full=[...batch,{...batch[0],id:"foreign",wikiOwnerId:"foreign",text:"```ts\n// unrelated\n```"}],before=structuredClone(full);
 const shared={...page,subtopics:[...page.subtopics,{title:"共享细节",question:"如何保留？",sectionIds:["n1","n2"]}]};
 const selected=wikiMissingTopicBatch(full,[shared],[{ownerId:"owner",titles:["主题1","共享细节"]}]);
 expect(selected.map(item=>item.id)).toEqual(["n1","n2"]);expect(selected[0]).toBe(full[1]);expect(full).toEqual(before);
});

it("keeps the chapter overview outside an automatically labelled single subtopic",()=>{
 const own={...section("本章说明同步的边界，失败时保留记录。\n\n## 异常处理\n\n只有用户确认后重试。"),evidenceIds:["n0"]};
 expect(validateWikiWritingCoverage([own],[page],[batch[0]])[0].body).toBe("本章说明同步的边界，失败时保留记录。\n\n## 主题0\n\n### 异常处理\n\n只有用户确认后重试。");
});
