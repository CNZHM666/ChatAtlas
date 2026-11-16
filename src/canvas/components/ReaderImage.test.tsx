import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ReaderMarkdown } from "./ReaderConversation";
import { getDatabase } from "../../storage/db";
afterEach(cleanup);
const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pAAAAABJRU5ErkJggg==";

it("reads a local image through the Markdown sanitizer and opens/closes an accessible enlargement", async () => {
  await (await getDatabase()).put("imageAssets", { id: "sha256-abc", dataUrl: pixel });
  const { container } = render(<ReaderMarkdown content="Before\n\n![Diagram](<atlas-image:sha256-abc>)\n\nAfter" zh />);
  const button = await screen.findByRole("button", { name: "放大图片：Diagram" });
  expect(container.querySelector("img")).toHaveAttribute("src", pixel);
  expect(container.querySelector("img")).toHaveAttribute("loading", "lazy");
  fireEvent.click(button);
  expect(screen.getByRole("dialog", { name: "Diagram" })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(button).toHaveFocus();
});
it("displays unresolved uploads and failed remote images without losing adjacent text", async () => {
  const { container } = render(<ReaderMarkdown content="Before\n\n![Upload](atlas-image:sediment%3A%2F%2Ffile-missing)\n\n![Remote](https://example.test/photo.png)\n\nAfter" zh />);
  expect(await screen.findByText("图片资源未保存或暂时无法加载")).toBeInTheDocument();
  fireEvent.error(container.querySelector("img")!);
  expect(screen.getAllByText("图片资源未保存或暂时无法加载")).toHaveLength(2);
  expect(container).toHaveTextContent("Before"); expect(container).toHaveTextContent("After");
});
