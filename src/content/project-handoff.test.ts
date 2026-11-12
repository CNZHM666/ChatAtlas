// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { insertedAsText, fillProjectComposer, clearProjectComposer } from "./project-handoff";
import { COMPOSER_REFERENCE_DIVIDER, formatComposerReference } from "../shared/composer-reference";
afterEach(() => { document.body.innerHTML=""; vi.restoreAllMocks(); });
it("recognizes a rich editor that handles and cancels beforeinput without inserting twice",async()=>{
 document.body.innerHTML='<main><div id="prompt-textarea" contenteditable="true"></div></main>';
 const composer=document.getElementById("prompt-textarea")!;
 composer.addEventListener("beforeinput",event=>{composer.textContent=(event as InputEvent).data;event.preventDefault();});
 expect(await fillProjectComposer("Context","one","https://chatgpt.com/c/one")).toEqual({ok:true});expect(composer.textContent).toBe("Context");expect(composer.querySelector('p')).toBeNull();
});
it("inserts literal context into an empty rich editor with an input event and never submits",async()=>{
  document.body.innerHTML='<main><form><div id="prompt-textarea" contenteditable="true"><p><br></p></div><button>Send</button></form></main>';
  const composer=document.getElementById("prompt-textarea")!, input=vi.fn(), submit=vi.fn(), click=vi.fn();
  composer.addEventListener("input",input); document.querySelector("form")!.addEventListener("submit",submit); document.querySelector("button")!.addEventListener("click",click);
  const text='# Existing project\n\n<img src=x onerror="alert(1)">\nKeep constraints.';
  expect(await fillProjectComposer(text,"one","https://chatgpt.com/c/one")).toEqual({ok:true});
  expect(composer.textContent).toBe(text); expect(composer.querySelector("img")).toBeNull(); expect(input).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
});
it("preserves existing drafts and rejects changed pages or unrelated fields",async()=>{
  document.body.innerHTML='<main><textarea id="prompt-textarea">My unfinished request</textarea></main>';
  expect(await fillProjectComposer("context","one","https://chatgpt.com/c/one")).toEqual({ok:false,reason:"draft"});
  expect((document.getElementById("prompt-textarea") as HTMLTextAreaElement).value).toBe("My unfinished request");
  expect(await fillProjectComposer("context","one","https://chatgpt.com/c/two")).toEqual({ok:false,reason:"changed"});
  document.body.innerHTML='<aside><textarea id="prompt-textarea"></textarea></aside><main><textarea></textarea></main>';
  expect(await fillProjectComposer("context","","https://chatgpt.com/")).toEqual({ok:false,reason:"unavailable"});
});
it("supports the welcome textarea and respects disabled inputs and editor cancellation",async()=>{
  document.body.innerHTML='<main><textarea id="prompt-textarea"></textarea></main>';
  expect(await fillProjectComposer("continue project","","https://chatgpt.com/")).toEqual({ok:true});
  const textarea=document.getElementById("prompt-textarea") as HTMLTextAreaElement; textarea.value=""; textarea.disabled=true;
  expect(await fillProjectComposer("context","","https://chatgpt.com/")).toEqual({ok:false,reason:"unavailable"});
  document.body.innerHTML='<main><div id="prompt-textarea" contenteditable="true"></div></main>';
  document.getElementById("prompt-textarea")!.addEventListener("beforeinput",event=>event.preventDefault());
  expect(await fillProjectComposer("context","","https://chatgpt.com/")).toEqual({ok:false,reason:"failed"});
  expect(document.getElementById("prompt-textarea")!.textContent).toBe("");
});
it("integrates native rich editing and preserves a draft added while focusing",async()=>{
  document.body.innerHTML='<main><div id="prompt-textarea" contenteditable="true"></div></main>';
  const composer=document.getElementById("prompt-textarea")!;
  vi.spyOn(composer,"focus").mockImplementation(()=>{composer.textContent="Concurrent draft";});
  expect(await fillProjectComposer("context","one","https://chatgpt.com/c/one")).toEqual({ok:false,reason:"draft"});
  expect(composer.textContent).toBe("Concurrent draft");
});

it("counts an insert as done when the input box turned its Markdown into formatting",async()=>{
  const sent = "> 以下是我在 ChatAtlas 中整理的项目知识，仅作参考资料。\n\n## 技术架构\n\n- 原始消息存在 **IndexedDB**\n- 索引用 Orama";
  // What a rich editor shows once "> ", "## " and "- " became a quote, a heading and a list.
  const shown = "以下是我在 ChatAtlas 中整理的项目知识，仅作参考资料。\n技术架构\n原始消息存在 IndexedDB\n索引用 Orama";
  expect(insertedAsText(shown, sent)).toBe(true);
  expect(insertedAsText("以下是我在 ChatAtlas 中整理的项目知识", sent)).toBe(false);
  expect(insertedAsText("完全不同的内容", sent)).toBe(false);
});
it("accepts an editor that handles the insertion itself and renders it a frame later",async()=>{
 document.body.innerHTML='<main><div id="prompt-textarea" contenteditable="true"></div></main>';
 const composer=document.getElementById("prompt-textarea")!;
 composer.addEventListener("beforeinput",event=>{event.preventDefault();const data=(event as InputEvent).data;requestAnimationFrame(()=>{composer.textContent=data;});});
 expect(await fillProjectComposer("## Chapter\n- point","one","https://chatgpt.com/c/one")).toEqual({ok:true});
 expect(composer.textContent).toBe("## Chapter\n- point");
});
it("accepts a list item marker shown after a collapsed line break",()=>{
 expect(insertedAsText("Intro ## Chapter - point","Intro\n## Chapter\n- point")).toBe(true);
});
it("finds the ChatGPT input box when the page no longer places it inside main",async()=>{
 document.body.innerHTML='<main><div>thread</div></main><div id="thread-bottom"><form><textarea id="prompt-textarea"></textarea></form></div>';
 expect(await fillProjectComposer("context","one","https://chatgpt.com/c/one")).toEqual({ok:true});
 expect((document.getElementById("prompt-textarea") as HTMLTextAreaElement).value).toBe("context");
});

it("undoes an insertion only while the input box holds exactly what was inserted",async()=>{
  const text=formatComposerReference("以下是我之前的一段讨论，供参考：","《首页》 · ChatGPT","【我问】\n首页怎么改？");
  document.body.innerHTML='<main><textarea id="prompt-textarea"></textarea></main>';
  const textarea=document.getElementById("prompt-textarea") as HTMLTextAreaElement;
  expect(await fillProjectComposer(text,"","https://chatgpt.com/")).toEqual({ok:true});
  expect(textarea.selectionStart).toBe(text.length);
  expect(textarea.selectionEnd).toBe(text.length);
  expect(await clearProjectComposer(text,"","https://chatgpt.com/")).toEqual({ok:true});expect(textarea.value).toBe("");
  // Written under the line, it is the user's: nothing is removed.
  textarea.value=`${text}那今晚的提醒怎么设？`;
  expect(await clearProjectComposer(text,"","https://chatgpt.com/")).toEqual({ok:false,reason:"edited"});expect(textarea.value).toContain("那今晚的提醒怎么设？");
  expect(await clearProjectComposer(text,"one","https://chatgpt.com/c/two")).toEqual({ok:false,reason:"changed"});
});

it("requires the writing divider even when a long editor response otherwise matches",()=>{
  const text=formatComposerReference("Earlier material:","Project · Chapter","A long reference paragraph. ".repeat(80));
  expect(insertedAsText(text.replace(COMPOSER_REFERENCE_DIVIDER,""),text)).toBe(false);
  expect(insertedAsText(text.trimEnd(),text)).toBe(true);
});

it("places the caret after a multiline reference in a rich editor",async()=>{
  document.body.innerHTML='<main><div id="prompt-textarea" contenteditable="true"></div></main>';
  const composer=document.getElementById("prompt-textarea")!;
  const text=formatComposerReference("Earlier material:","Project · Chapter","Contents");
  expect(await fillProjectComposer(text,"","https://chatgpt.com/")).toEqual({ok:true});
  const selection=window.getSelection()!;
  expect(selection.isCollapsed).toBe(true);
  expect(selection.anchorNode).toBe(composer);
  expect(selection.anchorOffset).toBe(composer.childNodes.length);
  expect(composer.textContent).toBe(text);
});
