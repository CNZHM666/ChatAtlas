import { expect, it } from "vitest";
import { messageTurn, messageTurns } from "./message-turns";
import type { ConversationMessage } from "./types";
const row=(id:string,role:"user"|"assistant",messageIndex:number,conversationId="one"):ConversationMessage=>({id,role,messageIndex,conversationId,content:id,preview:id,contentHash:id,createdAt:1,updatedAt:1});
it("groups original questions with their answers without crossing later questions or conversations",()=>{
 const rows=[row("q1","user",0),row("a1","assistant",1),row("q2","user",2),row("a2","assistant",3),row("other","assistant",0,"two")];
 expect(messageTurn(rows,rows[1]).map(item=>item.id)).toEqual(["q1","a1"]);
 expect(messageTurn(rows,rows[2]).map(item=>item.id)).toEqual(["q2","a2"]);
 expect(messageTurn(rows,rows[4]).map(item=>item.id)).toEqual(["other"]);
});
it("keeps orphan answers and does not create missing evidence",()=>{
 expect(messageTurns([row("orphan","assistant",0),row("q","user",1)]).map(turn=>turn.map(item=>item.id))).toEqual([["orphan"],["q"]]);
 expect(messageTurn([],row("missing","user",0))).toEqual([]);
});
