import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RecordDetailActions, RecordDetailDrawer } from "./RecordDetailDrawer";
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("places desktop details in a separate workspace column, leaves reading interactive, and protects edit drafts",async()=>{
 vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockReturnValue({width:1400,height:900,x:0,y:0,top:0,left:0,right:1400,bottom:900,toJSON:()=>({})});
 const saved=vi.fn();
 function Harness(){const [open,setOpen]=useState(false),[editing,setEditing]=useState(false);return <div className="focus-workspace"><div className="project-reading-base"><button onClick={()=>setOpen(true)}>Open</button>{open?<RecordDetailDrawer title="Record" label="Details" zh={false} locked={editing} onClose={()=>setOpen(false)}>{editing?<form id="test-edit" onSubmit={event=>{event.preventDefault();saved();setEditing(false);}}><input aria-label="Draft" defaultValue="Retained"/><RecordDetailActions><button type="submit" form="test-edit">Save</button><button type="button" onClick={()=>setEditing(false)}>Cancel</button></RecordDetailActions></form>:<RecordDetailActions><button onClick={()=>setEditing(true)}>Edit</button></RecordDetailActions>}</RecordDetailDrawer>:null}</div></div>;}
 const {container}=render(<Harness/>);const trigger=screen.getByRole("button",{name:"Open"});trigger.focus();fireEvent.click(trigger);
 const detail=await screen.findByRole("complementary",{name:"Record"});expect(detail.closest(".workspace-record-slot")?.parentElement).toHaveClass("focus-workspace");expect(container.querySelector(".project-reading-base")).not.toHaveAttribute("inert");
 expect(within(detail.querySelector("footer")!).getByRole("button",{name:"Edit"})).toBeVisible();fireEvent.click(screen.getByRole("button",{name:"Edit"}));expect(container.querySelector(".project-reading-base")).toHaveAttribute("inert");
 fireEvent.keyDown(detail,{key:"Escape"});expect(screen.getByRole("textbox",{name:"Draft"})).toHaveValue("Retained");fireEvent.click(screen.getByRole("button",{name:"Save"}));expect(saved).toHaveBeenCalledOnce();await waitFor(()=>expect(container.querySelector(".project-reading-base")).not.toHaveAttribute("inert"));
 fireEvent.click(screen.getByRole("button",{name:"Close details"}));expect(container.querySelector(".workspace-record-slot")).toBeNull();expect(container.querySelector(".focus-workspace")).not.toHaveClass("has-record-panel");expect(trigger).toHaveFocus();
});
it("uses a modal on a narrow workspace and restores its reading surface on close",async()=>{
 function Harness(){const [open,setOpen]=useState(false);return <div className="focus-workspace"><div className="project-reading-base"><button onClick={()=>setOpen(true)}>Open</button>{open?<RecordDetailDrawer title="Mobile record" label="Details" zh={false} onClose={()=>setOpen(false)}>Text</RecordDetailDrawer>:null}</div></div>;}
 const {container}=render(<Harness/>);fireEvent.click(screen.getByRole("button",{name:"Open"}));const panel=await screen.findByRole("dialog",{name:"Mobile record"});expect(panel).toHaveAttribute("aria-modal","true");expect(container.querySelector(".project-reading-base")).toHaveAttribute("inert");fireEvent.keyDown(panel,{key:"Escape"});expect(container.querySelector(".project-reading-base")).not.toHaveAttribute("inert");
});
