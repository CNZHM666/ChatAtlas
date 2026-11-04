import {expect,it} from "vitest";
import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import {wikiClaimMarkers,WIKI_CLAIM_MARKER} from "./wiki-claim-markers";

const render=(markdown:string,points:Array<{key:string;phrases:string[]}>)=>{
 const processor=unified().use(remarkParse).use(remarkGfm).use(wikiClaimMarkers,{points}).use(remarkStringify);
 return String(processor.processSync(markdown)).trim();
};
// remark-stringify escapes the placeholder text; the link target is what matters.
const marker=(key:string)=>`[\\*](${WIKI_CLAIM_MARKER}${encodeURIComponent(key)})`;

it("places one marker after the sentence holding each claim, in reading order",()=>{
 const output=render("Atlas 先在本地检索候选消息，再按需调用模型。基础搜索不依赖 API Key。",[
  {key:"s:1",phrases:["基础搜索不依赖 API Key"]},{key:"s:0",phrases:["先在本地检索候选消息"]},
 ]);
 expect(output).toBe(`Atlas 先在本地检索候选消息，再按需调用模型。${marker("s:0")}基础搜索不依赖 API Key。${marker("s:1")}`);
});

it("matches across bold and whitespace and places the marker after the emphasis",()=>{
 const output=render("**用户手动确认的知识不得被静默覆盖**，后续检索结果只能提示。",[{key:"k",phrases:["用户手动确认的知识不得被静默覆盖，后续检索结果只能提示"]}]);
 expect(output).toBe(`**用户手动确认的知识不得被静默覆盖**，后续检索结果只能提示。${marker("k")}`);
 expect(render("**结论在加粗里结束。** 后面还有话。",[{key:"b",phrases:["结论在加粗里结束"]}])).toBe(`**结论在加粗里结束。**${marker("b")} 后面还有话。`);
});

it("never invents a position: short, missing, quoted or code phrases get no marker",()=>{
 const source="> 引文里的完整结论句子。\n\n```\n代码里的完整结论句子\n```\n\n正文里没有这句话。";
 expect(render(source,[{key:"a",phrases:["引文里的完整结论句子"]},{key:"b",phrases:["代码里的完整结论句子"]},{key:"c",phrases:["正文"]},{key:"d",phrases:["完全不存在的一段结论"]}])).toBe(source);
});

it("places each claim once and keeps list items as positions",()=>{
 const output=render("- 第一项包含重复的结论句。\n- 第二项也包含重复的结论句。",[{key:"r",phrases:["包含重复的结论句"]}]);
 expect(output.split(WIKI_CLAIM_MARKER)).toHaveLength(2);
 expect(output).toContain(`第一项包含重复的结论句。${marker("r")}`);
});
