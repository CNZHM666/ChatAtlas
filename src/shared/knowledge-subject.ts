import {sourceQuoteText} from "./source-quote-text";

const normalized=(text:string)=>sourceQuoteText(text).normalize("NFKC").toLowerCase();
const filler=/是否|能否|要不要|还是|我决定|最终决定|我已经|已经|目前|当前|首版|第一版|项目|用户|我们|这个|那个|方案|功能|问题|需要|进行|相关|完成|实现|采用|选择|计划|建议|决定|确认|支持|验证|使用|保留|增加|暂不|不再|可以|只做|仅做|同时|另外|还要|补充|仍然|继续|不得|必须|禁止|不做/gu;
export function knowledgeTerms(text:string){
 const words=normalized(text).replace(filler," ").match(/[a-z][a-z\d_+#.-]*|[\p{Script=Han}]+/gu)??[];
 return new Set(words.flatMap(word=>/\p{Script=Han}/u.test(word)?Array.from({length:Math.max(0,word.length-1)},(_,index)=>word.slice(index,index+2)):[word]).filter(word=>! /^(?:i|we|a|an|the|and|or|to|of|for|with|from|this|that|user|project|should|will|have|has|can|could|do|does|not|use|using|adopt|choose|whether|decided|completed|implemented|version|v\d.*)$/u.test(word)));
}
/** Similarity is a navigation guard, never proof of truth or of equivalence. */
export function knowledgeOverlap(first:string,second:string){
 const left=knowledgeTerms(first),right=knowledgeTerms(second);
 return [...left].filter(term=>right.has(term));
}
export function knowledgeVersion(text:string){return normalized(text).match(/\bv\d+(?:\.\d+)*(?:[-\w.]*)?/iu)?.[0].replace(/\.+$/u,"");}
export function knowledgeOwner(text:string){
 const value=normalized(text);
 return /byok|用户.{0,12}(?:密钥|api\s*key)|user.{0,15}(?:key|credential)/u.test(value)?"user-key":/平台.{0,12}(?:密钥|api\s*key)|platform.{0,15}(?:key|credential)/u.test(value)?"platform-key":"";
}
export function knowledgeScopesAgree(...texts:string[]){
 const versions=new Set(texts.flatMap(text=>knowledgeVersion(text)?[knowledgeVersion(text)!]:[]));
 const owners=new Set(texts.flatMap(text=>knowledgeOwner(text)?[knowledgeOwner(text)]:[]));
 return versions.size<=1&&owners.size<=1;
}
