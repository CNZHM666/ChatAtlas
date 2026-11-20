import { wikiDocumentBlocks } from "./wiki-document-blocks";
import { WIKI_SUPPLEMENT, wikiSupplementRanges } from "./wiki-source-supplements";
import type { WikiKnowledgeUnit } from "./wiki-knowledge";
import { wikiTableCells as cells, wikiTableKey as tableKey } from "./wiki-table-source";
import { WIKI_EVIDENCE_LINK } from "./wiki-evidence-link";

const MILESTONE = /^(?:M\s*\d+|(?:milestone|phase|stage)\s+\d+|第[一二三四五六七八九十\d]+阶段|v\d+(?:\.\d+)+)$/iu;
const PRIORITY = /^(?:P\s*\d+|暂缓|暂不做|暂不建议|以后|后续|deferred|later)$/iu;
const PLAN_HEAD = /阶段|里程碑|版本|优先级|实施|功能|milestone|stage|phase|version|priority|feature/iu;
const LOCAL_SCOPE = /首版|第一版|MVP|v\d+(?:\.\d+)+|(?:first|initial) release/iu;
const SOURCE = /^(?:原文来源|Original source|Source references?)\s+(?=\[)/iu;
const CAPTION = /^(?:对照表|讨论中的原文表格|Comparison table|Table from the discussion)(?:\s*[·：:]\s*(.+))?$/iu;
const ASSESSMENT = /^(?:AI\s*(?:看法|评价|点评|意见)|AI (?:assessment|opinion|evaluation))$/iu;

const plain = (value: string) => value.replace(/^#{1,6}\s+|^\*{1,3}|\*{1,3}$/gu, "").replace(/<badge[^>]*>|<\/badge>/giu, "").trim();
const tableValue = (value: string) => value.replace(/(?<!\\)\|/gu, "\\|").replace(/\r?\n/gu, " ");
const emptyCell = /^(?:[—–-]+|…)?$/u;
const sameTopic = (topic: string, scope?: string) => [topic, scope].filter(Boolean).filter((value, i, all)=>all.indexOf(value)===i).join(" · ");
const cellKey = (value: string) => plain(value).normalize("NFC");
const originsOf = (values: string[]) => [...new Set(values.filter(Boolean).flatMap(value =>
  /^(?:(?:\[[\w-]+\]|#\d+)(?:\s+|$))+$/u.test(value) ? value.trim().split(/\s+/u) : [value]))].join(" ");

type ReadingTable = {
  start: number; end: number; firstBlock: number; lastBlock: number;
  source: string; table: string; topic: string; topicId: number; scope?: string; origin: string; subject: string;
  header: string[]; divider: string[]; rows: string[][]; changed: boolean; needsIntro: boolean;
  stage: number; priority: number;
};
const renderTable = (header: string[], rows: string[][]) =>
  [header, header.map(() => "---"), ...rows].map(row => `| ${row.map(tableValue).join(" | ")} |`).join("\n");

const PACK_HEADERS = [/^(?:用途)?场景$/u, /^打包(?:范围|内容)$/u, /^(?:是否调用 LLM|需要 LLM 吗[？?]?)$/u];
const isPackingTable = (table: ReadingTable) => table.header.length === PACK_HEADERS.length
  && PACK_HEADERS.every((pattern, index) => pattern.test(cellKey(table.header[index])));
const packingLabels = new Map([
  ["快速介绍项目", "快速介绍"], ["继续具体任务", "具体任务"], ["完整迁移项目知识", "完整迁移"],
]);
function packingValue(value: string, column: number) {
  const key = cellKey(value);
  if (column === 0) return packingLabels.get(key) ?? key;
  if (column === 2) return key === "不需要" ? "否" : key;
  const content = key.replace(/\s*\+\s*/gu, " + ");
  if (/^Brief \+ (?:Wiki )?核心章节$/u.test(content)) return "Brief + Wiki 核心章节";
  if (/^(?:精简 Brief|Brief 精简版) \+ (?:任务)?相关(?: Wiki )?章节$/u.test(content)) return "精简 Brief + 任务相关 Wiki 章节";
  if (/^(?:Brief \+ )?(?:全部选定章节|用户选择的全部 Wiki 章节)$/u.test(content))
    return content.startsWith("Brief + ") ? "Brief + 全部选定 Wiki 章节" : "全部选定 Wiki 章节";
  return key;
}

/** Join neighboring comparisons where shared rows agree. A different value for
 * the same subject may describe a change or a parallel option. Leave it in place. */
function mergeComparisons(tables: ReadingTable[], zh: boolean) {
  const replacements = new Map<ReadingTable, string>();
  for (let index = 0; index < tables.length; index++) {
    const first = tables[index], packing = zh && isPackingTable(first);
    if (first.stage >= 0 || first.priority >= 0 || ASSESSMENT.test(plain(first.header[1] ?? ""))) continue;
    const normalize = packing ? packingValue : cellKey;
    type MergedRow = {row: string[]; origins: string[]; briefSources?: string[]};
    const merged = new Map<string, MergedRow>(first.rows.map(row => [normalize(row[0], 0), {row, origins: [first.origin]}]));
    if (!merged.size || merged.size !== first.rows.length) continue;
    const family = [first];
    for (let candidate = index + 1; candidate < tables.length; candidate++) {
      const next = tables[candidate];
      const prev = family.at(-1)!;
      if (next.firstBlock !== prev.lastBlock + 1 || next.topicId !== first.topicId || next.scope !== first.scope
        || next.stage >= 0 || next.priority >= 0 || !next.rows.length
        || first.subject && next.subject && first.subject !== next.subject
        || (packing ? !isPackingTable(next) : JSON.stringify(next.header.map(cellKey)) !== JSON.stringify(first.header.map(cellKey)))) break;
      const incoming = new Set<string>();
      const additions: Array<[string, MergedRow]> = [];
      let shared = 0;
      for (const row of next.rows) {
        const key = normalize(row[0], 0), known = merged.get(key);
        if (incoming.has(key)) break;
        incoming.add(key);
        const differences = known ? row.map((value, column) => normalize(value, column) !== normalize(known.row[column], column) ? column : -1).filter(column => column >= 0) : [];
        const migration = packing && key === "完整迁移" && differences.length === 1 && differences[0] === 1
          && [normalize(row[1], 1), normalize(known!.row[1], 1)].sort().join("|") === "Brief + 全部选定 Wiki 章节|全部选定 Wiki 章节";
        if (differences.length && !migration) break;
        if (known) shared++;
        const briefSources = migration
          ? [...known?.briefSources ?? [], ...(normalize(row[1], 1).startsWith("Brief") ? [next.origin] : known!.origins)]
          : known?.briefSources;
        const keptRow = migration ? ["完整迁移", "全部选定 Wiki 章节", row[2]] : known?.row ?? row;
        additions.push([key, {row: keptRow, origins: [...known?.origins ?? [], next.origin], briefSources}]);
      }
      if (additions.length !== next.rows.length || !shared) break;
      for (const [key, value] of additions) merged.set(key, value);
      family.push(next);
    }
    if (family.length === 1) continue;
    const refs = new Set([...merged.values()].map(item => originsOf(item.origins)));
    const byRow = refs.size > 1;
    const header = packing ? ["场景", "打包内容", "需要 LLM 吗"] : first.header;
    const rows: string[][] = [];
    const notes: string[] = [];
    for (const [key, {row, origins, briefSources}] of merged) {
      const source = originsOf(origins);
      if (packing && key === "需要更短、更连贯的交接文档" && cellKey(row[1]) === "上述内容经 LLM 精炼" && cellKey(row[2]) === "可选") {
        notes.push(`讨论中还提出，可选用 LLM 精炼交接文档。${source ? ` ${source}` : ""}`);
        continue;
      }
      const display = packing ? row.map(packingValue) : row;
      if (briefSources) {
        const briefSource = originsOf(briefSources);
        display[1] += `（另有方案同时包含 Brief${briefSource ? ` ${briefSource}` : ""}）`;
      }
      rows.push(byRow ? [...display, source || "—"] : display);
    }
    const source = byRow ? "" : refs.values().next().value;
    if (source && rows.length) notes.unshift(`${zh ? "原文来源" : "Original source"} ${source}`);
    const intro = first.needsIntro ? packing ? `下表记录讨论中不同用途的打包范围${first.scope ? `（${first.scope}）` : ""}。` : tableIntroduction(header, first.scope, zh) : "";
    const text = [intro, renderTable(byRow ? [...header, zh ? "原文" : "Evidence"] : header, rows), ...notes].filter(Boolean).join("\n\n");
    replacements.set(first, text);
    for (const duplicate of family.slice(1)) replacements.set(duplicate, "");
    index += family.length - 1;
  }
  return replacements;
}

type TableOptions = {units?: WikiKnowledgeUnit[]; citeTable?: (unit: WikiKnowledgeUnit) => string};
export const isWikiTableIntroduction = (text:string) => /^(?:下表(?:按|说明|记录|列出|对照两份检索方案)|以下对照「|以下是(?:「[^」]+」|本节)讨论过的规划。|这里记录了「[^」]+」讨论中的范围取舍。|The table compares |This records the proposed scope for |These proposals cover different priorities and delivery sequences\.)/u.test(text.trim());

function tableIntroduction(header: string[], caption: string | undefined, zh: boolean) {
  const [first, ...attributes] = header.map(value => value.replace(/\*\*|__|\x60/gu, "").trim()).filter(Boolean);
  if (!first || !attributes.length) return caption ? (zh ? `讨论范围为「${caption}」。` : `Discussion scope: ${caption}.`) : "";
  const fields = attributes.join(zh ? "、" : ", ");
  const context = caption ? (zh ? `（${caption}）` : ` (${caption})`) : "";
  if (zh && first === "内容" && /处理方式$/u.test(fields)) return `下表说明${fields.replace(/处理方式$/u, "")}如何处理不同类型的内容${caption && !fields.includes(caption) ? context : ""}。`;
  if (zh && first === "字段" && fields === "为什么重要") return `下表说明每个字段在数据模型中的用途${context}。`;
  if (zh && first === "数据表" && fields.includes("第一版是否必须")) return "下表说明数据表各自的职责，以及第一版是否需要它们。";
  if (zh && first === "功能" && fields === "技术") return `下表记录讨论中各项功能对应的技术选型${context}。`;
  if (zh && first === "指标" && fields === "怎么测、重点") return `下表列出各项指标的测量方式和验收重点${context}。`;
  if (zh && /场景|用户输入/u.test(first) && /优先内容|打包内容|LLM|推荐策略/u.test(fields))
    return `下表说明不同${first}该选哪些内容或处理方式${context}。`;
  if (/^(?:模块|part|module)$/iu.test(first) && /负责|职责|responsib/i.test(fields)) return zh
    ? "沿着模块分工，可以看出每一步由谁处理，以及结果在哪里交给下一个模块。"
    : "The responsibilities show who handles each step and where the result is handed off.";
  if (zh && /^(?:维度|对比|对比维度)$/u.test(first)) return `下表按相同维度比较${attributes.join("和")}${context}。`;
  if (/^(?:事项|item)$/iu.test(first)) {
    const release = caption || attributes.find(attribute => LOCAL_SCOPE.test(attribute));
    return release ? zh ? `这里记录了「${release}」讨论中的范围取舍。` : `This records the proposed scope for ${release}.` : "";
  }
  if (attributes.length===1 && !/^(?:项目|功能|阶段|版本|维度|类型|平台|工具|模块|优先级|字段|feature|stage|version|kind|component|priority)$/iu.test(first))
    return zh ? `以下对照「${first}」和「${attributes[0]}」${context}。` : `The table compares ${first} and ${attributes[0]}${context}.`;
  return caption ? (zh ? `适用范围为「${caption}」。` : `Scope: ${caption}.`) : "";
}

const SEARCH_STEPS = [
  {label: "全文检索", method: /^(?:全文检索|全文搜索|全文索引|full[- ]text search|full[- ]text index)$/iu},
  {label: "混合检索", method: /^(?:混合检索|混合搜索|Hybrid Search|Hybrid Retrieval)$/iu},
  {label: "LLM 重排", method: /^(?:LLM 重排(?:\s*\+\s*引用回答)?|LLM reranking)$/iu},
  {label: "检索 Agent", method: /^(?:LLM 检索 Agent|Agent 多轮搜索|检索 Agent|Search Agent)$/iu},
] as const;
const searchGoal = (value: string) => /^模糊描述也能(?:查找|找到相关消息)$/u.test(cellKey(value)) ? "支持用模糊描述查找相关消息" : cellKey(value);
function searchSteps(table: ReadingTable) {
  const columns = table.header.map((_, index) => index).filter(index => index !== table.stage);
  const [method, goal] = columns;
  if (table.stage < 0 || columns.length > 2 || !/^(?:技术方案|开发内容|实现内容)$/u.test(cellKey(table.header[method]))) return [];
  const steps = table.rows.map(row => {
    const techniques = row[method].replace(/\bOrama\s+(?=全文(?:检索|搜索|索引))/gu, "Orama + ").split(/\s+\+\s+|\s*＋\s*/u);
    const stage = SEARCH_STEPS.findIndex(step => step.method.test(cellKey(row[method])) || techniques.some(value => step.method.test(cellKey(value))));
    return {stage, label: row[table.stage], techniques, goal: row[goal] ?? ""};
  });
  // Only compare unambiguous sequences. A different ordering is a distinction
  // the comparison must preserve, even when both use the same technologies.
  if (steps.some((step, index) => step.stage < 0 || index > 0 && step.stage <= steps[index - 1].stage)) return [];
  return steps;
}

function searchRoadmap(family: ReadingTable[]) {
  const plans = family.map((table, index) => ({table, index, steps: searchSteps(table)})).filter(plan => plan.steps.length >= 2);
  for (const first of plans) {
    const second = plans.find(plan => plan.index > first.index && first.steps.filter(step => plan.steps.some(other => step.stage === other.stage)).length >= 2);
    if (!second) continue;
    const headings = [first, second].map(({table, index}) => {
      const title = sameTopic(table.subject, table.scope) || `讨论方案 ${index + 1}`;
      return table.origin ? `${title} ${table.origin}` : title;
    });
    const rows = SEARCH_STEPS.flatMap(({label, method}, stage) => {
      const a = first.steps.find(step => step.stage === stage), b = second.steps.find(step => step.stage === stage);
      if (!a && !b) return [];
      const common = a && b ? a.techniques.filter(value => (stage >= 2 || !method.test(cellKey(value)))
        && b.techniques.some(other => cellKey(value) === cellKey(other))) : [];
      const goal = a?.goal && b?.goal && searchGoal(a.goal) === searchGoal(b.goal) ? searchGoal(a.goal) : "";
      const describe = (step: typeof a) => step ? [
        step.label,
        step.techniques.filter(value => !common.some(shared => cellKey(shared) === cellKey(value))
          && (stage >= 2 || !method.test(cellKey(value)))).join(" + "),
        goal ? "" : step.goal,
      ].filter(Boolean).join(" · ") : "—";
      return [[label, [...common, goal].filter(Boolean).join(" · ") || "—", describe(a), describe(b)]];
    });
    const showCommon = rows.some(row => row[1] !== "—");
    const compact = (row: string[]) => showCommon ? row : row.filter((_, index) => index !== 1);
    const text = "下表对照两份检索方案。各自的版本号和里程碑沿用原讨论。\n\n"
      + renderTable(compact(["检索环节", "共同要点", ...headings]), rows.map(compact));
    return {text, compared: new Set([first.table, second.table])};
  }
}

/** A reading projection. Keep original labels and rows together as sources.
 * Compare within a table before combining discussions: M2 in one table has
 * no ordering or equivalence relationship to M2 in another. */
export function consolidateWikiPlanTables(body: string, zh: boolean, {units, citeTable}: TableOptions = {}): string {
  const attachments = wikiSupplementRanges(body);
  const blocks = wikiDocumentBlocks(body);
  const edits: Array<{start:number;end:number;text:string}> = [];
  const tables: ReadingTable[] = [];
  const seen = new Map<string, ReadingTable>();
  const sourceTables = new Map<string, WikiKnowledgeUnit[]>();
  for (const unit of units ?? []) {
    if (unit.evidence.code?.language !== "table") continue;
    const key = tableKey(unit.evidence.code.text);
    sourceTables.set(key, [...sourceTables.get(key) ?? [], unit]);
  }
  let topic = "";
  let topicId = 0;
  for (const [index, block] of blocks.entries()) {
    if (attachments.some(([start, end]) => block.start >= start && block.end <= end)) continue;
    const captionHere = ["paragraph","heading"].includes(block.kind) && CAPTION.exec(plain(block.text));
    if (captionHere && blocks[index+1]?.kind !== "table") {
      edits.push({start:block.start,end:block.end,text:""});
      continue;
    }
    if (block.kind === "heading" && !captionHere) {
      topic = block.text.replace(/^#+\s+/u, "");
      topicId = index + 1;
    }
    if (block.kind !== "table") continue;
    const [header, divider, ...bodyRows] = block.text.split("\n").map(cells);
    if (bodyRows.some(row => row.length !== header.length)) continue;
    const rows = [...new Map(bodyRows.filter(row => row.slice(1).some(value => !emptyCell.test(plain(value)))).map(row => [JSON.stringify(row), row])).values()];
    const stage = header.findIndex((value, column) => PLAN_HEAD.test(value) && rows.length >= 2 && rows.every(row => MILESTONE.test(plain(row[column]))));
    const priority = header.findIndex((value, column) => PLAN_HEAD.test(value) && rows.length >= 2 && rows.every(row => PRIORITY.test(plain(row[column]))));
    const previous = blocks[index - 1], next = blocks[index + 1];
    const caption = previous && ["paragraph","heading"].includes(previous.kind) ? CAPTION.exec(plain(previous.text)) : null;
    const reference = next?.kind === "paragraph" && !next.text.includes("\n") && SOURCE.test(next.text) ? next : undefined;
    const scope = caption?.[1] ?? header.find(value=>LOCAL_SCOPE.test(value))?.match(LOCAL_SCOPE)?.[0];
    const matched = sourceTables.get(tableKey(block.text)) ?? [];
    const origins = [...new Set(matched.map(unit=>citeTable?.(unit) ?? (Number.isFinite(unit.evidence.messageIndex) ? `#${unit.evidence.messageIndex!+1}` : "")).filter(Boolean))];
    const savedOrigin=reference?.text.replace(SOURCE, "");
    const locatedOrigin=origins.join(" ");
    const legacyLocator=savedOrigin&&/^(?:\[[\w:-]+\]\s*)+$/u.test(savedOrigin);
    const useLocated=locatedOrigin.includes(WIKI_EVIDENCE_LINK)&&(legacyLocator||savedOrigin?.includes(WIKI_EVIDENCE_LINK));
    const origin = useLocated ? locatedOrigin : savedOrigin ?? locatedOrigin;
    const subject = new Set(matched.map(unit=>unit.subject)).size===1 ? matched[0].subject : "";
    const ownIntro = previous?.kind === "paragraph" && (previous.text === tableIntroduction(header, scope, zh) ||
      /^(?:以下对照「事项」和「[^」]+」(?:（[^）]+）)?。|The table compares item and [^.]+\.)$/iu.test(previous.text) ||
      /^(?:下表按「[^」]+」列出[^。\n]+。|The table compares [^\n]+ by [^.\n]+\.)$/u.test(previous.text));
    const hasLead = Boolean(caption || ownIntro);
    const start = hasLead ? previous.start : block.start, end = reference?.end ?? block.end;
    // Keep an existing explanation ahead of an uncoupled table.
    const described = previous?.kind==="paragraph" && (isWikiTableIntroduction(previous.text)
      || /下表|见表|如下表|具体价格待确认|\b(?:the table (?:shows|lists|compares)|table below|specific prices require confirmation)\b/iu.test(previous.text)
      || header.slice(1).some(value=>plain(value).length>=4&&previous.text.includes(plain(value))));
    const needsIntro = hasLead || !described;
    const table = {start,end,firstBlock:index-Number(hasLead),lastBlock:index+Number(Boolean(reference)),source:body.slice(start,block.end),table:block.text,topic,topicId,scope,origin,subject,header,divider,rows,changed:rows.length!==bodyRows.length,needsIntro,stage,priority};
    const key = JSON.stringify([topicId,scope,tableKey([header.join("|"),divider.join("|"),...rows.map(row=>row.join("|"))].join("\n"))]);
    const duplicate = seen.get(key);
    if (duplicate) {
      duplicate.origin = originsOf([duplicate.origin,origin]);
      edits.push({start,end,text:""});
      continue;
    }
    seen.set(key,table);
    tables.push(table);
  }
  const comparisons = mergeComparisons(tables, zh);
  const grouped = new Map<number, ReadingTable[]>(), assessments = new Map<number, ReadingTable[]>();
  for (const table of tables) {
    if (comparisons.has(table)) continue;
    const planned=table.rows.length>=2&&(table.stage>=0||table.priority>=0||table.scope&&LOCAL_SCOPE.test(table.scope)&&table.header.some(value=>/功能|能力|feature|capability/iu.test(value)));
    if (planned) grouped.set(table.topicId,[...grouped.get(table.topicId)??[],table]);
    if (table.rows.length>0&&table.header.length===2&&ASSESSMENT.test(plain(table.header[1]))) assessments.set(table.topicId,[...assessments.get(table.topicId)??[],table]);
  }
  const withSource = (table:ReadingTable)=>table.origin ? `${table.source}\n\n${zh?"原文来源":"Original source"} ${table.origin}` : table.source;
  const supplement=(title:string,contents:string)=>`<details data-atlas="${WIKI_SUPPLEMENT}">\n<summary>${title}</summary>\n\n${contents}\n\n</details>`;
  const originals: string[] = [];
  for (const table of tables) {
    const merged = comparisons.get(table);
    if (merged !== undefined) {
      edits.push({start:table.start,end:table.end,text:merged});
      continue;
    }
    const assessmentsHere=assessments.get(table.topicId);
    if(assessmentsHere?.includes(table)){
      const text=assessmentsHere[0]===table?supplement(zh?"讨论中的方案评估":"Design assessments from the discussion",assessmentsHere.map(withSource).join("\n\n")):"";
      edits.push({start:table.start,end:table.end,text});
      continue;
    }
    const family = grouped.get(table.topicId);
    if (family && family.length > 1 && family.includes(table)) {
      originals.push(withSource(table));
      if(table!==family[0]){
        edits.push({start:table.start,end:table.end,text:""});
        continue;
      }
      const roadmap = zh ? searchRoadmap(family) : undefined;
      const lines = family.flatMap((item,index) => {
        if (roadmap?.compared.has(item)) return [];
        const scope = sameTopic(item.subject, item.scope) || (zh ? `讨论方案 ${index+1}` : `Proposal ${index+1}`);
        const row = (kind:string, detail:string)=>[scope,kind,detail,item.origin];
        const values = (cells:string[], except:number)=>cells.filter((_,column)=>column!==except).filter(Boolean).join(" · ");
        if(item.stage>=0) return [row(zh?"交付顺序":"Delivery order",item.rows.map(cells=>{
          const label=plain(cells[item.stage]);
          return `${/^v\d/iu.test(label)?label+" ":""}${values(cells,item.stage)}`;
        }).join(" → "))];
        if(item.priority>=0) {
          const priorities = [...new Set(item.rows.map(cells=>plain(cells[item.priority])))];
          return [row(zh?"优先级":"Priority",priorities.map(label=>`${label} ${item.rows.filter(cells=>plain(cells[item.priority])===label).map(cells=>values(cells,item.priority)).join(zh?"、":", ")}`).join(zh?"；":"; "))];
        }
        return [row(zh?"版本草案":"Release proposal",item.rows.map(cells=>values(cells,-1)).join(zh?"；":"; "))];
      });
      const sources = lines.some(row=>row[3]);
      const headers = zh ? ["讨论方案","类型","规划内容","原文"] : ["Proposal","Type","Planned work","Evidence"];
      const render = (row:string[])=>`| ${row.slice(0,sources?4:3).map(value=>tableValue(value|| (zh?"出处未定位":"Source unavailable"))).join(" | ")} |`;
      const intro = zh ? `以下是${table.topic?`「${table.topic}」`:"本节"}讨论过的规划。优先级表示各自方案中的取舍，交付顺序沿用各自的讨论版本。` : "These proposals cover different priorities and delivery sequences. Read each within its own scope.";
      const proposals = lines.length ? `${intro}\n\n${[render(headers),render(headers.map(()=>"---")),...lines.map(render)].join("\n")}` : "";
      edits.push({start:table.start,end:table.end,text:[proposals, roadmap?.text].filter(Boolean).join("\n\n")});
      continue;
    }
    const source = table.origin ? `\n\n${zh?"原文来源":"Original source"} ${table.origin}` : "";
    const intro = table.needsIntro ? tableIntroduction(table.header,table.scope,zh) : "";
    const row = (values:string[])=>`| ${values.join(" | ")} |`;
    const text = !table.rows.length ? "" : table.rows.length===1 && table.changed
      ? `${table.scope?`**${table.scope}** · `:""}${table.rows[0].map((value,column)=>emptyCell.test(plain(value))?"":`${table.header[column]}${zh?"为":" is "}${value}`).filter(Boolean).join(zh?"，":", ")}${zh?"。":"."}${table.origin?` ${table.origin}`:""}`
      : `${intro ? intro+"\n\n" : ""}${table.changed?[table.header,table.divider,...table.rows].map(row).join("\n"):table.table}${source}`;
    edits.push({start:table.start,end:table.end,text});
  }
  for (const edit of edits.sort((a,b)=>b.start-a.start)) {
    const before=body.slice(0,edit.start), after=body.slice(edit.end);
    body=edit.text ? before+edit.text+after
      : before.replace(/\n[\t \n]*$/u,"")+(before.trim()&&after.trim()?"\n\n":"")+after.replace(/^(?:[\t ]*\n)+/u,"");
  }
  const appendix=originals.length ? `\n\n${supplement(zh?"原始规划表":"Original planning tables",originals.join("\n\n"))}` : "";
  return body.trimEnd()+appendix;
}
