import { generationFailureReason } from "../canvas/generation-notice";
import { classifyImportError } from "../sync/import-state";

export type UpdatePhase = { stage: "reading" | "importing" | "analyzing" | "organizing" | "confirming" | "writing" | "saving";
  completed?: number; total?: number; label?: string };

export type UpdateIssue = { message: string; action?: "retry" | "retry-analysis" | "retry-smaller" | "settings" | "save" | "refresh-preview" };
export const changeDirectoryId = (index: number) => `pending-change:${index}`;
export const minimumChapterNotes = 3;

export function projectUpdateIssue(error: unknown, stage: UpdatePhase["stage"] | undefined, zh: boolean, smallBatch = false): UpdateIssue {
  const t = (cn: string, en: string) => zh ? cn : en;
  const message = error instanceof Error ? error.message : "";
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
  if (code === "SIDECAR_AI_NOT_AUTHORIZED") return { message: t("请在 AI 设置中授权服务地址后重试。", "Authorize the provider in AI settings, then retry."), action: "settings" };
  if (code === "SIDECAR_BACKGROUND_UNAVAILABLE") return { message: t("未能启动后台整理。已保存的对话和草稿可继续使用。", "Background generation could not start. Your saved chat and draft are available."), action: "retry-analysis" };
  if (code === "SIDECAR_DRAFT_SAVE" || code === "SIDECAR_DRAFT_CHANGED") return {
    message: t("本地草稿写入失败或已在另一处更新。重新打开项目可查看已保存的草稿。", "The local draft could not be saved or was updated elsewhere. Reopen the project to view the saved draft."),
  };
  if (stage === "reading" || stage === "importing") {
    if (/连接已中断|lost its connection|已切换|conversation changed|页面已变化/iu.test(message)) return {
      message: t("当前对话连接已变化。刷新 AI 页面后重试。", "The chat connection changed. Refresh the AI page and retry."), action: "retry",
    };
    if (/not ready|回复.*完成/iu.test(message)) return {
      message: t("对话还在加载。等回复完成后重试。", "The chat is still loading. Wait for the reply to finish, then retry."), action: "retry",
    };
    const category = classifyImportError(error instanceof Error ? error : new Error());
    if (category === "auth" || category === "permission" || /未开启|not enabled/iu.test(message)) return {
      message: t("无法读取对话。请检查登录状态和扩展的网站权限。", "Could not read the chat. Check your sign-in and the extension’s site access."), action: "retry",
    };
    if (category === "rate_limit") return { message: t("对话平台暂时限流，请稍后重试。", "The chat platform is rate limiting requests. Retry shortly."), action: "retry" };
    return { message: t("没有读取到当前对话。请刷新页面后重试。", "Could not import the current chat. Refresh the page and retry."), action: "retry" };
  }
  if (stage === "organizing" && code !== "SIDECAR_AI_NOT_CONFIGURED") return {
    message: t("目录规划未完成。已提取的内容仍可复用，请重试目录。", "Chapter planning did not finish. Extracted changes are retained. Retry the outline."), action: "retry-analysis",
  };
  if (stage === "writing" || stage === "confirming") return {
    message: (code && generationFailureReason("", code, zh)) || t("首版写作未完成。可以继续生成预览。", "First-version writing did not finish. Retry the preview."), action: "retry-analysis",
  };
  if (stage === "analyzing" || stage === "organizing") {
    const retryBatch = smallBatch ? "retry-analysis" : "retry-smaller";
    const retryHint = smallBatch ? t("可以重试这一小批。", "Retry this batch.") : t("可以分小批重试。", "Retry using smaller batches.");
    if (code === "SIDECAR_AI_NOT_CONFIGURED" || /^(?:PROVIDER_HTTP_40[134]|PROVIDER_MODEL_NOT_FOUND)$/u.test(code)) return {
      message: code === "SIDECAR_AI_NOT_CONFIGURED"
        ? t("请先连接 AI，再继续更新。", "Connect an AI model to continue.")
        : generationFailureReason("", code, zh),
      action: "settings",
    };
    if (code === "SIDECAR_CHAT_UNAVAILABLE") return {
      message: t("当前对话的正文尚未保存，请重试导入。", "The chat messages have not been saved. Retry the import."), action: "retry",
    };
    if (code === "PROVIDER_SCHEMA_sidecar_source") return {
      message: `${t("模型给出的引用无法对应原话。", "A model citation could not be matched to the chat.")} ${retryHint}`,
      action: retryBatch,
    };
    if (code.startsWith("PROVIDER_SCHEMA_")) return {
      message: `${t("模型返回的更新格式未通过校验。", "The model returned an invalid update format.")} ${retryHint}`,
      action: retryBatch,
    };
    if (code === "PROVIDER_OUTPUT_TRUNCATED" || code.startsWith("LOCAL_INPUT_")) return {
      message: `${code === "PROVIDER_OUTPUT_TRUNCATED"
        ? t("本批输出达到模型上限。", "This batch reached the model’s output limit.")
        : t("本批材料超过输入上限，尚未发送。", "This batch exceeded the input limit and was not sent.")} ${retryHint}`,
      action: retryBatch,
    };
    if (/授权 AI 连接|Authorize the AI connection/iu.test(message)) return {
      message: t("请先在 AI 设置中授权连接。", "Authorize the connection in AI settings first."), action: "settings",
    };
    if (/^(?:Failed to fetch|NetworkError when attempting to fetch resource\.?|fetch failed|Load failed)$/iu.test(message.trim())) return {
      message: t("连不上 AI 服务。请检查网络或 API 地址，再重试整理。", "Could not reach the AI service. Check your network or API address, then retry."),
      action: "retry-analysis",
    };
    return { message: (code.startsWith("PROVIDER_") && generationFailureReason("", code, zh))
      || t("整理阶段遇到异常。对话已保存，可以重新整理。", "The organizing step failed. Your chat is saved and can be organized again."),
      action: "retry-analysis" };
  }
  if (stage === "saving") return code === "SIDECAR_PREVIEW_STALE"
    ? { message: t("项目或对话已有变化。草稿已保留，可以先回到文档查看当前内容。", "The project or chat changed. Your draft is kept. Return to the document to review the current content."), action: "refresh-preview" }
    : { message: t("写入失败。已选内容和答案保留，请重试。", "Could not save. Your selections and answers are kept. Retry."), action: "save" };
  return { message: t("操作未完成，请重试。", "The operation did not complete. Please try again.") };
}

