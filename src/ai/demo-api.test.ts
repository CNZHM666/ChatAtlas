// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AtlasApiClient, CURRENT_FOCUS_TASK_VERSION, DemoApiError, ServerProxyLLMProvider } from "./demo-api";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.removeItem("atlas-demo-session-v1"); });

describe("ChatAtlas Demo API client", () => {
  it("refreshes a same-version session when a new optional project capability is needed", async () => {
    vi.stubEnv("VITE_ATLAS_API_BASE_URL", "https://atlas.example");
    const cached = { token: "old", baseUrl: "https://atlas.example", taskVersion: String(CURRENT_FOCUS_TASK_VERSION), features: { asyncTasks: true, conversationStructure: true, compactOrganization: true }, expiresAt: new Date(Date.now() + 3600000).toISOString(), embedding: { modelKey: "model" } };
    localStorage.setItem("atlas-demo-session-v1", JSON.stringify(cached));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...cached, token: "upgraded", features: { ...cached.features, projectQuery: true } })));
    vi.stubGlobal("fetch", fetchMock);
    const client = new AtlasApiClient();
    expect((await client.getSession(undefined, true, CURRENT_FOCUS_TASK_VERSION)).token).toBe("old");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await client.getSession(undefined, true, CURRENT_FOCUS_TASK_VERSION, "projectQuery")).features?.projectQuery).toBe(true);
    await client.getSession(undefined, true, CURRENT_FOCUS_TASK_VERSION, "projectQuery");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("refreshes a cached legacy session after the backend is upgraded", async () => {
    vi.stubEnv("VITE_ATLAS_API_BASE_URL", "https://atlas.example");
    localStorage.setItem("atlas-demo-session-v1", JSON.stringify({ token: "old", baseUrl: "https://atlas.example", taskVersion: "5", features: { asyncTasks: true, conversationStructure: true, compactOrganization: true }, expiresAt: new Date(Date.now() + 3600000).toISOString(), embedding: { modelKey: "model" } }));
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/session")) return new Response(JSON.stringify({ token: "current", taskVersion: String(CURRENT_FOCUS_TASK_VERSION), policyVersion: "5", features: { asyncTasks: true, conversationStructure: true }, expiresAt: new Date(Date.now() + 3600000).toISOString(), embedding: { modelKey: "model" } }));
      expect(init.headers).toMatchObject({ authorization: "Bearer current" });
      return new Response(JSON.stringify({ result: { title: "done" }, usage: {} }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new AtlasApiClient();
    await expect(client.runTask("focus_session", { intent: "test" })).resolves.toMatchObject({ result: { title: "done" } });
    await client.runTask("focus_session", { intent: "another" });
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/session"))).toHaveLength(1);
  });
  it("shares one protocol refresh between concurrent callers", async () => {
    vi.stubEnv("VITE_ATLAS_API_BASE_URL", "https://atlas.example");
    localStorage.setItem("atlas-demo-session-v1", JSON.stringify({ token: "old", baseUrl: "https://atlas.example", expiresAt: new Date(Date.now() + 3600000).toISOString(), embedding: { modelKey: "model" } }));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: "current", features: { asyncTasks: true, conversationStructure: true }, expiresAt: new Date(Date.now() + 3600000).toISOString(), embedding: { modelKey: "model" } })));
    vi.stubGlobal("fetch", fetchMock);
    const client = new AtlasApiClient();
    await Promise.all([client.getSession(undefined, true), client.getSession(undefined, true)]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("cancels one session waiter without cancelling another", async () => {
    vi.stubEnv("VITE_ATLAS_API_BASE_URL", "https://atlas.example");
    let finish!: (value: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new AtlasApiClient();
    const controller = new AbortController();
    const cancelled = expect(client.getSession(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    const other = client.getSession();
    controller.abort();
    await cancelled;
    finish(new Response(JSON.stringify({ token: "ok", expiresAt: new Date(Date.now() + 3600000).toISOString(), embedding: { modelKey: "model" } })));
    await expect(other).resolves.toMatchObject({ token: "ok" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("rejects a cancelled caller without opening a connection", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController(); controller.abort();
    await expect(new AtlasApiClient().getSession(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("reports an old deployed backend before sending goal content", async () => {
    vi.stubEnv("VITE_ATLAS_API_BASE_URL", "https://atlas.example");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: "old", taskVersion: "2", expiresAt: new Date(Date.now() + 3600000).toISOString(), embedding: { modelKey: "model" } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new AtlasApiClient().runTask("focus_session", { intent: "test" })).rejects.toMatchObject({ code: "DEMO_SERVICE_OUTDATED" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("polls the same hosted task after 202 instead of starting another generation", async () => {
    vi.useFakeTimers(); vi.stubEnv("VITE_ATLAS_API_BASE_URL", "https://async-atlas.example");
    const paths: string[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      paths.push(url);
      if (url.endsWith("/session")) return new Response(JSON.stringify({ token: "async-token", taskVersion: String(CURRENT_FOCUS_TASK_VERSION), features: { asyncTasks: true, conversationStructure: true }, expiresAt: new Date(Date.now() + 3600000).toISOString(), embedding: { modelKey: "async-vector", dimensions: 2 } }));
      if (url.endsWith("/compose")) { expect(init.headers).toMatchObject({ "X-ChatAtlas-Run-Id": "focus-fixture" }); return new Response(JSON.stringify({ requestId: "a".repeat(64), status: "running" }), { status: 202 }); }
      return new Response(JSON.stringify({ status: "succeeded", response: { result: { title: "done" }, usage: { inputTokens: 10, outputTokens: 5 } } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const pending = new AtlasApiClient().runTask("focus_session", { intent: "Find", mode: "review", passages: [{ id: "e1", text: "text" }] }, undefined, "", "focus-fixture");
    await vi.advanceTimersByTimeAsync(1100);
    expect((await pending).result).toEqual({ title: "done" });
    expect(paths.filter((path) => path.endsWith("/compose"))).toHaveLength(1);
    expect(paths.at(-1)).toContain(`/tasks/${"a".repeat(64)}`);
  });
  it("creates an anonymous session and sends only fixed task data", async () => {
    vi.stubEnv("VITE_ATLAS_API_BASE_URL", "https://atlas.example");
    const requests: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url.endsWith("/session")) return new Response(JSON.stringify({ token: "session-token", expiresAt: new Date(Date.now() + 3600000).toISOString(), embedding: { modelKey: "atlas-demo:model:1:1024", dimensions: 1024 } }), { status: 200 });
      return new Response(JSON.stringify({ result: { snapshots: [{ questionId: "q1" }] }, usage: { inputTokens: 10, outputTokens: 5 } }), { status: 200 });
    }));
    const provider = new ServerProxyLLMProvider();
    const result = await provider.generateStructured({ taskType: "question_snapshot", system: "client instruction must stay local", prompt: JSON.stringify({ questions: [{ questionId: "q1", question: "What is a pole?" }], schema: { snapshots: [] } }), validate: (value) => value as { snapshots: Array<{ questionId: string }> } });
    expect(result.snapshots[0].questionId).toBe("q1");
    expect(requests.map((item) => item.url)).toEqual(["https://atlas.example/api/atlas/demo/session", "https://atlas.example/api/atlas/demo/analyze"]);
    const sent = JSON.parse(String(requests[1].init.body)) as { taskType: string; data: Record<string, unknown> };
    expect(sent.taskType).toBe("question_snapshot");
    expect(sent.data).toHaveProperty("questions");
    expect(sent.data).not.toHaveProperty("schema");
    expect(JSON.stringify(sent)).not.toContain("client instruction");
    expect((requests[1].init.headers as Record<string, string>).authorization).toBe("Bearer session-token");
  });

  it("reports quota exhaustion with a user-facing message", async () => {
    vi.stubEnv("VITE_ATLAS_API_BASE_URL", "https://atlas.example");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/session")
      ? new Response(JSON.stringify({ token: "session-token", expiresAt: new Date(Date.now() + 3600000).toISOString(), embedding: { modelKey: "atlas-demo:model:1:1024", dimensions: 1024 } }), { status: 200 })
      : new Response(JSON.stringify({ ok: false, code: "DEMO_QUOTA_EXHAUSTED" }), { status: 429 })));
    const client = new AtlasApiClient();
    await expect(client.embed(["example"])).rejects.toMatchObject({ code: "DEMO_QUOTA_EXHAUSTED" } satisfies Partial<DemoApiError>);
  });

  it("distinguishes exhausted shared budget from a service outage", () => {
    expect(new DemoApiError("DEMO_BUDGET_EXHAUSTED", 429).message).toContain("共享额度不足");
    expect(new DemoApiError("DEMO_UNAVAILABLE", 503).message).toContain("服务暂时不可用");
  });

  it("distinguishes a missing URL, connection failure, and server outage", async () => {
    vi.stubEnv("VITE_ATLAS_API_BASE_URL", "");
    await expect(new AtlasApiClient().createDemoSession()).rejects.toMatchObject({ code: "DEMO_NOT_CONFIGURED" });

    vi.stubEnv("VITE_ATLAS_API_BASE_URL", "https://atlas.example");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(new AtlasApiClient().createDemoSession()).rejects.toMatchObject({ code: "DEMO_CONNECTION_FAILED" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, code: "DEMO_UNAVAILABLE" }), { status: 503 })));
    await expect(new AtlasApiClient().createDemoSession()).rejects.toMatchObject({ code: "DEMO_UNAVAILABLE", status: 503 });
  });

  it("identifies a server without the ChatAtlas AI route", async () => {
    vi.stubEnv("VITE_ATLAS_API_BASE_URL", "https://atlas.example");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Cannot POST /api/atlas/demo/session", { status: 404 })));
    await expect(new AtlasApiClient().createDemoSession()).rejects.toMatchObject({ code: "DEMO_SERVICE_NOT_DEPLOYED", status: 404 });
  });

  it("does not reuse a session issued for another API origin", async () => {
    vi.stubEnv("VITE_ATLAS_API_BASE_URL", "https://new-atlas.example");
    localStorage.setItem("atlas-demo-session-v1", JSON.stringify({ token: "old-token", baseUrl: "https://old-atlas.example", expiresAt: new Date(Date.now() + 3600000).toISOString(), embedding: { modelKey: "atlas-demo:model:1:1024", dimensions: 1024 } }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "new-token", expiresAt: new Date(Date.now() + 3600000).toISOString(), embedding: { modelKey: "atlas-demo:model:1:1024", dimensions: 1024 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new AtlasApiClient().getSession()).resolves.toMatchObject({ token: "new-token", baseUrl: "https://new-atlas.example" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports an invalid session response separately from service availability", async () => {
    vi.stubEnv("VITE_ATLAS_API_BASE_URL", "https://atlas.example");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await expect(new AtlasApiClient().createDemoSession()).rejects.toMatchObject({ code: "DEMO_INVALID_RESPONSE" });
  });

  it("allows a slow session response to complete after the old 15-second limit", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_ATLAS_API_BASE_URL", "https://atlas.example");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve(new Response(JSON.stringify({ token: "session-token", expiresAt: new Date(Date.now() + 3600000).toISOString(), embedding: { modelKey: "atlas-demo:model:1:1024", dimensions: 1024 } }), { status: 200 })), 20000);
    })));
    const session = new AtlasApiClient().createDemoSession();
    await vi.advanceTimersByTimeAsync(20000);
    await expect(session).resolves.toMatchObject({ token: "session-token" });
  });
});
