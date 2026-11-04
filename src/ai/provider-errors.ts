export interface ProviderOutputDiagnostics {
  outputTokenLimit: number;
  receivedCharacters: number;
  reasoningCharacters?: number;
  reasoningTokens?: number;
}
export interface WikiDirectoryIssue {
  path: string;
  reason: "required_text" | "text_too_long" | "invalid_source_list" | "empty_source_list";
  maxLength?: number;
}

/** Counts only: private or generated identifiers never enter usage exports. */
export function directoryValidationCounts(error:unknown) {
 const details=error instanceof AIProviderValidationError?error.wikiDirectoryDetails:undefined;
 return details?{missing:details.missingIds.length,duplicate:details.duplicateIds.length,unknown:details.unknownIds.length,parentMismatch:details.parentMismatchIds.length}:undefined;
}
export class AIProviderResponseError extends Error {
  constructor(readonly code: "PROVIDER_TIMEOUT" | "PROVIDER_OUTPUT_TRUNCATED" | "PROVIDER_EMPTY_RESPONSE" | "PROVIDER_STREAM_INCOMPLETE" | "PROVIDER_RESPONSE_REJECTED", readonly requestId?: string, readonly outputDiagnostics?: ProviderOutputDiagnostics) {
    super(code === "PROVIDER_OUTPUT_TRUNCATED" ? "生成内容达到上限，请缩小目标后重试。" : code === "PROVIDER_EMPTY_RESPONSE" ? "模型没有返回可用正文，请检查所选模型是否支持文本生成或调整来源后重试。" : code === "PROVIDER_STREAM_INCOMPLETE" ? "模型响应连接中断，结果尚未完成，用量可能已产生。请稍后重试。" : "模型响应等待超时，连接已取消；服务商用量可能已产生，请稍后重试。");
    this.name = "AIProviderResponseError";
    if (code === "PROVIDER_OUTPUT_TRUNCATED" && outputDiagnostics?.receivedCharacters === 0 && ((outputDiagnostics.reasoningCharacters ?? 0) > 0 || (outputDiagnostics.reasoningTokens ?? 0) > 0)) this.message = "模型思考耗尽输出额度，尚未生成正文。已完成的分析会保留，可切换支持非思考的模型后重试。";
    if (code === "PROVIDER_RESPONSE_REJECTED") this.message = "模型未完成文本回答，请检查所选模型或调整请求后重试。";
  }
}

export class AIProviderValidationError extends Error {
  /** Safe field locations/reasons only; response prose is never exported. */
  wikiClaimIssues?:Array<{path:string;reason:string}>;
  /** Ephemeral malformed metadata draft for a bounded, prose-preserving repair. */
  wikiClaimDraft?:unknown;
  /** Ephemeral response for bounded format repair; never persisted in diagnostics. */
  repairContent?: string;
  repairFields?: Array<{path:string;text:string}>;
  fieldPaths?: string[];
  /** Structural requirements only; never includes generated text or source content. */
  wikiDirectoryIssues?: WikiDirectoryIssue[];
  /** Request-local catalogue aliases only; no original messages or private source IDs. */
  wikiDirectoryDetails?: { missingIds: string[]; duplicateIds: string[]; unknownIds: string[]; parentMismatchIds: string[]; invalidAssignmentIds?: string[] };
  wikiDirectoryCounts?: {mainCount:number;maxMainCount:number;subtopicCount:number};
  /** Safe counts only, never model text or original source identifiers. */
  wikiOwnershipDetails?: {expectedSlots:number;receivedSlots:number;reason:"count"|"target"|"slot"};
  wikiPlanningResume?:{phase:"ownership"|"convergence";completed:number;remaining:number;reason:"budget"|"stalled"};
  /** Provisional writing only; excluded from exported request diagnostics. */
  wikiWritingDraft?:unknown;
  wikiMissingSubtopics?:Array<{ownerId:string;titles:string[]}>;
  readonly code: string;
  readonly requestId = undefined;
  constructor(reason: string, readonly citationDiagnostics?: { allowedEvidenceCount: number; unknownEvidenceCount: number; citationPaths: string[]; returnedSectionCount?: number; returnedNoteCount?: number }) { super(reason === "invalid_json" ? "模型返回的 JSON 格式不完整，请重试。已完成的阅读批次会保留。" : reason === "invalid_sections" ? "模型返回的章节数量或结构不符合要求，请重试。已完成的阅读批次会保留。" : reason === "wrong_output_language" ? "模型没有按所选语言生成，请重试。已完成的阅读批次会保留。" : reason === "invalid_section_type" ? "模型返回的章节类型不符合要求，请重试。已完成的阅读批次会保留。" : reason === "unknown_evidence_id" ? "模型引用了本次材料之外的编号，本次预览未保存。你选择的来源仍保留，重试会复用已完成的批次。" : "模型返回内容未通过结构或来源校验，请重试。已完成的阅读批次会保留。"); this.name = "AIProviderValidationError"; this.code = `PROVIDER_SCHEMA_${reason}`; if (reason === "wiki_owner_missing_or_unknown") this.message = "Wiki 正文章节缺少有效目录归属，本批正文尚未采用。已完成的材料分析会保留。"; if (reason === "wiki_owner_evidence_mismatch") this.message = "Wiki 正文引用与所属章节不一致，本批正文尚未采用。已完成的材料分析会保留。"; if (reason === "wiki_directory_missing_owner") this.message = "Wiki 正文遗漏了本批需要生成的章节，未保存不完整结果。已完成的材料分析会保留。"; if (reason === "missing_section_text") this.message = "模型漏写了章节标题或正文，将重新分析该批材料；已完成的批次会保留。"; }
}

export class AIProviderHttpError extends Error {
  readonly code: string;
  readonly requestId?: string;
  constructor(readonly status: number, detail: string, readonly retryAfterMs?: number, responseRequestId?: string) {
    let payload: { error?: { code?: string }; code?: string; request_id?: string } | undefined;
    try { payload = JSON.parse(detail) as typeof payload; } catch { /* Some proxies return text or HTML. */ }
    const modelNotFound = payload?.error?.code === "model_not_found" || payload?.code === "model_not_found";
    const missingJsonInstruction = status === 400 && /messages.*must contain.*json/iu.test(detail);
    const friendly: Record<number, string> = { 401: "API 密钥校验失败，请检查密钥和 API 地址。", 403: "当前 API 请求被拒绝，请核对模型授权及密钥所属地域/业务空间。", 404: "当前 API 地址或模型不可用，请核对接口路径与 API 模型 ID。", 429: "模型服务限流或额度不足，请稍后重试或检查服务商额度。" };
    super(modelNotFound ? `当前 API 接口找不到所选模型（HTTP ${status}）。请刷新模型列表选择模型，或核对 API 模型 ID、地址与密钥所属地域/业务空间。` : friendly[status] ? `${friendly[status]}（HTTP ${status}）` : status >= 500 ? `模型服务暂时不可用（HTTP ${status}），请稍后重试。` : `AI provider returned ${status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
    this.name = "AIProviderHttpError";
    if (missingJsonInstruction) this.message = "本次请求缺少 JSON 输出指令，模型服务拒绝处理。请更新扩展后重试。";
    this.code = modelNotFound ? "PROVIDER_MODEL_NOT_FOUND" : `PROVIDER_HTTP_${status}`;
    this.requestId = typeof payload?.request_id === "string" ? payload.request_id.slice(0, 200) : responseRequestId?.slice(0, 200);
  }
}
