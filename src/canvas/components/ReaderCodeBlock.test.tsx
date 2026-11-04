import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReaderCodeBlock } from "./ReaderCodeBlock";

const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
afterEach(() => {
  cleanup();
  if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

it("copies the original source rather than the normalized SVG text", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const source = "┌────────┐\n│中文 │\n│🟢 AI │\n└────────┘\n";
  render(<ReaderCodeBlock zh copy><code className="language-text">{source}</code></ReaderCodeBlock>);
  expect(screen.getByRole("img", { name: "文本示意图" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "复制原文" }));
  expect(writeText).toHaveBeenCalledExactlyOnceWith(source);
});

it("keeps highlighted program text intact and does not interpret markup as UI", () => {
  const { container } = render(<ReaderCodeBlock zh copy><code className="language-typescript"><span className="hljs-keyword">interface</span>{' Message {\n  content: "<script>run()</script>";\n}'}</code></ReaderCodeBlock>);
  expect(container.querySelector("pre code.language-typescript")).toHaveTextContent('interface Message { content: "<script>run()</script>"; }');
  expect(container.querySelector("script")).toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByRole("button", { name: "复制代码" })).toBeInTheDocument();
});

it("shows an isolated HTML preview and keeps the original code available", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const source = '<section><h2>1. 选择项目</h2><p>关联已有项目</p></section>';
  const { container } = render(<ReaderCodeBlock zh copy><code className="language-html">{source}</code></ReaderCodeBlock>);
  expect(screen.getByTitle("原文界面预览")).toHaveAttribute("sandbox", "");
  expect(container.querySelector("iframe")?.srcdoc).toContain("选择项目");
  fireEvent.click(screen.getByRole("button", { name: "代码" }));
  expect(container.querySelector("pre code")?.textContent).toBe(source);
  expect(container.querySelector("iframe")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "复制原文" }));
  expect(writeText).toHaveBeenCalledExactlyOnceWith(source);
});
