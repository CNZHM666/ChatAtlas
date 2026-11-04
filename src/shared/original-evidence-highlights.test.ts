import {expect,it} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import {originalEvidenceHighlightTexts as originalEvidenceHighlights} from "./original-evidence-highlights";
import {sourceMessageSignature} from "./source-signature";

it("keeps a version and negation when the retained quote starts after a decimal version",()=>{
 const {session,messages}=contextKnowledge(),message=messages[1],ref=session.evidence[1];session.sections=[];session.projectState=undefined;
 message.content="V0.1 暂不接入真实 API，仅先验证静态交互。";ref.excerpt="暂不接入真实 API";ref.sourceSignature=sourceMessageSignature(message.content);
 expect(originalEvidenceHighlights(session,ref,message,ref.excerpt)).toEqual([message.content]);
});
it("finds a topic clause inside a long sentence and retains its adjacent precondition",()=>{
 const {session,messages}=contextKnowledge(),message=messages[1],ref=session.evidence[1];session.sections=[];session.projectState=undefined;
 const key="只有用户确认之后，Planner 才能提交 Hardware IR，";
 message.content="普通背景细节，".repeat(45)+key+"附带的其他说明，".repeat(35)+"结束。";ref.excerpt=message.content;ref.sourceSignature=sourceMessageSignature(message.content);
 const result=originalEvidenceHighlights(session,ref,message,undefined,{focus:"Planner 提交 Hardware IR"});
 expect(result).toContain(key);expect(result.every(text=>message.content.includes(text)&&text.length<=260)).toBe(true);
});
it("does not fill remaining highlight slots with unrelated claims from the same message",()=>{
 const {session,messages}=contextKnowledge(),message=messages[1],ref=session.evidence[1];session.projectState=undefined;
 message.content="默认 IndexedDB 存储消息。用户 API 密钥仅保存在运行时。界面采用绿色主题。";ref.excerpt=message.content;ref.sourceSignature=sourceMessageSignature(message.content);
 session.sections=[{...session.sections[0],claims:[{text:"本地存储",quote:"默认 IndexedDB 存储消息。",evidenceIds:[ref.id]},{text:"API 密钥生命周期",quote:"用户 API 密钥仅保存在运行时。",evidenceIds:[ref.id]},{text:"绿色主题",quote:"界面采用绿色主题。",evidenceIds:[ref.id]}]}];
 expect(originalEvidenceHighlights(session,ref,message,undefined,{focus:"API 密钥仅保存在运行时"})).toEqual(["用户 API 密钥仅保存在运行时。"]);
});

it("finds a descriptive topic passage deep in an old message without mandatory cue words",()=>{
 const {session,messages}=contextKnowledge(),message=messages[1],ref=session.evidence[1];session.sections=[];session.projectState=undefined;
 const key="Hardware IR 作为唯一数据源，连接 Canvas、BOM 和代码生成。";
 message.content="必须认真考虑。".repeat(30)+"\n\n"+key+"\n\n"+"这里继续讲其他例子。".repeat(25);
 ref.excerpt=message.content.slice(0,60);ref.sourceSignature=sourceMessageSignature(message.content);
 expect(originalEvidenceHighlights(session,ref,message,undefined,{focus:"Hardware IR 统一 Canvas、BOM 和代码的数据"})).toEqual([key]);
});

it("keeps long normalized quotations aligned to original whitespace, and preserves English identifiers",()=>{
 const {session,messages}=contextKnowledge(),message=messages[1],ref=session.evidence[1];session.sections=[];session.projectState=undefined;
 const key="Hardware IR     keeps Canvas and BOM consistent.";
 message.content="Ordinary background.\n\n".repeat(20)+key+"\n\nMore unrelated information.";
 ref.sourceSignature=sourceMessageSignature(message.content);const quote=message.content.replace(/\s+/gu," ");
 const result=originalEvidenceHighlights(session,ref,message,quote,{focus:"Hardware IR and BOM consistency"});
 expect(result).toEqual([key]);expect(result.every(text=>message.content.includes(text))).toBe(true);
});

it("does not mix another claim into an explicitly selected quotation or fake an unmatched quote",()=>{
 const {session,messages}=contextKnowledge(),message=messages[1],ref=session.evidence[1];
 message.content="原始消息保存到 IndexedDB。API 密钥由用户配置。";ref.sourceSignature=sourceMessageSignature(message.content);
 session.sections[1].claims=[{text:"数据保存",quote:"原始消息保存到 IndexedDB。",evidenceIds:[ref.id]},{text:"密钥",quote:"API 密钥由用户配置。",evidenceIds:[ref.id]}];
 expect(originalEvidenceHighlights(session,ref,message,"API 密钥由用户配置。")).toEqual(["API 密钥由用户配置。"]);
 expect(originalEvidenceHighlights(session,ref,message,"API 密钥已经上传。 ")).toEqual([]);
});

it("ranks the current topic ahead of early generic constraints and keeps marks bounded",()=>{
 const {session,messages}=contextKnowledge(),message=messages[1],ref=session.evidence[1];session.sections=[];session.projectState=undefined;
 message.content="必须保护隐私。必须保证质量。必须认真测试。\n\nHardware IR 定义模块连接。Canvas 使用 Hardware IR。BOM 从 Hardware IR 导出。";
 ref.excerpt=message.content;ref.sourceSignature=sourceMessageSignature(message.content);
 const result=originalEvidenceHighlights(session,ref,message,undefined,{focus:"Hardware IR Canvas BOM 模块连接"});
 expect(result.join("")).not.toContain("必须");expect(result).toHaveLength(3);expect(result.join("").length).toBeLessThanOrEqual(540);
});
it("does not absorb an unrelated following sentence when the anchor already ends in punctuation",()=>{
 const {session,messages}=contextKnowledge(),message=messages[1],ref=session.evidence[1];session.sections=[];session.projectState=undefined;
 message.content="第一版仅支持 ESP32，不做 PCB。这里是一个无关的装饰例子。";ref.excerpt="第一版仅支持 ESP32，不做 PCB。";ref.sourceSignature=sourceMessageSignature(message.content);
 expect(originalEvidenceHighlights(session,ref,message,ref.excerpt)).toEqual([ref.excerpt]);
});
it("keeps generic questions and unimportant long prose plain, highlighting only a bounded important sentence",()=>{
 const {session,messages}=contextKnowledge(),message=messages[1],ref=session.evidence[1];session.projectState=undefined;session.sections=[];
 message.content="这是一段普通背景。".repeat(35)+"\n\n第一版仅支持 ESP32，不做 PCB。\n\n"+"这里是其他例子。".repeat(35);ref.excerpt=message.content;session.sourceSignatures!.c[message.id]=sourceMessageSignature(message.content);
 const highlights=originalEvidenceHighlights(session,ref,message);expect(highlights).toEqual(["第一版仅支持 ESP32，不做 PCB。"]);expect(highlights.join("")).not.toContain("普通背景");
 expect(originalEvidenceHighlights(session,session.evidence[0],messages[0])).toEqual([]);
});
it("highlights several source-backed important sentences with their context, leaving unrelated prose plain",()=>{
 const {session,messages}=contextKnowledge(),ref=session.evidence[0],message=messages[0];
 message.content="背景说明。决定使用 IndexedDB 保存原始消息。\n\n"+"这是一段与依据无关的例子。".repeat(45)+"\n\n不得自动发送消息。末尾说明。";
 session.sourceSignatures!.c[message.id]=sourceMessageSignature(message.content);ref.excerpt="使用 IndexedDB";
 session.sections[0].claims=[{text:"保留消息",quote:"使用 IndexedDB",evidenceIds:[ref.id]},{text:"不自动发送",quote:"不得自动发送消息",evidenceIds:[ref.id]}];
 session.projectState=undefined;
 const quotes=originalEvidenceHighlights(session,ref,message);expect(quotes).toContain("决定使用 IndexedDB 保存原始消息。");expect(quotes).toContain("不得自动发送消息。");expect(quotes.join("")).not.toContain("无关的例子");expect(quotes.every(quote=>message.content.includes(quote))).toBe(true);
});
it("does not highlight stale originals or unrelated message identities",()=>{
 const {session,messages}=contextKnowledge(),ref=session.evidence[0];messages[0].content+="来源已改变";expect(originalEvidenceHighlights(session,ref,messages[0])).toEqual([]);
 expect(originalEvidenceHighlights(session,ref,messages[1])).toEqual([]);
});

it("uses the explicitly retained original version rather than a newer session fingerprint",()=>{
 const {session,messages}=contextKnowledge(),ref={...session.evidence[0],sourceVersionId:"retained"};session.sourceVersionIds={c:"latest"};session.sourceSignatures!.c[ref.messageId]="newer-fingerprint";
 expect(originalEvidenceHighlights(session,ref,messages[0]).length).toBeGreaterThan(0);
});

it("restricts claims and alternate citation excerpts to this chapter, including platform-message aliases",()=>{
 const {session,messages}=contextKnowledge(),ref=session.evidence[0],message=messages[0];
 message.content="本章决定保留本地数据。\n\n其他章节讨论市场推广。";message.platformMessageId="native-id";
 ref.excerpt="本章决定保留本地数据。";ref.sourceSignature=sourceMessageSignature(message.content);
 session.sections[0].claims=[{text:"本地",quote:ref.excerpt,evidenceIds:[ref.id]}];
 session.sections[1].claims=[{text:"推广",quote:"其他章节讨论市场推广。",evidenceIds:[ref.id]}];
 const quotes=originalEvidenceHighlights(session,ref,message,undefined,{sectionId:session.sections[0].id});
 expect(quotes).toEqual([ref.excerpt]);
 expect(originalEvidenceHighlights(session,{...ref,messageId:"native-id"},message,ref.excerpt,{sectionId:session.sections[0].id})).toEqual([ref.excerpt]);
 expect(originalEvidenceHighlights(session,ref,message,undefined,{sectionId:"missing"})).toEqual([]);
});
