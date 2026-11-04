import "fake-indexeddb/auto";
import {beforeEach,expect,it} from "vitest";
import {getDatabase} from "./db";
import {evidenceReadingIdentity,evidenceWasRead,markEvidenceRead} from "./evidence-reading";
import {listRecentReading,saveReadingProgress} from "./reading-progress";
import {contextKnowledge} from "../test/context-fixture";
beforeEach(async()=>{await (await getDatabase()).clear("readingProgress");});
it("persists reversible personal reading without changing knowledge or recent reading",async()=>{
 const knowledge=contextKnowledge(),before=JSON.stringify(knowledge);
 const identity=evidenceReadingIdentity(knowledge.session.id,"snapshot","message","原句","结论",knowledge.messages);
 expect(await evidenceWasRead(identity)).toBe(false);await markEvidenceRead(identity,true);expect(await evidenceWasRead(identity)).toBe(true);
 await saveReadingProgress({canvasId:"canvas",cardId:"card",scrollTop:120});expect(await listRecentReading()).toHaveLength(1);expect((await listRecentReading())[0].cardId).toBe("card");
 expect(JSON.stringify(knowledge)).toBe(before);await markEvidenceRead(identity,false);expect(await evidenceWasRead(identity)).toBe(false);
});
it("does not transfer a receipt across versions, quotes, roles, claims or projects",async()=>{
 const messages=contextKnowledge().messages,make=(snapshot="v1",quote="原句",claim="结论",turn=messages,project="project")=>evidenceReadingIdentity(project,snapshot,"message",quote,claim,turn);
 await markEvidenceRead(make(),true);
 for(const identity of [make("v2"),make("v1","另句"),make("v1","原句","其他结论"),make("v1","原句","结论",messages.map(message=>({...message,role:"user"}))),make("v1","原句","结论",messages,"other-project"),make("v1","原句","结论",messages.map(message=>({...message,content:message.content+"补充"})))])expect(await evidenceWasRead(identity)).toBe(false);
 expect(await evidenceWasRead(make())).toBe(true);
});
