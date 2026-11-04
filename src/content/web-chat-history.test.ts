import {afterEach,expect,it} from "vitest";
import {readWebChatHistory} from "./web-chat-history";
afterEach(()=>{document.body.innerHTML="";});
it("keeps only same-site native history links and never claims full inventory",()=>{
 document.body.innerHTML='<nav><a href="/chat/a">First chat</a><a href="/chat/a">Repeated</a><a href="/chat/b">Second chat</a><a href="/chat/new">New</a><a href="https://claude.ai.example/chat/bad">Evil</a><a href="https://gemini.google.com/app/bad">Other platform</a><a hidden href="/chat/hidden">Hidden</a></nav><main><a href="/chat/citation">Cited chat</a></main>';
 expect(readWebChatHistory("https://claude.ai/chat/a")).toEqual({scope:"loaded",entries:[{conversationId:"claude:a",url:"https://claude.ai/chat/a",title:"First chat"},{conversationId:"claude:b",url:"https://claude.ai/chat/b",title:"Second chat"}]});
});
it("keeps Kimi history-loading URL and bounds long rendered inventories",()=>{
 document.body.innerHTML='<nav>'+Array.from({length:250},(_,i)=>`<a href="/chat/c${i}">Chat ${i}</a>`).join("")+'</nav>';
 const page=readWebChatHistory("https://kimi.com/");expect(page.entries).toHaveLength(200);expect(page.entries[0]).toMatchObject({url:"https://kimi.com/chat/c0?chat_enter_method=history"});
 expect(readWebChatHistory("https://example.com/")).toEqual({scope:"loaded",entries:[]});
});
