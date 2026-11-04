import { describe, expect, it } from "vitest";
import { cleanConversationOverviewTitle } from "./conversation-overview";

describe("cleanConversationOverviewTitle", () => {
  it("removes corrupted control and replacement characters", () => {
    expect(cleanConversationOverviewTitle("恢复\u0000自动化\ufffd培养计划")).toBe("恢复自动化培养计划");
  });

  it("removes a stray trailing interpolation marker without changing valid inner currency text", () => {
    expect(cleanConversationOverviewTitle("恢复自动化培养计划 $")).toBe("恢复自动化培养计划");
    expect(cleanConversationOverviewTitle("预算 $30 计划")).toBe("预算 $30 计划");
  });
});
