import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SourceMessageContent } from "./SourceMessageContent";
afterEach(cleanup);
it("renders source paragraphs, exported links, malformed spaced emphasis and literal fenced code", () => {
  const original = '## 最近讨论\n\n我查看了 <Link url="https://github.com/example/repo" title="项目仓库"/>。\n\n** 已发现更新放缓，但不能认定放弃。 **\n\n- 条件一\n- 条件二\n\n```ts\nconst x = "<Link url=\\"javascript:bad\\"/>";\n```';
  const { container } = render(<SourceMessageContent content={original} zh />);
  expect(screen.getByRole("heading", {name:"最近讨论"})).toBeInTheDocument();
  expect(screen.getByRole("link", {name:"项目仓库"})).toHaveAttribute("href", "https://github.com/example/repo");
  expect(container.querySelector("strong")).toHaveTextContent("已发现更新放缓");
  expect(container.querySelectorAll("li")).toHaveLength(2); expect(container.querySelector("pre")).toHaveTextContent("<Link url=");
  expect(original).toContain("<Link url=");
});
it("renders formulas through the same lazy math renderer as the Reader", async () => {
  const { container } = render(<SourceMessageContent content={"已知 \\(x^2\\)。\n\n$$\n\\frac{dz}{dt}=\\frac{2+1/\\sqrt{t}}{2+2t+2\\sqrt{t}}\n$$"} zh />);
  await waitFor(() => expect(container.querySelectorAll(".katex")).toHaveLength(2));
  expect(container.querySelector(".katex-error")).toBeNull(); expect(container.querySelector(".katex-display")).toBeInTheDocument();
});
