import type {Conversation,ConversationMessage} from "../shared/types";
import {conversationPlatformGroup,platformFromLabel,platformName} from "../shared/platforms";
import type {HistoryMatch} from "./home-history";

/** Conditions read from the search text itself, shown as removable chips. Nothing
 * here calls a model; an unrecognized phrase simply stays part of the query. */
export interface HistoryFilters {since?:number;until?:number;platforms?:string[];speaker?:"user"}
export interface HistoryFilterChip {key:string;kind:"time"|"platform"|"speaker";label:string;filters:HistoryFilters}

const DAY=86_400_000;
/** Marks where a condition was cut out of the search text. */
const REMOVED="\u0000";
const NUMBERS:Record<string,number>={一:1,两:2,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
const count=(text:string)=>/^\d+$/u.test(text)?Number(text):NUMBERS[text]??0;
const PLATFORM_WORDS="ChatGPT|Claude|Gemini|DeepSeek|Kimi|Grok|Perplexity|Copilot|Mistral|Qwen|豆包|通义千问|通义|千问|腾讯元宝|元宝|智谱";

/** Splits "上周在 Claude 里讨论的检索索引" into the words to search and the
 * conditions. Times are local calendar ranges; "this week" starts on Monday. */
export function parseHistoryFilters(text:string,zh=true,now=Date.now()):{query:string;chips:HistoryFilterChip[]}{
 const chips:HistoryFilterChip[]=[];
 const today=new Date(now);today.setHours(0,0,0,0);
 const day=today.getTime(),monday=day-((today.getDay()+6)%7)*DAY;
 const month=new Date(today.getFullYear(),today.getMonth(),1).getTime(),previousMonth=new Date(today.getFullYear(),today.getMonth()-1,1).getTime();
 const year=new Date(today.getFullYear(),0,1).getTime(),previousYear=new Date(today.getFullYear()-1,0,1).getTime();
 const time=(label:string,since:number,until?:number)=>chips.push({key:"time",kind:"time",label,filters:{since,...(until===undefined?{}:{until})}});
 const rules:Array<[RegExp,(match:RegExpMatchArray)=>void]>=[
  [/(?:最近|近|过去)\s*(\d+|[一两二三四五六七八九十])\s*(天|日|周|个?星期|个?月)|\b(?:past|last)\s+(\d+)\s+(days?|weeks?|months?)\b/iu,match=>{
   const amount=count(match[1]??match[3]),unit=(match[2]??match[4]).toLowerCase();
   if(!amount)return;
   const since=/月|month/u.test(unit)?new Date(today.getFullYear(),today.getMonth()-amount,today.getDate()).getTime():day-(/周|星期|week/u.test(unit)?amount*7:amount-1)*DAY;
   time(zh?`最近 ${amount} ${/月|month/u.test(unit)?"个月":/周|星期|week/u.test(unit)?"周":"天"}`:`Last ${amount} ${/月|month/u.test(unit)?"months":/周|星期|week/u.test(unit)?"weeks":"days"}`,since);
  }],
  [/今天|\btoday\b/iu,()=>time(zh?"今天":"Today",day)],
  [/昨天|\byesterday\b/iu,()=>time(zh?"昨天":"Yesterday",day-DAY,day)],
  [/上(?:个)?(?:周|星期)|\blast week\b/iu,()=>time(zh?"上周":"Last week",monday-7*DAY,monday)],
  [/(?:本|这)(?:个)?(?:周|星期)|\bthis week\b/iu,()=>time(zh?"本周":"This week",monday)],
  [/上(?:个)?月|\blast month\b/iu,()=>time(zh?"上个月":"Last month",previousMonth,month)],
  [/(?:本|这)(?:个)?月|\bthis month\b/iu,()=>time(zh?"本月":"This month",month)],
  [/去年|\blast year\b/iu,()=>time(zh?"去年":"Last year",previousYear,year)],
  [/今年|\bthis year\b/iu,()=>time(zh?"今年":"This year",year)],
 ];
 let query=text;
 // One time condition: the first phrase found wins, later ones stay searchable words.
 for(const [pattern,apply] of rules){const match=query.match(pattern);if(!match)continue;const before=chips.length;apply(match);if(chips.length>before){query=query.replace(match[0],REMOVED);break;}}
 const platform=query.match(new RegExp(`(?:在|用|从)\\s*(${PLATFORM_WORDS})\\s*(?:里|上|中|那边)?(?:的)?|\\b(?:on|in|from)\\s+(${PLATFORM_WORDS})\\b`,"iu"));
 const id=platform?platformFromLabel(platform[1]??platform[2]):undefined;
 if(platform&&id){chips.push({key:"platform",kind:"platform",label:platformName(id,zh?"zh-CN":"en"),filters:{platforms:[id]}});query=query.replace(platform[0],REMOVED);}
 const speaker=query.match(/我(?:自己)?(?:问过|说过|提过|提到过|写过)|\bI (?:asked|said|mentioned|wrote)\b/iu);
 if(speaker){chips.push({key:"speaker",kind:"speaker",label:zh?"只看我说的":"Only my messages",filters:{speaker:"user"}});query=query.replace(speaker[0],REMOVED);}
 // "我问过的检索索引": the particle right after a removed condition is not a search word.
 return {query:query.replace(new RegExp(`${REMOVED}\\s*的`,"gu")," ").replaceAll(REMOVED," ").replace(/\s+/gu," ").trim(),chips};
}

export function mergeHistoryFilters(chips:HistoryFilterChip[]):HistoryFilters{
 return chips.reduce<HistoryFilters>((all,chip)=>({...all,...chip.filters}),{});
}

export function historyPlatformMatches(conversation:Pick<Conversation,"platform">,filters:HistoryFilters):boolean{
 return !filters.platforms?.length||filters.platforms.includes(conversationPlatformGroup(conversation.platform));
}

/** One question and the replies to it: the place a reader returns to. */
export interface HistoryFragment {id:string;question?:string;targetMessageId:string;hitCount:number;excerpt:string;
 /** The discussion's own date; never a sync or import time. */
 date?:number;firstIndex:number}

const firstLine=(text:string,limit=90)=>{const line=text.replace(/\s+/gu," ").trim();return line.length>limit?`${line.slice(0,limit)}…`:line;};

/** Hits of one conversation grouped under the user question they belong to. A hit in
 * an answer joins the question it replies to (or the nearest earlier question). Time
 * conditions use only original discussion dates; fragments without one are counted
 * as undated instead of being dated by sync time. */
export function historyFragments(match:HistoryMatch,originals:ConversationMessage[],filters:HistoryFilters={},includeUndated=false):{fragments:HistoryFragment[];undated:number}{
 const byId=new Map(originals.map(message=>[message.id,message]));
 const users=originals.filter(message=>message.role==="user").sort((a,b)=>a.messageIndex-b.messageIndex);
 const hits=match.hits?.length?match.hits:match.messages.map(message=>({messageId:message.id,excerpt:""}));
 const groups=new Map<string,{anchor?:ConversationMessage;hits:Array<{message:ConversationMessage;excerpt:string}>}>();
 for(const hit of hits){
  // The text that matched is shown; opening it still checks the current original.
  const message=match.messages.find(item=>item.id===hit.messageId)??byId.get(hit.messageId);
  if(!message||filters.speaker==="user"&&message.role!=="user")continue;
  const anchor=message.role==="user"?message:(message.replyToMessageId?byId.get(message.replyToMessageId):undefined)??[...users].reverse().find(user=>user.messageIndex<message.messageIndex);
  const key=anchor?.id??message.id,group=groups.get(key)??{anchor,hits:[]};
  if(!group.hits.some(item=>item.message.id===message.id))group.hits.push({message,excerpt:hit.excerpt||""});
  groups.set(key,group);
 }
 let undated=0;
 const fragments=[...groups.entries()].flatMap(([id,{anchor,hits}])=>{
  hits.sort((a,b)=>a.message.messageIndex-b.message.messageIndex);
  const date=anchor?.sourceCreatedAt??hits.find(hit=>hit.message.sourceCreatedAt)?.message.sourceCreatedAt;
  if(filters.since!==undefined||filters.until!==undefined){
   if(date===undefined){undated++;if(!includeUndated)return [];}
   else if(filters.since!==undefined&&date<filters.since||filters.until!==undefined&&date>=filters.until)return [];
  }
  const best=hits.find(hit=>hit.excerpt)??hits[0];
  const text=best.excerpt||(best.message.id===match.messages[0]?.id?match.excerpt:"")||best.message.content;
  return [{id,...(anchor?{question:firstLine(anchor.content)}:{}),targetMessageId:hits[0].message.id,hitCount:hits.length,excerpt:firstLine(text,160),...(date===undefined?{}:{date}),firstIndex:hits[0].message.messageIndex}];
 });
 // The fragment with the most hits leads; ties keep the discussion's order.
 fragments.sort((a,b)=>b.hitCount-a.hitCount||a.firstIndex-b.firstIndex);
 return {fragments,undated};
}
