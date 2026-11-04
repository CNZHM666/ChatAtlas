/** Resolve notices at render time so changing the UI language also changes an
 * already displayed failure. Provider messages remain available in diagnostics. */
export function generationFailureReason(message: string, code: string | undefined, zh: boolean): string {
  const text = (cn: string, en: string) => zh ? cn : en;
  if (code === "PROVIDER_SCHEMA_wiki_writing_recovery_limit") return text("本轮自动修复已达上限。可以继续处理未完成内容。", "This round reached its repair limit. Continue to finish the remaining content.");
  if (/^PROVIDER_SCHEMA_wiki_owner_/u.test(code ?? "")) return text("部分正文未能对应到正确章节，需要重新整理。", "Some writing could not be matched to its chapter and needs another pass.");
  if (code === "PROVIDER_SCHEMA_wiki_directory_missing_owner") return text("部分章节尚未生成，可以继续完成剩余正文。", "Some chapters are missing. Continue to finish the remaining writing.");
  if (code?.startsWith("PROVIDER_SCHEMA_wiki_directory")) {
    if (/_topic_key$|_duplicate_topic_key$/u.test(code)) return text("目录格式未能对齐，请重试目录整理。", "The outline format could not be aligned. Retry outline planning.");
    // Keep precise counts/reasons when they already match the current locale.
    const sameLanguage = /\p{Script=Han}/u.test(message) === zh;
    const marker = zh ? "。已保留完成的分析" : ". Completed analysis";
    const specific = /_(?:subtopic_boundary|boundary|chapter_count|no_convergence)$|_ownership_/u.test(code);
    if (specific && sameLanguage && message.includes(marker)) return message.slice(0, message.indexOf(marker)) + text("。", ".");
    return text("目录校验未通过，需要继续核对章节与材料归属。", "The outline needs another pass to check chapters and source assignments.");
  }
  if (code === "PROVIDER_SCHEMA_wiki_subtopic_missing") return text("部分小节尚未写全，可以继续补写。", "Some sections are incomplete. Continue to fill in the missing writing.");
  if (code === "PROVIDER_SCHEMA_wrong_output_language") return text("模型未按所选语言生成，请重试。", "The model did not use the requested language. Please retry.");
  if (code === "LOCAL_INPUT_BUDGET" || code === "LOCAL_INPUT_CHARACTERS") return text("本次请求超过本地输入上限，没有发送给模型，也没有产生费用。请减少所选章节或来源后重试。", "This request exceeds the local input limit, so nothing was sent or billed. Select fewer chapters or sources and retry.");
  if (code?.startsWith("PROVIDER_SCHEMA_")) return text("部分内容未通过格式或来源核对，需要重试。", "Some content failed format or source checks and needs another attempt.");
  if (code === "PROVIDER_MODEL_NOT_FOUND" || code === "PROVIDER_HTTP_404") return text("所选模型或接口不可用，请在 AI 设置中核对。", "The model or endpoint is unavailable. Check AI settings.");
  if (code === "PROVIDER_HTTP_401" || code === "PROVIDER_HTTP_403") return text("AI 连接未获授权，请检查密钥和模型权限。", "The AI connection was not authorized. Check your key and model access.");
  if (code === "PROVIDER_HTTP_429") return text("模型服务限流或额度不足，请稍后重试或检查服务商额度。", "The provider is rate limiting requests or has insufficient quota. Retry later or check your provider account.");
  if (code === "PROVIDER_TIMEOUT") return text("模型响应超时，请稍后重试。", "The model response timed out. Please retry shortly.");
  if (code === "PROVIDER_OUTPUT_TRUNCATED") return text("模型输出未完成，请重试剩余内容。", "The model output was incomplete. Retry the remaining content.");
  if (code === "PROVIDER_STREAM_INCOMPLETE") return text("模型连接中断，请重试。", "The model connection was interrupted. Please retry.");
  // fetch() rejects with a bare TypeError ("Failed to fetch") when the connection never opens.
  if (code === "NETWORK_USAGE_UNKNOWN" || /^(?:Failed to fetch|NetworkError when attempting to fetch resource\.?|fetch failed|Load failed)$/iu.test(message.trim())) return text("连不上 AI 服务：请求没有收到任何响应，通常是网络、代理或 VPN 的问题，模型没有收到这次请求。已自动重试过一次；检查网络后再点重试即可。", "Could not reach the AI service: the request got no response, usually a network, proxy or VPN problem, and the model did not receive it. It was retried once automatically; check your connection and retry.");
  if (code === "PROVIDER_EMPTY_RESPONSE" || code === "PROVIDER_RESPONSE_REJECTED") return text("模型未返回可用正文，请重试或检查 AI 设置。", "The model returned no usable writing. Retry or check AI settings.");
  if (code?.startsWith("PROVIDER_HTTP_")) return text("模型服务暂时无法处理请求，请稍后重试。", "The provider could not process the request. Please retry later.");
  if (/授权 AI 连接|Authorize the AI connection/u.test(message)) return text("请先授权 AI 连接，再继续生成。", "Authorize the AI connection before continuing.");
  const known = [
    ["请先连接自己的 AI。", "Connect your AI API first."],
    ["读取 AI 配置失败，请重新打开 AI 设置。", "Could not read AI settings. Reopen AI settings."],
    ["正在准备已确认的来源…", "Preparing confirmed sources…"],
    ["已授权，请重试生成。", "Authorized. Retry generation."],
    ["未获得连接权限。", "Connection permission denied."],
    ["保存中…", "Saving…"],
    ["保存失败，请点击重试保存。", "Save failed. Retry saving."],
    ["保存失败，编辑内容已保留，请重试。", "Save failed. Your edit is retained. Retry."],
    ["来源已有变化，请重新生成更新预览。", "Sources changed. Regenerate the update preview."],
    ["结果未能保存，草稿已保留，请重试。", "Could not save this result. Your draft is retained; retry."],
    ["保存失败，请重试后导出。", "Save failed. Retry before exporting."],
    ["请选择可调整的章节。", "Select available chapters."],
  ];
  const pair = known.find(values => values.includes(message));
  if (pair) return pair[zh ? 0 : 1];
  if (/\p{Script=Han}/u.test(message) === zh || !message) return message;
  return text("操作未完成，请重试。详细原因可在诊断信息中查看。", "The operation did not complete. Please retry; details are available in diagnostics.");
}
