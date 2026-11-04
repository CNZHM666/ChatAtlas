import { afterEach, expect, it, vi } from "vitest";
import { observeMessageSearchEvents } from "./message-search-events";
import type { MessageFullTextSearch } from "./message-fulltext";
import type { AtlasMessage } from "../shared/messages";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it("observes existing commit events, coalesces updates and cleans up",async()=>{
  vi.useFakeTimers(); let listener!:(event:AtlasMessage)=>void; const remove=vi.fn();
  vi.stubGlobal("chrome",{runtime:{onMessage:{addListener:(fn:typeof listener)=>{listener=fn;},removeListener:remove}}});
  const invalidate=vi.fn(), prepare=vi.fn(async()=>undefined), stop=observeMessageSearchEvents({invalidate,prepare} as unknown as MessageFullTextSearch);
  listener({type:"ATLAS_CAPTURE_SAVED",summary:{conversationId:"saved",title:"Saved",messageCount:1,savedAt:1}}); expect(invalidate).toHaveBeenCalledWith("saved");
  const event={type:"ATLAS_IMPORT_PROGRESS",job:{sessionId:"session",persistedIds:["one"],pendingIds:[]}} as unknown as AtlasMessage;
  listener(event); listener(event); expect(invalidate.mock.calls.filter(([id])=>id==="one")).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(500); expect(prepare).toHaveBeenCalledOnce(); stop(); expect(remove).toHaveBeenCalledWith(listener);
});
