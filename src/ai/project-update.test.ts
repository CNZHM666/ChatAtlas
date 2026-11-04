import { describe, expect, it } from "vitest";
import { projectOriginalSources } from "./project-sources";
import { projectFixture, projectText } from "../test/project-fixture";
import type { ConversationMessage } from "../shared/types";
const raw: ConversationMessage = { id: "message", conversationId: "source", messageIndex: 0, role: "user", content: projectText, createdAt: 1700000000000, updatedAt: 1, preview: "", contentHash: "" };
describe("original-backed project updates", () => {
  it("does not use missing or unselected original messages as evidence", () => {
    expect(projectOriginalSources(projectFixture, [])).toEqual([]);
    expect(projectOriginalSources({ ...projectFixture, scope: { kind: "goal", blocks: [] } }, [raw])).toEqual([]);
    expect(projectOriginalSources(projectFixture, [{ ...raw, content: "unrelated ".repeat(2000) }])).toEqual([]);
  });
});
