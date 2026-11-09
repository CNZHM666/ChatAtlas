import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIQuickSelect } from "./AIQuickSelect";
import { getAISettings, saveAISettings } from "../../storage/knowledge-graph";
import { getDatabase } from "../../storage/db";

afterEach(async () => { cleanup(); await (await getDatabase()).clear("aiSettings"); });

describe("quick AI switching", () => {
  it("keeps saved connections and switches provider/model without a hosted AI option or an AI call", async () => {
    await saveAISettings({ mode: "byok", provider: "qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKey: "qwen-fixture", model: "qwen-plus", economyModel: "qwen-flash" });
    await saveAISettings({ mode: "byok", provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "openai-fixture", model: "test-main" });
    render(<AIQuickSelect zh onConfigure={vi.fn()} />);
    const select = await screen.findByRole("combobox", { name: "选择生成 AI" });
    await screen.findByRole("option", { name: /qwen-plus/ });
    expect(screen.getByRole("option", { name: "qwen-plus" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /通义千问|阿里云|OpenAI ·/ })).not.toBeInTheDocument();
    const option = screen.getByRole("option", { name: /qwen-flash/ }) as HTMLOptionElement;
    fireEvent.change(select, { target: { value: option.value } });
    await waitFor(async () => expect(await getAISettings()).toMatchObject({ mode: "byok", provider: "qwen", model: "qwen-flash", apiKey: "qwen-fixture" }));
    expect(screen.queryByRole("option", { name: "ChatAtlas AI" })).not.toBeInTheDocument();
    expect((await getAISettings())?.connections?.some((item) => item.model === "test-main")).toBe(true);
  });

  it("opens configuration without overwriting the chosen AI", async () => {
    const configure = vi.fn();
    render(<AIQuickSelect zh={false} onConfigure={configure} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect AI" }));
    expect(configure).toHaveBeenCalledOnce();
    expect(await getAISettings()).toBeUndefined();
  });

  it("reports an unconfigured API and contains no shared-service option", async () => {
    const ready = vi.fn();
    render(<AIQuickSelect zh onConfigure={vi.fn()} onReady={ready} />);
    await waitFor(() => expect(ready).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("option", { name: "ChatAtlas AI" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "连接 AI" })).toBeEnabled();
  });

  it("groups models by provider and manages connections from a button, not a list option", async () => {
    await saveAISettings({ mode: "byok", provider: "qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKey: "qwen-fixture", model: "qwen-plus" });
    await saveAISettings({ mode: "byok", provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiKey: "deepseek-fixture", model: "deepseek-chat" });
    const configure = vi.fn();
    const { container } = render(<AIQuickSelect zh onConfigure={configure} />);
    await screen.findByRole("option", { name: "qwen-plus" });
    expect([...container.querySelectorAll("optgroup")].map(group => group.label)).toEqual(["通义千问 / 阿里云百炼", "DeepSeek"]);
    expect(screen.queryByRole("option", { name: /管理/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "连接 / 管理 AI" }));
    expect(configure).toHaveBeenCalledOnce();
    expect((await getAISettings())?.model).toBe("deepseek-chat");
  });
});
