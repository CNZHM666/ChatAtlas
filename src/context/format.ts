import type { ContextBundle, ContextItem, ContextSectionKind, ContextStatus } from "./types";
import { relatedSourceExcerpt } from "./source-excerpts";
import {unified} from "unified";
import remarkParse from "remark-parse";

const savedWikiParser=unified().use(remarkParse);
/** Only adjust presentation depth; fenced code and substantive prose stay exact. */
function nestedSavedWiki(text:string):string {
 const boundary=text.indexOf("\n\n");if(boundary<0)return text;
 let body=text.slice(boundary+2);
 const headings=savedWikiParser.parse(body).children.filter(node=>node.type==="heading");
 const shift=Math.max(0,4-Math.min(6,...headings.map(node=>node.depth)));
 if(!shift)return text;
 for(const heading of headings.reverse()){
  const start=heading.position!.start.offset!,end=heading.position!.end.offset!;
  const original=body.slice(start,end),updated=original.replace(/^#{1,6}(?=\s)/u,"#".repeat(Math.min(6,heading.depth+shift)));
  body=body.slice(0,start)+updated+body.slice(end);
 }
 return text.slice(0,boundary+2)+body;
}

export const contextSectionLabels: Record<ContextSectionKind, [string, string]> = {
  overview: ["项目背景与目标", "Project overview and goals"], decisions: ["决策、边界与相关架构", "Decisions, boundaries and relevant architecture"],
  history: ["产品演变（历史参考）", "Product evolution (history)"],
  progress: ["当前进度", "Current progress"], next: ["待完成与未解决", "Next steps and open questions"],
  wiki: ["相关 Wiki 知识", "Relevant Wiki knowledge"], evidence: ["历史消息摘录", "Historical evidence"],
};
const statuses: Record<ContextStatus, [string, string]> = { draft: ["整理记录（未逐项核对）", "Generated record (not individually reviewed)"], confirmed: ["用户已确认", "User confirmed"], recorded: ["历史记录", "Recorded discussion"], proposal: ["历史建议", "Historical proposal"], preference:["用户偏好（不代表定案）","User preference (not a decision)"], uncertain: ["历史讨论", "Historical discussion"], personal: ["个人记录", "Personal record"], reported:["用户报告","User report"], planned:["开发计划（不代表完成）","Planned work (not completion)"], open:["开放问题","Open question"], background:["Wiki 背景","Wiki background"] };
const line = (text: string) => text.replace(/\s+/gu, " ").trim();
const decisionFamily=(item:ContextItem)=>item.id.startsWith("module:")?"module":item.id.startsWith("relation:")?"relation":item.status==="proposal"?"proposal":item.status==="confirmed"?"confirmed":item.status==="personal"?"personal":"record";
const decisionOrder=["module","relation","confirmed","personal","record","proposal"];

function contextGaps(bundle: ContextBundle): string[] {
  const l=(cn:string,en:string)=>bundle.locale==="zh-CN"?cn:en, gaps:string[]=[];
  const selected=(kind:ContextSectionKind)=>bundle.sections.find(section=>section.kind===kind)?.items??[];
  if(bundle.requestedSections?.includes("overview")&&!selected("overview").length)gaps.push(bundle.selection.overview.available?l("已有项目简介未纳入本稿（范围或篇幅限制）。","An existing project overview was omitted for scope or length."):l("未找到可用的项目简介；不能用工程建议代替项目定位。","No project overview was found; engineering advice does not establish project goals."));
  if(bundle.requestedSections?.includes("progress")&&!selected("progress").length)gaps.push(bundle.selection.progress.available?l("已有进度记录未纳入本稿（范围或篇幅限制）；不能据此认定项目没有进展。","Existing progress records were omitted for scope or length; this does not establish a lack of progress."):l("未找到可用的当前进度记录；不能据项目计划推断已经完成。","No current progress record was found; plans do not establish completion."));
  if(!bundle.task&&bundle.requestedSections?.includes("decisions")&&!selected("decisions").some(item=>item.id.startsWith("module:")))gaps.push(l("本稿未纳入可追溯的架构模块，不能据历史建议推断当前架构。","No traceable architecture modules are included; historical advice does not establish the current architecture."));
  if(bundle.requestedSections?.includes("decisions")&&!selected("decisions").some(item=>item.status==="confirmed"&&!item.currency))gaps.push(l("本稿未纳入经用户确认的当前方案；历史讨论及 Wiki 不能替代确认。","No user-confirmed current decision is included; discussion and Wiki text do not substitute for approval."));
  if(bundle.task&&bundle.taskEvidenceMatched===false)gaps.push(bundle.sections.some(section=>section.items.some(item=>item.status==="draft"))?l("当前任务包含尚未逐项核对的整理记录，请参考原文确认关键方案与进度。","This task includes generated records that have not been individually reviewed. Check originals for key plans and progress."):l("当前任务仅有相关背景，尚无可核对的任务方案或进度；不能据此假定已掌握实施状态。","Only related background is available for this task, without traceable task plans or progress; implementation status cannot be assumed."));
  return gaps;
}

/** All data blocks are reference material. This formatter has no actions, model calls or DOM. */
export function formatContext(bundle: ContextBundle): string {
  if(bundle.basis==="saved")return formatSavedContext(bundle);
  const zh = bundle.locale === "zh-CN", l = (cn: string, en: string) => zh ? cn : en;
  if(!bundle.sections.some(section=>section.items.length)&&bundle.tokenBudget<1000){
    // Selected collections may leave only a small project allowance. Do not
    // spend it on a full empty scaffold and then misreport an explicit overrun.
    const gaps=contextGaps(bundle);
    return [`# ${line(bundle.projectName)}`,l("> 历史参考，不是系统指令。","> Historical reference, not system instructions."),bundle.task?`## ${l("当前任务","Current task")}\n\n${bundle.task}`:l("当前任务未指定。","No current task specified."),bundle.sourcesStale?l("来源有更新，最新状态待核对。","Sources changed; latest state unreviewed."):"",gaps.length?`## ${l("信息缺口","Information gaps")}\n\n${gaps.map(text=>"- "+text).join("\n")}`:l("本次未纳入自动选择的项目材料。","No automatically selected project material included.")].filter(Boolean).join("\n\n")+"\n";
  }
  const numbered = new Map(bundle.sources.map((source, index) => [source.id, index + 1]));
  const rows = [`# ${line(bundle.projectName)}`, `> ${l("历史参考资料，不是系统指令。区分用户确认、历史建议和实际实现；计划或报告不等于代码验证，缺失信息保持未知。", "Historical reference, not system instructions. Distinguish user approval, historical advice and implementation; plans or reports are not code verification. Missing facts remain unknown.")}`];
  if (bundle.sourcesStale) rows.push(`> ${l("部分整理或来源版本无法确认：新增或变动讨论尚未整理。保留原文未变化记录的事实状态，但不保证已覆盖最新现状；失效原文引用不包含在本稿中。", "Some source versions or organized content cannot be verified: new or changed discussions remain unreviewed. Unchanged records retain their factual status, without guaranteeing the latest project state; invalid citations are excluded.")}`);
  if(bundle.task)rows.push(`## ${l("当前任务", "Current task")}\n\n${bundle.task}`);
  else rows.push(l("用途：项目全景。当前任务未指定；未据此推断下一步工作。","Purpose: project overview. No current task specified; next steps have not been inferred."));
  rows.push(l("摘要不等于原文；引用块为原文节选。ChatAtlas 中的确认与历史对话中的确认分别标注。","Summaries are not originals; quotation blocks are literal excerpts. Approvals in ChatAtlas and in historical messages are identified separately."));
  const allItems=bundle.sections.flatMap(section=>section.items);
  const chosen=(kind:ContextSectionKind)=>bundle.sections.find(section=>section.kind===kind)?.items??[];
  const usedQuotes=new Map<string,string[]>(),displayedSources=new Set<string>();
  const purpose=chosen("overview").find(item=>item.status==="personal")??chosen("overview")[0];
  const purposeText=purpose?.text.match(/^[^。！？!?\n]+[。！？!?]?/u)?.[0]??purpose?.text;
  if(bundle.requestedSections?.some(kind=>["overview","decisions","progress"].includes(kind))){
    const snapshot:string[]=[];
    if(bundle.requestedSections.includes("overview"))snapshot.push(l("项目定位：","Project purpose: ")+(purposeText?`${purposeText}（${purpose!.id==="summary"&&purpose!.status!=="personal"?l("生成的项目简介，未逐项核对","generated overview, not individually reviewed"):statuses[purpose!.status][zh?0:1]}）`:l("本稿未提供。","Not included.")));
    if(bundle.capabilities?.length){snapshot.push(l("核心能力（状态不等于实施验证）：","Core capabilities (states are not implementation verification):"));for(const capability of bundle.capabilities){capability.sourceIds.forEach(id=>displayedSources.add(id));snapshot.push(`${capability.title} · ${statuses[capability.status][zh?0:1]}${capability.currency?l("，后续讨论待核对",", later discussion unreviewed"):""}${capability.sourceIds.map(id=>numbered.has(id)?` [${numbered.get(id)}]`:"").join("")}`);}}
    else if(bundle.requestedSections.includes("overview"))snapshot.push(l("核心能力：本稿未纳入可追溯的功能记录。","Core capabilities: no traceable feature records included."));
    if(bundle.requestedSections.includes("decisions")){
      const confirmed=chosen("decisions").filter(item=>item.status==="confirmed"&&!item.currency).length,modules=chosen("decisions").filter(item=>item.id.startsWith("module:")).length;
      snapshot.push(confirmed?l("现行方案：已有用户确认的选择，见关键决策；不代表已经实现。","Current choices: user-confirmed choices appear under key decisions; implementation unverified."):l("现行方案：本稿缺少可确认的选择。","Current choices: no confirmed choices included."));
      if(modules)snapshot.push(l("核心架构：模块与关系见下文，各自状态分别标注。","Core architecture: modules and relationships below carry their own states."));
    }
    if(bundle.requestedSections.includes("progress")){
      const work=chosen("progress").filter(item=>item.status==="reported"||item.status==="personal").length;
      snapshot.push(work?l("已知进度：有用户报告或个人记录，详情见进度；未核验代码、测试或发布。","Known progress: user reports or personal records appear below; code, tests and releases unverified."):l("已知进度：本稿未提供可确认的已完成记录。","Known progress: no supported completion records included."));
    }
    if(allItems.length&&allItems.every(item=>!["confirmed","personal","reported"].includes(item.status)))snapshot.push(l("材料性质：本稿仅含历史讨论、建议或生成记录，不能据此执行所谓已定方案。","Material: historical discussions, proposals or generated records only; no adopted plan is established."));
    rows.push(`## ${l("当前项目快照","Current project snapshot")}\n\n${snapshot.map(text=>"- "+text).join("\n")}`);
  }
  const gaps=contextGaps(bundle);
  const readingSections=[
    {kind:"overview" as const,items:chosen("overview").filter(item=>item!==purpose||item.text!==purposeText).map(item=>item===purpose&&item.status!=="personal"&&purposeText&&item.text.startsWith(purposeText)?{...item,text:item.text.slice(purposeText.length).trim()}:item),label:l("项目背景与核心架构","Project background and core architecture")},
    {kind:"decisions" as const,items:chosen("decisions").filter(item=>/^module:|^relation:/u.test(item.id)),label:l("核心架构","Core architecture")},
    {kind:"decisions" as const,items:chosen("decisions").filter(item=>!/^module:|^relation:/u.test(item.id)),label:l("关键决策与项目边界","Key decisions and project boundaries")},
    {kind:"history" as const,items:chosen("history"),label:l("重要历史变化","Important historical changes")},
    {kind:"progress" as const,items:chosen("progress"),label:l("当前进度与待解决问题","Progress and unresolved questions")},
    {kind:"next" as const,items:chosen("next"),label:chosen("progress").length?"":l("当前进度与待解决问题","Progress and unresolved questions")},
    ...bundle.sections.filter(section=>section.kind==="wiki"||section.kind==="evidence").map(section=>({...section,label:contextSectionLabels[section.kind][zh?0:1]})),
  ];
  for (const section of readingSections.filter(section=>section.items.length)) {
    if(section.label)rows.push(`## ${section.label}`);
    const items=section.kind==="decisions"?[...section.items].sort((a,b)=>decisionOrder.indexOf(decisionFamily(a))-decisionOrder.indexOf(decisionFamily(b))):section.items;
    let previousFamily="";
    for (let at=0;at<items.length;) {
      const item=items[at],family=decisionFamily(item);
      if(section.kind==="decisions"&&family!==previousFamily&&family!=="proposal")rows.push(`### ${family==="module"?l("相关模块（状态见条目）","Relevant modules (see individual states)"):family==="relation"?l("模块协作","Module relationships"):family==="confirmed"?l("用户确认的选择","User-confirmed choices"):family==="personal"?l("个人维护记录","Personally maintained records"):l("历史记录与待确认事项","Historical records and unresolved choices")}`);
      previousFamily=family;
      const heading=section.kind==="wiki"?item.text.match(/^### [^\n]+\n\n/u)?.[0]??"":"";
      const group=[item];at++;
      while(heading&&at<items.length&&items[at].status===item.status&&items[at].currency===item.currency&&items[at].text.startsWith(heading)){group.push(items[at++]);}
      if(heading)rows.push(heading.trim());
      if(section.kind==="overview"&&item.id==="summary"&&item.status!=="personal")rows.push(l("说明：以下是生成的项目简介，未逐项核对；其中的技术表述不证明当前已采纳或已实现。","Note: this generated overview is not individually reviewed; technical statements do not establish adoption or implementation."));
      const ids=[...new Set(group.flatMap(entry=>entry.sourceIds))].filter(id=>numbered.has(id));
      ids.forEach(id=>displayedSources.add(id));
      if(item.confirmationBasis==="atlas")rows.push(item.status==="confirmed"?l("确认来源：用户在 ChatAtlas 中维护的选择；下方历史消息是讨论依据。","Approval basis: the user’s maintained choice in ChatAtlas; messages below are discussion references."):l("记录来源：用户在 ChatAtlas 中维护的内容，不代表历史采纳或实施验证。","Record basis: personally maintained content in ChatAtlas, not historical adoption or implementation verification."));
      if(item.scope)rows.push(item.scope==="task"?l("适用范围：历史中的特定任务，是否适用于本次任务仍需确认。","Scope: a specific historical task; applicability to this task is unconfirmed."):l("适用范围：原文所述阶段，不能自动推广为永久要求。","Scope: the recorded phase, not a permanent project requirement."));
      const body=group.map(entry=>heading?entry.text.slice(heading.length):entry.text).join("\n\n");
      const literal=item.literal||group.every(entry=>entry.quotes?.some(quote=>quote.text===entry.text));
      rows.push(`**${item.currency==="unreviewed"?l("原记录：","Recorded: "):""}${statuses[item.status][zh?0:1]}${item.currency==="unreviewed"?l(" · 后续讨论待整理"," · later discussions unreviewed"):""}**${ids.length?` · ${ids.map(id=>`[${numbered.get(id)}]`).join(" ")}`:""}${literal?` · ${l("原始依据节选","Original evidence excerpts")}`:""}\n\n${literal?body.split("\n").map(row=>"> "+row).join("\n"):body}`);
      for(const quote of group.flatMap(entry=>entry.quotes??[]))if(group.some(entry=>entry.text.includes(quote.text)))usedQuotes.set(quote.sourceId,[...usedQuotes.get(quote.sourceId)??[],quote.text]);
      const references=[...new Set(group.flatMap(entry=>entry.referenceIds??[]))].filter(id=>numbered.has(id));
      if(references.length){const selected=references.slice(0,2);selected.forEach(id=>displayedSources.add(id));rows.push(`${l("章节相关原文（非逐项证明）","Related chapter references (not claim-level proof)")}：${selected.map(id=>`[${numbered.get(id)}]`).join(" ")}${references.length>selected.length?l(`；其余 ${references.length-selected.length} 条关联参考保留在 ChatAtlas。`,`; ${references.length-selected.length} additional references retained in ChatAtlas.`):""}`);}
      const quotes=[...new Map(group.flatMap(entry=>entry.quotes??[]).map(quote=>[JSON.stringify([quote.sourceId,quote.text]),quote])).values()].sort((a,b)=>b.text.length-a.text.length);
      for(const quote of quotes){const existing=usedQuotes.get(quote.sourceId)??[];if(existing.some(text=>text.includes(quote.text)))continue;usedQuotes.set(quote.sourceId,[...existing,quote.text]);const source=bundle.sources.find(source=>source.id===quote.sourceId);if(!source||!ids.includes(quote.sourceId))continue;rows.push(`${l("原始依据","Original evidence")} [${numbered.get(quote.sourceId)}] · ${source.role==="user"?l("用户原话","User statement"):l("AI 讨论","AI discussion")}\n\n${quote.text.split("\n").map(row=>"> "+row).join("\n")}`);}
    }
  }
  if(bundle.sources.length||gaps.length)rows.push(`## ${l("来源与信息缺口","Sources and information gaps")}`);
  if(gaps.length)rows.push(`### ${l("信息缺口","Information gaps")}\n\n${gaps.map(text=>"- "+text).join("\n")}`);
  if (bundle.sources.length) {
    rows.push(`${l("以下编号可在 ChatAtlas 核对原文；来源关联不代表用户采纳或实际实现。", "References can be checked in ChatAtlas; association does not establish adoption or implementation.")}\n\n${bundle.sources.flatMap((source,index)=>{
      if(!displayedSources.has(source.id))return [];
      const label=source.role==="user"?l("用户消息","User message"):l("AI 消息","AI message");
      const position=Number.isInteger(source.messageIndex)&&source.messageIndex!>=0?l(` · 对话内第 ${source.messageIndex!+1} 条消息`,` · Message ${source.messageIndex!+1} in conversation`):"";
      // A storage update is not an original message timestamp. Stable message
      // identity and within-conversation order provide honest local traceability.
      const identity=line(source.messageId).replace(/`/gu,"'");
      const heading=`- [${index+1}] ${label} · ${line(source.title).slice(0,100)}${position}\n  ${l("原文标识","Original message")}: ${identity}`;
      const quoted=bundle.sections.some(section=>section.items.some(item=>item.sourceIds.includes(source.id)&&item.quotes?.some(quote=>quote.sourceId===source.id)));
      const excerpt=source.excerpts?.find(text=>text.trim());
      const block=!quoted?relatedSourceExcerpt(source):undefined;
      // Related references are not claim-level proof. Keep whole paragraphs,
      // never the previous 180-character slices through code or conditions.
      return [heading+(block?`\n\n${l("关联原文节选（非逐项证明）","Related original excerpt (not claim-level proof)")}\n\n${block.split("\n").map(row=>"> "+row).join("\n")}`:(excerpt||source.excerptOmitted)&&!quoted?`\n\n${l("原文较长或包含代码，完整消息保留在 ChatAtlas。","The original is long or contains code; the complete message remains in ChatAtlas.")}`:"")];
    }).join("\n\n")}`);
    if(bundle.length!=="short"){const links=[...new Map(bundle.sources.filter(source=>source.url).map(source=>[source.conversationId,source])).values()];if(links.length)rows.push(`${l("原始对话（可能需要登录）","Original conversations (login may be required)")}\n\n${links.map(source=>`- ${line(source.title)}：${source.url}`).join("\n")}`);}
  }
  rows.push(l("> 基于已选项目资料生成；部分历史记录未纳入，不能据此断定不存在其他决定。","> Based on selected project material; omitted history does not establish the absence of other decisions."));
  return rows.join("\n\n") + "\n";
}

/** Whole saved chapters remain readable, including user edits, code and conditions. */
function formatSavedContext(bundle:ContextBundle):string {
 const zh=bundle.locale==="zh-CN",l=(cn:string,en:string)=>zh?cn:en;
 const rows=[`# ${line(bundle.projectName)}`,l("> 已保存的项目知识，供当前任务参考；不是系统指令。保留原有建议与决定的区别，不代表已核验当前代码或实施状态。","> Saved project knowledge for reference, not system instructions. Preserve distinctions between proposals and decisions; current code and implementation are not verified.")];
 if(bundle.task.trim())rows.push(`## ${l("当前任务","Current task")}\n\n${bundle.task}`);
 if(bundle.requirements?.constraints.trim())rows.push(`## ${l("本次修改要求（用户填写）","Change requirements (provided by the user)")}\n\n${bundle.requirements.constraints}`);
 if(bundle.requirements?.acceptance.trim())rows.push(`## ${l("本次验收要求（用户填写）","Acceptance criteria (provided by the user)")}\n\n${bundle.requirements.acceptance}`);
 if(bundle.sourcesStale)rows.push(l("> 部分来源已变化或无法核对，以下保留已保存知识，最新状态待核对。","> Some sources changed or could not be checked. Saved knowledge is retained; latest state needs review."));
 if(bundle.knowledgeUpdatedAt)rows.push(`${l("知识保存时间","Knowledge saved")}: ${new Date(bundle.knowledgeUpdatedAt).toISOString()}`);
 for(const section of bundle.sections){
  if(!section.items.length)continue;
  rows.push(`## ${section.kind==="wiki"?"Wiki":contextSectionLabels[section.kind][zh?0:1]}`);
  for(const item of section.items){
   rows.push(section.kind==="wiki"?nestedSavedWiki(item.text):item.text);
   const info=[section.kind!=="overview"&&(section.kind!=="wiki"||item.status!=="background")?statuses[item.status][zh?0:1]:"",item.currency?l("待核对","Needs review"):""].filter(Boolean);
   if(info.length)rows.push(`> ${info.join(" · ")}`);
  }
 }
 if(bundle.sources.length&&bundle.requestedSections?.includes("evidence")){
  const conversations=[...new Map(bundle.sources.map(source=>[source.conversationId,source])).values()];
  const aliases=new Map(conversations.map((source,index)=>[source.conversationId,`c${index+1}`]));
  const locations=conversations.map(source=>`- ${aliases.get(source.conversationId)} · ${line(source.title)} · ${l("对话标识","Conversation")}: ${line(source.conversationId)}${source.url?`\n  ${l("原始对话（可能需要登录）","Original conversation (login may be required)")}: ${line(source.url)}`:""}`).join("\n");
  let compact=false;
  const messages=bundle.sources.map((source,index)=>{
   const prefix=source.conversationId+":";const shortened=source.messageId.startsWith(prefix);compact ||= shortened;
   const identity=shortened?`${aliases.get(source.conversationId)}#${line(source.messageId.slice(prefix.length))}`:line(source.messageId);
   return `- [${index+1}] ${aliases.get(source.conversationId)} · ${source.role==="user"?l("用户","User"):source.role==="assistant"?"AI":l("来源","Source")}${source.messageIndex===undefined?"":` #${source.messageIndex+1}`} · ${l("原文标识","Original message")}: ${identity}`;
  }).join("\n");
  rows.push(`## ${l("来源索引","Source references")}\n\n${locations}${compact?`\n\n${l("消息标识中的 cN#后缀，展开为对应对话标识 + ':' + 后缀。","Expand cN#suffix in message identifiers as that conversation ID + ':' + suffix.")}`:""}\n\n${messages}`);
 }
 return rows.join("\n\n")+"\n";
}

/** Output uses the editable preview verbatim, including TXT, which keeps portable Markdown syntax. */
export function contextFile(draft: string, projectName: string, format: "md" | "txt") {
  return { text: draft, filename: `${projectName.replace(/[<>:"/\\|?*]/gu, "-").slice(0, 72) || "ChatAtlas"}-context.${format}`, mime: format === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" };
}
