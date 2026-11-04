import { afterEach, expect, it, vi } from "vitest";
import { PageCapture } from "./page-capture";
import type { ConversationCapture } from "../shared/types";
const batch:ConversationCapture={conversation:{id:"source",platform:"chatgpt",title:"Source",url:"",messageCount:1,updatedAt:1},messages:[{id:"message",conversationId:"source",role:"user",messageIndex:0,content:"Question",contentHash:"hash",preview:"",createdAt:1,updatedAt:1}],capturedAt:1};
afterEach(()=>vi.useRealTimers());
it("gives an explicit save its own receipt when it overlaps an unchanged automatic read",async()=>{
 const receipt={ok:true,summary:{conversationId:"source",messageCount:1,capturedAt:1}};
 let finish!:(value:ConversationCapture)=>void;
 const read=vi.fn().mockResolvedValue(batch),save=vi.fn().mockResolvedValue(receipt),capture=new PageCapture(read,save);
 await capture.capture();read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const automatic=capture.capture(),explicit=capture.capture(true);finish(batch);
 expect(await automatic).toEqual({ok:true});expect(await explicit).toEqual(receipt);expect(save).toHaveBeenCalledTimes(2);capture.pause();
});
it("coalesces page mutations and skips unchanged snapshots",async()=>{
 vi.useFakeTimers();const read=vi.fn().mockResolvedValue(batch),save=vi.fn().mockResolvedValue({ok:true}),capture=new PageCapture(read,save);
 for(let index=0;index<20;index++)capture.schedule();await vi.advanceTimersByTimeAsync(650);expect(read).toHaveBeenCalledOnce();expect(save).toHaveBeenCalledOnce();
 await capture.capture();expect(save).toHaveBeenCalledOnce();await capture.capture(true);expect(save).toHaveBeenCalledTimes(2);capture.pause();
});
it("retries a failed write instead of caching its fingerprint",async()=>{
 const save=vi.fn().mockResolvedValueOnce({ok:false}).mockResolvedValue({ok:true}),capture=new PageCapture(async()=>batch,save);
 await capture.capture();await capture.capture();expect(save).toHaveBeenCalledTimes(2);capture.pause();
});
it("discards a capture still being read after pause or disable",async()=>{
 let finish!:(value:ConversationCapture)=>void;const save=vi.fn(),capture=new PageCapture(()=>new Promise(resolve=>{finish=resolve;}),save);
 const running=capture.capture();capture.pause();finish(batch);await expect(running).resolves.toMatchObject({ok:false});expect(save).not.toHaveBeenCalled();
});
it("serializes concurrent requests and rereads after the in-flight capture finishes",async()=>{
 vi.useFakeTimers();let finish!:(value:ConversationCapture)=>void;const read=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(batch),save=vi.fn().mockResolvedValue({ok:true}),capture=new PageCapture(read,save);
 const first=capture.capture(),second=capture.capture();expect(read).toHaveBeenCalledOnce();finish(batch);await Promise.all([first,second]);await vi.advanceTimersByTimeAsync(120);expect(read).toHaveBeenCalledTimes(2);expect(save).toHaveBeenCalledOnce();capture.pause();
});
