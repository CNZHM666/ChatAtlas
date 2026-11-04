import {expect,it} from "vitest";
import {projectSession} from "../test/project-fixture";
import {uniqueEvidenceMessages,chapterEvidence,evidenceVersion,evidenceSnapshotKey,evidenceReadingGroups} from "./evidence-identity";
import type {ConversationMessage} from "./types";

it("deduplicates excerpt IDs while keeping different retained versions separate",()=>{
 const ref=projectSession().evidence[0],first={...ref,sourceVersionId:"v1"};
 const input=[first,{...first,id:"another-quote",sourceSignature:"additional-metadata"},{...ref,id:"old",sourceVersionId:"v0"}];
 expect(uniqueEvidenceMessages(input)).toHaveLength(2);expect(input).toHaveLength(3);
});

it("resolves bare citation aliases against one retained version but never collapses different or ambiguous versions",()=>{
 const session=projectSession(),ref=session.evidence[0];session.sourceVersionIds={source:"current"};
 const bare={...ref,id:"bare"},saved={...ref,id:"saved",sourceVersionId:"v1",sourceSignature:"one"};session.evidence=[bare,saved];
 expect(evidenceVersion(session,bare)).toBe("v1");expect(uniqueEvidenceMessages(session.evidence,session)).toHaveLength(1);
 session.evidence.push({...saved,id:"old",sourceVersionId:"v0",sourceSignature:"zero"});
 expect(evidenceVersion(session,bare)).toBeUndefined();expect(uniqueEvidenceMessages(session.evidence,session)).toHaveLength(3);
 expect(evidenceVersion(session,{...bare,sourceSignature:"one"})).toBe("v1");
 expect(evidenceVersion(session,{...bare,sourceSignature:"unmatched"})).toBeUndefined();
});

it("groups the question and its cited replies once, retaining every proof and different snapshots",()=>{
 const session=projectSession(),ref=session.evidence[0];const question={...ref,sourceVersionId:"v1"},reply={...question,id:"reply-proof",messageId:"reply"};session.evidence=[question,reply];
 const messages=[{id:question.messageId,role:"user",messageIndex:0},{id:"reply",role:"assistant",messageIndex:1}].map(message=>({...message,conversationId:ref.conversationId,content:"原文",preview:"",contentHash:"",createdAt:1,updatedAt:1})) as ConversationMessage[];
 const groups=evidenceReadingGroups(session,[question,reply,{...question,id:"other-quote"}],new Map([[evidenceSnapshotKey(session,question),messages]]));
 expect(groups).toHaveLength(1);expect(groups[0].references).toHaveLength(3);expect(groups[0].turn).toEqual(messages);
 expect(evidenceReadingGroups(session,[question,reply,{...question,id:"older",sourceVersionId:"v0"}],new Map([[evidenceSnapshotKey(session,question),messages]]))).toHaveLength(2);
});
it("includes a chapter's claim-only sources without leaking other chapters",()=>{
 const session=projectSession(),ref=session.evidence[0];session.evidence.push({...ref,id:"claim-only"},{...ref,id:"unrelated"});
 session.sections[0].claims=[{text:"依据",quote:"原句",evidenceIds:["claim-only"]}];
 expect(chapterEvidence(session,session.sections[0]).map(ref=>ref.id)).toEqual(["e1","claim-only"]);
});
