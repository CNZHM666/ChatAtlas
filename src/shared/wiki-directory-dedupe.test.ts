import {expect,it} from "vitest";
import {applyWikiDirectory} from "./wiki-directory";
import type {FocusSection} from "./focus-session";

const section=(id:string,body:string)=>({id,title:"架构",body,kind:"finding",transition:"",evidenceIds:[id]}) as FocusSection;

it("keeps one copy of a paragraph that batches repeated with different spacing",()=>{
 const [page]=applyWikiDirectory([section("a","针对模型端 Compaction，AI指出其为有损压缩。\n\n第一段独有内容。"),section("b","针对模型端 Compaction，AI 指出其为有损压缩。\n\n第二段独有内容。")],[{title:"架构",group:"",question:"架构？",sectionIds:["a","b"]}]);
 expect(page.body.match(/Compaction/gu)).toHaveLength(1);
 expect(page.body).toContain("第一段独有内容。");expect(page.body).toContain("第二段独有内容。");
});
