import { describe, expect, it } from "vitest";
import type { FocusEvidence } from "../shared/focus-session";
import { transcriptPassages } from "../search/transcript-index";
import { selectFocusPassages, validateFocusResult } from "./focus-session";
import { structureCode, structureMetadata } from "../test/structure-metadata-fixture";
import {leakedClaims} from "../test/claims-prose-fixture";

const evidence: FocusEvidence[] = [{ id: "e1", conversationId: "c1", messageId: "m1", title: "Control", excerpt: "Poles" }];
const section = { title: "Poles", body: "A historical finding", transition: "", kind: "finding", evidenceIds: ["e1"] };

describe("goal-based synthesis evidence", () => {
  it("keeps structured claims separate while removing their leaked body representation",()=>{
    const claims=[{text:"历史结论",quote:"Poles",evidenceIds:["e1"]}],input={title:"项目",sections:[{...section,body:`正常阅读正文。\n\n${leakedClaims}`,claims}]},before=structuredClone(input);
    const result=validateFocusResult(input,evidence);expect(result.sections[0].body).toBe("正常阅读正文。");expect(result.sections[0].claims).toEqual(claims);expect(input).toEqual(before);
    expect(()=>validateFocusResult({...input,sections:[{...input.sections[0],body:leakedClaims}]},evidence)).toThrowError(expect.objectContaining({code:"PROVIDER_SCHEMA_missing_section_text",fieldPaths:["sections[0].body"]}));
  });
  it("saves prose separately from metadata and refuses an article made only of metadata", () => {
    const input = { title: "Brief", sections: [{ ...section, body: `A historical finding\n\n${structureCode}`, structure: structureMetadata }] };
    const result = validateFocusResult(input, [{ ...evidence[0], excerpt: "先验证基础能力。" }]);
    expect(result.sections[0].body).toBe("A historical finding");
    expect(result.sections[0].semanticStructure?.nodes[0].key).toBe("validation_bench");
    expect(input.sections[0].body).toContain("validation_bench");
    expect(() => validateFocusResult({ title: "Brief", sections: [{ ...section, body: structureCode }] }, evidence)).toThrow("漏写");
  });
  it("rejects unknown evidence in brief claims instead of silently removing the claim", () => {
    expect(() => validateFocusResult({ title: "Brief", sections: [section], brief: { confirmed: [{ text: "Decision", evidenceIds: ["unknown"] }] } }, evidence)).toThrow("unsupported brief claim");
  });
  it("rejects invented references and uncited historical claims, but allows explicitly new proposals", () => {
    expect(() => validateFocusResult({ title: "Brief", sections: [{ ...section, evidenceIds: ["invented"] }] }, evidence)).toThrow();
    expect(() => validateFocusResult({ title: "Brief", sections: [{ ...section, evidenceIds: [] }] }, evidence)).toThrow();
    expect(validateFocusResult({ title: "Brief", sections: [{ ...section, kind: "proposal", evidenceIds: [] }] }, evidence).sections[0].kind).toBe("proposal");
  });

  it("includes a late relevant passage without letting one long conversation crowd out other confirmed sources", () => {
    const passages = ["c1", "c2"].flatMap((id) => transcriptPassages({ id, title: "Control", platform: "chatgpt", url: "", messageCount: 1, updatedAt: 1 }, [{ id: `${id}-m`, conversationId: id, messageIndex: 0, role: "assistant", content: "Unrelated ".repeat(6000) + "pole stability ".repeat(100), preview: "", contentHash: "hash", createdAt: 1, updatedAt: 1 }]));
    const picked = selectFocusPassages("pole stability", passages, ["c1", "c2"]);
    expect(picked.length).toBeLessThanOrEqual(32);
    expect(picked.length).toBeLessThanOrEqual(16);
    expect(new Set(picked.map((item) => item.document.conversationId))).toEqual(new Set(["c1", "c2"]));
    expect(picked.some((item) => item.text.includes("pole stability"))).toBe(true);
    expect(selectFocusPassages("pole stability", passages, ["c1"]).every((item) => item.document.conversationId === "c1")).toBe(true);
  });
});
