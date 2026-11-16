import { expect, it } from "vitest";
import { imageResourceReader } from "./import-image-resources";
import { materializeCaptureImages } from "../shared/capture-images";
import { importerFor, recordsFromJson } from "./importers";
import { geminiHtmlText } from "./importers/gemini";

it("matches archive resources by exact provider file ID and refuses ambiguous basenames", async () => {
  const read = imageResourceReader([
    { name: "images/file-abc-photo.png", read: async () => new Uint8Array([1]) },
    { name: "one/photo.png", read: async () => new Uint8Array([2]) },
    { name: "two/photo.png", read: async () => new Uint8Array([3]) },
  ]);
  expect(await read({ parts: [{ content_type: "image_asset_pointer", asset_pointer: "sediment://file-abc" }] })).toEqual([{ references: ["atlas-image:sediment%3A%2F%2Ffile-abc"], dataUrl: "data:image/png;base64,AQ==" }]);
  expect(await read({ text: "![photo](photo.png)" })).toEqual([]);
  expect(await read({ text: "![photo](two/photo.png)" })).toEqual([{ references: ["two/photo.png"], dataUrl: "data:image/png;base64,Aw==" }]);
});
it("retains images and complete HTML artifacts in Claude and generic imports", async () => {
  const records = recordsFromJson([
    { uuid: "claude-images", name: "Images", chat_messages: [{ uuid: "u", sender: "human", content: [{ type: "image", source: { type: "url", url: "photo.png" } }] }, { uuid: "a", sender: "assistant", content: [{ type: "tool_use", name: "artifacts", input: { type: "text/html", title: "Counter", content: '<button onclick="this.textContent=\'Done\'">Try</button>' } }] }] },
  ], "conversations.json")!;
  const capture = await importerFor(records[0]).normalize(records[0].raw, "v");
  expect(capture.messages).toHaveLength(2);
  expect(capture.messages[0].content).toContain("![");
  expect(capture.messages[1].uiParts![0].raw).toContain("onclick");
  expect(capture.messages[1].content).not.toContain("onclick");
  const generic = recordsFromJson({ platform: "qwen", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "photo.png" } }] }, { role: "assistant", content: [{ type: "html", text: "<div>Result</div>" }] }] }, "custom.json")![0];
  const saved = await materializeCaptureImages(await importerFor(generic).normalize(generic.raw, "v"), [{ references: ["photo.png"], dataUrl: "data:image/png;base64,AQ==" }]);
  expect(saved.imageAssets).toHaveLength(1);
  expect(saved.messages[1].uiParts![0].raw).toContain("Result");
});
it("keeps Gemini Takeout images in place while preserving fenced code literally", () => {
  const text = geminiHtmlText('<p>Before</p><img src="images/photo.png" alt="Diagram"><p>After</p><pre>&lt;img src="code.png"&gt;</pre>');
  expect(text).toContain("Before\n\n![Diagram](<atlas-image:images%2Fphoto.png>)\n\nAfter");
  expect(text).toContain('```\n<img src="code.png">\n```');
});
