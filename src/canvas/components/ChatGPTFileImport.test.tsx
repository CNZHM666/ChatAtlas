import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {PreferencesProvider} from "../preferences";
import {ChatGPTFileImport} from "./ChatGPTFileImport";
import {genericJsonConversations,markdownConversation} from "../../sync/importers/generic";
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.style.overflow="";});

it("opens a readable, source-linked guide before the picker and imports only an explicitly selected file",()=>{
 localStorage.setItem("atlas-locale","zh-CN");const onImport=vi.fn(),fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 render(<PreferencesProvider><ChatGPTFileImport onImport={onImport}>导入文件</ChatGPTFileImport></PreferencesProvider>);
 const input=screen.getByLabelText("导入对话文件") as HTMLInputElement,picker=vi.spyOn(input,"click"),trigger=screen.getByRole("button",{name:"导入文件"});
 trigger.focus();fireEvent.click(trigger);
 const dialog=screen.getByRole("dialog",{name:"导入 AI 对话"});
 expect(within(dialog).getByRole("heading",{level:2})).toHaveFocus();expect(document.body.style.overflow).toBe("hidden");
 expect(dialog.querySelectorAll(".file-import-guide-steps > li")).toHaveLength(3);
 expect(dialog.querySelector(".file-import-guide-header p")).toBeNull();
 expect(within(dialog).queryByText(/文件在本机读取/)).toBeNull();
 expect(within(dialog).getByText("导出最长可能需要 7 天")).toBeVisible();expect(within(dialog).getByText("下载链接收到后 24 小时内有效")).toBeVisible();
 expect(within(dialog).getByRole("link",{name:"查看 OpenAI 官方导出说明"})).toHaveAttribute("href","https://help.openai.com/en/articles/7260999-exporting-your-chatgpt-history-and-data");
 expect(onImport).not.toHaveBeenCalled();expect(picker).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole("button",{name:"选择文件导入"}));expect(picker).toHaveBeenCalledOnce();
 // Cancelling the native picker keeps the guide available and starts no import.
 fireEvent.change(input,{target:{files:[]}});expect(onImport).not.toHaveBeenCalled();expect(dialog).toBeVisible();
 const file=new File(["{}"],"conversations.json",{type:"application/json"});
 fireEvent.change(input,{target:{files:[file]}});expect(onImport).toHaveBeenCalledExactlyOnceWith(file);expect(screen.queryByRole("dialog")).toBeNull();expect(input.value).toBe("");expect(trigger).toHaveFocus();
 fireEvent.click(trigger);fireEvent.change(input,{target:{files:[file]}});expect(onImport).toHaveBeenCalledTimes(2);expect(fetch).not.toHaveBeenCalled();
});

it("traps keyboard focus, keeps collapsed help out of the tab sequence, and restores focus and scroll on close",()=>{
 localStorage.setItem("atlas-locale","en");document.body.style.overflow="auto";
 render(<PreferencesProvider><ChatGPTFileImport onImport={vi.fn()}>Import file</ChatGPTFileImport></PreferencesProvider>);
 const trigger=screen.getByRole("button",{name:"Import file"});trigger.focus();fireEvent.click(trigger);
 const dialog=screen.getByRole("dialog",{name:"Import AI conversations"}),close=within(dialog).getByRole("button",{name:"Close import guide"}),choose=within(dialog).getByRole("button",{name:"Choose file to import"});
 expect(within(dialog).getByText("No export notification yet?").closest("details")).not.toHaveAttribute("open");
 choose.focus();fireEvent.keyDown(choose,{key:"Tab"});expect(close).toHaveFocus();fireEvent.keyDown(close,{key:"Tab",shiftKey:true});expect(choose).toHaveFocus();
 fireEvent.click(within(dialog).getByText("Need help? View export tips"));fireEvent.click(within(dialog).getByText("No export notification yet?"));expect(within(dialog).getByText("No export notification yet?").closest("details")).toHaveAttribute("open");
 fireEvent.keyDown(dialog,{key:"Escape"});expect(screen.queryByRole("dialog")).toBeNull();expect(trigger).toHaveFocus();expect(document.body.style.overflow).toBe("auto");
 fireEvent.click(trigger);fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);expect(screen.queryByRole("dialog")).toBeNull();expect(trigger).toHaveFocus();
});

it("does not start a competing import if synchronization becomes active while the guide is open",()=>{
 localStorage.setItem("atlas-locale","en");const onImport=vi.fn();
 const view=render(<PreferencesProvider><ChatGPTFileImport onImport={onImport}>Import file</ChatGPTFileImport></PreferencesProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Import file"}));
 view.rerender(<PreferencesProvider><ChatGPTFileImport onImport={onImport} disabled>Import file</ChatGPTFileImport></PreferencesProvider>);
 expect(screen.getByRole("button",{name:"Choose file to import"})).toBeDisabled();
 fireEvent.change(screen.getByLabelText("Import conversation file"),{target:{files:[new File(["{}"],"conversations.json")]}});expect(onImport).not.toHaveBeenCalled();expect(screen.getByRole("dialog")).toBeVisible();
});

it("switches export steps per platform while keeping one local file picker",()=>{
 localStorage.setItem("atlas-locale","zh-CN");const onImport=vi.fn(),fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 render(<PreferencesProvider><ChatGPTFileImport onImport={onImport}>导入文件</ChatGPTFileImport></PreferencesProvider>);
 fireEvent.click(screen.getByRole("button",{name:"导入文件"}));
 const dialog=screen.getByRole("dialog",{name:"导入 AI 对话"}),tabs=within(dialog).getAllByRole("tab");
 expect(tabs.map(tab=>tab.textContent)).toEqual(["ChatGPT","Claude","Gemini","DeepSeek","其他 AI"]);
 expect(tabs[0]).toHaveAttribute("aria-selected","true");
 fireEvent.click(within(dialog).getByRole("tab",{name:"Gemini"}));
 expect(within(dialog).getByRole("tab",{name:"Gemini"})).toHaveAttribute("aria-selected","true");
 expect(within(dialog).getByRole("link",{name:"打开 Google Takeout"})).toHaveAttribute("href","https://takeout.google.com/");
 expect(within(dialog).getByText(/间隔不超过 30 分钟/)).toBeVisible();
 expect(within(dialog).queryByText("查看 OpenAI 官方导出说明")).toBeNull();
 fireEvent.click(within(dialog).getByRole("tab",{name:"其他 AI"}));
 expect(within(dialog).getByText("直接选择导出的对话文件")).toBeVisible();
 expect(within(dialog).queryByText("没有文件？用模板保存对话")).toBeNull();
 expect(within(dialog).queryByText("保存后，选择文件导入")).toBeNull();
 expect(within(dialog).getByText("高级：自定义对话文件").closest("details")).not.toHaveAttribute("open");
 expect(within(dialog).getByRole("link",{name:"下载 Markdown 模板"})).not.toBeVisible();
 fireEvent.click(within(dialog).getByText("高级：自定义对话文件"));
 expect(within(dialog).getByText("使用 JSON 格式").closest("details")).not.toHaveAttribute("open");
 const markdownLink=within(dialog).getByRole("link",{name:"下载 Markdown 模板"});
 const markdownText=decodeURIComponent(markdownLink.getAttribute("href")!.split(",")[1]);
 expect(markdownLink).toHaveAttribute("download","chatatlas-conversation.md");
 expect(markdownConversation(markdownText,"chat.md")?.messages.map(message=>message.role)).toEqual(["user","assistant"]);
 fireEvent.click(within(dialog).getByText("使用 JSON 格式"));
 const jsonLink=within(dialog).getByRole("link",{name:"下载 JSON 模板"});
 const json=JSON.parse(decodeURIComponent(jsonLink.getAttribute("href")!.split(",")[1]));
 expect(genericJsonConversations(json,"chat.json")?.[0].messages).toHaveLength(2);
 const input=screen.getByLabelText("导入对话文件") as HTMLInputElement;
 expect(input.accept).toContain(".md");
 const markdown=new File(["## 用户\n问\n## AI\n答"],"chat.md",{type:"text/markdown"});
 fireEvent.change(input,{target:{files:[markdown]}});expect(onImport).toHaveBeenCalledExactlyOnceWith(markdown);expect(fetch).not.toHaveBeenCalled();
});

it("navigates platform tabs by keyboard and keeps only the active tab in the tab sequence",()=>{
 localStorage.setItem("atlas-locale","en");
 render(<PreferencesProvider><ChatGPTFileImport onImport={vi.fn()}>Import file</ChatGPTFileImport></PreferencesProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Import file"}));
 const chatgpt=screen.getByRole("tab",{name:"ChatGPT"});chatgpt.focus();fireEvent.keyDown(chatgpt,{key:"End"});
 const other=screen.getByRole("tab",{name:"Other AI"});expect(other).toHaveFocus();expect(other).toHaveAttribute("aria-selected","true");expect(chatgpt).toHaveAttribute("tabindex","-1");
 fireEvent.click(screen.getByText("Advanced: custom conversation files"));
 const template=screen.getByRole("link",{name:"Download Markdown template"});
 expect(markdownConversation(decodeURIComponent(template.getAttribute("href")!.split(",")[1]),"chat.md")?.messages).toHaveLength(2);
 fireEvent.keyDown(other,{key:"ArrowRight"});expect(chatgpt).toHaveFocus();expect(chatgpt).toHaveAttribute("aria-selected","true");
});
