import { expect, it } from "vitest";
import { WEB_CAPTURE_PLATFORMS, webCapturePatterns, webConversation } from "./web-capture";

it("registers six opt-in platforms and bounds aliases to their exact origins",()=>{
  expect(WEB_CAPTURE_PLATFORMS.map(site=>site.id)).toEqual(["claude","gemini","deepseek","doubao","kimi","qwen"]);
  expect(webCapturePatterns("kimi")).toEqual(["https://www.kimi.com/*","https://kimi.com/*","https://kimi.moonshot.cn/*"]);
  for(const url of ["https://kimi.com.evil/chat/a","http://kimi.com/chat/a","https://www.doubao.com/chat/new-thread/create-by-msg","https://www.doubao.com/chat/new","https://www.qianwen.com/chat/abc","https://claude.ai/share/a","https://chat.qwen.ai/c/new"])
    expect(webConversation(url)).toBeUndefined();
});
it("keeps Kimi IDs across domain migration but separates Qwen regional accounts",()=>{
  for(const host of ["kimi.com","www.kimi.com","kimi.moonshot.cn"])expect(webConversation(`https://${host}/chat/abc?tracking=x`)).toMatchObject({id:"kimi:abc",url:`https://${host}/chat/abc?chat_enter_method=history`});
  const id="abcdef0123456789abcdef0123456789";
  expect(webConversation(`https://www.qianwen.com/chat/${id}`)?.id).toBe(`qwen:cn:${id}`);
  expect(webConversation(`https://chat.qwen.ai/c/${id}`)?.id).toBe(`qwen:${id}`);
});
