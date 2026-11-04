import { expect, it } from "vitest";
import { projectSession } from "../test/project-fixture";
import { projectBridgeContext } from "./context-bridge";
it("reuses only selected context categories, excludes private notes and preserves uncertainty", () => {
  const session = projectSession(); session.notes = "私人笔记不默认带出";
  const text = projectBridgeContext(session, [], { background: false, architecture: true, questions: false }, true);
  expect(text).toContain("架构与关键决策"); expect(text).not.toContain("项目背景与目标"); expect(text).not.toContain("私人笔记"); expect(text).not.toContain("用户已确认");
  const changed = projectBridgeContext(session, [], { background: true, architecture: false, questions: true }, true, true);
  expect(changed).toContain("来源有新变化"); expect(changed).not.toContain("架构与关键决策");
});
