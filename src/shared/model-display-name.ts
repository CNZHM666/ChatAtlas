/**
 * Format raw lowercase provider model IDs (e.g. `qwen3.8-flash`, `deepseek-chat`, `gpt-4o-mini`)
 * into clean, brand-accurate display names (`Qwen3.8-Flash`, `DeepSeek-Chat`, `GPT-4o-Mini`).
 *
 * Purely visual — never mutate the stored/API model ID.
 */

const EXACT_TOKENS: Record<string, string> = {
  ai: "AI",
  api: "API",
  asr: "ASR",
  baichuan: "Baichuan",
  chat: "Chat",
  chatgpt: "ChatGPT",
  claude: "Claude",
  coder: "Coder",
  codex: "Codex",
  deepseek: "DeepSeek",
  doubao: "Doubao",
  embed: "Embed",
  embedding: "Embedding",
  ernie: "ERNIE",
  fast: "Fast",
  flash: "Flash",
  gemini: "Gemini",
  gemma: "Gemma",
  glm: "GLM",
  gpt: "GPT",
  grok: "Grok",
  haiku: "Haiku",
  hunyuan: "Hunyuan",
  instruct: "Instruct",
  kimi: "Kimi",
  latest: "Latest",
  lite: "Lite",
  llama: "Llama",
  long: "Long",
  math: "Math",
  max: "Max",
  mini: "Mini",
  minimax: "MiniMax",
  mistral: "Mistral",
  mixtral: "Mixtral",
  moonshot: "Moonshot",
  nano: "Nano",
  nova: "Nova",
  ocr: "OCR",
  omni: "Omni",
  openai: "OpenAI",
  opus: "Opus",
  plus: "Plus",
  preview: "Preview",
  pro: "Pro",
  qwen: "Qwen",
  qwq: "QwQ",
  reasoner: "Reasoner",
  seed: "Seed",
  sonnet: "Sonnet",
  spark: "Spark",
  step: "Step",
  thinking: "Thinking",
  tts: "TTS",
  turbo: "Turbo",
  ultra: "Ultra",
  vision: "Vision",
  vl: "VL",
  yi: "Yi",
};

const PREFIX_BRANDS: Array<[RegExp, string]> = [
  [/^deepseek(?=\d)/i, "DeepSeek"],
  [/^minimax(?=\d)/i, "MiniMax"],
  [/^chatgpt(?=\d)/i, "ChatGPT"],
  [/^hunyuan(?=\d)/i, "Hunyuan"],
  [/^moonshot(?=\d)/i, "Moonshot"],
  [/^baichuan(?=\d)/i, "Baichuan"],
  [/^claude(?=\d)/i, "Claude"],
  [/^doubao(?=\d)/i, "Doubao"],
  [/^gemini(?=\d)/i, "Gemini"],
  [/^mistral(?=\d)/i, "Mistral"],
  [/^mixtral(?=\d)/i, "Mixtral"],
  [/^ernie(?=\d)/i, "ERNIE"],
  [/^gemma(?=\d)/i, "Gemma"],
  [/^llama(?=\d)/i, "Llama"],
  [/^spark(?=\d)/i, "Spark"],
  [/^qwen(?=\d)/i, "Qwen"],
  [/^kimi(?=\d)/i, "Kimi"],
  [/^grok(?=\d)/i, "Grok"],
  [/^nova(?=\d)/i, "Nova"],
  [/^seed(?=\d)/i, "Seed"],
  [/^step(?=\d)/i, "Step"],
  [/^qwq(?=\d)/i, "QwQ"],
  [/^glm(?=\d)/i, "GLM"],
  [/^gpt(?=\d)/i, "GPT"],
  [/^yi(?=\d)/i, "Yi"],
];

function formatToken(token: string): string {
  if (!token) return token;
  // Already contains intentional uppercase characters (e.g. "Qwen3.8", "ChatGLM", "GPT-4o").
  if (/[A-Z]/.test(token)) return token;
  const lower = token.toLowerCase();
  if (EXACT_TOKENS[lower]) return EXACT_TOKENS[lower];

  // Brand immediately followed by version digits (e.g. "qwen3.8" -> "Qwen3.8", "gpt4o" -> "GPT4o").
  for (const [pattern, replacement] of PREFIX_BRANDS) {
    if (pattern.test(token)) return token.replace(pattern, replacement);
  }

  // Parameter sizes like 7b, 32b, 72b, 128k, 32k; versions like r1, v3, k2, a3b.
  if (/^\d+(?:\.\d+)?[bk]$/i.test(token)) return token.toUpperCase();
  if (/^[rvk]\d+(?:\.\d+)?$/i.test(token)) return token.toUpperCase();
  if (/^a\d+b$/i.test(token)) return token.toUpperCase();

  // Keep OpenAI o-series (`o1`, `o3`, `o4`) and pure digits/dates (`4o`, `20250219`) clean.
  if (/^o\d+$/i.test(token) || /^\d/.test(token)) return token;

  // Generic lowercase word segment: capitalize first ASCII letter.
  return token[0].toUpperCase() + token.slice(1);
}

export function formatModelDisplayName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // Preserve vendor/model slash structure while formatting each path segment cleanly.
  return trimmed
    .split("/")
    .map((segment) =>
      segment
        .split(/([-_:])/u)
        .map((part, index) => (index % 2 === 1 ? part : formatToken(part)))
        .join(""),
    )
    .join(" / ");
}
