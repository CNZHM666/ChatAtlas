import {expect,it} from "vitest";
import {wikiUiCopy,wikiUiCopySupports} from "./wiki-ui-copy";
import {wikiBlockPresentation,planWikiSourceBlock} from "./wiki-block-presentation";
import {withWikiSections} from "./wiki-sections";
import type {WikiKnowledgeLedger,WikiKnowledgeUnit} from "./wiki-knowledge";
const source={language:"text",text:"Create document\nSave draft\nExport PDF"};
const unit=(statement:string,code=source):WikiKnowledgeUnit=>({id:statement,subject:"Workspace",kind:"constraint",statement,details:[],adoption:{status:"proposal"},delivery:"unknown",evidence:{evidenceId:"e",conversationId:"c",messageId:"m",messageIndex:1,role:"assistant",pasted:false,quote:"操作文案如下：",code}});
const fence=(text:string)=>'```text\n'+text+'\n```';

it("keeps UI copy in named attachments and refuses unrelated source ownership",()=>{
 const own=unit("若成本允许，菜单可提供 Create document 和 Save draft，非首期必须。"),wrong=unit("主题切换必须同步所有面板。");
 expect(wikiUiCopy(source)).toBe("actions");expect(wikiUiCopySupports(source,own)).toBe(true);expect(wikiUiCopySupports(source,wrong)).toBe(false);
 expect(planWikiSourceBlock(source,"",[wrong])).toMatchObject({mode:"source_only",reason:expect.any(String)});
 const shown=wikiBlockPresentation(own.statement+'\n\n'+fence(source.text),{units:[own,wrong]});
 expect(shown.body).toContain(own.statement);expect(shown.body).toContain("<summary>操作文案</summary>");expect(shown.body).toContain(fence(source.text));
 expect(shown.body).not.toContain("Create document · Save draft");
 expect(shown.decisions[0].unitIds).toEqual([own.id]);
 expect(wikiBlockPresentation(shown.body,{units:[own,wrong]}).body).toBe(shown.body);
 expect(wikiBlockPresentation(fence(source.text),{units:[wrong]}).body).toBe("");
 expect(wikiBlockPresentation(fence("Type your question..."))).toMatchObject({decisions:[expect.objectContaining({mode:"supplement"})]});
 expect(wikiUiCopy({language:"ts",text:"Create document"})).toBeUndefined();
});

it("repairs exact legacy fragments only when the ledger proves their source",()=>{
 const text="Create document · Save draft · Export PDF",own=unit("菜单提供 Save draft。");
 expect(wikiBlockPresentation(text,{units:[own]}).body).toContain(fence(source.text));
 expect(wikiBlockPresentation(text).body).toBe(text);
 const prose='说明：'+text+'，仅在用户确认后执行。';
 expect(wikiBlockPresentation(prose,{units:[own]}).body).toBe(prose);
});

it("removes incidental UI-copy bindings during enrichment without altering messages or source units",()=>{
 const right=unit("菜单提供 Save draft，暂不启用。"),wrong=unit("面板使用浅色背景。");
 const ledger={batches:[{units:[right,wrong]}]} as WikiKnowledgeLedger;
 const messages=[{id:"m",conversationId:"c",messageIndex:1,content:'操作文案如下：\n\n'+fence(source.text)}];
 const before=JSON.stringify({ledger,messages});
 const result=withWikiSections(ledger,messages);
 expect(result.batches[0].units[0].evidence.code).toEqual(source);
 expect(result.batches[0].units[1].evidence.code).toBeUndefined();
 expect(JSON.stringify({ledger,messages})).toBe(before);
});
