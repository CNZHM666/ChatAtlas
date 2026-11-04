import {cleanup,render,screen} from "@testing-library/react";
import {afterEach,expect,it} from "vitest";
import {ReaderMarkdown} from "./components/ReaderConversation";
afterEach(cleanup);

it("renders accidental four-space prose and arrows as ordinary Markdown, without copy-code boxes",()=>{
 const source="⑬ 实际制作\n\n    ↓\n\n⑭ 遇到问题 AI 帮助调试\n\n    这个才是我认为真正符合：\n\n    > **一个完全不会硬件的人，也能从想法开始做东西。**\n\n    的流程。\n\n    ---\n\n    # 一个很重要的调整：三个入口不要同等突出";
 const {container}=render(<ReaderMarkdown content={source} zh/>);
 expect(container.querySelector("pre")).toBeNull();expect(container.querySelector("blockquote strong")).toHaveTextContent("一个完全不会硬件的人");
 expect(screen.getByRole("heading",{name:"一个很重要的调整：三个入口不要同等突出"})).toBeVisible();expect(screen.queryByRole("button",{name:"复制代码"})).toBeNull();
});

it("preserves explicit code fences and actual indented program text",()=>{
 const source="```markdown\n> **显式代码必须保留**\n\n# 示例\n中文段落。\n```\n\n    const n = 1;\n    // 注释也属于代码\n    run(n);\n\n普通分隔段落。\n\n    # 中文注释\n    print('hello')\n    # 仍是程序文本";
 const {container}=render(<ReaderMarkdown content={source} zh/>);
 expect(container.querySelectorAll("pre")).toHaveLength(3);expect(container.querySelectorAll("blockquote")).toHaveLength(0);
 expect(container.querySelectorAll("pre")[1]).toHaveTextContent("const n = 1;");expect(screen.queryByRole("button",{name:"复制代码"})).toBeNull();
});
