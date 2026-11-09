import type {WikiDraftClaim,WikiKnowledgeUnit} from "../shared/wiki-knowledge";

interface WritingBlock {text:string;unitIds:string[];claims:WikiDraftClaim[]}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"?value as Record<string,unknown>:{};
const idsOf=(value:unknown)=>Array.isArray(value)?[...new Set(value.filter((id):id is string=>typeof id==="string"))]:[];
const singleLine=(value:unknown):value is string=>typeof value==="string"&&Boolean(value.trim())&&!/[\r\n]/u.test(value);

/** Material a table reads better than prose, found in the units' own words: targets with numbers, stages of a
 * roadmap, what the first version does and defers, layers of an architecture, points still open. */
const METRIC=/\d+(?:\.\d+)?\s*(?:ms|毫秒|秒|分钟|%|MB|KB|GB|名|条|次|天|万|千)|\bP9\d\b/iu,TARGET=/目标|争取|以内|不超过|至少|控制在|≥|≤|\b(?:target|within|at least|under)\b/iu;
const STAGE=/\bv\d+\.\d+\b|第[一二三四五]阶段|阶段[一二三四五]|\bP[0-3]\b|\bM\d\b|里程碑|\b(?:phase|milestone) \d\b/giu;
const FIRST=/第一版|首版|\bMVP\b|\bv0\.1\b|当前阶段|现阶段|\bfirst version\b/iu,DEFER=/暂缓|不做|不实现|暂不|延后|不包含|后续再|\b(?:defer|not in|later)\b/iu;
/** A layer named as such ("索引层", "检索引擎", "Adapter"); "存储" or "检索" alone is this project's vocabulary everywhere. */
const LAYER=/层|模块|引擎|适配器|服务端?|\b(?:layer|module|engine|adapter|service|server)\b/iu,TECHNOLOGY=/[A-Za-z][\w.+#-]{2,}/gu;
/** Latin words that name no technology a layer is built on: products this project works with, its own terms. */
const NOT_TECHNOLOGY=/^(?:ai|llm|wiki|dashboard|ui|api|token|tokens|agent|atlas|chatatlas|chatgpt|claude|gemini|codex|prompt|markdown|json|reader|sidebar|context|pack|brief|bundle|byok|local-first|github|chrome|mvp|first)$/iu;
const technologies=(text:string)=>(text.match(TECHNOLOGY)??[]).filter(word=>!NOT_TECHNOLOGY.test(word)).map(word=>word.toLocaleLowerCase());
/** Layers of an architecture: units naming a layer and its technology, at least three technologies in all, and
 * most of the subtopic about them. A table of 选型 "统一数据库" or "轻量客户端设计" three times compares nothing. */
function layeredStack(units:WikiKnowledgeUnit[]){
 const layered=units.filter(unit=>LAYER.test(unit.statement)&&technologies(unit.statement).length);
 return layered.length>=TABLE_MIN&&layered.length*2>=units.length&&new Set(layered.flatMap(unit=>technologies(unit.statement))).size>=TABLE_MIN;
}
/** Who does what: "Dashboard 负责摘要，Wiki 负责解释，Reader 负责证据". The parts named before 负责, three or more. */
const ROLE=/(?:^|[，,；;：:、\s])([^，,；;：:、。\s「」（）()]{2,16})\s*(?:主要)?负责/gu;
const roleHolders=(units:WikiKnowledgeUnit[])=>new Set(units.flatMap(unit=>[...unit.statement.matchAll(ROLE)].map(match=>match[1].toLocaleLowerCase())));
const PARALLEL_KINDS:Array<WikiKnowledgeUnit["kind"]>=["constraint","mechanism","fact"],PARALLEL_MIN=4;
const TABLE_MIN=3,OPEN_MIN=2,MAX_STAGES=8,STAGE_LABEL=16,LIST_LABEL=12;
/** A short label for a stage or list item, markdown marks stripped; one too long or empty is left off. */
// Too long, it is shortened first: "Phase A (Pipeline Hardening)" left the step unlabelled; "Phase A" names it.
const labelOf=(value:unknown,max:number)=>{
 const label=typeof value==="string"?value.replace(/[*_`#]/gu,"").replace(/\s+/gu," ").replace(/[：:]$/u,"").trim():"";
 if(!label||label.length<=max)return label;
 const short=label.replace(/\s*[（(][^）)]*[）)]\s*/gu," ").trim().split(/\s*[：:，,—–]\s*|\s+-\s+/u)[0].trim();
 return short&&short.length<=max?short:"";
};
/** A cell holding only a status, or nothing ("-"). */
const PLACEHOLDER=/^[-—–]?$/u;
const STATUS_CELL=new RegExp(`^(?:[-—–]?|(?:open|decided|confirmed|proposal|proposed|resolved|history|earlier|已定|未定|待定|已决定|已确认|仍在讨论|讨论中|此前|建议|早期方案|替代方案)(?:\\s*[（(][^）)]*[）)])?)$`,"iu");
type TableName="metrics"|"scope"|"roles"|"stack"|"open";
const COLUMNS:Record<TableName,[string[],string[]]>={
 metrics:[["指标","目标","条件"],["Measure","Target","Condition"]],
 scope:[["事项","第一版"],["Item","First version"]],
 roles:[["模块","负责"],["Part","Responsible for"]],
 stack:[["层或模块","选型","负责"],["Layer or module","Choice","Responsible for"]],
 open:[["问题","可选方案"],["Question","Options"]],
};
const HOW:Record<TableName,string>={
 metrics:"one row per measure; 条件 holds where it applies (warmed index, hybrid search) or stays the unit's own words",
 scope:"one row per item; 第一版 says 做, 暂缓 or 不做 as the unit states it",
 roles:"one row per part the units name, with what it is responsible for in the units' words; a part named with no role is left out",
 stack:"one row per layer or module, in the order data flows; 选型 names the concrete technology or product the unit gives (IndexedDB, Orama), never a description or a value another row repeats; 负责 what it does. A row with no named technology is left out, and with fewer than three rows left the table is prose",
 open:"one row per open question; 可选方案 lists the alternatives the units give",
};
/** Stages of a plan read as a row of cards, one per stage, not as a table. */
const stagedPlan=(units:WikiKnowledgeUnit[])=>new Set(units.flatMap(unit=>(unit.statement.match(STAGE)??[]).map(stage=>stage.toLocaleLowerCase()))).size>=TABLE_MIN;
/** The table this material fits best, or none. */
function fittingTable(units:WikiKnowledgeUnit[],open:number):TableName|undefined{
 const count=(test:(text:string)=>boolean)=>units.filter(unit=>test(unit.statement)).length;
 if(count(text=>METRIC.test(text)&&TARGET.test(text))>=TABLE_MIN)return "metrics";
 const first=units.filter(unit=>FIRST.test(unit.statement)||DEFER.test(unit.statement));
 if(first.length>=TABLE_MIN&&first.some(unit=>DEFER.test(unit.statement))&&first.some(unit=>!DEFER.test(unit.statement)))return "scope";
 if(roleHolders(units).size>=TABLE_MIN)return "roles";
 if(layeredStack(units))return "stack";
 if(open>=OPEN_MIN)return "open";
}

/** Reading structure is planned from the supplied material, not a topic-name keyword. */
export function wikiWritingLayout(units:WikiKnowledgeUnit[],options:{zh?:boolean;open?:number}={}){
 // Parallel points (rules, checks, parts, settings) read as a labelled list: written as prose, one sentence per
 // rule, a subtopic of validator checks read as a wall of 检查……。检查……。
 const constraints=units.filter(unit=>unit.kind==="constraint"),parallel=units.filter(unit=>PARALLEL_KINDS.includes(unit.kind));
 const listed=constraints.length>=3&&constraints.length*2>=units.length||parallel.length>=PARALLEL_MIN&&parallel.length*3>=units.length*2;
 const subjects=new Set(units.flatMap(unit=>unit.about?.name??[]));
 const stages=subjects.size<2&&stagedPlan(units),table=subjects.size>=2||stages?undefined:fittingTable(units,options.open??0);
 return {preferred:stages?"stages":subjects.size>=2||table?"comparison":listed?"list":"explanation",
  allowed:["paragraph","list","comparison","stages"],maxColumns:4,
  ...(table?{table:{columns:COLUMNS[table][options.zh===false?1:0],rows:HOW[table]}}:{}),
  rule:"Explain reasons in prose; group parallel rules in lists; compare only shared, evidenced dimensions. Keep each item's conditions, status and unitIds. Do not invent cells or repeat the same content in prose."
   +(listed&&!stages&&!table?" The material is mostly parallel rules, checks, parts or settings: write them as labelled list blocks of at most 7 items each, grouped by what they concern, each item labelled (2-8 characters) and one short sentence, after at most one sentence saying what they are for.":"")
   +(stages?" The material is the stages of a plan: write them as one stages block, one item per stage in the plan's order, stage a short label (第一阶段, P0, v0.1) and text what that stage does; put the short answer before it.":"")
   +(table?" table names a table this material fits: write the units it covers as one comparison block with these columns (drop a column no unit fills), rows as described, each row citing its own units; put the short answer before it and only reasons it cannot hold after it. Leave out the table when fewer than two rows can be filled from the units.":"")};
}

/** Compile explicit model blocks into the existing saved Markdown, preserving row/item evidence.
 * A malformed item invalidates the block; no partly successful table silently drops a condition. */
/** The sentence a claim names. Copying each claimed sentence again made a third of the writer's output; a claim names
 * its sentence by number (counting from 1, a sentence ending at 。！？!? or a line) and by its first characters, which
 * settle a miscount. A claim written out in full is still read. */
export function claimSentence(paragraph:string,claim:Record<string,unknown>):string|undefined{
 if(typeof claim.text==="string"&&claim.text.trim())return claim.text.trim();
 const sentences=paragraph.split(/(?:(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))(?![^“”「」\n]*[”」])|\n/u).map(sentence=>sentence.trim()).filter(Boolean);
 const number=typeof claim.sentence==="number"&&Number.isInteger(claim.sentence)?claim.sentence:undefined;
 const start=typeof claim.starts==="string"?bareStart(claim.starts):"";
 const opening=start?sentences.filter(sentence=>bareStart(sentence).startsWith(start)):[];
 if(opening.length)return opening.length>1&&number&&opening.includes(sentences[number-1])?sentences[number-1]:opening[0];
 return number?sentences[number-1]:undefined;
}
const bareStart=(text:string)=>text.replace(/^\s*(?:[-*+]|\d+\.)\s+/u,"").replace(/[\s*_，,。．.；;：:“”"'‘’（）()]/gu,"");

/** A comparison block that reads as a table: 2-4 one-line column names, two or more rows of one-line cells, one per column. */
const comparable=(block:Record<string,unknown>)=>Array.isArray(block.columns)&&block.columns.length>=2&&block.columns.length<=4&&block.columns.every(singleLine)&&Array.isArray(block.rows)&&block.rows.length>=2
 &&block.rows.every(value=>{const cells=record(value).cells;return Array.isArray(cells)&&cells.length===(block.columns as unknown[]).length&&cells.every(singleLine);});
export function readWikiWritingBlock(value:unknown,known:Set<string>):WritingBlock{
 const block=record(value);
 const item=(value:unknown):WritingBlock=>{
  const row=record(value),unitIds=idsOf(row.unitIds);
  if(!singleLine(row.text)||!unitIds.length||unitIds.some(id=>!known.has(id)))throw Error("invalid_writing_item");
  const text=row.text.trim();
  return {text,unitIds,claims:[{text,unitIds}]};
 };
 if(block.type==="paragraph"){
  const unitIds=idsOf(block.unitIds);
  if(typeof block.text!=="string"||!block.text.trim()||block.text.length>1600||!unitIds.length||unitIds.some(id=>!known.has(id)))throw Error("invalid_writing_paragraph");
  const claims=Array.isArray(block.claims)?block.claims.flatMap(value=>{
   const claim=record(value),ids=idsOf(claim.unitIds),text=claimSentence(block.text as string,claim);
   return text&&ids.length&&ids.every(id=>unitIds.includes(id))?[{text,unitIds:ids}]:[];
  }):[];
  return {text:block.text.trim(),unitIds,claims};
 }
 let rows:WritingBlock[],text:string;
 if(block.type==="list"){
  if(!Array.isArray(block.items)||!block.items.length)throw Error("invalid_writing_list");
  // A list of one item is a sentence: read as a paragraph, not refused with the rest of the answer.
  if(block.items.length===1)return item(block.items[0]);
  // A labelled item ("**GPIO 冲突**：……") is scanned by its label; the label is layout, the text the claim.
  rows=block.items.map(value=>{const bound=item(value),label=labelOf(record(value).label,LIST_LABEL);return label?{...bound,text:`**${label}**：${bound.text}`}:bound;});
  text=rows.map(row=>`- ${row.text}`).join("\n");
 }else if(block.type==="stages"){
  // One card per stage: a short label, then what the stage does. The label is layout; the text is the claim.
  if(!Array.isArray(block.items)||!block.items.length)throw Error("invalid_writing_stages");
  rows=block.items.map(value=>{
   // Refusing a bad label threw away a whole chapter's writing (v4: twice): it is cleaned or left off instead.
   const row=record(value),stage=labelOf(row.stage,STAGE_LABEL);
   const bound=item(row);
   return {...bound,text:stage?`**${stage}**：${bound.text}`:bound.text};
  });
  text=rows.map((row,index)=>`${index+1}. ${row.text}`).join("\n");
 }else if(block.type==="comparison"&&!comparable(block)){
  // A table that cannot be read as one (one row, five columns, a cell broken over lines) is written as a list of
  // its rows: refused, it threw away the part's whole writing (one run's chapter part).
  const lines=Array.isArray(block.rows)?block.rows:[];
  if(!lines.length)throw Error("invalid_writing_comparison");
  // With its columns, each cell keeps its column's name: "Core Functionality / 10-second logging / Bank integrations"
  // did not say which were in and which out.
  const names=Array.isArray(block.columns)&&block.columns.every(singleLine)?(block.columns as string[]).map(name=>name.trim()):[];
  rows=lines.map(value=>{
   const row=record(value),raw=Array.isArray(row.cells)?row.cells:[];
   const cells=raw.flatMap((cell,index)=>typeof cell==="string"&&cell.trim()?[{text:cell.replace(/\s+/gu," ").trim(),index}]:[]);
   const bound=item({text:cells.map(cell=>cell.text).join(" / "),unitIds:row.unitIds});
   if(names.length!==raw.length||cells.length<2||cells[0].index!==0)return bound;
   // Two columns need no names: the second says what the first is.
   const rest=cells.slice(1).map(cell=>names.length>2?`${names[cell.index]}: ${cell.text}`:cell.text).join("; ");
   return {...bound,text:`**${cells[0].text}**：${rest}`,claims:cells.map(cell=>({text:cell.text,unitIds:bound.unitIds}))};
  });
  text=rows.map(row=>`- ${row.text}`).join("\n");
 }else if(block.type==="comparison"){
  if(!Array.isArray(block.columns)||block.columns.length<2||block.columns.length>4||!block.columns.every(singleLine)||!Array.isArray(block.rows)||block.rows.length<2)throw Error("invalid_writing_comparison");
  const cell=(value:string)=>value.trim().replace(/\|/gu,"\\|");
  const labels=block.columns as string[],lines=block.rows as unknown[];
  if(lines.some(value=>{const row=record(value);return !Array.isArray(row.cells)||row.cells.length!==labels.length||!row.cells.every(singleLine);}))throw Error("invalid_writing_cells");
  // A column of statuses ("Open（替代方案）", "已定") repeats what the marks say, and its cells read as points: it goes.
  const cellsOf=(value:unknown)=>record(value).cells as string[];
  const keep=labels.map((_,index)=>!lines.every(value=>STATUS_CELL.test(cellsOf(value)[index].trim())));
  const columns=labels.filter((_,index)=>keep[index]);
  if(columns.length<2)throw Error("invalid_writing_comparison");
  rows=lines.map(value=>{
   const row=record(value),cells=cellsOf(value).filter((_,index)=>keep[index]);
   const bound=item({text:cells.join(" / "),unitIds:row.unitIds});
   // A placeholder cell ("-") is no claim.
   return {...bound,text:`| ${cells.map(cell).join(" | ")} |`,claims:cells.filter(text=>!PLACEHOLDER.test(text.trim())).map(text=>({text:cell(text),unitIds:bound.unitIds}))};
  });
  text=[`| ${columns.map(cell).join(" | ")} |`,`| ${columns.map(()=>"---").join(" | ")} |`,...rows.map(row=>row.text)].join("\n");
 }else throw Error("invalid_writing_block_type");
 if(text.length>1600)throw Error("writing_block_too_large");
 return {text,unitIds:[...new Set(rows.flatMap(row=>row.unitIds))],claims:rows.flatMap(row=>row.claims)};
}

/** A long plan is presentation, not a reason to discard a chapter. Compile every
 * item through the same evidence checks, then split without cutting its text. */
export function readWikiWritingBlocks(value:unknown,known:Set<string>):WritingBlock[]{
 const block=record(value);
 // A list or table past the size limit is halved until each part fits: refused, it threw away the part's whole answer
 // (one run lost 6 points). A table keeps two rows a part, so each half still reads as a table.
 if(block.type==="list"||block.type==="comparison"){
  const key=block.type==="list"?"items":"rows",least=block.type==="list"?1:2;
  const split=(part:Record<string,unknown>):WritingBlock[]=>{
   try{return [readWikiWritingBlock(part,known)];}
   catch(error){
    const all=part[key];
    if(!(error instanceof Error)||error.message!=="writing_block_too_large"||!Array.isArray(all)||all.length<least*2)throw error;
    const half=Math.max(least,Math.ceil(all.length/2));
    const parts=[...split({...part,[key]:all.slice(0,half)}),...split({...part,[key]:all.slice(half)})];
    // A half of one item reads as a sentence, which has no size check of its own: one item too long is still refused.
    if(parts.some(item=>item.text.length>1600))throw error;
    return parts;
   }
  };
  return split(block);
 }
 if(block.type!=="stages"||!Array.isArray(block.items)||!block.items.length)return [readWikiWritingBlock(value,known)];
 const rows=block.items.map(item=>readWikiWritingBlock({type:"stages",items:[item]},known));
 const chunks:WritingBlock[][]=[];
 for(const row of rows){
  const last=chunks[chunks.length-1];
  if(!last||last.length>=MAX_STAGES||last.reduce((sum,item)=>sum+item.text.length+8,0)+row.text.length+8>1600)chunks.push([row]);
  else last.push(row);
 }
 return chunks.map(chunk=>({text:chunk.map((row,index)=>row.text.replace(/^1\./u,`${index+1}.`)).join("\n"),unitIds:[...new Set(chunk.flatMap(row=>row.unitIds))],claims:chunk.flatMap(row=>row.claims)}));
}
