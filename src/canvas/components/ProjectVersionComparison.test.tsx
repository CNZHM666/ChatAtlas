import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectSession } from "../../test/project-fixture";
import { ProjectVersionComparison } from "./ProjectVersionComparison";

afterEach(cleanup);

describe("ProjectVersionComparison", () => {
  it("shows only prose changes and filters out source code captions, fenced code blocks, and reference examples", () => {
    const base = projectSession();
    const before = {
      ...base,
      id: "v1",
      createdAt: 1000,
      sections: [
        {
          ...base.sections[0],
          body: [
            "## 架构方案",
            "",
            "首版采用单向数据流。",
            "",
            "*讨论中的原文代码 · AI 建议，未确认*",
            "",
            "```text",
            "旧的草图代码",
            "```",
            "",
            "<details data-atlas=\"atlas-wiki-supplement\"><summary>参考示例 · 1 项</summary>\n\n```text\n旧示例内容\n```\n</details>",
          ].join("\n"),
        },
      ],
    };
    const current = {
      ...base,
      id: "v2",
      createdAt: 2000,
      sections: [
        {
          ...base.sections[0],
          body: [
            "## 架构方案",
            "",
            "首版采用单向数据流，并补齐本地持久化校验。",
            "",
            "*讨论中的原文代码 · AI 建议，未确认*",
            "",
            "```text",
            "新的草图代码",
            "```",
            "",
            "<details data-atlas=\"atlas-wiki-supplement\"><summary>参考示例 · 1 项</summary>\n\n```text\n新示例内容\n```\n</details>",
          ].join("\n"),
        },
      ],
    };

    render(<ProjectVersionComparison previous={before} current={current} zh onClose={vi.fn()} />);
    expect(screen.getByText("仅展示正文变化")).toBeVisible();
    expect(screen.getByText("首版采用单向数据流。")).toBeVisible();
    expect(screen.getByText("首版采用单向数据流，并补齐本地持久化校验。")).toBeVisible();
    expect(screen.queryByText(/讨论中的原文代码/)).not.toBeInTheDocument();
    expect(screen.queryByText(/```text/)).not.toBeInTheDocument();
    expect(screen.queryByText(/旧示例内容|新示例内容|旧的草图代码|新的草图代码/)).not.toBeInTheDocument();
  });
});
