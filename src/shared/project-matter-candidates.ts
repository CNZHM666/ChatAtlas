import type { FocusSession } from "./focus-session";
import type { ProjectRecord, ProjectState } from "./project-state";
import { projectMatters, type ProjectMatter } from "./project-matters";
import { matterIdentity } from "./project-knowledge-links";
import { sourceMessageSignature } from "./source-signature";
import { projectQuestionKey } from "./project-state";
const normalized=(text:string)=>text.normalize("NFKC").toLowerCase().replace(/\s+/gu,"").replace(/[。！？!?]+$/u,"");
const grams=(text:string)=>{const value=normalized(text);return new Set(Array.from({length:Math.max(0,value.length-1)},(_,index)=>value.slice(index,index+2)));};
function similar(a:string,b:string){const left=grams(a),right=grams(b),common=[...left].filter(value=>right.has(value)).length;return common/Math.max(1,new Set([...left,...right]).size);}
export function projectMatterCandidates(session:FocusSession,draft:ProjectState) {
  const old=projectMatters(session);
  const protectedRows=([['question','questions'],['decision','decisions'],['boundary','constraints']] as const).flatMap(([type,kind])=>[
    ...(session.projectState?.[kind]??[]).map(row=>({id:type==="question"?projectQuestionKey(row.text):row.id,type,text:row.text,originalText:row.text,status:"dismissed" as const,sources:[],personal:false})),
    ...Object.entries(session.projectMaintenance?.[kind]??{}).flatMap(([id,row])=>[row.text,...('originalText' in row&&row.originalText?[row.originalText]:[])].map(text=>({id,type,text,originalText:text,status:"dismissed" as const,sources:[],personal:true})))
  ]);
  return ([['question',draft.questions??[]],['decision',draft.decisions],['boundary',draft.constraints]] as const).flatMap(([type,rows])=>rows.map(record=>{
    const duplicate=[...old,...protectedRows].find(item=>item.type===type&&(normalized(item.text)===normalized(record.text)||normalized(item.originalText)===normalized(record.text)));
    const collection=type==="question"?session.projectState?.questions:type==="decision"?session.projectState?.decisions:session.projectState?.constraints;
    const previous=collection?.find(item=>item.id===duplicate?.id||type==="question"&&item.text===duplicate?.originalText);
    const kind=type==="question"?"questions":type==="decision"?"decisions":"constraints";
    const updateTarget=duplicate&&!duplicate.personal&&!session.projectMaintenance?.[kind]?.[duplicate.id]&&duplicate.status==="open"&&record.status!=="uncertain"&&record.matter?.settlement&&previous&&previous.quote===record.quote&&previous.evidenceIds.some(id=>record.evidenceIds.includes(id))&&(!previous.matter||previous.matter.subject===record.matter.subject&&previous.matter.scope===record.matter.scope)?previous:undefined;
    const mergeSuggestions=old.filter(item=>item.id!==duplicate?.id&&item.status==="open"&&similar(item.text,record.text)>=.65);
    return {key: `${type}:${record.id}`,type,record,duplicate:updateTarget?undefined:duplicate,updateTarget,mergeSuggestions};
  }));
}
/** Only selected supplied candidates are added. Saved records/approvals are never replaced by omission. */
export function acceptMatterCandidates(session:FocusSession,draft:ProjectState,selected:string[]):ProjectState {
  const candidates=projectMatterCandidates(session,draft),keys=new Set(selected),known=new Set(candidates.map(item=>item.key));
  if([...keys].some(key=>!known.has(key)))throw new Error("候选已变化，请重新审核 / Candidates changed");
  const base=session.projectState;
  const result:ProjectState={...draft,summary:base?.summary??draft.summary,modules:base?.modules??draft.modules,relations:base?.relations??draft.relations,pendingRelations:base?.pendingRelations??draft.pendingRelations,actions:base?.actions??[],history:base?.history,decisions:[...base?.decisions??[]],constraints:[...base?.constraints??[]],questions:[...base?.questions??[]]};
  // Preserving an omitted old record must not silently refresh its source verification.
  if(base&&(base.partSignatures?.decisions??base.signature)!==draft.signature)for(const kind of ["decisions","constraints"] as const)result[kind]=result[kind].map(record=>({...record,sourceBasisSignature:record.sourceBasisSignature??base.partSignatures?.decisions??base.signature}));
  const seen=new Set<string>();
  for(const candidate of candidates) {
    const key=`${candidate.type}:${normalized(candidate.record.text)}`;
    if(!keys.has(candidate.key)||candidate.duplicate||seen.has(key))continue;
    seen.add(key);
    const rows=candidate.type==="question"?result.questions!:candidate.type==="decision"?result.decisions:result.constraints;
    if(candidate.updateTarget){const index=rows.findIndex(item=>item.id===candidate.updateTarget!.id);if(index>=0){rows[index]={...candidate.record,id:candidate.updateTarget.id};continue;}}
    const record:ProjectRecord={...candidate.record,status:candidate.record.status==="superseded"?"proposal":candidate.record.status};
    const maintenance=candidate.type==="question"?session.projectMaintenance?.questions:candidate.type==="decision"?session.projectMaintenance?.decisions:session.projectMaintenance?.constraints;
    if(rows.some(item=>item.id===record.id)||maintenance?.[record.id])record.id=`${candidate.type}:candidate:${sourceMessageSignature(JSON.stringify([record.text,record.quote,record.evidenceIds]))}`;
    while(maintenance?.[record.id])record.id=`${record.id}:new`;
    if(!rows.some(item=>item.id===record.id))rows.push(record);
  }
  return result;
}
export function candidateAsMatter(session:FocusSession,record:ProjectRecord,type:ProjectMatter["type"]):ProjectMatter {
  const settlement=record.status!=="uncertain"?record.matter?.settlement:undefined;
  return {id:record.id,type,status:settlement&&record.matter?.state==="settled"?"resolved":settlement&&record.matter?.state==="withdrawn"?"dismissed":"open",text:record.text,originalText:record.text,displayTitle:record.displayTitle,reason:record.reason,resolution:settlement?.text,personal:false,sources:session.evidence.filter(ref=>record.evidenceIds.includes(ref.id)||settlement?.evidenceIds.includes(ref.id))};
}
export {matterIdentity};
