import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceSourcePanel } from "./WorkspaceSourcePanel";
import { narrowQuote } from "../narrow-quote";
import { readSessionSource } from "../../storage/source-versions";
import { projectSession } from "../../test/project-fixture";
import type { ConversationMessage } from "../../shared/types";
import type { FocusEvidence } from "../../shared/focus-session";
import {markEvidenceRead} from "../../storage/evidence-reading";
vi.mock("../../storage/source-versions", () => ({readSessionSource:vi.fn()}));
vi.mock("../../storage/evidence-reading",async importOriginal=>({...await importOriginal<typeof import("../../storage/evidence-reading")>(),evidenceWasRead:vi.fn().mockResolvedValue(false),markEvidenceRead:vi.fn().mockResolvedValue(undefined),markEvidenceReadBatch:vi.fn().mockResolvedValue(undefined)}));
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();vi.unstubAllGlobals();});
const original:ConversationMessage = {id:"message",conversationId:"source",role:"user",content:"首版支持预览。后续再考虑实物控制。",messageIndex:2,createdAt:1_700_000_000_000,updatedAt:1_800_000_000_000,contentHash:"",preview:""};

it.each([
 {content:'原来是：\n\n> **AI帮你设计硬件。**\n\n现在可以变成：\n\n> **从“我想做什么”，一直陪你到“我真的把它做出来”。**',quote:'一直陪你到“我真的把它做出来”',claim:'一直陪你到“我真的把它做出来”',selector:'blockquote strong',wanted:'一直陪你到“我真的把它做出来”',approximate:false},
 {content:'本轮最高优先级约束：\n\n```text\n本轮修改优先级：\n\n1. Beginner Journey 是否自然\n2. Welcome / Discovery / Solution Draft 是否足够简单\n3. 是否复用现有底层系统\n4. 是否保持当前 Workspace 稳定\n5. 最后才是视觉装饰\n\n永远选择更简单。\n```',quote:'Beginner Journey 自然度 > 界面简单性 > 复用底层系统 > 保持 Workspace 稳定 > 视觉装饰。',claim:'Beginner Journey 自然度 > 界面简单性 > 复用底层系统 > 保持 Workspace 稳定 > 视觉装饰。',selector:'pre code',wanted:'5. 最后才是视觉装饰',approximate:true},
 {content:'完整路线：\n\n```text\n想法\n↓\n设计\n↓\n校验\n↓\n已有零件\n↓\n缺少零件\n↓\n比价购买\n↓\n接线\n↓\n代码\n```',quote:'设计、校验、缺少零件识别、比价购买及接线代码。',claim:'完整的核心链路从想法开始，涵盖设计、校验、缺少零件识别、比价购买及接线代码。',selector:'pre code',wanted:'接线\n↓\n代码',approximate:true},
])("locates card/code evidence in the real source panel: $selector $wanted",async({content,quote,claim,selector,wanted,approximate})=>{
 const session=projectSession();session.projectState=undefined;
 const reference={...session.evidence[0],excerpt:content,sourceSignature:undefined};session.evidence=[reference];
 vi.mocked(readSessionSource).mockResolvedValue([{...original,role:'assistant',content}]);
 const marks=new Map<string,Set<Range>>();vi.stubGlobal('CSS',{...globalThis.CSS,highlights:marks});vi.stubGlobal('Highlight',class extends Set<Range>{constructor(...ranges:Range[]){super(ranges);}});
 const {container}=render(<WorkspaceSourcePanel session={session} reference={reference} quote={quote} claim={claim} zh onSelect={vi.fn()} onClose={vi.fn()}/>);
 await waitFor(()=>expect(marks.get('atlas-original-proof')?.size).toBeGreaterThan(0));
 const ranges=[...marks.get('atlas-original-proof')!];
 expect(ranges.map(range=>range.toString()).join('|')).toContain(wanted);
 expect(ranges.some(range=>range.startContainer.parentElement?.closest(selector))).toBe(true);
 expect(Boolean(screen.queryByText('按措辞找到的相近原文，请核对对应关系'))).toBe(approximate);
 expect(container.querySelector('pre svg, iframe')).toBeNull();
});

it("rejects a color quote for a static-animation claim and finds its short source sentences further down", async () => {
  const session = projectSession();
  const content = "## Edge 设计\n\n连接线：\n\n默认中性灰。\n\n选中：\n\n强调色。\n\nError：\n\n红色。\n\n不要大量动画。\n\nV0.1：\n\n保持静态。";
  const reference = { ...session.evidence[0], excerpt: content };
  vi.mocked(readSessionSource).mockResolvedValue([{ ...original, content }]);
  const marks = new Map<string, Set<Range>>();
  vi.stubGlobal("CSS", { ...globalThis.CSS, highlights: marks });
  vi.stubGlobal("Highlight", class extends Set<Range> { constructor(...ranges: Range[]) { super(ranges); } });
  render(<WorkspaceSourcePanel session={session} reference={reference} quote="默认中性灰。" claim="V0.1 保持静态，不大量动画。" zh onSelect={vi.fn()} onClose={vi.fn()} />);
  await waitFor(() => expect(marks.get("atlas-original-proof")?.size).toBeGreaterThan(0));
  const highlighted = [...marks.get("atlas-original-proof")!].map(range => range.toString()).join("|");
  expect(highlighted).toContain("保持静态");
  expect(highlighted).toContain("不要大量动画");
  expect(highlighted).not.toContain("默认中性灰");
  expect(screen.getByText("按措辞找到的相近原文，请核对对应关系")).toBeVisible();
});

it("rebuilds code evidence ranges when lazy formatting replaces the original text nodes",async()=>{
 const session=projectSession();session.projectState=undefined;
 const content='```text\n1. Beginner Journey 自然\n2. 保持 Workspace 稳定\n```';
 const reference={...session.evidence[0],excerpt:content,sourceSignature:undefined};session.evidence=[reference];
 vi.mocked(readSessionSource).mockResolvedValue([{...original,role:'assistant',content}]);
 const marks=new Map<string,Set<Range>>();vi.stubGlobal('CSS',{...globalThis.CSS,highlights:marks});vi.stubGlobal('Highlight',class extends Set<Range>{constructor(...ranges:Range[]){super(ranges);}});
 const {container}=render(<WorkspaceSourcePanel session={session} reference={reference} quote='Beginner Journey 自然' claim='Beginner Journey 自然' zh onSelect={vi.fn()} onClose={vi.fn()}/>);
 await waitFor(()=>expect(marks.get('atlas-original-proof')?.size).toBeGreaterThan(0));
 const previous=marks.get('atlas-original-proof');
 await act(async()=>{container.querySelector('pre code')!.innerHTML='<span>1. Beginner Journey 自然</span>\n2. 保持 Workspace 稳定\n';});
 // Formatting may commit more than once; the final range must reference the
 // current nodes, not merely be a different Highlight object.
 await waitFor(()=>{
  expect(marks.get('atlas-original-proof')).not.toBe(previous);
  const ranges=[...marks.get('atlas-original-proof')!];
  expect(ranges[0].toString()).toBe('Beginner Journey 自然');
  expect(ranges[0].startContainer.isConnected).toBe(true);
 });
});

const thresholdSource='如果：\n\n**5～8个人**\n\n主动继续玩，我认为值得继续开发。\n\n如果：\n\n**10个人以上**\n\n明显愿意做自己的硬件项目：\n\n那你就应该非常认真地做下去。';
it.each(['明显愿意做自己的硬件项目：','**10个人以上**','若10人以上明显愿意做项目。',undefined,thresholdSource])('highlights the threshold and predicate even when the saved quote is incomplete: %s',async quote=>{
 const session=projectSession();session.projectState=undefined;
 const reference={...session.evidence[0],excerpt:thresholdSource,sourceSignature:undefined};session.evidence=[reference];
 vi.mocked(readSessionSource).mockResolvedValue([{...original,role:'assistant',content:thresholdSource}]);
 const marks=new Map<string,Set<Range>>();vi.stubGlobal('CSS',{...globalThis.CSS,highlights:marks});vi.stubGlobal('Highlight',class extends Set<Range>{constructor(...ranges:Range[]){super(ranges);}});
 render(<WorkspaceSourcePanel session={session} reference={reference} quote={quote} claim='若 10 人以上明显愿意做项目。' zh onSelect={vi.fn()} onClose={vi.fn()}/>);
 await waitFor(()=>{
  const marked=[...marks.get('atlas-original-proof')??[]].map(range=>range.toString()).join('|');
  expect(marked).toContain('10个人以上');expect(marked).toContain('明显愿意做自己的硬件项目');
  expect(marked).not.toContain('5～8个人');
 });
});

it.each(['20个人以上','10个人以下'])('explains the missing complete condition instead of painting an incompatible source: %s',async label=>{
 const session=projectSession();session.projectState=undefined;
 const content=thresholdSource.replace('10个人以上',label);
 const reference={...session.evidence[0],excerpt:content,sourceSignature:undefined};session.evidence=[reference];
 vi.mocked(readSessionSource).mockResolvedValue([{...original,role:'assistant',content}]);
 const marks=new Map<string,Set<Range>>();vi.stubGlobal('CSS',{...globalThis.CSS,highlights:marks});vi.stubGlobal('Highlight',class extends Set<Range>{constructor(...ranges:Range[]){super(ranges);}});
 render(<WorkspaceSourcePanel session={session} reference={reference} quote='明显愿意做自己的硬件项目：' claim='若 10 人以上明显愿意做项目。' zh onSelect={vi.fn()} onClose={vi.fn()}/>);
 expect(await screen.findByText('未找到同时对应数字条件和描述的原文，请结合上下文核对。')).toBeVisible();
 expect(marks.has('atlas-original-proof')).toBe(false);
});

it("rejects an unrelated saved quote when the actual claim is spread across a code list",async()=>{
 const session=projectSession();session.projectState=undefined;
 const content='默认中性灰。\n\n```text\n1. Beginner Journey 是否自然\n2. 界面是否简单\n3. 复用底层系统\n4. 保持 Workspace 稳定\n5. 最后才是视觉装饰\n```';
 const reference={...session.evidence[0],excerpt:content,sourceSignature:undefined};session.evidence=[reference];
 vi.mocked(readSessionSource).mockResolvedValue([{...original,role:'assistant',content}]);
 const marks=new Map<string,Set<Range>>();vi.stubGlobal('CSS',{...globalThis.CSS,highlights:marks});vi.stubGlobal('Highlight',class extends Set<Range>{constructor(...ranges:Range[]){super(ranges);}});
 render(<WorkspaceSourcePanel session={session} reference={reference} quote='默认中性灰。' claim='Beginner Journey 自然度 > 界面简单性 > 复用底层系统 > 保持 Workspace 稳定 > 视觉装饰。' zh onSelect={vi.fn()} onClose={vi.fn()}/>);
 await waitFor(()=>expect(marks.get('atlas-original-proof')?.size).toBeGreaterThan(0));
 const marked=[...marks.get('atlas-original-proof')!].map(range=>range.toString()).join('|');
 expect(marked).toContain('Beginner Journey 是否自然');expect(marked).toContain('5. 最后才是视觉装饰');expect(marked).not.toContain('默认中性灰');
});

it("keeps the same claim on its second source and never borrows another claim on a missing quote",async()=>{
 const session=projectSession(),first={...session.evidence[0],excerpt:"共同引文。"},second={...first,id:"second",messageId:"reply",excerpt:"第二条来源。共同引文。其他结论。"};
 session.evidence=[first,second];session.projectState=undefined;session.sections[0].evidenceIds=[first.id,second.id];session.sections[0].claims=[{text:"当前结论",quote:"共同引文。",evidenceIds:[first.id,second.id]},{text:"别的结论",quote:"其他结论。",evidenceIds:[second.id]}];
 vi.mocked(readSessionSource).mockResolvedValue([{...original,content:first.excerpt},{...original,id:"reply",role:"assistant",content:second.excerpt,messageIndex:3}]);
 const marks=new Map<string,Set<Range>>();vi.stubGlobal("CSS",{...globalThis.CSS,highlights:marks});vi.stubGlobal("Highlight",class extends Set<Range>{constructor(...ranges:Range[]){super(ranges);}});
 const props={session,references:[first,second],sectionId:session.sections[0].id,quote:"共同引文。",claim:"当前结论",zh:true,onSelect:vi.fn(),onClose:vi.fn()};
 const view=render(<WorkspaceSourcePanel {...props} reference={first}/>);
 await waitFor(()=>expect(marks.has("atlas-original-proof")).toBe(true));
 view.rerender(<WorkspaceSourcePanel {...props} reference={second}/>);
 await waitFor(()=>expect([...marks.get("atlas-original-proof")!].map(range=>range.toString())).toEqual(["共同引文。"]));
 view.rerender(<WorkspaceSourcePanel {...props} quote="不存在的引文" reference={second}/>);
 expect(await screen.findByText("该来源中未定位到此结论的引文")).toBeVisible();expect(marks.has("atlas-original-proof")).toBe(false);
});
it("marks every quote of the claims citing an original and displays local role warnings, without listing the claims",async()=>{
 const session=projectSession(),ref=session.evidence[0],content="用户可选择本地存储。建议下阶段加入同步。";
 session.projectState=undefined;session.sections[0].evidenceIds=[ref.id];session.sections[0].claims=[{text:"用户确认本地存储",quote:"用户可选择本地存储。",evidenceIds:[ref.id]},{text:"同步已完成",quote:"建议下阶段加入同步。",evidenceIds:[ref.id]}];
 vi.mocked(readSessionSource).mockResolvedValue([{...original,role:"assistant",content}]);
 const marks=new Map<string,Set<Range>>();vi.stubGlobal("CSS",{...globalThis.CSS,highlights:marks});vi.stubGlobal("Highlight",class extends Set<Range>{constructor(...ranges:Range[]){super(ranges);}});
 render(<WorkspaceSourcePanel session={session} reference={ref} references={[ref]} sectionId={session.sections[0].id} zh onSelect={vi.fn()} onClose={vi.fn()}/>);
 expect(await screen.findByText(/引文来自助手消息/)).toBeVisible();expect(screen.getByText(/依据是计划或建议/)).toBeVisible();
 // Every quote of the claims citing this original is marked; the claims are highlighted in the document, not listed here.
 await waitFor(()=>expect(marks.get("atlas-original-proof")?.size).toBe(2));
 expect(screen.queryByRole("button",{name:"1. 用户确认本地存储"})).toBeNull();
});
it("labels lexical reading hints and registers them separately from claim quotations",async()=>{
 const session=projectSession(),ref=session.evidence[0];session.sections[0].title="Hardware IR 模块连接";session.sections[0].evidenceIds=[ref.id];session.sections[0].claims=[];session.projectState=undefined;
 vi.mocked(readSessionSource).mockResolvedValue([{...original,role:"assistant",content:"Hardware IR 定义模块连接。"}]);
 const marks=new Map<string,Set<Range>>();vi.stubGlobal("CSS",{...globalThis.CSS,highlights:marks});vi.stubGlobal("Highlight",class extends Set<Range>{constructor(...ranges:Range[]){super(ranges);}});
 render(<WorkspaceSourcePanel session={session} reference={{...ref,excerpt:"Hardware IR 定义模块连接。"}} references={[ref]} sectionId={session.sections[0].id} zh onSelect={vi.fn()} onClose={vi.fn()}/>);
 expect(await screen.findByText("相关段落（未核对）")).toBeVisible();await waitFor(()=>expect(marks.has("atlas-original-related")).toBe(true));expect(marks.has("atlas-original-proof")).toBe(false);
});

it("keeps a selected quotation precise even with multiple aliases and claims on the same reply",async()=>{
 const session=projectSession(),ref=session.evidence[0],other={...ref,id:"other-excerpt"};
 const content="先介绍产品。Hardware IR 统一数据。API 密钥由用户配置。";
 const reply={...original,role:"assistant" as const,content};
 session.evidence=[{...ref,excerpt:content},other];session.projectState=undefined;
 session.sections[0].evidenceIds=[ref.id,other.id];session.sections[0].claims=[{text:"统一数据",quote:"Hardware IR 统一数据。",evidenceIds:[ref.id]},{text:"API 密钥",quote:"API 密钥由用户配置。",evidenceIds:[other.id]}];
 vi.mocked(readSessionSource).mockResolvedValue([reply]);
 const marks=new Map<string,Set<Range>>();vi.stubGlobal("CSS",{...globalThis.CSS,highlights:marks});
 vi.stubGlobal("Highlight",class extends Set<Range>{constructor(...ranges:Range[]){super(ranges);}});
 render(<WorkspaceSourcePanel session={session} reference={session.evidence[0]} references={session.evidence} sectionId={session.sections[0].id} quote="Hardware IR 统一数据。" claim="统一数据" zh onSelect={vi.fn()} onClose={vi.fn()}/>);
 await waitFor(()=>expect(marks.has("atlas-original-proof")).toBe(true));
 expect([...marks.get("atlas-original-proof")!].map(range=>range.toString())).toEqual(["Hardware IR 统一数据。"]);
});
it("reads retained sources selected by their original evidence actions without an extra source dropdown",async()=>{
  const session=projectSession(),ref={...session.evidence[0],excerpt:"首版支持预览。",sourceVersionId:"retained-original"},second={...ref,id:"second",messageId:"reply",excerpt:"实物控制是后续计划。"};
  const reply={...original,id:"reply",role:"assistant" as const,content:second.excerpt,messageIndex:3};
  vi.mocked(readSessionSource).mockResolvedValue([original,reply]);const onReader=vi.fn(),onClose=vi.fn();
  function Harness(){const[selected,setSelected]=useState<FocusEvidence>(ref);return <div className="focus-workspace"><div className="project-reading-base"><article data-testid="article">仍在阅读的 Wiki<button onClick={()=>setSelected(second)}>核对另一条依据</button></article></div><WorkspaceSourcePanel session={session} reference={selected} references={[ref,second]} quote={selected.excerpt} claim="首版预览范围" conversationTitle="原始对话标题" zh onSelect={setSelected} onClose={onClose} onReader={onReader}/></div>;}
  render(<Harness/>);const article=screen.getByTestId("article");article.scrollTop=140;
  await waitFor(()=>expect(document.querySelector(".workspace-source-message.is-source-target")).toBeTruthy());
  expect(readSessionSource).toHaveBeenCalledWith(session,"source","message","retained-original");
  const panel=screen.getByRole("dialog",{name:"原文依据"});
  // No title repeats the question: the highlighted message below is the original.
  expect(within(panel).queryByRole("heading",{name:original.content})).toBeNull();
  expect(within(panel).getByText("用户")).toBeVisible();expect(panel.querySelector("time")?.dateTime).toBe(new Date(original.createdAt!).toISOString());
  expect(screen.getByText(reply.content)).toBeVisible();
  // With Reader at hand, one way to the conversation around it: no in-panel toggle beside it.
  expect(within(panel).queryByRole("button",{name:"上下文"})).toBeNull();
  expect(within(panel).queryByRole("combobox",{name:"切换来源"})).not.toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"核对另一条依据"}));await waitFor(()=>expect(panel.querySelector('[data-message-id="reply"]')).toHaveClass("is-source-target"));
  expect(readSessionSource).toHaveBeenCalledOnce();expect(within(panel).queryByRole("status")).toBeNull();
  expect(screen.getByTestId("article")).toBe(article);expect(article.scrollTop).toBe(140);
  fireEvent.click(within(panel).getByRole("button",{name:"查看前后文"}));expect(onReader).toHaveBeenCalledOnce();fireEvent.keyDown(panel,{key:"Escape"});expect(onClose).toHaveBeenCalledOnce();
});
it("labels unavailable excerpts honestly and never invents a message, role or date",async()=>{
  vi.mocked(readSessionSource).mockResolvedValue([]);const session=projectSession(),ref=session.evidence[0];
  const {container}=render(<div className="focus-workspace"><WorkspaceSourcePanel session={session} reference={ref} zh onSelect={vi.fn()} onClose={vi.fn()} onReader={vi.fn()}/></div>);
  expect(await screen.findByText("来源待定位")).toBeVisible();expect(screen.getByText(/仅为已保存的历史摘录/)).toBeVisible();expect(container.querySelector("time")).toBeNull();
  expect(screen.queryByText("用户")).toBeNull();expect(screen.getByRole("button",{name:"查看前后文"})).toBeDisabled();
});
it("does not present an unmatched quote as valid proof",async()=>{
  vi.mocked(readSessionSource).mockResolvedValue([original]);const session=projectSession();
  render(<div className="focus-workspace"><WorkspaceSourcePanel session={session} reference={{...session.evidence[0],excerpt:"不存在的发布结论"}} zh onSelect={vi.fn()} onClose={vi.fn()} onReader={vi.fn()}/></div>);
  expect(await screen.findByText(/未匹配到该引用片段/)).toBeVisible();expect(document.querySelector(".workspace-source-message.is-source-target")).toBeTruthy();
  expect(screen.queryByRole("button",{name:/原文已看过/})).toBeNull();
});

it("asks one question on a point to confirm, moves on when answered, and records it seen without a button of its own",async()=>{
 const session=projectSession(),before=JSON.stringify(session);vi.mocked(readSessionSource).mockResolvedValue([original]);
 const reference={...session.evidence[0],excerpt:"首版支持预览。"};
 const point=(key:string,extra:object)=>({key,claim:"首版支持预览",quote:"首版支持预览。",source:"aiProposal" as const,reference,references:[reference],placed:true,...extra});
 const points=[point("a",{holder:"ai",attention:{kind:"settled" as const}}),point("b",{holder:"open"})],onHolder=vi.fn(),onPoint=vi.fn();
 const view=render(<WorkspaceSourcePanel session={session} reference={reference} zh onSelect={vi.fn()} onClose={vi.fn()} embedded returnLabel="返回上下文" points={points} pointIndex={0} onPoint={onPoint} onHolder={onHolder}/>);
 await waitFor(()=>expect(document.querySelector(".workspace-source-message.is-source-target")).toBeTruthy());
 expect(screen.queryByRole("button",{name:/原文已看过/})).toBeNull();expect(screen.getByText("待确认 1 / 2")).toBeVisible();
 // One question with two answers; the question says what is wrong, so no kind chip or flag banner above it.
 expect(screen.getByText("这句是你的决定吗？")).toBeVisible();expect(screen.queryByText("AI 建议")).toBeNull();expect(document.querySelector(".workspace-source-attention")).toBeNull();
 expect(screen.getAllByRole("button",{name:/^(是|不是)$/u})).toHaveLength(2);
 fireEvent.click(screen.getByRole("button",{name:"是"}));
 expect(onHolder).toHaveBeenCalledWith(points[0],"decided");expect(onPoint).toHaveBeenCalledWith(1);
 expect(markEvidenceRead).toHaveBeenLastCalledWith(expect.objectContaining({projectId:session.id,messageId:original.id}),true);
 expect(JSON.stringify(session)).toBe(before);
 view.unmount();
});

it("asks whether a flagged sentence says what the original says, and keeps its status when it does",async()=>{
 const session=projectSession();vi.mocked(readSessionSource).mockResolvedValue([original]);
 const reference={...session.evidence[0],excerpt:"首版支持预览。"},onHolder=vi.fn();
 const points=[{key:"a",claim:"首版支持预览",quote:"首版支持预览。",source:"aiProposal" as const,reference,references:[reference],placed:true,holder:"user" as const,attention:{kind:"negation" as const}},{key:"b",claim:"其他",quote:"首版支持预览。",source:"aiProposal" as const,reference,references:[reference],placed:true,holder:"open" as const}];
 render(<WorkspaceSourcePanel session={session} reference={reference} zh onSelect={vi.fn()} onClose={vi.fn()} embedded returnLabel="返回上下文" points={points} pointIndex={0} onPoint={vi.fn()} onHolder={onHolder}/>);
 await waitFor(()=>expect(document.querySelector(".workspace-source-message.is-source-target")).toBeTruthy());
 expect(screen.getByText("这句和原话意思一致吗？")).toBeVisible();expect(screen.getByText("原话里有否定，结论里没有")).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"一致"}));expect(onHolder).toHaveBeenCalledWith(points[0],"user");
});

it("offers the question behind a link on a point that needs no answer",async()=>{
 const session=projectSession();vi.mocked(readSessionSource).mockResolvedValue([original]);
 const reference={...session.evidence[0],excerpt:"首版支持预览。"},onHolder=vi.fn();
 const points=[{key:"a",claim:"首版支持预览",quote:"首版支持预览。",source:"aiProposal" as const,reference,references:[reference],placed:true,holder:"ai" as const}];
 render(<WorkspaceSourcePanel session={session} reference={reference} zh onSelect={vi.fn()} onClose={vi.fn()} embedded returnLabel="返回上下文" points={points} pointIndex={0} onPoint={vi.fn()} onHolder={onHolder}/>);
 await waitFor(()=>expect(document.querySelector(".workspace-source-message.is-source-target")).toBeTruthy());
 expect(screen.queryByText("这句是你的决定吗？")).toBeNull();expect(screen.getByText("状态：").textContent).toContain("AI 建议");
 // The link asks the same two-answer question again, the two other statuses beside it; no 4-button status box.
 fireEvent.click(screen.getByRole("button",{name:"改"}));expect(screen.getByText("这句和原话意思一致吗？")).toBeTruthy();expect(screen.queryByText("这句的状态")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"不一致"}));expect(onHolder).toHaveBeenCalledWith(points[0],"open");
});

it("shows an answered point as recorded, without the flag banner or kind chip coming back",async()=>{
 const session=projectSession();vi.mocked(readSessionSource).mockResolvedValue([original]);
 const reference={...session.evidence[0],excerpt:"首版支持预览。"};
 const points=[{key:"a",claim:"首版支持预览",quote:"首版支持预览。",source:"aiProposal" as const,label:"AI 建议",reference,references:[reference],placed:false,holder:"decided" as const,checked:true,attention:{kind:"settled" as const}}];
 render(<WorkspaceSourcePanel session={session} reference={reference} zh onSelect={vi.fn()} onClose={vi.fn()} embedded returnLabel="返回上下文" points={points} pointIndex={0} onPoint={vi.fn()} onHolder={vi.fn()}/>);
 await waitFor(()=>expect(document.querySelector(".workspace-source-message.is-source-target")).toBeTruthy());
 expect(screen.getByText("已记录：").textContent).toContain("已定");
 expect(document.querySelector(".workspace-source-kind")).toBeNull();expect(document.querySelector(".workspace-source-attention")).toBeNull();expect(document.querySelector(".workspace-source-origin")).toBeNull();
});

it("deduplicates citation aliases per message version and limits navigation to this chapter",async()=>{
 const session=projectSession(),ref=session.evidence[0],second={...ref,id:"next",messageId:"next-message",excerpt:"另一个问题。"},foreign={...ref,id:"other-chapter",messageId:"foreign"};
 session.evidence=[ref,{...ref,id:"another-excerpt",excerpt:"后续"},second,foreign];
 session.sections[0].evidenceIds=[ref.id,"another-excerpt",second.id];
 vi.mocked(readSessionSource).mockResolvedValue([original,{...original,id:second.messageId,content:second.excerpt,messageIndex:4}]);
 const select=vi.fn();render(<WorkspaceSourcePanel session={session} reference={ref} references={session.evidence} sectionId={session.sections[0].id} zh onSelect={select} onClose={vi.fn()}/>);
 await waitFor(()=>expect(document.querySelector(".workspace-source-message.is-source-target")).toBeTruthy());expect(screen.getByText("原文 1 / 2")).toBeVisible();fireEvent.click(screen.getByRole("button",{name:"下一条依据"}));expect(select).toHaveBeenCalledWith(second);
});

it("preserves committed content during a different conversation read, and reuses it on return",async()=>{
 const session=projectSession(),ref=session.evidence[0],other={...ref,id:"other",conversationId:"other-conversation",messageId:"other-message",excerpt:"另一个对话的原文。"};
 let resolve!:(value:ConversationMessage[])=>void;
 vi.mocked(readSessionSource).mockResolvedValueOnce([original]).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 const view=render(<WorkspaceSourcePanel session={session} reference={ref} zh onSelect={vi.fn()} onClose={vi.fn()}/>);
 await waitFor(()=>expect(document.querySelector(".workspace-source-message.is-source-target")).toBeTruthy());const content=screen.getByText(original.content,{selector:".source-message-content p"});
 view.rerender(<WorkspaceSourcePanel session={session} reference={other} zh onSelect={vi.fn()} onClose={vi.fn()}/>);
 expect(screen.getByText(original.content,{selector:".source-message-content p"})).toBe(content);expect(screen.getByText("正在切换原文…")).toBeVisible();
 await act(async()=>resolve([{...original,id:other.messageId,conversationId:other.conversationId,content:other.excerpt}]));
 expect(screen.getByText(other.excerpt,{selector:".source-message-content p"})).toBeVisible();
 view.rerender(<WorkspaceSourcePanel session={session} reference={ref} zh onSelect={vi.fn()} onClose={vi.fn()}/>);
 await waitFor(()=>expect(document.querySelector(".workspace-source-message.is-source-target")).toBeTruthy());expect(readSessionSource).toHaveBeenCalledTimes(2);
});

it("stops automatic positioning as soon as the user scrolls, even while layout is settling",async()=>{
 const callbacks:ResizeObserverCallback[]=[];
 vi.stubGlobal("ResizeObserver",class {constructor(callback:ResizeObserverCallback){callbacks.push(callback);}observe(){}disconnect(){}unobserve(){}});
 vi.spyOn(Element.prototype,"getBoundingClientRect").mockImplementation(()=>({top:100,left:0,width:400,height:150,bottom:250,right:400,x:0,y:100,toJSON:()=>({})}));
 vi.mocked(readSessionSource).mockResolvedValue([original]);
 const {container}=render(<WorkspaceSourcePanel session={projectSession()} reference={projectSession().evidence[0]} zh onSelect={vi.fn()} onClose={vi.fn()}/>);
 await waitFor(()=>expect(document.querySelector(".workspace-source-message.is-source-target")).toBeTruthy());const host=container.querySelector<HTMLElement>(".workspace-source-body")!;
 host.scrollTop=500;fireEvent.wheel(host);act(()=>callbacks.forEach(callback=>callback([],{} as ResizeObserver)));
 expect(host.scrollTop).toBe(500);
});
it("steps through checkable points with who said each one, without chapter-wide claim lists",async()=>{
 const session=projectSession(),proposal={...session.evidence[0],id:"ai",messageId:"ai",excerpt:"可以先做静态导出。"},approval={...session.evidence[0],id:"user",messageId:"message",excerpt:original.content};
 session.evidence=[proposal,approval];session.projectState=undefined;
 vi.mocked(readSessionSource).mockResolvedValue([{...original,id:"ai",role:"assistant",content:proposal.excerpt,messageIndex:1},original]);
 const points=[
  {key:"s:0",claim:"先做静态导出",quote:approval.excerpt,source:"decision" as const,label:"用户决定",reference:approval,references:[proposal,approval],placed:true},
  {key:"s:1",claim:"没有位置的结论",source:"aiProposal" as const,label:"AI 建议",reference:proposal,references:[proposal],placed:false},
 ],onPoint=vi.fn();
 render(<WorkspaceSourcePanel session={session} reference={approval} references={points[0].references} quote={points[0].quote} claim={points[0].claim} points={points} pointIndex={0} onPoint={onPoint} zh onSelect={vi.fn()} onClose={vi.fn()}/>);
 expect(screen.getByText("第 1 / 2 处")).toBeVisible();
 expect(screen.getByText("用户决定")).toBeVisible();
 expect(screen.getByText("包含 AI 的提议和你的确认，用“原话”箭头切换。")).toBeVisible();
 expect(await screen.findByText("原话 2 / 2")).toBeVisible();
 expect(screen.queryByText("本章依据这条消息的结论")).toBeNull();
 // The claim is highlighted in the document, not repeated here; the whole turn shows, the quote marked in place.
 expect(screen.queryByRole("heading",{name:"先做静态导出"})).toBeNull();
 await waitFor(()=>expect(document.querySelector(".workspace-source-message.is-source-target")).toBeTruthy());
 expect(screen.queryByRole("button",{name:"展开整条消息"})).toBeNull();
 expect(screen.queryByRole("button",{name:"全部标记原文已看过"})).toBeNull();
 expect(screen.getByRole("button",{name:"上一处依据"})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"下一处依据"}));expect(onPoint).toHaveBeenCalledWith(1);
});
it("labels a pasted document as pasted material and shows it readably",async()=>{
 const session=projectSession();session.projectState=undefined;
 // As the platform stores a pasted export: escaped Markdown and a trailing backslash per line.
 const pasted={...original,content:["\\# ChatAtlas 项目全景\\","\\> \\","\\> ## 五、更高级的方案\\","\\> 这不等于后台采集就不涉及隐私体验问题。\\","\\> ---\\"].join("\n")};
 const ref={...session.evidence[0],id:"pasted",messageId:pasted.id,excerpt:pasted.content,sourceSignature:undefined};session.evidence=[ref];
 vi.mocked(readSessionSource).mockResolvedValue([pasted]);
 const point={key:"o:a0",claim:"这不等于后台采集就不涉及隐私体验问题",quote:"\\> 这不等于后台采集就不涉及隐私体验问题。",source:"other" as const,label:"相似原文 · 粘贴资料",reference:ref,references:[ref],placed:true,approximate:true};
 render(<WorkspaceSourcePanel session={session} reference={ref} references={[ref]} quote={point.quote} claim={point.claim} points={[point]} pointIndex={0} onPoint={vi.fn()} zh onSelect={vi.fn()} onClose={vi.fn()}/>);
 expect(await screen.findByText("你粘贴的资料")).toBeVisible();
 const message=document.querySelector(".workspace-source-message.is-source-target")!;
 // No escape backslashes survive in the readable message.
 expect(message.textContent).not.toMatch(/\\/u);
 expect(message.textContent).toContain("这不等于后台采集就不涉及隐私体验问题。");
});
it("renders a quoted configuration diagram as Markdown code without painting every code line",async()=>{
 const session=projectSession();session.projectState=undefined;
 const content="配置结构：\n\n```text\nProviderConfig\n ├ provider\n ├ api_key__literal\n ├ baseUrl\n └ model\n```\n\n保留原始接口。";
 const source={...original,role:"assistant" as const,content},ref={...session.evidence[0],excerpt:content,sourceSignature:undefined};session.evidence=[ref];
 const point={key:"code-quote",claim:"ProviderConfig 配置结构",quote:content,source:"aiProposal" as const,label:"AI 建议",reference:ref,references:[ref],placed:true};
 vi.mocked(readSessionSource).mockResolvedValue([source]);
 render(<WorkspaceSourcePanel session={session} reference={ref} references={[ref]} quote={content} claim={point.claim} points={[point]} pointIndex={0} zh onSelect={vi.fn()} onClose={vi.fn()}/>);
 await screen.findByText("AI 回复");const card=document.querySelector(".workspace-source-message.is-source-target")!;
 expect(card.querySelector("pre code.language-text")?.textContent).toBe("ProviderConfig\n ├ provider\n ├ api_key__literal\n ├ baseUrl\n └ model\n");
 expect(card.querySelector("pre mark")).toBeNull();expect(card.textContent).not.toContain("```text");
 expect(source.content).toBe(content);
});

it("shows an oversized quotation within its whole message, with nothing to expand",async()=>{
 const session=projectSession();session.projectState=undefined;
 const quote="BYOK 使用用户自己的 API Key。\n\n"+"无关的历史背景和其他细节。".repeat(120)+"\n\n最后保留失败处理条件。";
 const source={...original,role:"assistant" as const,content:quote},ref={...session.evidence[0],excerpt:quote,sourceSignature:undefined};session.evidence=[ref];
 const point={key:"broad-quote",claim:"BYOK 用户自己的 API Key",quote,source:"aiProposal" as const,label:"AI 建议",reference:ref,references:[ref],placed:true};
 vi.mocked(readSessionSource).mockResolvedValue([source]);
 render(<WorkspaceSourcePanel session={session} reference={ref} references={[ref]} quote={quote} claim={point.claim} points={[point]} pointIndex={0} zh onSelect={vi.fn()} onClose={vi.fn()}/>);
 // The whole message shows at once; positioning brings the cited words into view.
 await screen.findByText("AI 回复");
 expect(screen.getByText(/最后保留失败处理条件/,{selector:".source-message-content p"})).toBeVisible();
 expect(screen.queryByRole("button",{name:"展开整条消息"})).toBeNull();
 expect(session.evidence[0].excerpt).toBe(quote);expect(source.content).toBe(quote);
});

it("marks the sentences that state the claim, a heading included, when its saved quote points at another passage",async()=>{
 const session=projectSession(),quote="<box gap={1}>\n <text size=\"xs\">9 月 1 日</text>\n **决定第一阶段使用关键词搜索。**\n</box>";
 const content=`## 七、它有什么缺点？为什么 Atlas 不适合直接照搬？\n\n### 1. Mem0 擅长记忆召回，但 Atlas 需要管理项目的「现行状态」\n\n假设先后发生两次讨论：\n\n${quote}\n\n记住多条事实，不等于知道项目当前的真实状态。`;
 const reference={...session.evidence[0],excerpt:quote};
 vi.mocked(readSessionSource).mockResolvedValue([{...original,role:"assistant",content}]);
 const marks=new Map<string,Set<Range>>();vi.stubGlobal("CSS",{...globalThis.CSS,highlights:marks});vi.stubGlobal("Highlight",class extends Set<Range>{constructor(...ranges:Range[]){super(ranges);}});
 render(<WorkspaceSourcePanel session={session} reference={reference} quote={quote} claim="Mem0 擅长持续交互中的记忆召回，但不适合直接照搬至 Atlas，因为 Atlas 需要管理项目现行状态、区分 AI 提议与用户决定。" zh onSelect={vi.fn()} onClose={vi.fn()} embedded returnLabel="返回上下文"/>);
 await waitFor(()=>expect(marks.get("atlas-original-proof")?.size).toBeGreaterThan(0));
 const marked=[...marks.get("atlas-original-proof")!].map(range=>range.toString()).join("|");
 // The heading stating the claim is marked; the example the saved quote points at is not.
 expect(marked).toContain("Mem0 擅长记忆召回，但 Atlas 需要管理项目的「现行状态」");expect(marked).not.toContain("决定第一阶段使用关键词搜索");
});

it("narrows a quote saved across paragraphs to the sentences that state its claim",()=>{
 const quote="勾选相关对话，还能进一步生成可追溯的项目总览。\n\n如果这件事做得足够稳定、足够快，即使第一版没有知识图谱和完整 Wiki，我也认为已经是一个值得发布的开源产品。\n\n另外，我建议你在「对话管家」的功能命名上使用 **Universal AI Conversation Search** 或 **AI Conversation Hub**，而不要只叫 AI Assistant。这样用户一眼就能明白，它管理的是自己的历史 AI 对话，而不是又一个通用聊天机器人。";
 const claim="建议将“对话管家”命名为 Universal AI Conversation Search 或 AI Conversation Hub，避免叫 AI Assistant 以区分通用聊天机器人。";
 expect(narrowQuote(claim,quote)).toMatch(/^另外，我建议你在「对话管家」.*通用聊天机器人。$/u);
 // A short quote, or one no sentence of which is clearly closer, stays whole.
 expect(narrowQuote("首版支持预览","首版支持预览。")).toBe("首版支持预览。");
 expect(narrowQuote("用户可以离线使用","今天天气不错。明天再说。")).toBe("今天天气不错。明天再说。");
});
