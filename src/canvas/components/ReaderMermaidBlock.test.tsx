import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseMermaidDiagram } from "../mermaid-parse";
import { ReaderMermaidBlock } from "./ReaderMermaidBlock";
import { ReaderGuide } from "./ReaderGuide";

describe("ReaderMermaidBlock", () => {
  it("parses and renders flowchart TD/LR and erDiagram as themed SVG diagrams", () => {
    const flow = parseMermaidDiagram('flowchart TD\n  A["User"] --> B{Router}\n  B -->|simple| C[Local]\n  B -->|complex| D[LLM]\n  C --> E((Commit))');
    expect(flow?.kind).toBe("flowchart");
    if (flow?.kind === "flowchart") {
      expect(flow.nodes).toHaveLength(5);
      expect(flow.edges).toHaveLength(4);
      expect(flow.edges[1].label).toBe("simple");
    }

    const er = parseMermaidDiagram("erDiagram\n  PROJECT ||--o{ COMPONENT : contains\n  PROJECT {\n    string id PK\n    string name\n  }");
    expect(er?.kind).toBe("erDiagram");
    if (er?.kind === "erDiagram") {
      expect(er.entities).toHaveLength(2);
      expect(er.entities[0].fields).toHaveLength(2);
      expect(er.relations[0].label).toBe("contains");
    }

    const { container } = render(<ReaderMermaidBlock source={"flowchart LR\n  A[需求] --> B[校验] --> C[发布]"} zh />);
    expect(container.querySelector(".reader-mermaid-card svg")).not.toBeNull();
    expect(container.textContent).toContain("校验");
    fireEvent.click(screen.getByRole("button", { name: "放大查看" }));
    expect(screen.getByRole("dialog", { name: "流程图" })).toBeInTheDocument();
  });

  it("renders mermaid fences inside ReaderGuide and falls back cleanly for unsupported syntax", () => {
    const markdown = [
      "```mermaid",
      "flowchart TD",
      "  A[输入] --> B[验证]",
      "```",
      "",
      "```mermaid",
      "sequenceDiagram",
      "  Alice->>Bob: Hi",
      "```",
    ].join("\n");
    const { container } = render(<ReaderGuide content={markdown} zh complete />);
    expect(container.querySelectorAll(".reader-mermaid-card")).toHaveLength(1);
    expect(container.querySelector("pre code.language-mermaid")).toHaveTextContent("sequenceDiagram");
  });

  it("keeps table status cells clean plain text and renders structured steps in atlas-flow", () => {
    const markdown = [
      "```atlas-flow",
      "输入需求：描述目标",
      "自动校验：检查约束",
      "```",
      "",
      "| 项目 | 状态 |",
      "| --- | --- |",
      "| 本地存储 | 已定 |",
      "| 云端同步 | 延后 |",
    ].join("\n");
    const { container } = render(<ReaderGuide content={markdown} zh complete />);
    expect(container.querySelector(".reading-flow-step-title")).toHaveTextContent("输入需求");
    expect(container.querySelector(".reading-flow-step-detail")).toHaveTextContent("描述目标");
    expect(container.querySelector(".reader-status-pill")).toBeNull();
    expect(container.querySelector("table")).toHaveTextContent("已定");
    expect(container.querySelector("table")).toHaveTextContent("延后");
  });
});
