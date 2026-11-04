import {expect,it} from "vitest";
import {wikiTitleReviewIncomplete} from "./wiki-title-review";
import {wikiChapterStatus,wikiDocumentStatus} from "./wiki-chapter-status";
import {keepWikiDraft} from "./wiki-review";
import type {FocusSection} from "./focus-session";

const review=(reasons:string[])=>({version:2 as const,status:"partial" as const,requested:3,accepted:1,rejected:reasons.map((reason,index)=>({id:`c:${index}`,reason}))});

it("reports titles as unfinished only after a real processing failure",()=>{
 expect(wikiTitleReviewIncomplete(review(["unchanged","paired","kept_paired","collision"]))).toBe(false);
 expect(wikiTitleReviewIncomplete(review(["unchanged","request_failed"]))).toBe(true);
 expect(wikiTitleReviewIncomplete({...review([]),status:"ready"})).toBe(false);
 expect(wikiTitleReviewIncomplete(undefined)).toBe(false);
});

it("states source counts and the separate review axis for chapters and the document",()=>{
 const claim={text:"a",quote:"a",evidenceIds:["e1"]};
 const proposal={claims:[{...claim,workStatus:"proposed" as const}]} as FocusSection,reported={claims:[{...claim,workStatus:"reported" as const}]} as FocusSection;
 expect(wikiChapterStatus(proposal,true)).toBe("多为 AI 建议，相关原文里没有看到你的确认");
 expect(wikiDocumentStatus([proposal,proposal,reported],true)).toBe("多为 AI 建议，相关原文里没有看到你的确认。还没有逐章核对");
 expect(wikiDocumentStatus([proposal,{...proposal,userEdited:true}],true)).toBe("多为 AI 建议，相关原文里没有看到你的确认。修改过 1 章");
 const kept=keepWikiDraft({...proposal,id:"k",title:"t",body:"b",kind:"finding",transition:"",evidenceIds:[]} as FocusSection);
 expect(wikiChapterStatus(kept,true)).toContain("你已保留这一章的整理稿（不代表事实已确认）");
 expect(wikiDocumentStatus([kept,proposal],true)).toContain("已保留 1/2 章整理稿");
 expect(wikiDocumentStatus([{claims:[{...claim}]} as FocusSection],true)).toBeUndefined();
});
