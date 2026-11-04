import { afterEach, describe, expect, it, vi } from "vitest";
import { createAIProvider } from "./provider";
import type { AISettings } from "../shared/types";
import { validateFocusResult } from "./focus-session";
import { requestMessages } from "./request-policy";

afterEach(() => vi.unstubAllGlobals());
describe("provider-independent private citation labels", () => {
  const data = { intent: "Review", mode: "review", locale: "en", passages: [{ id: "e2", text: "Question" }, { id: "n0-1-1", text: "Correction" }] };
  const evidence = data.passages.map((p) => ({ id: p.id, conversationId: "c", messageId: p.id, title: "T", excerpt: p.text }));
  const request = { taskType: "focus_session" as const, system: "", prompt: JSON.stringify(data), validate: (value: unknown) => validateFocusResult(value, evidence) };
  const output = { title: "Route", sections: [{ title: "Conditions", body: "Keep the correction", transition: "", kind: "review", evidenceIds: ["e1", "e2"] }], brief: { summary: "", turningPoints: [{ text: "Correction", evidenceIds: ["e2"] }], confirmed: [], openQuestions: [] } };
  it.each(["openai", "anthropic", "gemini"] as const)("decodes %s once and rejects unknown IDs while retaining billed usage", async (provider) => {
    const envelope = (value: unknown) => provider === "anthropic" ? { content: [{ type: "text", text: JSON.stringify(value) }], usage: { input_tokens: 50, output_tokens: 20 } } : provider === "gemini" ? { candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 } } : { choices: [{ message: { content: JSON.stringify(value) }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 20 } };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(envelope(output)))).mockResolvedValueOnce(new Response(JSON.stringify(envelope({ ...output, sections: [{ ...output.sections[0], evidenceIds: ["e999"] }] }))));
    vi.stubGlobal("fetch", fetchMock);
    const ai = createAIProvider({ id: "ai-settings", provider, model: "test", apiKey: "test", baseUrl: "https://test.example/v1", streaming: false, updatedAt: 1 } as AISettings);
    const result = await ai.generateStructured(request);
    expect(result.sections[0].evidenceIds).toEqual(["e2", "n0-1-1"]);
    expect(result.brief?.turningPoints[0].evidenceIds).toEqual(["n0-1-1"]);
    await expect(ai.generateStructured(request)).rejects.toMatchObject({ code: "PROVIDER_SCHEMA_unknown_evidence_id", citationDiagnostics: { allowedEvidenceCount: 2, unknownEvidenceCount: 1, citationPaths: ["sections[0]"] } });
    expect(ai.getUsageSnapshot?.()).toMatchObject({ inputTokens: 100, outputTokens: 40 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not mutate source IDs when constructing the model prompt", () => {
    const wire = JSON.parse(requestMessages(request)[1].content);
    expect(wire.allowedEvidenceIds).toEqual(["e1", "e2"]);
    expect(wire.data.passages.map((p: { id: string }) => p.id)).toEqual(["e1", "e2"]);
    expect(data.passages.map((p) => p.id)).toEqual(["e2", "n0-1-1"]);
  });
  it("sends local lookup guidance to the actual BYOK provider while retaining the shared citation contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: "stop" }] })));
    vi.stubGlobal("fetch", fetchMock);
    const ai = createAIProvider({ id: "ai-settings", provider: "openai", model: "test", apiKey: "test", baseUrl: "https://test.example/v1", streaming: false, updatedAt: 1 } as AISettings);
    const guidance = "Lead with the historical answer; new recommendations require a separate proposal section.";
    await ai.generateStructured({ ...request, system: guidance, prompt: JSON.stringify({ ...data, presentation: "project_query", strategy: "answer" }) });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.messages[0].content).toContain(guidance);
    expect(sent.messages[0].content).toContain("historical AI suggestions are not user confirmation");
    expect(JSON.parse(sent.messages[1].content).allowedEvidenceIds).toEqual(["e1", "e2"]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("keeps internal and old revision IDs out of citation choices while preserving exact provenance", () => {
    const original = { ...data, passages: data.passages.map((item, index) => ({ ...item, conversationId: "internal-conversation", messageId: `internal-message-${index}`, sourceConversationIds: ["internal-conversation"] })), revision: { scope: "section", sections: [{ title: "My title", body: "My corrected wording", evidenceIds: ["obsolete-id"], originalSources: [{ conversationId: "internal-conversation", messageId: "internal-message-1" }] }] } };
    const wire = JSON.parse(requestMessages({ ...request, prompt: JSON.stringify(original) })[1].content);
    expect(wire.allowedEvidenceIds).toEqual(["e1", "e2"]);
    expect(wire.data.passages[0]).toMatchObject({ id: "e1", source: "source1" });
    expect(wire.data.passages[0].sources).toBeUndefined();
    expect(JSON.stringify(wire)).not.toContain("internal-conversation");
    expect(JSON.stringify(wire)).not.toContain("internal-message");
    expect(JSON.stringify(wire)).not.toContain("obsolete-id");
    expect(wire.data.revision.sections[0]).toMatchObject({ body: "My corrected wording", originalSources: [{ source: "source1", passageIds: ["e2"] }] });
    expect(original.passages[1].id).toBe("n0-1-1");
  });
  it.each(["openai", "anthropic", "gemini"] as const)("accepts a valid %s route without displaying an unsolicited malformed brief", async (provider) => {
    const value = { ...output, brief: { confirmed: ["Unsupported extra claim"] } };
    const envelope = provider === "anthropic" ? { content: [{ type: "text", text: JSON.stringify(value) }], usage: { input_tokens: 50, output_tokens: 20 } } : provider === "gemini" ? { candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 } } : { choices: [{ message: { content: JSON.stringify(value) }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 20 } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope)));
    vi.stubGlobal("fetch", fetchMock);
    const ai = createAIProvider({ id: "ai-settings", provider, model: "test", apiKey: "test", baseUrl: "https://test.example/v1", streaming: false, updatedAt: 1 } as AISettings);
    const routeRequest = { ...request, prompt: JSON.stringify({ ...data, presentation: "reading_route", coverage: { stage: "reading", final: true } }) };
    const result = await ai.generateStructured(routeRequest);
    expect(result.sections[0].evidenceIds).toEqual(["e2", "n0-1-1"]);
    expect(result.brief).toBeUndefined();
    expect(ai.getUsageSnapshot?.()).toMatchObject({ inputTokens: 50, outputTokens: 20 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestMessages(routeRequest)[0].content).not.toContain("also return a compact brief");
  });
});
