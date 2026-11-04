import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import { readerSanitizeSchema } from "./reader-sanitize";

afterEach(cleanup);

describe("reader math formatting", () => {
  it("keeps block and inline markers so boxed fractions and powers use the current KaTeX layout", () => {
    const { container } = render(<ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeSanitize, readerSanitizeSchema], rehypeKatex]}>{String.raw`平方 $x^2+y^2$。

$$
\boxed{\frac{dz}{dt}=\frac{2+\frac{1}{\sqrt{t}}}{2+2t+2\sqrt{t}}}
$$`}</ReactMarkdown>);
    expect(container.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.querySelector(".katex-display .fbox")).not.toBeNull();
    expect(container.querySelectorAll(".frac-line").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelector("math")?.textContent).toContain("x2+y2");
  });

  it("does not permit source scripts, javascript links or arbitrary code classes", () => {
    const { container } = render(<ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeSanitize, readerSanitizeSchema], rehypeKatex]} skipHtml>{"<script>alert(1)</script>\n\n[click](javascript:alert(1))\n\n```html\n<script>original example</script>\n```"}</ReactMarkdown>);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector("pre code")).toHaveTextContent("<script>original example</script>");
  });
});
