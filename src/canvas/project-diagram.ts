import type { ProjectModule, ProjectState } from "../shared/project-state";
import { architectureGroups } from "./map-presentation";
/** Collapsed nodes are local navigation groups, never exported project facts. */
export function projectDiagram(modules:ProjectModule[],relations:ProjectState["relations"],expanded:Set<string>,selected?:string){
  const sections=modules.map(item=>({...item,body:"",transition:"",kind:"review" as const}));
  const containment=relations.filter(edge=>edge.kind==="contains"&&modules.some(item=>item.id===edge.from)&&modules.some(item=>item.id===edge.to));
  const descendants=(id:string,seen=new Set<string>()):Set<string>|undefined=>{
    if(seen.has(id))return;
    const children=new Set<string>([id]);
    for(const edge of containment.filter(edge=>edge.from===id)){
      if(containment.filter(other=>other.to===edge.to).length!==1)return;
      const branch=descendants(edge.to,new Set([...seen,id]));if(!branch)return;
      branch.forEach(child=>children.add(child));
    }
    return children;
  };
  const hierarchy=modules.filter(item=>containment.some(edge=>edge.from===item.id)&&!containment.some(edge=>edge.to===item.id)).flatMap(item=>{
    const children=descendants(item.id);return children&&children.size>3?[{id:`subsystem:${item.id}`,title:item.title,items:sections.filter(section=>children.has(section.id))}]:[];
  });
  const hierarchicalIds=new Set(hierarchy.flatMap(group=>group.items.map(item=>item.id)));
  const groups=[...hierarchy,...architectureGroups(sections.filter(item=>!hierarchicalIds.has(item.id)))],membership=new Map<string,string>();
  // The overview folds only genuine layers or sourced containment, never a
  // fabricated “miscellaneous” subsystem. A selected module opens its group.
  const foldable=groups.filter(group=>group.items.length>2&&(modules.length>10||group.id.startsWith("subsystem:")));
  const collapsed=foldable.filter(group=>!expanded.has(group.id)&&!group.items.some(item=>item.id===selected));
  for(const group of collapsed)for(const item of group.items)membership.set(item.id,`diagram-group:${group.id}`);
  const nodes=modules.filter(item=>!membership.has(item.id));
  for(const group of collapsed)nodes.push({id:`diagram-group:${group.id}`,title:group.title,layer:"",purpose:`${group.items.length} 个模块`,inputs:[],outputs:[],status:group.items.some(item=>modules.find(module=>module.id===item.id)?.status==="uncertain")?"uncertain":group.items.some(item=>modules.find(module=>module.id===item.id)?.status==="proposal")?"proposal":"documented",quote:"",evidenceIds:[]});
  const aggregated=new Map<string,ProjectState["relations"]>();
  for(const edge of relations){const from=membership.get(edge.from)??edge.from,to=membership.get(edge.to)??edge.to;if(from===to)continue;const key=JSON.stringify([from,to,edge.kind,edge.label]);aggregated.set(key,[...(aggregated.get(key)??[]),edge]);}
  const links=[...aggregated.values()].map(edges=>({...edges[0],from:membership.get(edges[0].from)??edges[0].from,to:membership.get(edges[0].to)??edges[0].to,quote:[...new Set(edges.map(edge=>edge.quote))].join("\n\n"),evidenceIds:[...new Set(edges.flatMap(edge=>edge.evidenceIds))]}));
  return {nodes,links,collapsed,groupIds:foldable.map(group=>group.id)};
}
