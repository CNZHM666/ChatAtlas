import { Bot, Layers3 } from "lucide-react";
import { conversationPlatformGroup } from "../../shared/platforms";
import chatgpt from "../../assets/ai/openai.svg";
import claude from "../../assets/ai/claude-color.svg";
import gemini from "../../assets/ai/gemini-color.svg";
import deepseek from "../../assets/ai/deepseek-color.svg";
import kimi from "../../assets/ai/kimi.svg";
import doubao from "../../assets/ai/doubao-color.svg";
import qwen from "../../assets/ai/qwen-color.svg";
import grok from "../../assets/ai/grok.svg";
import yuanbao from "../../assets/ai/yuanbao.svg";
import zhipu from "../../assets/ai/zhipu-color.svg";
import perplexity from "../../assets/ai/perplexity-color.svg";
import copilot from "../../assets/ai/copilot-color.svg";
import mistral from "../../assets/ai/mistral-color.svg";

const ICONS = new Map(Object.entries({ chatgpt, claude, gemini, deepseek, kimi, doubao, qwen, grok, yuanbao, zhipu, perplexity, copilot, mistral }));
const MONO = new Set(["chatgpt", "kimi", "grok", "yuanbao"]);

/** Decorative source marks, bundled locally; the adjacent text owns the label. */
export function AIPlatformIcon({ platform }: { platform: string }) {
  const id=conversationPlatformGroup(platform), source=ICONS.get(id);
  return <span className={`ai-platform-icon${id==="yuanbao"?" is-yuanbao":""}`} aria-hidden="true">
    {source ? MONO.has(id) ? <span className="ai-platform-icon-mask" style={{maskImage:`url("${source}")`,WebkitMaskImage:`url("${source}")`}}/> : <img src={source} width={20} height={20} alt=""/> : id ? <Bot size={19}/> : <Layers3 size={18}/>}
  </span>;
}
