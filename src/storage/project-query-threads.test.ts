import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { getDatabase } from "./db";
import { readProjectQueryThread, saveProjectQueryTurn, type ProjectQueryTurn } from "./project-query-threads";
beforeEach(async () => { await (await getDatabase()).clear("projectQueryThreads"); });
const turn = (id: string, createdAt: number): ProjectQueryTurn => ({ id, createdAt, question: id, revision: "source-version", chapters: [], clarification: "Need context" });
it("upserts a saved answer without erasing later turns or another project's history", async () => {
  await Promise.all([saveProjectQueryTurn("project:a", turn("first", 1)), saveProjectQueryTurn("project:a", turn("second", 2)), saveProjectQueryTurn("project:b", turn("foreign", 3))]);
  await saveProjectQueryTurn("project:a", { ...turn("first", 1), saved: "note" });
  expect((await readProjectQueryThread("project:a")).map(item => item.id)).toEqual(["first", "second"]);
  expect((await readProjectQueryThread("project:a"))[0].saved).toBe("note"); expect((await readProjectQueryThread("project:b"))[0].id).toBe("foreign");
});
