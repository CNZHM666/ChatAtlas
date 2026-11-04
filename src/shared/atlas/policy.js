// Shared by the browser and the server. Estimates are not provider billing usage.
export const POLICY_VERSION = "8";
// Planning-only revision; generation semantics and validated caches stay valid.
export const TOKEN_ESTIMATE_VERSION = "2";
// Count is an abuse guard; token/byte budgets determine generation batches.
export const MAX_FOCUS_PASSAGES = 256;

/** Atlas's bounded JSON tasks need visible output, not default hidden reasoning.
 * Only documented endpoint/model combinations receive vendor parameters.
 * Model discovery and opaque IDs remain unchanged; mandatory thinking stays enabled.
 */
export function generationProfile(baseUrl, modelId = "") {
  const basic = { parameters: {}, reasoningReserve: 0, tokenParameter: "max_tokens", omitTemperature: false, jsonMode: false };
  let url;
  try { url = new URL(baseUrl); } catch { return basic; }
  if (url.protocol !== "https:") return basic;
  const model = modelId.toLowerCase();
  const name = model.split("/").at(-1);
  const profile = (parameters, reasoningReserve = 0, extra = {}) => ({ ...basic, parameters, reasoningReserve, ...extra });
  const hybridDeepSeek = /(?:^|\/)deepseek-v(?:4(?:\.\d+)?-(?:flash|pro)|3\.(?:1|2))(?:-|$)/u.test(model);
  const forced = /thinking|reasoner|(?:^|-)r1(?:-|$)|ernie-x1|hunyuan-t1|step-[35]/u.test(name);
  const glmForced = /^glm-5\.3(?:-|$)/u.test(name);
  const glmHybrid = /^glm-(?:4\.[567]|5(?:\.[12])?)(?:-|$)/u.test(name);
  const kimiHybrid = /^kimi-k2\.[56](?:-|$)/u.test(name);
  const kimiForced = /^kimi-(?:k2\.7-code|k3)(?:-|$)/u.test(name);
  const qwenForced = /^qwen.*thinking/u.test(name);
  const dashscope = ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "cn-hongkong.dashscope.aliyuncs.com"].includes(url.hostname) || url.hostname.endsWith(".maas.aliyuncs.com");
  if (dashscope && /^\/compatible-mode\/v1\/?$/u.test(url.pathname)) {
    if (glmForced) return profile({ enable_thinking: true, reasoning_effort: "low" }, 4096);
    if (kimiForced) return profile(/^kimi-k3/u.test(name) ? { reasoning_effort: "low" } : {}, 4096, { omitTemperature: true });
    if (qwenForced || (!hybridDeepSeek && forced) || /^qwq/u.test(name)) return profile({}, 4096);
    if (hybridDeepSeek || /^qwen/u.test(name) || glmHybrid || kimiHybrid) return profile({ enable_thinking: false }, 0, { jsonMode: hybridDeepSeek || /^qwen/u.test(name), omitTemperature: kimiHybrid });
    if (/^minimax-m3$/u.test(name)) return profile({ thinking: { type: "disabled" } });
  }
  if (url.hostname === "api.deepseek.com" && /^(?:\/v1|\/beta)?\/?$/u.test(url.pathname) && (hybridDeepSeek || /^deepseek-(?:flash|chat|reasoner)$/u.test(model))) return profile({ thinking: { type: "disabled" } }, 0, { jsonMode: true });
  if (["api.moonshot.cn", "api.moonshot.ai"].includes(url.hostname) && /^\/v1\/?$/u.test(url.pathname)) {
    if (/^kimi-k3(?:-|$)/u.test(name)) return profile({ reasoning_effort: "low" }, 4096, { omitTemperature: true });
    if (kimiForced) return profile({}, 4096, { omitTemperature: true });
    if (kimiHybrid) return profile({ thinking: { type: "disabled" } }, 0, { omitTemperature: true });
  }
  if (["tokenhub.tencentmaas.com", "tokenhub-intl.tencentcloudmaas.com"].includes(url.hostname) && /^\/v1\/?$/u.test(url.pathname)) {
    if (glmForced || /^kimi-k3/u.test(name)) return profile({ thinking: { type: "enabled" }, reasoning_effort: "low" }, 4096, { omitTemperature: /^kimi/u.test(name) });
    if (/^minimax-m2/u.test(name)) return profile({}, 4096);
    if (/^(?:hy3|hy4-preview|glm-5v?-turbo)$/u.test(name) || glmHybrid || hybridDeepSeek || kimiHybrid) return profile({ thinking: { type: "disabled" } }, 0, { omitTemperature: kimiHybrid });
  }
  if (["open.bigmodel.cn", "api.z.ai"].includes(url.hostname)) {
    if (glmForced) return profile({ thinking: { type: "enabled" }, reasoning_effort: "low" }, 4096);
    if (glmHybrid || hybridDeepSeek) return profile({ thinking: { type: "disabled" } });
  }
  if (["api.minimaxi.com", "api.minimax.io"].includes(url.hostname)) {
    if (/^minimax-m3\.1(?:-|$)/u.test(name)) return profile({ reasoning_effort: "low", reasoning_split: true }, 4096);
    if (/^minimax-m3$/u.test(name)) return profile({ thinking: { type: "disabled" }, reasoning_split: true });
    if (/^minimax-m2/u.test(name)) return profile({ reasoning_split: true }, 4096);
  }
  if (["api.siliconflow.cn", "api.siliconflow.com"].includes(url.hostname) && /^\/v1\/?$/u.test(url.pathname)) {
    if (!forced && (hybridDeepSeek || /^qwen3/u.test(name) || glmHybrid || kimiHybrid)) return profile({ enable_thinking: false });
  }
  if (url.hostname === "ark.cn-beijing.volces.com" && /^\/api\/v3\/?$/u.test(url.pathname)) {
    if (/^doubao-seed-(?:1-[68]|2|3)(?:-|$)/u.test(name) || hybridDeepSeek || glmHybrid) return profile({ thinking: { type: "disabled" } });
  }
  if (url.hostname === "api.openai.com" && /^\/v1\/?$/u.test(url.pathname)) {
    const modern = /^gpt-[56](?:[.-]|$)/u.test(name);
    const oSeries = /^o[134](?:-|$)/u.test(name);
    if (modern || oSeries) {
      if (/-chat(?:-|$)/u.test(name)) return profile({}, 0, { tokenParameter: "max_completion_tokens" });
      if (/^o1-(?:preview|mini)(?:-|$)/u.test(name)) return profile({}, 8192, { tokenParameter: "max_completion_tokens", omitTemperature: true });
      const highOnly = /-pro(?:-|$)/u.test(name);
      const optional = !highOnly && !/codex/u.test(name) && /^gpt-(?:5\.[1-6](?:-|$)|6-(?:sol|luna)(?:-|$))/u.test(name);
      return profile({ reasoning_effort: highOnly ? "high" : optional ? "none" : "low" }, optional ? 0 : highOnly ? 8192 : 4096, { tokenParameter: "max_completion_tokens", omitTemperature: !optional });
    }
  }
  if (url.hostname === "openrouter.ai" && /^\/api\/v1\/?$/u.test(url.pathname)) {
    // OpenRouter normalizes reasoning controls across vendors. Opaque routing
    // IDs keep their baseline; known mandatory models receive a bounded effort.
    const mandatory = forced || glmForced || kimiForced || /^gemini-(?:2\.5-pro|3)/u.test(name) || /^claude-(?:fable|mythos)|^claude-(?:opus|sonnet)-5-5/u.test(name) || /^gpt-(?:5(?:-(?:mini|nano|pro))?$|6(?:\.1)?-(?:astra|sol))|^o[134](?:-|$)|^minimax-m[23]/u.test(name);
    if (mandatory && !hybridDeepSeek) {
      const highOnly = /^gpt-.*-pro(?:-|$)/u.test(name);
      return profile({ reasoning: { effort: highOnly ? "high" : "low" } }, highOnly ? 8192 : 4096, { omitTemperature: /^kimi|^gpt|^o[134]/u.test(name) });
    }
    if (hybridDeepSeek || kimiHybrid || glmHybrid || /^qwen3|^gemini-2\.5-flash|^gpt-5\.[1-6]|^gpt-6-luna/u.test(name)) return profile({ reasoning: { enabled: false } }, 0, { omitTemperature: kimiHybrid });
  }
  if (url.hostname === "api.anthropic.com" && /^\/v1\/?$/u.test(url.pathname)) {
    if (/^claude-sonnet-5-5(?:-|$)/u.test(name)) return profile({ thinking: { type: "between_tools" }, output_config: { effort: "low" } }, 1024);
    if (/^claude-(?:fable|mythos)|^claude-opus-5-5(?:-|$)/u.test(name)) return profile({ thinking: { type: "adaptive" }, output_config: { effort: "low" } }, 4096);
    if (/^claude-(?:opus|sonnet)-5(?:-|$)/u.test(name)) return profile({ thinking: { type: "disabled" }, output_config: { effort: "low" } });
    if (/^claude-(?:opus|sonnet|haiku)-4(?:-|$)/u.test(name) || /^claude-3-7/u.test(name)) return profile({ thinking: { type: "disabled" } });
  }
  if (url.hostname === "generativelanguage.googleapis.com" && /^\/v1beta\/?$/u.test(url.pathname)) {
    if (/^gemini-2\.5-flash/u.test(name)) return profile({ thinkingConfig: { thinkingBudget: 0 } });
    if (/^gemini-2\.5-pro/u.test(name)) return profile({ thinkingConfig: { thinkingBudget: 128 } }, 512);
    if (/^gemini-3(?:\.[1-8])?-(?:flash|pro)/u.test(name) && !/image/u.test(name)) {
      const minimal = /flash/u.test(name) && !/^gemini-3\.[78]-flash/u.test(name);
      return profile({ thinkingConfig: { thinkingLevel: minimal ? "minimal" : "low" } }, minimal ? 1024 : 4096);
    }
  }
  // Unknown and older APIs keep their documented baseline. Named reasoning-only
  // families still get a bounded output reserve, with no speculative parameters.
  return forced || glmForced || kimiForced ? profile({}, 4096) : basic;
}

export function estimateTokens(value, modelId = "") {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  let tokens = 0;
  // Conservative model-family estimates, with 15% headroom. Provider-reported
  // tokens always replace these estimates at settlement; this is not a tokenizer.
  const asciiCharacters = /^qwen|text-embedding/iu.test(modelId) ? 3.2 : /gpt|gemini|deepseek/iu.test(modelId) ? 3 : 2.8;
  const cjkTokens = /claude/iu.test(modelId) ? 1.8 : 1.4;
  for (const part of text.match(/\p{ASCII}+|\P{ASCII}/gu) || []) {
    tokens += /^\p{ASCII}+$/u.test(part) ? part.length / asciiCharacters : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(part) ? cjkTokens : 2;
  }
  return Math.ceil(tokens * 1.15);
}

/** Estimate the actual message contents once, not JSON-escaped transport bytes.
 * Retains the conservative script weights and message framing headroom.
 */
export function estimateMessageTokens(messages, modelId = "", legacy = false) {
  return (legacy ? estimateTokens(JSON.stringify(messages), modelId)
    : messages.reduce((sum, message) => sum + estimateTokens(message.content, modelId) + 12, 0)) + 128;
}

export function focusStrategy(intent = "", mode = "review") {
  if (mode === "work") return "work";
  if (mode === "answer") return "answer"; // Read older saved sessions.
  if (/复习|回顾|梳理|整理|学习路径|理解过程|review|revisit|recap|overview/iu.test(intent)) return "review";
  return /[?？]|为什么|怎么|如何|什么|是否|哪[个些]|找[回出到]|查找|答案|what|why|how|which|find|answer/iu.test(intent) ? "answer" : "review";
}

export function taskPolicy(taskType, data = {}, modelId = "", baseUrl = "") {
  const policy = baseTaskPolicy(taskType, data);
  return { ...policy, maxOutputTokens: policy.maxOutputTokens + (taskType === "embed" ? 0 : generationProfile(baseUrl, modelId).reasoningReserve) };
}

function baseTaskPolicy(taskType, data = {}) {
  if (taskType === "other" && data.presentation === "semantic_structure") return { maxInputTokens: 7000, maxOutputTokens: data.coverage?.stage === "structure:overview" ? 2200 : 3000 };
  if (taskType === "project_query_plan") return { maxInputTokens: 5000, maxOutputTokens: 700 };
  const count = data.questions?.length || data.conversations?.length || data.candidates?.length || data.newProfiles?.length || 1;
  if (taskType === "focus_session") {
    const strategy = data.strategy || focusStrategy(data.intent, data.mode);
    const mode = data.analysisMode || "balanced";
    // Many tiny messages still need room for exact citations. Concision must
    // never make the model omit source IDs merely to fit an output cap.
    const structureReserve = data.semanticStructure === true && data.presentation !== "project_query" ? data.coverage?.final ? 1200 : 800 : 0;
    const citationFloor = 600 + (data.passages?.length || 0) * 10;
    const characters = Array.isArray(data.passages) ? data.passages.reduce((sum, item) => sum + (typeof item?.text === "string" ? item.text.length : 0), 0) : Infinity;
    if (data.coverage?.stage && !data.coverage.final) {
      // The note prompt allows up to three 400-character notes. Chinese text
      // plus JSON/citations cannot reliably fit the former fixed 1500 cap.
      // Small batches retain their economical budget; this ceiling does not
      // request extra verbosity or invalidate successful cached notes.
      const notes = Math.min(data.passages?.length || 1, characters <= 2000 ? 1 : characters <= 5000 ? 2 : 3);
      const noteFloor = Math.ceil((350 + notes * (estimateTokens((data.locale === "zh-CN" ? "中" : "a").repeat(400)) + 180)) / 100) * 100;
      return { maxInputTokens: strategy === "work" ? 22000 : 14000, maxOutputTokens: Math.max(citationFloor, noteFloor, mode === "fast" ? 1200 : mode === "deep" ? 2000 : 1500) + (data.projectKnowledge === true && data.coverage.stage === "reading" ? 2600 : structureReserve) };
    }
    const short = characters <= 4000 && data.coverage?.stage !== "synthesis" && !data.revision;
    if (strategy === "review" && data.presentation === "reading_route" && !data.revision) return { maxInputTokens: 14000, maxOutputTokens: Math.max(citationFloor, short ? 2800 : mode === "fast" ? 4000 : mode === "deep" ? 8000 : 6000) + structureReserve };
    // A multi-topic reference needs room for mechanisms and their evidence.
    // This is a ceiling, not a verbosity target; reading/cache identities stay
    // unchanged. Budget actual assigned topics rather than every source note.
    const subtopics = Array.isArray(data.wikiTopics) ? data.wikiTopics.reduce((sum,topic)=>sum+(Array.isArray(topic?.subtopics)?topic.subtopics.length||1:1),0) : 0;
    const writing = data.coverage?.final && strategy === "work" && subtopics > 0;
    const writingOutput = writing ? Math.min(mode === "fast" ? 6000 : mode === "deep" ? 10000 : 8500, Math.max(5000, 1400 + subtopics * 950)) : 5000;
    const output = strategy === "answer" ? 1800 : strategy === "work" ? short ? 2600 : writingOutput : short ? 1800 : mode === "fast" ? 2400 : mode === "deep" ? 4000 : 3200;
    return { maxInputTokens: strategy === "answer" ? 7000 : strategy === "work" ? 22000 : 14000, maxOutputTokens: Math.max(citationFloor, output) + structureReserve };
  }
  if (taskType === "conversation_structure") return { maxInputTokens: 12000, maxOutputTokens: Math.min(6000, 1800 + count * 220) };
  if (taskType === "chapter_planning" && data.outlineOnly) return { maxInputTokens: 24000, maxOutputTokens: 4000 };
  if (taskType === "chapter_planning") return { maxInputTokens: 24000, maxOutputTokens: Math.min(10000, 1400 + count * 95) };
  if (taskType === "question_snapshot") return { maxInputTokens: 14000, maxOutputTokens: Math.min(5000, 350 + count * 340) };
  if (taskType === "conversation_profile") return { maxInputTokens: 18000, maxOutputTokens: Math.min(5000, 350 + count * 450) };
  if (taskType === "knowledge_planning") return { maxInputTokens: 20000, maxOutputTokens: Math.min(6500, 1800 + count * 200) };
  if (taskType === "embed") return { maxInputTokens: 16000, maxOutputTokens: 0 };
  return { maxInputTokens: 14000, maxOutputTokens: Math.min(4000, 300 + count * 220) };
}

export const economyTask = (taskType, data = {}) => data.qualityTier !== "main" && ["project_query_plan", "question_snapshot", "conversation_profile", "composition_judge", "source_retrieval", "insight_judge", "relation_judge", "global_merge"].includes(taskType);

export function safeConfigSummary(config) {
  const url = new URL(config.baseUrl);
  const region = url.hostname.includes("intl") ? "international" : url.hostname.includes("dashscope.aliyuncs.com") ? "china-mainland" : "custom";
  return { model: config.llmModel, economyModel: config.economyModel || config.llmModel, embeddingModel: config.embeddingModel, providerHost: url.hostname, region, regionInferred: true, pricesVerified: false, thinking: config.llmModel.startsWith("qwen") ? false : "provider-default", taskVersion: config.taskVersion, policyVersion: POLICY_VERSION,
    prices: { input: config.llmInputCnyPerMillion, output: config.llmOutputCnyPerMillion, economyInput: config.economyInputCnyPerMillion, economyOutput: config.economyOutputCnyPerMillion, embedding: config.embeddingCnyPerMillion },
    limits: { requests: config.maxRequests, inputTokens: config.maxInputTokens, outputTokens: config.maxOutputTokens, analyze: config.maxAnalyze, compose: config.maxCompose, dailyCny: config.dailyBudgetCny, monthlyCny: config.monthlyBudgetCny },
    priceWarning: region === "china-mainland" && config.llmModel === "qwen-plus" && (config.llmInputCnyPerMillion !== 0.8 || config.llmOutputCnyPerMillion !== 2) ? "Verify the configured prices against the provider bill for this model and region." : null };
}
