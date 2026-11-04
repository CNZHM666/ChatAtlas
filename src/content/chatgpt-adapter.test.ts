import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOMChatGPTAdapter } from "./chatgpt-adapter";
import { createContentHash } from "./message-identity";

describe("DOMChatGPTAdapter", () => {
  it("stops at once for a question far outside the few turns the current page keeps, so Reader can open it",async()=>{
    history.replaceState(null,"","/c/6ac6fc4d");
    const unit=(n:number,id:string,text:string)=>`<div data-turn-key="k${n}"><div data-content-search-unit-key="fallback-turn-${n}:0:user" data-chatgpt-search-message-ids="${id}"><p>${text}</p></div></div>`;
    document.body.innerHTML=`<main>${unit(0,"q-350","问题三百五十")}${unit(1,"q-352","问题三百五十二")}</main>`;
    const adapter=new DOMChatGPTAdapter(),started=Date.now();
    const found=await adapter.revealMessage({messageId:"q-33",contentHash:"",preview:"",messageIndex:33,role:"user",anchors:[{messageId:"q-350",messageIndex:350},{messageId:"q-352",messageIndex:352}]});
    expect(found).toBeNull();expect(adapter.lastReveal).toBe("far");expect(Date.now()-started).toBeLessThan(500);
  });
  it("reads and locates questions in ChatGPT's current markup (turn keys, search units, search message IDs)",async()=>{
    history.replaceState(null,"","/c/6ac6fc4d");
    const unit=(turn:number,n:number,role:string,id:string,text:string)=>`<div data-content-search-unit-key="fallback-turn-${turn}:${n}:${role}" data-chatgpt-search-message-ids="${id} ${id}"><div class="group" data-chatgpt-selection-message-id="${id}"><p>${text}</p></div></div>`;
    document.body.innerHTML=`<main><div data-turn-key="t1"><div data-content-search-turn-key="fallback-turn-6">${unit(6,1,"user","q-1","第一个问题")}</div></div><div data-turn-key="t2"><div data-content-search-turn-key="fallback-turn-7">${unit(7,2,"assistant","a-1","回答内容")}</div></div><div data-turn-key="t3">${unit(8,1,"user","q-2","这个导出与复用怎么实现呢？通过什么架构实现")}</div></main>`;
    const adapter=new DOMChatGPTAdapter();
    expect(adapter.parseQuestions().map(message=>[message.text,message.stableId])).toEqual([["第一个问题","q-1"],["这个导出与复用怎么实现呢？通过什么架构实现","q-2"]]);
    expect(adapter.parseMessages().map(message=>message.role)).toEqual(["user","assistant","user"]);
    const found=await adapter.locateMessage({messageId:"q-2",contentHash:"",preview:"这个导出",role:"user"});
    expect(found).toBe(document.querySelector('[data-turn-key="t3"]'));
    expect(adapter.discussionElements(found!)).toEqual([found]);
  });
  it("finds a question by its text when the page has no role markup, never an answer that quotes it",async()=>{
    history.replaceState(null,"","/c/chat");
    document.body.innerHTML='<main><article><div class="whitespace-pre-wrap">这个导出与复用怎么实现呢？通过什么架构实现</div></article><article><p>你问：这个导出与复用怎么实现呢？通过什么架构实现。答案是分三层：存储、索引和导出，每层各自独立，便于复用和替换。</p></article></main>';
    const adapter=new DOMChatGPTAdapter();
    const found=await adapter.locateMessage({messageId:"import-id",contentHash:"a".repeat(64),preview:"这个导出",messageIndex:0,role:"user",text:"这个导出与复用怎么实现呢？通过什么架构实现"});
    expect(found).toBe(document.querySelector("article .whitespace-pre-wrap"));
  });
  it("reads and locates questions when the thread is not inside main",async()=>{
    history.replaceState(null,"","/c/chat");
    document.body.innerHTML='<main></main><div id="thread"><article data-testid="conversation-turn-0"><div data-message-author-role="user" data-message-id="q1">First</div></article></div><aside><div data-message-author-role="user" data-message-id="preview">Copy</div></aside>';
    const adapter=new DOMChatGPTAdapter();
    expect(adapter.parseQuestions().map(message=>message.text)).toEqual(["First"]);
    expect(await adapter.locateMessage({messageId:"q1",contentHash:"",preview:"First",role:"user"})).not.toBeNull();
  });
  it("finds a visible question by its saved text when the page's ID and rendered text differ from the import",async()=>{
    history.replaceState(null,"","/c/chat");
    document.body.innerHTML='<main><article data-testid="conversation-turn-0"><div data-message-author-role="user" data-message-id="page-id"><div class="whitespace-pre-wrap">这个导出与复用怎么实现呢？ 通过什么架构实现</div><span>已编辑</span></div></article><article data-testid="conversation-turn-1"><div data-message-author-role="user" data-message-id="other">别的问题</div></article></main>';
    const adapter=new DOMChatGPTAdapter();
    const found=await adapter.locateMessage({messageId:"import-id",contentHash:"a".repeat(64),preview:"这个导出",messageIndex:4,role:"user",text:"这个导出与复用怎么实现呢？\n通过什么架构实现"});
    expect(found?.getAttribute("data-message-id")??found?.querySelector("[data-message-id]")?.getAttribute("data-message-id")).toBe("page-id");
    expect(await adapter.locateMessage({messageId:"import-id",contentHash:"a".repeat(64),preview:"x",messageIndex:4,role:"user",text:"完全不同的另一个问题内容在这里"})).toBeNull();
  });
  it("finds role-only questions beside wrapped turns and ignores hidden/sidebar copies",()=>{
    document.body.innerHTML='<main><article data-testid="conversation-turn-0"><div data-message-author-role="user" data-message-id="first">First</div><div data-message-author-role="assistant">Answer</div></article><div data-message-author-role="user" data-message-id="second">Second</div><div hidden data-message-author-role="user">Hidden</div><aside><div data-message-author-role="user">Sidebar</div></aside></main>';
    const adapter=new DOMChatGPTAdapter();expect(adapter.parseMessages().map(message=>message.text)).toEqual(["First","Answer","Second"]);
    expect(adapter.parseQuestions().map(message=>[message.text,message.index])).toEqual([["First",0],["Second",2]]);
    expect(adapter.discussionElements(document.querySelector<HTMLElement>('[data-message-id="second"]')!)).toHaveLength(1);
  });
  it("navigates imported IDs by a unique full hash while refusing repeated text or a preview-only substitute",async()=>{
    document.body.innerHTML='<main><article data-testid="conversation-turn-0"><div data-message-author-role="user" data-message-id="native">Full question with all conditions.</div></article></main>';
    const adapter=new DOMChatGPTAdapter(),hash=await createContentHash("user\nFull question with all conditions.");
    const identity={messageId:"imported-mapping-id",role:"user" as const,contentHash:hash,preview:"Full question",messageIndex:0};
    expect(await adapter.locateMessage(identity)).toBe(document.querySelector("article"));
    expect(await adapter.locateMessage({...identity,contentHash:""})).toBeNull();
    document.querySelector("main")!.insertAdjacentHTML("beforeend",'<article data-testid="conversation-turn-2"><div data-message-author-role="user" data-message-id="duplicate">Full question with all conditions.</div></article>');
    expect(await adapter.locateMessage(identity)).toBeNull();
  });
  it("uses a message ID inside a turn wrapper rather than mistaking the wrapper ID for it",async()=>{
    document.body.innerHTML='<main><article data-testid="conversation-turn-4" data-message-id="wrapper"><div data-message-author-role="user" data-message-id="native-question">Question</div></article></main>';
    const adapter=new DOMChatGPTAdapter();expect(adapter.parseMessages()[0].stableId).toBe("native-question");expect(await adapter.locateMessage({messageId:"native-question",role:"user",contentHash:"",preview:"Question"})).toHaveAttribute("data-message-id","wrapper");
  });
  it("navigates by known ID anchors when stored message indices differ from native turn indices",async()=>{
    vi.useFakeTimers();try{
      let position=1000;vi.spyOn(window,"scrollY","get").mockImplementation(()=>position);vi.spyOn(document.documentElement,"scrollHeight","get").mockReturnValue(2000);
      const mount=(index:number,id:string)=>{document.body.innerHTML=`<main><article data-testid="conversation-turn-${index}" data-message-id="${id}"><div data-message-author-role="user">Question</div></article></main>`;};mount(10,"recent");
      const adapter=new DOMChatGPTAdapter();vi.spyOn(adapter,"detectConversation").mockReturnValue({id:"current",title:"",url:""});
      const scroll=vi.spyOn(window,"scrollTo").mockImplementation(options=>{position=(options as ScrollToOptions).top??0;mount(position===0?0:position===500?5:10,position===0?"first":position===500?"target":"recent");});
      const pending=adapter.revealMessage({messageId:"target",messageIndex:40,role:"user",contentHash:"",preview:"Question",anchors:[{messageId:"first",messageIndex:0},{messageId:"recent",messageIndex:100}]});await vi.advanceTimersByTimeAsync(1100);
      expect(await pending).toHaveAttribute("data-message-id","target");expect(scroll).toHaveBeenNthCalledWith(1,{top:0,behavior:"instant"});expect(scroll).toHaveBeenCalledTimes(2);
    }finally{vi.useRealTimers();}
  });
  it("finds an unmounted middle turn by narrowing loaded windows rather than checking only the ends",async()=>{
    vi.useFakeTimers();try{
      let position=1000;vi.spyOn(window,"scrollY","get").mockImplementation(()=>position);
      const mount=(index:number,id:string)=>{document.body.innerHTML=`<main><article data-testid="conversation-turn-${index}" data-message-id="${id}"><div data-message-author-role="user">Question ${index}</div></article></main>`;};
      mount(100,"recent");const adapter=new DOMChatGPTAdapter();vi.spyOn(adapter,"detectConversation").mockReturnValue({id:"current",title:"",url:""});
      const scroll=vi.spyOn(window,"scrollTo").mockImplementation(options=>{position=(options as ScrollToOptions).top??0;mount(position===0?0:50,position===0?"first":"middle");});
      const pending=adapter.revealMessage({messageId:"middle",messageIndex:50,role:"user",contentHash:"",preview:"Question 50"});await vi.advanceTimersByTimeAsync(1100);
      expect(await pending).toHaveAttribute("data-message-id","middle");expect(scroll).toHaveBeenCalledTimes(2);expect(scroll).toHaveBeenLastCalledWith({top:500,behavior:"instant"});
    }finally{vi.useRealTimers();}
  });
  it("does not restore or keep searching after the user interrupts native recovery",async()=>{
    vi.useFakeTimers();try{
      document.body.innerHTML='<main><article data-testid="conversation-turn-50" data-message-id="recent"><div data-message-author-role="user">Recent</div></article></main>';
      const adapter=new DOMChatGPTAdapter();vi.spyOn(adapter,"detectConversation").mockReturnValue({id:"current",title:"",url:""});const scroll=vi.spyOn(window,"scrollTo").mockImplementation(()=>{window.dispatchEvent(new Event("wheel"));});
      const pending=adapter.revealMessage({messageId:"old",messageIndex:0,role:"user",contentHash:"",preview:"Old"});await vi.advanceTimersByTimeAsync(600);expect(await pending).toBeNull();expect(scroll).toHaveBeenCalledOnce();
    }finally{vi.useRealTimers();}
  });
  it("stops a pending recovery when a newer native locate request succeeds",async()=>{
    vi.useFakeTimers();try{
      document.body.innerHTML='<main><article data-testid="conversation-turn-50" data-message-id="recent"><div data-message-author-role="user">Recent</div></article></main>';
      const adapter=new DOMChatGPTAdapter();vi.spyOn(adapter,"detectConversation").mockReturnValue({id:"current",title:"",url:""});const scroll=vi.spyOn(window,"scrollTo").mockImplementation(()=>undefined);
      const pending=adapter.revealMessage({messageId:"old",messageIndex:0,role:"user",contentHash:"",preview:"Old"});
      expect(await adapter.locateMessage({messageId:"recent",messageIndex:50,role:"user",contentHash:"",preview:"Recent"})).toHaveAttribute("data-message-id","recent");
      await vi.advanceTimersByTimeAsync(600);expect(await pending).toBeNull();expect(scroll).toHaveBeenCalledOnce();
    }finally{vi.useRealTimers();}
  });
  afterEach(()=>vi.restoreAllMocks());
  it("captures a recognized native component between prose blocks with its visible text and layout", () => {
    document.body.innerHTML = '<main><div data-message-author-role="assistant"><div class="markdown"><p>前提</p></div><section data-testid="genui-steps" style="display:grid;gap:24px"><h2>选择项目</h2><p>关联已有 ChatAtlas 项目</p><svg viewBox="0 0 20 20"><path d="M1 1L5 5"/></svg></section><div class="markdown"><p>结论</p></div></div></main>';
    const [message] = new DOMChatGPTAdapter().parseMessages();
    expect(message.text).toBe("前提\n\n【原平台交互内容】\n选择项目\n关联已有 ChatAtlas 项目\n结论");
    expect(message.uiParts).toHaveLength(1);
    expect(message.uiParts![0]).toMatchObject({ ordinal: 0, fallbackText: "选择项目\n关联已有 ChatAtlas 项目" });
    expect(JSON.parse(message.uiParts![0].raw).text).toContain("display:grid");
    expect(JSON.parse(message.uiParts![0].raw).text).toContain("M1 1L5 5");
    expect(document.querySelector("[data-testid=genui-steps]")).not.toBeNull();
  });
  it("retains inaccessible iframe locations without fetching or losing adjacent text", () => {
    document.body.innerHTML = '<main><div data-message-author-role="assistant"><div class="markdown">正文</div><iframe title="Interactive quiz"></iframe><div class="markdown">后续</div></div></main>';
    const [message] = new DOMChatGPTAdapter().parseMessages();
    expect(message.text).toBe("正文\n【原平台交互内容】\n后续");
    expect(message.uiParts![0].raw).toContain("Interactive quiz");
  });
  it("retains separate writing blocks and a sibling code block in the same reply", () => {
    document.body.innerHTML = '<main><div data-message-author-role="assistant"><div class="markdown"><p>第一段</p></div><pre><code>  x = 1</code></pre><div class="markdown"><p>第二段条件</p></div><button>复制</button></div></main>';
    const [message] = new DOMChatGPTAdapter().parseMessages();
    expect(message.text).toContain("第一段"); expect(message.text).toContain("第二段条件"); expect(message.text).toContain("```text\n  x = 1\n```"); expect(message.text).not.toContain("复制");
  });
  it("captures code blocks and multiple prose blocks without toolbar text or executing UI scripts", () => {
    document.body.innerHTML = `<main><article data-testid="conversation-turn-0"><div data-message-author-role="assistant"><div class="markdown"><p>技术架构</p><div><button>复制代码</button><pre><code class="language-text">  ┌───┬───┐\n  │   │   │\n    return  2</code></pre></div><p>后续说明</p><script>execute()</script></div></div></article></main>`;
    const [message] = new DOMChatGPTAdapter().parseMessages();
    expect(message.text).toContain("```text\n  ┌───┬───┐\n  │   │   │\n    return  2\n```");
    expect(message.text).toContain("后续说明");
    expect(message.text).not.toContain("复制代码"); expect(message.text).not.toContain("execute()");
    expect(message.text).not.toContain("技术架构后续说明");
  });
  beforeEach(() => {
    document.body.innerHTML = "";
    document.title = "Control poles – ChatGPT";
    window.history.replaceState({}, "", "/c/conversation-123?model=auto");
  });

  it("detects canonical conversation metadata", () => {
    const conversation = new DOMChatGPTAdapter().detectConversation();
    expect(conversation).toEqual({
      id: "conversation-123",
      title: "Control poles",
      url: `${window.location.origin}/c/conversation-123`,
    });
  });
  it("detects the same thread inside a project route and keeps its real source URL", () => {
    window.history.replaceState({},"","/g/g-project/c/conversation-123?model=auto");
    expect(new DOMChatGPTAdapter().detectConversation()).toMatchObject({id:"conversation-123",url:`${location.origin}/g/g-project/c/conversation-123`});
  });

  it("parses user and assistant turns without toolbar text", () => {
    document.body.innerHTML = `
      <main>
        <article data-testid="conversation-turn-0" data-message-id="message-user">
          <div data-message-author-role="user"><div class="whitespace-pre-wrap">Why np.roots?</div></div>
          <button>Copy</button>
        </article>
        <article data-testid="conversation-turn-1" data-message-id="message-assistant">
          <div data-message-author-role="assistant"><div class="markdown"><p>It finds polynomial zeros.</p></div></div>
          <button>Regenerate</button>
        </article>
      </main>`;

    const messages = new DOMChatGPTAdapter().parseMessages();
    expect(messages.map(({ stableId, index, role, text }) => ({ stableId, index, role, text }))).toEqual([
      { stableId: "message-user", index: 0, role: "user", text: "Why np.roots?" },
      { stableId: "message-assistant", index: 1, role: "assistant", text: "It finds polynomial zeros." },
    ]);
  });

  it("falls back to preview and index when stable ids are unavailable", async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="user">First question</div>
        <div data-message-author-role="assistant">A durable answer</div>
      </main>`;
    const adapter = new DOMChatGPTAdapter();
    expect((await adapter.locateMessage({ contentHash: "missing", preview: "durable answer" }))?.textContent).toContain("A durable answer");
    expect((await adapter.locateMessage({ contentHash: "missing", preview: "missing", messageIndex: 0 }))?.textContent).toContain("First question");
  });

  it("locates an exact message by content hash before weaker fallbacks", async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant">First answer</div>
        <div data-message-author-role="assistant">Target answer</div>
      </main>`;
    const hash = await createContentHash("assistant\nTarget answer");
    const found = await new DOMChatGPTAdapter().locateMessage({ contentHash: hash, preview: "not present", messageIndex: 0 });
    expect(found?.textContent).toContain("Target answer");
  });

  it("uses visible text and nearby index immediately for repeated short questions", async () => {
    document.body.innerHTML = `<main>
      <article data-testid="conversation-turn-0" data-message-id="first"><div data-message-author-role="user">好</div></article>
      <article data-testid="conversation-turn-1" data-message-id="reply"><div data-message-author-role="assistant">继续</div></article>
      <article data-testid="conversation-turn-2" data-message-id="second"><div data-message-author-role="user">好</div></article>
    </main>`;
    const digest = vi.spyOn(crypto.subtle, "digest");
    const found = await new DOMChatGPTAdapter().locateMessage({ contentHash: "not-needed", preview: "好", messageIndex: 2, role: "user" });
    expect(found).toHaveAttribute("data-message-id", "second");
    expect(digest).not.toHaveBeenCalled();
  });

  it("finds the answer adjacent to a question without crossing the next user turn", () => {
    document.body.innerHTML = `<main>
      <article data-testid="conversation-turn-0"><div data-message-author-role="user">First</div></article>
      <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Answer</div></article>
      <article data-testid="conversation-turn-2"><div data-message-author-role="user">Second</div></article>
    </main>`;
    const adapter = new DOMChatGPTAdapter();
    const [first, answer, second] = adapter.parseMessages();
    expect(adapter.followingAssistant(first.element)).toBe(answer.element);
    expect(adapter.followingAssistant(second.element)).toBeNull();
  });

  it("locates a native ID and its complete turn without capturing a long conversation",async()=>{
    document.body.innerHTML='<main><article data-testid="conversation-turn-0" data-message-id="q"><div data-message-author-role="user">Question</div></article><article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Long answer</div></article><article data-testid="conversation-turn-2"><div data-message-author-role="user">Next</div></article></main>';
    const adapter=new DOMChatGPTAdapter(),parse=vi.spyOn(adapter,"parseMessages"),digest=vi.spyOn(crypto.subtle,"digest");
    const element=await adapter.locateMessage({messageId:"q",role:"user",contentHash:"",preview:"Question"});
    expect(element).toHaveAttribute("data-message-id","q");expect(adapter.discussionElements(element!)).toHaveLength(2);expect(parse).not.toHaveBeenCalled();expect(digest).not.toHaveBeenCalled();
    expect(await adapter.locateMessage({messageId:"not-mounted",role:"user",contentHash:"",preview:"Question",messageIndex:0})).toBeNull();
  });

  it("disambiguates shared long prefixes by full hash and invalidates hashes after text edits",async()=>{
    const prefix="A repeated question prefix with detailed background. ".repeat(4);
    document.body.innerHTML=`<main><div data-message-author-role="user">${prefix}first ending</div><div data-message-author-role="user">${prefix}second ending</div></main>`;
    const adapter=new DOMChatGPTAdapter(),hash=await createContentHash(`user\n${prefix}second ending`);
    const found=await adapter.locateMessage({role:"user",contentHash:hash,preview:prefix,messageIndex:0});expect(found?.textContent).toContain("second ending");
    found!.textContent="An edited unrelated question";
    expect(await adapter.locateMessage({role:"user",contentHash:hash,preview:prefix,messageIndex:0})).toBeNull();
  });

  it("recovers an unmounted older turn with an exact ID and stops when it becomes available",async()=>{
    document.body.innerHTML='<main><article data-testid="conversation-turn-20" data-message-id="recent"><div data-message-author-role="user">Recent</div></article></main>';
    const adapter=new DOMChatGPTAdapter();vi.spyOn(adapter,"detectConversation").mockReturnValue({id:"current",title:"",url:""});
    const scroll=vi.spyOn(window,"scrollTo").mockImplementation(()=>{document.querySelector("main")!.insertAdjacentHTML("afterbegin",'<article data-testid="conversation-turn-0" data-message-id="old"><div data-message-author-role="user">Old question</div></article>');});
    const result=await adapter.revealMessage({messageId:"old",messageIndex:0,role:"user",contentHash:"",preview:"Old question"});
    expect(result).toHaveAttribute("data-message-id","old");expect(scroll).toHaveBeenCalledOnce();
  });

  it("bounds unsuccessful recovery and restores the reader's scroll instead of claiming an index match",async()=>{
    vi.useFakeTimers();
    try{
      document.body.innerHTML='<main><article data-testid="conversation-turn-20" data-message-id="recent"><div data-message-author-role="user">Recent</div></article></main>';
      const adapter=new DOMChatGPTAdapter();vi.spyOn(adapter,"detectConversation").mockReturnValue({id:"current",title:"",url:""});
      const scroll=vi.spyOn(window,"scrollTo").mockImplementation(()=>undefined);
      const pending=adapter.revealMessage({messageId:"missing",messageIndex:0,role:"user",contentHash:"",preview:"Recent"});
      await vi.advanceTimersByTimeAsync(12_100);expect(await pending).toBeNull();expect(scroll.mock.calls.length).toBeLessThanOrEqual(25);expect(scroll).toHaveBeenLastCalledWith({top:window.scrollY,behavior:"instant"});expect(vi.getTimerCount()).toBe(0);
    }finally{vi.useRealTimers();}
  });

  it("loads a non-article native turn even when hydration takes longer than one second",async()=>{
    vi.useFakeTimers();try{
      document.body.innerHTML='<main><section data-testid="conversation-turn-20" data-message-id="recent"><div data-message-author-role="user">Recent</div></section></main>';
      const adapter=new DOMChatGPTAdapter();let scheduled=false;
      const scroll=vi.spyOn(window,"scrollTo").mockImplementation(()=>{
        if(scheduled)return;scheduled=true;
        window.setTimeout(()=>document.querySelector("main")!.insertAdjacentHTML("afterbegin",'<section data-testid="conversation-turn-0" data-message-id="old"><div data-message-author-role="user">Old</div></section>'),1800);
      });
      const pending=adapter.revealMessage({messageId:"old",messageIndex:0,role:"user",contentHash:"",preview:"Old"});
      await vi.advanceTimersByTimeAsync(1900);
      expect(await pending).toHaveAttribute("data-message-id","old");expect(scroll).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
    }finally{vi.useRealTimers();}
  });

  it("starts recovery on a role-only page instead of requiring indexed turns to be mounted first",async()=>{
    document.body.innerHTML='<main><div data-message-author-role="user" data-message-id="recent">Recent</div></main>';
    vi.spyOn(window,"scrollTo").mockImplementation(()=>document.querySelector("main")!.insertAdjacentHTML("afterbegin",'<div data-message-author-role="user" data-message-id="old">Old</div>'));
    const found=await new DOMChatGPTAdapter().revealMessage({messageId:"old",messageIndex:0,role:"user",contentHash:"",preview:"Old"});
    expect(found).toHaveAttribute("data-message-id","old");
  });

  it("reacquires the scroll surface when the host rebuilds the conversation while loading",async()=>{
    vi.useFakeTimers();try{
      document.body.innerHTML='<main><article data-testid="conversation-turn-20" data-message-id="recent"><div data-message-author-role="user">Recent</div></article></main>';
      const first=document.querySelector<HTMLElement>("main")!;
      const scroll=vi.fn(()=>{
        document.body.innerHTML='<main><section data-testid="conversation-turn-10" data-message-id="earlier"><div data-message-author-role="user">Earlier</div></section></main>';
        const next=document.querySelector<HTMLElement>("main")!;
        next.scrollTo=vi.fn(()=>next.insertAdjacentHTML("afterbegin",'<section data-testid="conversation-turn-0" data-message-id="old"><div data-message-author-role="user">Old</div></section>'));
      });first.scrollTo=scroll;
      const adapter=new DOMChatGPTAdapter();vi.spyOn(adapter,"scrollContainer").mockImplementation(element=>element.closest("main")!);
      const pending=adapter.revealMessage({messageId:"old",messageIndex:0,role:"user",contentHash:"",preview:"Old"});await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toHaveAttribute("data-message-id","old");expect(scroll).toHaveBeenCalledOnce();
    }finally{vi.useRealTimers();}
  });

  it("keeps anchor coordinates when a middle window contains none of the stored anchors",async()=>{
    vi.useFakeTimers();try{
      let position=1000;vi.spyOn(window,"scrollY","get").mockImplementation(()=>position);
      const mount=(index:number,id:string)=>{document.body.innerHTML=`<main><article data-testid="conversation-turn-${index}" data-message-id="${id}"><div data-message-author-role="user">Question</div></article></main>`;};mount(10,"last");
      const scroll=vi.spyOn(window,"scrollTo").mockImplementation(options=>{
        position=(options as ScrollToOptions).top??0;
        if(position===0)mount(0,"first");else if(position===500)mount(5,"unknown");else if(position===250)mount(2,"target");
      });
      const pending=new DOMChatGPTAdapter().revealMessage({messageId:"target",messageIndex:20,role:"user",contentHash:"",preview:"Question",anchors:[{messageId:"first",messageIndex:0},{messageId:"last",messageIndex:100}]});await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toHaveAttribute("data-message-id","target");expect(scroll).toHaveBeenCalledTimes(3);expect(scroll).toHaveBeenLastCalledWith({top:250,behavior:"instant"});
    }finally{vi.useRealTimers();}
  });
});
