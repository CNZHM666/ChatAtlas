import type { FocusEvidence, FocusSession } from "./focus-session";
import {currentMatterSettlement} from "./project-matter-assessment";
import { projectQuestionItems, projectQuestionKey, projectStateModel, projectStateSignature, type ProjectMaintenance, type ProjectMatterDetails } from "./project-state";

export interface ProjectMatter extends ProjectMatterDetails {
  id: string; type: "question" | "decision" | "boundary"; status: "open" | "resolved" | "dismissed";
  text: string; originalText: string; reason?: string; sources: FocusEvidence[]; personal: boolean;
  resolutionFromDiscussion?:boolean;
}
export function projectMatters(session: FocusSession): ProjectMatter[] {
  const model=projectStateModel(session), result: ProjectMatter[]=[];
  for(const item of projectQuestionItems(session)) {
    const stored=session.projectMaintenance?.questions?.[item.key];
    const record=session.projectState?.questions?.find(row=>projectQuestionKey(row.text)===item.key),settled=currentMatterSettlement(session,record);
    const historical=!stored&&settled?record!.matter!.state:undefined;
    result.push({...stored,...(!stored&&settled?{resolution:settled.text,resolutionFromDiscussion:true}:{}),displayTitle:stored?.displayTitle??record?.displayTitle,id:item.key,type:"question",status:item.dismissed||historical==="withdrawn"?"dismissed":item.resolved||historical==="settled"?"resolved":"open",text:item.text,originalText:stored?.originalText??item.text,sources:[...new Map([...item.sources,...session.evidence.filter(ref=>settled?.evidenceIds.includes(ref.id))].map(ref=>[ref.id,ref])).values()],personal:item.personal});
  }
  for(const [type,kind] of [["decision","decisions"],["boundary","constraints"]] as const) {
    const original=session.projectState?.[kind]??[], saved=session.projectMaintenance?.[kind]??{};
    const ids=[...new Set([...original.map(item=>item.id),...Object.keys(saved)])];
    for(const id of ids) {
      const old=original.find(item=>item.id===id), stored=saved[id];
      if(stored?.hidden||old?.status==="superseded")continue;
      const edited=Boolean(stored&&old&&stored.text!==old.text);
      const confirmed=type==="decision"?model?.decisions.find(item=>item.id===id)?.confirmed??stored?.confirmed:stored?.confirmed&&(!old||!model?.decisionsStale&&(!old.sourceBasisSignature||old.sourceBasisSignature===projectStateSignature(session)||stored.confirmationSignature===projectStateSignature(session))&&(stored.basisText??stored.text)===old.text);
      // A changed original decision invalidates its old approval via the existing model.
      const settlement=!stored?currentMatterSettlement(session,old):undefined;
      const reopened=stored?.matterStatus==="open";
      const resolved=!reopened&&Boolean(confirmed||settlement&&old?.matter?.state==="settled");
      result.push({...stored,...(settlement?{resolution:settlement.text,resolutionFromDiscussion:true}:{}),id,type,status:stored?.matterStatus==="dismissed"||!stored&&settlement&&old?.matter?.state==="withdrawn"?"dismissed":resolved?"resolved":"open",displayTitle:stored?.displayTitle??old?.displayTitle,text:stored?.text??old!.text,originalText:old?.text??stored!.text,reason:edited?undefined:old?.reason,sources:edited?[]:session.evidence.filter(ref=>old?.evidenceIds.includes(ref.id)||settlement?.evidenceIds.includes(ref.id)),personal:edited||!old});
    }
  }
  return result;
}

/** Write through to the same legacy collection and ID; no second knowledge record. */
export function patchMatter(session: FocusSession, matter: ProjectMatter, patch: Partial<ProjectMatterDetails> & {text?:string;hidden?:boolean}, now=Date.now()): ProjectMaintenance {
  const kind=matter.type==="question"?"questions":matter.type==="decision"?"decisions":"constraints";
  const existing=session.projectMaintenance?.[kind]?.[matter.id];
  const status=patch.matterStatus??matter.status;
  const history=existing?.resolutionHistory??[];
  const changed=patch.resolution!==undefined&&patch.resolution!==existing?.resolution||patch.resolutionReason!==undefined&&patch.resolutionReason!==existing?.resolutionReason||status!==matter.status;
  const shared={...existing,...patch,...(patch.matterStatus==="resolved"?{confirmationSignature:projectStateSignature(session)}:{}),text:patch.text??matter.text,matterStatus:status,...(patch.matterStatus==="open"?{mergedInto:undefined}:{}),updatedAt:now,...(changed?{resolutionUpdatedAt:now}:{}),
    ...(changed?{resolutionHistory:[...history,{resolution:existing?.resolution??matter.resolution??"",reason:existing?.resolutionReason??matter.resolutionReason??"",status:matter.status,recordedAt:now}]}:{})};
  if(kind==="questions")return {...session.projectMaintenance,questions:{...session.projectMaintenance?.questions,[matter.id]:{...shared,originalText:existing&&"originalText" in existing?existing.originalText??matter.originalText:matter.originalText,resolved:status==="resolved",resolvedAt:status==="resolved"?existing&&"resolvedAt" in existing?existing.resolvedAt??now:now:undefined,sources:matter.sources}}};
  if(kind==="decisions")return {...session.projectMaintenance,decisions:{...session.projectMaintenance?.decisions,[matter.id]:{...shared,confirmed:status==="resolved",basisText:session.projectState?.decisions.find(item=>item.id===matter.id)?.text}}};
  return {...session.projectMaintenance,constraints:{...session.projectMaintenance?.constraints,[matter.id]:{...shared,confirmed:status==="resolved",basisText:session.projectState?.constraints.find(item=>item.id===matter.id)?.text}}};
}

/** Short label is display only; text and originalText are never truncated. */
export function matterTitle(matter: ProjectMatter) {
  if(matter.displayTitle?.trim())return matter.displayTitle.trim();
  const text=matter.text.replace(/\s+/gu," ").trim();
  return text.length>32?`${text.slice(0,32)}…`:text;
}
