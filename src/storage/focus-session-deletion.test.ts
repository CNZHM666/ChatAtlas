import "fake-indexeddb/auto";
import {expect,it} from "vitest";
import {getDatabase} from "./db";
import {listDeletedFocusSessions,listFocusSessions,setFocusSessionDeleted} from "./focus-sessions";
import {projectSession} from "../test/project-fixture";

it("hides a deleted version everywhere but keeps it, with its notes, for restoring",async()=>{
 const db=await getDatabase(),id=crypto.randomUUID();
 const version={...projectSession(),id,canvasId:`canvas-${id}`,notes:"个人记录"};
 await db.put("focusSessions",version);
 await setFocusSessionDeleted(id,true);
 expect((await listFocusSessions()).some(session=>session.id===id)).toBe(false);
 expect((await listDeletedFocusSessions()).find(session=>session.id===id)).toMatchObject({notes:"个人记录",deletedAt:expect.any(Number)});
 await setFocusSessionDeleted(id,false);
 expect((await listFocusSessions()).find(session=>session.id===id)?.deletedAt).toBeUndefined();
 expect((await listDeletedFocusSessions()).some(session=>session.id===id)).toBe(false);
});
