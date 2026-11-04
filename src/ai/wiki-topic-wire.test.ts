import "fake-indexeddb/auto";
import {expect,it} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import {validateWikiPlan} from "./wiki-plan-contract";
import {planWikiTopics} from "./wiki-topic-plan";
import type {StructuredAIRequest} from "./provider";

const sections=(size:number)=>Array.from({length:size},(_,index)=>({...contextKnowledge().session.sections[0],id:`m${index}`,title:`模块${index%7}`,body:`保留独特条件 ${index}，失败时保留原文。`,kind:"finding" as const}));
const leaf=(sectionIds:string[])=>({title:"数据保存",group:"",subtopics:[{title:"持久化",sectionIds}]});

it("derives parents locally from a single leaf inventory without model-generated routing keys",()=>{
 const input=sections(6),value={pages:[leaf(["m4","m0","m3"]),{...leaf(["m1","m5","m2"]),title:"搜索索引"}]},before=structuredClone(value);
 const result=validateWikiPlan(value,input);
 expect(result.map(page=>page.sectionIds)).toEqual([["m0","m3","m4"],["m1","m2","m5"]]);
 expect(validateWikiPlan(result,input)).toEqual(result);expect(value).toEqual(before);
});

it.each(["storage.v1","topic_1_2","存储机制"," t0 ",0,123456])("accepts unambiguous legacy routing labels without another model request: %j",key=>{
 const input=sections(2),value={pages:[{title:"数据保存",subtopics:[{key,title:"持久化"}]}],assignments:{m0:key,m1:key}};
 expect(validateWikiPlan(value,input)[0].sectionIds).toEqual(["m0","m1"]);
});

it("accepts an explicit legacy id alias but rejects conflicting aliases and normalized key collisions",()=>{
 const input=sections(2),topic={title:"持久化",id:"storage"},value={pages:[{title:"数据保存",subtopics:[topic]}],assignments:{m0:"storage",m1:"storage"}};
 expect(validateWikiPlan(value,input)[0].sectionIds).toEqual(["m0","m1"]);
 expect(()=>validateWikiPlan({...value,pages:[{...value.pages[0],subtopics:[{...topic,topicId:"other"}]}]},input)).toThrowError(expect.objectContaining({code:"PROVIDER_SCHEMA_wiki_directory_topic_key"}));
 expect(()=>validateWikiPlan({...value,pages:[{...value.pages[0],subtopics:[{key:"storage",title:"保存"},{key:" storage ",title:"恢复"}]}]},input)).toThrowError(expect.objectContaining({code:"PROVIDER_SCHEMA_wiki_directory_duplicate_topic_key"}));
});

it("still rejects missing, cross-topic duplicate, foreign and contradictory material ownership",()=>{
 const input=sections(2);
 for(const pages of [[leaf(["m0"])],[leaf(["m0","m1"]),{...leaf(["m1"]),title:"另一模块"}],[leaf(["m0","m1","m99"])],[{...leaf(["m0","m1"]),sectionIds:["m0"]}]]){
  expect(()=>validateWikiPlan({pages},input)).toThrow();
 }
});

it("recovers an old missing-key response with one leaf-inventory correction rather than guessing ownership",async()=>{
 const input=sections(4);let calls=0;
 const result=await planWikiTopics(input,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);calls++;
  if(calls===1)return request.validate({pages:[{title:"数据保存",subtopics:[{title:"持久化"}]}],assignments:{m0:"t0",m1:"t0",m2:"t0",m3:"t0"}});
  expect(data.correction).toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_topic_key",fields:["pages[0].subtopics[0].key"],issues:[{path:"pages[0].subtopics[0].key",reason:"required_text"}]});
  return request.validate({pages:[leaf(data.sections.map((section:{id:string})=>section.id))]});
 }},new AbortController().signal);
 expect(calls).toBe(2);expect(result[0].sectionIds).toEqual(input.map(section=>section.id));
});

it("plans 554 materials through key-free bounded windows, retaining every original exactly once",async()=>{
 const input=sections(554).map(section=>({...section,id:`private:${section.id}`})),before=structuredClone(input);let calls=0;
 const result=await planWikiTopics(input,"zh-CN",{capabilities:{maxConcurrency:3},generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;const data=JSON.parse(request.prompt);expect(data.version).toBe(13);expect(data.correction).toBeUndefined();expect(request.system).toContain("Do not return topic keys, assignments, or page-level sectionIds");
  const groups=new Map<string,string[]>();for(const item of data.sections)groups.set(item.title,[...groups.get(item.title)??[],item.id]);
  return request.validate({pages:[...groups].map(([title,sectionIds])=>({title,subtopics:[{title:"完整机制",question:"具体条件和失败行为是什么？",sectionIds}]}))});
 }},new AbortController().signal);
 expect(result).toHaveLength(7);expect(calls).toBeLessThanOrEqual(24);expect(result.flatMap(page=>page.subtopics!.flatMap(topic=>topic.sectionIds)).sort()).toEqual(input.map(section=>section.id).sort());expect(input).toEqual(before);
});
