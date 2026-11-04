import type { FocusEvidence, FocusSection, FocusSession } from "../shared/focus-session";
import type { Conversation, ConversationMessage } from "../shared/types";
import type { ProjectHistoryEvent } from "../shared/project-state";
import { projectQuestionKey, projectStateSignature } from "../shared/project-state";
import { sourceMessageSignature } from "../shared/source-signature";
import { contextProjectSignature } from "../context/knowledge";
import type { ProjectKnowledge } from "../context/types";

const at = Date.UTC(2026, 9, 1);
const discussions = [
  { title: "产品定位与首版范围", days: 0, text: "我们想做 Circuit Studio，帮助硬件初学者从自然语言需求得到可验证的硬件方案。首版先面向 ESP32，支持需求输入、方案预览与校验；暂不支持自动下单和直接控制实物。最初设想让 AI 直接修改画布。" },
  { title: "操作计划与执行器的选择", days: 3, text: "确认改用结构化操作计划：AI 负责建议，确定性执行器负责画布修改与规则校验。放弃 AI 直接操作画布的方式，因为操作需要先预览、可追踪，并在失败后恢复。每次执行前保存快照，失败后回滚；这作为首版的开发方案。" },
  { title: "首个版本发布与验证记录", days: 10, text: "v0.1 已公开发布，包含需求输入、操作计划预览和基础规则校验。我们完成了需求到计划的核心流程验证，但硬件方案尚需实物测试。下一步优先验证失败恢复，覆盖执行中断、无效器件和重复操作三类情况。" },
  { title: "下一阶段的调整", days: 12, text: "准备在下一阶段增加视觉器件识别，还没有完成开发。继续支持用户自带模型，避免固定绑定一家服务商。暂不扩展到其他控制板，先完善 ESP32 的错误提示与恢复体验。需要研究：视觉识别的准确率达到什么标准，才适合进入正式版本？" },
];
export const exampleConversations: Conversation[] = discussions.map((discussion, index) => ({ id: `example-conversation-${index}`, title: discussion.title, platform: "chatgpt", url: "", updatedAt: at + discussion.days * 86400000, messageCount: 2, importState: "complete", hydrationState: "hydrated" }));
export const exampleMessages: ConversationMessage[] = discussions.map((discussion, index) => ({ id: `example-message-${index}`, conversationId: exampleConversations[index].id, role: "user", content: discussion.text, preview: discussion.text, createdAt: at + discussion.days * 86400000, updatedAt: at + discussion.days * 86400000, messageIndex: 0, contentHash: sourceMessageSignature(discussion.text) }));
const refs: FocusEvidence[] = exampleMessages.map((message, index) => ({ id: `example-source-${index}`, conversationId: message.conversationId, messageId: message.id, title: exampleConversations[index].title, excerpt: message.content, sourceSignature: sourceMessageSignature(message.content) }));
const questionTexts = ["如何验证操作计划的失败恢复，避免执行中断后画布停留在不一致的状态？", "视觉器件识别达到什么准确率才适合进入正式版本？", "无效器件的错误提示应该如何帮助初学者修正方案？"];
const event = (index: number, title: string, before: string, after: string, reason: string, workStatus: ProjectHistoryEvent["workStatus"], version = ""): ProjectHistoryEvent => ({ id: `example-event-${index}`, title, version, before, after, reason, area: index === 1 ? "技术架构" : "产品", changeKind: index === 0 ? "adopt" : "change", decisionStatus: "confirmed", workStatus, workQuote: refs[index].excerpt, workEvidenceIds: [refs[index].id], status: "documented", quote: refs[index].excerpt, evidenceIds: [refs[index].id], beforeQuote: before ? refs[index].excerpt : "", beforeEvidenceIds: before ? [refs[index].id] : [], discussedAt: exampleMessages[index].createdAt, position: { conversationId: refs[index].conversationId, messageId: refs[index].messageId, messageIndex: 0, offset: 0, discussedAt: exampleMessages[index].createdAt } });

/** Fictional project used only by memory readers, never session storage or AI. */
export function workspaceLayoutExample(): FocusSession {
  const session: FocusSession = {
    id: "atlas-layout-example", title: "Circuit Studio", mode: "work", locale: "zh-CN", goal: "继续开发面向初学者的 AI 硬件创作工具", sourceConversationIds: refs.map(ref => ref.conversationId), evidence: structuredClone(refs),
    sourceSignatures: Object.fromEntries(refs.map(ref => [ref.conversationId, { [ref.messageId]: ref.sourceSignature! }])), sourceRoles: Object.fromEntries(refs.map(ref => [ref.conversationId, { [ref.messageId]: "user" }])), sourceMessageOrder: Object.fromEntries(refs.map(ref => [ref.conversationId, [ref.messageId]])),
    sections: [
      { id: "example-positioning", title: "产品定位与首版范围", wikiDisplayTitle: "产品定位", wikiGroup: "产品策略", kind: "finding", transition: "", evidenceIds: [refs[0].id], body: "## 核心定位\n\n面向硬件初学者的 AI 辅助创作工具，把自然语言需求转为可验证的硬件方案。\n\n## 首版包含什么\n\n- 需求输入与目标确认。\n- ESP32 方案预览。\n- 操作计划与基础规则校验。\n\n## 暂不包含什么\n\n自动下单、直接控制实物以及其他控制板适配留在后续阶段。\n\n## 使用路径\n\n用户提出需求，检查方案预览，确认操作计划，再查看执行与校验结果。", claims: [{ text: "首版面向 ESP32，暂不支持自动下单和直接控制实物", quote: "首版先面向 ESP32，支持需求输入、方案预览与校验；暂不支持自动下单和直接控制实物。", evidenceIds: [refs[0].id], verification: "supported" }] },
      { id: "example-architecture", title: "操作计划、执行器与规则校验", wikiDisplayTitle: "操作计划与校验", wikiGroup: "技术架构", kind: "finding", transition: "", evidenceIds: [refs[1].id], body: "## 当前方案\n\nAI 生成结构化操作计划，由确定性执行器完成画布修改与规则校验。用户先检查预览，再确认执行。\n\n## 为什么调整\n\n直接修改画布难以核对和恢复。把建议与执行分开，可以记录每一步操作并明确失败位置。\n\n## 模块协作\n\n| 模块 | 输入 | 输出 |\n| --- | --- | --- |\n| 需求理解 | 用户目标 | 结构化需求 |\n| 计划生成 | 需求与现有画布 | 操作计划 |\n| 执行校验 | 用户确认的计划 | 画布变更与校验结果 |\n\n## 失败恢复\n\n每次执行前保存快照，失败后回滚。实现方案已确认，恢复能力的完整验证仍是待处理事项。\n\n## 接口示意\n\n```typescript\nconst plan = propose(intent);\nconst preview = validate(plan);\n// 用户确认后执行\nconst result = execute(plan, snapshot);\n```", claims: [{ text: "使用结构化操作计划与确定性执行器", quote: "AI 负责建议，确定性执行器负责画布修改与规则校验。", evidenceIds: [refs[1].id], verification: "supported", overviewRole: "decision" }] },
      { id: "example-roadmap", title: "v0.1 进展与下一阶段重点", wikiDisplayTitle: "进展与下一步", wikiGroup: "开发规划", kind: "finding", transition: "", evidenceIds: [refs[2].id, refs[3].id], body: "## 已报告的进展\n\nv0.1 已公开发布，包含需求输入、操作计划预览和基础规则校验。核心流程已完成软件验证，硬件方案仍需实物测试。\n\n## 当前重点\n\n验证失败恢复，覆盖执行中断、无效器件和重复操作。\n\n## 下一阶段\n\n视觉器件识别仍处于规划，需要先确认准确率和失败处理标准。继续支持用户自带模型。\n\n## 阶段边界\n\n先完善 ESP32 的错误提示与恢复体验，再评估其他控制板。", claims: [{ text: "v0.1 已公开发布，包含需求输入、操作计划预览和基础规则校验", quote: "v0.1 已公开发布，包含需求输入、操作计划预览和基础规则校验。", evidenceIds: [refs[2].id], verification: "supported", overviewRole: "progress", workStatus: "reported" }] },
    ], activeSectionId: "example-positioning", completedSectionIds: [], notes: "", createdAt: at, updatedAt: exampleMessages[3].createdAt!,
    brief: { summary: "面向硬件初学者的 AI 辅助创作工具，从自然语言需求生成可预览、可校验的 ESP32 硬件方案。", turningPoints: [], confirmed: [], openQuestions: questionTexts },
    projectState: {
      summary: "从自然语言需求到可预览、可校验的硬件方案", modules: [], relations: [], actions: [],
      decisions: [{ id: "example-choice", text: "使用结构化操作计划与确定性执行器", reason: "操作先预览、可追踪，失败后可以恢复。", status: "documented", quote: "确认改用结构化操作计划", evidenceIds: [refs[1].id] }, { id: "example-model", text: "支持用户自带模型", reason: "避免固定绑定一家服务商。", status: "documented", quote: "继续支持用户自带模型，避免固定绑定一家服务商。", evidenceIds: [refs[3].id] }],
      constraints: [{ id: "example-scope", text: "首版聚焦 ESP32 的方案预览与校验", reason: "先验证核心体验，再扩大适配范围。", status: "documented", quote: "首版先面向 ESP32，支持需求输入、方案预览与校验；暂不支持自动下单和直接控制实物。", evidenceIds: [refs[0].id] }],
      signature: "", generatedAt: at, basis: "organized", verification: "original",
      sources: refs.map(ref => ({ id: ref.id, conversationId: ref.conversationId, messageId: ref.messageId, signature: ref.sourceSignature!, role: "user" })),
    },
    projectMaintenance: {
      questions: Object.fromEntries([
        ...questionTexts.map((text, index) => [projectQuestionKey(text), { originalText: text, text, displayTitle: ["验证操作计划的失败恢复", "确定视觉识别的验收标准", "完善无效器件的错误提示"][index], resolved: false, sources: [refs[index === 1 ? 3 : 2]] }]),
        [projectQuestionKey("需求到操作计划的核心流程是否可用？"), { originalText: "需求到操作计划的核心流程是否可用？", text: "需求到操作计划的核心流程是否可用？", resolved: true, resolution: "已完成需求到操作计划的核心流程验证。", resolutionReason: "已验证需求输入、计划生成和预览；实物测试仍需单独进行。", sources: [refs[2]] }],
      ]),
      decisions: { "example-choice": { text: "使用结构化操作计划与确定性执行器", confirmed: true, matterStatus: "resolved", resolutionReason: "操作可预览、可追踪，失败后可恢复。", linkedKnowledgeIds: ["example-architecture"] }, "example-model": { text: "支持用户自带模型", confirmed: true, matterStatus: "resolved" } },
      constraints: { "example-scope": { text: "首版聚焦 ESP32 的方案预览与校验", confirmed: true, matterStatus: "resolved", included: "需求输入、操作计划预览、规则校验", excluded: "自动下单、直接控制实物、其他控制板", phase: "v0.1" } }, evolutionEvents: {},
    },
    projectEvolutionAnalysis: { version: 6, kind: "evolution", signature: "example", sourceSignature: "example", generatedAt: exampleMessages[3].createdAt!, events: [event(0, "最初构想：从需求生成硬件方案", "", "面向初学者，先探索 AI 直接修改画布。", "降低硬件创作的入门门槛。", "planned"), event(1, "调整架构：引入操作计划", "AI 直接修改画布。", "AI 建议操作计划，由执行器修改与校验。", "操作需要先预览、可追踪并支持恢复。", "planned"), event(2, "v0.1：首个版本公开发布", "", "需求输入、计划预览和基础规则校验已对外提供。", "完成核心流程验证，先提供最小可用体验。", "released", "v0.1"), event(3, "下一阶段：准备视觉器件识别", "", "规划视觉识别，继续完善 ESP32 的错误提示。", "先确认准确率和失败处理标准。", "planned")], evidence: structuredClone(refs), sources: refs.map((ref, index) => ({ id: ref.id, conversationId: ref.conversationId, messageId: ref.messageId, signature: ref.sourceSignature!, role: "user", messageIndex: 0, discussedAt: exampleMessages[index].createdAt })) },
  };
  session.projectState!.signature = projectStateSignature(session);
  return session;
}
export function exampleSourceMessage(ref: FocusEvidence) { return exampleMessages.find(message => message.id === ref.messageId && message.conversationId === ref.conversationId); }
export function exampleProjectKnowledge(session: FocusSession): ProjectKnowledge {
  const copy = structuredClone(session);
  copy.title = `${copy.title}（虚构示例）`;
  return { session: copy, conversations: structuredClone(exampleConversations), messages: structuredClone([...exampleMessages,...exampleReplies]), sourcesStale: false, signature: contextProjectSignature(session) };
}

/** Fictional replies accompany their real sample question; they never enter user storage. */
export const exampleReplies:ConversationMessage[]=exampleMessages.map((message,index)=>({...message,id:`example-reply-${index}`,role:"assistant" as const,messageIndex:1,createdAt:message.createdAt!+60000,content:["先限定首版范围：ESP32 需求输入、方案预览和规则校验。实物控制与自动下单暂不包含。","可以将建议计划与确定性执行分开：先预览，再执行；校验失败时回滚。","核心流程验证与实物测试需要分开记录。接下来补齐失败恢复测试。","视觉识别仍属规划。建议先确认准确率、无效器件和失败处理标准。"][index],preview:"示例 AI 回复"})).map(message=>({...message,contentHash:sourceMessageSignature(message.content)}));
export function exampleChapterDiagram(section:FocusSection):FocusSection {
 const first:FocusSection={id:"example-diagram-plan",title:"建议操作计划",body:"AI 建议结构化操作计划，先由用户预览。",transition:"",kind:"finding",evidenceIds:[],origin:"user",understandingLinks:[{targetId:"example-diagram-execute",kind:"flow"}]};
 const second:FocusSection={id:"example-diagram-execute",title:"执行与规则校验",body:"确定性执行器修改画布、执行规则校验；失败后回滚。",transition:"",kind:"finding",evidenceIds:[],origin:"user"};
 return {...section,understandingPath:[...(section.understandingPath??[]).filter(item=>item.id!==first.id&&item.id!==second.id),first,second]};
}