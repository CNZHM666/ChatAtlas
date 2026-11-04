import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAtlasAI } from "./atlas-ai";
import { getDatabase } from "../storage/db";
import { listAIUsage } from "../storage/ai-usage";
import type { AISettings } from "../shared/types";

const settings: AISettings = { id: "ai-settings", provider: "qwen", model: "qwen-plus", apiKey: "test", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", streaming: false, updatedAt: 1 };
afterEach(() => vi.unstubAllGlobals());
describe("bounded response format repair", () => {
  it("repairs only a malformed response once, omits source text, records both receipts and caches the result", async () => {
    const db = await getDatabase(); await db.clear("semanticDecisionCache"); await db.clear("aiUsageEvents");
    const bodies: Array<{ messages: Array<{ content: string }> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); bodies.push(body);
      const content = bodies.length === 1 ? '{"notes":[{"title":"来源笔记" "text":"后来的修正必须保留"}]}' : '{"notes":[{"title":"来源笔记","text":"后来的修正必须保留"}]}';
      return new Response(JSON.stringify({ id: `receipt-${bodies.length}`, choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 200, completion_tokens: 40 } }));
    }));
    const ai = createAtlasAI(settings);
    const request = { taskType: "focus_session" as const, system: "Read", prompt: JSON.stringify({ intent: "复习", mode: "review", locale: "zh-CN", coverage: { stage: "reading", final: false }, passages: [{ id: "internal-id", text: "SOURCE_MUST_NOT_BE_RESENT".repeat(400) }] }), validate: (value: unknown) => value };
    const result = await ai.synthesize(request);
    expect(result).toMatchObject({ sections: [{ body: "后来的修正必须保留", evidenceIds: ["internal-id"] }] });
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1])).not.toContain("SOURCE_MUST_NOT_BE_RESENT");
    expect(JSON.stringify(bodies[1])).toContain("后来的修正必须保留");
    await ai.synthesize(request);
    expect(bodies).toHaveLength(2);
    const receipts = await listAIUsage();
    expect(receipts.filter((item) => item.tokenSource === "provider").map((item) => item.inputTokens).sort()).toEqual([0, 200, 200]);
  });
  it("never repairs invented citations or retries incomplete output", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"回顾","sections":[{"title":"来源","body":"正文","kind":"review","transition":"","evidenceIds":["e999"]}]}' }, finish_reason: "stop" }] })));
    vi.stubGlobal("fetch", fetch);
    const ai = createAtlasAI(settings);
    await expect(ai.synthesize({ taskType: "focus_session", system: "Read", prompt: JSON.stringify({ intent: crypto.randomUUID(), mode: "review", locale: "zh-CN", passages: [{ id: "real", text: "Source" }] }), validate: (value) => value })).rejects.toMatchObject({ code: "PROVIDER_SCHEMA_unknown_evidence_id" });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("repairs only a wrong-language field even when the valid response exceeds the old 16000-character limit",async()=>{
    const db=await getDatabase();await db.clear("semanticDecisionCache");await db.clear("aiUsageEvents");
    const good="完整中文事实与限制不能被重写。".repeat(1500),bodies:Array<{messages:Array<{content:string}>}>=[];
    vi.stubGlobal("fetch",vi.fn(async(_url,init:RequestInit)=>{
      const body=JSON.parse(String(init.body));bodies.push(body);
      const content=bodies.length===1?JSON.stringify({notes:[{title:"The current project workflow",text:good}],projectFacts:{kept:"DO_NOT_TRANSLATE_OR_RESEND"}}):JSON.stringify({translations:[{path:"notes[0].title",text:"项目工作流"}]});
      return new Response(JSON.stringify({choices:[{message:{content},finish_reason:"stop"}],usage:{prompt_tokens:120,completion_tokens:30}}));
    }));
    const ai=createAtlasAI(settings),request={taskType:"focus_session" as const,system:"Read",prompt:JSON.stringify({intent:"保留原始材料",mode:"work",locale:"zh-CN",coverage:{stage:"reading",final:false},projectKnowledge:true,passages:[{id:"source",text:"PRIVATE_ORIGINAL_SOURCE"}]}),validate:(value:unknown)=>value};
    const result=await ai.synthesize(request);
    expect(result).toMatchObject({sections:[{title:"项目工作流",body:good,evidenceIds:["source"]}],projectFacts:{kept:"DO_NOT_TRANSLATE_OR_RESEND"}});
    expect(bodies).toHaveLength(2);
    const repair=JSON.stringify(bodies[1]);expect(repair).not.toContain(good);expect(repair).not.toContain("PRIVATE_ORIGINAL_SOURCE");expect(repair).not.toContain("DO_NOT_TRANSLATE_OR_RESEND");
    expect(JSON.parse(bodies[1].messages[1].content).fields).toEqual([{path:"notes[0].title",text:"The current project workflow"}]);
    await ai.synthesize(request);expect(bodies).toHaveLength(2);
    const failed=(await listAIUsage()).find(event=>event.status==="failed");
    expect(failed?.validationPaths).toEqual(["sections[0].title"]);
    expect(JSON.stringify(failed)).not.toContain("完整中文事实");
  });
});
