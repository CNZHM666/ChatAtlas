import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { cacheWikiOrganization, readWikiOrganizationCache } from "./wiki-organization-cache";
import { getDatabase } from "../storage/db";
import type { WikiKnowledgeOrganization } from "../shared/wiki-knowledge";

it("persists complete snapshots in the bounded cache and returns independent copies", async () => {
  const db = await getDatabase(); await db.clear("semanticDecisionCache");
  const organization: WikiKnowledgeOrganization = { version: 1, generatedAt: 1, status: "complete", inputSignature: "same-input", subjects: [], chapters: [{ id: "c", title: "项目定位", question: "", group: "", subtopics: [] }], merged: [], relations: [], report: {} };
  await cacheWikiOrganization("same-input", organization);
  const result = await readWikiOrganizationCache("same-input");
  expect(result).toEqual(organization);
  result!.chapters[0].title = "临时预览编辑";
  expect((await readWikiOrganizationCache("same-input"))!.chapters[0].title).toBe("项目定位");
  expect(await readWikiOrganizationCache("changed-input")).toBeUndefined();
  await cacheWikiOrganization("partial", { ...organization, status: "partial", inputSignature: "partial" });
  expect(await readWikiOrganizationCache("partial")).toBeUndefined();
  expect(await db.count("focusSessions")).toBe(0);
});
