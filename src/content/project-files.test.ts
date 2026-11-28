import { afterEach, expect, it, vi } from "vitest";
import type { AtlasMessage } from "../shared/messages";
import { attachComposerFile, watchComposerFiles } from "./project-files";

class TestTransfer {
  files: File[] = [];
  items = { add: (file: File) => this.files.push(file) };
}

class TestDragEvent extends Event {
  dataTransfer: TestTransfer;
  constructor(name: string, options: EventInit & { dataTransfer: TestTransfer }) {
    super(name, options);
    this.dataTransfer = options.dataTransfer;
  }
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("uses the matching file picker when there are multiple attachment inputs", () => {
  vi.stubGlobal("DataTransfer", TestTransfer);
  document.body.innerHTML = `<form><div contenteditable="true"></div>
    <input id="upload-photos" type="file" accept="image/*">
    <input id="upload-files" type="file" accept=".pdf,.txt">
    </form>`;
  const composer = document.querySelector<HTMLElement>("[contenteditable]")!;
  const photos = document.querySelector<HTMLInputElement>("#upload-photos")!;
  const files = document.querySelector<HTMLInputElement>("#upload-files")!;
  // jsdom does not implement assigning a browser-created FileList.
  Object.defineProperty(files, "files", { value: [], writable: true });
  const change = vi.fn();
  const other = vi.fn();
  files.addEventListener("change", change);
  photos.addEventListener("change", other);
  const actual = new File(["contents"], "notes.pdf", { type: "application/pdf" });
  expect(attachComposerFile(composer, actual)).toBe(true);
  expect(files.files?.[0]).toBe(actual);
  expect(change).toHaveBeenCalledOnce();
  expect(other).not.toHaveBeenCalled();
});

it("delivers a drag to the original drop zone when the page has no available picker", () => {
  vi.stubGlobal("DataTransfer", TestTransfer);
  vi.stubGlobal("DragEvent", TestDragEvent);
  const form = document.createElement("form"), composer = document.createElement("textarea"), dropZone = document.createElement("div");
  form.append(composer, dropZone);
  document.body.append(form);
  const handler = vi.fn((event: Event) => {
    expect((event as TestDragEvent).dataTransfer.files[0].name).toBe("work.md");
    event.preventDefault();
  });
  dropZone.addEventListener("drop", handler);
  expect(attachComposerFile(composer, new File(["markdown"], "work.md"), dropZone)).toBe(true);
  expect(handler).toHaveBeenCalledOnce();
});

it("saves an upload from a picker associated with the composer form outside its DOM subtree", async () => {
  document.body.innerHTML = `<form id="composer"><textarea></textarea></form>
    <input type="file" form="composer" id="attachment"><input type="file" id="unrelated">`;
  const picker = document.querySelector<HTMLInputElement>("#attachment")!;
  const unrelated = document.querySelector<HTMLInputElement>("#unrelated")!;
  const file = new File(["test"], "notes.txt", { type: "text/plain" });
  vi.spyOn(file, "slice").mockReturnValue({ arrayBuffer: async () => new Uint8Array([116, 101, 115, 116]).buffer } as Blob);
  Object.defineProperty(picker, "files", { value: [file] });
  Object.defineProperty(unrelated, "files", { value: [new File(["secret"], "unrelated.txt")] });
  vi.stubGlobal("location", { href: "https://chatgpt.com/c/chat" });
  const sendMessage = vi.fn(async (message: AtlasMessage) => {
    if (message.type === "ATLAS_PROJECT_FILE_CONTEXT") return { ok: true, projects: [{ id: "project", name: "Project", auto: true }] };
    if (message.type === "ATLAS_PROJECT_FILE_START") return { ok: true, token: "transfer" };
    return { ok: true };
  });
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  const listeners = vi.spyOn(window, "addEventListener");
  const watcher = watchComposerFiles(() => "chat", () => document.querySelector("textarea"), () => true);
  const emit = (type: string, target: HTMLInputElement) => {
    const listener = listeners.mock.calls.find(([name]) => name === type)?.[1] as EventListener;
    // jsdom cannot generate trusted file picker events.
    listener({ type, isTrusted: true, composedPath: () => [target, document.body, document, window] } as unknown as Event);
  };
  try {
    emit("change", unrelated);
    expect(sendMessage).not.toHaveBeenCalled();
    emit("input", picker);
    emit("change", picker);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "ATLAS_PROJECT_FILE_FINISH", token: "transfer" }));
    expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual([
      "ATLAS_PROJECT_FILE_CONTEXT", "ATLAS_PROJECT_FILE_START", "ATLAS_PROJECT_FILE_CHUNK", "ATLAS_PROJECT_FILE_FINISH",
    ]);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "ATLAS_PROJECT_FILE_START", projectId: "project", manual: false }));
  } finally { watcher.dispose(); }
});

it("auto-saves uploads from a detached body-level picker and full-page dropzone on modern AI chats", async () => {
  document.body.innerHTML = `<main><div class="drop-overlay"></div><form><div contenteditable="true"></div></form></main>
    <input type="file" class="hidden-portal-input">`;
  const picker = document.querySelector<HTMLInputElement>(".hidden-portal-input")!;
  const overlay = document.querySelector<HTMLElement>(".drop-overlay")!;
  const file1 = new File(["spec"], "spec.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const file2 = new File(["img"], "board.png", { type: "image/png" });
  vi.spyOn(file1, "slice").mockReturnValue({ arrayBuffer: async () => new Uint8Array([115, 112, 101, 99]).buffer } as Blob);
  vi.spyOn(file2, "slice").mockReturnValue({ arrayBuffer: async () => new Uint8Array([105, 109, 103]).buffer } as Blob);
  Object.defineProperty(picker, "files", { value: [file1] });
  vi.stubGlobal("location", { href: "https://chatgpt.com/c/chat-modern" });
  const sendMessage = vi.fn(async (message: AtlasMessage) => {
    if (message.type === "ATLAS_PROJECT_FILE_CONTEXT") return { ok: true, projects: [{ id: "proj-1", name: "Hardware", auto: true }] };
    if (message.type === "ATLAS_PROJECT_FILE_START") return { ok: true, token: `t-${message.info.name}` };
    return { ok: true };
  });
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  const listeners = vi.spyOn(window, "addEventListener");
  const watcher = watchComposerFiles(() => "chat-modern", () => document.querySelector<HTMLElement>("[contenteditable]"), () => true);
  try {
    const changeListener = listeners.mock.calls.find(([name]) => name === "change")?.[1] as EventListener;
    changeListener({ type: "change", isTrusted: true, composedPath: () => [picker, document.body, document, window] } as unknown as Event);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "ATLAS_PROJECT_FILE_FINISH", token: "t-spec.docx" }));

    const dropListener = listeners.mock.calls.find(([name]) => name === "drop")?.[1] as EventListener;
    dropListener({
      type: "drop", isTrusted: true,
      dataTransfer: { files: [file2], getData: () => "" },
      composedPath: () => [overlay, document.querySelector("main")!, document.body, document, window],
    } as unknown as Event);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "ATLAS_PROJECT_FILE_FINISH", token: "t-board.png" }));
  } finally { watcher.dispose(); }
});
