// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { aiMode, effectiveAISettings, hasAIConnection } from "./ai-mode";
import { createAtlasAI } from "./atlas-ai";
import { resolveEmbeddingProvider } from "./embedding-provider";
import { getAISettings, saveAISettings } from "../storage/knowledge-graph";
import { getDatabase } from "../storage/db";
import { createManifest } from "../../manifest.config";
import {allWebCapturePatterns} from "../shared/web-capture";
afterEach(async () => { vi.unstubAllGlobals(); await (await getDatabase()).clear("aiSettings"); });

it("starts without hosted access or a pretend configured model", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const settings = effectiveAISettings();
  expect(aiMode()).toBe("byok"); expect(settings.mode).toBe("byok");
  expect(hasAIConnection(settings)).toBe(false);
  expect(() => createAtlasAI(settings)).toThrow(/Connect your AI API/);
  expect(await resolveEmbeddingProvider(settings)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  const manifest=await createManifest("https://old-shared.example/api");
  expect(manifest).toMatchObject({host_permissions:["https://chatgpt.com/*",...allWebCapturePatterns()]});
  expect(JSON.stringify(manifest)).not.toContain("old-shared.example");
  // Other sites use one automatically registered bundled reader; do not also
  // statically inject it, which duplicates readers and collides in CRX builds.
  expect(manifest).toMatchObject({content_scripts:[expect.objectContaining({matches:["https://chatgpt.com/*"],js:["src/content/chatgpt-content.ts"]})]});
});

it("migrates legacy settings without losing personal connections or enabling the shared service", async () => {
  const db = await getDatabase();
  const connection = { provider: "qwen" as const, baseUrl: "https://fixture.example/v1", apiKey: "fixture", model: "fixture-model" };
  await db.put("aiSettings", { ...connection, id: "ai-settings", mode: "demo", updatedAt: 1, connections: [connection] });
  const migrated = await getAISettings();
  expect(migrated).toMatchObject({ ...connection, mode: "byok", connections: [connection] });
  expect(hasAIConnection(migrated)).toBe(true);
  expect((await saveAISettings({ ...migrated!, mode: "demo" })).mode).toBe("byok");
  expect(hasAIConnection(effectiveAISettings({ ...migrated!, model: "atlas-demo" }))).toBe(false);
});

it("lets no website load the workspace page, and only ChatGPT frame the side panel", async () => {
  const manifest = await createManifest() as { web_accessible_resources?: Array<{ resources: string[]; matches: string[] }> };
  expect(manifest.web_accessible_resources).toEqual([{ resources: ["sidecar.html"], matches: ["https://chatgpt.com/*"] }]);
  expect(JSON.stringify(manifest.web_accessible_resources)).not.toContain("<all_urls>");
});
