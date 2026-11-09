// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Conversation } from "../../shared/types";
import { ProjectSourceList } from "./ProjectSourceList";

const conversation = (id: string, platform: string) => ({ id, title: `对话 ${id}`, platform }) as Conversation;

it("groups sources under each AI when they come from several, and keeps one list from one AI", () => {
  const { unmount } = render(<ProjectSourceList ids={["a", "b", "c"]} conversations={[conversation("a", "chatgpt"), conversation("b", "deepseek"), conversation("c", "chatgpt")]} fallbackTitle={() => undefined} zh onOpen={vi.fn()} />);
  const chatgpt = screen.getByRole("region", { name: "ChatGPT" });
  expect(within(chatgpt).getAllByRole("button").map(button => button.textContent)).toEqual(["对话 a", "对话 c"]);
  expect(within(screen.getByRole("region", { name: "DeepSeek" })).getByRole("button").textContent).toBe("对话 b");
  unmount();
  render(<ProjectSourceList ids={["a", "c"]} conversations={[conversation("a", "chatgpt"), conversation("c", "chatgpt")]} fallbackTitle={() => undefined} zh onOpen={vi.fn()} />);
  expect(screen.queryByRole("region")).toBeNull();
  expect(screen.getAllByRole("button")).toHaveLength(2);
});
