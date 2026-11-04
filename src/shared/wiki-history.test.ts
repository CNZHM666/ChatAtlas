import {expect,it} from "vitest";
import {projectSession} from "../test/project-fixture";
import {extractHistoryNotes,meaningfulHistoryNote,evolutionRecordsBySection,wikiHistoryEntries} from "./wiki-history";
import {projectDocument} from "../export/project-document";

const event={id:"history:plan",title:"操作计划",version:"",before:"直接生成采购清单",after:"先生成操作计划再确认",reason:"避免误买零件",status:"documented" as const,decisionStatus:"confirmed" as const,quote:"先验证核心流程",evidenceIds:["e1"],beforeQuote:"",beforeEvidenceIds:[],discussedAt:Date.UTC(2026,9,7,12)};

it("removes every history label form without leaving bold markers behind",()=>{
 const body="## 定位\n\n当前说明。\n\n历史：早期曾视为 Wiki 生成器，后来改为对话管家。\n\n**历史**：从 SQLite 改为 IndexedDB。\n\n**历史：**早期 AI 讨论中曾提出 MCP Adapter。";
 const {body:prose,notes}=extractHistoryNotes(body);
 expect(prose).toBe("## 定位\n\n当前说明。");
 expect(notes.map(note=>note.text)).toEqual(["早期曾视为 Wiki 生成器，后来改为对话管家。","从 SQLite 改为 IndexedDB。","早期 AI 讨论中曾提出 MCP Adapter。"]);
 expect(notes.every(note=>note.heading==="定位"&&!note.text.includes("**"))).toBe(true);
});

it("keeps only notes that state a change, not commentary on the material",()=>{
 expect(meaningfulHistoryNote("早期曾视为 Wiki 生成器，后来改为对话管家。")).toBe(true);
 expect(meaningfulHistoryNote("检索从全文搜索调整为混合检索。")).toBe(true);
 expect(meaningfulHistoryNote("早期 AI 讨论中曾提出 MCP Adapter 等模块定义，但后续评估指出这些几乎全部来自早期 AI建议，尚未整合成可用的项目说明。")).toBe(false);
 expect(meaningfulHistoryNote("早期 AI 讨论中曾提出 MCP Adapter。")).toBe(false);
});

it("puts a structured change in the chapter citing its messages, before uncovered notes",()=>{
 const session=projectSession();
 session.projectEvolutionAnalysis={version:6,kind:"evolution",events:[event,{...event,id:"history:ref",recordKind:"reference"},{...event,id:"history:new",before:""}],evidence:session.evidence,sources:[],signature:"s",sourceSignature:"s",generatedAt:1};
 const section={...session.sections[0],body:"当前说明。\n\n历史：原先直接生成采购清单，后来改为先生成操作计划再确认。\n\n历史：检索从全文搜索调整为混合检索。"};session.sections[0]=section;
 expect([...evolutionRecordsBySection(session).entries()].map(([id,records])=>[id,records.map(record=>record.id)])).toEqual([[section.id,["history:plan"]]]);
 const entries=wikiHistoryEntries(session,section);
 expect(entries).toEqual([
  expect.objectContaining({kind:"record",before:"直接生成采购清单",after:"先生成操作计划再确认",reason:"避免误买零件",status:"confirmed",date:event.discussedAt}),
  expect.objectContaining({kind:"note",text:"检索从全文搜索调整为混合检索。"}),
 ]);
 expect(wikiHistoryEntries(session,{...section,userEdited:true})).toEqual([]);
 const exported=projectDocument(session,{overview:false,wikiIds:[section.id],matters:false,history:false,sources:false},"md").text;
 expect(exported).toContain("**演变记录**\n\n- 此前：直接生成采购清单 → 现在：先生成操作计划再确认\n  用户决定 · 原因：避免误买零件");
 expect(exported).toContain("- 检索从全文搜索调整为混合检索。\n  讨论记录，未整理成结构化变化");
 expect(exported).not.toContain("历史：");expect(exported).not.toMatch(/^> \*\* /mu);
});
