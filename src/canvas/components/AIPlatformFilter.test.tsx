import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Conversation } from "../../shared/types";
import { conversationPlatformGroup, platformFromLabel, platformName } from "../../shared/platforms";
import { AIPlatformFilter } from "./AIPlatformFilter";
import mistralIcon from "../../assets/ai/mistral-color.svg";

afterEach(cleanup);
const sources = (...platforms:string[]) => platforms.map((platform,id)=>({id:String(id),platform})) as Conversation[];

it("groups imported aliases under named AI categories without changing their stored identity",()=>{
  const conversations=sources("moonshot","Kimi","豆包","tongyi","generic","yuanbao","custom-ai");
  const onChange=vi.fn(),{rerender}=render(<AIPlatformFilter conversations={conversations} value="" onChange={onChange} zh/>);
  expect(screen.queryByRole("button",{name:"Kimi 2"})).toBeNull();
  const more=screen.getByRole("button",{name:"更多 AI 分类"});fireEvent.click(more);
  expect(screen.getByRole("option",{name:"Kimi 2"})).toBeVisible();
  expect(screen.getByRole("option",{name:"豆包 1"})).toBeVisible();
  expect(screen.getByRole("option",{name:"通义千问 1"})).toBeVisible();
  expect(screen.getByRole("option",{name:"其他 AI 1"})).toBeVisible();
  expect(screen.getByRole("option",{name:"custom-ai 1"})).toBeVisible();
  fireEvent.click(screen.getByRole("option",{name:"元宝 1"}));expect(onChange).toHaveBeenCalledExactlyOnceWith("yuanbao");expect(screen.queryByRole("listbox")).toBeNull();
  rerender(<AIPlatformFilter conversations={conversations} value="yuanbao" onChange={onChange} zh/>);
  expect(more).toHaveTextContent("元宝");expect(screen.getByRole("button",{name:"全部 AI 7"})).toHaveAttribute("aria-pressed","false");
  fireEvent.click(more);fireEvent.click(screen.getByRole("option",{name:"Kimi 2"}));expect(onChange).toHaveBeenLastCalledWith("kimi");
  expect(conversations[0].platform).toBe("moonshot");
});

it("keeps zero-count categories quiet and retains an active custom category when sources disappear",()=>{
  const {rerender}=render(<AIPlatformFilter conversations={sources("grok")} value="grok" onChange={vi.fn()} zh={false}/>);
  expect(screen.getByRole("button",{name:"Gemini 0"})).toHaveTextContent(/^Gemini$/);
  expect(screen.getByRole("button",{name:"More AI categories"})).toHaveTextContent(/^Grok1$/);
  rerender(<AIPlatformFilter conversations={[]} value="private-model" onChange={vi.fn()} zh={false}/>);
  expect(screen.getByRole("button",{name:"More AI categories"})).toHaveTextContent("private-model");
});

it("opens a positioned menu with source icons and supports keyboard dismissal and outside clicks",async()=>{
  render(<AIPlatformFilter conversations={sources("mistral")} value="mistral" onChange={vi.fn()} zh/>);
  const trigger=screen.getByRole("button",{name:"更多 AI 分类"});
  fireEvent.keyDown(trigger,{key:"ArrowDown"});
  const menu=screen.getByRole("listbox",{name:"选择 AI 平台"}), selected=screen.getByRole("option",{name:"Mistral 1"});
  await waitFor(()=>expect(selected).toHaveFocus());expect(menu).toHaveStyle({width:"280px"});expect(selected.querySelector("img")).toHaveAttribute("src",mistralIcon);
  fireEvent.keyDown(selected,{key:"Home"});expect(screen.getByRole("option",{name:"Kimi"})).toHaveFocus();
  fireEvent.keyDown(menu,{key:"End"});expect(screen.getByRole("option",{name:"其他 AI"})).toHaveFocus();
  fireEvent.keyDown(menu,{key:"Escape"});expect(screen.queryByRole("listbox")).toBeNull();expect(trigger).toHaveFocus();
  fireEvent.click(trigger);expect(trigger).toHaveAttribute("aria-expanded","true");fireEvent.pointerDown(document.body);expect(screen.queryByRole("listbox")).toBeNull();
});

it("preserves unknown platform labels including object property names",()=>{
  for(const id of ["constructor","__proto__","custom-ai"]){expect(conversationPlatformGroup(id)).toBe(id);expect(platformName(id)).toBe(id);}
  expect(platformName("豆包","en")).toBe("Doubao");expect(conversationPlatformGroup("ChatGLM")).toBe("zhipu");
  expect(conversationPlatformGroup("GLM")).toBe("zhipu");expect(platformName("ChatGLM")).toBe("智谱 GLM");expect(platformName("zhipu","en")).toBe("GLM");expect(platformFromLabel("glm-4.7")).toBe("zhipu");
});

it("keeps GLM visible with unified counts for legacy platform labels",()=>{
 const onChange=vi.fn();render(<AIPlatformFilter conversations={sources("glm","ChatGLM","zhipu")} value="zhipu" onChange={onChange} zh/>);
 const glm=screen.getByRole("button",{name:"智谱 GLM 3"});expect(glm).toHaveAttribute("aria-pressed","true");fireEvent.click(glm);expect(onChange).toHaveBeenCalledExactlyOnceWith("zhipu");
});
