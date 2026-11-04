// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AtlasApiClient, CURRENT_FOCUS_TASK_VERSION } from "./demo-api";

const baseUrl = "https://resume-atlas.example";
const requestId = "b".repeat(64);
const receipt = { inputTokens: 10, outputTokens: 5, costCny: .001, modelId: "qwen-plus" };
const session = (token = "original") => ({ token, baseUrl, taskVersion: String(CURRENT_FOCUS_TASK_VERSION), features: { asyncTasks: true, conversationStructure: true, compactOrganization: true }, expiresAt: new Date(Date.now() + 3600000).toISOString(), embedding: { modelKey: "vector", dimensions: 2 } });
const data = { intent: "private goal", mode: "review", passages: [{ id: "e1", text: "private passage" }] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubEnv("VITE_ATLAS_API_BASE_URL", baseUrl);
  vi.stubGlobal("crypto", {}); // Exercise the deterministic fallback digest.
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); });

describe("hosted task recovery without duplicate generation", () => {
  it.each(["PROVIDER_AUTH_ERROR", undefined])("does not resubmit a terminal task (%s)", async (code) => {
    let posts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/session")) return json(session());
      if (url.endsWith("/compose")) { posts++; return json({ requestId }, 202); }
      return json({ status: "failed", ...(code ? { failure: { code, status: 502 } } : {}), usage: receipt });
    }));
    const expected = expect(new AtlasApiClient().runTask("focus_session", data)).rejects.toMatchObject({ code: code ?? "PROVIDER_USAGE_PENDING", requestId });
    await vi.advanceTimersByTimeAsync(1100);
    await expected;
    expect(posts).toBe(1);
    expect(JSON.parse(localStorage.getItem("atlas-demo-pending-tasks-v1")!)).toHaveLength(code ? 0 : 1);
  });

  it("recovers status rate limits and network failures by polling the same task", async () => {
    let posts = 0;
    let polls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/session")) return json(session());
      if (url.endsWith("/compose")) { posts++; return json({ requestId }, 202); }
      if (++polls === 1) return json({ code: "RATE_LIMITED" }, 429);
      if (polls === 2) throw new TypeError("network");
      if (polls === 3) return json({ status: "running" });
      return json({ status: "succeeded", response: { result: { title: "Done" }, usage: receipt } });
    }));
    const result = new AtlasApiClient().runTask("focus_session", data);
    await vi.advanceTimersByTimeAsync(20000);
    await expect(result).resolves.toMatchObject({ result: { title: "Done" } });
    expect(posts).toBe(1);
    expect(polls).toBe(4);
    expect(JSON.parse(localStorage.getItem("atlas-demo-pending-tasks-v1")!)).toEqual([]);
  });

  it("resumes after cancellation and reload using the original task session", async () => {
    let posts = 0;
    let done = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/session")) return json(session());
      if (url.endsWith("/compose")) { posts++; return json({ requestId }, 202); }
      expect(init.headers).toMatchObject({ authorization: "Bearer original" });
      return done ? json({ status: "succeeded", response: { result: { title: "Done" }, usage: receipt } }) : json({ status: "running" });
    }));
    const controller = new AbortController();
    const first = new AtlasApiClient().runTask("focus_session", data, controller.signal);
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1100);
    controller.abort();
    await rejected;
    const saved = localStorage.getItem("atlas-demo-pending-tasks-v1")!;
    expect(saved).toContain(requestId);
    expect(saved).not.toContain("private passage");
    expect(saved).not.toContain("private goal");
    localStorage.setItem("atlas-demo-session-v1", JSON.stringify(session("replacement")));
    done = true;
    const resumed = new AtlasApiClient().runTask("focus_session", data);
    await vi.advanceTimersByTimeAsync(1100);
    await expect(resumed).resolves.toMatchObject({ usage: receipt });
    expect(posts).toBe(1);
  });

  it("preserves a task handle when polling exceeds the wait window", async () => {
    let posts = 0;
    let done = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/session")) return json(session());
      if (url.endsWith("/compose")) { posts++; return json({ requestId }, 202); }
      return done ? json({ status: "succeeded", response: { result: {}, usage: receipt } }) : json({ code: "DEMO_DATABASE_BUSY" }, 503);
    }));
    const expected = expect(new AtlasApiClient().runTask("focus_session", data)).rejects.toMatchObject({ code: "REQUEST_IN_PROGRESS", requestId });
    await vi.advanceTimersByTimeAsync(160000);
    await expected;
    done = true;
    const resumed = new AtlasApiClient().runTask("focus_session", data);
    await vi.advanceTimersByTimeAsync(1100);
    await expect(resumed).resolves.toMatchObject({ usage: receipt });
    expect(posts).toBe(1);
  });

  it("keeps the original request ID when task lookup fails without a usage receipt", async () => {
    let posts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/session")) return json(session());
      if (url.endsWith("/compose")) { posts++; return json({ requestId }, 202); }
      return json({ code: "TASK_NOT_FOUND" }, 404);
    }));
    const expected = expect(new AtlasApiClient().runTask("focus_session", data)).rejects.toMatchObject({ code: "TASK_NOT_FOUND", requestId });
    await vi.advanceTimersByTimeAsync(1100);
    await expected;
    expect(posts).toBe(1);
  });
});
