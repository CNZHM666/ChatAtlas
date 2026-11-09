import {expect,it} from "vitest";
import {claimSentence,readWikiWritingBlock,readWikiWritingBlocks,wikiWritingLayout} from "./wiki-writing-layout";
import type {WikiKnowledgeUnit} from "../shared/wiki-knowledge";

it("rejects a whole comparison when any row cites unavailable evidence rather than silently omitting it",()=>{
 const block={type:"comparison",columns:["模式","前提"],rows:[
  {cells:["本地模式","仅关键词，无需密钥"],unitIds:["k1"]},
  {cells:["语义模式","必须由用户授权"],unitIds:["missing"]},
 ]};
 const before=structuredClone(block);
 expect(()=>readWikiWritingBlock(block,new Set(["k1"]))).toThrow("invalid_writing_item");
 expect(block).toEqual(before);
});

it("retains literal pipes, negations and separate evidence bindings in table cells",()=>{
 const block={type:"comparison",columns:["接口","条件"],rows:[
  {cells:["A | B","不得自动发送"],unitIds:["k1"]},
  {cells:["C","仅在用户授权后调用"],unitIds:["k2"]},
 ]};
 const result=readWikiWritingBlock(block,new Set(["k1","k2"]));
 expect(result.text).toContain("A \\| B");
 expect(result.claims.find(claim=>claim.text==="不得自动发送")?.unitIds).toEqual(["k1"]);
 expect(result.claims.find(claim=>claim.text==="仅在用户授权后调用")?.unitIds).toEqual(["k2"]);
 // A table that cannot be read as one is written as a list of its rows, each row bound to its own units.
 const listed=readWikiWritingBlock({...block,rows:[block.rows[0],{cells:["C"],unitIds:["k2"]}]},new Set(["k1","k2"]));
 // A row keeping its cells is labelled by its first; each cell is a claim of that row's units.
 expect(listed.text).toBe("- **A | B**：不得自动发送\n- C");
 expect(listed.claims.map(claim=>claim.unitIds)).toEqual([["k1"],["k1"],["k2"]]);
 expect(readWikiWritingBlock({type:"comparison",columns:["方案","说明"],rows:[{cells:["React Flow","节点拖拽"],unitIds:["k1"]}]},new Set(["k1"])).text).toBe("- **React Flow**：节点拖拽");
 // With three columns, each cell after the first keeps its column's name.
 expect(readWikiWritingBlock({type:"comparison",columns:["Area","Include","Leave out"],rows:[{cells:["Core","10-second logging","Bank integrations"],unitIds:["k1"]}]},new Set(["k1"])).text).toBe("- **Core**：Include: 10-second logging; Leave out: Bank integrations");
});

it("does not allow a line break to create unbound list items or comparison rows",()=>{
 expect(()=>readWikiWritingBlock({type:"list",items:[{text:"保留原文",unitIds:["k1"]},{text:"规则\n- 额外要求",unitIds:["k1"]}]},new Set(["k1"]))).toThrow("invalid_writing_item");
});

it("rejects oversized structured content instead of losing it in paragraph selection",()=>{
 expect(()=>readWikiWritingBlock({type:"list",items:[{text:"必须保留完整条件。".repeat(150),unitIds:["k1"]},{text:"不得自动发送。".repeat(150),unitIds:["k1"]}]},new Set(["k1"]))).toThrow("writing_block_too_large");
});

it("suggests a table with fixed columns when the material is targets, a first-version scope, layers or open points",()=>{
 const units=(statements:string[])=>statements.map((statement,index)=>({id:`u${index}`,statement,kind:"fact",details:[]}) as unknown as WikiKnowledgeUnit);
 const metrics=wikiWritingLayout(units(["已预热的本地全文搜索争取 P95 在 500ms 以内。","本地混合搜索争取 P95 在 2 秒以内。","快速预览目标控制在 1 秒左右。"]));
 expect(metrics.preferred).toBe("comparison");expect(metrics.table?.columns).toEqual(["指标","目标","条件"]);
 expect(wikiWritingLayout(units(["第一版只做 ChatGPT 导入。","第一版支持消息级搜索。","完整 GraphRAG 暂缓开发。"])).table?.columns).toEqual(["事项","第一版"]);
 expect(wikiWritingLayout(units(["IndexedDB 层负责持久化。","Orama 索引层负责检索。","Search Index Manager 模块同步变更。"]),{zh:false}).table?.columns).toEqual(["Layer or module","Choice","Responsible for"]);
 expect(wikiWritingLayout(units(["侧栏默认收起。","阅读页保留原文顺序。"]),{open:2}).table?.columns).toEqual(["问题","可选方案"]);
 // Plain explanation gets no table.
 const plain=wikiWritingLayout(units(["侧栏默认收起。","阅读页保留原文顺序。"]));
 expect(plain.table).toBeUndefined();expect(plain.preferred).toBe("explanation");
});

it("writes the stages of a plan as a numbered list of labelled stages, never a table",()=>{
 const units=(statements:string[])=>statements.map((statement,index)=>({id:`u${index}`,statement,kind:"plan",details:[]}) as unknown as WikiKnowledgeUnit);
 const layout=wikiWritingLayout(units(["第一阶段实现本地全文索引。","第二阶段加入语义检索。","第三阶段引入答案生成。"]));
 expect(layout.preferred).toBe("stages");expect(layout.table).toBeUndefined();
 const block=readWikiWritingBlock({type:"stages",items:[{stage:"第一阶段",text:"实现本地全文索引。",unitIds:["k1"]},{stage:"第二阶段",text:"加入语义检索。",unitIds:["k2"]}]},new Set(["k1","k2"]));
 expect(block.text).toBe("1. **第一阶段**：实现本地全文索引。\n2. **第二阶段**：加入语义检索。");
 // The claim is the stage's text, bound to its own unit; the label is layout.
 expect(block.claims).toEqual([{text:"实现本地全文索引。",unitIds:["k1"]},{text:"加入语义检索。",unitIds:["k2"]}]);
 // A label with markdown is cleaned, and one too long is left off: the stage's text is kept, not the chapter refused.
 expect(readWikiWritingBlock({type:"stages",items:[{stage:"一个过长的阶段名称会把卡片标题撑破",text:"实现。",unitIds:["k1"]},{stage:"**P1**",text:"加入。",unitIds:["k1"]}]},new Set(["k1"])).text).toBe("1. 实现。\n2. **P1**：加入。");
});

it("suggests no layer table for project vocabulary, descriptions or a subtopic mostly about other things",()=>{
 const units=(statements:string[])=>statements.map((statement,index)=>({id:`u${index}`,statement,kind:"fact",details:[]}) as unknown as WikiKnowledgeUnit);
 // "存储" and "检索" everywhere, and ChatGPT or Wiki, name no layer's technology.
 expect(wikiWritingLayout(units(["数据导入从 ChatGPT 等平台导入历史对话并存储。","知识图谱发现 Wiki 章节间的关联。","检索结果按消息去重。"])).table).toBeUndefined();
 // Three layers among eight other points are not what the subtopic is about.
 const others=["首页保持极简。","导入后立即可搜索。","不自动发送。","先预览再插入。","备注可随时修改。","侧栏默认收起。"];
 expect(wikiWritingLayout(units(["IndexedDB 层负责持久化。","Orama 索引层负责检索。","Search Index Manager 模块同步变更。",...others])).table).toBeUndefined();
});

it("drops a comparison column holding only statuses, and makes no claim of a placeholder cell",()=>{
 const block=readWikiWritingBlock({type:"comparison",columns:["可选方案","核心特征","状态/备注"],rows:[
  {cells:["深色极简风格","保留左侧导航","Open（早期方案）"],unitIds:["k1"]},
  {cells:["浅色极简风格","-","Open（替代方案）"],unitIds:["k2"]},
 ]},new Set(["k1","k2"]));
 expect(block.text).toBe("| 可选方案 | 核心特征 |\n| --- | --- |\n| 深色极简风格 | 保留左侧导航 |\n| 浅色极简风格 | - |");
 expect(block.claims.map(claim=>claim.text)).toEqual(["深色极简风格","保留左侧导航","浅色极简风格"]);
});

it("suggests a two-column table when the units say who does what, three parts or more", () => {
  const units=(statements:string[])=>statements.map((statement,index)=>({id:`u${index}`,statement,kind:"fact",details:[]}) as unknown as WikiKnowledgeUnit);
  expect(wikiWritingLayout(units(["Dashboard 负责摘要，Wiki 负责解释。","Reader 负责证据。"])).table?.columns).toEqual(["模块","负责"]);
  expect(wikiWritingLayout(units(["Dashboard 负责摘要。","首页保持极简。"])).table).toBeUndefined();
});

it("reads a claim named by its sentence number and first characters, settling a miscount by the characters", () => {
  const text = "第一版只做导入。首页只保留搜索入口！\n- 正文宽度 720–850px";
  expect(claimSentence(text, { sentence: 2, starts: "首页只保留" })).toBe("首页只保留搜索入口！");
  // Miscounted: the first characters find the sentence.
  expect(claimSentence(text, { sentence: 1, starts: "首页只保留" })).toBe("首页只保留搜索入口！");
  expect(claimSentence(text, { sentence: 3, starts: "正文宽度" })).toBe("- 正文宽度 720–850px");
  // A claim written out is read as before; one naming nothing is dropped.
  expect(claimSentence(text, { text: "第一版只做导入。" })).toBe("第一版只做导入。");
  expect(claimSentence(text, { sentence: 9 })).toBeUndefined();
  const block = readWikiWritingBlock({ type: "paragraph", text, unitIds: ["u1", "u2"], claims: [{ sentence: 2, starts: "首页只保", unitIds: ["u2"] }] }, new Set(["u1", "u2"]));
  expect(block.claims).toEqual([{ text: "首页只保留搜索入口！", unitIds: ["u2"] }]);
});

it("reads a list of one item as a paragraph instead of refusing the answer", () => {
  const block = readWikiWritingBlock({ type: "list", items: [{ text: "首页只保留搜索入口。", unitIds: ["u1"] }] }, new Set(["u1"]));
  expect(block).toEqual({ text: "首页只保留搜索入口。", unitIds: ["u1"], claims: [{ text: "首页只保留搜索入口。", unitIds: ["u1"] }] });
});

it("labels list items and prefers a labelled list for parallel rules, checks and settings",()=>{
 const block=readWikiWritingBlock({type:"list",items:[{label:"**GPIO 冲突**",text:"仅独占资源冲突时报错。",unitIds:["k1"]},{label:"一个远远超过十二个字的过长标签名称",text:"同一总线地址重复报错。",unitIds:["k2"]}]},new Set(["k1","k2"]));
 expect(block.text).toBe("- **GPIO 冲突**：仅独占资源冲突时报错。\n- 同一总线地址重复报错。");
 expect(block.claims).toEqual([{text:"仅独占资源冲突时报错。",unitIds:["k1"]},{text:"同一总线地址重复报错。",unitIds:["k2"]}]);
 const units=["检查 GPIO 冲突。","检查 I²C 地址。","检查电压兼容。","检查负载驱动。","这样做是为了安全。"].map((statement,index)=>({id:`u${index}`,statement,kind:index<4?"mechanism":"decision",details:[]}) as unknown as WikiKnowledgeUnit);
 expect(wikiWritingLayout(units).preferred).toBe("list");
 expect(wikiWritingLayout(units).rule).toContain("labelled");
});

it("never cuts a sentence at a question mark inside its quotation",()=>{
 const paragraph="首页主标题为“你今天想做什么硬件？”，中央为大输入框。其余保持不变。";
 expect(claimSentence(paragraph,{sentence:1,starts:"首页主标题为"})).toBe("首页主标题为“你今天想做什么硬件？”，中央为大输入框。");
 expect(claimSentence(paragraph,{sentence:2,starts:"其余保持不变"})).toBe("其余保持不变。");
});

it("retains one-stage and long plans, chunking every evidenced stage without dropping text",()=>{
 const items=Array.from({length:19},(_,index)=>({stage:`P${index}`,text:`阶段 ${index} 保留自己的完整条件。`,unitIds:[`k${index}`]}));
 const known=new Set(items.flatMap(item=>item.unitIds)),before=JSON.stringify(items);
 expect(readWikiWritingBlocks({type:"stages",items:[items[0]]},known)[0].claims[0].unitIds).toEqual(["k0"]);
 const blocks=readWikiWritingBlocks({type:"stages",items},known);
 expect(blocks).toHaveLength(3);
 expect(blocks.flatMap(block=>block.claims).map(claim=>claim.text)).toEqual(items.map(item=>item.text));
 expect(new Set(blocks.flatMap(block=>block.unitIds)).size).toBe(19);
 expect(JSON.stringify(items)).toBe(before);
 expect(()=>readWikiWritingBlocks({type:"stages",items:[...items,{stage:"bad",text:"没有来源。",unitIds:["missing"]}]},known)).toThrow("invalid_writing_item");
});

it("shortens a long stage label instead of leaving the stage unlabelled",()=>{
 const block={type:"stages",items:[{stage:"Phase A (Pipeline Hardening)",text:"实现三入口统一与 Completeness Gate。",unitIds:["k1"]},{stage:"Phase B",text:"在 Phase A 测试通过后开始视觉库存。",unitIds:["k2"]}]};
 expect(readWikiWritingBlock(block,new Set(["k1","k2"])).text).toBe("1. **Phase A**：实现三入口统一与 Completeness Gate。\n2. **Phase B**：在 Phase A 测试通过后开始视觉库存。");
});

it("halves a list or table past the size limit instead of refusing the answer", () => {
 const known=new Set(["k1","k2"]);
 const items=Array.from({length:6},(_,index)=>({text:`第${index+1}条规则必须保留完整条件。`.repeat(20),unitIds:[index%2?"k2":"k1"]}));
 const lists=readWikiWritingBlocks({type:"list",items},known);
 expect(lists.length).toBeGreaterThan(1);
 expect(lists.every(block=>block.text.length<=1600)).toBe(true);
 expect(lists.flatMap(block=>block.claims).length).toBe(6);
 const rows=Array.from({length:6},(_,index)=>({cells:[`事项${index+1}`,"不实现，仅保留接口。".repeat(28)],unitIds:["k1"]}));
 const tables=readWikiWritingBlocks({type:"comparison",columns:["事项","第一版"],rows},known);
 expect(tables.length).toBeGreaterThan(1);
 expect(tables.every(block=>block.text.startsWith("| 事项 | 第一版 |"))).toBe(true);
 // One item too large on its own is still refused.
 expect(()=>readWikiWritingBlocks({type:"list",items:[{text:"必须保留完整条件。".repeat(200),unitIds:["k1"]},{text:"短。",unitIds:["k1"]}]},known)).toThrow("writing_block_too_large");
});
