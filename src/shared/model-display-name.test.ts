import { describe, expect, it } from "vitest";
import { formatModelDisplayName } from "./model-display-name";

describe("formatModelDisplayName", () => {
  it("formats common lowercase provider model IDs with proper brand capitalization", () => {
    expect(formatModelDisplayName("qwen3.8-flash")).toBe("Qwen3.8-Flash");
    expect(formatModelDisplayName("qwen-plus")).toBe("Qwen-Plus");
    expect(formatModelDisplayName("qwen3-32b-instruct")).toBe("Qwen3-32B-Instruct");
    expect(formatModelDisplayName("qwq-32b")).toBe("QwQ-32B");
    expect(formatModelDisplayName("deepseek-chat")).toBe("DeepSeek-Chat");
    expect(formatModelDisplayName("deepseek-r1")).toBe("DeepSeek-R1");
    expect(formatModelDisplayName("gpt-4o-mini")).toBe("GPT-4o-Mini");
    expect(formatModelDisplayName("o3-mini")).toBe("o3-Mini");
    expect(formatModelDisplayName("claude-sonnet-4")).toBe("Claude-Sonnet-4");
    expect(formatModelDisplayName("gemini-2.5-flash")).toBe("Gemini-2.5-Flash");
    expect(formatModelDisplayName("glm-4-plus")).toBe("GLM-4-Plus");
    expect(formatModelDisplayName("kimi-k2-preview")).toBe("Kimi-K2-Preview");
    expect(formatModelDisplayName("openai/gpt-4o")).toBe("OpenAI / GPT-4o");
  });

  it("preserves names that already include intentional capitalization", () => {
    expect(formatModelDisplayName("Qwen3.8-Flash")).toBe("Qwen3.8-Flash");
    expect(formatModelDisplayName("Vendor/Qwen3.8-Flash")).toBe("Vendor / Qwen3.8-Flash");
  });
});
