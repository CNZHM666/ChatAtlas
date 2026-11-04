import type {FocusSession} from "./focus-session";
import type {ProjectMatter} from "./project-matters";
import {pendingMatterCue,currentMatterSettlement} from "./project-matter-assessment";

/** Queue eligibility is distinct from absence of personal approval. Omitted
 * background remains accessible as saved records, never deleted or resolved. */
export function matterNeedsAttention(session:FocusSession,matter:ProjectMatter):boolean {
 if(matter.personal||matter.status!=="open"||session.projectMaintenance?.nextMatter?.id===matter.id)return true;
 const kind=matter.type==="question"?"questions":matter.type==="decision"?"decisions":"constraints";
 if(session.projectMaintenance?.[kind]?.[matter.id]?.matterStatus==="open")return true;
 const record=session.projectState?.[kind]?.find(row=>row.id===matter.id||matter.type==="question"&&row.text===matter.originalText);
 if(record?.matter)return record.matter.state==="open"||Boolean(record.matter.settlement&&!currentMatterSettlement(session,record)&&pendingMatterCue(record.quote));
 // Legacy questions without original provenance remain visible, but ordinary
 // declarations and assistant suggestions are not a backlog of unmade choices.
 if(matter.type==="question")return !/^(?:待解决问题|待确认事项|未解决问题|开放问题|open questions?|unresolved issues?)[：:。.!]?$/iu.test(matter.text.trim())&&pendingMatterCue(matter.text);
 return Boolean(record&&record.status!=="superseded"&&pendingMatterCue(record.quote)&&pendingMatterCue(record.text));
}
