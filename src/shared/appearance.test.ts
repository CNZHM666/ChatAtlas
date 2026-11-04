// @vitest-environment jsdom
import {afterEach,expect,it} from "vitest";
import {preferredTheme} from "./appearance";
afterEach(()=>localStorage.removeItem("atlas-theme"));
it("defaults to light and preserves an explicit dark preference",()=>{
 localStorage.removeItem("atlas-theme");expect(preferredTheme()).toBe("light");
 localStorage.setItem("atlas-theme","dark");expect(preferredTheme()).toBe("dark");
 localStorage.setItem("atlas-theme","invalid");expect(preferredTheme()).toBe("light");
});
