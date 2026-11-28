import type {Root,Paragraph,TableCell,PhrasingContent,RootContent} from "mdast";

export const WIKI_CLAIM_MARKER="#atlas-claim-";
export interface WikiClaimMarkerPoint {key:string;phrases:string[];approximate?:boolean}

type TextHost = Paragraph | TableCell;
const textOf=(node:PhrasingContent|RootContent):string=>"value" in node?String(node.value):"children" in node?(node.children as PhrasingContent[]).map(textOf).join(""):"";
// Matching ignores whitespace and width differences; offsets map back to the raw text.
const compact=(text:string)=>text.normalize("NFKC").replace(/\s/gu,"");
const SENTENCE_END=/[。！？!?；;]/u;

function compactOffsets(text:string){
 let normalized="";const ends:number[]=[];let offset=0;
 for(const char of text){offset+=char.length;for(const part of compact(char)){normalized+=part;ends.push(offset);}}
 return {normalized,ends};
}

/** Insert `node` at a flat-text offset among inline children. Splits a text node;
 * an offset inside emphasis, code or a link goes after that whole element. */
function insertAt(host:TextHost,offset:number,nodes:PhrasingContent[]){
 let position=0;
 for(const [index,child] of host.children.entries()){
  const length=textOf(child).length;
  if(offset<=position+length){
   if(child.type==="text"&&offset<position+length){
    const at=offset-position;
    host.children.splice(index,1,{type:"text",value:child.value.slice(0,at)},...nodes,{type:"text",value:child.value.slice(at)});
   }else host.children.splice(index+1,0,...nodes);
   return;
  }
  position+=length;
 }
 host.children.push(...nodes);
}

const SUBSTANTIVE_TABLE_CELL_MIN = 20;
const isSubstantiveTableCell = (cell: TableCell, columnIndex: number) =>
 columnIndex > 0 && compact(cell.children.map(textOf).join("")).length >= SUBSTANTIVE_TABLE_CELL_MIN;

function paragraphs(nodes:RootContent[]):TextHost[]{
 // Keep short label/tag cells in tables clean; allow inline claim markers on substantive long-text cells (e.g. plans/criteria).
 return nodes.flatMap(node=>node.type==="paragraph"?[node]
  :node.type==="list"?node.children.flatMap(item=>paragraphs(item.children))
  :node.type==="table"?node.children.slice(1).flatMap(row=>row.children.filter((cell,index)=>isSubstantiveTableCell(cell,index)))
  :[]);
}

/** Reading-only: place one marker after the sentence containing each claim's first
 * literal occurrence. Claims not found in the prose get no marker; nothing is invented. */
export function wikiClaimMarkers({points=[]}:{points?:WikiClaimMarkerPoint[]}={}){
 return (tree:Root)=>{
  if(!points.length)return;
  const pending=points.map(({key,phrases})=>({key,phrases:phrases.map(text=>({text,needle:compact(text)})).filter(({needle})=>needle.length>=6)})).filter(point=>point.phrases.length);
  for(const paragraph of paragraphs(tree.children)){
   if(!pending.length)break;
   const text=paragraph.children.map(textOf).join("");
   let compacted:ReturnType<typeof compactOffsets>|undefined;
   const placed:Array<{offset:number;key:string}>=[];
   for(let index=0;index<pending.length;index++){
    let end:number|undefined;
    for(const phrase of pending[index].phrases){
     const exact=text.indexOf(phrase.text);
     if(exact>=0){end=exact+phrase.text.length;break;}
     const {normalized,ends}=compacted??=compactOffsets(text);
     const at=normalized.indexOf(phrase.needle);
     if(at>=0){end=ends[at+phrase.needle.length-1];break;}
    }
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
