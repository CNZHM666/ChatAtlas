import { describe, expect, it, vi } from "vitest";
import { fallbackKnowledgeTitle, suggestKnowledgeTitle } from "./knowledge-intent";
import type { AtlasAIProvider } from "./provider";

describe("Knowledge Space title", () => {
  it("removes request wording from common Chinese goals", () => {
    expect(fallbackKnowledgeTitle("整理一下C语言")).toBe("C语言");
    expect(fallbackKnowledgeTitle("帮我整理一下C语言")).toBe("C语言");
    expect(fallbackKnowledgeTitle("整理我关于控制理论的学习内容")).toBe("控制理论");
    expect(fallbackKnowledgeTitle("把 Python 与 NumPy 学习笔记整理成知识空间")).toBe("Python 与 NumPy");
    expect(fallbackKnowledgeTitle("请帮我复习状态空间相关的讨论")).toBe("状态空间");
    expect(fallbackKnowledgeTitle("Please organize my notes on control theory")).toBe("control theory");
  });

  it("uses the model's subject title and falls back if interpretation fails", async () => {
    const provider = { decide: vi.fn().mockResolvedValue("C语言学习"), generateStructured: vi.fn() } as unknown as AtlasAIProvider;
    expect(await suggestKnowledgeTitle("整理一下C语言", provider)).toBe("C语言学习");
    expect(provider.decide).toHaveBeenCalledOnce();
    const failing = { decide: vi.fn().mockRejectedValue(new Error("offline")), generateStructured: vi.fn() } as unknown as AtlasAIProvider;
    expect(await suggestKnowledgeTitle("整理一下C语言", failing)).toBe("C语言");
  });

  it("uses a local title for ChatAtlas AI without spending a hosted request", async () => {
    const provider = { id: "atlas-demo", decide: vi.fn(), generateStructured: vi.fn() } as unknown as AtlasAIProvider;
    expect(await suggestKnowledgeTitle("整理一下C语言", provider)).toBe("C语言");
    expect(provider.decide).not.toHaveBeenCalled();
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });
});
