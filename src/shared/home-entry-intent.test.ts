import { expect, it } from "vitest";
import { homeEntryIntent } from "./home-entry-intent";
it("routes literal requests to existing capabilities and leaves ambiguous prose for user choice",()=>{
 expect(homeEntryIntent("我之前关于 Orama 的讨论在哪里？")).toBe("find");expect(homeEntryIntent("请帮我创建硬件项目")).toBe("project");expect(homeEntryIntent("继续上次的项目")).toBe("continue");expect(homeEntryIntent("总结已选对话")).toBe("summarize");expect(homeEntryIntent("复习 SQL")).toBe("review");expect(homeEntryIntent("这是一个包含很多复杂内容的想法，需要考虑用户体验、存储和同步问题，请看看有哪些值得注意的方向。")).toBe("choose");
});
