import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { getDatabase } from "./db";
import { currentHomeDiscoveries, historyDiscoveryRevisions, readHomeDiscoveries, saveHomeDiscoveries } from "./home-discovery";
import type { Conversation, ConversationMessage } from "../shared/types";
import { sourceMessageSignature } from "../shared/source-signature";
import type { HistoryCandidate } from "../search/home-history";
const sources:Conversation[]=["a","b"].map(id=>({id,title:id,platform:"chatgpt",url:"",messageCount:2,updatedAt:1,importState:"complete",hydrationState:"hydrated"}));
const message=(id:string,index=0):ConversationMessage=>({id:`${id}:${index}`,conversationId:id,role:"user",messageIndex:index,content:index?"另一段讨论":"讨论索引持久化项目",contentHash:"",preview:"",createdAt:1,updatedAt:1});
const make=async():Promise<HistoryCandidate>=>({title:"索引项目",kind:"project",sourceIds:["a","b"],basis:"recommendation",sourceRevisions:await historyDiscoveryRevisions(["a","b"]),evidence:sources.map(source=>({id:source.id,conversationId:source.id,messageId:`${source.id}:0`,title:source.title,excerpt:"索引持久化项目",sourceSignature:sourceMessageSignature(message(source.id).content)}))});
beforeEach(async()=>{const db=await getDatabase();await Promise.all([db.clear("conversations"),db.clear("messages"),db.clear("semanticDecisionCache")]);for(const source of sources){await db.put("conversations",source);await db.put("messages",message(source.id));await db.put("messages",message(source.id,1));}});
it("restores verified recommendations without generating new analysis and invalidates unseen message changes",async()=>{
 const candidate=await make();await saveHomeDiscoveries(sources,[candidate],true);expect(await readHomeDiscoveries(sources,true)).toEqual([candidate]);const db=await getDatabase();await db.put("messages",{...message("a",1),role:"assistant"});expect(await readHomeDiscoveries(sources,true)).toEqual([]);
});
it("rejects stale results before caching instead of stamping them with fresh revisions",async()=>{
 const candidate=await make(),db=await getDatabase();await db.put("messages",{...message("a",1),content:"新讨论"});await saveHomeDiscoveries(sources,[candidate],true);expect(await db.getAll("semanticDecisionCache")).toEqual([]);expect(await currentHomeDiscoveries(sources,[candidate])).toEqual([]);
});
it("rejects missing original messages, fabricated passages and metadata-only groups",async()=>{
 const candidate=await make();expect(await currentHomeDiscoveries(sources,[{...candidate,evidence:candidate.evidence?.map(ref=>({...ref,excerpt:"不存在的原句"}))}])).toEqual([]);expect(await currentHomeDiscoveries(sources,[{...candidate,evidence:undefined}])).toEqual([]);await (await getDatabase()).delete("messages","b:0");expect(await currentHomeDiscoveries(sources,[candidate])).toEqual([]);
});
it("keeps recommendations scoped to the user's goal without reusing a different task cache",async()=>{
 const candidate=await make();await saveHomeDiscoveries(sources,[candidate],true,"继续索引项目");
 expect(await readHomeDiscoveries(sources,true,"继续索引项目")).toEqual([candidate]);expect(await readHomeDiscoveries(sources,true,"学习数学")).toEqual([]);expect(await readHomeDiscoveries(sources,true)).toEqual([]);
});
