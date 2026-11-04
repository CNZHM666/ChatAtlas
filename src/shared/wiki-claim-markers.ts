import type {Root,Paragraph,PhrasingContent,RootContent} from "mdast";

export const WIKI_CLAIM_MARKER="#atlas-claim-";
export interface WikiClaimMarkerPoint {key:string;phrases:string[]}

const textOf=(node:PhrasingContent|RootContent):string=>"value" in node?String(node.value):"children" in node?(node.children as PhrasingContent[]).map(textOf).join(""):"";
// Matching ignores whitespace and width differences; offsets map back to the raw text.
const compact=(text:string)=>text.normalize("NFKC").replace(/\s/gu,"");
const SENTENCE_END=/[。！？!?；;]/u;

function phraseEnd(text:string,phrase:string):number|undefined {
 const exact=text.indexOf(phrase);if(exact>=0)return exact+phrase.length;
 const needle=compact(phrase);if(!needle)return;
 let normalized="";const ends:number[]=[];let offset=0;
 for(const char of text){offset+=char.length;for(const part of compact(char)){normalized+=part;ends.push(offset);}}
 const at=normalized.indexOf(needle);
 return at<0?undefined:ends[at+needle.length-1];
}

/** Insert `node` at a flat-text offset among inline children. Splits a text node;
 * an offset inside emphasis, code or a link goes after that whole element. */
function insertAt(paragraph:Paragraph,offset:number,nodes:PhrasingContent[]){
 let position=0;
 for(const [index,child] of paragraph.children.entries()){
  const length=textOf(child).length;
  if(offset<=position+length){
   if(child.type==="text"&&offset<position+length){
    const at=offset-position;
    paragraph.children.splice(index,1,{type:"text",value:child.value.slice(0,at)},...nodes,{type:"text",value:child.value.slice(at)});
   }else paragraph.children.splice(index+1,0,...nodes);
   return;
  }
  position+=length;
 }
 paragraph.children.push(...nodes);
}

function paragraphs(nodes:RootContent[]):Paragraph[]{
 // Quotations, code and tables are source material or structure, never a claim position.
 return nodes.flatMap(node=>node.type==="paragraph"?[node]:node.type==="list"?node.children.flatMap(item=>paragraphs(item.children)):[]);
}

/** Reading-only: place one marker after the sentence containing each claim's first
 * literal occurrence. Claims not found in the prose get no marker; nothing is invented. */
export function wikiClaimMarkers({points=[]}:{points?:WikiClaimMarkerPoint[]}={}){
 return (tree:Root)=>{
  if(!points.length)return;
  const pending=points.map(point=>({...point,phrases:point.phrases.filter(phrase=>compact(phrase).length>=6)})).filter(point=>point.phrases.length);
  for(const paragraph of paragraphs(tree.children)){
   if(!pending.length)break;
   const text=paragraph.children.map(textOf).join("");
   const placed:Array<{offset:number;key:string}>=[];
   for(let index=0;index<pending.length;index++){
    const end=pending[index].phrases.map(phrase=>phraseEnd(text,phrase)).find(value=>value!==undefined);
    if(end===undefined)continue;
    const stop=text.slice(end-1).search(SENTENCE_END);
    placed.push({offset:stop<0?text.length:end-1+stop+1,key:pending[index].key});
    pending.splice(index--,1);
   }
   // Insert from the end so earlier offsets stay valid; same-sentence markers keep claim order.
   const groups=new Map<number,string[]>();for(const item of placed)groups.set(item.offset,[...groups.get(item.offset)??[],item.key]);
   for(const [offset,keys] of [...groups].sort((a,b)=>b[0]-a[0]))insertAt(paragraph,offset,keys.map(key=>({type:"link",url:`${WIKI_CLAIM_MARKER}${encodeURIComponent(key)}`,children:[{type:"text",value:"*"}]})));
  }
 };
}
