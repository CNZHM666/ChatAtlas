import { expect, it } from "vitest";
import { imageAliases, imageLinks, imageMarkdown, importedImage, originalImageReference, viewableImageUrl } from "./conversation-images";
import { materializeCaptureImages } from "./capture-images";
import { normalizeHistoryConversation } from "../sync/chatgpt-normalizer";

const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pAAAAABJRU5ErkJggg==";
it("retains uploaded and generated image-only ChatGPT messages in their original order", async () => {
  const capture = await normalizeHistoryConversation({ id: "images", current_node: "a", mapping: {
    u: { parent: null, message: { id: "u", author: { role: "user" }, content: { parts: [{ content_type: "image_asset_pointer", asset_pointer: "sediment://file-upload" }, "看这张图"] } } },
    a: { parent: "u", message: { id: "a", author: { role: "assistant" }, content: { parts: [{ content_type: "image_asset_pointer", asset_pointer: "file-service://file-generated" }] } } },
  } });
  expect(capture.messages).toHaveLength(2);
  expect(imageLinks(capture.messages[0].content).map(link => originalImageReference(link.source))).toEqual(["sediment://file-upload"]);
  const saved = await materializeCaptureImages(capture, [{ references: ["sediment://file-upload", "file-service://file-generated"], dataUrl: pixel }]);
  expect(saved.imageAssets).toHaveLength(1);
  for (const message of saved.messages) expect(imageLinks(message.content)[0].source).toBe(`atlas-image:${saved.imageAssets![0].id}`);
  expect(saved.messages[0].content).toContain("看这张图");
  expect(JSON.stringify(saved.messages)).not.toContain("iVBORw0");
});
it("accepts common multimodal image formats and rejects active image URLs", () => {
  for (const part of [{ type: "image_url", image_url: { url: "https://example.test/a.png" } }, { type: "image", source: { type: "base64", media_type: "image/png", data: pixel.split(",")[1] } }, { inlineData: { mimeType: "image/png", data: pixel.split(",")[1] } }, { file_name: "uploaded.png" }]) expect(importedImage(part)).toMatch(/^!\[/u);
  expect(importedImage({ type: "text", text: "image.png" })).toBeUndefined();
  expect(viewableImageUrl("javascript:alert(1)")).toBe(false);
  expect(viewableImageUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
});
it("retains tool-generated image output without importing its execution commands", async () => {
  const capture = await normalizeHistoryConversation({ id: "generated", mapping: { tool: { message: { id: "tool", author: { role: "tool" }, content: { parts: ["internal generation command", { content_type: "image_asset_pointer", asset_pointer: "file-service://file-image" }] } } } } });
  expect(capture.messages).toHaveLength(1);
  expect(capture.messages[0].role).toBe("assistant");
  expect(capture.messages[0].content).toContain("file-image");
  expect(capture.messages[0].content).not.toContain("internal generation command");
});
it("leaves code examples intact and keeps UI fallback references in agreement with body text", async () => {
  const body = imageMarkdown("photo.png"), code = `\n\n\`\`\`md\n${body}\n\`\`\``;
  const capture = await normalizeHistoryConversation({ id: "ui", mapping: { a: { message: { author: { role: "assistant" }, content: { parts: [`【原平台交互内容】\n${body}${code}`] } } } } });
  capture.messages[0].uiParts = [{ ordinal: 0, raw: "{}", fallbackText: body }];
  const saved = await materializeCaptureImages(capture, [{ references: ["photo.png"], dataUrl: pixel }]);
  expect(saved.messages[0].content).toContain(code);
  expect(saved.messages[0].content).toContain(saved.messages[0].uiParts![0].fallbackText!);
  expect(imageAliases("sediment://file-abc")).toContain("file-abc");
  expect(imageAliases("user/file-abc-photo.png")).toContain("file-abc");
});
it("never replaces an unavailable image with a different host's same-named image", async () => {
  const capture = await normalizeHistoryConversation({ id: "distinct", mapping: { u: { message: { author: { role: "user" }, content: { parts: [imageMarkdown("https://one.test/image.png"), imageMarkdown("https://two.test/image.png")] } } } } });
  const saved = await materializeCaptureImages(capture, [{ references: ["https://two.test/image.png"], dataUrl: pixel }]);
  expect(imageLinks(saved.messages[0].content).map(link => link.source)).toEqual(["https://one.test/image.png", `atlas-image:${saved.imageAssets![0].id}`]);
});
