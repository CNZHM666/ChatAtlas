import {getDatabase} from "./db";
import {sourceMessageSignature} from "../shared/source-signature";
import type {ConversationMessage} from "../shared/types";

/** Separate personal reading state from project facts, using existing reading metadata. */
export function evidenceReadingIdentity(projectId:string,snapshot:string,messageId:string,quote:string,claim:string|undefined,turn:ConversationMessage[]) {
 const signature=sourceMessageSignature(JSON.stringify([snapshot,messageId,quote,claim??"",turn.map(message=>[message.id,message.role,message.messageIndex,message.content,message.uiParts])]));
 return {id:JSON.stringify(["source-review",projectId,snapshot,messageId,quote,claim??""]),projectId,messageId,signature};
}
export async function evidenceWasRead(identity:ReturnType<typeof evidenceReadingIdentity>):Promise<boolean> {
 return (await (await getDatabase()).get("readingProgress",identity.id))?.sourceReview?.signature===identity.signature;
}
export async function markEvidenceRead(identity:ReturnType<typeof evidenceReadingIdentity>,reviewed:boolean):Promise<void> {
 const db=await getDatabase();
 if(!reviewed){await db.delete("readingProgress",identity.id);return;}
 const now=Date.now();
 await db.put("readingProgress",{id:identity.id,canvasId:identity.projectId,cardId:identity.messageId,messageId:identity.messageId,scrollTop:0,updatedAt:now,sourceReview:{signature:identity.signature,reviewedAt:now}});
}

/** Atomic personal reading marks only; no project or evidence records are edited. */
export async function markEvidenceReadBatch(identities:Array<ReturnType<typeof evidenceReadingIdentity>>):Promise<void>{
 const db=await getDatabase(),tx=db.transaction("readingProgress","readwrite"),now=Date.now();
 for(const identity of identities)await tx.store.put({id:identity.id,canvasId:identity.projectId,cardId:identity.messageId,messageId:identity.messageId,scrollTop:0,updatedAt:now,sourceReview:{signature:identity.signature,reviewedAt:now}});
 await tx.done;
}
