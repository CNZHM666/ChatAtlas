import {expect,it} from "vitest";
import {projectSession} from "../test/project-fixture";
import {wikiContentTopics,prepareWikiContentPlan,applyWikiContentPlan} from "./wiki-content-plan";

function fixture(){const session=projectSession();session.sections=[{...session.sections[0],body:"开头说明。\n\n## 数据保存\n\n失败时保留原稿。\n\n```md\n## literal heading\n```\n\n### 边界条件\n\n仅当前项目。"},{...session.sections[0],id:"two",title:"界面交互",evidenceIds:["e2"],body:"## 数据库机制补充\n\n只有用户确认后才保存。\n\n## 列表操作\n\n点击查看完整记录。"}];return session;}
it("keeps each existing scope whole, including preambles, nested conditions and literal heading examples",()=>{
 const session=fixture(),topics=wikiContentTopics(session.sections);
 expect(topics).toHaveLength(4);expect(topics.filter(topic=>topic.sectionId==="one").map(topic=>topic.body).join("")).toBe(session.sections[0].body);
 expect(topics[1].body).toContain("## literal heading");expect(topics[1].body).toContain("仅当前项目。");
});
it("moves complete explanations to one owning chapter without losing any text, original or source",()=>{
 const session=fixture(),before=structuredClone(session),{request,topics}=prepareWikiContentPlan(session,session.sections,new AbortController().signal,{},"保留边界");
 const plan=request.validate({chapters:[{id:"one",topics:[{title:"背景",topicIds:[topics[0].id]},{title:"数据保存与确认",topicIds:[topics[1].id,topics[2].id]}]},{id:"two",topics:[{title:"列表操作",topicIds:[topics[3].id]}]}]});
 const result=applyWikiContentPlan(session.sections,topics,plan);
 expect(result[0].body).toContain("只有用户确认后才保存");expect(result[1].body).not.toContain("只有用户确认后才保存");expect(result[0].evidenceIds).toEqual(["e1","e2"]);expect(result[1].evidenceIds).toEqual(["e2"]);
 for(const topic of topics)expect(result.filter(section=>section.body.includes(topic.body))).toHaveLength(1);
 expect(result.map(section=>section.id)).toEqual(["one","two"]);expect(session).toEqual(before);
});
it("rejects duplicate ownership, omitted scopes, foreign destinations and blank topic labels",()=>{
 const session=fixture(),{request,topics}=prepareWikiContentPlan(session,session.sections,new AbortController().signal,{},"");
 const valid={chapters:[{id:"one",topics:[{title:"存储",topicIds:topics.slice(0,3).map(topic=>topic.id)}]},{id:"two",topics:[{title:"界面",topicIds:[topics[3].id]}]}]};
 for(const mutate of [(value:typeof valid)=>value.chapters[1].topics[0].topicIds.push(topics[0].id),(value:typeof valid)=>value.chapters[0].topics[0].topicIds.pop(),(value:typeof valid)=>value.chapters[1].id="personal",(value:typeof valid)=>value.chapters[0].topics[0].title=""]){const value=structuredClone(valid);mutate(value);expect(()=>request.validate(value)).toThrow("内容归属");}
});
it("uses private/unselected chapters only as title boundaries and never sends their bodies",()=>{
 const session=fixture();session.sections.push({...session.sections[0],id:"personal",title:"个人章节",body:"Private personal notes",userEdited:true});
 const {request}=prepareWikiContentPlan(session,session.sections.slice(0,2),new AbortController().signal,{},"");const data=JSON.parse(request.prompt);expect(data.otherChapters).toEqual([{id:"personal",title:"个人章节"}]);expect(request.prompt).not.toContain("Private personal notes");
});

it("allows an empty redundant chapter to merge only when all its complete scopes have another owner",()=>{
 const session=fixture(),{request,topics}=prepareWikiContentPlan(session,session.sections,new AbortController().signal,{},"合并重复章节");
 const plan=request.validate({chapters:[{id:"one",title:"项目操作",topics:[{title:"完整操作",topicIds:topics.map(topic=>topic.id)}]}]});
 const result=applyWikiContentPlan(session.sections,topics,plan);
 expect(result).toHaveLength(1);expect(result[0].title).toBe("项目操作");expect(result[0].evidenceIds).toEqual(["e1","e2"]);
 for(const topic of topics)expect(result[0].body).toContain(topic.body);
 expect(()=>request.validate({chapters:[{id:"one",topics:[{title:"不完整",topicIds:[topics[0].id]}]}]})).toThrow();
});
