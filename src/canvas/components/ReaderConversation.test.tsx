import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationMessage } from "../../shared/types";
import { ReaderConversation } from "./ReaderConversation";

const message = (index: number, content: string): ConversationMessage => ({
  id: `message-${index}`, conversationId: "conversation", messageIndex: index, role: "assistant", content, preview: content.slice(0, 20), contentHash: String(index), createdAt: 1, updatedAt: 1,
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("uses original offsets to highlight the second occurrence of an identical paragraph", async () => {
  const content = "重复关键词。\n\n重复关键词。", start = content.lastIndexOf("关键词");
  const { container } = render(<ReaderConversation messages={[message(0, content)]} zh focusMessageId="message-0" focusRange={{ start, end: start + 3, part: "content", excerpt: "关键词" }} />);
  await waitFor(() => expect(container.querySelector(".reader-evidence-target")).toBe(container.querySelectorAll("p")[1]));
  expect(container.querySelectorAll("p")[1]).toHaveAttribute("data-reader-source-start", String(content.lastIndexOf("重复")));
});

it("falls back to the saved message when old offsets no longer agree with edited source", async () => {
  const { container } = render(<ReaderConversation messages={[message(0, "Changed paragraph\n\nkeyword elsewhere")]} zh focusMessageId="message-0" focusRange={{ start: 0, end: 7, excerpt: "keyword" }} />);
  await waitFor(() => expect(container.querySelector(".reader-evidence-target")).toHaveAttribute("data-reader-message-id", "message-0"));
});

it("locates a retained UI field instead of applying its coordinates to body Markdown", async () => {
  const item = { ...message(0, "intro\n【原平台交互内容】\nUIKeyword\n\nconclusion"), uiParts: [{ ordinal: 0, raw: "{}", fallbackText: "UIKeyword" }] };
  const { container } = render(<ReaderConversation messages={[item]} zh focusMessageId="message-0" focusRange={{ start: 0, end: 9, part: "ui", partIndex: 0, excerpt: "UIKeyword" }} />);
  await waitFor(() => expect(container.querySelector(".reader-evidence-target")).toHaveAttribute("data-reader-ui-part", "0"));
});

it("uses the same horizontal stage presentation for original discussions", () => {
  const content = "用户流程：\n\n1. 欢迎页\n2. 对话确认\n3. 方案草稿\n4. 验证\n5. 调试";
  const { container } = render(<ReaderConversation messages={[message(0, content)]} zh />);
  expect(container.querySelectorAll(".reading-stage-flow li")).toHaveLength(5);
  expect(container.querySelector(".reading-stage-flow")).toHaveTextContent("欢迎页 对话确认 方案草稿 验证 调试");
  expect(content).toContain("5. 调试");
  expect(container.querySelector(".reading-stage-flow.is-steps")).toBeNull();
});

it("reads sentence-length steps as a numbered column, not cards", () => {
  const content = "阶段1：首次安装与启动\n\n1. 用户从 Chrome Web Store 安装「专注计时器」，或通过开发者模式加载扩展。\n2. 用户点击浏览器右上角的扩展图标。\n3. 首次打开后直接进入计时首页，不要求注册、登录或完成引导问卷。";
  const { container } = render(<ReaderConversation messages={[message(0, content)]} zh />);
  expect(container.querySelector(".reading-stage-flow")).toHaveClass("is-steps");
});

it("renders retained UI between its original paragraphs and offers source for native-only components", () => {
  const messages = [{ ...message(0, '前提\n【原平台交互内容】\n结论'), id: "chatgpt:conversation:0", uiParts: [{ ordinal: 0, raw: '{"type":"html","text":"<section><h2>选择项目</h2><p>组织上下文</p></section>"}' }] }, { ...message(1, 'genui{"quiz":{"id":"native-only"}}\n后续条件'), id: "chatgpt:conversation:1" }];
  const { container } = render(<ReaderConversation messages={messages} zh />);
  expect(container.querySelector(".reader-ui-preview iframe")).toHaveAttribute("sandbox", "");
  expect(container.querySelector(".reader-ui-preview iframe")?.getAttribute("srcdoc")).toContain("组织上下文");
  expect(container.querySelector('[data-reader-message-id="chatgpt:conversation:0"]')?.textContent).toMatch(/前提.*界面快照.*结论/u);
  expect(screen.getByRole("link", { name: "查看原文" })).toHaveAttribute("href", "https://chatgpt.com/c/conversation");
  expect(container).toHaveTextContent("后续条件");
  expect(container).not.toHaveTextContent("native-only");
});

it("does not scroll back to a citation when the reader loads more, but allows an explicit repeat jump", async () => {
  const scroll = vi.fn();
  vi.stubGlobal("HTMLElement", HTMLElement);
  HTMLElement.prototype.scrollIntoView = scroll;
  const messages = Array.from({ length: 100 }, (_, index) => message(index, `Turn ${index}`));
  const { rerender } = render(<ReaderConversation messages={messages} zh={false} focusMessageId="message-20" />);
  await waitFor(() => expect(scroll).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: /Continue reading/ }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(scroll).toHaveBeenCalledOnce();
  rerender(<ReaderConversation messages={messages} zh={false} focusMessageId="message-20" focusNonce={1} />);
  await waitFor(() => expect(scroll).toHaveBeenCalledTimes(2));
});

it("shows complete plain text while offscreen Markdown waits for its render turn", () => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  const { container } = render(<ReaderConversation messages={Array.from({ length: 5 }, (_, i) => message(i, `完整正文 ${i}`))} zh={true} />);
  expect(container.querySelectorAll("[aria-busy=true]")).toHaveLength(3);
  expect(container).toHaveTextContent("完整正文 4");
});

describe("conversation reading", () => {
  it("shows oversized text immediately and automatically loads formatting without a click", async () => {
    const content = "$x^2$ " + "long text ".repeat(2500);
    const { container } = render(<ReaderConversation messages={[message(0, content)]} zh={false} />);
    expect(container.querySelector(".reader-long-text")?.textContent).toBe(content);
    expect(container.querySelector(".katex")).toBeNull();
    expect(screen.queryByRole("button", { name: /Load formatting/ })).toBeNull();
    await waitFor(() => expect(container.querySelector(".katex")).not.toBeNull());
    expect(container.querySelector(".reader-long-text")).toBeNull();
  });
  it("renders mathematics and highlighted code in the reader", async () => {
    const { container } = render(<ReaderConversation messages={[message(0, "$x^2$\n\n```js\nconst value = 1\n```")] } zh={false} />);
    await waitFor(() => expect(container.querySelector(".katex")).not.toBeNull());
    await waitFor(() => expect(container.querySelector(".hljs")).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Copy code" })).toBeNull();
  });

  it("renders bracketed display math and skips internal query turns", async () => {
    const { container } = render(<ReaderConversation messages={[{ ...message(0, "What is the state equation?"), role: "user" }, message(1, '{"query":"state equation"}'), message(2, "[ \\dot{x}=Ax+Bu ]")] } zh={false} />);
    await waitFor(() => expect(container.querySelector(".katex-display")).not.toBeNull());
    expect(container.querySelectorAll("[data-reader-message-id]")).toHaveLength(2);
    expect(screen.queryByText("Other messages in the original conversation")).not.toBeInTheDocument();
  });

  it("loads a long conversation in bounded sections", () => {
    render(<ReaderConversation messages={Array.from({ length: 161 }, (_, index) => message(index, `Turn ${index}`))} zh={false} />);
    expect(screen.getByText("Turn 23")).toBeVisible();
    expect(screen.queryByText("Turn 24")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Continue reading/ }));
    expect(screen.getByText("Turn 47")).toBeVisible();
  });

  it("opens a late message without parsing all preceding turns, and allows earlier reading", () => {
    const messages = Array.from({ length: 300 }, (_, index) => message(index, `Focus turn ${index}`));
    const { container, rerender } = render(<ReaderConversation messages={messages} zh={false} focusMessageId="message-280" />);
    expect(screen.getByText("Focus turn 280")).toBeVisible();
    expect(screen.queryByText("Focus turn 0")).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-reader-message-id]").length).toBeLessThanOrEqual(24);
    fireEvent.click(screen.getByRole("button", { name: /Read earlier/ }));
    expect(screen.getByText("Focus turn 254")).toBeVisible();
    rerender(<ReaderConversation messages={messages} zh={false} focusMessageId="message-20" />);
    expect(screen.getByText("Focus turn 20")).toBeVisible();
    expect(screen.queryByText("Focus turn 280")).not.toBeInTheDocument();
  });

  it("bounds a page by text volume while keeping complete messages and actual gaps", () => {
    const messages = Array.from({ length: 10 }, (_, index) => message(index, `${index}:` + "完整正文".repeat(2500)));
    const { container } = render(<ReaderConversation messages={messages} zh={false} />);
    expect(container.querySelectorAll("[data-reader-message-id]")).toHaveLength(2);
    expect(container.textContent).toContain(messages[1].content);
  });

  it("keeps an expanded reading range when captured messages refresh", () => {
    const messages = Array.from({ length: 100 }, (_, index) => message(index, `Saved turn ${index}`));
    const { rerender } = render(<ReaderConversation messages={messages} zh={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Continue reading/ }));
    rerender(<ReaderConversation messages={[...messages, message(100, "New turn")]} zh={false} />);
    expect(screen.getByText("Saved turn 47")).toBeVisible();
  });
});

it("opens a cited reply at its question even after many assistant replies and highlights only the cited block", async () => {
  const landings: HTMLElement[] = [];
  HTMLElement.prototype.scrollIntoView = vi.fn(function(this: HTMLElement) { landings.push(this); });
  const messages = [{ ...message(0, "Which products should I study?"), role: "user" as const }, ...Array.from({ length: 30 }, (_, i) => message(i + 1, `Reply ${i}`)), message(31, "Opening context\n\nThe relevant finding\n\nMore explanation")];
  const { container } = render(<ReaderConversation messages={messages} zh={false} focusMessageId="message-31" focusExcerpt="The relevant finding" focusPlacement="question" />);
  await waitFor(() => expect(landings).toHaveLength(1));
  expect(landings[0].dataset.readerMessageId).toBe("message-0");
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  expect(container.querySelectorAll(".reader-evidence-target")).toHaveLength(1);
  expect(container.querySelector(".reader-evidence-target")?.textContent).toBe("The relevant finding");
});
it("preserves exact paragraph navigation for message search and falls back to the cited message if no question exists", async () => {
  const landings: HTMLElement[] = [];
  HTMLElement.prototype.scrollIntoView = vi.fn(function(this: HTMLElement) { landings.push(this); });
  const messages = [message(0, "Opening\n\nExact search finding\n\nClosing")];
  const { rerender } = render(<ReaderConversation messages={messages} zh={false} focusMessageId="message-0" focusExcerpt="Exact search finding" focusPlacement="evidence" />);
  await waitFor(() => expect(landings).toHaveLength(1)); expect(landings[0].textContent).toBe("Exact search finding");
  rerender(<ReaderConversation messages={messages} zh={false} focusMessageId="message-0" focusExcerpt="Exact search finding" focusPlacement="question" />);
  await waitFor(() => expect(landings).toHaveLength(2)); expect(landings[1].dataset.readerMessageId).toBe("message-0");
});

it("displays consecutive replies to one question with one AI label and one focused answer frame while preserving every source ID", async () => {
  const messages = [ { ...message(0, "My question"), role: "user" as const }, message(1, "First response part"), message(2, "Second response part"), message(3, "Final response part"), { ...message(4, "Next question"), role: "user" as const }, message(5, "Next answer") ];
  const landings: HTMLElement[] = [], original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = vi.fn(function(this: HTMLElement) { landings.push(this); });
  try {
    const { container } = render(<ReaderConversation messages={messages} zh={false} focusMessageId="message-2" />);
    await waitFor(() => expect(landings).toHaveLength(1)); expect(landings[0].dataset.readerMessageId).toBe("message-0");
    const labels = [...container.querySelectorAll(".knowledge-reader-message > span")].filter(item => item.textContent === "AI");
    expect(labels).toHaveLength(2);
    expect(container.querySelectorAll("[data-reader-message-id]")).toHaveLength(6);
    const highlighted = container.querySelectorAll(".is-highlighted-reply"); expect(highlighted).toHaveLength(3);
    expect(highlighted[0]).toHaveClass("is-reply-start"); expect(highlighted[2]).toHaveClass("is-reply-end");
    expect(screen.getByText("First response part")).toBeInTheDocument(); expect(screen.getByText("Final response part")).toBeInTheDocument();
  } finally { HTMLElement.prototype.scrollIntoView = original; }
});
it("never joins different reply owners or omitted context, but joins across an internal search request", () => {
  const question = { ...message(0, "Question"), role: "user" as const };
  const count = (container: HTMLElement) => [...container.querySelectorAll(".knowledge-reader-message > span")].filter(item => item.textContent === "AI").length;
  const { container, rerender } = render(<ReaderConversation messages={[question, { ...message(1, "Answer A"), replyToMessageId: question.id }, { ...message(2, "Other branch"), replyToMessageId: "other-question" }]} zh={false} />);
  expect(count(container)).toBe(2);
  rerender(<ReaderConversation messages={[question, message(1, "Answer A"), message(3, "Answer after missing discussion")]} zh={false} />);
  expect(count(container)).toBe(2); expect(screen.getByText("Other messages in the original conversation")).toBeInTheDocument();
  rerender(<ReaderConversation messages={[question, message(1, "Answer A"), message(2, '{"query":"private tool request"}'), message(3, "Final answer")]} zh={false} />);
  expect(count(container)).toBe(1); expect(screen.queryByText("private tool request")).not.toBeInTheDocument(); expect(screen.getByText("Final answer")).toBeInTheDocument();
});
it("highlights only matched characters rather than a whole question or answer", async () => {
  const highlights = new Map(); vi.stubGlobal("CSS", { highlights }); vi.stubGlobal("Highlight", class { constructor(public range: Range) {} });
  const messages = [{ ...message(0, "介绍 Orama 索引的配置和使用方式"), role: "user" as const }, message(1, "An unrelated detailed answer")];
  const { container } = render(<ReaderConversation messages={messages} zh focusMessageId="message-0" focusRange={{ start: 3, end: 8, excerpt: "Orama" }} highlightTurn={false}/>);
  await waitFor(() => expect(highlights.get("atlas-reader-proof")?.range.toString()).toBe("Orama"));
  expect(container.querySelectorAll(".is-selected-turn, .is-highlighted-reply")).toHaveLength(0);
  expect(highlights.get("atlas-reader-proof").range.toString()).not.toBe(messages[0].content);
});
