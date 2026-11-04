import type { FocusSession } from "../shared/focus-session";
import type { Conversation, ConversationMessage } from "../shared/types";
import { projectOpenQuestions, projectStateModel } from "../shared/project-state";
import { evidencePresentation } from "../shared/evidence-presentation";
import { readableConversationText } from "../shared/conversation-text";
import { platformName } from "../shared/platforms";

export interface BridgeSections { background: boolean; architecture: boolean; questions: boolean }
/** Reuse saved knowledge locally; no model call, private-note export or inferred decisions. */
export function projectBridgeContext(session: FocusSession, conversations: Conversation[], sections: BridgeSections, zh: boolean, changed = false): string {
  const label = (cn: string, en: string) => zh ? cn : en;
  const clean = (text: string) => evidencePresentation(text).trim();
  const model = projectStateModel(session);
  const lines = [`# ${session.title}`, label("以下是我已有的项目背景与历史记录，供本次讨论参考。", "Here is my saved project context and history for this discussion.")];
  if (changed || model?.stale) lines.push(`> ${label("来源有新变化，以下为旧整理，请核对相关原文。", "Sources have changed; this is an earlier summary. Verify the originals.")}`);
  if (sections.background) lines.push(`## ${label("项目背景与目标", "Background and goals")}`, session.goal, model?.summary ?? (session.briefUserEdited ? session.brief?.summary : clean(session.brief?.summary ?? "")) ?? "");
  if (sections.architecture) {
    lines.push(`## ${label("架构与关键决策", "Architecture and decisions")}`);
    if (model) {
      const modules = model.modules.filter(item => item.status !== "superseded");
      const status = (state: string) => state === "proposal" ? label("建议", "Proposal") : state === "uncertain" ? label("待确认", "Uncertain") : label("讨论记录", "Recorded in discussion");
      for (const item of modules) lines.push(`- ${item.title}（${status(item.status)}）：${item.purpose}${item.inputs.length ? `\n  ${label("输入", "Inputs")}：${item.inputs.join("；")}` : ""}${item.outputs.length ? `\n  ${label("输出", "Outputs")}：${item.outputs.join("；")}` : ""}`);
      for (const edge of model.relations.filter(edge => modules.some(item => item.id === edge.from) && modules.some(item => item.id === edge.to))) lines.push(`- ${modules.find(item => item.id === edge.from)!.title} → ${edge.label} → ${modules.find(item => item.id === edge.to)!.title}`);
      for (const item of model.decisions.filter(item => item.status !== "superseded")) lines.push(`- ${item.text}（${item.confirmed && !changed && !model.stale ? label("用户已确认", "User confirmed") : status(item.status)}）${item.reason ? `：${item.reason}` : ""}`);
      for (const item of model.constraints.filter(item => item.status !== "superseded")) lines.push(`- ${label("约束", "Constraint")}（${status(item.status)}）：${item.text}`);
    } else for (const item of session.brief?.confirmed ?? []) lines.push(`- ${clean(item.text)}（${label("整理中的记录，未核实用户批准", "Recorded summary; user approval not verified")}）`);
  }
  if (sections.questions) {
    const questions = projectOpenQuestions(session);
    const actions = model?.actions.filter(item => !item.done && item.status !== "superseded") ?? [];
    if (questions.length || actions.length) lines.push(`## ${label("待解决与下一步", "Open questions and next steps")}`, ...questions.map(text => `- ${text}`), ...actions.map(item => `- ${item.text}（${item.personal ? label("我的待办", "My next step") : label("讨论中的建议，未标记完成", "Suggested in discussion; not marked complete")}）`));
  }
  const sourceNames = session.sourceConversationIds.map(id => conversations.find(item => item.id === id)).filter((source): source is Conversation => Boolean(source));
  if (sourceNames.length) lines.push(`## ${label("来源范围", "Source scope")}`, ...sourceNames.map(source => `- ${source.title} · ${platformName(source.platform, zh ? "zh-CN" : "en")}${/^https?:\/\//u.test(source.url) ? `\n  ${source.url}` : ""}`));
  return lines.filter(line => line.trim()).join("\n\n");
}

export function discussionBridgeContext(conversation: Conversation, messages: ConversationMessage[], zh: boolean): string {
  const label = (cn: string, en: string) => zh ? cn : en;
  return [`# ${label("历史讨论参考", "Past discussion reference")}：${conversation.title}`, `${platformName(conversation.platform, zh ? "zh-CN" : "en")}${/^https?:\/\//u.test(conversation.url) ? ` · ${conversation.url}` : ""}`, ...messages.map(message => `## ${label("消息", "Message")} ${message.messageIndex + 1} · ${message.role === "user" ? label("我的提问", "My question") : label("AI 回复", "AI reply")}\n\n${readableConversationText(message.content)}`)].join("\n\n");
}
