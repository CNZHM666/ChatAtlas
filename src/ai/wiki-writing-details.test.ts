import {expect,it} from "vitest";
import {enrichWikiWritingNotes,wikiWritingUnits,wikiNoteEvidenceText} from "./wiki-writing-details";
import {scopeWikiFacts} from "./wiki-project-scope";
import {projectSession} from "../test/project-fixture";
import type {CoverageMaterial} from "./focus-coverage";
const batch:CoverageMaterial[]=[{id:"original",role:"assistant",conversationId:"chat",sourceConversationIds:["chat"],messageId:"m",title:"旧对话",text:"建议使用 incrementalIndex；失败时重建索引，不覆盖原始消息。",rawEvidenceIds:["raw"]}];
const notes=[{...batch[0],id:"note",title:"消息检索",text:batch[0].text}];
it("splits explicit note topics without cutting raw messages or code, retaining all characters and references",()=>{
 const note={...notes[0],role:undefined,text:"总述\n\n## 存储\n\n条件A\n\n```md\n## 假标题\n```\n\n## 检索\n\n先不采用B。"};
 const units=wikiWritingUnits([note]);expect(units).toHaveLength(3);expect(units.map(unit=>unit.text).join("")).toBe(note.text);expect(units.every(unit=>unit.rawEvidenceIds===note.rawEvidenceIds)).toBe(true);
 expect(wikiWritingUnits([{...note,role:"user"}])).toHaveLength(1);
});
function facts(){return {...projectSession().projectState!,modules:[{id:"module:index",title:"消息检索",layer:"检索",purpose:"增量维护索引",inputs:["新消息"],outputs:["消息级结果"],status:"proposal" as const,quote:batch[0].text,evidenceIds:["original"]}],relations:[],decisions:[],constraints:[],questions:[],history:[]};}
it("enriches existing notes without promoting each fact to a directory entry",()=>{
 const value=facts(),before=structuredClone(notes);
 value.modules=Array.from({length:48},(_,index)=>({...value.modules[0],id:`m${index}`,purpose:`保留条件${index}`}));
 const result=enrichWikiWritingNotes(notes,value,batch);expect(result).toHaveLength(1);expect(result[0].id).toBe("note");expect(result[0].title).toBe("消息检索");expect(result[0].rawEvidenceIds).toEqual(["raw"]);expect(notes).toEqual(before);
 const inventory=JSON.parse(result[0].text.split("\n").at(-1)!);expect(inventory.details).toHaveLength(48);expect(Object.values(inventory.originals)).toEqual([{role:"assistant",text:batch[0].text,sourceIds:["raw"]}]);
 expect(result[0].text.match(/incrementalIndex/gu)).toHaveLength(2);
});
it("deduplicates facts, rejects ungrounded quotes and avoids unrelated notes",()=>{
 const value=facts();value.modules.push({...value.modules[0]});
 const result=enrichWikiWritingNotes([...notes,{...notes[0],id:"other",text:"通知设置。",rawEvidenceIds:["foreign"]}],value,batch);
 expect(JSON.parse(result[0].text.split("\n").at(-1)!).details).toHaveLength(1);expect(result[1].text).toBe("通知设置。");
 expect(enrichWikiWritingNotes(notes,{...value,modules:[{...value.modules[0],quote:"虚构消息"}]},batch)).toEqual(notes);
});

it("routes whole paragraphs within a heading while retaining historical scope and every source character",()=>{
 const text="## 历史方案\n\n本项目当时计划使用服务器 AI。\n\n另一个产品 ChatAtlas 需要知识演进。\n\n### BYOK 条件\n\n若用户配置自己的密钥，则使用用户模式。\n\n需要保留以下限制：\n\n- 不能覆盖草稿\n- 失败时不发送\n\n```ts\n// ChatAtlas appears in code, not a topic boundary\n```";
 const input={...notes[0],role:undefined,text},units=wikiWritingUnits([input]);
 expect(units.map(unit=>unit.text).join("")).toBe(text);
 expect(units.some(unit=>unit.text.includes("ChatAtlas 需要")&&!unit.text.includes("服务器 AI"))).toBe(true);
 expect(units.find(unit=>unit.text.includes("用户配置"))?.title).toBe("历史方案 / BYOK 条件");
 expect(units.find(unit=>unit.text.includes("需要保留"))?.text).toContain("- 失败时不发送");
 expect(wikiWritingUnits([{...input,role:"user"}])).toEqual([{...input,role:"user"}]);
});

it("does not assign facts to the first of two notes sharing one original message",()=>{
 const value=facts(),same=[{...notes[0],text:"本项目的模块级硬件方案。"},{...notes[0],id:"foreign",text:batch[0].text}];
 const result=enrichWikiWritingNotes(same,value,batch);
 expect(result[0].text).toBe(same[0].text);expect(result[1].text).toContain("SOURCE DETAIL INVENTORY");
 const reversed=enrichWikiWritingNotes([...same].reverse(),value,batch);
 expect(reversed.find(note=>note.id==="note")?.text).toBe(same[0].text);
});

it("retains ambiguous grounded details as explicit review candidates rather than guessing or dropping proof",()=>{
 const same=[{...notes[0],text:"硬件设计讨论。"},{...notes[0],id:"foreign",text:"另一个项目讨论。"}],value=facts(),before=structuredClone(same);
 const result=enrichWikiWritingNotes(same,value,batch);
 expect(result).toHaveLength(3);expect(result[0].text).toBe(same[0].text);expect(result[1].text).toBe(same[1].text);
 expect(result[2].text).toContain(batch[0].text);expect(result[2].rawEvidenceIds).toEqual(["raw"]);
 expect(enrichWikiWritingNotes(result,value,batch)).toEqual(result);expect(same).toEqual(before);
});

it("does not attach another product's fact to the only note merely because its message ID matches",()=>{
 const value=facts();value.modules[0].quote="另一个项目需要知识演进。";
 const originals=[{...batch[0],text:batch[0].text+"\n\n"+value.modules[0].quote}];
 const result=enrichWikiWritingNotes([{...notes[0],text:"硬件项目的模块级设计。"}],value,originals);
 expect(result).toHaveLength(2);expect(result[0].text).not.toContain("知识演进");
 expect(result[1].text).toContain("另一个项目需要知识演进。");
 expect(enrichWikiWritingNotes(result,value,originals)).toEqual(result);
});

it("keeps uniquely owned multiline and quoted conditions after foreign materials are excluded",()=>{
 const quote='先检查 "A"。\n失败时不覆盖记录。',original={...batch[0],text:quote},value=facts();value.modules[0].quote=quote;
 const enriched=enrichWikiWritingNotes([{...notes[0],text:"检索错误处理。"}],value,[original]);
 expect(enriched[0].text).not.toContain(quote);
 const projected=scopeWikiFacts(value,wikiNoteEvidenceText(enriched),true)!;
 expect(projected.modules).toHaveLength(1);expect(projected.modules[0].quote).toBe(quote);
});
