import { afterEach, expect, it } from "vitest";
import { WebChatAdapter } from "./web-chat-adapter";
import { buildConversationCapture } from "./capture-builder";
import {fillProjectComposer} from "./project-handoff";
import {webConversation,type WebCapturePlatform} from "../shared/web-capture";
import {createContentHash,previewMessage} from "./message-identity";
afterEach(()=>{document.body.innerHTML="";document.title="";});
it.each<[{platform:WebCapturePlatform;url:string;editor:string}]>([
 [{platform:"claude",url:"https://claude.ai/chat/a",editor:'<div class="ProseMirror" contenteditable="true"></div>'}],
 [{platform:"gemini",url:"https://gemini.google.com/app/a",editor:'<rich-textarea><div contenteditable="true"></div></rich-textarea>'}],
 [{platform:"deepseek",url:"https://chat.deepseek.com/a/chat/s/a",editor:'<textarea></textarea>'}],
 [{platform:"doubao",url:"https://www.doubao.com/chat/123",editor:'<textarea data-testid="chat_input_input"></textarea>'}],
 [{platform:"kimi",url:"https://kimi.com/chat/a",editor:'<div contenteditable="true" role="textbox"></div>'}],
 [{platform:"qwen",url:"https://chat.qwen.ai/c/a",editor:'<textarea id="chat-input"></textarea>'}],
])("inserts into $platform only on the bound conversation and preserves drafts",async({platform,url,editor})=>{
 document.body.innerHTML='<main><form>'+editor+'<button>Send</button></form></main>';
 const adapter=new WebChatAdapter(platform,()=>url),id=webConversation(url)!.id;
 expect(await fillProjectComposer("Context",id,url,()=>adapter.composer())).toEqual({ok:true});
 expect(await fillProjectComposer("Overwrite",id,url,()=>adapter.composer())).toEqual({ok:false,reason:"draft"});
 expect(await fillProjectComposer("Context",id+"wrong",url,()=>adapter.composer())).toEqual({ok:false,reason:"changed"});
});
it("locates native IDs and exact content but refuses ambiguous questions or changed previews",async()=>{
 document.body.innerHTML='<main><div class="font-user-message" data-message-id="u">Same question</div><div class="font-claude-response">Answer</div><div class="font-user-message">Same question</div></main>';
 const adapter=new WebChatAdapter("claude",()=>"https://claude.ai/chat/a"),identity={contentHash:await createContentHash("user\nSame question"),preview:"Same question"};
 expect(await adapter.locateMessage(identity)).toBeNull();expect(await adapter.locateMessage({...identity,messageId:"u"})).toBe(document.querySelector('[data-message-id="u"]'));
 document.querySelectorAll('.font-user-message')[1].remove();expect(await adapter.locateMessage(identity)).not.toBeNull();
 const changed="x".repeat(300)+" changed",old="x".repeat(300)+" original";document.querySelector('.font-user-message')!.textContent=changed;
 expect(await adapter.locateMessage({contentHash:await createContentHash("user\n"+old),preview:previewMessage(old)})).toBeNull();
});
it("captures Claude roles once, retains code and excludes drafts, thinking and controls",async()=>{
 document.title="Architecture — Claude";
 document.body.innerHTML='<nav><div class="font-user-message">Navigation</div></nav><main><form><div contenteditable="true" class="font-user-message">Unsent draft</div></form><div data-message-id="u"><div data-testid="user-message" class="font-user-message"><p>My question</p></div></div><div data-message-id="a"><div class="font-claude-response"><div data-is-streaming="false"><div data-testid="thinking">Private process</div><p>The answer</p><pre><code class="language-ts">  const value = 1;\n    run(value);</code></pre><button>Copy</button></div></div></div></main>';
 const adapter=new WebChatAdapter("claude",()=>"https://claude.ai/chat/abc-123?ignored=yes"),capture=await buildConversationCapture(adapter,1000);
 expect(capture?.conversation).toMatchObject({id:"claude:abc-123",platform:"claude",source:"claude_dom",title:"Architecture",url:"https://claude.ai/chat/abc-123"});
 expect(capture?.messages).toHaveLength(2);expect(capture?.messages[0].id).toBe("claude:abc-123:u");expect(capture?.messages[1].replyToMessageId).toBe(capture?.messages[0].id);
 expect(capture?.messages[1].content).toContain("```ts\n  const value = 1;\n    run(value);\n```");expect(JSON.stringify(capture)).not.toMatch(/Unsent draft|Private process|Navigation|Copy/);
});
it("keeps a growing answer identity stable when the platform omits message IDs",async()=>{
 document.body.innerHTML='<main><div class="font-user-message">Question?</div><div class="font-claude-response">First answer</div></main>';
 const adapter=new WebChatAdapter("claude",()=>"https://claude.ai/chat/without-ids"),first=await buildConversationCapture(adapter);
 document.querySelector('.font-claude-response')!.textContent="First answer with more detail";
 const next=await buildConversationCapture(adapter);expect(next?.messages[1].id).toBe(first?.messages[1].id);expect(next?.messages[1].contentHash).not.toBe(first?.messages[1].contentHash);
});
it("captures Gemini custom elements, tables and only the visible response branch",async()=>{
 document.body.innerHTML='<main><user-query data-turn-id="q"><div class="query-text">Compare options</div></user-query><model-response data-response-id="answer"><message-content><table><tr><th>Mode</th><th>State</th></tr><tr><td>Local</td><td>Saved</td></tr></table><button>Edit</button></message-content></model-response><model-response hidden>Abandoned branch</model-response></main>';
 const adapter=new WebChatAdapter("gemini",()=>"https://gemini.google.com/app/native-thread");expect(adapter.parseMessages().map(message=>message.role)).toEqual(["user","assistant"]);expect(adapter.parseMessages()[1].text).toContain("| Mode | State |\n| --- | --- |\n| Local | Saved |");
});
it("reads DeepSeek messages without its reasoning block and coalesces a native answer's fragments",async()=>{
 document.body.innerHTML='<main><div data-message-id="u" data-message-author-role="user">Question</div><div data-message-id="a"><div class="ds-think-content"><div class="ds-markdown">Reasoning</div></div><div class="ds-markdown">First paragraph</div><div class="ds-markdown">Second paragraph</div></div></main>';
 const adapter=new WebChatAdapter("deepseek",()=>"https://chat.deepseek.com/a/chat/s/thread-id"),messages=adapter.parseMessages();expect(messages).toHaveLength(2);expect(messages[1]).toMatchObject({stableId:"a",role:"assistant",text:"First paragraph\n\nSecond paragraph"});
});
it("waits for known streaming controls and ignores home/login/shared pages and lookalike hosts",async()=>{
 document.body.innerHTML='<main><div data-is-streaming="true">Still writing</div></main>';
 const adapter=new WebChatAdapter("claude",()=>"https://claude.ai/chat/id");expect(adapter.isStreaming()).toBe(true);document.querySelector('[data-is-streaming]')!.setAttribute("data-is-streaming","false");expect(adapter.isStreaming()).toBe(false);
 for(const url of ["https://claude.ai/login","https://claude.ai/new","https://claude.ai/share/id","https://claude.ai.example/chat/id","https://gemini.google.com/app/id"])expect(new WebChatAdapter("claude",()=>url).parseMessages()).toEqual([]);
});
it("reads Doubao old and new bubbles without promoting user Markdown to an answer",async()=>{
 document.title="架构 - 豆包";
 document.body.innerHTML='<div data-testid="flow_chat_sidebar"><div class="flow-markdown-body">Sidebar noise</div></div><main><div data-message-id="u" class="bg-g-send-msg-bubble"><div class="flow-markdown-body">Question</div></div><div data-message-id="a"><div class="flow-markdown-body"><p>Answer</p><button>Copy</button></div></div><div data-testid="send_message">Next question</div><div data-testid="receive_message"><div data-testid="message_text_content">Next answer</div></div></main>';
 const adapter=new WebChatAdapter("doubao",()=>"https://www.doubao.com/chat/123456");
 expect(adapter.detectConversation()?.title).toBe("架构");
 expect(adapter.parseMessages().map(({role,text})=>({role,text}))).toEqual([{role:"user",text:"Question"},{role:"assistant",text:"Answer"},{role:"user",text:"Next question"},{role:"assistant",text:"Next answer"}]);
});
it("coalesces Kimi wrappers, excludes tool calls and recognizes the stop control",async()=>{
 document.body.innerHTML='<main><div class="chat-content-list"><div class="chat-content-item-user" data-message-id="u"><div class="segment-user">Question</div></div><div class="chat-content-item-assistant" data-message-id="a"><div class="segment-assistant"><div class="toolcall-container">Tool output</div><p>Answer</p></div></div></div><div class="send-button-container stop"><svg name="Stop"></svg></div></main>';
 const adapter=new WebChatAdapter("kimi",()=>"https://www.kimi.com/chat/thread");
 expect(adapter.inspect()).toMatchObject({state:"streaming",messageCount:2});
 document.querySelector('.send-button-container')!.remove();
 expect(adapter.inspect()).toMatchObject({state:"ready",messageCount:2});
 const first=await buildConversationCapture(adapter),next=await buildConversationCapture(adapter);
 expect(first?.messages.map(m=>m.content)).toEqual(["Question","Answer"]);
 expect(next?.messages.map(m=>m.id)).toEqual(first?.messages.map(m=>m.id));
});
it("reads Qianwen question/answer wrappers without treating citation IDs as messages",async()=>{
 document.body.innerHTML='<main><div data-chat-question-wrap>Compare</div><div data-chat-answers-wrap><div id="qk-markdown-react"><p>Answer</p><span data-message-id="citation">Source</span></div><button>Like</button></div><div data-chat-answers-wrap hidden>Hidden alternate</div></main>';
 const adapter=new WebChatAdapter("qwen",()=>"https://www.qianwen.com/chat/abcdef0123456789abcdef0123456789");
 expect(adapter.parseMessages().map(m=>m.role)).toEqual(["user","assistant"]);
 expect(adapter.parseMessages()[1]).toMatchObject({stableId:undefined,text:"Answer\nSource"});
});
it("reads international Qwen and reports an unrecognized layout without guessing roles",async()=>{
 document.body.innerHTML='<main><div class="qwen-chat-message-user">Question</div><div class="qwen-chat-message-assistant"><div class="response-message-content">Answer</div></div></main>';
 const adapter=new WebChatAdapter("qwen",()=>"https://chat.qwen.ai/c/abc");
 expect(adapter.parseMessages().map(m=>m.text)).toEqual(["Question","Answer"]);
 document.body.innerHTML='<main><p>Some arbitrary page text</p><textarea>Draft</textarea></main>';
 expect(adapter.inspect()).toMatchObject({state:"empty",messageCount:0});
});
it("scrolls up to load earlier history until the question appears, then stops",async()=>{
 const adapter=new WebChatAdapter("claude",()=>"https://claude.ai/chat/a");
 document.body.innerHTML='<main><div data-testid="user-message">Latest question</div></main>';
 const hash=await createContentHash("user\nEarlier question");
 let loads=0;
 const scrollTo=(()=>{loads++;if(loads===2)document.querySelector("main")!.insertAdjacentHTML("afterbegin",'<div data-testid="user-message">Earlier question</div>');}) as typeof window.scrollTo;
 const original=window.scrollTo;window.scrollTo=scrollTo;
 try{
  const found=await adapter.revealMessage({contentHash:hash,preview:previewMessage("Earlier question"),role:"user"});
  expect(found?.textContent).toBe("Earlier question");expect(loads).toBe(2);
 }finally{window.scrollTo=original;}
},10_000);
