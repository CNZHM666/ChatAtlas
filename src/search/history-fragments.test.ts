import {expect,it} from "vitest";
import {historyFragments,historyPlatformMatches,mergeHistoryFilters,parseHistoryFilters} from "./history-fragments";
import type {Conversation,ConversationMessage} from "../shared/types";
import type {HistoryMatch} from "./home-history";

// Monday 2026-10-26 10:00 local time.
const now=new Date(2026,9,26,10).getTime();
const at=(month:number,date:number)=>new Date(2026,month,date,12).getTime();

it("reads time, platform and speaker conditions out of the search words",()=>{
 const parsed=parseHistoryFilters("上周在 Claude 里我问过的检索索引",true,now);
 expect(parsed.query).toBe("检索索引");
 expect(parsed.chips.map(chip=>[chip.kind,chip.label])).toEqual([["time","上周"],["platform","Claude"],["speaker","只看我说的"]]);
 expect(mergeHistoryFilters(parsed.chips)).toEqual({since:new Date(2026,9,19).getTime(),until:new Date(2026,9,26).getTime(),platforms:["claude"],speaker:"user"});
 expect(parseHistoryFilters("上周 的 Orama 讨论",true,now).query).toBe("Orama 讨论");
 expect(parseHistoryFilters("最近 3 天 Orama",true,now).chips[0]).toMatchObject({label:"最近 3 天",filters:{since:new Date(2026,9,24).getTime()}});
 expect(parseHistoryFilters("上个月 豆包",true,now).chips.map(chip=>chip.label)).toEqual(["上个月"]);
 expect(parseHistoryFilters("in Kimi last month index",false,now)).toMatchObject({query:"index",chips:[{label:"Last month"},{label:"Kimi"}]});
 // A bare product name is a search word, not a platform condition.
 expect(parseHistoryFilters("Claude 的上下文窗口",true,now)).toEqual({query:"Claude 的上下文窗口",chips:[]});
 expect(historyPlatformMatches({platform:"tongyi"},{platforms:["qwen"]})).toBe(true);
 expect(historyPlatformMatches({platform:"chatgpt"},{platforms:["qwen"]})).toBe(false);
});

const message=(id:string,messageIndex:number,role:"user"|"assistant",content:string,extra:Partial<ConversationMessage>={}):ConversationMessage=>({id,conversationId:"c",messageIndex,role,content,preview:"",contentHash:"",createdAt:now,updatedAt:now,...extra});
const originals=[
 message("u1",0,"user","索引应该怎么更新？",{sourceCreatedAt:at(9,20)}),message("a1",1,"assistant","增量更新索引，只重建变化的对话。"),message("a1b",2,"assistant","索引失效时再全量重建。"),
 message("u2",3,"user","导出格式选什么？",{sourceCreatedAt:at(8,3)}),message("a2",4,"assistant","Markdown 导出也要保留索引引用。",{replyToMessageId:"u2"}),
 message("u3",5,"user","索引放在哪里？"),
];
const match=(ids:string[]):HistoryMatch=>({conversation:{id:"c",title:"检索",platform:"claude",url:"",updatedAt:now,messageCount:6} as Conversation,messages:ids.map(id=>originals.find(item=>item.id===id)!),excerpt:"",score:1,hits:ids.map(messageId=>({messageId,excerpt:`…${messageId} 索引…`}))});

it("groups hits under the question they answer and orders fragments by hit count",()=>{
 const {fragments}=historyFragments(match(["a2","a1","a1b","u3"]),originals);
 expect(fragments.map(fragment=>[fragment.id,fragment.hitCount,fragment.targetMessageId,fragment.question])).toEqual([
  ["u1",2,"a1","索引应该怎么更新？"],["u2",1,"a2","导出格式选什么？"],["u3",1,"u3","索引放在哪里？"],
 ]);
 expect(fragments[0]).toMatchObject({date:at(9,20),excerpt:"…a1 索引…"});
 expect(historyFragments(match(["a1","u3"]),originals,{speaker:"user"}).fragments.map(fragment=>fragment.id)).toEqual(["u3"]);
});

it("filters by the discussion's own date and counts undated fragments instead of guessing",()=>{
 const filters={since:at(9,1),until:at(9,31)};
 const result=historyFragments(match(["a1","a2","u3"]),originals,filters);
 // u2 is from September; u3 has no original date.
 expect(result).toMatchObject({fragments:[{id:"u1"}],undated:1});
 expect(historyFragments(match(["a1","a2","u3"]),originals,filters,true).fragments.map(fragment=>fragment.id)).toEqual(["u1","u3"]);
});
