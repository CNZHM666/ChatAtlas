import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDatabase } from "./db";
import { listImportItems, saveDiscoveredImportItems, saveImportItem } from "./import-items";

describe("import inventory persistence", () => {
  beforeEach(async () => { await (await getDatabase()).clear("importItems"); });

  it("saves a page together and preserves retry counts when discovery resumes", async () => {
    await saveImportItem("session", "changed", "retrying", { retryCount: 2, category: "network", error: "Temporary failure" });
    await saveDiscoveredImportItems("session", [{ id: "changed", pending: true }, { id: "unchanged", pending: false }]);

    const items = await listImportItems("session");
    const changed = items.find((item) => item.conversationId === "changed");
    expect(changed).toMatchObject({ state: "pending", retryCount: 2 });
    expect(changed?.failureCategory).toBeUndefined();
    expect(changed?.error).toBeUndefined();
    expect(items.find((item) => item.conversationId === "unchanged")).toMatchObject({ state: "persisted", retryCount: 0 });
  });
});
