import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FocusSection } from "../../shared/focus-session";
import { ConceptWikiLinks } from "./ConceptWikiLinks";

afterEach(cleanup);
const section: FocusSection = { id: "wiki", title: "UI/UX视觉规范与交互重构", body: "导航交互介绍。\n\n## 布局结构\n\n侧边栏承接章节目录，正文区域保留足够阅读宽度。\n\n## 视觉风格\n\n统一浅色卡片边界。", kind: "review", transition: "", evidenceIds: [] };
it("previews the selected concept's saved Wiki text and keeps reading an explicit action", () => {
  const read = vi.fn();
  render(<ConceptWikiLinks sections={[section]} title="布局结构" completedIds={[]} zh onRead={read} />);
  expect(screen.getByText("侧边栏承接章节目录，正文区域保留足够阅读宽度。")).toBeVisible();
  expect(screen.queryByText("导航交互介绍。")).toBeNull();
  expect(screen.queryByText("统一浅色卡片边界。")).toBeNull();
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "UI/UX视觉规范与交互重构 阅读章节 →" }));
  expect(read).toHaveBeenCalledWith("wiki");
});
it("uses the chapter introduction when no matching heading exists and preserves read state", () => {
  render(<ConceptWikiLinks sections={[section]} title="新要点" completedIds={["wiki"]} zh onRead={vi.fn()} />);
  expect(screen.getByText("导航交互介绍。")).toBeVisible();
  expect(screen.getByRole("button", { name: "UI/UX视觉规范与交互重构 已阅读" })).toBeVisible();
});
