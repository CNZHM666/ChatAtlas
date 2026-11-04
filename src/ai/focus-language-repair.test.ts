import {expect,it} from "vitest";
import {applyFocusLanguageRepair,focusLanguageRepairFields} from "./focus-language-repair";
const data={locale:"zh-CN",intent:"项目",coverage:{stage:"reading",final:false},passages:[{id:"original",text:"不应重发的来源"}]};
it("maps wrapped note aliases and patches only invalid prose while preserving citations and facts",()=>{
 const original={result:{notes:[{heading:"The current project workflow",content:"保留原文。"}],projectFacts:{original:"保留证据"}}};
 const before=structuredClone(original),fields=focusLanguageRepairFields(original,data);
 expect(fields).toEqual([{path:"result.notes[0].heading",text:"The current project workflow"}]);
 const result=applyFocusLanguageRepair(original,fields,{translations:[{path:fields[0].path,text:"项目工作流"}]});
 expect(result).toEqual({result:{notes:[{heading:"项目工作流",content:"保留原文。"}],projectFacts:{original:"保留证据"}}});expect(original).toEqual(before);
 expect(()=>applyFocusLanguageRepair(original,fields,{translations:[{path:"result.projectFacts.original",text:"覆盖事实"}]})).toThrow();
 expect(()=>applyFocusLanguageRepair(original,fields,{translations:[]})).toThrow();
});
it("rejects changed literal code and quotes, repeated paths and fields exceeding the bounded repair budget",()=>{
 const text='We should keep the code and the literal identifier because this is the original condition: `keep()` and “source”.';
 const value={notes:[{title:"说明",text}]},fields=focusLanguageRepairFields(value,data);
 expect(fields).toHaveLength(1);
 expect(()=>applyFocusLanguageRepair(value,fields,{translations:[{path:fields[0].path,text:'保留 `changed()` 和 “source”。'}]})).toThrow();
 expect(applyFocusLanguageRepair(value,fields,{translations:[{path:fields[0].path,text:'应该保留原始条件中的代码和标识：`keep()` 和 “source”。'}]})).toMatchObject({notes:[{text:'应该保留原始条件中的代码和标识：`keep()` 和 “source”。'}]});
 expect(()=>applyFocusLanguageRepair(value,fields,{translations:[{path:fields[0].path,text:"一"},{path:fields[0].path,text:"二"}]})).toThrow();
 expect(focusLanguageRepairFields({notes:[{title:"说明",text:text.repeat(1000)}]},data)).toEqual([]);
});
it("rejects translated text that changes numerical constraints or technical identifiers",()=>{
 const value={notes:[{title:"说明",text:"We should keep the limit at 6 components and preserve the Hardware IR before committing the modification."}]};
 const fields=focusLanguageRepairFields(value,data);
 expect(fields).toHaveLength(1);
 expect(()=>applyFocusLanguageRepair(value,fields,{translations:[{path:fields[0].path,text:"提交修改前，应保留 Hardware IR 并保持 30 个元件的限制。"}]})).toThrow();
 expect(()=>applyFocusLanguageRepair(value,fields,{translations:[{path:fields[0].path,text:"提交修改前，应保留 Hardware JSON 并保持 6 个元件的限制。"}]})).toThrow();
 expect(applyFocusLanguageRepair(value,fields,{translations:[{path:fields[0].path,text:"提交修改前，应保留 Hardware IR 并保持 6 个元件的限制。"}]})).toMatchObject({notes:[{text:expect.stringContaining("6 个元件")}]});
});
