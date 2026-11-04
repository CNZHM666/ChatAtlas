import { evidencePresentation } from "./evidence-presentation";
import type { FocusSession } from "./focus-session";
import { projectStateModel, projectOpenQuestions, projectQuestionItems } from "./project-state";

/** Safe Mermaid identifiers are generated locally; model text never becomes graph syntax. */
export function projectStateMarkdown(session: FocusSession, zh: boolean, options?: { handoff?: boolean }) {
  const model = projectStateModel(session);
  if (!model) return "";
  const label = (cn: string, en: string) => zh ? cn : en;
  const line = (value: string) => value.replace(/\s+/gu, " ").trim();
  const escape = (value: string) => line(value).replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/\[/gu, "&#91;").replace(/\]/gu, "&#93;").replace(/`/gu, "&#96;").replace(/\\/gu, "&#92;").replace(/\|/gu, "&#124;");
  const status = (value: string) => value === "proposal" ? label("建议", "Proposal") : value === "uncertain" ? label("待确认", "Uncertain") : value === "superseded" ? label("已替换", "Superseded") : label("讨论记录", "Recorded in discussion");
  const modules = model.modules.filter(item => item.status !== "superseded");
  const ids = new Map(modules.map((item, index) => [item.id, `n${index + 1}`]));
  const graph = modules.length ? ["```mermaid", "flowchart TB", ...modules.map(item => `  ${ids.get(item.id)}["${escape(item.title)}"]`), ...model.relations.filter(edge => ids.has(edge.from) && ids.has(edge.to)).map(edge => `  ${ids.get(edge.from)} -->|"${escape(edge.label)}"| ${ids.get(edge.to)}`), "```"].join("\n") : "";
  const sources = (references: string[]) => [...new Set(session.evidence.filter(ref => references.includes(ref.id)).map(ref => line(ref.title)))].join(" · ");
  const join = (parts: string[]) => parts.filter(Boolean).join("\n\n");
  return join([
    `## ${label("当前项目方案", "Current project plan")}`,
    `> ${model.stale ? label("材料已变化，方案待更新", "Materials changed; this plan needs updating") : model.accepted ? label("用户设为当前版本", "Set as current version by the user") : label("方案草稿，待用户核对", "Draft plan for user review")} · ${label("基于整理材料，不代表代码已实现", "Based on organized material; not proof of implementation")}`,
    model.summary,
    options?.handoff ? "" : graph,
    ...modules.map(item => join([`### ${line(item.title)} · ${line(item.layer)}`, `${item.userEdited ? label("用户修改", "User edited") : status(item.status)}${item.missing ? ` · ${label("新分析未包含，保留个人版本", "Personal version retained outside the new analysis")}` : ""}`, item.purpose, `${label("输入", "Inputs")}：${item.inputs.map(line).join(" · ") || "—"}\n\n${label("输出", "Outputs")}：${item.outputs.map(line).join(" · ") || "—"}`, sources(item.evidenceIds) ? `${label("讨论依据", "Discussion sources")}：${sources(item.evidenceIds)}` : ""])),
    options?.handoff && model.relations.length ? `### ${label("模块关系", "Module relationships")}\n\n${model.relations.filter(edge => ids.has(edge.from) && ids.has(edge.to)).map(edge => `- ${line(modules.find(item => item.id === edge.from)!.title)} → ${line(edge.label)} → ${line(modules.find(item => item.id === edge.to)!.title)}`).join("\n")}` : "",
    `### ${label("关键决策", "Decisions")}`, ...model.decisions.filter(item => item.status !== "superseded").map(item => `- ${line(item.text)} (${item.confirmed ? label("用户确认", "User confirmed") : status(item.status)})${item.reason ? ` — ${line(item.reason)}` : ""}`),
    `### ${label("项目约束", "Constraints")}`, ...model.constraints.filter(item => item.status !== "superseded").map(item => `- ${line(item.text)} (${status(item.status)})`),
    model.history?.length ? `### ${label("版本变迁", "Version timeline")}\n\n${model.history.map(item => join([`- ${item.discussedAt ? new Date(item.discussedAt).toLocaleDateString(zh ? "zh-CN" : "en") : label("时间未记录", "Date unavailable")} · ${line(item.version)} ${line(item.title)} (${status(item.status)})：${line(item.after)}`, item.before ? `  ${label("之前", "Before")}：${line(item.before)}` : "", item.reason ? `  ${label("变化原因", "Reason")}：${line(item.reason)}` : "", `  ${label("讨论依据", "Discussion sources")}：${sources([...item.evidenceIds, ...item.beforeEvidenceIds])}`])).join("\n\n")}` : "",
    projectOpenQuestions(session).length ? `### ${label("待解决", "Open questions")}\n\n${projectOpenQuestions(session).map(text => `- ${line(session.briefUserEdited ? text : evidencePresentation(text))}`).join("\n")}` : "",
    projectQuestionItems(session).some(item => item.resolved) ? `### ${label("已解决", "Resolved questions")}\n\n${projectQuestionItems(session).filter(item => item.resolved).map(item => `- ${line(item.text)} (${item.personal ? label("用户标记解决", "Marked resolved by the user") : label("讨论已回答", "Answered in discussion")})`).join("\n")}` : "",
    [...model.modules, ...model.decisions, ...model.constraints].some(item => item.status === "superseded") ? `### ${label("已替换的方案", "Superseded plans")}\n\n${[...model.modules, ...model.decisions, ...model.constraints].filter(item => item.status === "superseded").map(item => `- ${line("title" in item ? item.title : item.text)}`).join("\n")}` : "",
  ]);
}
