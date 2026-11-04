import {expect,it} from "vitest";
import {generatedCitationPresentation} from "./generated-citation-presentation";
import {knowledgeArticlePresentation} from "./knowledge-article-presentation";
import {wikiClaimFormulation} from "./wiki-knowledge-prose";

const assertion="通过自然语言描述记忆内容，检索历史对话并定位具体消息";
it("removes empty generated citation tails in Chinese prose and list items before local deduplication",()=>{
 const body=`${assertion}[][]。\n\n- **消息定位**：${assertion}[ ]。\n\n${assertion}[]，失败时保留原文。`;
 const shown=generatedCitationPresentation(body);
 expect(shown).toBe(body.replaceAll("[][]","").replaceAll("[ ]","").replaceAll("[]",""));
 expect(generatedCitationPresentation(shown)).toBe(shown);
 const long=assertion.repeat(3)+"。";
 expect(knowledgeArticlePresentation(`${long}\n\n${long.slice(0,-1)}[]。`).split(long)).toHaveLength(2);
 expect(wikiClaimFormulation({text:assertion+"[]。",quote:assertion,evidenceIds:["e1"]},assertion+"。")).toBe(true);
});

it("preserves original examples, escaped brackets, arrays, links, inline code, quoted syntax and math",()=>{
 const cases=[`${assertion}[]。`,`${assertion}，空数组是[]。`,`${assertion}，字面量[]。`,`${assertion} \\[]。`,`${assertion}，items[]。`,`${assertion}，\`[]\`。`,`${assertion}，$[]$。`,`${assertion}，[链接](https://example.test/a[])。`,`> ${assertion}[]。`,`\`\`\`md\n${assertion}[]。\n\`\`\``];
 for(const body of cases.slice(1))expect(generatedCitationPresentation(body)).toBe(body);
 expect(generatedCitationPresentation(cases[0],[cases[0]])).toBe(cases[0]);
});
