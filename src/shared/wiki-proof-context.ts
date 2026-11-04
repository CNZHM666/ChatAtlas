import {unified} from "unified";
import remarkParse from "remark-parse";
import type {RootContent} from "mdast";
import {wikiQuoteRange} from "./wiki-claims";

const parser=unified().use(remarkParse);
const parsed=new Map<string,RootContent[]>();

/** Literal enclosing block and heading path, never generated facts. A quote
 * can omit an "if" in its own sentence or a Historical heading above it. */
export function wikiProofContext(text:string,quote:string,limit=2400):{text?:string;omitted?:true}{
 const range=wikiQuoteRange(text,quote);if(!range)return {};
 let nodes=parsed.get(text);
 if(!nodes){nodes=parser.parse(text).children;if(text.length<=100000){if(parsed.size>=4)parsed.delete(parsed.keys().next().value!);parsed.set(text,nodes);}}
 const index=nodes.findIndex(node=>node.position!.start.offset!<=range.start&&node.position!.end.offset!>=range.end);
 if(index<0)return {};
 const node=nodes[index],headings:typeof nodes=[];
 for(const candidate of nodes.slice(0,index))if(candidate.type==="heading"){
  while(headings.length&&headings.at(-1)!.type==="heading"&&(headings.at(-1)! as typeof candidate).depth>=candidate.depth)headings.pop();
  headings.push(candidate);
 }
 const previous=nodes[index-1];
 const lead=previous?.type==="paragraph"&&/[:：]\s*$/u.test(text.slice(previous.position!.start.offset!,previous.position!.end.offset!))?previous:undefined;
 const context=[...headings,...lead?[lead]:[],node].map(part=>text.slice(part.position!.start.offset!,part.position!.end.offset!)).join("\n\n");
 return context.length>limit?{omitted:true}:context===quote?{}:{text:context};
}
