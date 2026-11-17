import type { Link, Paragraph, Root, RootContent } from "mdast";
import { wikiEvidenceTarget } from "../shared/wiki-evidence-link";
import { isWikiTableIntroduction } from "../shared/wiki-plan-tables";

const LABEL = /^\s*(?:原文来源|Original source|Source references?)\s*$/iu;
const paragraphText = (node: Paragraph) => node.children.map(child =>
  child.type==="text" ? child.value : "children" in child ? child.children.map(part=>part.type==="text"?part.value:"").join("") : "").join("");

function sourceLine(node: RootContent|undefined) {
  if (node?.type!=="paragraph" || node.children[0]?.type!=="text" || !LABEL.test(node.children[0].value)) return [];
  const rest=node.children.slice(1);
  return rest.every(child=>child.type==="link"&&wikiEvidenceTarget(child.url)?.table || child.type==="text"&&!child.value.trim())
    ? rest.filter((child):child is Link=>child.type==="link") : [];
}

/** Application links stay attached to the table that supplied them. Combined
 * tables keep numbered references on each row and use one source menu. */
export function readerWikiTableSources({zh}:{zh:boolean}) {
  return (tree:Root) => {
    const output:RootContent[]=[];
    for(let index=0;index<tree.children.length;index++){
      const table=tree.children[index];
      if(table.type!=="table"){output.push(table);continue;}
      const next=sourceLine(tree.children[index+1]);
      const previous=output.at(-1);
      const before=output.at(-2)?.type==="table"?[]:sourceLine(previous);
      const refs=new Map<string,Link>();
      for(const link of [...before,...next])refs.set(link.url,link);
      for(const row of table.children)for(const cell of row.children)for(const child of cell.children)
        if(child.type==="link"&&wikiEvidenceTarget(child.url)?.table)refs.set(child.url,child);
      if(!refs.size){output.push(table);continue;}
      if(before.length)output.pop();
      if(next.length)index++;
      const intro=output.at(-1);
      const title=intro?.type==="paragraph"&&isWikiTableIntroduction(paragraphText(intro))?(output.pop(),intro.children):[];
      const label=zh?"来源":"Source";
      const links=[...refs.values()].map((link,at):Link=>({...link,children:[{type:"text",value:refs.size===1?label:`${label} ${at+1}`}]}));
      const numbers=new Map(links.map((link,at)=>[link.url,at+1]));
      for(const row of table.children)for(const cell of row.children)cell.children=cell.children.map(child=>{
        const number=child.type==="link"?numbers.get(child.url):undefined;
        return number?{type:"text",value:refs.size===1?label:`${label} ${number}`}:child;
      });
      output.push({type:"blockquote",data:{hName:"atlas-table-heading"},children:[
        {type:"paragraph",children:title},
        {type:"paragraph",children:links},
      ]},table);
    }
    tree.children=output;
  };
}
