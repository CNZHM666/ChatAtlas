import type { FocusSession } from "../shared/focus-session";
import type { ConversationMessage } from "../shared/types";
import { groundWikiClaims } from "../shared/wiki-claims";
import {projectKnowledgeIntroduction,projectKnowledgeView} from "../shared/project-knowledge-view";

/** Default generation performs deterministic source checks only. No paid verification or rewriting. */
export function prepareManualWikiReview(session: FocusSession, originals: ConversationMessage[]): FocusSession {
  const prepared:FocusSession={ ...session,...(session.mode==="work"?{knowledgeViewVersion:1 as const}:{}), sections: groundWikiClaims(session.sections, session.evidence, originals,true).map(section =>
    section.origin || section.userEdited ? section : {
      ...section, evidenceReview: { ...section.evidenceReview!, mode: "manual" },
    }) };
  return refreshWikiBrief(prepared);
}

/** Consume the same grounded facts without rereading or re-grounding other chapters. */
export function refreshWikiBrief(prepared:FocusSession):FocusSession {
  if(prepared.mode!=="work"||prepared.briefUserEdited||prepared.projectMaintenance?.overview!==undefined)return prepared;
  const view=projectKnowledgeView(prepared);
  // A partial revision of an older project cannot erase its existing Brief
  // merely because its unchanged pages predate purpose-claim metadata.
  if(!prepared.knowledgeViewVersion&&!view.purpose)return prepared;
  return {...prepared,knowledgeViewVersion:1,brief:{summary:projectKnowledgeIntroduction(prepared),turningPoints:[],confirmed:view.current.filter(fact=>fact.role==="decision"&&fact.adoption==="accepted"&&!fact.contested).slice(0,3).map(fact=>({text:fact.claim.text,evidenceIds:fact.claim.evidenceIds})),openQuestions:view.questions.map(question=>question.text)}};
}
