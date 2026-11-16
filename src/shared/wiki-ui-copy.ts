import type {WikiKnowledgeUnit} from "./wiki-knowledge";

interface SourceBlock {language:string;text:string}
const PLAIN=/^(?:text|plaintext|plain|txt|markdown|md)?$/iu;
const ACTION=/^(?:Add|Run|Fit|Toggle|Generate|Open|Close|Save|Delete|Create|Edit|Copy|Import|Export|添加|运行|切换|保存|删除|打开|关闭|生成|导入|导出)\s*[^。.!?！？]{1,45}$/iu;
/** Classify UI copy as examples, never as independent narrative or executable instructions. */
export function wikiUiCopy(code:SourceBlock):"actions"|"placeholder"|"progress"|undefined {
 if(!PLAIN.test(code.language))return;
 const lines=code.text.trim().split(/\r?\n/u).map(line=>line.trim()).filter(Boolean);
 if(!lines.length||lines.length>16)return;
 if(lines.every(line=>/^Step\s+\d+\s*\/\s*\d+$/iu.test(line)))return "progress";
 if(lines.every(line=>ACTION.test(line)))return "actions";
 if(lines.length===1&&lines[0].length<=120&&/^(?:请输入|输入.{0,12}(?:需求|问题|内容)|Ask\b|Type\b|Enter\b|Search\b|Describe\b).*(?:\.{3}|…|[？?])?$/iu.test(lines[0]))return "placeholder";
}

const bare=(value:string)=>value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}]/gu,"");
/** A copied block on the same message is not sufficient proof of ownership. Require literal copy in the claim/details. */
export function wikiUiCopySupports(code:SourceBlock,unit:WikiKnowledgeUnit):boolean {
 const said=bare([unit.statement,...unit.details??[]].join("\n"));
 return code.text.split(/\r?\n/u).map(bare).filter(value=>value.length>=4).some(value=>said.includes(value));
}
