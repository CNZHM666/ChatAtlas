import {expect,it} from "vitest";
import {nativePanelPath,nativePanelTabId} from "./sidecar-scope";
it("parses only explicit safe tab IDs",()=>{
 expect(nativePanelTabId("42")).toBe(42);expect(nativePanelTabId("0")).toBe(0);
 for(const value of [null,"","-1","1.5","Infinity","1e2","9007199254740992"," 42"]){expect(nativePanelTabId(value)).toBeUndefined();}
 expect(nativePanelPath()).toBe("sidecar.html?native=1");
 expect(nativePanelPath(42)).toBe("sidecar.html?native=1&tabId=42");
});
